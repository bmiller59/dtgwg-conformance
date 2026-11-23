// SPDX-License-Identifier: Apache-2.0
// In-process host for VTI's own trust-task code. It starts VTI's `MockVta` (the VTA's real router, dispatcher, handlers, stores and
// signer, bound to a loopback port, with the VTA's own test-support state) inside this process, and offers a small control
// interface to the launcher for the things the real wire does not give a harness:
//   POST /ctl/info              the VTA's address and DID; a new instance after /ctl/reset
//   POST /ctl/token             {did, role}: seed the ACL entry and mint the bearer a real login would have produced
//   POST /ctl/verify            {bytes}: VTI's own proof verification (`verify_trust_task_proof_value`) on a document as received
//   POST /ctl/observe           {kind}: counts read from the VTA's stores
//   POST /ctl/reset             a fresh VTA (empty stores)
//   POST /ctl/restart           the same VTA rebuilt over its kept store directory (a restart)
//   POST /ctl/push-probe        {recipient}: the push experiment (needs VTI_PUSH_PROBE_DID and VTI_PUSH_PROBE_PORT in the environment)
//   POST /ctl/pushed            the documents the VTA's push engine queued (needs VTI_INPROCESS_TRANSPORTS=1: a running messaging session)
//   POST /ctl/enforce           {on}: turn the VTA's policy enforcement (`config.policy.enforcement`, off by default) on or off (ceremony track, docs/26; added after the prebuilt hosts)
//   POST /ctl/trust-verifier    {vid | clear}: the holder's trusted verifiers (deployment configuration)
//   POST /ctl/policy            {enforcement?, approverSets?}: the deployment's policy configuration (`policy.enforcement`, `policy.approver_sets`), the config a VTA reads at boot and a real operator sets in its config file; the policy rules themselves are written over the wire with `policy/upsert`
//   POST /ctl/shutdown
// Nothing in VTI is changed; every handler the harness reaches is VTI's own.
use axum::{Json, Router, extract::State, routing::post};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;
use vta_service::test_support::{TestAppContext, TestAppOptions, VtaTransportIdentity, build_test_app_with};

/// The VTA the host serves: `MockVta`'s own wiring (router, state, loopback listener), built by the host so the store directory is the
/// host's (`TestAppOptions::data_dir`, the option VTI's own restart test uses, #2402) and a restart can reopen it.
struct Served {
    base_url: String,
    backing: Backing,
    /// Transports mode: the runtime the VTA and its messaging run on. VTI spawns drain loops per messaging session that nothing stops (they
    /// hold the outbox keyspace), so a restart drops the whole runtime to release the store directory for the next app.
    rt: Option<tokio::runtime::Runtime>,
}

enum Backing {
    /// What the host serves: the app over a host-owned store directory (restart works). In transports mode it also runs VTI's inbound loop on a
    /// messaging session over the embedded mediator, so the push engine can queue what it pushes.
    App { ctx: TestAppContext, shutdown: Option<tokio::sync::oneshot::Sender<()>>, handle: Option<tokio::task::JoinHandle<()>>, messaging: Option<Messaging> },
}

/// The messaging half of transports mode (the shape of `MockVta::start_with_transports`, which keeps its own store directory and so cannot restart).
struct Messaging {
    cancel: tokio_util::sync::CancellationToken,
    loop_handle: Option<tokio::task::JoinHandle<()>>,
    atm: Arc<affinidi_tdk::messaging::ATM>,
}

/// Transports mode, once per host: the embedded mediator and the VTA's did:peer:2 identity (kept across reset and restart, as a restarted
/// VTA keeps its DID).
struct Env {
    mediator: affinidi_messaging_test_mediator::TestMediatorHandle,
    identity: VtaTransportIdentity,
}

fn transports_mode() -> bool {
    std::env::var("VTI_INPROCESS_TRANSPORTS").is_ok_and(|v| v == "1")
}

impl Served {
    fn ctx(&self) -> &TestAppContext {
        match &self.backing {
            Backing::App { ctx, .. } => ctx,
        }
    }
}

/// What the push experiment (`/ctl/push-probe`) needs: a loopback `TrustTaskHTTPS` endpoint, and the recipient's DID document seeded into
/// the VTA's resolver cache with that endpoint as its service. Only when the launcher passes `VTI_PUSH_PROBE_DID` (the recipient did:key).
fn push_probe_preseed() -> Vec<(String, Value)> {
    let (Ok(did), Ok(port)) = (std::env::var("VTI_PUSH_PROBE_DID"), std::env::var("VTI_PUSH_PROBE_PORT")) else { return Vec::new() };
    let fp = did.trim_start_matches("did:key:").to_string();
    let vm = format!("{did}#{fp}");
    vec![(did.clone(), json!({
        "id": did,
        "verificationMethod": [{"id": vm, "type": "Multikey", "controller": did, "publicKeyMultibase": fp}],
        "authentication": [vm], "assertionMethod": [vm],
        "service": [{"id": format!("{did}#https"), "type": "TrustTaskHTTPS", "serviceEndpoint": format!("http://127.0.0.1:{port}")}]
    }))]
}

static CAPTURED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

async fn mint_env() -> Env {
    use affinidi_messaging_test_mediator::TestMediator;
    use affinidi_tdk::dids::{OneOrMany, PeerService, PeerServiceEndpoint, PeerServiceEndpointLong};
    affinidi_messaging_test_mediator::install_default_crypto_provider();
    let mediator = TestMediator::builder()
        .local_direct_delivery(true, false)
        .enable_forwarding(true)
        .enable_external_forwarding(true)
        .enable_inter_mediator_relay(true)
        .spawn()
        .await
        .expect("spawn the test mediator");
    let mediator_did = mediator.did().to_string();
    let didcomm = vta_service::operations::did_peer::mediator_did_didcomm_service(&mediator_did, vec![], vec![]);
    let tsp = PeerService {
        type_: "TSPTransport".into(),
        endpoint: PeerServiceEndpoint::Long(OneOrMany::One(PeerServiceEndpointLong { uri: mediator.endpoint().to_string(), accept: vec![], routing_keys: vec![] })),
        id: None,
    };
    let (did, secrets) = vta_service::operations::did_peer::mint_did_peer_with_services(didcomm.into_iter().chain(std::iter::once(tsp)).collect()).expect("mint the VTA did:peer");
    mediator.register_local_did(&did).await.expect("register the VTA on the mediator");
    Env { mediator, identity: VtaTransportIdentity { did, secrets, mediator_did } }
}

async fn serve(dir: &std::path::Path, env: Option<&Env>) -> Served {
    let Some(e) = env else { return serve_inner(dir.to_path_buf(), None).await };
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("a runtime for the VTA");
    let identity = e.identity.clone();
    let dir = dir.to_path_buf();
    let mut served = rt.spawn(serve_inner(dir, Some(identity))).await.expect("start the VTA");
    served.rt = Some(rt);
    served
}

async fn serve_inner(dir: std::path::PathBuf, identity: Option<VtaTransportIdentity>) -> Served {
    let dir = dir.as_path();
    let env = identity.as_ref();
    let (router, ctx) = build_test_app_with(TestAppOptions {
        provisionable_vta: true,
        data_dir: Some(dir.to_path_buf()),
        preseed_did_docs: push_probe_preseed(),
        vta_transport: env.cloned(),
        ..Default::default()
    })
    .await;
    let messaging = match env {
        None => None,
        Some(id) => {
            let m = Arc::new(
                vta_service::messaging::service::build_messaging(
                    id.secrets.clone(),
                    &id.did,
                    &id.mediator_did,
                    ctx.outbox_ks.clone(),
                    ctx.state.trust_task_pushes_ks.clone(),
                    ctx.relationships_ks.clone(),
                    Arc::new(std::sync::atomic::AtomicU64::new(0)),
                    ctx.state.did_resolver.as_ref(),
                    None,
                )
                .await
                .expect("build the VTA's messaging over the test mediator"),
            );
            let atm = m.atm.clone();
            ctx.state.didcomm_bridge.set_messaging(m.service.clone(), (*m.atm).clone(), m.profile.clone(), id.did.clone());
            let cancel = tokio_util::sync::CancellationToken::new();
            let loop_handle = tokio::spawn({
                let (m, state, did, cancel) = (m.clone(), ctx.state.clone(), id.did.clone(), cancel.clone());
                async move {
                    vta_service::messaging::service::run_inbound_loop(m, state, did, cancel, Arc::new(vti_common::inbox::ReconnectGovernor::new(vti_common::inbox::Escalation::EndSession))).await;
                }
            });
            // The deployment's holder identity (see `configure_holder`).
            configure_holder(&ctx).await;
            Some(Messaging { cancel, loop_handle: Some(loop_handle), atm })
        }
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind loopback port");
    let base_url = format!("http://{}", listener.local_addr().expect("addr"));
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>()).with_graceful_shutdown(async move { let _ = rx.await; }).await;
    });
    Served { base_url, backing: Backing::App { ctx, shutdown: Some(tx), handle: Some(handle), messaging }, rt: None }
}

/// The deployment's holder identity: `credential_holder_did` names a `did:key` whose derived key the VTA manages (its keys keyspace holds the record,
/// the master seed derives the key), via VTI's own test-support `seed_holder_key`, so the VTA accepts an offer and answers it with a `request`
/// carrying a key-binding proof by that key.
async fn configure_holder(ctx: &TestAppContext) {
    let did = vta_service::test_support::seed_holder_key(&ctx.state, "m/44'/9999'/7'", None).await;
    ctx.state.config.write().await.credential_holder_did = Some(did);
}

impl Served {
    /// Stop the server and drop the router and context, so the store is released (fjall locks its directory while a handle lives).
    async fn stop(self) {
        let rt = self.rt;
        match self.backing {
            Backing::App { mut shutdown, mut handle, ctx, messaging } => {
                // In this order, as `MockVta::shutdown`: the inbound loop, then the messaging websocket (an abandoned one keeps reconnecting).
                if let Some(mut m) = messaging {
                    m.cancel.cancel();
                    if let Some(h) = m.loop_handle.take() {
                        let _ = h.await;
                    }
                    m.atm.graceful_shutdown().await;
                }
                if let Some(tx) = shutdown.take() {
                    let _ = tx.send(());
                }
                if let Some(h) = handle.take() {
                    let _ = h.await;
                }
                drop(ctx);
            }
        }
        if let Some(rt) = rt {
            rt.shutdown_background();
            // The tasks that hold the store are dropped as the runtime's workers wind down.
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        }
    }
}

struct Host {
    env: Option<Env>,
    vta: Option<Served>,
    dir: std::path::PathBuf,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}
type Shared = Arc<Mutex<Host>>;

fn bad(msg: impl Into<String>) -> Json<Value> {
    Json(json!({"error": msg.into()}))
}

async fn info(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    // The VTA's DID document, resolved by the VTA's own resolver: a did:peer:2 VTA (transports mode) cannot be rebuilt from its identifier in the adapter.
    let did_document = match v.ctx().state.did_resolver.as_ref() {
        Some(r) => r.resolve(&v.ctx().vta_did).await.ok().and_then(|x| serde_json::to_value(&x.doc).ok()),
        None => None,
    };
    let holder = v.ctx().state.config.read().await.credential_holder_did.clone();
    Json(json!({"baseUrl": v.base_url, "vtaDid": v.ctx().vta_did, "didDocument": did_document, "holderDid": holder}))
}

/// `policy.enforcement` is a setting of the service (a `config.toml` key, off by default): with it on, the pre-dispatch gate evaluates the stored policy rules. The host sets it the way VTI's own tests do.
async fn enforce(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let on = req["on"].as_bool().unwrap_or(true);
    v.ctx().state.config.write().await.policy.enforcement = on;
    Json(json!({"enforcement": on}))
}

async fn token(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let (Some(did), Some(role)) = (req["did"].as_str(), req["role"].as_str()) else { return bad("did and role are required") };
    let contexts: Vec<String> = req["contexts"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    // `sessionId`: the access token a client gets by refreshing an existing session (VTI step_up.rs, "the client refreshes to mint a new access
    // token at the elevated acr"): the same session, its stored amr and acr. A static bearer minted before a step-up would keep its aal1 claim (class D).
    if let Some(sid) = req["sessionId"].as_str() {
        let Ok(Some(s)) = vti_common::auth::session::get_session(&v.ctx().sessions_ks, sid).await else { return bad("no such session") };
        let claims = v.ctx().jwt_keys.new_claims(s.did.clone(), s.session_id.clone(), role.to_string(), contexts, 900, false).with_aal(s.amr.clone(), s.acr.clone());
        return Json(json!({"token": v.ctx().jwt_keys.encode(&claims).expect("encode jwt")}));
    }
    let t = mint_login_token(v.ctx(), did, role, contexts).await;
    Json(json!({"token": t}))
}

/// The bearer a real `auth/authenticate` would have produced. VTI's `mint_token` stores a session with an empty `amr`; the
/// authenticate specification says a fresh session's `amr` MUST include "did" and its `acr` defaults to "aal1" (auth/authenticate
/// 0.1, consumer step 8), and the session schema requires at least one `amr` entry, so VTI's own response check refuses the
/// answers that carry such a session (`auth/sessions/list`, `auth/whoami`). The ACL row is seeded the way `mint_token` does, and a session
/// with the authentication factor is stored and signed instead (no second, empty-amr session is left for `auth/sessions/list` to show).
async fn mint_login_token(ctx: &TestAppContext, did: &str, role: &str, contexts: Vec<String>) -> String {
    use vti_common::auth::session::{Session, SessionState, store_session};
    // The ACL row first, as `mint_token` does (only when there is none): a real token is only minted for a DID with an entry. Not through
    // `mint_token` itself, which would also store a session with an empty `amr` that `auth/sessions/list` then lists beside this one.
    if let Ok(parsed) = vta_service::acl::Role::parse(role)
        && vta_service::acl::get_acl_entry(&ctx.acl_ks, did).await.expect("read ACL").is_none()
    {
        vta_service::test_support::seed_acl_entry(&ctx.acl_ks, did, parsed, contexts.clone()).await;
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let session_id = format!("sess-{}", uuid::Uuid::new_v4());
    let session = Session {
        session_id: session_id.clone(),
        did: did.to_string(),
        challenge: String::new(),
        state: SessionState::Authenticated,
        created_at: now,
        last_seen: now,
        refresh_token: None,
        refresh_expires_at: None,
        tee_attested: false,
        amr: vec!["did".to_string()],
        acr: "aal1".to_string(),
        acr_expires_at: None,
        token_id: None,
        session_pubkey_b58btc: None,
        not_after: None,
    };
    store_session(&ctx.sessions_ks, &session).await.expect("store session");
    let claims = ctx.jwt_keys.new_claims(did.to_string(), session_id, role.to_string(), contexts, 900, false).with_aal(vec!["did".to_string()], "aal1");
    ctx.jwt_keys.encode(&claims).expect("encode jwt")
}

async fn verify(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let Some(bytes) = req["bytes"].as_str() else { return bad("bytes is required") };
    let Ok(received) = serde_json::from_str::<Value>(bytes) else { return Json(json!({"valid": false, "why": "not JSON"})) };
    let resolver = vta_sdk::trust_task_proof::TrustTaskVmResolver::from_optional(v.ctx().state.did_resolver.clone());
    match vta_sdk::trust_task_proof::verify_trust_task_proof_value(&received, &resolver).await {
        Ok(signer) => Json(json!({"valid": true, "signer": signer})),
        Err(e) => Json(json!({"valid": false, "why": e.to_string()})),
    }
}

async fn observe(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    match req["kind"].as_str() {
        // credentials held in the VTA's vault (record prefix `cred:`)
        Some("credentials") => match v.ctx().vault_ks.prefix_keys("cred:").await {
            Ok(k) => Json(json!({"value": k.len()})),
            Err(e) => bad(e.to_string()),
        },
        other => bad(format!("unknown kind {other:?}")),
    }
}

fn fresh_dir() -> std::path::PathBuf {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("vti-inprocess-store-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("store dir");
    dir
}

async fn reset(State(h): State<Shared>) -> Json<Value> {
    let mut g = h.lock().await;
    if let Some(old) = g.vta.take() {
        old.stop().await;
    }
    let old_dir = std::mem::replace(&mut g.dir, fresh_dir());
    let _ = std::fs::remove_dir_all(old_dir);
    let dir = g.dir.clone();
    g.vta = Some(serve(&dir, g.env.as_ref()).await);
    Json(json!({"ok": true}))
}

/// A restart: the server, router and context are dropped (the store is released) and the app is built again over the same store directory,
/// so what the new instance sees is what reached the disk (the shape of VTI's own restart test, vta-service tests/it/idempotency_trust_task.rs).
async fn restart(State(h): State<Shared>) -> Json<Value> {
    let mut g = h.lock().await;
    if let Some(old) = g.vta.take() {
        old.stop().await;
    }
    let dir = g.dir.clone();
    g.vta = Some(serve(&dir, g.env.as_ref()).await);
    let v = g.vta.as_ref().expect("vta running");
    Json(json!({"baseUrl": v.base_url, "vtaDid": v.ctx().vta_did}))
}

/// The push experiment: ask the VTA's own push engine (`messaging::push::push_trust_task`, what `pending/approve` and a consent request call) to
/// push a document to the recipient whose DID document advertises a loopback `TrustTaskHTTPS` endpoint, wait, and report what the engine
/// answered and whether the endpoint received a POST. Nothing in VTI is changed.
async fn push_probe(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let Some(recipient) = req["recipient"].as_str() else { return bad("recipient is required") };
    let state = { let g = h.lock().await; g.vta.as_ref().expect("vta running").ctx().state.clone() };
    let doc = json!({"id": "urn:uuid:push-probe", "type": "https://trusttasks.org/spec/conformance/push-probe/0.1", "issuer": "probe", "recipient": recipient, "issuedAt": "2026-11-16T00:00:00Z", "payload": {}});
    let before = CAPTURED.lock().unwrap().len();
    let answer = vta_service::messaging::push::push_trust_task(&state, recipient, doc, std::time::Duration::from_secs(30)).await;
    let _ = vta_service::messaging::push::sweep(&state).await;
    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    let received = CAPTURED.lock().unwrap().len() - before;
    Json(json!({"pushAnswer": match &answer { Ok(id) => json!({"ok": id}), Err(e) => json!({"err": e.to_string()}) }, "wiring": state.didcomm_bridge.push_wiring().is_some(), "received": received}))
}

/// The push records the VTA's push engine wrote (`trust_task_pushes_ks`, the durable record `vti_common::trust_task_push::push_trust_task`
/// stores before it queues an attempt): every document a push site handed to delivery, as sent (the signed document), with the transport
/// chosen and, once known, whether delivery was confirmed. The engine is VTI's own; this only reads its store.
async fn pushed(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let rows = match v.ctx().state.trust_task_pushes_ks.prefix_iter_raw(b"push:".to_vec()).await {
        Ok(r) => r,
        Err(e) => return bad(e.to_string()),
    };
    let mut out: Vec<Value> = rows
        .into_iter()
        .filter_map(|(_, bytes)| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|r| json!({"id": r["id"], "recipient": r["recipient"], "document": r["document"], "via": r["current"], "queuedAtMs": r["queued_at_ms"], "outcome": r["outcome"]}))
        .collect();
    out.sort_by_key(|r| r["queuedAtMs"].as_u64().unwrap_or(0));
    Json(json!({"pushes": out}))
}

/// The holder's consent policy as deployment configuration: `trusted_presentation_verifiers` (a query from one of these is answered at
/// once; any other is deferred for the operator). `{vid}` adds one, `{clear: true}` empties the list.
async fn trust_verifier(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let mut cfg = v.ctx().state.config.write().await;
    if req["clear"].as_bool() == Some(true) {
        cfg.trusted_presentation_verifiers.clear();
    }
    if let Some(vid) = req["vid"].as_str() {
        if !cfg.trusted_presentation_verifiers.iter().any(|x| x == vid) {
            cfg.trusted_presentation_verifiers.push(vid.to_string());
        }
    }
    Json(json!({"trusted": cfg.trusted_presentation_verifiers.len()}))
}

/// The deployment's policy configuration: `policy.enforcement` (the PDP is consulted before every handler) and `policy.approver_sets` (named sets of
/// approver DIDs a rule's `requireConsent` refers to). Both are configuration a real VTA reads from its config file; nothing on the wire sets them, so a
/// harness that wants the consent flow (task-consent) must set them here, as VTI's own end-to-end tests do (`cfg.policy.enforcement = true`).
async fn policy(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vta.as_ref().expect("vta running");
    let mut cfg = v.ctx().state.config.write().await;
    if let Some(e) = req["enforcement"].as_bool() {
        cfg.policy.enforcement = e;
    }
    if let Some(sets) = req["approverSets"].as_object() {
        for (name, members) in sets {
            let m: Vec<String> = members.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            cfg.policy.approver_sets.insert(name.clone(), m);
        }
    }
    Json(json!({"enforcement": cfg.policy.enforcement, "approverSets": cfg.policy.approver_sets.len()}))
}

async fn capture(body: String) -> axum::http::StatusCode {
    CAPTURED.lock().unwrap().push(body);
    axum::http::StatusCode::ACCEPTED
}

async fn shutdown(State(h): State<Shared>) -> Json<Value> {
    if let Some(tx) = h.lock().await.stop.take() {
        let _ = tx.send(());
    }
    Json(json!({"ok": true}))
}

#[tokio::main]
async fn main() {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    // The capture endpoint of the push experiment (only started when the launcher asks for it: its port is passed in VTI_PUSH_PROBE_PORT).
    if let Ok(port) = std::env::var("VTI_PUSH_PROBE_PORT") {
        let l = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.expect("bind the push capture port");
        tokio::spawn(async move { let _ = axum::serve(l, Router::new().route("/trust-tasks", post(capture))).await; });
    }
    let dir = fresh_dir();
    let env = if transports_mode() { Some(mint_env().await) } else { None };
    let host: Shared = Arc::new(Mutex::new(Host { vta: Some(serve(&dir, env.as_ref()).await), env, dir, stop: Some(tx) }));
    let app = Router::new()
        .route("/ctl/info", post(info))
        .route("/ctl/token", post(token))
        .route("/ctl/verify", post(verify))
        .route("/ctl/observe", post(observe))
        .route("/ctl/reset", post(reset))
        .route("/ctl/restart", post(restart))
        .route("/ctl/push-probe", post(push_probe))
        .route("/ctl/pushed", post(pushed))
        .route("/ctl/trust-verifier", post(trust_verifier))
        .route("/ctl/policy", post(policy))
        .route("/ctl/enforce", post(enforce))
        .route("/ctl/shutdown", post(shutdown))
        .with_state(host.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind control port");
    println!("{}", json!({"control": format!("http://{}", listener.local_addr().expect("addr"))}));
    axum::serve(listener, app).with_graceful_shutdown(async move { let _ = rx.await; }).await.expect("serve");
    let mut g = host.lock().await;
    if let Some(v) = g.vta.take() {
        v.stop().await;
    }
    if let Some(e) = g.env.take() {
        e.mediator.shutdown();
    }
    let _ = std::fs::remove_dir_all(&g.dir);
}
