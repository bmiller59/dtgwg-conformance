// SPDX-License-Identifier: Apache-2.0
// Emit host for VTI's own client-side builders (producer class, docs/04 section 11.8). It runs VTI's `VtaClient` (vta-sdk) with a
// fixed identity against a capture endpoint, calls the client method that builds each task, and returns the signed document the
// client POSTed to `/trust-tasks`. The capture endpoint keeps the whole body, so the proof, recipient and issuedAt the client attached
// are all retained (the SDK's loopback sink hands out only (type, payload), which is not enough for these vectors). Nothing in VTI is
// changed. The capture answers every request with an error, so no method completes; what matters is the document it built.
//
//   GET  /ctl/types          the Type URIs this host can emit, with the VtaClient method that builds each
//   POST /ctl/emit           {type}: the documents captured while that method ran, plus the method name and any client error
//   POST /ctl/shutdown
// Sample inputs the method needs come with the request (`sample`: a schema-valid payload of that type from the pinned
// @openvtc/trust-tasks package) where the method takes a payload as JSON; other arguments are fixed placeholders below. No role,
// policy or other governance value is chosen here beyond a placeholder that the document carries as an input the caller supplies;
// where a client method hard-codes one itself, the host reports it in `governance`.
use axum::{Json, Router, extract::State, routing::{get, post}};
use serde_json::{Value, json};
use std::{collections::HashMap, future::Future, pin::Pin, sync::{Arc, Mutex as StdMutex}, time::Duration};
use vta_sdk::client::{ClientIdentity, VtaClient};

type Fut = Pin<Box<dyn Future<Output = Option<String>> + Send>>;
pub struct Ctx {
    pub c: VtaClient,
    pub v: vtc_client::VtcClient,
    pub s: Arc<Samples>,
}
type Flow = Box<dyn Fn(Ctx) -> Fut + Send + Sync>;

struct Samples(HashMap<String, Value>);
impl Samples {
    fn get(&self, t: &str) -> Value {
        self.0.get(&format!("https://trusttasks.org/spec/{t}")).cloned().unwrap_or_else(|| json!({}))
    }
}

struct Host {
    captured: Arc<StdMutex<Vec<String>>>,
    cap_url: String,
    client_did: String,
    key: String,
    flows: Vec<(&'static str, &'static str, Option<&'static str>, Flow)>,
    stop: StdMutex<Option<tokio::sync::oneshot::Sender<()>>>,
}
type Shared = Arc<Host>;

fn did_key(seed: u8) -> (String, String) {
    use ed25519_dalek::SigningKey;
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let mut mc = vec![0xed, 0x01];
    mc.extend_from_slice(sk.verifying_key().as_bytes());
    let did = format!("did:key:{}", multibase::encode(multibase::Base::Base58Btc, mc));
    (did, multibase::encode(multibase::Base::Base58Btc, sk.to_bytes().as_slice()))
}

/// Registers a flow: type, method name, an optional note on a governance value the method itself fixes.
macro_rules! flows {
    ($v:ident; $( $t:expr, $m:expr, $g:expr, |$c:ident, $s:ident| $body:expr; )*) => {
        $( $v.push(($t, $m, $g, Box::new(|ctx: Ctx| -> Fut {
            let ($c, $s) = (ctx.c, ctx.s);
            Box::pin(async move { let _ = &$s; match $body.await { Ok(_) => None, Err(e) => Some(e.to_string()) } })
        }) as Flow)); )*
    };
}
/// Same, for the methods of VTI's VTC client (`vtc-client`, `VtcClient`).
macro_rules! vflows {
    ($v:ident; $( $t:expr, $m:expr, $g:expr, |$c:ident, $s:ident| $body:expr; )*) => {
        $( $v.push(($t, $m, $g, Box::new(|ctx: Ctx| -> Fut {
            let ($c, $s) = (ctx.v, ctx.s);
            Box::pin(async move { let _ = &$s; match $body.await { Ok(_) => None, Err(e) => Some(e.to_string()) } })
        }) as Flow)); )*
    };
}

mod flows;
use flows::table;

async fn types(State(h): State<Shared>) -> Json<Value> {
    Json(json!({"types": h.flows.iter().map(|f| json!({"type": format!("https://trusttasks.org/spec/{}", f.0), "method": f.1, "governance": f.2})).collect::<Vec<_>>()}))
}

async fn emit(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let Some(t) = req["type"].as_str() else { return Json(json!({"error": "type is required"})) };
    let slug = t.trim_start_matches("https://trusttasks.org/spec/");
    let Some(f) = h.flows.iter().find(|f| f.0 == slug) else { return Json(json!({"error": format!("no builder for {t}")})) };
    h.captured.lock().unwrap().clear();
    let samples = Arc::new(Samples(HashMap::from([(t.to_string(), req["sample"].clone())])));
    // The recipient of a built document is the `vta_did` of the client's identity (`ClientIdentity`): a harness hint is honoured by
    // naming it there, which is the SDK's own way of addressing a document.
    let vta_did = req["recipient"].as_str().map(String::from).unwrap_or_else(|| did_key(0x43).0);
    let vta_did_for_vtc = vta_did.clone();
    let client = VtaClient::authenticated(&h.cap_url, ClientIdentity::did_key(h.client_did.clone(), h.key.clone(), vta_did), "capture-token".to_string()).await;
    let holder = vta_sdk::trust_task_sign::HolderKey::from_did_key(&h.client_did, &h.key).expect("holder key");
    let vtc = vtc_client::VtcClient::with_key(&h.cap_url, &vta_did_for_vtc, holder);
    let run = tokio::spawn((f.3)(Ctx { c: client, v: vtc, s: samples }));
    let err = match tokio::time::timeout(Duration::from_secs(20), run).await { Ok(Ok(e)) => e, Ok(Err(j)) => Some(format!("builder panicked: {j}")), Err(_) => Some("timed out".into()) };
    let docs: Vec<String> = h.captured.lock().unwrap().clone();
    Json(json!({"method": f.1, "governance": f.2, "clientError": err, "documents": docs}))
}

async fn capture(State(c): State<Arc<StdMutex<Vec<String>>>>, body: axum::body::Bytes) -> (axum::http::StatusCode, Json<Value>) {
    if let Ok(t) = String::from_utf8(body.to_vec()) { c.lock().unwrap().push(t); }
    (axum::http::StatusCode::BAD_REQUEST, Json(json!({"error": "capture endpoint: nothing is served"})))
}

async fn shutdown(State(h): State<Shared>) -> Json<Value> {
    if let Some(tx) = h.stop.lock().unwrap().take() { let _ = tx.send(()); }
    Json(json!({"ok": true}))
}

#[tokio::main]
async fn main() {
    let captured: Arc<StdMutex<Vec<String>>> = Arc::new(StdMutex::new(Vec::new()));
    let cap_app = Router::new().route("/trust-tasks", post(capture)).fallback(post(capture)).with_state(captured.clone());
    let cap_l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let cap_url = format!("http://{}", cap_l.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(cap_l, cap_app).await.ok(); });

    let (client_did, key) = did_key(0x42);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let host: Shared = Arc::new(Host { captured, cap_url, client_did, key, flows: table(), stop: StdMutex::new(Some(tx)) });
    let app = Router::new().route("/ctl/types", get(types)).route("/ctl/emit", post(emit)).route("/ctl/shutdown", post(shutdown)).with_state(host);
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    println!("{}", json!({"control": format!("http://{}", l.local_addr().unwrap())}));
    axum::serve(l, app).with_graceful_shutdown(async { let _ = rx.await; }).await.ok();
}
