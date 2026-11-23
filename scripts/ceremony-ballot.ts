// SPDX-License-Identifier: Apache-2.0
// Authoring source of the ballot-cast group (docs/32): a voter's client (keyring-wallet, `K`) sends the cast its agent built (voting/ballot/cast 0.1) to the election's ballot box (VTI's vti-voting-service, `B`) over the box's HTTPS door and keeps the receipt.
// The voter's agent (vta/pcs/voter and vta/pcs/vote) and the community's ticket issuance are stand-ins (class D): the cast is built by the platform's own voting library or by the oracle's model. Imported by scripts/generate-ceremony-scenarios.ts.
// Channel `proposed`; the result is evidence of kind complete-ceremony, never a conformance count.
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
const K = (extra: string[] = []) => ({ role: "member-phone", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received", ...extra] });
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const parts = (kextra: string[] = []) => ({ K: K(kextra), B: { role: "ballot-box", requires: ["optional:trigger.openElection"] } });
const c = src("voting/ballot/cast", "0.1");
const P = "TF specs/voting/ballot/cast/0.1/spec.md";
const DOC = "docs/32-rooms-ballot-ceremonies.md section 2";
const cast = (id: string, variant: string, expect: Check[], args: Record<string, unknown> = {}): ScenarioStep => step({ id, source: c, do: { initiate: { by: "K", to: "B", kind: "ballot-cast", capture: "thread", args: { electionId: "e1", variant, ...args } } }, expect });
const open = (id: string, args: Record<string, unknown> = {}): ScenarioStep => step({ id, do: { decide: { by: "B", action: "openElection", args: { electionId: "e1", state: "voting", revote: "refuse", ...args } } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const kst = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });
const bst = (kind: string, count: number): Check => ({ at: "B", stored: { kind, count } });
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });
const refusal = (local: string, extra: Check[] = []): Check[] => [{ at: "K", received: { code: `voting/ballot/cast:${local}`, count: 1 } }, kdone("refused"), kst(`cast:refused:${local}`), ...extra];
const mk = (id: string, title: string, spec: string[], steps: ScenarioStep[], completion: Scenario["completion"], allowed: Scenario["allowedTerminals"], kextra: string[] = []): Scenario =>
  ({ id, title, spec: [...spec, DOC], source: c, ...base, participants: parts(kextra), steps, allowedTerminals: allowed, completion });

const sc: Scenario[] = [
  mk("FC-BAL-001", "a voter's client sends the cast its agent built to the ballot box of an open election: the box counts it and answers with a signed receipt addressed to the cast's one-time key, which the client checks and keeps",
    [`${P} (consumer steps 1 to 12; Response: the signed receipt)`], [open("open"), cast("cast", "ok", [kdone("completed"), kst("cast:outcome:counted"), kst("cast:leaf:0")])], done([bst("casts", 1), bst("counted", 1)]), ["completed"]),
  mk("FC-BAL-002", "the same cast is delivered again unchanged and then the same ballot is cast again under a new one-time key: the box counts it once and appends it once (retry safety: alreadyCounted with the first receipt)",
    [`${P} (Retry safety; consumer steps 7 and 10)`], [open("open"), cast("cast", "ok", [kdone("completed"), kst("cast:outcome:counted")]),
      step({ id: "resend", source: c, do: { replay: { step: "cast", by: "K", to: "B", mode: "same", index: 0 } }, expect: [{ reply: { type: `${S}voting/ballot/cast/0.1#response` } }] }),
      cast("cast-again", "ok", [kdone("completed"), kst("cast:outcome:alreadyCounted"), kst("cast:leaf:0")])], done([bst("casts", 1), bst("counted", 1)]), ["completed"]),
  mk("FC-BAL-003", "a cast for an election whose voting has not opened is refused with voting/ballot/cast:notOpen and nothing is counted",
    [`${P} (consumer step 3; errorCodes: notOpen)`], [open("open", { state: "registration" }), cast("cast", "ok", refusal("notOpen"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-004", "a cast for an election the box does not hold is refused with voting/ballot/cast:electionUnknown",
    [`${P} (consumer step 2; errorCodes: electionUnknown)`], [open("open"), cast("cast", "unknownElection", refusal("electionUnknown"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-005", "a ballot that binds a manifest digest other than the registered one is refused with voting/ballot/cast:manifestMismatch",
    [`${P} (consumer step 4; errorCodes: manifestMismatch)`], [open("open"), cast("cast", "wrongDigest", refusal("manifestMismatch"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-006", "a ballot that answers a question the manifest does not ask is refused with voting/ballot/cast:ballotInvalid",
    [`${P} (consumer step 5; errorCodes: ballotInvalid)`], [open("open"), cast("cast", "badAnswers", refusal("ballotInvalid"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-007", "an attestation made under another election's ticket class is refused with voting/ballot/cast:classMismatch",
    [`${P} (consumer step 6; errorCodes: classMismatch)`], [open("open"), cast("cast", "wrongClass", refusal("classMismatch"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-008", "a ballot changed after the attestation was made, and an attestation not made with a ticket the community issued for this election, are each refused with voting/ballot/cast:castInvalid and nothing is counted",
    [`${P} (consumer step 9; errorCodes: castInvalid; Authorization: the attestation is the authority)`], [open("open"), cast("tampered", "tamperedBallot", refusal("castInvalid")), cast("forged", "forgedTicket", refusal("castInvalid"))], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-009", "a second, different ballot under the tag of a counted one, where the manifest refuses revotes, is refused with voting/ballot/cast:alreadyVoted and the first stays counted",
    [`${P} (consumer step 8; errorCodes: alreadyVoted)`], [open("open", { revote: "refuse" }), cast("first", "ok", [kdone("completed"), kst("cast:outcome:counted")]), cast("second", "second", refusal("alreadyVoted"))], refused([bst("casts", 1), bst("counted", 1)]), ["refused"]),
  mk("FC-BAL-010", "a second, different ballot under the tag of a counted one, where the manifest replaces on revote, is recorded and answered with outcome replaced; the earlier cast stays on the board and one ballot is counted for the tag",
    [`${P} (consumer step 11: counted for the first ballot under a tag, replaced otherwise)`], [open("open", { revote: "replace" }), cast("first", "ok", [kdone("completed"), kst("cast:outcome:counted")]), cast("second", "second", [kdone("completed"), kst("cast:outcome:replaced"), kst("cast:leaf:1")])], done([bst("casts", 2), bst("counted", 1)]), ["completed"]),
  mk("FC-BAL-011", "the accepted cast is delivered again with a value changed after signing and with its proof removed: the changed copy is refused (proofInvalid), the unsigned copy is refused (proofRequired), and the board holds the one cast",
    [`${P} (consumer step 1; proofRequirement request REQUIRED)`, "SPEC.md 7.2"], [open("open"), cast("cast", "ok", [kdone("completed")]),
      step({ id: "tampered", source: c, do: { replay: { step: "cast", by: "K", to: "B", mode: "tamper", index: 0 } }, expect: [{ reply: { code: "proofInvalid" } }] }),
      step({ id: "no-proof", source: c, do: { replay: { step: "cast", by: "K", to: "B", mode: "stripProof", index: 0 } }, expect: [{ reply: { code: "proofRequired" } }] })], done([bst("casts", 1), bst("counted", 1)]), ["completed"]),
  mk("FC-BAL-012", "a cast addressed to a ballot box other than the one that holds the election is never sent by the client (it checks the recipient before sending, as the specification's recipient rule requires of the party that would receive it): nothing is counted",
    ["SPEC.md 8.3 (wrongRecipient)", `${P} (parties: the ballot box is the recipient)`], [open("open"), cast("cast", "wrongRecipient", [kdone("refused"), kst("cast:refused:wrongRecipient")])], refused([bst("casts", 0)]), ["refused"]),
  mk("FC-BAL-013", "the election's voting has closed: a cast is refused with voting/ballot/cast:notOpen (closed) and the count does not change",
    [`${P} (consumer step 3: not open: not yet opened, already closed, or cancelled)`], [open("open", { revote: "refuse" }), cast("first", "ok", [kdone("completed")]), step({ id: "close", do: { decide: { by: "B", action: "closeElection", args: { electionId: "e1" } } } }), cast("late", "second", refusal("notOpen"))], refused([bst("casts", 1), bst("counted", 1)]), ["refused"]),
  mk("FC-BAL-014", "the version skew: a cast sent at a version the ballot box does not serve (0.2) is refused unsupportedVersion, naming the version it serves; nothing is counted (the voter's client sends 0.1 only, so this runs for a client that can send another version)",
    ["SPEC.md 8.3 (unsupportedVersion)", `${P} (the only version)`], [open("open"), cast("cast", "ok", [{ at: "K", received: { code: "unsupportedVersion", count: 1 } }, kdone("refused"), kst("cast:refused:unsupportedVersion")], { version: "0.2" })], refused([bst("casts", 0)]), ["refused"], ["optional:castFutureVersion"]),
];
export const ballotFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-BAL", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Ballot cast (voter's client and ballot box)", channel: "proposed", choreography: "docs/32-rooms-ballot-ceremonies.md section 2: the cast, its retry, a revote, the consumer's refusals in the specification's order, and the version skew. The voter's agent and the community's ticket issuance are stand-ins." },
  scenarios: sc,
};
export const ballotFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-bal.json", data: ballotFile }];
