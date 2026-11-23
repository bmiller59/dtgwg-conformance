// SPDX-License-Identifier: Apache-2.0
// The community's VTA as a stand-in (docs/32, class D), the way VTI's own community-rooms tests do it (`vtc-service/tests/it/community_rooms.rs`, `FakeVta`):
// a `VtaChannel` that keeps a real room key and signs the room's membership, authority and invitation credentials as a real VTA would, so the
// credentials an offer hands a member are ones this community, as the room's host, then verifies with its own code. It runs no MLS: on a sealed tier a
// Welcome is an opaque token, which is all the community ever sees of one. Everything the host serves is VTI's own handler; only the community's
// key holder (which needs a messaging link to a VTA, not hosted here) is this stand-in. Written for the host from that test double; not a VTI change.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use dtg_credentials::{DTGCredential, IssuerScope};
use serde_json::{Value, json};
use trust_tasks_rs::TrustTask;
use vti_rooms_dtg::test_support::Party;
use vtc_service::rooms::vta_storage::{PeerError, VtaChannel};

const MINT: &str = "https://trusttasks.org/spec/vta/webvh/dids/create/1.2";
const GROUP_CREATE: &str = "https://trusttasks.org/spec/rooms/owner/group/create/0.1";
const GROUP_ADD: &str = "https://trusttasks.org/spec/rooms/owner/group/add/0.3";
const GROUP_REMOVE: &str = "https://trusttasks.org/spec/rooms/owner/group/remove/0.4";
const INVITE: &str = "https://trusttasks.org/spec/rooms/owner/invite/0.1";
const ISSUE_MEMBERSHIP: &str = "https://trusttasks.org/spec/rooms/owner/issue-membership/0.1";
const ISSUE_AUTHORITY: &str = "https://trusttasks.org/spec/rooms/owner/issue-authority/0.2";
const RECEIVE: &str = "https://trusttasks.org/spec/vault/credentials/receive/0.1";
const PROFILE_READ: &str = "https://trusttasks.org/spec/rooms/keys/profile/read/0.1";
const PROFILE_WRITE: &str = "https://trusttasks.org/spec/rooms/keys/profile/write/0.1";
const DID_DELETE: &str = "https://trusttasks.org/spec/vta/webvh/dids/delete/1.0";

#[derive(Default)]
struct State {
    rooms: HashMap<String, Party>,
    groups: HashMap<String, (Vec<String>, u64)>,
    profiles: HashMap<String, Value>,
    admitted: HashMap<String, (String, String, u64, String)>,
}

pub struct StandInVta {
    community_did: String,
    st: Mutex<State>,
}

impl StandInVta {
    pub fn new(community_did: &str) -> Arc<Self> {
        Arc::new(Self { community_did: community_did.to_string(), st: Mutex::new(State::default()) })
    }

    fn room_key(&self, room: &str) -> Option<Party> {
        let st = self.st.lock().unwrap();
        st.rooms.get(room).map(|p| Party { did: p.did.clone(), secret_multibase: p.secret_multibase.clone(), secret: p.secret.clone() })
    }

    async fn credential(room: &Party, kind: &str, subject: &str, payload: &Value) -> Result<String, (&'static str, String)> {
        let now = Utc::now();
        let from = now - chrono::Duration::minutes(1);
        let until = payload["validUntil"]
            .as_str()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .map(|v| v.with_timezone(&Utc))
            .unwrap_or(now + chrono::Duration::days(30));
        let mut c = match kind {
            "membership" => DTGCredential::new_vmc(room.did.clone(), subject.to_string(), from, Some(until), false),
            "authority" => {
                let actions: Vec<String> = payload["actions"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
                DTGCredential::new_vac(room.did.clone(), IssuerScope::Public, subject.to_string(), room.did.clone(), actions, from, until)
                    .map_err(|e| ("taskFailed", e.to_string()))?
            }
            _ => DTGCredential::new_vic(room.did.clone(), IssuerScope::Public, subject.to_string(), from, Some(until)),
        };
        c.sign(&room.secret, None).await.map_err(|e| ("taskFailed", e.to_string()))?;
        serde_json::to_string(&c).map_err(|e| ("taskFailed", e.to_string()))
    }

    async fn serve(&self, type_uri: &str, p: &Value) -> Result<Value, (&'static str, String)> {
        match type_uri {
            PROFILE_READ => {
                let room = p["roomId"].as_str().unwrap_or_default().to_string();
                let profile = self.st.lock().unwrap().profiles.get(&room).cloned();
                Ok(match profile {
                    Some(profile) => json!({"roomId": room, "status": "found", "profile": profile, "author": self.community_did, "issuedAt": "2026-10-16T09:00:00Z", "epoch": 1, "version": 3, "stale": false,
                        "searched": {"fromEpoch": 1, "toEpoch": 1}, "verification": {"trace": "verified", "priorRoots": "noneHeld"}}),
                    None => json!({"roomId": room, "status": "absent"}),
                })
            }
            PROFILE_WRITE => {
                let room = p["roomId"].as_str().unwrap_or_default().to_string();
                self.st.lock().unwrap().profiles.insert(room.clone(), p["profile"].clone());
                Ok(json!({"roomId": room, "outcome": "written", "key": "Qm4c8XkR2pVt7sLw0aJbYg", "version": 4, "epoch": 1}))
            }
            MINT => {
                let room = Party::new();
                let did = room.did.clone();
                self.st.lock().unwrap().rooms.insert(did.clone(), room);
                Ok(json!({"did": did, "contextId": p["contextId"], "scid": "QmScid", "portable": true, "signingKeyId": format!("{did}#key-1"), "kaKeyId": format!("{did}#key-2"),
                    "preRotationKeyCount": 0, "createdAt": Utc::now().to_rfc3339(), "serverId": p["serverId"]}))
            }
            GROUP_CREATE => {
                let room = p["roomId"].as_str().unwrap_or_default().to_string();
                let member = p["member"].as_str().unwrap_or_default().to_string();
                self.st.lock().unwrap().groups.insert(room.clone(), (vec![member], 1));
                Ok(json!({"roomId": room, "epoch": 1}))
            }
            ISSUE_MEMBERSHIP | ISSUE_AUTHORITY | INVITE => {
                let room = self.room_key(p["roomId"].as_str().unwrap_or_default()).ok_or(("taskFailed", "no such room here".to_string()))?;
                let subject = p["subject"].as_str().unwrap_or_default();
                let kind = match type_uri { ISSUE_MEMBERSHIP => "membership", ISSUE_AUTHORITY => "authority", _ => "invitation" };
                let credential = Self::credential(&room, kind, subject, p).await?;
                Ok(json!({"credential": credential, "credentialId": format!("urn:uuid:{}", uuid::Uuid::new_v4())}))
            }
            RECEIVE => Ok(json!({"id": format!("urn:uuid:{}", uuid::Uuid::new_v4()), "types": ["VerifiableCredential"], "status": "valid"})),
            GROUP_ADD => {
                let room = p["roomId"].as_str().unwrap_or_default().to_string();
                let member = p["member"].as_str().unwrap_or_default().to_string();
                let key_package = p["keyPackage"].as_str().unwrap_or_default().to_string();
                let mut st = self.st.lock().unwrap();
                let kept = st.admitted.get(&room).cloned();
                let group = st.groups.get_mut(&room).ok_or(("taskFailed", "no group".to_string()))?;
                if group.0.contains(&member) {
                    return match kept {
                        Some((m, kp, epoch, welcome)) if m == member && kp == key_package => Ok(json!({"roomId": room, "member": member, "epoch": epoch, "welcome": welcome})),
                        _ => Err(("rooms/owner/group/add:alreadyMember", "already has a leaf".into())),
                    };
                }
                group.0.push(member.clone());
                group.1 += 1;
                let (epoch, welcome) = (group.1, format!("V2VsY29tZQ-{}", group.1));
                st.admitted.insert(room.clone(), (member.clone(), key_package, epoch, welcome.clone()));
                Ok(json!({"roomId": room, "member": member, "epoch": epoch, "welcome": welcome}))
            }
            GROUP_REMOVE => {
                let room = p["roomId"].as_str().unwrap_or_default().to_string();
                let member = p["member"].as_str().unwrap_or_default().to_string();
                let mut st = self.st.lock().unwrap();
                let group = st.groups.get_mut(&room).ok_or(("taskFailed", "no group".to_string()))?;
                let Some(at) = group.0.iter().position(|m| *m == member) else { return Err(("rooms/owner/group/remove:notMember", "no leaf".into())) };
                group.0.remove(at);
                group.1 += 1;
                let epoch = group.1;
                st.admitted.remove(&room);
                Ok(json!({"roomId": room, "member": member, "withdrawn": false, "epoch": epoch}))
            }
            DID_DELETE => {
                let did = p["did"].as_str().unwrap_or_default().to_string();
                self.st.lock().unwrap().rooms.remove(&did);
                Ok(json!({"did": did, "deleted": true}))
            }
            other => Err(("unsupportedType", format!("{other} is not served by the stand-in"))),
        }
    }
}

fn reply(community_did: &str, type_uri: &str, payload: Value) -> TrustTask<Value> {
    serde_json::from_value(json!({
        "id": format!("urn:uuid:{}", uuid::Uuid::new_v4()),
        "type": type_uri,
        "threadId": "urn:uuid:00000000-0000-4000-8000-000000000001",
        "issuer": "did:example:community-vta",
        "recipient": community_did,
        "issuedAt": Utc::now().to_rfc3339(),
        "payload": payload,
    }))
    .expect("a Trust Task")
}

#[async_trait]
impl VtaChannel for StandInVta {
    async fn exchange(&self, type_uri: &str, payload: &Value, _timeout: Duration) -> Result<TrustTask<Value>, PeerError> {
        Ok(match self.serve(type_uri, payload).await {
            Ok(answer) => reply(&self.community_did, &format!("{type_uri}#response"), answer),
            Err((code, message)) => reply(&self.community_did, "https://trusttasks.org/spec/trust-task-error/0.5", json!({"code": code, "message": message})),
        })
    }
}
