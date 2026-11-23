// SPDX-License-Identifier: Apache-2.0
// Authoring source of the directory group (docs/31): a member's wallet (keyring-wallet, `K`) against the community's member directory (VTI's VTC, `V`). Imported by
// scripts/generate-ceremony-scenarios.ts. Every step cites the Trust Tasks specification of the document it sends. The choreography around the tasks is the suite's own proposal
// (channel `proposed`); the result of a run is evidence of kind complete-ceremony, never a conformance count. The second member who writes a card and reads entries is the community's
// own member driven through its `trigger` `dirMember` (class D: the wallet's directory client reads and sets a name; it never sets a visibility or hides a listing).
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const B = ed25519Signer(seedOf(0x61)).did;
const step = (s: ScenarioStep): ScenarioStep => s;
const parts = (extra: string[] = []) => ({ K: { role: "member-phone", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"] }, V: { role: "community", requires: extra } });
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[], extra: Partial<NonNullable<ScenarioStep["do"]["initiate"]>> = {}): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }), ...extra } }, expect });
const trig = (id: string, action: string, args: Record<string, unknown>, expect?: Check[]): ScenarioStep => step({ id, do: { decide: { by: "V", action, args } }, ...(expect === undefined ? {} : { expect }) });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const kst = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });
const vst = (kind: string, count = 1): Check => ({ at: "V", stored: { kind, count } });
const code = (c: string, count = 1): Check => ({ at: "K", received: { code: c, count } });
const d = { fields: src("vtc/directory/fields/list", "0.1"), show: src("vtc/directory/card/show", "0.1"), update: src("vtc/directory/card/update", "0.1"), list: src("vtc/directory/entries/list", "0.2"), entry: src("vtc/directory/entries/show", "0.1"), query: src("vtc/directory/query", "0.1") };
const P = "TF specs/vtc/directory/";
const DOC = "docs/31-persona-rooms-elections-ceremonies.md section 5";
const required = [`${S}vtc/directory/fields/list/0.1`, `${S}vtc/directory/card/show/0.1`, `${S}vtc/directory/card/update/0.1`, `${S}vtc/directory/entries/list/0.2`, `${S}vtc/directory/entries/show/0.1`, `${S}vtc/directory/query/0.1`];
const db = { ...base, participants: parts(required) };
const seedK = trig("seed-member", "seedMember", { vid: "$K" });
const myCard = (id = "my-card", extra: Check[] = []) => init(id, d.show, "dir-my-card", undefined, [kdone("completed"), ...extra]);
const setName = (id: string, name: string, extra: Check[] = [], args: Record<string, unknown> = {}) => init(id, d.update, "dir-set-name", { name, ...args }, [kdone("completed"), ...extra]);
const bUpdate = (id: string, args: Record<string, unknown>, expect: Check[] = []) => trig(id, "dirMember", { op: "update", ...args }, expect);
const bView = (id: string, expect: Check[], target = "$K") => trig(id, "dirMember", { op: "view", target }, expect);
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });
const bea = { displayName: "Bea Reader", pronouns: "she/her", bio: "private bio" };

const ownCard: Scenario = {
  id: "FC-DIR-001", title: "a member reads the community's directory schema and its own card before it has written anything: the card exists at revision 0, names the required name still missing, and the schema lists the base fields",
  spec: [`${P}card/show/0.1/spec.md (consumer items 1 and 3: a card is created for every member, never absent, revision 0; missingRequired names the required fields with no value)`, `${P}fields/list/0.1/spec.md (consumer item 2: every base field is returned to a member)`, DOC],
  source: d.show, ...db,
  steps: [seedK, myCard("my-card", [kst("dir-my:revision:0"), kst("dir-my:missing:displayName"), kst("dir-fields:displayName"), kst("dir-fields:did")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-my:revision:0")]),
};
const nameThenSeen: Scenario = {
  id: "FC-DIR-002", title: "a member writes its name on its card: the card is at revision 1 with the name, the administrator sees the name, and another member browsing finds the entry and reads the name but not the derived DID field, whose default audience is administrators",
  spec: [`${P}card/update/0.1/spec.md (consumer item 8: revision incremented; the signed update is in force)`, `${P}entries/list/0.2/spec.md and entries/show/0.1/spec.md (the projection: the member's visibility, or the field's default, intersected with the ceiling; a withheld field is absent, never null)`, `${P}fields/list/0.1/spec.md (worked example: displayName default visibility members; did default visibility admins)`, DOC],
  source: d.update, ...db,
  steps: [seedK, myCard(), setName("set-name", "Kai Ceremony", [kst("dir-my:revision:1"), kst("dir-my:name:Kai Ceremony")]), bView("other-member-views", [vst("dir-b:code:ok"), vst("dir-b:inList"), vst("dir-b:field:displayName"), vst("dir-b:field:did", 0)])],
  allowedTerminals: ["completed"], completion: done([vst("dir-admin-has:displayName:$K")]),
};
const incomplete: Scenario = {
  id: "FC-DIR-003", title: "a card that lacks its required name is not listed whatever its listing says: another member browsing does not find it, and after the name is written the entry is listed",
  spec: [`${P}card/show/0.1/spec.md (missingRequired: while any is missing the entry is not listed)`, `${P}entries/list/0.2/spec.md (consumer item 2: browsing returns only listed entries whose required fields are complete)`, DOC],
  source: d.list, ...db,
  steps: [seedK, myCard("my-card", [kst("dir-my:missing:displayName")]), bView("view-before-name", [vst("dir-b:inList", 0)]), setName("set-name", "Kai Ceremony"), bView("view-after-name", [vst("dir-b:inList", 1)])],
  allowedTerminals: ["completed"], completion: done([kst("dir-my:missing-none")]),
};
const readOther: Scenario = {
  id: "FC-DIR-004", title: "the wallet reads another member's entry: the members list names the member, and the entry shows the fields the member chose to show to members (name, pronouns) and not the one it kept for administrators (bio)",
  spec: [`${P}entries/list/0.2/spec.md (browse; the projection)`, `${P}entries/show/0.1/spec.md (the projection is the intersection; a field not returned is absent)`, `${P}card/update/0.1/spec.md (a member's visibility choice per field)`, DOC],
  source: d.entry, ...db,
  steps: [seedK, bUpdate("other-writes-card", { values: bea, visibility: { bio: "admins", pronouns: "members" } }, [vst("dir-b:update:ok")]),
    init("list-members", d.list, "dir-list-members", undefined, [kdone("completed"), kst("dir-members:has-name:Bea Reader")]),
    init("show-member", d.entry, "dir-show-member", { target: "Bea Reader" }, [kdone("completed"), kst("dir-seen:name:Bea Reader"), kst("dir-seen:line:pronouns"), kst("dir-seen:line:bio", 0)])],
  allowedTerminals: ["completed"], completion: done([kst("dir-seen:line:bio", 0)]),
};
const narrowing: Scenario = {
  id: "FC-DIR-005", title: "a member narrows a field it had shown to members: from the moment the update executes the wallet's next read of the entry no longer has that field, and the name it still shows is unchanged",
  spec: [`${P}card/update/0.1/spec.md (consumer item 9: apply a narrowing in every projection from the moment it executes)`, `${P}entries/show/0.1/spec.md (the projection)`, DOC],
  source: d.update, ...db,
  steps: [seedK, bUpdate("other-writes-card", { values: bea, visibility: { pronouns: "members" } }, [vst("dir-b:update:ok")]),
    init("list-members", d.list, "dir-list-members", undefined, [kdone("completed")]),
    init("show-before", d.entry, "dir-show-member", { target: "Bea Reader", list: false }, [kdone("completed"), kst("dir-seen:line:pronouns")]),
    bUpdate("other-narrows", { visibility: { pronouns: "admins" } }, [vst("dir-b:update:ok", 2)]),
    init("show-after", d.entry, "dir-show-member", { target: "Bea Reader", list: false }, [kdone("completed"), kst("dir-seen:line:pronouns", 0), kst("dir-seen:name:Bea Reader")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-seen:line:pronouns", 0)]),
};
const hidden: Scenario = {
  id: "FC-DIR-006", title: "a member chooses the hidden listing: the members list no longer names it, and the wallet opening the entry by the id it kept is answered notFound (the wallet reads no entry)",
  spec: [`${P}card/update/0.1/spec.md (consumer item 6: any listing, including hidden, is accepted from any member)`, `${P}entries/list/0.2/spec.md (a hidden entry is never returned to a non-administrator)`, `${P}entries/show/0.1/spec.md (consumer item 3: a member who chose hidden is notFound to another member, even by entryId)`, DOC],
  source: d.entry, ...db,
  steps: [seedK, bUpdate("other-writes-card", { values: { displayName: "Bea Reader" } }, [vst("dir-b:update:ok")]),
    init("list-members", d.list, "dir-list-members", undefined, [kdone("completed"), kst("dir-members:has-name:Bea Reader")]),
    bUpdate("other-hides", { listing: "hidden" }, [vst("dir-b:update:ok", 2)]),
    init("list-again", d.list, "dir-list-members", undefined, [kdone("completed"), kst("dir-members:has-name:Bea Reader", 0)]),
    init("show-hidden", d.entry, "dir-show-member", { target: "Bea Reader", list: false }, [kdone("completed"), kst("dir-seen:none"), code("vtc/directory/entries/show:notFound")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-seen:none")]),
};
const withheld: Scenario = {
  id: "FC-DIR-007", title: "a member shows its name to administrators only: asked by DID with a name hint the community shows the wallet no name, and a member asking for a field that is withheld from it is answered notFound, not an empty projection",
  spec: [`${P}query/0.1/spec.md (a withheld field is absent; where the subject exists but nothing requested is visible, notFound rather than an empty projection)`, `${P}card/update/0.1/spec.md (a visibility per field)`, DOC],
  source: d.query, ...db,
  steps: [seedK, myCard(), bUpdate("other-writes-card", { values: { displayName: "Bea Reader" }, visibility: { displayName: "admins" } }, [vst("dir-b:update:ok")]),
    init("lookup-name", d.query, "dir-lookup-name", { subject: B }, [kdone("completed"), kst("dir-lookup:none")]),
    init("card-by-did", d.query, "dir-member-by-did", { subject: B }, [kdone("completed"), kst("dir-seen:line:displayName", 0)]),
    trig("other-asks-withheld", "dirMember", { op: "query", target: "$K", fields: "did" }, [vst("dir-b:code:vtc/directory/query:notFound")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-lookup:none")]),
};
const stale: Scenario = {
  id: "FC-DIR-008", title: "a member's name update that names a revision the card has moved past is refused (superseded): the wallet reads its own conflict, and the card still has the earlier name at revision 1",
  spec: [`${P}card/update/0.1/spec.md (consumer item 2: refuse with superseded, changing nothing, when expectedRevision differs from the card's revision)`, DOC],
  source: d.update, ...db,
  steps: [seedK, myCard(), setName("set-name", "Kai One", [kst("dir-my:revision:1")]), setName("set-name-stale", "Kai Two", [kst("dir-conflict"), code("vtc/directory/card/update:superseded")], { expectedRevision: "stale" }), myCard("re-read", [kst("dir-my:name:Kai One"), kst("dir-my:revision:1")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-my:name:Kai One")]),
};
const nonMember: Scenario = {
  id: "FC-DIR-009", title: "a wallet whose persona is not a member of the community asks for its card: refused (card/show:notMember), and the members list is refused too",
  spec: [`${P}card/show/0.1/spec.md (consumer item 1: refuse with notMember when the signer is not an active member)`, `${P}entries/list/0.2/spec.md (consumer item 1: refuse a caller who is neither an active member nor an administrator with permissionDenied)`, DOC],
  source: d.show, ...db,
  steps: [init("my-card", d.show, "dir-my-card", undefined, [code("vtc/directory/card/show:notMember"), kdone("refused")]), init("list-members", d.list, "dir-list-members", undefined, [code("permissionDenied"), kdone("refused")])],
  allowedTerminals: ["refused"], completion: refused([kst("dir-refused:permissionDenied")]),
};
const refusals: Scenario = {
  id: "FC-DIR-010", title: "a member's update that names a field the schema does not have, writes a derived field, or widens a field above its ceiling is refused with the task's own code each time (fieldUnknown, fieldNotWritable, aboveCeiling), and none of it is clamped or applied",
  spec: [`${P}card/update/0.1/spec.md (consumer items 3 and 4: fieldNotWritable for a non-member-sourced value, fieldUnknown, aboveCeiling; a too-wide visibility is never clamped silently)`, `${P}fields/list/0.1/spec.md (the derived did field has the ceiling members)`, DOC],
  source: d.update, ...db,
  steps: [seedK, myCard(), bUpdate("other-writes-card", { values: { displayName: "Bea Reader" } }, [vst("dir-b:update:ok")]),
    bUpdate("unknown-field", { values: { "org.example.nothing": "x" } }, [vst("dir-b:update:vtc/directory/card/update:fieldUnknown")]),
    bUpdate("derived-field", { values: { role: "admin" } }, [vst("dir-b:update:vtc/directory/card/update:fieldNotWritable")]),
    bUpdate("above-ceiling", { visibility: { did: "public" } }, [vst("dir-b:update:vtc/directory/card/update:aboveCeiling")])],
  allowedTerminals: ["completed"], completion: done([vst("dir-b:update:ok", 1)]),
};
const replays: Scenario = {
  id: "FC-DIR-011", title: "the wallet's signed card update is delivered again unchanged, with a value changed after signing, and with its proof removed: the unchanged copy does not apply a second change, the changed and unsigned copies are refused (proofInvalid, proofRequired), and the card stays at revision 1",
  spec: [`${P}card/update/0.1/spec.md (proofRequirement REQUIRED; consumer item 8: one change in force per document id)`, "SPEC.md 7.2 (a document whose proof does not verify, or that carries none where one is REQUIRED, is refused; a repeated id is not executed twice)", DOC],
  source: d.update, ...db,
  steps: [seedK, myCard(), setName("set-name", "Kai Ceremony", [kst("dir-my:revision:1")]),
    step({ id: "replay-same", source: d.update, do: { replay: { step: "set-name", by: "K", to: "V", mode: "same", index: 1 } }, expect: [] }),
    step({ id: "replay-tampered", source: d.update, do: { replay: { step: "set-name", by: "K", to: "V", mode: "tamper", index: 1 } }, expect: [{ reply: { code: "proofInvalid" } }] }),
    step({ id: "replay-no-proof", source: d.update, do: { replay: { step: "set-name", by: "K", to: "V", mode: "stripProof", index: 1 } }, expect: [{ reply: { code: "proofRequired" } }] }),
    myCard("re-read", [kst("dir-my:revision:1"), kst("dir-my:name:Kai Ceremony")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-my:revision:1")]),
};
const wrongRecipient: Scenario = {
  id: "FC-DIR-012", title: "the wallet addresses its card read to a different community than the one that receives it: the community refuses it (wrongRecipient) and creates no card for the member",
  spec: [`${P}card/show/0.1/spec.md (parties: the community maintainer is the recipient)`, "SPEC.md 8.3 (wrongRecipient: the document's recipient does not identify the receiving consumer)", DOC],
  source: d.show, ...db,
  steps: [seedK, init("my-card-misaddressed", d.show, "dir-my-card", { recipient: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }, [code("wrongRecipient"), kdone("refused")])],
  allowedTerminals: ["refused"], completion: refused(),
};
const stepDown: Scenario = {
  id: "FC-DIR-013", title: "the version skew: the wallet asks for the members list at 0.2 of a community that serves 0.1 only: the community names what it serves (unsupportedVersion), the wallet's own ladder asks again at 0.1, and the list is read (a labelled step-down against a legacy profile; a community serving 0.2 is not asked to)",
  spec: [`${P}entries/list/0.1 and 0.2 (two served versions of one task)`, "SPEC.md 8.3 (unsupportedVersion names what the consumer serves; asking again in a served version is a first request)", DOC],
  source: d.list, carrier: base.carrier, deadlineMs: base.deadlineMs, reads: base.reads, participants: parts(["optional:trigger.serveVersions"]),
  steps: [trig("serve-legacy", "serveVersions", { profile: "legacy" }), seedK, bUpdate("other-writes-card", { values: { displayName: "Bea Reader" } }, [vst("dir-b:update:ok")]),
    init("list-members", d.list, "dir-list-members", undefined, [code("unsupportedVersion"), kdone("completed"), kst("dir-members:has-name:Bea Reader")])],
  allowedTerminals: ["completed"], completion: done([kst("dir-members:has-name:Bea Reader")]),
};
export const dirFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-DIR", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Member directory (wallet and community)", channel: "proposed", choreography: "docs/31-persona-rooms-elections-ceremonies.md section 5: a member reads the schema and its own card, writes a name, another member (a stand-in for the community's own) browses and reads the entry under the member's visibility, writes a card of its own with its own visibility choices, narrows and hides it; the wallet reads the other member's entry. Negatives: stale revision, non-member, unknown, derived and too-wide fields, replay, tamper, no proof, wrong recipient. The step-down runs against a legacy profile only. Images, groups, connections, introductions, facets and paging are not exercised." },
  scenarios: [ownCard, nameThenSeen, incomplete, readOther, narrowing, hidden, withheld, stale, nonMember, refusals, replays, wrongRecipient, stepDown],
};
export const directoryFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-dir.json", data: dirFile }];
