// SPDX-License-Identifier: Apache-2.0
// In-process host for VTI's community service (VTC). It starts VTI's `MockVtc` (the VTC's real router, trust-task dispatcher,
// handlers, stores and response signer, on a loopback port, with the VTC's own test-support state) and offers a small control
// interface for what the real wire does not give a harness (the live HTTPS adapter, src/adapters/vti/adapter.ts, drives the door):
//   POST /ctl/info      {baseUrl, vtcDid}
//   POST /ctl/token     {did, role}: seed the ACL row and mint the bearer a real login would have produced (admin routes)
//   POST /ctl/seed      {did, role, label}: an ACL row, and the member record a `member` entry stands for (replaces the offline `acl add` of the compose kit)
//   POST /ctl/resolve   {did}: cache the DID's document (a TrustTaskHTTPS service) with no ACL entry, so the VTC can plan a push to a wallet that has not joined yet
//   POST /ctl/verify    {bytes}: VTI's own proof verification on a document as received
//   POST /ctl/observe   {kind: joinRequests}: the number of join requests the VTC holds
//   POST /ctl/pushed    the push engine's records (documents the VTC handed to delivery)
//   POST /ctl/defaults  the platform's own boot-time installation of its shipped default policies (`vtc_service::policy::default::install_defaults`,
//                       the call `vtc`'s server start makes and the test-support state omits): idempotent, opt-in (the launcher sets
//                       VTI_VTC_SEED_DEFAULTS), and what the seeded-state probe (docs/22) needs for a community room to be creatable
//   POST /ctl/stepup    {did, type, payload}: the administrator's second-factor gesture for one operation, recorded as VTI's step-up gate reads it (class D: a mark in the
//                       step-up marks keyspace under VTI's own digest, 300 s, spent by the operation; the host has no authenticator). Needed by the rooms
//                       community tasks (community/create, members/add), which the default policy gates
//   VTC_HOST_MESSAGING=1 (opt-in, class D, docs/38): a messaging stand-in. The host spawns an embedded test mediator
//                       (`affinidi-messaging-test-mediator`, the crate VTI's own transport harness uses) and runs the VTC's own DIDComm
//                       listener (`vtc_service::messaging::run_didcomm_service`) on a fresh did:peer registered with it, so the VTC's push
//                       engine has a messaging session and can queue an attempt (otherwise "messaging not running - cannot push": a solicit
//                       of a membership credential answers internalError). Nothing in VTI is changed; the VTC's DID stays the did:key.
//   POST /ctl/reset     a fresh VTC (empty stores); `restart` re-serves the same state through a fresh router
//   POST /ctl/shutdown
// The VTC's own DID is a did:key whose key is the one the test-support signers derive (so its signed answers verify), passed in by
// the launcher as VTC_DID. Nothing in VTI is changed; every handler the harness reaches is VTI's own.
use axum::{Json, Router, extract::State, routing::post};
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Mutex;
mod rooms;
use vtc_service::test_support::{MockVtc, TestVtc};

/// The messaging stand-in's parts (VTC_HOST_MESSAGING=1): the embedded mediator and the VTC's own listener task.
struct Msg {
    mediator: affinidi_messaging_test_mediator::TestMediatorHandle,
    stop: tokio::sync::watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
}

struct Host {
    msg: Option<Msg>,
    vtc: Option<MockVtc>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    did: String,
}
type Shared = Arc<Mutex<Host>>;

fn bad(msg: impl Into<String>) -> Json<Value> {
    Json(json!({"error": msg.into()}))
}

/// The community's public URL: `auth/oob/request` accepts only this origin as the portal's own (T19), so the host reports it through /ctl/info. Default
/// `http://vtc.test` (every earlier run); VTC_HOST_PUBLIC_URL overrides it (the ceremony track sets `https://vtc.test`: the wallet and the spec's Origin
/// schema accept only an https portal origin, so a sign-in cannot complete against an http one).
fn public_url() -> String {
    std::env::var("VTC_HOST_PUBLIC_URL").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "http://vtc.test".to_string())
}

/// Community rooms (docs/32): `VTC_HOST_ROOMS=<context id>` turns on `[rooms.community]` with the community's VTA as the stand-in of `rooms.rs` (class D: the real
/// one needs a messaging link). Absent: rooms stay off, exactly as every earlier host.
fn rooms_context() -> Option<String> {
    std::env::var("VTC_HOST_ROOMS").ok().filter(|v| !v.is_empty())
}

fn messaging_on() -> bool {
    std::env::var("VTC_HOST_MESSAGING").ok().as_deref() == Some("1")
}

async fn start(did: &str) -> (MockVtc, Option<Msg>) {
    use affinidi_tdk::dids::{DID, KeyType, PeerKeyRole};
    use affinidi_tdk::secrets_resolver::{SecretsResolver, ThreadedSecretsResolver};
    let mut builder = TestVtc::builder().vtc_did(did).with_audit(true).with_signers(true).with_did_resolver(true).with_public_url(public_url());
    if let Some(context) = rooms_context() {
        builder = builder
            .with_community_rooms(vtc_service::config::CommunityRoomsConfig {
                context,
                webvh_server: Some("hosting".into()),
                mediator_did: Some("did:example:mediator".into()),
                authority_valid_days: None,
                authority_renew_within_days: None,
                removal_grace_days: None,
            })
            .with_community_key_holder(rooms::StandInVta::new(did));
    }
    // The messaging stand-in: a mediator and a did:peer listener identity registered with it (the transport harness's own recipe).
    let mut listener_parts = None;
    if messaging_on() {
        let roles = vec![(PeerKeyRole::Verification, KeyType::Ed25519), (PeerKeyRole::Encryption, KeyType::X25519)];
        let (ldid, secrets) = DID::generate_did_peer(roles, None).expect("listener did:peer");
        let mediator = affinidi_messaging_test_mediator::TestMediator::builder().local_did(ldid.clone()).local_direct_delivery(true, false).spawn().await.expect("spawn the embedded mediator");
        builder = builder.messaging_mediator(mediator.did().to_string()).with_atm(build_atm(&secrets).await);
        listener_parts = Some((ldid, secrets, mediator));
    }
    let vtc = builder.build().await;
    let mut msg = None;
    if let Some((ldid, secrets, mediator)) = listener_parts {
        let (stop, mut stop_rx) = tokio::sync::watch::channel(false);
        let (resolver, _task) = ThreadedSecretsResolver::new(None).await;
        resolver.insert_vec(&secrets).await;
        let resolver = Arc::new(resolver);
        let config = vtc.state.config.read().await.clone();
        let state = vtc.state.clone();
        let wait_state = vtc.state.clone();
        let task = tokio::spawn(async move { vtc_service::messaging::run_didcomm_service(&config, &resolver, &ldid, state, &mut stop_rx).await });
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
        while wait_state.didcomm.get().is_none() {
            assert!(tokio::time::Instant::now() < deadline, "the VTC's DIDComm listener did not publish its messaging handle in 30 s");
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        msg = Some(Msg { mediator, stop, task });
    }
    let started = MockVtc::start_with(vtc).await;
    if std::env::var("VTC_HOST_BOOT").ok().as_deref() == Some("1") {
        boot(&started).await;
    }
    (started, msg)
}

async fn build_atm(secrets: &[affinidi_tdk::secrets_resolver::secrets::Secret]) -> affinidi_tdk::messaging::ATM {
    use affinidi_tdk::common::{TDKSharedState, config::TDKConfig};
    use affinidi_tdk::secrets_resolver::SecretsResolver;
    let tdk = TDKSharedState::new(TDKConfig::builder().build().expect("TDK config")).await.expect("TDK shared state");
    for s in secrets {
        tdk.secrets_resolver().insert(s.clone()).await;
    }
    affinidi_tdk::messaging::ATM::new(affinidi_tdk::messaging::config::ATMConfig::builder().build().expect("ATM config"), Arc::new(tdk)).await.expect("ATM init")
}

async fn stop_msg(m: Option<Msg>) {
    if let Some(m) = m {
        let _ = m.stop.send(true);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), m.task).await;
        drop(m.mediator); // the handle stops the embedded mediator when dropped
    }
}

/// The boot steps `vtc`'s server start makes and the test-support state omits (ceremony track, VTC_HOST_BOOT=1): the shipped default policies
/// (`install_defaults`, so a join submission is decided rather than answered `internalError`) and the two status lists
/// (`server.rs`: `ensure_initial` for revocation and suspension under `{public_url}/v1/status-lists/{purpose}`, so an admission can mint its
/// membership credential and a vetter grant its role credential). Both are VTI's own calls on VTI's own stores; nothing is written by the host.
async fn boot(v: &MockVtc) {
    vtc_service::policy::default::install_defaults(&v.vtc.state.policies_ks, &v.vtc.state.active_policies_ks).await.expect("install the default policies");
    for purpose in [vtc_service::status_list::StatusPurpose::Revocation, vtc_service::status_list::StatusPurpose::Suspension] {
        let url = format!("{}/v1/status-lists/{purpose}", public_url());
        vtc_service::status_list::ensure_initial(&v.vtc.state.status_lists_ks, purpose, url).await.expect("provision the status list");
    }
}

async fn info(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    Json(json!({"baseUrl": v.base_url(), "vtcDid": g.did, "publicUrl": public_url()}))
}

async fn token(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let (Some(did), Some(role)) = (req["did"].as_str(), req["role"].as_str()) else { return bad("did and role are required") };
    let t = v.vtc.token(did, role, Vec::new()).await;
    Json(json!({"token": t}))
}

async fn seed(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let (Some(did), Some(role)) = (req["did"].as_str(), req["role"].as_str()) else { return bad("did and role are required") };
    // `token` writes the ACL row when there is none; the bearer is discarded.
    let _ = v.vtc.token(did, role, Vec::new()).await;
    // A seeded actor is a member of the community: VTI counts a DID as an active member only with both an ACL entry and a member
    // record (member_portal/active.rs), and the entry the harness seeds is a `member` (or `admin`) one. An ACL entry alone is the
    // partial state VTI calls "not a member", so the member-gated tasks (vtc/directory/card/show, card/update) would answer
    // `notMember` before they read the payload. An `application` entry is not a membership and gets no record.
    if role != "application" {
        let members_ks = &v.vtc.state.members_ks;
        if let Ok(None) = vtc_service::members::storage::get_member(members_ks, did).await {
            vtc_service::members::storage::store_member(members_ks, &vtc_service::members::Member::fresh(did)).await.expect("seed the member record");
        }
    }
    // observe.pushed: the harness actor's DID document goes into the VTC's resolver cache with a `TrustTaskHTTPS` service (a loopback port nothing
    // listens on). Without it a did:key recipient advertises nothing and the push engine needs a messaging session to plan a push at all
    // (`choose`: DIDComm only when messaging is up), so a push would fail before it is recorded and a negative vector would pass vacuously. With
    // it the engine plans REST, records the signed document, and then fails to queue (no messaging session here): the record is the observation.
    if let (Some(fp), Some(resolver)) = (did.strip_prefix("did:key:"), v.vtc.state.did_resolver.as_ref()) {
        let vm = format!("{did}#{fp}");
        let doc = json!({
            "id": did,
            "verificationMethod": [{"id": vm, "type": "Multikey", "controller": did, "publicKeyMultibase": fp}],
            "authentication": [vm], "assertionMethod": [vm],
            "service": [{"id": format!("{did}#https"), "type": "TrustTaskHTTPS", "serviceEndpoint": "http://127.0.0.1:9"}]
        });
        let mut cache = resolver.clone(); // a clone shares the resolver's cache
        cache.add_did_document(did, serde_json::from_value(doc).expect("a DID document")).await;
    }
    Json(json!({"ok": true}))
}

/// `/ctl/resolve {did}`: the DID's document goes into the VTC's resolver cache with a `TrustTaskHTTPS` service (a loopback port nothing listens on) and NO
/// access-list entry or member record. The wallet that is about to apply is not a member yet, but the VTC pushes to it (submit receipt, membership
/// credential, request for a reciprocal credential): without a document a did:key advertises nothing and the push engine refuses to plan (class D, the harness
/// applicant has no mediator). Same document `seed` caches for a harness member.
async fn resolve(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let Some(did) = req["did"].as_str() else { return bad("did is required") };
    if let (Some(fp), Some(resolver)) = (did.strip_prefix("did:key:"), v.vtc.state.did_resolver.as_ref()) {
        let vm = format!("{did}#{fp}");
        let doc = json!({
            "id": did,
            "verificationMethod": [{"id": vm, "type": "Multikey", "controller": did, "publicKeyMultibase": fp}],
            "authentication": [vm], "assertionMethod": [vm],
            "service": [{"id": format!("{did}#https"), "type": "TrustTaskHTTPS", "serviceEndpoint": "http://127.0.0.1:9"}]
        });
        let mut cache = resolver.clone();
        cache.add_did_document(did, serde_json::from_value(doc).expect("a DID document")).await;
    }
    Json(json!({"ok": true}))
}

async fn stepup(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let (Some(did), Some(type_uri)) = (req["did"].as_str(), req["type"].as_str()) else { return bad("did and type are required") };
    let digest = match vtc_service::acl::bound_step_up::operation_digest(type_uri, &req["payload"]) { Ok(d) => d, Err(e) => return bad(e.to_string()) };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mark = json!({"expires_at": now + vtc_service::acl::bound_step_up::MARK_TTL_SECS, "credential_id": "ceremony-host", "bound_to": "zCeremonyHost", "kind": "webauthn", "challenge": "Y2VyZW1vbnktaG9zdC1jaGFsbGVuZ2U", "created_at": now});
    match v.vtc.state.step_up_marks_ks.insert(format!("mark:{did}:{digest}"), &mark).await { Ok(()) => Json(json!({"ok": true})), Err(e) => bad(e.to_string()) }
}

async fn verify(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let Some(bytes) = req["bytes"].as_str() else { return bad("bytes is required") };
    let Ok(received) = serde_json::from_str::<Value>(bytes) else { return Json(json!({"valid": false, "why": "not JSON"})) };
    let resolver = v.vtc.state.trust_task_vm_resolver();
    match vti_common::auth::verify_trust_task_proof_value(&received, &resolver).await {
        Ok(signer) => Json(json!({"valid": true, "signer": signer})),
        Err(e) => Json(json!({"valid": false, "why": e.to_string()})),
    }
}

/// Run the platform's own installation of its default policies on this VTC's stores, as `vtc`'s server start does before it serves. Nothing is
/// written by the host itself: the call, the policies and the stores are VTI's own.
async fn defaults(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    match vtc_service::policy::default::install_defaults(&v.vtc.state.policies_ks, &v.vtc.state.active_policies_ks).await {
        Ok(n) => Json(json!({"installed": n})),
        Err(e) => bad(e.to_string()),
    }
}

async fn observe(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    match req["kind"].as_str() {
        // join requests the VTC holds: what a `credential-exchange/present` that was accepted leaves behind (the request it decided)
        Some("joinRequests") => match vtc_service::join::storage::list_join_requests(&v.vtc.state.join_requests_ks).await {
            Ok(r) => Json(json!({"value": r.len()})),
            Err(e) => bad(e.to_string()),
        },
        // room records the host holds, all rooms (docs/32): what a `rooms/records/put` the host accepted leaves behind
        Some("roomRecords") => {
            let rooms = match vti_rooms::storage::list_rooms(&v.vtc.state.rooms_ks).await { Ok(r) => r, Err(e) => return bad(e.to_string()) };
            let mut n = 0usize;
            for r in rooms {
                match vti_rooms::storage::list_records(&v.vtc.state.room_records_ks, &r.room_id, None, None).await { Ok(x) => n += x.len(), Err(e) => return bad(e.to_string()) }
            }
            Json(json!({"value": n}))
        }
        other => bad(format!("unknown kind {other:?}")),
    }
}

/// The push records of the VTC's push engine (`member_pushes_ks`): every document a push site handed to delivery, as sent. The engine writes
/// the record before it queues an attempt, and it plans REST for a recipient that advertises `TrustTaskHTTPS` (see `seed`) without a messaging
/// session, so a push to a seeded harness actor is recorded even though this host runs no messaging.
async fn pushed(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    let v = g.vtc.as_ref().expect("vtc running");
    let rows = match v.vtc.state.member_pushes_ks.prefix_iter_raw(b"push:".to_vec()).await {
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

async fn reset(State(h): State<Shared>) -> Json<Value> {
    let mut g = h.lock().await;
    if let Some(old) = g.vtc.take() {
        old.shutdown().await;
    }
    stop_msg(g.msg.take()).await;
    let did = g.did.clone();
    let (v, m) = start(&did).await;
    g.vtc = Some(v);
    g.msg = m;
    Json(json!({"ok": true}))
}

async fn shutdown(State(h): State<Shared>) -> Json<Value> {
    if let Some(tx) = h.lock().await.stop.take() {
        let _ = tx.send(());
    }
    Json(json!({"ok": true}))
}

#[tokio::main]
async fn main() {
    let did = std::env::var("VTC_DID").expect("VTC_DID (a did:key whose key is the test-support signer's) is required");
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let (v, m) = start(&did).await;
    let host: Shared = Arc::new(Mutex::new(Host { msg: m, vtc: Some(v), stop: Some(tx), did }));
    let app = Router::new()
        .route("/ctl/info", post(info))
        .route("/ctl/token", post(token))
        .route("/ctl/seed", post(seed))
        .route("/ctl/resolve", post(resolve))
        .route("/ctl/verify", post(verify))
        .route("/ctl/stepup", post(stepup))
        .route("/ctl/observe", post(observe))
        .route("/ctl/pushed", post(pushed))
        .route("/ctl/defaults", post(defaults))
        .route("/ctl/reset", post(reset))
        .route("/ctl/shutdown", post(shutdown))
        .with_state(host.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind control port");
    println!("{}", json!({"control": format!("http://{}", listener.local_addr().expect("addr"))}));
    axum::serve(listener, app).with_graceful_shutdown(async move { let _ = rx.await; }).await.expect("serve");
    if let Some(v) = host.lock().await.vtc.take() {
        v.shutdown().await;
    }
    stop_msg(host.lock().await.msg.take()).await;
}
