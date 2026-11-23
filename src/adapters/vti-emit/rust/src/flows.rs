// The Type URIs (without the registry base) whose payload VTI's own client builds, and the client method that builds each. The
// client builds the version it serves only; older versions are not named by any client method (reported as such by the adapter).
use super::{Ctx, Flow, Fut, Samples};
use std::sync::Arc;
use vta_sdk::client::{UpdateAclRequest, SwapAclRequest, CreateDidWebvhRequest, DidPresentation, VtaClient, DidListFilter, ChangeAclRoleRequest, CreateAclRequest, CreateContextRequest, CreateKeyRequest, ImportKeyRequest, RevokeSessions};
use vta_sdk::protocols::did_management::update::RotateDidWebvhKeysBody;
use vta_sdk::acl::ContextDirection;
use vta_sdk::keys::KeyType;
use vta_sdk::protocols::key_management::sign::SignAlgorithm;
fn pl<T: serde::de::DeserializeOwned>(s: &Samples, t: &str) -> T { serde_json::from_value(s.get(t)).expect("sample payload deserialises") }
const COMMUNITY: &str = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const B58: &str = "z3FoSampXpQ";
const APP: &str = "urn:uuid:00000000-0000-4000-8000-000000000002";
const DIGEST: &str = "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA";
fn params() -> serde_json::Value { serde_json::json!({"suite": "ps-ddh-bls12381", "helperKey": "zHelperKeySample", "tokenKey": "zTokenKeySample", "vetterLabels": ["vetter/2026-11"], "tokenLabels": ["token-1"], "dripPerTick": 3, "tickLength": "P3D", "events": []}) }
fn meta_tok() -> serde_json::Value { let mut m = meta(); m["tokenLabel"] = serde_json::json!("token-1"); m["tokenSerial"] = serde_json::json!(B58); m }
fn meta() -> serde_json::Value { serde_json::json!({"community": COMMUNITY, "requirementsDigest": DIGEST, "method": "inPerson", "claimsVerified": ["name"], "livenessConfirmed": true, "declaredRelationship": "none", "identityCommitment": B58, "cardDigestMultibase": B58, "validFrom": "2026-11-12", "validUntil": "2026-11-13"}) }
/// A string member of the registry's sample payload for a type, or a fixed placeholder when the sample has none.
fn sv_or(s: &Samples, t: &str, k: &str, d: &str) -> String { s.get(t)[k].as_str().unwrap_or(d).to_string() }
/// A 43-character base64url identifier, the pattern rooms/keys/file-key/0.2 gives `fileId` (the registry sample holds a placeholder that is not one).
const FILE_ID: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
fn sv(s: &Samples, t: &str, k: &str) -> String { s.get(t)[k].as_str().unwrap_or("sample").to_string() }
const DID: &str = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const ROLE_FROM: &str = "role-a";
const ROLE_TO: &str = "role-b";
pub fn table() -> Vec<(&'static str, &'static str, Option<&'static str>, Flow)> {
let mut v: Vec<(&'static str, &'static str, Option<&'static str>, Flow)> = Vec::new();
flows! { v;
  "acl/list/0.4", "list_acl_in_direction", None, |c, _s| c.list_acl_in_direction(None, ContextDirection::default());
  "acl/show/0.3", "get_acl", None, |c, _s| c.get_acl(DID);
  "acl/grant/0.3", "create_acl", Some("CreateAclRequest::new fixes entry.act scope none, approve scope none, capabilities scope ceiling and keys scope all; the role value is the harness placeholder, not a VTI choice"), |c, _s| c.create_acl(CreateAclRequest::new(DID, ROLE_FROM));
  "acl/change-role/0.3", "change_acl_role", None, |c, _s| c.change_acl_role(DID, ChangeAclRoleRequest { from_role: ROLE_FROM.into(), to_role: ROLE_TO.into(), reason: None });
  "acl/update/0.3", "update_acl", None, |c, _s| c.update_acl(DID, UpdateAclRequest { label: Some("Sample".into()), allowed_contexts: None, step_up_approver: None, step_up_require: None, approve_scope: None, allowed_keys: None, capabilities: None, purposes: None });
  "acl/swap-key/0.1", "swap_acl_for", None, |c, _s| c.swap_acl_for(DID, SwapAclRequest::new("eyJhbGciOiJFZERTQSJ9.eyJpc3MiOiJkaWQ6a2V5OnNhbXBsZSJ9.c2ln"));
  "keys/sign-jws/0.1", "sign_jws", None, |c, _s| c.sign_jws("sample-key", serde_json::Map::new(), serde_json::Map::from_iter([("sample".to_string(), serde_json::json!(1))]));
  "keys/sign-document/0.1", "sign_document", None, |c, _s| c.sign_document("sample-key", serde_json::json!({"hello": "world"}), None);
  "keys/sign-csr/0.1", "sign_csr", None, |c, _s| c.sign_csr("sample-key", vec![serde_json::from_value(serde_json::json!({"type": "CN", "value": "sample"})).expect("rdn")], None);
  "keys/import-wrapping-key/0.1", "get_wrapping_key", None, |c, _s| c.get_wrapping_key();
  "acl/revoke/0.3", "delete_acl", None, |c, _s| c.delete_acl(DID);
  "device/register/0.2", "device_register", None, |c, s| c.device_register(s.get("device/register/0.2")["consumerKind"].clone(), "Sample device", Some("ios"), None);
  "device/heartbeat/0.3", "device_heartbeat_named", None, |c, _s| c.device_heartbeat_named(Some("ios"), Some("Sample device"));
  "device/list/0.3", "device_list", None, |c, _s| c.device_list(serde_json::json!({}));
  "device/disable/0.1", "device_disable", None, |c, _s| c.device_disable("dev_Sample0123456789");
  "device/wipe/0.2", "device_wipe", None, |c, s| c.device_wipe("dev_Sample0123456789", "sample reason", s.get("device/wipe/0.2")["scope"].as_str().unwrap_or("all"));
  "device/set-wake/0.2", "device_set_wake", None, |c, _s| c.device_set_wake("apns", "sample-handle", vec![]);
  "vta/contexts/list/1.0", "list_contexts", None, |c, _s| c.list_contexts();
  "vta/contexts/create/1.0", "create_context", None, |c, _s| c.create_context(CreateContextRequest::new("sample-ctx", "Sample context"));
  "keys/create/0.1", "create_key", None, |c, _s| c.create_key(CreateKeyRequest::new(KeyType::Ed25519));
  "keys/import/0.1", "import_key", None, |c, _s| c.import_key(ImportKeyRequest { key_type: KeyType::Ed25519, private_key_sealed: Some("-----BEGIN SAMPLE SEALED BUNDLE-----".into()), private_key_jwe: None, private_key_multibase: None, label: None, context_id: None });
  "keys/list/0.2", "list_keys", None, |c, _s| c.list_keys(None, 10, None, None);
  "keys/show/0.1", "get_key", None, |c, _s| c.get_key("sample-key");
  "keys/export-secret/0.1", "get_key_secret", None, |c, _s| c.get_key_secret("sample-key");
  "keys/sign/0.1", "sign", None, |c, _s| c.sign("sample-key", b"sample payload", SignAlgorithm::EdDSA);
  "keys/derive-and-sign/0.1", "derive_and_sign", None, |c, _s| c.derive_and_sign(KeyType::Ed25519, "m/44'/0'/0'", b"sample payload", SignAlgorithm::EdDSA);
  "keys/derive-and-sign-document/0.1", "derive_and_sign_document", None, |c, _s| c.derive_and_sign_document(KeyType::Ed25519, "m/44'/0'/0'", serde_json::json!({"hello": "world"}), None);
  "keys/revoke/0.1", "invalidate_key", None, |c, _s| c.invalidate_key("sample-key");
  "keys/rename/0.1", "rename_key", None, |c, _s| c.rename_key("sample-key", "sample-key-2");
  "keys/set-exportability/0.1", "set_key_exportability", None, |c, _s| c.set_key_exportability("sample-key", true);
  "auth/sessions/list/0.1", "list_my_sessions", None, |c, _s| c.list_my_sessions();
  "auth/whoami/0.1", "check_auth", None, |c, _s| c.check_auth();
  "auth/revoke-session/0.2", "revoke_sessions", None, |c, _s| c.revoke_sessions(RevokeSessions::AllMine, Some("sample reason"));
  "config/show/0.1", "get_config", None, |c, _s| c.get_config();
  "vault/list/0.4", "vault_list", None, |c, _s| c.vault_list(serde_json::json!({}));
  "vault/get/0.3", "vault_get", None, |c, _s| c.vault_get("dir_Sample0123456789");
  "vault/upsert/0.4", "vault_upsert", None, |c, s| c.vault_upsert(s.get("vault/upsert/0.4"), None);
  "vault/delete/0.1", "vault_delete", None, |c, _s| c.vault_delete("dir_Sample0123456789", None, false, None);
  "vault/release/0.2", "vault_release", None, |c, s| c.vault_release(s.get("vault/release/0.2"));
  "vault/proxy-login/0.2", "vault_proxy_login", None, |c, s| c.vault_proxy_login(s.get("vault/proxy-login/0.2"));
  "vault/sign-trust-task/0.2", "vault_sign_trust_task", None, |c, s| c.vault_sign_trust_task(s.get("vault/sign-trust-task/0.2"));
  "vault/credentials/receive/0.1", "cred_vault_receive", None, |c, s| c.cred_vault_receive(serde_json::json!({"type": ["VerifiableCredential"], "id": "urn:uuid:sample-credential"}), None);
  "vault/credentials/query/0.1", "cred_vault_query", None, |c, _s| c.cred_vault_query(serde_json::json!({}));
  "vault/credentials/get/0.2", "cred_vault_get", None, |c, _s| c.cred_vault_get("example");
  "vault/credentials/present/0.1", "cred_vault_present", None, |c, s| c.cred_vault_present(&pl(&s, "vault/credentials/present/0.1"));
  "vault/credentials/archive/0.1", "cred_vault_archive", None, |c, _s| c.cred_vault_archive("example", None);
  "vault/credentials/unarchive/0.1", "cred_vault_unarchive", None, |c, _s| c.cred_vault_unarchive("example", None);
  "vault/credentials/delete/0.1", "cred_vault_delete", None, |c, _s| c.cred_vault_delete("example", false, None);
  "vault/credentials/restore/0.1", "cred_vault_restore", None, |c, _s| c.cred_vault_restore("example", None);
  "vault/credentials/purge/0.1", "cred_vault_purge", None, |c, _s| c.cred_vault_purge("example", None);
  "policy/get/0.1", "get_policy", None, |c, _s| c.get_policy("sample-policy");
  "policy/list/0.3", "list_policies", None, |c, s| c.list_policies(pl(&s, "policy/list/0.3"));
  "policy/upsert/0.3", "upsert_policy", None, |c, s| c.upsert_policy(pl(&s, "policy/upsert/0.3"));
  "policy/delete/0.1", "delete_policy", None, |c, s| c.delete_policy(pl(&s, "policy/delete/0.1"));
  "vta/webvh/servers/list/1.0", "list_webvh_servers", None, |c, _s| c.list_webvh_servers();
  "vta/webvh/dids/create/1.2", "create_did_webvh_presented", None, |c, _s| c.create_did_webvh_presented(CreateDidWebvhRequest { context_id: "sample-ctx".into(), server_id: None, url: None, path: None, path_mode: None, domain: None, label: None, portable: false, add_mediator_service: false, add_tsp_service: false, additional_services: None, pre_rotation_count: 0, did_document: None, did_log: None, set_primary: false, signing_key_id: None, ka_key_id: None, template: None, template_context: None, template_vars: Default::default() }, DidPresentation::default());
  "vta/webvh/dids/rotate-keys/1.0", "rotate_did_webvh_keys_by_did", None, |c, _s| c.rotate_did_webvh_keys_by_did("did:webvh:sample:example.com", RotateDidWebvhKeysBody::default());
  "vta/dids/list/0.1", "list_dids", None, |c, _s| c.list_dids(&DidListFilter { methods: Some(vec!["webvh".to_string()]), ..Default::default() });
  "vta/pcs/applications/create/0.1", "pcs_applications_create", None, |c, s| c.pcs_applications_create(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"joinDid":DID,"parameters":params()})).expect("pcs sample"));
  "vta/pcs/applications/show/0.1", "pcs_applications_show", None, |c, s| c.pcs_applications_show(&pl(&s, "vta/pcs/applications/show/0.1"));
  "vta/pcs/applications/delete/0.1", "pcs_applications_delete", None, |c, s| c.pcs_applications_delete(&pl(&s, "vta/pcs/applications/delete/0.1"));
  "vta/pcs/verify-attestation/0.1", "pcs_verify_attestation", None, |c, s| c.pcs_verify_attestation(&serde_json::from_value(serde_json::json!({"applicationId":APP,"parameters":params(),"attestation":{"suite":"ps-ddh-bls12381","attestation":B58,"meta":meta_tok(),"token":{"label":"token-1","serial":B58,"shown":B58}}})).expect("pcs sample"));
  "vta/pcs/prove/0.1", "pcs_prove", None, |c, s| c.pcs_prove(&serde_json::from_value(serde_json::json!({"applicationId":APP,"parameters":params(),"requirementsDigest":DIGEST,"challenge":"sample-challenge-0123456789"})).expect("pcs sample"));
  "vta/pcs/root-request/0.1", "pcs_root_request", None, |c, s| c.pcs_root_request(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"memberDid":DID,"parameters":params(),"label":"vetter/2026-11"})).expect("pcs sample"));
  "vta/pcs/root-accept/0.1", "pcs_root_accept", None, |c, s| c.pcs_root_accept(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"parameters":params(),"response":{"label":"vetter/2026-11","preCredential":B58}})).expect("pcs sample"));
  "vta/pcs/tokens/request/0.1", "pcs_tokens_request", None, |c, s| c.pcs_tokens_request(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"parameters":params(),"label":"vetter/2026-11","tick":1,"count":1})).expect("pcs sample"));
  "vta/pcs/tokens/accept/0.1", "pcs_tokens_accept", None, |c, s| c.pcs_tokens_accept(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"parameters":params(),"response":{"label":"vetter/2026-11","tick":1,"preCredentials":[B58]}})).expect("pcs sample"));
  "vta/pcs/tokens/abandon/0.1", "pcs_tokens_abandon", None, |c, s| c.pcs_tokens_abandon(&pl(&s, "vta/pcs/tokens/abandon/0.1"));
  "vta/pcs/attest/0.1", "pcs_attest", None, |c, s| c.pcs_attest(&serde_json::from_value(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"parameters":params(),"applicantId":B58,"meta":meta()})).expect("pcs sample"));
  "vta/pcs/vetter/show/0.1", "pcs_vetter_show", None, |c, s| c.pcs_vetter_show(&pl(&s, "vta/pcs/vetter/show/0.1"));
}
vflows! { v;
  "vtc/members/renew/0.1", "VtcClient::renew", None, |c, _s| c.renew();
  "audit/verify/0.1", "VtcClient::audit_verify", None, |c, _s| c.audit_verify();
  "task-consent/decision/0.2", "VtcClient::decide_task_consent", None, |c, s| c.decide_task_consent(&pl(&s, "task-consent/decision/0.2"));
  "vtc/join-requests/submit/0.3", "VtcClient::submit_join", None, |c, _s| { let body: vta_sdk::protocols::join_requests::JoinRequestSubmitBody = serde_json::from_value(serde_json::json!({"vp": {"@context": ["https://www.w3.org/ns/credentials/v2"], "type": ["VerifiablePresentation"], "verifiableCredential": []}})).expect("submit body"); let (did, key) = super::did_key(0x44); async move { c.submit_join(&body, &did, &key).await } };
}
flows! { v;
  "vta/contexts/get/1.0", "get_context", None, |c, s| c.get_context(&sv(&s, "vta/contexts/get/1.0", "id"));
  "vta/webvh/dids/delete/1.0", "delete_did_webvh", None, |c, _s| c.delete_did_webvh(DID);
  "rooms/keys/file-key/0.2", "room_file_key", None, |c, s| c.room_file_key(&sv(&s, "rooms/keys/file-key/0.2", "roomId"), &sv_or(&s, "rooms/keys/file-key/0.2", "fileId", FILE_ID), None);
  "rooms/keys/key-package/0.2", "room_key_package", None, |c, s| c.room_key_package(&sv(&s, "rooms/keys/key-package/0.2", "roomId"), &sv(&s, "rooms/keys/key-package/0.2", "invitation"));
  "rooms/keys/welcome/0.1", "room_welcome", None, |c, s| c.room_welcome(&sv(&s, "rooms/keys/welcome/0.1", "roomId"), &sv(&s, "rooms/keys/welcome/0.1", "invitation"), &sv(&s, "rooms/keys/welcome/0.1", "welcome"), None);
  "rooms/keys/backfill/0.2", "room_backfill", None, |c, s| c.room_backfill(&sv(&s, "rooms/keys/backfill/0.2", "roomId"), &sv(&s, "rooms/keys/backfill/0.2", "host"), None);
  "rooms/keys/list/0.2", "room_list", None, |c, _s| c.room_list(false);
  "rooms/keys/present/0.2", "room_present", None, |c, s| c.room_present(&sv(&s, "rooms/keys/present/0.2", "roomId"), &sv(&s, "rooms/keys/present/0.2", "action"));
  "rooms/keys/seal/0.2", "room_seal", None, |c, s| c.room_seal(&sv(&s, "rooms/keys/seal/0.2", "roomId"), &sv(&s, "rooms/keys/seal/0.2", "key"), 1, b"sample");
  "vta/pcs/voter/register/0.5", "pcs_voter_register_json", None, |c, s| c.pcs_voter_register_json(s.get("vta/pcs/voter/register/0.5"));
  "vta/pcs/voter/accept/0.1", "pcs_voter_accept_json", None, |c, s| c.pcs_voter_accept_json(serde_json::json!({"contextId":"sample-context","community":COMMUNITY,"electionId":"election-1","parameters":{"suite":"ps-ddh-bls12381","votingKey":B58},"response":{"electionId":"election-1","label":"voter/election-1","preCredential":B58}}));
  "vta/pcs/vote/0.4", "pcs_vote_json", None, |c, s| c.pcs_vote_json(s.get("vta/pcs/vote/0.4"));
  "vta/pcs/voter/receipt/0.1", "pcs_voter_receipt_json", None, |c, s| c.pcs_voter_receipt_json(s.get("vta/pcs/voter/receipt/0.1"));
}
vflows! { v;
  "vtc/join-requests/decide/0.1", "VtcClient::approve_join", None, |c, _s| c.approve_join("urn:uuid:00000000-0000-4000-8000-000000000003");
}
v
}
