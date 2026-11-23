// SPDX-License-Identifier: Apache-2.0
// Authoring source of the onboarding and vetting-directory groups (docs/30): a member's wallet (keyring-wallet, `K`) against the community (VTI's VTC, `V`). Imported by
// scripts/generate-ceremony-scenarios.ts. Every step cites the Trust Tasks specification of the document it sends. The choreography around the tasks is the suite's own proposal
// (channel `proposed`); the result of a run is evidence of kind complete-ceremony, never a conformance count. The administrator's decision and a vetter grant are the community's
// own out-of-band acts, injected through the community participant's `trigger` (the administrator is the community's own console, never a wallet).
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
const K_REQ = ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"];
const parts = (extra: string[] = [], kExtra: string[] = []) => ({ K: { role: "member-phone", requires: [...K_REQ, ...kExtra] }, V: { role: "community", requires: extra } });
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[], extra: Partial<NonNullable<ScenarioStep["do"]["initiate"]>> = {}): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }), ...extra } }, expect });
const trig = (id: string, action: string, args: Record<string, unknown>): ScenarioStep => step({ id, do: { decide: { by: "V", action, args } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const stored = (kind: string, count: number): Check => ({ at: "V", stored: { kind, count } });
const code = (c: string, count = 1): Check => ({ at: "K", received: { code: c, count } });
const kstored = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });

const j = { manifest: src("vtc/join-requests/manifest", "0.4"), submit: src("vtc/join-requests/submit", "0.3"), status: src("vtc/join-requests/status", "0.1"), withdraw: src("vtc/join-requests/withdraw", "0.1"), supplement: src("vtc/join-requests/supplement", "0.1"), decide: src("vtc/join-requests/decide", "0.1") };
const JM = "TF specs/vtc/join-requests/manifest/0.4/spec.md", JS = "TF specs/vtc/join-requests/submit/0.3/spec.md", JT = "TF specs/vtc/join-requests/status/0.1/spec.md", JW = "TF specs/vtc/join-requests/withdraw/0.1/spec.md", JD = "TF specs/vtc/join-requests/decide/0.1/spec.md";
const DEF = "TF ceremonies/vtc/member-onboarding/0.1/ceremony.json (the definition cites submit and manifest 0.1; the retired vtc/join-requests/submit/0.1 stays a documented step of it and is not claimed here: these scenarios run submit 0.3 and manifest 0.4, the versions the platforms serve)";
const DOC = "docs/30-onboarding-vetting-ceremonies.md section 3";
const joinRequires = [`${S}vtc/join-requests/manifest/0.4`, `${S}vtc/join-requests/submit/0.3`, `${S}vtc/join-requests/status/0.1`, `${S}vtc/join-requests/withdraw/0.1`, `${S}vtc/join-requests/decide/0.1`];
const jb = { ...base, participants: parts(joinRequires) };
const know = trig("know-applicant", "knowApplicant", { vid: "$K" });
const A = (id = "apply", extra: Check[] = [], args: Record<string, unknown> = {}) => init(id, j.submit, "join-apply", args, [kdone("completed"), ...extra]);
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });

const approve: Scenario = {
  id: "FC-MBR-001", title: "the applicant's wallet reads the community's criteria, applies under the review criterion, the community queues the request for its administrator, the administrator approves, and the wallet's status poll reads approved: the community holds one approved request and the applicant as a member",
  spec: [DEF, `${JM} (the applicant reads the criteria first)`, `${JS} (the community decides the submission under the criterion it names and answers a referral naming the request)`, `${JT} (the applicant polls only its own request)`, `${JD} (approved admits the applicant as a member)`, DOC],
  source: j.submit, ...jb,
  steps: [know,
    init("discover", j.manifest, "join-manifest", undefined, [kdone("completed")]),
    A("apply", [stored("join-request:pending", 1), stored("join-request", 1), stored("member:$K", 0)]),
    init("status-pending", j.status, "join-status", undefined, [kdone("completed"), kstored("join-status:pending")]),
    step({ id: "approve", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "latest" } } }, expect: [stored("join-request:approved", 1), stored("member:$K", 1), stored("admin:decide:ok", 1), stored("pushed:credential-exchange/issue", 2)] }),
    init("status-approved", j.status, "join-status", undefined, [kdone("completed"), kstored("join-status:approved")]),
  ],
  allowedTerminals: ["completed"], completion: done([stored("member:$K", 1), stored("join-request:approved", 1)]),
};
const reject: Scenario = {
  id: "FC-MBR-002", title: "the administrator rejects with a reason: the wallet's status poll reads rejected with that reason, the applicant is not a member, and the community holds one rejected request",
  spec: [DEF, `${JD} (rejected refuses the applicant and records the reason; the reason is relayed to the applicant by status)`, `${JT} (the rejected answer carries code, reason and decidedAt)`, DOC],
  source: j.decide, ...jb,
  steps: [know, A(), step({ id: "reject", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "rejected", request: "latest", reason: "not now" } } }, expect: [stored("join-request:rejected", 1), stored("admin:decide:ok", 1)] }),
    init("status-rejected", j.status, "join-status", undefined, [kdone("completed"), kstored("join-status:rejected"), kstored("join-status-reason:not now")])],
  allowedTerminals: ["completed"], completion: done([stored("member:$K", 0), stored("join-request:rejected", 1)]),
};
const withdraw: Scenario = {
  id: "FC-MBR-003", title: "the applicant withdraws its open request: the request reads withdrawn, a status poll naming it afterwards reads withdrawn, and the applicant may apply again",
  spec: [DEF, `${JW} (closes the applicant's own open request and frees it to apply again)`, `${JT} (status enum: pending, deferred, approved, rejected, withdrawn)`, DOC],
  source: j.withdraw, ...jb,
  steps: [know, A("apply", [stored("join-request:pending", 1)]),
    init("withdraw", j.withdraw, "join-withdraw", undefined, [kdone("completed"), stored("join-request:withdrawn", 1), stored("join-request:pending", 0)]),
    init("status-after", j.status, "join-status", undefined, [kdone("completed"), kstored("join-status:withdrawn")]),
    A("apply-again", [stored("join-request:pending", 1), stored("join-request", 2)])],
  allowedTerminals: ["completed"], completion: done([stored("join-request:withdrawn", 1), stored("join-request:pending", 1)]),
};
const twice: Scenario = {
  id: "FC-MBR-004", title: "an applicant with a request already open applies again: the community refuses the second submission (vtc/join-requests/submit:requestAlreadyOpen, naming the open request) and still holds one request",
  spec: [DEF, `${JS} (a community holds one open request per applicant; the consumer-minted code is `+"`requestAlreadyOpen` under the slug of the request, SPEC 8.5)", DOC],
  source: j.submit, ...jb,
  steps: [know, A("apply", [stored("join-request:pending", 1)]), init("apply-second", j.submit, "join-apply", undefined, [code("vtc/join-requests/submit:requestAlreadyOpen"), kdone("refused"), stored("join-request", 1)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 1), stored("join-request:pending", 1)]),
};
const stepDown: Scenario = {
  id: "FC-MBR-005", title: "the version skew: the wallet submits at 0.2 (an older community's version) to a community that serves 0.3 only: the community refuses at dispatch with unsupportedVersion naming what it serves, the wallet's own handling reads the criteria again and submits at 0.3, and exactly one request is held",
  spec: [`${JS} (served version 0.3; the older 0.2 is not served)`, "SPEC.md 8.3 (unsupportedVersion: the request was not taken, so asking again in the served version is the first submission)", DEF, DOC],
  source: j.submit, ...jb,
  steps: [know, init("apply-at-0-2", j.submit, "join-apply", { wire: "0.2" }, [code("unsupportedVersion"), kdone("completed"), stored("join-request:pending", 1), stored("join-request", 1)])],
  allowedTerminals: ["completed"], completion: done([stored("join-request", 1)]),
};
const replaySame: Scenario = {
  id: "FC-MBR-006", title: "the wallet's signed submission is delivered again unchanged after the applicant was admitted: the community does not record a second request or admit twice",
  spec: [`${JS} (issuedAt REQUIRED: a replayed submission re-opens a request the applicant no longer has)`, "SPEC.md 7.2 item 11 (a repeated id is not executed twice)", DOC],
  source: j.submit, ...jb,
  steps: [know, A(), step({ id: "approve", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "latest" } } }, expect: [stored("member:$K", 1)] }),
    step({ id: "replay-submit", source: j.submit, do: { replay: { step: "apply", by: "K", to: "V", mode: "same", index: 1 } }, expect: [stored("join-request", 1), stored("join-request:pending", 0), stored("member:$K", 1)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request", 1), stored("join-request:pending", 0)]),
};
const tamper: Scenario = {
  id: "FC-MBR-007", title: "the wallet's signed submission with a payload value changed after signing (fresh id, and its own id) and the same submission with its proof removed: the community refuses all three and records nothing beyond the one request",
  spec: [`${JS} (proofRequirement REQUIRED)`, "SPEC.md 7.2 (a document whose proof does not verify, or that carries none where one is REQUIRED, is refused)", DOC],
  source: j.submit, ...jb,
  steps: [know, A("apply", [stored("join-request", 1)]),
    step({ id: "tampered", source: j.submit, do: { replay: { step: "apply", by: "K", to: "V", mode: "tamper", index: 1 } }, expect: [{ reply: { code: "proofInvalid" } }, stored("join-request", 1)] }),
    step({ id: "conflicting", source: j.submit, do: { replay: { step: "apply", by: "K", to: "V", mode: "conflict", index: 1 } }, expect: [{ reply: { code: "idConflict|proofInvalid" } }, stored("join-request", 1)] }),
    step({ id: "no-proof", source: j.submit, do: { replay: { step: "apply", by: "K", to: "V", mode: "stripProof", index: 1 } }, expect: [{ reply: { code: "proofRequired" } }, stored("join-request", 1)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request", 1)]),
};
const wrongRecipient: Scenario = {
  id: "FC-MBR-008", title: "the wallet addresses its application to a different community than the one that receives it: the community refuses it (wrongRecipient) and records no request",
  spec: [`${JS} (parties: the community maintainer is the recipient)`, "SPEC.md 8.3 (wrongRecipient: the document's recipient does not identify the receiving consumer)", DOC],
  source: j.submit, ...jb,
  steps: [know, init("apply-misaddressed", j.submit, "join-apply", { recipient: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }, [code("wrongRecipient"), kdone("refused"), stored("join-request", 0)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 0)]),
};
const decideUnknown: Scenario = {
  id: "FC-MBR-009", title: "the administrator decides a request id the community never minted: refused with vtc/join-requests/decide:notFound, and the applicant's real request is still pending",
  spec: [`${JD} (errorCodes: vtc/join-requests/decide:notFound)`, DEF, DOC],
  source: j.decide, ...jb,
  steps: [know, A("apply", [stored("join-request:pending", 1)]),
    step({ id: "decide-unknown", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "unknown" } } }, expect: [stored("admin:decide:vtc/join-requests/decide:notFound", 1), stored("join-request:pending", 1), stored("member:$K", 0)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request:pending", 1), stored("member:$K", 0)]),
};
const decideTwice: Scenario = {
  id: "FC-MBR-010", title: "the administrator decides an already approved request again: refused with vtc/join-requests/decide:notPending, and the request stays approved",
  spec: [`${JD} (errorCodes: vtc/join-requests/decide:notPending; a request already decided cannot be re-decided)`, DOC],
  source: j.decide, ...jb,
  steps: [know, A(), step({ id: "approve", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "latest" } } }, expect: [stored("join-request:approved", 1)] }),
    step({ id: "approve-again", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "rejected", request: "latest" } } }, expect: [stored("admin:decide:vtc/join-requests/decide:notPending", 1), stored("join-request:approved", 1), stored("join-request:rejected", 0)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request:approved", 1)]),
};
const outsiderStatus: Scenario = {
  id: "FC-MBR-011", title: "a wallet that never applied polls its status: the community answers vtc/join-requests/status:notFound (an applicant sees only its own request) and holds no request",
  spec: [`${JT} (errorCodes: vtc/join-requests/status:notFound; the poll resolves the request from who signs it)`, DOC],
  source: j.status, ...jb,
  steps: [know, init("status-outsider", j.status, "join-status", undefined, [code("vtc/join-requests/status:notFound"), kdone("completed"), stored("join-request", 0)])],
  allowedTerminals: ["completed"], completion: done([stored("join-request", 0)]),
};
const decideOutsider: Scenario = {
  id: "FC-MBR-012", title: "a member with no administrative authority decides the applicant's request: refused with permissionDenied (the community takes a decision only from its administrators), and the request stays pending",
  spec: [`${JD} (the community-admin capability is verified; permissionDenied otherwise)`, DOC],
  source: j.decide, ...jb,
  steps: [know, A("apply", [stored("join-request:pending", 1)]),
    step({ id: "decide-by-member", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "latest", as: "member" } } }, expect: [stored("admin:decide:permissionDenied", 1), stored("join-request:pending", 1), stored("member:$K", 0)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request:pending", 1), stored("member:$K", 0)]),
};
const foreignHolder: Scenario = {
  id: "FC-MBR-013", title: "an application whose presentation names another holder than the document's signer is refused with vtc/join-requests/submit:presentationInvalid: no request is recorded",
  spec: [`${JS} (the presentation must be the applicant's own; errorCodes: vtc/join-requests/submit:presentationInvalid)`, DOC],
  source: j.submit, ...base, participants: parts(joinRequires, ["optional:initiate.foreignPresentation"]),
  steps: [know, init("apply-foreign", j.submit, "join-apply-foreign", undefined, [code("vtc/join-requests/submit:presentationInvalid"), kdone("refused"), stored("join-request", 0)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 0)]),
};
const stale: Scenario = {
  id: "FC-MBR-014", title: "the wallet's clock is two hours behind when it signs its application: the community refuses the stale document and records no request",
  spec: [`${JS} (issuedAtRequirement REQUIRED)`, "SPEC.md 7.2 (the receiver's acceptance window)", DOC],
  source: j.submit, ...jb,
  steps: [know, step({ id: "clock-back", do: { decide: { by: "K", action: "clockOffset", args: { seconds: -7200 } } } }),
    init("apply-stale", j.submit, "join-apply", undefined, [kdone("refused"), stored("join-request", 0)]),
    step({ id: "clock-restore", do: { decide: { by: "K", action: "clockOffset", args: { seconds: 0 } } } })],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 0)]),
};
const idless: Scenario = {
  id: "FC-MBR-015", title: "an applicant that never received its request id (its first answer was lost) polls after the administrator rejected it: the answer must not leave it believing the request is pending or approved: it reads rejected, or the community's notFound",
  spec: [`${JT} (requestId is optional: an applicant whose first reply was lost polls from its own DID; a refusal they cannot ask about is a refusal they cannot act on; the refusal members only with rejected)`, `${JT} (the id-less form resolves the applicant's request from the proof signer)`, DOC],
  source: j.status, ...jb,
  steps: [know, A(), step({ id: "reject", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "rejected", request: "latest", reason: "not now" } } }, expect: [stored("join-request:rejected", 1)] }),
    init("status-idless", j.status, "join-status", { idless: true }, [kdone("completed"), kstored("join-status-not-misleading")])],
  allowedTerminals: ["completed"], completion: done([stored("join-request:rejected", 1)]),
};
const supplementPending: Scenario = {
  id: "FC-MBR-016", title: "the applicant supplements a request that is pending, not awaiting evidence: refused with vtc/join-requests/supplement:notAwaitingEvidence, and the request is unchanged",
  spec: [`TF specs/vtc/join-requests/supplement/0.1/spec.md (errorCodes: vtc/join-requests/supplement:notAwaitingEvidence)`, DOC],
  source: j.supplement, ...jb,
  steps: [know, A("apply", [stored("join-request:pending", 1)]), init("supplement", j.supplement, "join-supplement", undefined, [code("vtc/join-requests/supplement:notAwaitingEvidence"), kdone("refused"), stored("join-request:pending", 1), stored("join-request", 1)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 1)]),
};
const supplementOutsider: Scenario = {
  id: "FC-MBR-017", title: "a wallet that never applied supplements a request: refused with vtc/join-requests/supplement:notFound (an applicant supplements only its own request) and the community holds no request",
  spec: [`TF specs/vtc/join-requests/supplement/0.1/spec.md (errorCodes: vtc/join-requests/supplement:notFound)`, DOC],
  source: j.supplement, ...jb,
  steps: [know, init("supplement-outsider", j.supplement, "join-supplement", undefined, [code("vtc/join-requests/supplement:notFound"), kdone("refused"), stored("join-request", 0)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 0)]),
};
export const mbrFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-MBR", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Community member onboarding (wallet and community)", channel: "proposed", choreography: "docs/30-onboarding-vetting-ceremonies.md section 3: the criteria, the application, the administrator's decision (the community's own act), the applicant's poll, withdrawal; negatives for a replay, a tampered or unsigned submission, a wrong recipient, an unknown or repeated decision, an outsider's poll and decision, a foreign presentation, a stale clock; the version skew of submit 0.2 against 0.3." },
  scenarios: [approve, reject, withdraw, twice, stepDown, replaySame, tamper, wrongRecipient, decideUnknown, decideTwice, outsiderStatus, decideOutsider, foreignHolder, stale, idless, supplementPending, supplementOutsider],
};

// ======================================================================================================================================== FC-IDV
// The community's part of identity vetting: the vetter directory and revocation. The peer leg (vetting/request, session, attestation, decline) is between an applicant and a vetter and
// is served by no VTI service (docs/30 section 4); its scenarios are the reference ones (FC-VET).
const v = { list: src("vtc/vetting/vetters/list", "0.1"), profile: src("vtc/vetting/vetters/profile", "0.1"), grant: src("vtc/vetting/vetters/grant", "0.1"), show: src("vtc/vetting/vetters/show", "0.1"), revoke: src("vtc/vetting/revoke-statement", "0.1") };
const VP = "TF specs/vtc/vetting/vetters/profile/0.1/spec.md", VL = "TF specs/vtc/vetting/vetters/list/0.1/spec.md", VG = "TF specs/vtc/vetting/vetters/grant/0.1/spec.md", VS = "TF specs/vtc/vetting/vetters/show/0.1/spec.md", VR = "TF specs/vtc/vetting/revoke-statement/0.1/spec.md";
const DOC4 = "docs/30-onboarding-vetting-ceremonies.md section 4";
const vReq = [`${S}vtc/vetting/vetters/profile/0.1`, `${S}vtc/vetting/vetters/list/0.1`];
const vb = { ...base, participants: parts(vReq) };
const vbDir = { ...base, participants: parts(vReq, ["optional:initiate.vetterDirectory"]) };
const grantK = trig("grant-vetter", "grantVetter", { vid: "$K" });
const listed: Scenario = {
  id: "FC-IDV-001", title: "an administrator makes a member a vetter, the vetter publishes a listed profile with its wallet, and the community's vetter listing then names the vetter",
  spec: [`${VG} (an administrator makes a member a vetter)`, `${VP} (a vetter publishes a profile; listed true appears in the listing)`, `${VL} (only listed vetters with a live grant appear)`, DOC4],
  source: v.profile, ...vb,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, init("publish", v.profile, "vetter-profile", { listed: true }, [kdone("completed"), stored("vetter:$K", 1)])],
  allowedTerminals: ["completed"], completion: done([stored("vetter:$K", 1)]),
};
const unlisted: Scenario = {
  id: "FC-IDV-002", title: "the vetter unlists its profile: the profile replaces the stored one as a whole and the vetter no longer appears in the listing",
  spec: [`${VP} (the payload is the whole profile; listed false keeps the profile but removes it from the listing)`, `${VL}`, DOC4],
  source: v.profile, ...vb,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, init("publish", v.profile, "vetter-profile", { listed: true }, [kdone("completed"), stored("vetter:$K", 1)]),
    init("unlist", v.profile, "vetter-profile", { listed: false }, [kdone("completed"), stored("vetter:$K", 0)])],
  allowedTerminals: ["completed"], completion: done([stored("vetter:$K", 0)]),
};
const noGrant: Scenario = {
  id: "FC-IDV-003", title: "a member with no vetter grant publishes a profile: the community refuses it and the member is not listed",
  spec: [`${VP} (the community stores a profile only for a member holding a live vetter grant)`, `${VL} (only members with a live vetter grant appear)`, DOC4],
  source: v.profile, ...vb,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), init("publish-without-grant", v.profile, "vetter-profile", { listed: true }, [kdone("refused"), stored("vetter:$K", 0)])],
  allowedTerminals: ["refused"], completion: refused([stored("vetter:$K", 0)]),
};
const showLive: Scenario = {
  id: "FC-IDV-004", title: "the member asks the community about a vetter by DID: a granted vetter reads live and a DID that holds no grant reads none",
  spec: [`${VS} (the answer is the state of the vetter's grant: live, revoked, expired or none)`, DOC4],
  source: v.show, ...vbDir,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, init("show-live", v.show, "vetters-show", { vetterDid: "$K" }, [kdone("completed"), kstored("show-status:live")]), init("show-none", v.show, "vetters-show", { vetterDid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" }, [kdone("completed"), kstored("show-status:none")])],
  allowedTerminals: ["completed"], completion: done(),
};
const revokeOnce: Scenario = {
  id: "FC-IDV-005", title: "a vetter withdraws a statement it issued: the community records the notice and answers the time it recorded; the same notice sent again is answered with the original time",
  spec: [`${VR} (the response is the time the community recorded the notice; repeating a notice returns the original time)`, DOC4],
  source: v.revoke, ...vbDir,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, init("revoke", v.revoke, "vetting-revoke-statement", undefined, [kdone("completed")]), init("revoke-again", v.revoke, "vetting-revoke-statement", undefined, [kdone("completed"), kstored("revoke-recorded-twice-same")])],
  allowedTerminals: ["completed"], completion: done(),
};
const grantTwice: Scenario = {
  id: "FC-IDV-006", title: "the administrator grants the vetter role to the same member twice: the second grant returns the live grant and the member is listed once",
  spec: [`${VG} (a member who already holds a live grant gets that grant back unchanged)`, DOC4],
  source: v.grant, ...vb,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, trig("grant-vetter-again", "grantVetter", { vid: "$K" }), init("publish", v.profile, "vetter-profile", { listed: true }, [kdone("completed"), stored("vetter:$K", 1)])],
  allowedTerminals: ["completed"], completion: done([stored("admin:grantVetter:ok", 2), stored("vetter:$K", 1)]),
};
const listing: Scenario = {
  id: "FC-IDV-007", title: "a member asks the community for its listed vetters: a vetter with a live grant and a listed profile is named, and after the vetter unlists, the listing is empty",
  spec: [`${VL} (only active members with a live vetter grant and a profile stored with listed true appear)`, `${VP} (listed false removes the profile from the listing)`, DOC4],
  source: v.list, ...vbDir,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), grantK, init("publish", v.profile, "vetter-profile", { listed: true }, [kdone("completed"), stored("vetter:$K", 1)]),
    init("list", v.list, "vetters-list", undefined, [kdone("completed"), kstored("list-count:1")]),
    init("unlist", v.profile, "vetter-profile", { listed: false }, [kdone("completed")]),
    init("list-again", v.list, "vetters-list", undefined, [kdone("completed"), kstored("list-count:0")])],
  allowedTerminals: ["completed"], completion: done([kstored("list-count:0")]),
};
const requestToCommunity: Scenario = {
  id: "FC-IDV-008", title: "a member sends the peer leg of identity vetting (vetting/request) to the community: the community is not a vetter and serves no vetting/request, so it refuses the type (unsupportedType) and holds nothing",
  spec: ["TF ceremonies/vetting/identity-vetting/0.1/ceremony.json (request is applicant to vetter; the vetter is a member or an openvtc client, never the community)", "TF specs/vetting/request/0.1/spec.md (parties: applicant, vetter)", "SPEC.md 8.3 (unsupportedType: the consumer does not serve the task type)", DOC4],
  source: src("vetting/request", "0.1"), ...vbDir,
  steps: [trig("seed-member", "seedMember", { vid: "$K" }), init("request-to-community", src("vetting/request", "0.1"), "vetting-request", undefined, [code("unsupportedType"), kdone("refused")])],
  allowedTerminals: ["refused"], completion: refused(),
};
export const idvFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-IDV", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Identity vetting, the community's directory and revocation (wallet and community)", channel: "proposed", choreography: "docs/30-onboarding-vetting-ceremonies.md section 4: the administrator grants the vetter role, the vetter publishes (and unlists) a profile, the listing and the grant's state, a withdrawn statement. The peer leg (request, session, attestation, decline) is served by no VTI service and stays on the reference scenarios (FC-VET)." },
  scenarios: [listed, unlisted, noGrant, showLive, revokeOnce, grantTwice, listing, requestToCommunity],
};
// ======================================================================================================================================== FC-ONB
// The whole onboarding ceremony (ceremonies/vtc/member-onboarding/0.1) at the task versions the platforms serve: manifest 0.4 and submit 0.3 (the definition cites 0.1; submit 0.1 is retired and
// superseded, and the discovery and apply steps are run at the latest, D560). Two seats: the applicant's wallet (`K`, the definition's `applicant`) and the community (`V`). The definition's third role,
// the administrator, is a harness-held identity: the community participant's own console (the adapter's seeded administrator, class D), reached through `decide` and `solicit` triggers, exactly as
// FC-MBR does; it is never a wallet and never a third process. The definition's `acknowledge` step (the pushed `submit-receipt`) is not a step here: at submit 0.3 the response itself carries the request
// id (`requestId`), which is what the administrator and the applicant then name; a VTC pushes the receipt only on the credential-query thread (FC-KVX, FC-CEX), so the pushed receipt of a plain submission is
// not claimed (D560, recorded as an open class C question).
const ONB = "docs/30-onboarding-vetting-ceremonies.md section 3 (FC-ONB)";
const mm = { solicit: src("vtc/members/solicit-vmc", "0.1"), ask: src("vtc/members/request-vmc", "0.1"), vmc: src("vtc/members/vmc", "0.1") };
const onbReq = [...joinRequires, `${S}vtc/members/solicit-vmc/0.1`, `${S}vtc/members/vmc/0.1`];
const onbBase = { ...base, participants: parts(onbReq) };
const decideStep = (id: string, decision: "approved" | "rejected", expect: Check[], extra: Record<string, unknown> = {}): ScenarioStep =>
  step({ id, source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision, request: "latest", ...extra } } }, expect });
const poll = (id: string, state: string, extra: Check[] = []): ScenarioStep => init(id, j.status, "join-status", undefined, [kdone("completed"), kstored(`join-status:${state}`), ...extra]);
const DISC = init("discover", j.manifest, "join-manifest", undefined, [kdone("completed")]);
const onbMain: Scenario = {
  id: "FC-ONB-001", title: "discover the criteria, apply under the review criterion, the administrator approves the request the community named, the applicant polls and reads approved: the applicant and the community both read completed",
  spec: [DEF, `${JM} (discover, optional and prev-less)`, `${JS} (apply: the answer names the request id)`, `${JD} (the administrator decides the request it was shown; approved admits the applicant)`, `${JT} (the applicant polls its own request)`, ONB],
  source: j.submit, ...onbBase,
  steps: [know, DISC, A("apply", [stored("join-request:pending", 1), stored("member:$K", 0)]), decideStep("decide", "approved", [stored("join-request:approved", 1), stored("member:$K", 1), stored("admin:decide:ok", 1)]), poll("status", "approved")],
  allowedTerminals: ["completed"], completion: done([stored("join-request:approved", 1), stored("member:$K", 1)]),
};
const onbRejected: Scenario = {
  id: "FC-ONB-002", title: "the administrator rejects with a reason: the decision is terminal, the applicant's poll returns rejected with that reason and the applicant is not a member",
  spec: [DEF, `${JD} (rejected refuses the applicant and records the reason)`, `${JT} (code, reason and decidedAt appear only when the status is rejected)`, ONB],
  source: j.decide, ...onbBase,
  steps: [know, A(), decideStep("decide", "rejected", [stored("join-request:rejected", 1), stored("admin:decide:ok", 1)], { reason: "does not meet the join criteria" }),
    poll("status", "rejected", [kstored("join-status-reason:does not meet the join criteria")])],
  allowedTerminals: ["completed"], completion: done([stored("member:$K", 0), stored("join-request:rejected", 1)]),
};
const onbRounds: Scenario = {
  id: "FC-ONB-003", title: "three status rounds (the definition's maxRounds bound): two polls read pending, the administrator approves, the third poll reads approved",
  spec: [DEF, "ceremony step supplement: maxRounds 3 (a round is one poll of the request)", `${JT} (the applicant polls its own request)`, `${JD}`, ONB],
  source: j.status, ...onbBase,
  steps: [know, A(), poll("status-1", "pending"), poll("status-2", "pending"), decideStep("decide", "approved", [stored("join-request:approved", 1)]), poll("status-3", "approved")],
  allowedTerminals: ["completed"], completion: done([stored("join-request:approved", 1), stored("member:$K", 1)]),
};
const onbReciprocal: Scenario = {
  id: "FC-ONB-004", title: "approved, the administrator solicits a reciprocal credential, the community asks the member, the member delivers it with the request id and the community stores it: the applicant and the community both read completed",
  spec: [DEF, "TF specs/vtc/members/solicit-vmc/0.1/spec.md (the operator-facing half: the community dispatches the request)", "TF specs/vtc/members/request-vmc/0.1/spec.md (the wire message that reaches the member)",
    "TF specs/vtc/members/vmc/0.1/spec.md (the member delivers a MembershipCredential naming the community; the requestId closes the approved request)", ONB],
  source: j.submit, ...onbBase, participants: parts(onbReq, ["optional:initiate.reciprocate"]),
  steps: [know, A(), decideStep("decide", "approved", [stored("join-request:approved", 1), stored("member:$K", 1)]), poll("status", "approved"),
    step({ id: "deliver", source: src("credential-exchange/issue", "0.1"), do: { relayPushed: { from: "V", to: "K", type: "https://trusttasks.org/spec/credential-exchange/issue/0.1", ifOffered: true } } }),
        step({ id: "solicit", source: mm.solicit, do: { decide: { by: "V", action: "solicit", args: { member: "$K" } } }, expect: [stored("admin:solicit:ok", 1), stored("pushed:request-vmc", 1)] }),
    init("reciprocate", mm.vmc, "join-vmc", undefined, [kdone("completed"), stored("vmc", 1)])],
  allowedTerminals: ["completed"], completion: done([stored("vmc", 1), stored("member:$K", 1)]),
};
const onbUnknown: Scenario = {
  id: "FC-ONB-005", title: "a decision on a request id the community never minted is refused with vtc/join-requests/decide:notFound: the real request is still pending",
  spec: [DEF, `${JD} (errorCodes: vtc/join-requests/decide:notFound)`, ONB],
  source: j.decide, ...onbBase,
  steps: [know, A("apply", [stored("join-request:pending", 1)]), step({ id: "decide-unknown", source: j.decide, do: { decide: { by: "V", action: "decide", args: { decision: "approved", request: "unknown" } } }, expect: [stored("admin:decide:vtc/join-requests/decide:notFound", 1), stored("join-request:pending", 1), stored("member:$K", 0)] })],
  allowedTerminals: ["completed"], completion: done([stored("join-request:pending", 1), stored("member:$K", 0)]),
};
const onbEarly: Scenario = {
  id: "FC-ONB-006", title: "a reciprocal credential delivered with the request id of a request that is still pending is refused with vtc/members/vmc:requestNotApproved and nothing is stored",
  spec: [DEF, "TF specs/vtc/members/vmc/0.1/spec.md (requestNotApproved: a pending or rejected request has no issued membership to reciprocate; the delivery here is unsolicited, which the task allows)", ONB],
  source: mm.vmc, ...onbBase, participants: parts(onbReq, ["optional:initiate.reciprocate"]),
  steps: [know, A("apply", [stored("join-request:pending", 1)]), init("vmc-early", mm.vmc, "join-vmc", { unsolicited: true }, [code("vtc/members/vmc:requestNotApproved"), kdone("refused"), stored("vmc", 0), stored("join-request:pending", 1)])],
  allowedTerminals: ["refused"], completion: refused([stored("vmc", 0), stored("join-request:pending", 1)]),
};
const onbForeign: Scenario = {
  id: "FC-ONB-007", title: "an application whose presentation names another holder than the document's signer is refused with vtc/join-requests/submit:presentationInvalid: no request is recorded",
  spec: [DEF, `${JS} (the presentation must be the applicant's own; errorCodes: vtc/join-requests/submit:presentationInvalid)`, ONB],
  source: j.submit, ...base, participants: parts(joinRequires, ["optional:initiate.foreignPresentation"]),
  steps: [know, init("apply-foreign", j.submit, "join-apply-foreign", undefined, [code("vtc/join-requests/submit:presentationInvalid"), kdone("refused"), stored("join-request", 0)])],
  allowedTerminals: ["refused"], completion: refused([stored("join-request", 0)]),
};
const onbSelf: Scenario = {
  id: "FC-ONB-008", title: "a party with no administrative authority decides the applicant's request: refused with permissionDenied (the community takes a decision only from its administrators), and the request stays pending",
  spec: [DEF, `${JD} (the community-admin capability is verified; permissionDenied otherwise)`, ONB],
  source: j.decide, ...onbBase,
  steps: [know, A("apply", [stored("join-request:pending", 1)]), decideStep("decide-by-member", "approved", [stored("admin:decide:permissionDenied", 1), stored("join-request:pending", 1), stored("member:$K", 0)], { as: "member" })],
  allowedTerminals: ["completed"], completion: done([stored("join-request:pending", 1), stored("member:$K", 0)]),
};
export const onbFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-ONB", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Community member onboarding (applicant and community)", channel: "proposed", choreography: "docs/30-onboarding-vetting-ceremonies.md section 3: discover, apply, the administrator's decision (a harness-held identity: the community's own console), the applicant's polls, then the optional reciprocal exchange (solicit, ask, vmc), at the task versions the platforms serve (manifest 0.4, submit 0.3). The wallet is the applicant; the community is the VTC." },
  scenarios: [onbMain, onbRejected, onbRounds, onbReciprocal, onbUnknown, onbEarly, onbForeign, onbSelf],
};
export const onboardFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-mbr.json", data: mbrFile }, { file: "fc-idv.json", data: idvFile }];
