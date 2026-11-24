// SPDX-License-Identifier: Apache-2.0
// Authoring source of the paired ceremony groups (docs/26): a member's wallet (keyring-wallet, `K`) against the service of the pair (VTI's VTA in
// process, `V`; for the sign-in also the community service and a starter). Imported by scripts/generate-ceremony-scenarios.ts, which writes the files.
// Every step cites the Trust Tasks specification of the document it sends (tfRef, hashes). The choreography around the tasks is the suite's own
// proposal (channel `proposed`, docs/25 section 6); the result of a run is evidence of kind complete-ceremony, never a conformance count.
import { didKeyFromEd25519, ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import { signDocument } from "../src/crypto/proof.ts";
import { loadPins, pinFor, withSpecHashes } from "../src/vectors/source.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";

const pins = loadPins();
export function src(slug: string, version: string): VectorSource {
  // the pinned package (which carries a digest) when it holds this version, else the task-force checkout
  const pkg = `pkg:@openvtc/trust-tasks@0.29.0#https://trusttasks.org/spec/${slug}/${version}`;
  const ref = pinFor(pkg, pins) === null ? `kit:specs/${slug}/${version}` : pkg;
  const tfRef = tfRefFor(ref);
  if (tfRef === null) throw new Error(`no Trust Tasks reference for ${ref}`);
  return withSpecHashes({
    slug, version, channel: "proposed", profile: "ceremony-scenarios", ref, pinnedDigest: pinFor(ref, pins), tfRef,
    note: "Ceremony scenario step (docs/26): the task is a Trust Tasks specification (tfRef, status draft); the choreography around it is a suite proposal and advisory. The result of running it is evidence of kind complete-ceremony, never a conformance result.",
  });
}

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
/** The did:key of a fixed seed: the subjects and keys the scenarios name (a stand-in third party, the successor key of a swap). */
const didOf = (seed: number): string => ed25519Signer(seedOf(seed)).did;
export const SUBJECT = didOf(0x91);
export const SUBJECT_2 = didOf(0x92);
/** Class D: the successor key the wallet adapter's stand-in key creator hands the wallet for `acl/swap-key` (seed 0x4f, kw-host.jest.ts). */
export const SUCCESSOR = didOf(0x4f);

const K_REQ = ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"];
const kv = (role: string, extra: string[] = []) => ({ K: { role: "member-phone", requires: K_REQ }, V: { role, requires: extra } });
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[], extra: Partial<ScenarioStep["do"]["initiate"]> = {}): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }), ...extra } }, expect });
const decideV = (id: string, action: string, args: Record<string, unknown>): ScenarioStep => step({ id, do: { decide: { by: "V", action, args } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const subjectIs = (did: string, n: number): Check => ({ at: "V", stored: { kind: `acl-subject:${did}`, count: n } });

const base = {
  carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000,
  /** The wallet's own reading of its ceremony decides how it ended; the service's state is checked by the assertions (the VTA reports no ceremony state of its own). */
  reads: ["K"],
};

// ======================================================================================================================================== FC-ACL
const aclSrc = { list: src("acl/list", "0.4"), grant: src("acl/grant", "0.3"), update: src("acl/update", "0.3"), revoke: src("acl/revoke", "0.3"), swap: src("acl/swap-key", "0.1") };
const AG = "TF specs/acl/grant/0.3/spec.md", AR = "TF specs/acl/revoke/0.3/spec.md", AU = "TF specs/acl/update/0.3/spec.md", AL = "TF specs/acl/list/0.4/spec.md", AS = "TF specs/acl/swap-key/0.1/spec.md";
const aclRequires = [`${S}acl/list/0.4`, `${S}acl/grant/0.3`, `${S}acl/update/0.3`, `${S}acl/revoke/0.3`];
const aclBase = { ...base, participants: kv("agent", aclRequires) };
const aclDone = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const aclRefused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });

const aclLifecycle: Scenario = {
  id: "FC-ACL-001", title: "the member's wallet, an admin manager of the agent, lists the access list, grants a second subject, relabels it and revokes it: the agent's list shows the row after the grant and the new label, and omits it after the revoke",
  spec: [`${AG} (the granting authority adds the subject; the response echoes the entry)`, `${AU} (label replaced on an existing entry)`, `${AR} (a removal; the subject loses its authority at its next decision)`, `${AL} (read-only enumeration)`, "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    init("list-before", aclSrc.list, "acl-list", undefined, [kdone("completed"), subjectIs(SUBJECT, 0)]),
    init("grant", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Second device" }, [kdone("completed"), subjectIs(SUBJECT, 1)]),
    init("list-after-grant", aclSrc.list, "acl-list", undefined, [kdone("completed")]),
    init("update", aclSrc.update, "acl-update", { subject: SUBJECT, label: "Renamed device" }, [kdone("completed"), { at: "V", stored: { kind: `acl-label:${SUBJECT}|Renamed device`, count: 1 } }]),
    init("revoke", aclSrc.revoke, "acl-revoke", { subject: SUBJECT }, [kdone("completed"), subjectIs(SUBJECT, 0)]),
    init("list-after-revoke", aclSrc.list, "acl-list", undefined, [kdone("completed"), { at: "V", stored: { kind: "acl-entry", count: 0 } }]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 0)]),
};
const aclNonAdmin: Scenario = {
  id: "FC-ACL-002", title: "a manager whose role on the agent is not admin asks to grant a subject: the agent refuses it and the access list is unchanged",
  spec: [`${AG} (the granting authority must hold the authority it delegates; a grant past it is refused)`, "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    decideV("demote", "actorRole", { vid: "$K", role: "monitor" }),
    init("grant-by-monitor", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Should not exist" }, [kdone("refused"), subjectIs(SUBJECT, 0)]),
  ],
  allowedTerminals: ["refused"], completion: aclRefused([subjectIs(SUBJECT, 0), { at: "V", stored: { kind: "acl-entry", count: 0 } }]),
};
const aclUnknownRevoke: Scenario = {
  id: "FC-ACL-003", title: "revoking a subject that is not on the access list is refused with acl/revoke:subjectNotPresent and changes nothing",
  spec: [`${AR} (errorCodes: acl/revoke:subjectNotPresent)`, "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.revoke, ...aclBase,
  steps: [init("revoke-unknown", aclSrc.revoke, "acl-revoke", { subject: SUBJECT_2 }, [{ at: "K", received: { code: "acl/revoke:subjectNotPresent", count: 1 } }, kdone("refused")])],
  allowedTerminals: ["refused"], completion: aclRefused([{ at: "V", stored: { kind: "acl-entry", count: 0 } }]),
};
const aclTwice: Scenario = {
  id: "FC-ACL-004", title: "granting a subject that already holds the same entry again is an idempotent re-assertion: the agent answers it and there is still exactly one entry for the subject",
  spec: [`${AG} (consumer step 6: where the subject already exists with the same role, the grant is an idempotent re-assertion; the task is idempotent: an identical grant against an unchanged ACL produces no state change)`, "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    init("grant", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "First" }, [kdone("completed"), subjectIs(SUBJECT, 1)]),
    init("grant-again", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "First" }, [kdone("completed"), subjectIs(SUBJECT, 1), { at: "V", stored: { kind: "acl-entry", count: 1 } }]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 1)]),
};
const aclReplaySame: Scenario = {
  id: "FC-ACL-005", title: "the wallet's signed grant is delivered again unchanged after the subject was revoked: the agent does not re-admit the subject (the duplicate id is not executed twice)",
  spec: [`${AG} (issuedAt REQUIRED: a replayed grant re-admits a subject that has since been revoked; only the duplicate-execution record stops it)`, "SPEC.md 7.2 item 11 (a repeated id is not executed twice)", "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    init("grant", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Once" }, [kdone("completed"), subjectIs(SUBJECT, 1)]),
    init("revoke", aclSrc.revoke, "acl-revoke", { subject: SUBJECT }, [kdone("completed"), subjectIs(SUBJECT, 0)]),
    step({ id: "replay-grant", source: aclSrc.grant, do: { replay: { step: "grant", by: "K", to: "V", mode: "same" } }, expect: [subjectIs(SUBJECT, 0)] }),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 0)]),
};
const aclTamper: Scenario = {
  id: "FC-ACL-006", title: "the wallet's signed grant with a payload value changed after signing (under a fresh id, and under its own id) and the same grant with its proof removed: the agent refuses all three and grants nothing",
  spec: [`${AG} (proofRequirement REQUIRED)`, "SPEC.md 7.2 (a document whose proof does not verify, or that carries none where one is REQUIRED, is refused)", "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    init("grant", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Once" }, [kdone("completed")]),
    init("revoke", aclSrc.revoke, "acl-revoke", { subject: SUBJECT }, [kdone("completed"), subjectIs(SUBJECT, 0)]),
    step({ id: "tampered", source: aclSrc.grant, do: { replay: { step: "grant", by: "K", to: "V", mode: "tamper" } }, expect: [{ reply: { code: "proofInvalid" } }, subjectIs(SUBJECT, 0)] }),
    step({ id: "conflicting", source: aclSrc.grant, do: { replay: { step: "grant", by: "K", to: "V", mode: "conflict" } }, expect: [{ reply: { code: "idConflict|proofInvalid" } }, subjectIs(SUBJECT, 0)] }),
    step({ id: "no-proof", source: aclSrc.grant, do: { replay: { step: "grant", by: "K", to: "V", mode: "stripProof" } }, expect: [{ reply: { code: "proofRequired" } }, subjectIs(SUBJECT, 0)] }),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 0)]),
};
const aclWrongRecipient: Scenario = {
  id: "FC-ACL-007", title: "the wallet signs a grant addressed to a different agent: this agent refuses it (wrong recipient) and grants nothing",
  spec: [`${AG} (parties: the ACL maintainer is the recipient)`, "SPEC.md 8.3 (wrongRecipient: the document's recipient does not identify the receiving consumer)", "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [init("grant-to-other", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Misaddressed", recipient: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }, [{ at: "K", received: { code: "wrongRecipient", count: 1 } }, kdone("refused"), subjectIs(SUBJECT, 0)])],
  allowedTerminals: ["refused"], completion: aclRefused([subjectIs(SUBJECT, 0)]),
};
const aclStale: Scenario = {
  id: "FC-ACL-008", title: "the wallet's clock is two hours behind when it signs a grant: the agent refuses the stale document and grants nothing; with the clock restored the same grant is accepted",
  spec: [`${AG} (issuedAtRequirement REQUIRED)`, "SPEC.md 7.2 (the receiver's acceptance window: a document issued outside it is refused)", "docs/26-paired-ceremonies.md section 3"],
  source: aclSrc.grant, ...aclBase,
  steps: [
    step({ id: "clock-back", do: { decide: { by: "K", action: "clockOffset", args: { seconds: -7200 } } } }),
    init("grant-stale", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Stale" }, [kdone("refused"), subjectIs(SUBJECT, 0)]),
    step({ id: "clock-restore", do: { decide: { by: "K", action: "clockOffset", args: { seconds: 0 } } } }),
    init("grant-fresh", aclSrc.grant, "acl-grant", { subject: SUBJECT, label: "Fresh" }, [kdone("completed"), subjectIs(SUBJECT, 1)]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 1)]),
};
// swap-key
const swapBase = { ...base, participants: kv("agent", [`${S}acl/swap-key/0.1`, `${S}acl/list/0.4`]) };
const swapOk: Scenario = {
  id: "FC-ACL-009", title: "key swap: the wallet replaces the key bound to its own access-list entry with a successor and the agent closes the old key's access in the same step (the successor key is a class D stand-in)",
  spec: [`${AS} (an ACL holder replaces the VID bound to its own entry; the old VID's access closes in the same transaction)`, "docs/26-paired-ceremonies.md section 3 (the successor key and DID are made by a stand-in key creator: a fixed Ed25519 did:key, not a did:peer)"],
  source: aclSrc.swap, ...swapBase,
  steps: [
    init("swap", aclSrc.swap, "acl-swap-key", undefined, [kdone("completed"), { at: "V", stored: { kind: "acl-subject:$K", count: 0 } }, subjectIs(SUCCESSOR, 1)]),
    init("old-key-after", aclSrc.list, "acl-list", undefined, [kdone("refused")]),
    init("successor-after", aclSrc.list, "acl-list", { as: "successor" }, [kdone("completed")]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([{ at: "V", stored: { kind: "acl-subject:$K", count: 0 } }, subjectIs(SUCCESSOR, 1)]),
};

export const aclFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-ACL", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Access-list administration and key swap (wallet and agent)", channel: "proposed", choreography: "docs/26-paired-ceremonies.md section 3: list, grant, relabel and revoke by an admin manager, and the manager's key swap; negatives for a non-admin, an unknown subject, a repeated grant, a replay, a tampered or unsigned document, a wrong recipient and a stale clock" },
  scenarios: [aclLifecycle, aclNonAdmin, aclUnknownRevoke, aclTwice, aclReplaySame, aclTamper, aclWrongRecipient, aclStale, swapOk],
};

// ======================================================================================================================================== FC-DEV
export const OTHER_PHONE = didOf(0x2b);
const devSrc = { register: src("device/register", "0.2"), heartbeat: src("device/heartbeat", "0.3"), list: src("device/list", "0.3"), setWake: src("device/set-wake", "0.2"), wipe: src("device/wipe", "0.2"), revoke: aclSrc.revoke };
const DR = "TF specs/device/register/0.2/spec.md", DH = "TF specs/device/heartbeat/0.3/spec.md", DL = "TF specs/device/list/0.3/spec.md", DW = "TF specs/device/set-wake/0.2/spec.md", DX = "TF specs/device/wipe/0.2/spec.md";
const devBase = { ...base, participants: kv("agent", [`${S}device/register/0.2`, `${S}device/heartbeat/0.3`, `${S}device/list/0.3`, `${S}device/set-wake/0.2`, `${S}device/wipe/0.2`]) };
const dev = (n: number): Check => ({ at: "V", stored: { kind: "device", count: n } });
const devLife: Scenario = {
  id: "FC-DEV-001", title: "device lifecycle: the phone registers itself with its agent, sends a heartbeat, lists the agent's devices and sets its wake channel; a second phone (a stand-in) is then removed by the wallet's own remove flow (wipe, then revoke its access-list entry): its entry and binding are gone and this phone's binding remains",
  spec: [`${DR} (the device claims its binding; one per consumer DID)`, `${DH} (a registered device tells the maintainer it is still here)`, `${DL} (enumerate the bindings)`, `${DW} (record how to wake the device)`, `${DX} (wipe a registered device)`, "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.register, ...devBase,
  steps: [
    init("register", devSrc.register, "device-register", undefined, [kdone("completed"), dev(1)]),
    init("heartbeat", devSrc.heartbeat, "device-heartbeat", undefined, [kdone("completed"), { at: "V", stored: { kind: "device-live", count: 1 } }]),
    init("list", devSrc.list, "device-list", undefined, [kdone("completed")]),
    init("set-wake", devSrc.setWake, "device-set-wake", undefined, [kdone("completed")]),
    decideV("second-phone", "seedDevice", { seed: 0x2b, displayName: "Second phone" }),
    init("remove-other", devSrc.wipe, "device-remove-other", undefined, [kdone("completed"), subjectIs(OTHER_PHONE, 0), dev(1)]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(OTHER_PHONE, 0), dev(1)]),
};
const devTwice: Scenario = {
  id: "FC-DEV-002", title: "registering the same phone twice: the second register is refused with device/register:alreadyRegistered and there is still one binding",
  spec: [`${DR} (errorCodes: device/register:alreadyRegistered; re-registration is rejected)`, "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.register, ...devBase,
  steps: [
    init("register", devSrc.register, "device-register", undefined, [kdone("completed"), dev(1)]),
    init("register-again", devSrc.register, "device-register", undefined, [{ at: "K", received: { code: "device/register:alreadyRegistered", count: 1 } }, dev(1)]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([dev(1)]),
};
const devUnregHb: Scenario = {
  id: "FC-DEV-003", title: "a heartbeat from a phone that never registered is refused with device/heartbeat:notRegistered and no binding appears",
  spec: [`${DH} (errorCodes: device/heartbeat:notRegistered)`, "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.heartbeat, ...devBase,
  steps: [init("heartbeat", devSrc.heartbeat, "device-heartbeat", undefined, [{ at: "K", received: { code: "device/heartbeat:notRegistered", count: 1 } }, kdone("refused"), dev(0)])],
  allowedTerminals: ["refused"], completion: aclRefused([dev(0)]),
};
const devUnregWake: Scenario = {
  id: "FC-DEV-004", title: "a wake channel set by a phone that never registered is refused with device/set-wake:notRegistered",
  spec: [`${DW} (errorCodes: device/set-wake:notRegistered)`, "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.setWake, ...devBase,
  steps: [init("set-wake", devSrc.setWake, "device-set-wake", undefined, [{ at: "K", received: { code: "device/set-wake:notRegistered", count: 1 } }, kdone("refused")])],
  allowedTerminals: ["refused"], completion: aclRefused([dev(0)]),
};
const devWipeUnknown: Scenario = {
  id: "FC-DEV-005", title: "a wipe naming a device the agent does not know is refused with device/wipe:notFound",
  spec: [`${DX} (errorCodes: device/wipe:notFound)`, "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.wipe, ...devBase,
  steps: [init("wipe-unknown", devSrc.wipe, "device-wipe", { deviceId: "dev_unknown0000000000", did: SUBJECT_2 }, [{ at: "K", received: { code: "device/wipe:notFound", count: 1 } }])],
  allowedTerminals: ["refused", "completed"], completion: { thread: "thread", assert: [{ at: "K", received: { code: "device/wipe:notFound", count: 1 } }] },
};
const devWipe: Scenario = {
  id: "FC-DEV-007", title: "wipe without removal: the wallet wipes a second phone and leaves its access-list entry: the binding stays and reads as wiped (read back with both list flags, includeWiped and includeDisabled)",
  spec: [`${DX} (a wipe marks the device; the binding is not deleted)`, "device/list 0.3 spec (includeDisabled: include devices with disabledAt set; includeWiped has no text)", "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.wipe, ...devBase,
  steps: [
    init("register", devSrc.register, "device-register", undefined, [kdone("completed"), dev(1)]),
    decideV("second-phone", "seedDevice", { seed: 0x2b, displayName: "Second phone" }),
    init("wipe-other", devSrc.wipe, "device-wipe-other", undefined, [kdone("completed"), { at: "V", stored: { kind: "device-wiped", count: 1 } }, subjectIs(OTHER_PHONE, 1)]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([{ at: "V", stored: { kind: "device-wiped", count: 1 } }]),
};
const devReplay: Scenario = {
  id: "FC-DEV-006", title: "the phone's signed register is delivered again unchanged: the agent does not create a second binding",
  spec: [`${DR} (one DeviceBinding per consumer DID)`, "SPEC.md 7.2 item 11 (a repeated id is not executed twice)", "docs/26-paired-ceremonies.md section 5"],
  source: devSrc.register, ...devBase,
  steps: [
    init("register", devSrc.register, "device-register", undefined, [kdone("completed"), dev(1)]),
    step({ id: "replay-register", source: devSrc.register, do: { replay: { step: "register", by: "K", to: "V", mode: "same" } }, expect: [dev(1)] }),
  ],
  allowedTerminals: ["completed"], completion: aclDone([dev(1)]),
};
export const devFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-DEV", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Device lifecycle (wallet and agent)", channel: "proposed", choreography: "docs/26-paired-ceremonies.md section 5: register, heartbeat, list, set-wake and the wallet's remove flow (wipe then revoke); negatives for a repeated register, a heartbeat or wake before register, an unknown wipe target and a replay" },
  scenarios: [devLife, devTwice, devUnregHb, devUnregWake, devWipeUnknown, devReplay, devWipe],
};

// ======================================================================================================================================== FC-VLT
const vltSrc = { receive: src("vault/credentials/receive", "0.1"), query: src("vault/credentials/query", "0.1"), get: src("vault/credentials/get", "0.2") };
const VR = "TF specs/vault/credentials/receive/0.1/spec.md", VQ = "TF specs/vault/credentials/query/0.1/spec.md", VG = "TF specs/vault/credentials/get/0.2/spec.md";
const vltBase = { ...base, participants: kv("agent", [`${S}vault/credentials/receive/0.1`, `${S}vault/credentials/query/0.1`, `${S}vault/credentials/get/0.2`]) };
const WALLET_DID = didOf(0x4b);
const cardIssuer = ed25519Signer(seedOf(0x5d));
/** Class D: a membership card as a community would issue it (the card source is not the wallet): a W3C credential about the wallet's persona, signed by a fixed did:key issuer. */
export const CARD = signDocument({
  "@context": ["https://www.w3.org/ns/credentials/v2"], id: "urn:uuid:7c0e2f3a-0000-4000-8000-0000000000c1", type: ["VerifiableCredential", "MembershipCredential"],
  issuer: cardIssuer.did, validFrom: "2026-01-01T00:00:00Z", credentialSubject: { id: WALLET_DID, community: "did:example:community" },
}, cardIssuer, { purpose: "assertionMethod", created: Date.parse("2026-01-01T00:00:00Z") });
const vltBackup: Scenario = {
  id: "FC-VLT-001", title: "card backup and restore: the wallet puts a community card into its agent's vault, then asks the vault for its cards by purpose and fetches each: the agent holds one credential and the wallet gets that card back (the card is a class D stand-in for a community's)",
  spec: [`${VR} (the vault stores a credential and files it under a context)`, `${VQ} (a filtered query; the vault answers only a filtered one)`, `${VG} (the card is returned by id)`, "docs/26-paired-ceremonies.md section 6"],
  source: vltSrc.receive, ...vltBase,
  steps: [
    init("keep-card", vltSrc.receive, "vault-keep-card", { card: CARD }, [kdone("completed"), { at: "V", stored: { kind: "credential", count: 1 } }]),
    init("restore", vltSrc.get, "vault-restore", undefined, [kdone("completed"), { at: "K", stored: { kind: "restored-cards", count: 1 } }]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([{ at: "V", stored: { kind: "credential", count: 1 } }, { at: "K", stored: { kind: "restored-cards", count: 1 } }]),
};
const vltEmpty: Scenario = {
  id: "FC-VLT-002", title: "restore from an empty vault: the query matches nothing and that is an empty answer, not an error; the wallet gets no card back",
  spec: [`${VQ} (a query with no match is an empty list)`, "docs/26-paired-ceremonies.md section 6"],
  source: vltSrc.query, ...vltBase,
  steps: [init("restore", vltSrc.get, "vault-restore", undefined, [kdone("completed"), { at: "K", stored: { kind: "restored-cards", count: 0 } }])],
  allowedTerminals: ["completed"], completion: aclDone([{ at: "V", stored: { kind: "credential", count: 0 } }]),
};
export const vltFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-VLT", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Credential vault: backup and restore (wallet and agent)", channel: "proposed", choreography: "docs/26-paired-ceremonies.md section 6: the wallet files a card in its agent's vault, then restores by query and get; an empty restore" },
  scenarios: [vltBackup, vltEmpty],
};

// ======================================================================================================================================== FC-AUT
// The sign-in by trigger link (auth/oob, purpose login): a starter (the browser, `S`), the community's service (`V`) and the member's wallet (`K`, the approver).
const oobSrc = { request: src("auth/oob/request", "0.2"), claim: src("auth/oob/claim", "0.2"), prove: src("auth/oob/prove", "0.3"), respond: src("auth/oob/respond", "0.3"), redeem: src("auth/oob/redeem", "0.2"), cancel: src("auth/oob/cancel", "0.1") };
const OQ = "TF specs/auth/oob/request/0.2/spec.md", OC = "TF specs/auth/oob/claim/0.2/spec.md", OP = "TF specs/auth/oob/prove/0.3/spec.md", OR = "TF specs/auth/oob/respond/0.3/spec.md", OD = "TF specs/auth/oob/redeem/0.2/spec.md", OV = "TF specs/auth/oob/_shared/0.1/CONVENTIONS.md";
const autBase = {
  ...base, reads: ["S"],
  participants: { S: { role: "starter", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"] }, V: { role: "service", requires: [] }, K: { role: "member-phone", requires: K_REQ } },
};
const ERR = `${S}trust-task-error/0.6`;
const rq = (n: string): Check => ({ at: "S", received: { type: `${S}auth/oob/${n}`, count: 1 }, thread: "start" });
const sInit = (id: string, source: VectorSource, kind: string, capture: string, expect: Check[], extra: Record<string, unknown> = {}): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "S", to: "V", kind, capture, ...extra } }, expect });
// a check that names no thread reads the thread this step captured (the runner's default thread name is `thread`, which these steps do not capture)
const kInit = (id: string, source: VectorSource, kind: string, capture: string, args: Record<string, unknown>, expect: Check[]): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture, args } }, expect: expect.map((c) => (c.thread === undefined ? { ...c, thread: capture } : c)) });
const requestId = { $received: { at: "S", type: `${S}auth/oob/request/0.2#response`, thread: "start", member: "requestId" } };
const claimClosesAt = { $received: { at: "S", type: `${S}auth/oob/request/0.2#response`, thread: "start", member: "claimClosesAt" } };
const matchNumber = { $received: { at: "S", type: ERR, thread: "poll", member: "details.matchNumber" } };
const seedMember = decideV("seed-member", "seedMember", { vid: "$K" });
const openRequest = sInit("request", oobSrc.request, "oob-request", "start", [rq("request/0.2#response")]);
const claimArgs = { from: "$V", doc: "$doc:V", id: requestId, claimClosesAt };
const claim = kInit("claim", oobSrc.claim, "oob-claim", "claim", claimArgs, [kdone("completed")]);
const poll = sInit("show-number", oobSrc.redeem, "oob-redeem", "poll", [{ at: "S", received: { type: ERR, code: "auth/oob/redeem:pending", count: 1 }, thread: "poll" }], { thread: "start" });
const proveWith = (offset: number): ScenarioStep => kInit("prove", oobSrc.prove, "oob-prove", "prove", { number: matchNumber, offset }, [kdone("completed")]);
const approve = kInit("respond", oobSrc.respond, "oob-approve", "approve", {}, [{ at: "K", ceremony: "completed", thread: "approve" }]);
const redeem = sInit("redeem", oobSrc.redeem, "oob-redeem", "redeemed", [{ at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 1 }, thread: "redeemed" }], { thread: "start" });
const autDone = (extra: Check[] = []): Scenario["completion"] => ({ thread: "redeemed", assert: [{ at: "S", ceremony: "completed", thread: "redeemed" }, { at: "K", ceremony: "completed", thread: "approve" }, ...extra] });
const autSigned: Scenario = {
  id: "FC-AUT-001", title: "sign-in by trigger link: the browser opens a request, the member's wallet claims it, the browser shows the match number, the wallet identifies its member and proves with that number, the member approves, and the browser redeems a session for the member (the wallet's agent is a class D stand-in; the community's DID document is a stand-in carrying the sign-in services)",
  spec: [`${OQ} (the starter opens a request; the service answers a requestId and claimClosesAt)`, `${OC} (the approver claims with a fresh lock key; the community's answer is its signed attestation)`, `${OD} (only the starter key's holder is told the match number; a redeem returns the session once approved)`, `${OP} (the approver proves with identify and the entered number)`, `${OR} (the approver responds with the signed grant)`, `${OV} (request states; proof purposes; disclosure ladder)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.claim, ...autBase,
  steps: [seedMember, openRequest, claim, poll, proveWith(0), approve, redeem],
  allowedTerminals: ["completed"], completion: autDone(),
};
const autWrongNumber: Scenario = {
  id: "FC-AUT-002", title: "the member types a number that is not the one on the page: the service refuses the proof with auth/oob/prove:numberMismatch and the request is over (one try); the browser's redeem then reads it as declined or refused, never a session",
  spec: [`${OP} (consumer step 5: enteredNumber must equal the match number, else auth/oob/prove:numberMismatch)`, `${OV} (a failed prove from the lock holder moves the request to declined: one claim, one proof attempt, one decision, one redemption)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.prove, ...autBase,
  steps: [seedMember, openRequest, claim, poll, kInit("prove-wrong", oobSrc.prove, "oob-prove", "prove", { number: matchNumber, offset: 1 }, [{ at: "K", received: { code: "auth/oob/prove:numberMismatch", count: 1 }, thread: "prove" }]),
    sInit("redeem-after", oobSrc.redeem, "oob-redeem", "redeemed", [{ at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 0 }, thread: "redeemed" }], { thread: "start" })],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "prove", assert: [{ at: "K", ceremony: "refused", thread: "prove" }, { at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 0 }, thread: "redeemed" }] },
};
const autSecondClaim: Scenario = {
  id: "FC-AUT-003", title: "a second device claims a request that is already claimed: the service refuses it with auth/oob/claim:alreadyClaimed and the first claimant can still finish",
  spec: [`${OC} (errorCodes: auth/oob/claim:alreadyClaimed; one claim per request)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.claim, ...autBase,
  steps: [seedMember, openRequest, claim, kInit("claim-again", oobSrc.claim, "oob-claim", "claim2", claimArgs, [{ at: "K", received: { code: "auth/oob/claim:alreadyClaimed", count: 1 }, thread: "claim2" }])],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "claim2", assert: [{ at: "K", ceremony: "refused", thread: "claim2" }] },
};
const autNotMember: Scenario = {
  id: "FC-AUT-004", title: "a wallet whose member is not a member of the community proves: the service refuses with the generic auth/oob:notAuthorized, the same answer as for a bad signature, so sign-in cannot be used to probe membership",
  spec: [`${OP} (a non-member and a bad signature get the same auth/oob:notAuthorized)`, `${OV} (rule 7: generic failures)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.prove, ...autBase,
  steps: [openRequest, claim, poll, kInit("prove-non-member", oobSrc.prove, "oob-prove", "prove", { number: matchNumber, offset: 0 }, [{ at: "K", received: { code: "auth/oob:notAuthorized", count: 1 }, thread: "prove" }])],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "prove", assert: [{ at: "K", ceremony: "refused", thread: "prove" }] },
};
const autCancel: Scenario = {
  id: "FC-AUT-005", title: "the approver gives up: the wallet cancels a claimed request, and the browser's redeem then does not return a session",
  spec: ["TF specs/auth/oob/cancel/0.1/spec.md (the approver cancels with its lock key)", `${OD} (a cancelled request is final)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.cancel, ...autBase,
  steps: [seedMember, openRequest, claim, kInit("cancel", oobSrc.cancel, "oob-cancel", "cancel", {}, [kdone("completed")]),
    sInit("redeem-after", oobSrc.redeem, "oob-redeem", "redeemed", [{ at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 0 }, thread: "redeemed" }], { thread: "start" })],
  reads: ["K"], allowedTerminals: ["completed"], completion: { thread: "cancel", assert: [{ at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 0 }, thread: "redeemed" }] },
};
const noSession: Check = { at: "S", received: { type: `${S}auth/oob/redeem/0.2#response`, count: 0 }, thread: "redeemed" };
const withParts = (v: string[], k: string[] = []): Pick<Scenario, "participants"> => ({ participants: { S: autBase.participants.S, V: { role: "service", requires: v }, K: { role: "member-phone", requires: [...K_REQ, ...k] } } });
const proveStep = kInit("prove", oobSrc.prove, "oob-prove", "prove", { number: matchNumber, offset: 0 }, [kdone("completed")]);
const autStranger: Scenario = {
  id: "FC-AUT-006", title: "a browser that did not open the request tries to redeem it with a key of its own: the service refuses with auth/oob:notStarter, and only the starter key's holder is ever told anything about the request",
  spec: [`${OD} (service item 1: the issuer must equal the starter key, else auth/oob:notStarter)`, `${OV} (rule 3: authority goes to the starter key, through redeem only)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.redeem, ...autBase,
  steps: [seedMember, openRequest, claim, sInit("stranger-redeem", oobSrc.redeem, "oob-redeem", "stranger", [{ at: "S", received: { type: ERR, code: "auth/oob:notStarter", count: 1 }, thread: "stranger" }], { thread: "start", args: { as: "stranger" } })],
  reads: ["S"], allowedTerminals: ["refused"], completion: { thread: "stranger", assert: [{ at: "S", ceremony: "refused", thread: "stranger" }] },
};
const autAfterCancel: Scenario = {
  id: "FC-AUT-007", title: "the approver cancels a claimed request and then tries to prove: the cancelled request is final and no longer claimed, so the proof is refused with auth/oob:requestExpired (prove 0.3 item 1: a request that is not claimed has ended; auth/oob:alreadyDecided is not a prove 0.3 code) and no identity is established",
  spec: ["TF specs/auth/oob/cancel/0.1/spec.md (a cancelled request is final)", `${OP} (service item 1: "the request to be claimed and inside its decision window, else auth/oob:requestExpired"; error table: requestExpired, "The decision window has passed, or the request has otherwise ended.")`, `${OV} (cancelled is a final state)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.cancel, ...autBase,
  steps: [seedMember, openRequest, claim, poll, kInit("cancel", oobSrc.cancel, "oob-cancel", "cancel", {}, [kdone("completed")]),
    kInit("prove-after-cancel", oobSrc.prove, "oob-prove", "prove", { number: matchNumber, offset: 0 }, [{ at: "K", received: { code: "auth/oob:requestExpired", count: 1 }, thread: "prove" }])],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "prove", assert: [{ at: "K", ceremony: "refused", thread: "prove" }] },
};
const autWrongKey: Scenario = {
  id: "FC-AUT-008", title: "a respond signed with a key that is not the lock is refused with auth/oob:notClaimant and no session follows (the approver is a sender of deliberately broken documents, class D: a wallet never sends one)",
  spec: [`${OR} (service item 1: the outer issuer must equal the lock, else auth/oob:notClaimant)`, `${OV} (rule 4: the lock key signs everything the approver sends)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.respond, ...autBase, ...withParts([], ["optional:initiate.oobTamper"]),
  steps: [seedMember, openRequest, claim, poll, proveStep, kInit("respond-wrong-key", oobSrc.respond, "oob-respond-wrong-key", "approve", {}, [{ at: "K", received: { code: "auth/oob:notClaimant", count: 1 }, thread: "approve" }]),
    sInit("redeem-after", oobSrc.redeem, "oob-redeem", "redeemed", [noSession], { thread: "start" })],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "approve", assert: [{ at: "K", ceremony: "refused", thread: "approve" }, noSession] },
};
const autWrongDigest: Scenario = {
  id: "FC-AUT-009", title: "a grant whose contextDigest is not the digest of the step 2 the member was shown is refused with auth/oob/respond:contextMismatch and no session follows (class D approver that sends a broken grant)",
  spec: [`${OR} (service item 3: contextDigest must equal the stored digest of the signed step 2, else auth/oob/respond:contextMismatch)`, "TF specs/auth/oob/grant/0.3/spec.md (the grant binds what the member was shown)", "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.respond, ...autBase, ...withParts([], ["optional:initiate.oobTamper"]),
  steps: [seedMember, openRequest, claim, poll, proveStep, kInit("respond-wrong-digest", oobSrc.respond, "oob-respond-wrong-digest", "approve", {}, [{ at: "K", received: { code: "auth/oob/respond:contextMismatch", count: 1 }, thread: "approve" }]),
    sInit("redeem-after", oobSrc.redeem, "oob-redeem", "redeemed", [noSession], { thread: "start" })],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "approve", assert: [{ at: "K", ceremony: "refused", thread: "approve" }, noSession] },
};
const autBadSignature: Scenario = {
  id: "FC-AUT-010", title: "a member's identify with a broken signature is refused with the same generic auth/oob:notAuthorized as a non-member (class D approver that sends a broken identify)",
  spec: [`${OP} (service items 4 and 7: the identify is verified against the issuer's authentication relationship; a non-member and a bad signature get the same auth/oob:notAuthorized)`, `${OV} (rule 7: generic failures)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.prove, ...autBase, ...withParts([], ["optional:initiate.oobTamper"]),
  steps: [seedMember, openRequest, claim, poll, kInit("prove-bad-signature", oobSrc.prove, "oob-prove-bad-signature", "prove", { number: matchNumber, offset: 0 }, [{ at: "K", received: { code: "auth/oob:notAuthorized", count: 1 }, thread: "prove" }])],
  reads: ["K"], allowedTerminals: ["refused"], completion: { thread: "prove", assert: [{ at: "K", ceremony: "refused", thread: "prove" }] },
};
const autStepDown: Scenario = {
  id: "FC-AUT-011", title: "version step-down: a community from before the 2026-10-24 renaming (claim 0.1, prove, grant and respond 0.1 or 0.2, instants as epoch seconds) is signed in to by a wallet that asks the newest version first and steps down once per task, never resending a refusal at another version (the old community is a class D stand-in: a deployment's release, set by the harness)",
  spec: ["TF specs/auth/oob/claim/0.2/spec.md (Changes from 0.1: decisionDeadline renamed decisionClosesAt)", "TF specs/auth/oob/prove/0.3/spec.md and respond/0.3 (versioned together)", `${OV} (rule 5: the earlier versions carry instants as epoch seconds)`, "SPEC.md 5.2 and 8.3 (a type version not implemented is refused unsupportedVersion; the details member servedVersions is not named by the specification, so it is not asserted)", "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.claim, ...autBase, ...withParts(["optional:trigger.serveVersions"]),
  steps: [decideV("serve-legacy", "serveVersions", { profile: "legacy" }), seedMember, openRequest, claim, poll, proveWith(0), approve, redeem],
  allowedTerminals: ["completed"], completion: autDone(),
};
const autOldWallet: Scenario = {
  id: "FC-AUT-012", title: "a wallet that only knows claim 0.1 meets a current community (claim 0.2 only): the community refuses the type as unsupportedVersion before it touches the request, and the request is still claimable at 0.2 (the approver sends only the versions it is told, class D: a wallet asks 0.2 first)",
  spec: ["TF specs/auth/oob/claim/0.2/spec.md (Changes from 0.1)", "SPEC.md 5.2 and 8.3 (unsupportedVersion; details.servedVersions is not named by the specification, so it is not asserted)", `${OV} (a failed claim leaves the request as it was)`, "docs/26-paired-ceremonies.md section 4"],
  source: oobSrc.claim, ...autBase, ...withParts([], ["optional:initiate.oobTamper"]),
  steps: [seedMember, openRequest, kInit("claim-old", oobSrc.claim, "oob-claim", "old", { ...claimArgs, only: ["0.1"] }, [{ at: "K", received: { code: "unsupportedVersion|unsupportedType", count: 1 }, thread: "old" }]),
    kInit("claim-new", oobSrc.claim, "oob-claim", "claim", claimArgs, [kdone("completed")])],
  reads: ["K"], allowedTerminals: ["completed"], completion: { thread: "claim", assert: [{ at: "K", ceremony: "completed", thread: "claim" }, { at: "K", ceremony: "refused", thread: "old" }] },
};
export const autFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-AUT", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Sign-in by trigger link (browser, community service, member's wallet)", channel: "proposed", choreography: "docs/26-paired-ceremonies.md section 4: request, claim, the match number shown to the browser only, identify and prove, the grant, respond, redeem; negatives for a wrong number, a second claim, a non-member and a cancel, a stranger's redeem, a proof after a cancel, a respond under the wrong key, a grant for another digest and a broken identify; a version step-down against an older community and an old wallet against a current one" },
  scenarios: [autSigned, autWrongNumber, autSecondClaim, autNotMember, autCancel, autStranger, autAfterCancel, autWrongKey, autWrongDigest, autBadSignature, autStepDown, autOldWallet],
};

// ======================================================================================================================================== FC-STU
// Step-up of a gated task (auth/step-up): the agent holds a task until the member's phone approves, the phone answers, the task runs.
const stuSrc = { request: src("auth/step-up/approve-request", "0.5"), response: src("auth/step-up/approve-response", "0.7"), grant: aclSrc.grant };
const SQ = "TF specs/auth/step-up/approve-request/0.5/spec.md", SR = "TF specs/auth/step-up/approve-response/0.7/spec.md", SH = "SPEC.md 8.6 (a hold is a next step)";
const NEXT = `${S}trust-task-next-step/0.1`;
const stuBase = { ...base, participants: kv("agent", [`${S}auth/step-up/approve-response/0.7`, `${S}acl/grant/0.3`, "optional:trigger.requireStepUp"]) };
const gate = decideV("gate-grants", "requireStepUp", { type: "acl/grant/0.3" });
// At least one hold: a wallet that steps down a version ladder first (acl/grant 0.3, then 0.2; the scenario targets grant 0.3 after the kw-acl regeneration) is also answered `unsupportedVersion`, a trust-task-error 0.6 that is not the hold; a count of one over-read the text (class B, found on the wire row).
const HELD = `${NEXT}|${S}trust-task-error/0.6`;
const stuAsDeployed: Scenario = {
  id: "FC-STU-001", title: "step-up of a gated task, at the overlap of the shapes in use: the agent holds a grant, the wallet answers the step-up approve-request with an approve-response 0.7 (approved, signed by the member's DID), the agent records it and the retried grant runs once; the hold may be a next step (the specification) or the error shape deployed agents use today",
  spec: [`${SQ} (the relying party asks the subject's approver to ratify an elevation; the request carries a challenge and the evidence it accepts)`, `${SR} (the approver's answer echoes subject and challenge; didSigned evidence is a proof by the approver's own DID for assertionMethod; the agent records it)`, SH, "docs/26-paired-ceremonies.md section 4 (step-down: the hold's shape is the one point where the specification and the deployed agents differ)"],
  source: stuSrc.response, ...stuBase,
  steps: [
    gate,
    init("grant-gated", stuSrc.grant, "acl-grant", { subject: SUBJECT, label: "After step-up" }, [{ at: "K", received: { type: HELD } }, { at: "K", received: { type: `${S}auth/step-up/approve-response/0.7#response`, count: 1 } }, { at: "K", received: { type: `${S}acl/grant/0.3#response`, count: 1 } }, kdone("completed"), subjectIs(SUBJECT, 1), { at: "K", stored: { kind: "step-up-asked", count: 1 } }]),
  ],
  allowedTerminals: ["completed"], completion: aclDone([subjectIs(SUBJECT, 1)]),
};
const stuStrict: Scenario = {
  id: "FC-STU-002", title: "the hold is a next step: a gated task is answered with trust-task-next-step naming the step-up as what it expects, not with an error (SPEC 8.6), and nothing has run yet",
  spec: [SH, "SPEC.md 8.6 (a consumer holding a task MUST answer with a next step and MUST NOT answer with taskFailed, permissionDenied or any other error whose extended code or details says the task is held)", `${SR}`, "docs/26-paired-ceremonies.md section 4"],
  source: stuSrc.response, ...stuBase,
  steps: [gate, init("grant-gated", stuSrc.grant, "acl-grant", { subject: SUBJECT, label: "Held", stepUp: "deny" }, [{ at: "K", received: { type: NEXT, count: 1 } }, subjectIs(SUBJECT, 0)])],
  allowedTerminals: ["completed", "refused"], completion: { thread: "thread", assert: [{ at: "K", received: { type: NEXT, count: 1 } }, subjectIs(SUBJECT, 0)] },
};
const stuDeny: Scenario = {
  id: "FC-STU-003", title: "the member declines the step-up on the phone: a signed denial goes to the agent, the task does not run, and the agent does not elevate the session",
  spec: [`${SR} (a denial is signed by the approver's DID and carries a reason; the session is not elevated)`, SH, "docs/26-paired-ceremonies.md section 4"],
  source: stuSrc.response, ...stuBase,
  steps: [gate, init("grant-denied", stuSrc.grant, "acl-grant", { subject: SUBJECT, label: "Denied", stepUp: "deny" }, [{ at: "K", received: { type: `${S}auth/step-up/approve-response/0.7#response`, count: 1 } }, kdone("refused"), subjectIs(SUBJECT, 0)])],
  allowedTerminals: ["refused"], completion: aclRefused([subjectIs(SUBJECT, 0)]),
};
const stuBadProof: Scenario = {
  id: "FC-STU-004", title: "the phone's signed step-up answer is changed after signing: the agent refuses it (proofInvalid, or challengeUnknown where it has already consumed the challenge), does not elevate the session, and the task does not run",
  spec: [`${SR} (the approval rests on a proof by the approver's own DID; a proof that does not verify is refused)`, "SPEC.md 7.2 item 7 (proofInvalid)", "docs/26-paired-ceremonies.md section 4"],
  source: stuSrc.response, ...stuBase,
  steps: [gate, init("grant-gated", stuSrc.grant, "acl-grant", { subject: SUBJECT, label: "Tampered", stepUp: "deny" }, [{ at: "K", received: { type: `${S}auth/step-up/approve-response/0.7#response`, count: 1 } }]),
    step({ id: "tampered-approval", source: stuSrc.response, do: { replay: { step: "grant-gated", by: "K", to: "V", mode: "tamper", index: 1 } }, expect: [{ reply: { code: "proofInvalid|auth/step-up/approve-response:challengeUnknown" } }, subjectIs(SUBJECT, 0)] })],
  allowedTerminals: ["refused"], completion: aclRefused([subjectIs(SUBJECT, 0)]),
};
const stuUnknownChallenge: Scenario = {
  id: "FC-STU-005", title: "an approval that echoes a challenge the agent never issued is refused with auth/step-up/approve-response:challengeUnknown and elevates nothing",
  spec: [`${SR} (errorCodes: auth/step-up/approve-response:challengeUnknown)`, "docs/26-paired-ceremonies.md section 4"],
  source: stuSrc.response, ...stuBase,
  steps: [gate, init("approve-unprompted", stuSrc.response, "step-up-unprompted", undefined, [{ at: "K", received: { code: "auth/step-up/approve-response:challengeUnknown", count: 1 } }]),
    init("grant-still-held", stuSrc.grant, "acl-grant", { subject: SUBJECT, label: "Still held", stepUp: "deny" }, [{ at: "K", received: { type: HELD } }, subjectIs(SUBJECT, 0)])],
  allowedTerminals: ["refused"], completion: aclRefused([subjectIs(SUBJECT, 0)]),
};
export const stuFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-STU", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Step-up of a gated task (wallet and agent)", channel: "proposed", choreography: "docs/26-paired-ceremonies.md section 4: a gated task is held, the phone answers the approve-request, the retried task runs once; the hold as a next step (SPEC 8.6) beside the deployed error shape; negatives for a declined step-up, a changed approval and an unknown challenge" },
  scenarios: [stuAsDeployed, stuStrict, stuDeny, stuBadProof, stuUnknownChallenge],
};

export const pairFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-acl.json", data: aclFile }, { file: "fc-dev.json", data: devFile }, { file: "fc-vlt.json", data: vltFile }, { file: "fc-aut.json", data: autFile }, { file: "fc-stu.json", data: stuFile }];
