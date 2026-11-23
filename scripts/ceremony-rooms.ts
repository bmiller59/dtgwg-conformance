// SPDX-License-Identifier: Apache-2.0
// Authoring source of the rooms group (docs/32): a member's wallet (keyring-wallet, `K`) against a community that offers it an open room and hosts it (VTI's VTC with community rooms on, `V`), and against the member's own agent
// as key holder (VTI's VTA, `A`). Imported by scripts/generate-ceremony-scenarios.ts. Every step cites the Trust Tasks specification of the document it sends. The choreography is the suite's own proposal (channel `proposed`);
// the result of a run is evidence of kind complete-ceremony, never a conformance count. Open tier only: an open room has no group, so the MLS tiers (KeyPackage, Welcome, sealed records) are not run (docs/32 section 6).
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const K = { role: "member-phone", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"] };
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[], extra: Partial<NonNullable<ScenarioStep["do"]["initiate"]>> = {}): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }), ...extra } }, expect });
const initA = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[]): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "A", kind, capture: "thread", ...(args === undefined ? {} : { args }) } }, expect });
const trig = (id: string, action: string, args: Record<string, unknown>, to: "V" | "A" = "V"): ScenarioStep => step({ id, do: { decide: { by: to, action, args } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const kst = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });
const vst = (kind: string, count = 1): Check => ({ at: "V", stored: { kind, count } });
const code = (c: string, count = 1): Check => ({ at: "K", received: { code: c, count } });
const r = {
  offers: src("vtc/rooms/offers/list", "0.4"), offers3: src("vtc/rooms/offers/list", "0.3"), accept: src("vtc/rooms/offers/accept", "0.1"), memberships: src("vtc/rooms/memberships/list", "0.1"),
  put: src("rooms/records/put", "0.3"), begin: src("rooms/blobs/upload/begin", "0.2"), keys: src("rooms/keys/list", "0.2"), keys1: src("rooms/keys/list", "0.1"), kp: src("rooms/keys/key-package", "0.2"), act: src("rooms/keys/act", "0.9"), act8: src("rooms/keys/act", "0.8"),
};
const P = "TF specs/";
const DOC = "docs/32-rooms-ballot-ceremonies.md section";
const needV = [`${S}vtc/rooms/offers/list/0.4`, `${S}vtc/rooms/offers/accept/0.1`, `${S}vtc/rooms/memberships/list/0.1`, `${S}rooms/records/put/0.3`, `${S}rooms/blobs/upload/begin/0.2`];
const needA = [`${S}rooms/keys/list/0.2`, `${S}rooms/keys/key-package/0.2`, `${S}rooms/keys/act/0.9`];
const vp = { ...base, participants: { K, V: { role: "community", requires: needV } } };
const ap = { ...base, participants: { K, A: { role: "agent", requires: needA } } };
const seedK = trig("seed-member", "seedMember", { vid: "$K" });
const offer = (args: Record<string, unknown> = {}) => trig("offer-room", "offerRoom", { vid: "$K", ...args });
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });
const listOffers = (extra: Check[] = []) => init("offers", r.offers, "rooms-offers", undefined, [kdone("completed"), kst("rooms:offers:1"), ...extra]);
const accept = (extra: Check[] = []) => init("accept", r.accept, "rooms-accept", undefined, [kdone("completed"), kst("rooms:accepted:admitted"), ...extra]);
const joined = [seedK, offer(), listOffers(), accept()];
const put = (id = "put", args: Record<string, unknown> = {}, expect: Check[] = [kdone("completed"), kst("rooms:put:ok")]) => init(id, r.put, "rooms-put", args, expect);
const members = `${P}vtc/rooms/memberships/list/0.1/spec.md`;

const scenarios: Scenario[] = [
  { id: "FC-RMS-001", title: "the community offers an open room to a member: the member's offers list (0.4) holds one open offer with the credentials the room issued",
    spec: [`${P}vtc/rooms/offers/list/0.4/spec.md (a member's open offers, each with the invitation, membership and authority credentials)`, `${DOC} 3`],
    source: r.offers, ...vp, steps: [seedK, offer(), listOffers([kst("rooms:offer-state:open"), kst("rooms:offer-creds"), kst("rooms:offers-version:0.4")])], allowedTerminals: ["completed"], completion: done([kst("rooms:offers:1")]) },
  { id: "FC-RMS-002", title: "the member accepts the offer of an open room (no KeyPackage: an open room has no group): the community answers admitted, and the memberships list shows the room admitted",
    spec: [`${P}vtc/rooms/offers/accept/0.1/spec.md (on an open room accepting records that the member took up the offer; item 2: no KeyPackage on an open room)`, members, `${DOC} 3`],
    source: r.accept, ...vp, steps: [...joined, init("memberships", r.memberships, "rooms-memberships", undefined, [kdone("completed"), kst("rooms:membership:admitted")])], allowedTerminals: ["completed"], completion: done([kst("rooms:membership:admitted")]) },
  { id: "FC-RMS-003", title: "the admitted member writes a note to the open room with the presentation the offer carried (rooms/records/put 0.3): the host stores one record and answers its key and version",
    spec: [`${P}rooms/records/put/0.3/spec.md (consumer items 1 and 12: verify the chain; cleartext on an open room)`, `${DOC} 3`],
    source: r.put, ...vp, steps: [...joined, put()], allowedTerminals: ["completed"], completion: done([kst("rooms:put:ok"), vst("rooms-records:1")]) },
  { id: "FC-RMS-004", title: "the admitted member opens an upload for a file (rooms/blobs/upload/begin 0.2, proxied: a consistent manifest of two chunks): the host opens one upload and names the chunks it lacks",
    spec: [`${P}rooms/blobs/upload/begin/0.2/spec.md (the manifest; a presentation conferring write)`, `${DOC} 3`],
    source: r.begin, ...vp, steps: [...joined, init("begin", r.begin, "rooms-blob-begin", { size: 20000 }, [kdone("completed"), kst("rooms:upload:ok")])], allowedTerminals: ["completed"], completion: done([kst("rooms:upload:ok"), vst("rooms-uploads:1")]) },
  { id: "FC-RMS-005", title: "the member's signed write is delivered again unchanged, with a value changed after signing, and with its proof removed: the unchanged copy does not apply a second write, the changed and unsigned copies are refused (proofInvalid, proofRequired); the room holds one record from one write",
    spec: [`${P}rooms/records/put/0.3/spec.md (proofRequirement REQUIRED)`, "SPEC.md 7.2 (a document whose proof does not verify, or that carries none where one is REQUIRED, is refused; a repeated id is not executed twice)", `${DOC} 4`],
    source: r.put, ...vp, steps: [...joined, put(), step({ id: "replay-same", source: r.put, do: { replay: { step: "put", by: "K", to: "V", mode: "same", index: 0 } }, expect: [] }),
      step({ id: "replay-tampered", source: r.put, do: { replay: { step: "put", by: "K", to: "V", mode: "tamper", index: 0 } }, expect: [{ reply: { code: "proofInvalid" } }] }),
      step({ id: "replay-no-proof", source: r.put, do: { replay: { step: "put", by: "K", to: "V", mode: "stripProof", index: 0 } }, expect: [{ reply: { code: "proofRequired" } }] })],
    allowedTerminals: ["completed"], completion: done([vst("rooms-records:1"), vst("rooms-writes:1")]) },
  { id: "FC-RMS-006", title: "the member writes the same key again as a new record (a second document, expected version 0): the host refuses it with rooms/records/put:versionConflict and the room keeps the first record",
    spec: [`${P}rooms/records/put/0.3/spec.md (consumer item 6: return the current version with a versionConflict rather than a bare rejection)`, `${DOC} 4`],
    source: r.put, ...vp, steps: [...joined, put(), put("put-again", {}, [code("rooms/records/put:versionConflict"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:versionConflict"), vst("rooms-records:1")]) },
  { id: "FC-RMS-007", title: "the offer's end has passed when the member accepts: the community refuses the accept with vtc/rooms/offers/accept:offerExpired and admits no one",
    spec: [`${P}vtc/rooms/offers/accept/0.1/spec.md (errorCodes: offerExpired; the offer's validUntil has passed)`, `${DOC} 4`],
    source: r.accept, ...vp, steps: [seedK, offer({ expired: true }), step({ id: "wait", do: { decide: { by: "V", action: "waitPast", args: {} } } }), init("offers", r.offers, "rooms-offers", undefined, [kdone("completed")]), init("accept", r.accept, "rooms-accept", undefined, [code("vtc/rooms/offers/accept:offerExpired"), kdone("refused")])],
    allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:offerExpired")]) },
  { id: "FC-RMS-008", title: "the member addresses its accept to another community than the one that receives it: the community refuses it (wrongRecipient) and admits no one",
    spec: [`${P}vtc/rooms/offers/accept/0.1/spec.md (parties: the community maintainer is the recipient)`, "SPEC.md 8.3 (wrongRecipient)", `${DOC} 4`],
    source: r.accept, ...vp, steps: [seedK, offer(), listOffers(), init("accept-misaddressed", r.accept, "rooms-accept", { recipient: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }, [code("wrongRecipient"), kdone("refused")])],
    allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:wrongRecipient")]) },
  { id: "FC-RMS-009", title: "a wallet whose persona is not an active member of the community asks for its offers: the community refuses it with vtc/rooms/offers/list:notAMember",
    spec: [`${P}vtc/rooms/offers/list/0.4/spec.md (errorCodes: notAMember)`, `${DOC} 4`],
    source: r.offers, ...vp, steps: [init("offers", r.offers, "rooms-offers", undefined, [code("vtc/rooms/offers/list:notAMember"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:notAMember")]) },
  { id: "FC-RMS-010", title: "an outsider's write: the member presents credentials the room issued to someone else: the host refuses the write with the standard permissionDenied and stores nothing",
    spec: [`${P}rooms/records/put/0.3/spec.md (consumer item 12: an unauthorized presentation is refused with the standard permissionDenied)`, `${DOC} 4`],
    source: r.put, ...vp, steps: [...joined, put("put-foreign", { presentation: "foreign" }, [code("permissionDenied"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:permissionDenied"), vst("rooms-records:0")]) },
  { id: "FC-RMS-011", title: "an upload with a manifest that does not add up (the chunk count is not the size over the chunk size): the host refuses it with rooms/blobs/upload/begin:invalidManifest and opens no upload",
    spec: [`${P}rooms/blobs/upload/begin/0.2/spec.md (errorCodes: invalidManifest)`, `${DOC} 4`],
    source: r.begin, ...vp, steps: [...joined, init("begin-bad", r.begin, "rooms-blob-begin", { size: 20000, corrupt: true }, [code("rooms/blobs/upload/begin:invalidManifest"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:invalidManifest"), vst("rooms-uploads:0")]) },
  { id: "FC-RMS-012", title: "the version skew on the community leg: the member asks for its offers at 0.4 of a community that serves 0.3 only: the community names what it serves, the member asks again at 0.3 and reads the offer (a labelled step-down against a legacy profile)",
    spec: [`${P}vtc/rooms/offers/list/0.3 and 0.4 (two served versions of one task)`, "SPEC.md 8.3 (unsupportedVersion)", `${DOC} 5`],
    source: r.offers3, carrier: base.carrier, deadlineMs: base.deadlineMs, reads: base.reads, participants: { K, V: { role: "community", requires: ["optional:trigger.serveVersions"] } },
    steps: [trig("serve-legacy", "serveVersions", { profile: "legacy" }), seedK, offer(), init("offers", r.offers3, "rooms-offers", undefined, [code("unsupportedVersion"), kdone("completed"), kst("rooms:offers:1"), kst("rooms:offers-version:0.3")]), trig("serve-current", "serveVersions", { profile: "current" })], allowedTerminals: ["completed"], completion: done([kst("rooms:offers-version:0.3")]) },
  { id: "FC-RMS-013", title: "the member asks its agent which rooms it holds keys for (rooms/keys/list 0.2): the agent holds none (an open room has no group)",
    spec: [`${P}rooms/keys/list/0.2/spec.md (the rooms the key holder can open; an open room is not one)`, `${DOC} 3`],
    source: r.keys, ...ap, steps: [initA("keys-list", r.keys, "rooms-keys-list", undefined, [kdone("completed"), kst("rooms:keys:0")])], allowedTerminals: ["completed"], completion: done([kst("rooms:keys:0")]) },
  { id: "FC-RMS-014", title: "the member asks its agent for a KeyPackage against a well-formed invitation credential that no room issued (it parses and does not verify): the agent refuses with rooms/keys/key-package:notInvited and mints nothing",
    spec: [`${P}rooms/keys/key-package/0.2/spec.md (consumer item 1: refuse an invitation that does not verify with notInvited)`, `${DOC} 4`],
    source: r.kp, ...ap, steps: [initA("key-package", r.kp, "rooms-key-package", { invitation: "foreign" }, [code("rooms/keys/key-package:notInvited"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:notInvited")]) },
  { id: "FC-RMS-015", title: "the member asks its agent to complete, as the member, a request whose type is not one of the host-bound requests the task acts for: the agent refuses with rooms/keys/act:typeNotActable and signs nothing",
    spec: [`${P}rooms/keys/act/0.9/spec.md (errorCodes: typeNotActable)`, `${DOC} 4`],
    source: r.act, ...ap, steps: [initA("act-other-type", r.act, "rooms-act", { actType: "rooms/keys/list/0.2" }, [code("rooms/keys/act:typeNotActable"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:typeNotActable")]) },
  { id: "FC-RMS-016", title: "the member asks its agent to complete a write naming the member's DID as issuer, where the agent holds the keys of no such member: the agent refuses with rooms/keys/act:issuerNotPrincipal (the issuer is not a member it may act as for its caller) and signs nothing",
    spec: [`${P}rooms/keys/act/0.9/spec.md (errorCodes: issuerNotPrincipal; recipient: a named issuer the key holder may not act as; notAMember is the answer when no issuer is named and no member can be acted as, which the wallet never sends)`, `${DOC} 4`],
    source: r.act, ...ap, steps: [initA("act-no-membership", r.act, "rooms-act", { actType: "rooms/records/put/0.3" }, [code("rooms/keys/act:issuerNotPrincipal"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:issuerNotPrincipal")]) },
  { id: "FC-RMS-017", title: "the version skew on the agent leg: the member asks its agent to act at 0.9 of an agent that serves 0.8 only: the agent names what it serves, the member asks again at 0.8 (a labelled step-down against a legacy profile)",
    spec: [`${P}rooms/keys/act/0.8 and 0.9 (versions of one task; the wallet's ladder is 0.9, 0.8, 0.6, 0.5)`, "SPEC.md 8.3 (unsupportedVersion)", `${DOC} 5`],
    source: r.act8, carrier: base.carrier, deadlineMs: base.deadlineMs, reads: base.reads, participants: { K, A: { role: "agent", requires: ["optional:trigger.serveVersions"] } },
    steps: [trig("serve-legacy", "serveVersions", { profile: "legacy" }, "A"), initA("act", r.act8, "rooms-act", { actType: "rooms/records/put/0.3" }, [code("unsupportedVersion"), code("rooms/keys/act:issuerNotPrincipal"), kdone("refused")]), trig("serve-current", "serveVersions", { profile: "current" }, "A")], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:issuerNotPrincipal")]) },
  { id: "FC-RMS-018", title: "the member asks its agent for a KeyPackage against text that is not a credential at all: the specification names one refusal for an invitation that does not verify (notInvited); a platform that refuses it earlier as a malformed request is a difference the run records, not a failure of the scenario's reading",
    spec: [`${P}rooms/keys/key-package/0.2/spec.md (consumer item 1: refuse an invitation that does not verify with notInvited; the schema types the field as the credential serialized per the governing profile)`, `${DOC} 4`],
    source: r.kp, ...ap, steps: [initA("key-package-text", r.kp, "rooms-key-package", { invitation: "not-a-credential" }, [code("rooms/keys/key-package:notInvited"), kdone("refused")])], allowedTerminals: ["refused"], completion: refused([kst("rooms:refused:notInvited")]) },
];

export const roomsFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-RMS", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Rooms: an open room offered by the community, joined, written to and uploaded to, with the member's agent as key holder (wallet, community, agent)", channel: "proposed", choreography: "docs/32-rooms-ballot-ceremonies.md sections 3 to 5: offers, accept, memberships, a write, an upload, the refusals (replay, versionConflict, expired, wrong recipient, not a member, outsider, invalid manifest, not invited, type not actable, issuer not a principal) and two version step-downs. Open tier only." },
  scenarios,
};
export const roomsFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-rms.json", data: roomsFile }];