// SPDX-License-Identifier: Apache-2.0
// In-process host for VTI's ballot box (`vti-voting-service`, the service a voter's cast goes to). It starts the service's own router (the HTTPS door, `POST /trust-tasks`) on a loopback port over a fresh journal, and offers a small control
// interface for what the real deployment does through other parties (docs/32, class D stand-ins):
//   POST /ctl/info      {control, door, boxDid, communityDid}
//   POST /ctl/election  {electionId, state: voting|registration, revote: refuse|replace}: a community (a did:key the host holds) registers an election on the box through the box's own door (signed as the community, as the service
//                       requires), and its registrar issues the host's voter a ticket (vti-voting's own Registrar and Voter: the blind issuance a community and a member's agent perform)
//   POST /ctl/close     {electionId}: the community's early close, through the door
//   POST /ctl/cast      {electionId, variant, version, threadId}: the cast document the voter's agent (`vta/pcs/vote`) would build, built by vti-voting's own Voter and signed by a one-time key, for the named variant
//   POST /ctl/observe   {kind: casts|counted}: the cast entries on the board, and the ballots counted (cast entries less the replacement entries)
//   POST /ctl/reset     a fresh box (empty journal and elections)
//   POST /ctl/shutdown
// Nothing in VTI is changed; every rule the box applies is VTI's own.
use axum::{Json, Router, extract::State, routing::post};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use trust_tasks_rs::TrustTask;
use vti_voting::{
    election::{Election, ElectionId},
    rand::{SeedableRng, rngs::StdRng},
    registrar::Registrar,
    rules::{digest_multibase, manifest_digest},
    service::{BallotBox, Caller},
    voter::{Ticket, Voter},
};
use vti_voting_service::{AppState, config::CommunitiesConfig, identity::Identity, journal::FileJournal, router};

struct Elec {
    reg: Registrar,
    election: Election,
    digest: String,
    voter: Voter,
    ticket: Ticket,
}
struct Host {
    state: Arc<AppState>,
    community: Identity,
    elections: HashMap<String, Elec>,
    counter: u64,
    door: String,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}
type Shared = Arc<Mutex<Host>>;

fn bad(msg: impl Into<String>) -> Json<Value> { Json(json!({"error": msg.into()})) }
fn stamp(t: chrono::DateTime<Utc>) -> String { t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true) }
fn fresh_dir() -> std::path::PathBuf { std::env::temp_dir().join(format!("vti-ballot-host-{}", uuid::Uuid::new_v4())) }

fn make_state() -> Arc<AppState> {
    let dir = fresh_dir();
    let identity = Identity::load_or_mint(&dir).expect("the box's identity");
    let journal = Arc::new(FileJournal::open(&dir.join("journal")).expect("journal"));
    let restored = journal.load().expect("journal load");
    let bb = BallotBox::restore(&identity.did, journal, restored).expect("ballot box");
    Arc::new(AppState::new(bb, identity, vti_common::auth::TrustTaskVmResolver::did_key_only(), CommunitiesConfig::any()))
}

/// A request document at `version`, signed by `signer` when given.
async fn doc_at(task: &str, version: &str, to: &str, signer: Option<&Identity>, payload: Value, thread: Option<&str>) -> Value {
    let mut d = json!({
        "id": format!("urn:uuid:{}", uuid::Uuid::new_v4()),
        "type": format!("https://trusttasks.org/spec/voting/{task}/{version}#request"),
        "recipient": to,
        "issuedAt": stamp(Utc::now()),
        "payload": payload,
    });
    if let Some(t) = thread { d["threadId"] = json!(t); }
    if let Some(s) = signer {
        d["issuer"] = json!(s.did);
        let mut typed: TrustTask<Value> = serde_json::from_value(d).expect("a task");
        vta_sdk::trust_task_sign::sign_in_place_with(&mut typed, &s.key).await.expect("sign");
        return serde_json::to_value(&typed).expect("json");
    }
    d
}

async fn info(State(h): State<Shared>) -> Json<Value> {
    let g = h.lock().await;
    Json(json!({"door": g.door, "boxDid": g.state.identity.did, "communityDid": g.community.did}))
}

async fn election(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let mut g = h.lock().await;
    let id = req["electionId"].as_str().unwrap_or("e1").to_string();
    let registration = req["state"].as_str() == Some("registration");
    let revote = if req["revote"].as_str() == Some("replace") { "replace" } else { "refuse" };
    let box_did = g.state.identity.did.clone();
    let community = g.community.clone();
    let reg = Registrar::derive(&community.did, &[7u8; 32]).expect("registrar");
    let now = Utc::now();
    let (opens, closes) = if registration { (now + Duration::hours(2), now + Duration::days(2)) } else { (now - Duration::hours(1), now + Duration::days(1)) };
    let manifest = json!({
        "electionId": id, "community": community.did,
        "questions": [{ "key": "chair", "type": "choice", "options": [{ "key": "ana" }, { "key": "bo" }], "minSelections": 1, "maxSelections": 1, "optional": false }],
        "secrecy": "open", "roll": { "rule": "members" },
        "registrationOpensAt": stamp(now - Duration::days(2)), "votingOpensAt": stamp(opens), "votingClosesAt": stamp(closes),
        "revote": revote, "board": { "visibility": "public", "auditors": [] }, "ballotBox": box_did,
        "binding": false, "allowEarlyClose": true, "resultsBeforeClose": false, "textReleaseThreshold": 10
    });
    let digest = manifest_digest(&manifest).expect("digest");
    let register = json!({ "community": community.did, "manifest": manifest, "manifestDigest": digest_multibase(&digest), "parameters": { "suite": "ps-ddh-bls12381", "votingKey": reg.public_text().expect("key") } });
    let d = doc_at("election/register", "0.3", &box_did, Some(&community), register, None).await;
    let answer = vti_voting_service::dispatch::answer(&g.state, &serde_json::to_vec(&d).unwrap(), None).await;
    if answer.status.as_u16() != 200 { return Json(json!({"error": "register refused", "status": answer.status.as_u16(), "answer": answer.doc})); }
    let election = Election::new(&community.did, ElectionId::new(&id).expect("id"), digest).expect("election");
    g.counter += 1;
    let mut r = StdRng::seed_from_u64(1000 + g.counter);
    let params = reg.params();
    let voter = Voter::generate(&params, &mut r).expect("voter");
    let ticket = issue(&reg, &voter, &params, &election, &mut r);
    g.elections.insert(id, Elec { reg, election, digest: digest_multibase(&digest), voter, ticket });
    Json(json!({"ok": true, "state": if registration { "registration" } else { "voting" }}))
}

fn issue(reg: &Registrar, voter: &Voter, params: &vti_voting::scheme::VotingParams, election: &Election, r: &mut StdRng) -> Ticket {
    let (req, st) = voter.ticket_request(params, election, r).expect("ticket request");
    let pre = reg.issue_ticket(election, voter.id(), &req, r).expect("issue");
    voter.accept_ticket(params, election, &pre, &st).expect("accept")
}

async fn close(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let id = req["electionId"].as_str().unwrap_or("e1");
    let d = doc_at("election/close", "0.1", &g.state.identity.did, Some(&g.community), json!({"community": g.community.did, "electionId": id}), None).await;
    let a = vti_voting_service::dispatch::answer(&g.state, &serde_json::to_vec(&d).unwrap(), None).await;
    Json(json!({"status": a.status.as_u16(), "answer": a.doc}))
}

async fn cast(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let mut g = h.lock().await;
    let id = req["electionId"].as_str().unwrap_or("e1").to_string();
    let variant = req["variant"].as_str().unwrap_or("ok").to_string();
    let version = req["version"].as_str().unwrap_or("0.1").to_string();
    let thread = req["threadId"].as_str().map(str::to_string);
    let box_did = g.state.identity.did.clone();
    let community_did = g.community.did.clone();
    g.counter += 1;
    let mut r = StdRng::seed_from_u64(5000 + g.counter);
    let target = if variant == "unknownElection" { "e1".to_string() } else { id.clone() };
    let Some(e) = g.elections.get(&target) else { return bad(format!("election {target} is not registered")) };
    let params = e.reg.params();
    let shown = if variant == "unknownElection" { "no-such-election".to_string() } else { id.clone() };
    let answer = if variant == "second" { "bo" } else { "ana" };
    let mut ballot = json!({ "electionId": shown, "manifestDigest": e.digest, "answers": [{ "question": "chair", "choice": [answer] }] });
    if variant == "wrongDigest" { ballot["manifestDigest"] = json!(vti_voting::rules::digest_multibase(&[0x5au8; 32])); }
    if variant == "badAnswers" { ballot["answers"] = json!([{ "question": "no-such-question", "choice": ["ana"] }]); }
    let mut ticket: &Ticket = &e.ticket;
    let mut voter = &e.voter;
    let other_voter;
    let other_ticket;
    if variant == "wrongClass" {
        // a ticket for another election of the same community, under the same helper key: its class is not this election's
        let other = Election::new(&e.election.community().to_string(), ElectionId::new("another-election").expect("id"), *e.election.manifest_digest()).expect("election");
        other_voter = Voter::generate(&params, &mut r).expect("voter");
        other_ticket = issue(&e.reg, &other_voter, &params, &other, &mut r);
        ticket = &other_ticket;
        voter = &other_voter;
    }
    if variant == "forgedTicket" {
        // a ticket from a registrar the community does not use: the attestation verifies under no key this election registered
        let rogue = Registrar::derive(e.election.community(), &[9u8; 32]).expect("registrar");
        let rp = rogue.params();
        let rogue_voter = Voter::generate(&rp, &mut r).expect("voter");
        let rogue_ticket = issue(&rogue, &rogue_voter, &rp, &e.election, &mut r);
        let cast = rogue_voter.cast_wire(&rp, &rogue_ticket, &ballot, &mut r).expect("cast");
        return Json(json!({"document": one_time(&community_did, &box_did, &shown, &version, &thread, cast, false).await}));
    }
    let mut cast = voter.cast_wire(&params, ticket, &ballot, &mut r).expect("cast");
    if variant == "tamperedBallot" { cast["ballot"]["answers"] = json!([{ "question": "chair", "choice": ["bo"] }]); }
    Json(json!({"document": one_time(&community_did, &box_did, &shown, &version, &thread, cast, variant == "wrongRecipient").await}))
}

/// The cast document, signed by a key made for it alone (the one-time key).
async fn one_time(community: &str, box_did: &str, election: &str, version: &str, thread: &Option<String>, cast: Value, wrong_recipient: bool) -> Value {
    let mut seed = [0u8; 32];
    let u = uuid::Uuid::new_v4();
    seed[..16].copy_from_slice(u.as_bytes());
    seed[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    let key = Identity::from_seed(&seed).expect("one-time key");
    let to = if wrong_recipient { "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" } else { box_did };
    doc_at("ballot/cast", version, to, Some(&key), json!({ "community": community, "electionId": election, "cast": cast }), thread.as_deref()).await
}

async fn observe(State(h): State<Shared>, Json(req): Json<Value>) -> Json<Value> {
    let g = h.lock().await;
    let (mut casts, mut repl) = (0u64, 0u64);
    for id in g.elections.keys() {
        let payload = json!({"community": g.community.did, "electionId": id, "from": 0, "limit": 1000});
        let r = g.state.ballot_box.lock().expect("box").board_read(Caller::Did(&g.community.did), &payload, Utc::now());
        if let Ok(v) = r {
            for e in v["entries"].as_array().cloned().unwrap_or_default() {
                match e["entry"]["kind"].as_str() { Some("cast") => casts += 1, Some("replaced") => repl += 1, _ => {} }
            }
        }
    }
    match req["kind"].as_str() {
        Some("casts") => Json(json!({"value": casts})),
        Some("counted") => Json(json!({"value": casts.saturating_sub(repl)})),
        other => bad(format!("unknown kind {other:?}")),
    }
}

async fn reset(State(h): State<Shared>) -> Json<Value> {
    let mut g = h.lock().await;
    g.elections.clear();
    let dir = fresh_dir();
    let id = g.state.identity.clone();
    let journal = Arc::new(FileJournal::open(&dir.join("journal")).expect("journal"));
    let bb = BallotBox::restore(&id.did, journal, Default::default()).expect("ballot box");
    *g.state.ballot_box.lock().expect("box") = bb;
    Json(json!({"ok": true}))
}

async fn shutdown(State(h): State<Shared>) -> Json<Value> {
    if let Some(tx) = h.lock().await.stop.take() { let _ = tx.send(()); }
    Json(json!({"ok": true}))
}

#[tokio::main]
async fn main() {
    let state = make_state();
    let door_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind door");
    let door = format!("http://{}/trust-tasks", door_listener.local_addr().expect("addr"));
    let door_app = router(state.clone());
    tokio::spawn(async move { axum::serve(door_listener, door_app).await.expect("serve door") });
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let community = Identity::from_seed(&[0x31; 32]).expect("community identity");
    let host: Shared = Arc::new(Mutex::new(Host { state, community, elections: HashMap::new(), counter: 0, door: door.clone(), stop: Some(tx) }));
    let app = Router::new()
        .route("/ctl/info", post(info)).route("/ctl/election", post(election)).route("/ctl/close", post(close)).route("/ctl/cast", post(cast))
        .route("/ctl/observe", post(observe)).route("/ctl/reset", post(reset)).route("/ctl/shutdown", post(shutdown))
        .with_state(host.clone());
    let port = std::env::var("BALLOT_HOST_PORT").unwrap_or_else(|_| "0".to_string());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.expect("bind control");
    println!("{}", json!({"control": format!("http://{}", listener.local_addr().expect("addr")), "door": door}));
    axum::serve(listener, app).with_graceful_shutdown(async move { let _ = rx.await; }).await.expect("serve");
}
