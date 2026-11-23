// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/ceremony-scenarios/ (ceremony scenarios, format tt-ceremony-scenarios/0.1, docs/25). Run:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/generate-ceremony-scenarios.ts [outDir]
// The scenarios are the suite's own choreography (channel `proposed`) over Trust Tasks specifications that exist in the task-force repository
// (every step's `source` carries the tfRef, the pin and the spec hash, through withSpecHashes). They are NOT vectors: they are read only by the
// separate ceremony runner (src/ceremony/), never by the default suite run, and what they produce is never a conformance count.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIO_FORMAT, SCENARIO_MANIFEST, SCENARIO_MANIFEST_FORMAT, type Check, type Scenario, type ScenarioFile, type ScenarioStep } from "../src/ceremony/scenario.ts";
import { loadPins, pinFor, withSpecHashes } from "../src/vectors/source.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import { pairFiles } from "./ceremony-pairs.ts";
import { kvcFile, kvxFile } from "./ceremony-kv-scenarios.ts";
import { onboardFiles, onbFile } from "./ceremony-onboarding.ts";
import { directoryFiles } from "./ceremony-directory.ts";
import { personaFiles } from "./ceremony-persona.ts";
import { voteFiles } from "./ceremony-vote.ts";
import { roomsFiles } from "./ceremony-rooms.ts";
import { ballotFiles } from "./ceremony-ballot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] === undefined ? join(resolve(here, ".."), "vectors", "ceremony-scenarios") : resolve(process.argv[2]);
const pins = loadPins();

const PROPOSE = "https://trusttasks.org/spec/vrc/relationships/propose/0.1";
const ISSUE = "https://trusttasks.org/spec/vrc/relationships/issue/0.1";
const PS = "TF specs/vrc/relationships/propose/0.1/spec.md", IS = "TF specs/vrc/relationships/issue/0.1/spec.md";

/** `source` of a step: the task's specification in the Trust Tasks repository, pinned and hashed. The choreography around it is the suite's proposal. */
function src(slug: string, version: string, kitRef?: string): VectorSource {
  const ref = kitRef ?? `kit:specs/${slug}/${version}`;
  const tfRef = tfRefFor(ref);
  if (tfRef === null) throw new Error(`no Trust Tasks reference for ${ref}`);
  return withSpecHashes({
    slug, version, channel: "proposed", profile: "ceremony-scenarios", ref, pinnedDigest: pinFor(ref, pins), tfRef,
    note: "Ceremony scenario step (docs/25): the task is a Trust Tasks specification (tfRef, status draft); the choreography around it is a suite proposal and advisory. The result of running it is evidence of kind complete-ceremony, never a conformance count.",
  });
}
const propose = src("vrc/relationships/propose", "0.1");
const issue = src("vrc/relationships/issue", "0.1");

const REQUIRES = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:trigger.consent"];
const participants = { P: { role: "proposer", requires: REQUIRES }, R: { role: "responder", requires: [...REQUIRES, PROPOSE, ISSUE] } };
const step = (s: ScenarioStep): ScenarioStep => s;
const connect = step({ id: "connect", do: { connect: "all" } });

const complete: Scenario = {
  id: "FC-VRC-001",
  title: "propose accepted, each party delivers its credential, each delivery receipt matches, both parties read completed",
  spec: [`${PS}:86 (acceptance carries the responder's relationship DID)`, `${IS}:5 (performed once in each direction)`, `${IS}:100-103 (the receipt digest is compared with the credential delivered)`, `${IS}:109 (the receiving party stores the credential and returns the receipt)`, "docs/01-layer-model.md:85"],
  source: propose,
  participants,
  carrier: { modes: ["runner-carried"] },
  deadlineMs: 30000,
  steps: [
    connect,
    step({ id: "decide-accept", do: { decide: { by: "R", action: "policy", args: { propose: "accept" } } } }),
    step({ id: "propose", source: propose, do: { initiate: { by: "P", to: "R", kind: "vrc-propose", capture: "thread" } },
      expect: [{ at: "R", received: { type: PROPOSE, count: 1 } }, { at: "P", ceremony: "open" }, { at: "R", ceremony: "open" }] }),
    step({ id: "issue-pr", source: issue, do: { initiate: { by: "P", to: "R", kind: "vrc-issue", thread: "thread" } },
      expect: [{ at: "R", stored: { kind: "vrc", count: 1 } }, { receiptMatches: { step: "issue-pr" } }, { at: "P", ceremony: "open" }, { at: "R", ceremony: "open" }] }),
    step({ id: "issue-rp", source: issue, do: { initiate: { by: "R", to: "P", kind: "vrc-issue", thread: "thread" } },
      expect: [{ at: "P", stored: { kind: "vrc", count: 1 } }, { receiptMatches: { step: "issue-rp" } }] }),
  ],
  allowedTerminals: ["completed"],
  completion: { thread: "thread", assert: [{ at: "P", ceremony: "completed" }, { at: "R", ceremony: "completed" }, { receiptMatches: { step: "issue-pr" } }, { receiptMatches: { step: "issue-rp" } }, { at: "P", stored: { kind: "vrc", count: 1 } }, { at: "R", stored: { kind: "vrc", count: 1 } }] },
};

const declined: Scenario = {
  id: "FC-VRC-002",
  title: "propose declined: the responder answers with propose:declined and both parties read declined",
  spec: [`${PS}:87 (a decline is a trust-task-error with vrc/relationships/propose:declined)`, "docs/01-layer-model.md:85"],
  source: propose,
  participants,
  carrier: { modes: ["runner-carried"] },
  deadlineMs: 30000,
  steps: [
    connect,
    step({ id: "decide-decline", do: { decide: { by: "R", action: "policy", args: { propose: "decline" } } } }),
    step({ id: "propose", source: propose, do: { initiate: { by: "P", to: "R", kind: "vrc-propose", capture: "thread" } },
      expect: [{ at: "P", received: { code: "vrc/relationships/propose:declined", count: 1 } }, { at: "P", ceremony: "declined" }] }),
  ],
  allowedTerminals: ["declined"],
  completion: { thread: "thread", assert: [{ at: "P", ceremony: "declined" }, { at: "R", ceremony: "declined" }, { at: "R", stored: { kind: "vrc", count: 0 } }] },
};

const file: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-VRC", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "VRC propose, issue, delivery receipt", channel: "proposed", choreography: "docs/25-ceremony-scenarios.md section 4: propose, the responder's decision, then one issue and one delivery receipt in each direction (the delivery receipt is the issue #response, not trust-ceremony-receipt)" },
  scenarios: [complete, declined],
};

// ---------------------------------------------------------------- FC-TCA: task-consent approval under the executor's DECLARED essential governance
const CONSENT_REQUEST = "https://trusttasks.org/spec/task-consent/request/0.1";
const CONSENT_DECISION = "https://trusttasks.org/spec/task-consent/decision/0.2";
const NEXT_STEP = "https://trusttasks.org/spec/trust-task-next-step/0.1";
const RS = "TF specs/task-consent/request/0.1/spec.md", DS = "TF specs/task-consent/decision/0.2/spec.md";
const request = src("task-consent/request", "0.1");
const decision = src("task-consent/decision", "0.2");
// the held task is the suite's own conformance ceremony (docs/04 section 11.4), not a Trust Tasks specification: the framework text it exercises is SPEC.md 8.6
const heldTask = src("trust-task-framework", "0.6.0", "kit:SPEC.md");

const APPROVER = (extra: string[] = []) => ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:trigger.consentEnrol", ...extra];
const tcaParticipants = {
  // the executor never enrols itself with an approver (`trigger.consentEnrol` is the approver devices' step), so it is not required of it (class B: the vector read the approver list onto the executor)
  E: { role: "executor", requires: [...APPROVER().filter((r) => r !== "optional:trigger.consentEnrol"), "optional:ceremony", CONSENT_DECISION] },
  A1: { role: "approver", requires: [...APPROVER(), CONSENT_REQUEST] },
  A2: { role: "approver", requires: [...APPROVER(), CONSENT_REQUEST] },
  A3: { role: "approver", requires: [...APPROVER(), CONSENT_REQUEST] },
  O: { role: "outsider", requires: [...APPROVER(), CONSENT_REQUEST] },
};
const tcaGovernance = { from: "E", approvers: ["A1", "A2", "A3"] };
const enrol = (who: string): ScenarioStep => step({ id: `enrol-${who}`, do: { decide: { by: who, action: "enrolExecutor", args: { vid: "$E" } } } });
const tcaSetup = [connect, enrol("A1"), enrol("A2"), enrol("A3"), enrol("O"),
  step({ id: "begin", source: heldTask, do: { initiate: { by: "A1", to: "E", kind: "consent-begin", capture: "thread", args: { name: "fc-tca", admins: "$declared.approvers" } } },
    expect: [{ at: "E", received: { count: 1 } }, { at: "E", ceremony: "held" }, { at: "A1", received: { type: NEXT_STEP, count: 1 } }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] })];
const approveShort = step({ id: "approve-k-1", source: decision, also: [request], do: { approve: { executor: "E", upTo: "k-1" } },
  expect: [{ at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] });
const approveK = step({ id: "approve-k", source: decision, also: [request], do: { approve: { executor: "E", upTo: "k" } },
  expect: [{ at: "E", ceremony: "completed" }, { at: "E", stored: { kind: "ceremony-effect", count: 1 } }] });
const tcaBase = {
  source: request, participants: tcaParticipants, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 30000, governance: tcaGovernance, reads: ["E"],
  allowedTerminals: ["completed" as const], completion: { thread: "thread", assert: [{ at: "E" as const, ceremony: "completed" as const }, { at: "E" as const, stored: { kind: "ceremony-effect", count: 1 } }] },
};
const tcaComplete: Scenario = {
  id: "FC-TCA-001", title: "a ceremony held under the executor's declared governance: k-1 approvals from the declared approver set hold, the k-th completes",
  spec: [`${RS} (the executor asks an enrolled approver device)`, `${DS} (the decision echoes the challenge and the salted digest of the pending task)`, "SPEC.md:1414 (8.6: a held task is answered with a next step)", "docs/02-core-trust-task-criteria.md section 5.1 and docs/04 section 19 (k and the approver set are the executor's declaration, never the suite's)"],
  ...tcaBase, steps: [...tcaSetup, approveShort, approveK],
};
const tcaOutsider: Scenario = {
  id: "FC-TCA-002", title: "a decision by a device outside the declared approver set is refused (notAnApprover) and is not counted: the quorum stays one short until a declared approver decides",
  spec: [`${DS} (notAnApprover: the decision's signer is not in the approver set)`, "docs/02-core-trust-task-criteria.md section 5.1 (the authority set is declared, an outsider decides nothing)"],
  ...tcaBase,
  steps: [...tcaSetup, approveShort,
    step({ id: "outsider-asked", source: request, do: { initiate: { by: "E", to: "O", kind: "consent-request", thread: "thread" } }, expect: [{ at: "O", received: { type: CONSENT_REQUEST, count: 1 } }] }),
    step({ id: "outsider-decides", source: decision, do: { initiate: { by: "O", to: "E", kind: "consent-decision", thread: "thread" } },
      expect: [{ at: "O", received: { code: "task-consent/decision:notAnApprover", count: 1 } }, { at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] }),
    approveK],
};
const tcaRepeat: Scenario = {
  id: "FC-TCA-003", title: "an approver who decides twice is counted once: the repeated decision does not reach the quorum",
  spec: [`${DS} (one approval per approver)`, "docs/02-core-trust-task-criteria.md section 5.1 (minApprovals counts distinct approvers)"],
  ...tcaBase,
  steps: [...tcaSetup, approveShort,
    step({ id: "approve-again", source: decision, also: [request], do: { approve: { executor: "E", upTo: "k-1", repeat: true } }, expect: [{ at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] }),
    approveK],
};
const tcaFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-TCA", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Task-consent approval under declared essential governance", channel: "proposed", choreography: "docs/25-ceremony-scenarios.md section 4: a requester's held task, the executor's consent request to each declared approver, each approver's decision; k and the approver set are read from the executor's declared essential governance, no role name is fixed" },
  scenarios: [tcaComplete, tcaOutsider, tcaRepeat],
};

// ---------------------------------------------------------------- FC-CEX: credential exchange (offer, request, issue; query, present)
const CEX = "https://trusttasks.org/spec/credential-exchange";
const offerSrc = src("credential-exchange/offer", "0.1"), requestSrc = src("credential-exchange/request", "0.1"), issueSrc = src("credential-exchange/issue", "0.1");
const querySrc = src("credential-exchange/query", "0.1"), presentSrc = src("credential-exchange/present", "0.1");
const CEXP = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:observe.pushed"];
const issuer = { role: "issuer", requires: [...CEXP, `${CEX}/request/0.1`] };
const holderI = { role: "holder", requires: [...CEXP, `${CEX}/offer/0.1`, `${CEX}/issue/0.1`] };
// FC-CEX-003 never pre-trusts the verifier (the query is deferred), so its holder does not require the verifierTrust helper (class B, 2026-11-21: a platform with no pre-trust policy, the wallet, can still take the seat).
const holderDefer = { role: "holder", requires: [...CEXP, "optional:trigger.holdCredential", "optional:trigger.queryDecision", `${CEX}/query/0.1`] };
const verifier = { role: "verifier", requires: [...CEXP, `${CEX}/present/0.1`] };
const cexBase = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 30000, allowedTerminals: ["completed" as const] };
const cexIssue: Scenario = {
  id: "FC-CEX-001", title: "an issuer's offer is answered by the holder's request on the offer's thread and that by the issue on the same thread: the holder keeps the credential issued to it",
  spec: ["TF specs/credential-exchange/offer/0.1/spec.md (the holder replies on the offer's thread with a request)", "TF specs/credential-exchange/request/0.1/spec.md (the issuer answers on-thread with an issue)", "TF specs/credential-exchange/issue/0.1/spec.md (a cleartext credential is accepted and kept; no reply document)"],
  source: offerSrc, participants: { I: issuer, H: holderI }, ...cexBase,
  steps: [connect,
    step({ id: "offer", source: offerSrc, do: { initiate: { by: "I", to: "H", kind: "cex-offer", capture: "thread" } }, expect: [{ at: "H", received: { type: `${CEX}/offer/0.1`, count: 1 } }, { at: "H", ceremony: "open" }, { at: "I", ceremony: "open" }] }),
    step({ id: "request", source: requestSrc, do: { relayPushed: { from: "H", to: "I", type: `${CEX}/request/0.1` } }, expect: [{ at: "I", received: { type: `${CEX}/request/0.1`, count: 1 } }, { at: "H", stored: { kind: "credential", count: 0 } }] }),
    step({ id: "issue", source: issueSrc, do: { relayPushed: { from: "I", to: "H", type: `${CEX}/issue/0.1` } }, expect: [{ at: "H", received: { type: `${CEX}/issue/0.1`, count: 1 } }, { at: "H", stored: { kind: "credential", count: 1 } }] })],
  completion: { thread: "thread", assert: [{ at: "I", ceremony: "completed" }, { at: "H", ceremony: "completed" }, { at: "H", stored: { kind: "credential", count: 1 } }] },
};
// D610 (class B): the spec lets the holder's consent policy pick the path (a pre-trusted verifier is answered at once, any other is deferred and decided out of band) and
// does not require a pre-trust list, so the scenario does not require the `verifierTrust` trigger: a holder that offers it is pre-trusted and answers at once; a holder
// that does not is deferred, approves (as in FC-CEX-003) and pushes the presentation. Either way the verifier keeps one presentation bound to the query's nonce on its thread.
const holderP = { role: "holder", requires: [...CEXP, "optional:trigger.holdCredential", `${CEX}/query/0.1`] };
const pretrusted = { at: "H", offers: "trigger.verifierTrust", is: true } as const;
const consented = { at: "H", offers: "trigger.verifierTrust", is: false } as const;
const cexPresent: Scenario = {
  id: "FC-CEX-002", title: "a query to a holder is answered by a presentation bound to the query's nonce on its thread, at once when the holder pre-trusts the verifier and once the holder's human approves when it does not: the verifier keeps it",
  spec: ["TF specs/credential-exchange/query/0.1/spec.md (a pre-trusted verifier is answered at once; any other is deferred and, once approved, answered on the original thread)", "TF specs/credential-exchange/present/0.1/spec.md (the presentation is bound to the verifier's nonce and audience, once)"],
  source: querySrc, participants: { V: verifier, H: holderP }, ...cexBase,
  steps: [connect,
    step({ id: "hold", do: { decide: { by: "H", action: "holdCredential", args: {} } } }),
    step({ id: "trust", when: pretrusted, do: { decide: { by: "H", action: "verifierTrust", args: { vid: "$V" } } } }),
    step({ id: "query", when: pretrusted, source: querySrc, also: [presentSrc], do: { initiate: { by: "V", to: "H", kind: "cex-query", capture: "thread" } },
      expect: [{ at: "H", received: { type: `${CEX}/query/0.1`, count: 1 } }, { at: "V", received: { type: `${CEX}/present/0.1`, count: 1 } }, { at: "V", stored: { kind: "presentation", count: 1 } }] }),
    step({ id: "hold-membership", when: consented, do: { decide: { by: "H", action: "holdCredential", args: { type: "MembershipCredential" } } } }),
    step({ id: "query-deferred", when: consented, source: querySrc, do: { initiate: { by: "V", to: "H", kind: "cex-query", capture: "thread" } },
      expect: [{ at: "H", received: { type: `${CEX}/query/0.1`, count: 1 } }, { at: "H", ceremony: "held" }, { at: "V", stored: { kind: "presentation", count: 0 } }] }),
    step({ id: "approve", when: consented, do: { decide: { by: "H", action: "queryDecision", args: { thread: "$thread:thread", decision: "approve" } } } }),
    step({ id: "present", when: consented, source: presentSrc, do: { relayPushed: { from: "H", to: "V", type: `${CEX}/present/0.1` } }, expect: [{ at: "V", stored: { kind: "presentation", count: 1 } }] })],
  completion: { thread: "thread", assert: [{ at: "V", ceremony: "completed" }, { at: "H", ceremony: "completed" }, { at: "V", stored: { kind: "presentation", count: 1 } }] },
};
const cexDeferred: Scenario = {
  id: "FC-CEX-003", title: "a query to a holder that does not pre-trust the verifier is deferred; once the holder's human approves, the presentation is pushed on the query's thread and the verifier keeps it",
  spec: ["TF specs/credential-exchange/query/0.1/spec.md (a deferred query waits for the holder's decision)", "TF specs/credential-exchange/present/0.1/spec.md (for a deferred query, present on the original thread once approval lands)"],
  source: querySrc, participants: { V: verifier, H: holderDefer }, ...cexBase, allowedTerminals: ["completed"],
  steps: [connect,
    step({ id: "hold", do: { decide: { by: "H", action: "holdCredential", args: {} } } }),
    // as in FC-KVX: a community verifier asks for the membership credential, so a holder must hold one for the query to match (class B, 2026-11-21)
    step({ id: "hold-membership", do: { decide: { by: "H", action: "holdCredential", args: { type: "MembershipCredential" } } } }),
    step({ id: "query", source: querySrc, do: { initiate: { by: "V", to: "H", kind: "cex-query", capture: "thread" } },
      expect: [{ at: "H", received: { type: `${CEX}/query/0.1`, count: 1 } }, { at: "H", ceremony: "held" }, { at: "V", stored: { kind: "presentation", count: 0 } }] }),
    step({ id: "approve", do: { decide: { by: "H", action: "queryDecision", args: { thread: "$thread:thread", decision: "approve" } } } }),
    step({ id: "present", source: presentSrc, do: { relayPushed: { from: "H", to: "V", type: `${CEX}/present/0.1` } }, expect: [{ at: "V", stored: { kind: "presentation", count: 1 } }] })],
  completion: { thread: "thread", assert: [{ at: "V", ceremony: "completed" }, { at: "H", ceremony: "completed" }, { at: "V", stored: { kind: "presentation", count: 1 } }] },
};
const cexFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-CEX", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Credential exchange: offer, request, issue; query, present", channel: "proposed", choreography: "docs/25-ceremony-scenarios.md section 4: the next task of an exchange is pushed by the participant that holds the thread; the runner relays each pushed document to its recipient and reads every participant's own state" },
  scenarios: [cexIssue, cexPresent, cexDeferred],
};

// ---------------------------------------------------------------- FC-MAT: in-person mutual attestation (ceremonies/mutual-attestation/0.1)
// The definition is in the Trust Tasks repository: two `credential-exchange/issue` steps (attest-first, attest-second), each anchor-rooted (prev []), terminal,
// completion allOf both, no order between them. It has no offer or request: the reference issues in answer to a request, so the scenario reaches each issue
// through the FC-CEX offer and request (the suite's own preamble, steps named offer-* and request-*), once in each direction.
const MAT_DEF = "TF ceremonies/mutual-attestation/0.1/ceremony.json (sha256 b9c9638b2c40d3a83972c990969fd5472a03dc57fb2404eb3871dc3dbeb980ad)";
const MATP = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:observe.pushed", `${CEX}/offer/0.1`, `${CEX}/request/0.1`, `${CEX}/issue/0.1`];
const matParticipants = { F: { role: "first-person", requires: MATP }, S: { role: "second-person", requires: MATP } };
// direction 1: first-person issues about second-person (attest-first); direction 2: the mirror (attest-second)
const matOffer = (id: string, by: string, to: string, cap: string): ScenarioStep => step({ id, source: offerSrc, do: { initiate: { by, to, kind: "cex-offer", capture: cap } },
  expect: [{ at: to, thread: cap, received: { type: `${CEX}/offer/0.1`, count: 1 } }] });
const matRequest = (id: string, from: string, to: string, cap: string): ScenarioStep => step({ id, source: requestSrc, do: { relayPushed: { from, to, type: `${CEX}/request/0.1` } },
  expect: [{ at: to, thread: cap, received: { type: `${CEX}/request/0.1`, count: 1 } }] });
const matIssue = (id: string, from: string, to: string, cap: string, stored: number): ScenarioStep => step({ id, source: issueSrc, do: { relayPushed: { from, to, type: `${CEX}/issue/0.1` } },
  expect: [{ at: to, thread: cap, received: { type: `${CEX}/issue/0.1`, count: 1 } }, { at: to, stored: { kind: "credential", count: stored } }] });
const d1 = (): ScenarioStep[] => [matOffer("offer-first", "F", "S", "first"), matRequest("request-second", "S", "F", "first")];
const d2 = (): ScenarioStep[] => [matOffer("offer-second", "S", "F", "second"), matRequest("request-first", "F", "S", "second")];
const matBase = {
  source: issueSrc, participants: matParticipants, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 30000, allowedTerminals: ["completed" as const],
  completion: { thread: "first", assert: [
    { at: "F" as const, ceremony: "completed" as const, thread: "first" }, { at: "S" as const, ceremony: "completed" as const, thread: "first" },
    { at: "F" as const, ceremony: "completed" as const, thread: "second" }, { at: "S" as const, ceremony: "completed" as const, thread: "second" },
    { at: "F" as const, stored: { kind: "credential", count: 1 } }, { at: "S" as const, stored: { kind: "credential", count: 1 } }] },
};
const matSpec = (extra: string): string[] => [MAT_DEF, "ceremony steps attest-first and attest-second: kind task, type credential-exchange/issue/0.1, prev [] (anchor-rooted), terminal; completion allOf both; the pair is simultaneous, neither precedes the other", "TF specs/credential-exchange/issue/0.1/spec.md (a cleartext credential is accepted and kept; no reply document)", extra];
const matBoth: Scenario = {
  id: "FC-MAT-001", title: "mutual attestation: each person issues a credential about the other (attest-first, attest-second); both keep the one issued to them and both read completed in both directions",
  spec: matSpec("the offer and request steps are the suite's preamble to each issue (TF specs/credential-exchange/offer/0.1 and request/0.1), one thread per direction"),
  ...matBase, steps: [connect, ...d1(), matIssue("attest-first", "F", "S", "first", 1), ...d2(), matIssue("attest-second", "S", "F", "second", 1)],
};
const matReversed: Scenario = {
  id: "FC-MAT-002", title: "mutual attestation with no order: the second person attests before the first does, and the ceremony completes all the same",
  spec: matSpec("the definition gives the two steps no prev: the scenario runs them in the order the name does not give (attest-second first)"),
  ...matBase, steps: [connect, ...d2(), matIssue("attest-second", "S", "F", "second", 1), ...d1(), matIssue("attest-first", "F", "S", "first", 1)],
};
const matInterleaved: Scenario = {
  id: "FC-MAT-003", title: "mutual attestation, simultaneous: both offers and both requests are exchanged before either credential is issued, then the two issues land in either order",
  spec: matSpec("the pair is simultaneous (definition text on attest-first): nothing is issued until both threads are open and requested"),
  ...matBase, steps: [connect, matOffer("offer-first", "F", "S", "first"), matOffer("offer-second", "S", "F", "second"), matRequest("request-second", "S", "F", "first"), matRequest("request-first", "F", "S", "second"),
    matIssue("attest-second", "S", "F", "second", 1), matIssue("attest-first", "F", "S", "first", 1)],
};
const matFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-MAT", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "In-person mutual attestation", channel: "proposed", choreography: "ceremonies/mutual-attestation/0.1 in the Trust Tasks repository: two credential-exchange/issue steps with no order between them, completion on both; the suite adds the offer and request of each direction as its own preamble. The coDerived anchor (a value the two people establish together, from which the enactment identifier is derived) is not exercised: the reference has no enactment identifier and the runner no anchor" },
  scenarios: [matBoth, matReversed, matInterleaved],
};

// ---------------------------------------------------------------- FC-WSH: witnessed VRC with witness-share (channel candidate, local text docs/10)
// P proposes with `witnessed: true`, R agrees; each party opens a witness session with W, submits a presentation bound to it and keeps the credential the
// witness minted for it; each shares it with the other (the receipt carries its digest); each issues its relationship credential. W is the reference
// oracle in its labelled mode `mint-on-verified` (a suite choice, not required by the drafts); the witness server is not run. No order between share and issue.
const TT = "https://trusttasks.org/spec/";
const sessionSrc = src("witness/session", "0.1"), submitSrc = src("witness/session/submit", "0.1");
const shareVec = (JSON.parse(readFileSync(join(resolve(here, ".."), "vectors", "ceremony-vrc", "witness-share.json"), "utf8")) as { vectors: { source: VectorSource }[] }).vectors[0]!.source;
const shareSrc: VectorSource = { ...shareVec, note: "Ceremony scenario step (docs/25 section 6.4): no Trust Tasks home, channel candidate, local text docs/10-witness-share-profile.md. Advisory, never an endorsement. The result is evidence of kind complete-ceremony, never a conformance count." };
const WSHP = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:trigger.consent"];
const wshParticipants = {
  P: { role: "proposer", requires: WSHP },
  R: { role: "responder", requires: [...WSHP, PROPOSE, ISSUE, `${TT}vrc/relationships/witness-share/0.1`] },
  W: { role: "witness", requires: ["optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", `${TT}witness/session/0.1`, `${TT}witness/session/submit/0.1`] },
};
const wshInit = (by: string, to: string, kind: string, extra: { thread?: string; capture?: string; args?: Record<string, unknown> } = {}): ScenarioStep["do"] => ({ initiate: { by, to, kind, ...extra } });
const wshAccept = step({ id: "decide-accept", do: { decide: { by: "R", action: "policy", args: { propose: "accept", witnessed: true } } } });
const wshPropose = step({ id: "propose", source: propose, do: wshInit("P", "R", "vrc-propose", { capture: "thread", args: { witnessed: true } }),
  expect: [{ at: "R", received: { type: PROPOSE, count: 1 } }, { at: "P", ceremony: "open" }, { at: "R", ceremony: "open" }, { at: "W", ceremony: "unknown" }] });
const wshSession = (x: "P" | "R"): ScenarioStep => step({ id: `session-${x.toLowerCase()}`, source: sessionSrc, do: wshInit(x, "W", "witness-session", { thread: "thread", capture: `ws${x}` }),
  expect: [{ at: "W", received: { type: `${TT}witness/session/0.1`, count: 1 }, thread: `ws${x}` }, { at: "W", ceremony: "open" }] });
const wshSubmit = (x: "P" | "R", allMinted = false): ScenarioStep => step({ id: `submit-${x.toLowerCase()}`, source: submitSrc, do: wshInit(x, "W", "witness-session-submit", { thread: `ws${x}` }),
  expect: [{ at: x, received: { type: `${TT}witness/session/submit/0.1#response`, from: "W", count: 1 }, thread: `ws${x}` }, { at: "W", ceremony: allMinted ? "completed" : "open" }, { at: x, ceremony: "open" }] });
const wshShare = (a: "P" | "R", b: "P" | "R", id: string, last = false): ScenarioStep => step({ id, source: shareSrc, do: wshInit(a, b, "vrc-witness-share", { thread: "thread" }),
  expect: [{ at: b, received: { type: `${TT}vrc/relationships/witness-share/0.1`, from: a, count: 1 } }, { at: b, stored: { kind: "vwc", count: 1 } }, { receiptMatches: { step: id } }, ...(last ? [] : [{ at: a, ceremony: "open" as const }])] });
const wshIssue = (a: "P" | "R", b: "P" | "R", id: string): ScenarioStep => step({ id, source: issue, do: wshInit(a, b, "vrc-issue", { thread: "thread" }), expect: [{ at: b, stored: { kind: "vrc", count: 1 } }, { receiptMatches: { step: id } }] });
const wshSpec = [
  "docs/10-witness-share-profile.md sections 2, 4, 5 and 7 (the share, its receiver checks, the receipt carrying the credential's digest, the order session, share, issue as KW sends it; the order is open question O7, so no order is asserted)",
  "TF specs/witness/session/0.1/spec.md (the session names its two parties; the issuer must be one of them)",
  "TF specs/witness/session/submit/0.1/spec.md (the presentation is bound to the session challenge and domain; the response delivers the credential and is the outcome evidence)",
  "TF specs/vrc/relationships/issue/0.1/spec.md:100-103 (the receipt digest is compared with the credential delivered)",
  "docs/25-ceremony-scenarios.md section 6.4 (the witness is the reference oracle in the labelled mode mint-on-verified: a suite choice, not something the drafts require; the witness server was not run)",
];
const wshBase = { spec: wshSpec, source: shareSrc, participants: wshParticipants, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 30000 };
const wshDone = (receipts: string[]) => ({ thread: "thread", assert: [
  { at: "P", ceremony: "completed" as const }, { at: "R", ceremony: "completed" as const }, { at: "W", ceremony: "completed" as const },
  ...receipts.map((r) => ({ receiptMatches: { step: r } })),
  { at: "P", stored: { kind: "vrc", count: 1 } }, { at: "R", stored: { kind: "vrc", count: 1 } }, { at: "P", stored: { kind: "vwc", count: 1 } }, { at: "R", stored: { kind: "vwc", count: 1 } }] });
const wshOrdered: Scenario = { id: "FC-WSH-001", title: "witnessed exchange in the order session, submit, share, issue: each party's credential is minted by the witness, shared and received, then issued; all three read completed", ...wshBase,
  steps: [connect, wshAccept, wshPropose, wshSession("P"), wshSubmit("P"), wshSession("R"), wshSubmit("R", true), wshShare("P", "R", "share-pr"), wshShare("R", "P", "share-rp"), wshIssue("P", "R", "issue-pr"), wshIssue("R", "P", "issue-rp")],
  allowedTerminals: ["completed"], completion: wshDone(["share-pr", "share-rp", "issue-pr", "issue-rp"]) };
const wshReversed: Scenario = { id: "FC-WSH-002", title: "the same exchange in the opposite order: both credentials issued first, then the sessions, then the shares, the second party sharing first; all three read completed (no order between share and issue is asserted)", ...wshBase,
  steps: [connect, wshAccept, wshPropose, wshIssue("P", "R", "issue-pr"), wshIssue("R", "P", "issue-rp"), wshSession("R"), wshSubmit("R"), wshSession("P"), wshSubmit("P", true), wshShare("R", "P", "share-rp"), wshShare("P", "R", "share-pr", true)],
  allowedTerminals: ["completed"], completion: wshDone(["share-pr", "share-rp", "issue-pr", "issue-rp"]) };
const wshReplay: Scenario = { id: "FC-WSH-003", title: "a submission bound to the challenge of another session of the same party is refused with witness/session/submit:challengeMismatch; nothing is minted; the party reads refused", ...wshBase,
  steps: [connect, wshAccept, wshPropose, wshSession("P"),
    step({ id: "session-p2", source: sessionSrc, do: wshInit("P", "W", "witness-session", { thread: "thread", capture: "wsB" }) }),
    step({ id: "submit-replay", source: submitSrc, do: wshInit("P", "W", "witness-session-submit", { thread: "wsB", args: { challengeOf: "$thread:wsP" } }),
      expect: [{ at: "P", received: { code: "witness/session/submit:challengeMismatch", count: 1 }, thread: "wsB" }, { at: "P", received: { type: `${TT}witness/session/submit/0.1#response`, count: 0 }, thread: "wsB" }, { at: "W", ceremony: "open" }] })],
  allowedTerminals: ["refused"], reads: ["P"], completion: { thread: "thread", assert: [{ at: "P", ceremony: "refused" }, { at: "W", ceremony: "open" }, { at: "R", ceremony: "open" }, { at: "P", stored: { kind: "vwc", count: 0 } }] } };
const wshBounce: Scenario = { id: "FC-WSH-004", title: "a party that shares the credential it received back to its sender is refused with vrc/relationships/witness-share:notAccepted (the credential is not about the sender); the party reads refused", ...wshBase,
  steps: [connect, wshAccept, wshPropose, wshSession("P"), wshSubmit("P"), wshSession("R"), wshSubmit("R", true), wshShare("R", "P", "share-rp"),
    step({ id: "share-bounce", source: shareSrc, do: wshInit("P", "R", "vrc-witness-share", { thread: "thread", args: { of: "received" } }),
      expect: [{ at: "P", received: { code: "vrc/relationships/witness-share:notAccepted", count: 1 } }, { at: "R", stored: { kind: "vwc", count: 0 } }] })],
  allowedTerminals: ["refused"], reads: ["P"], completion: { thread: "thread", assert: [{ at: "P", ceremony: "refused" }, { at: "P", stored: { kind: "vwc", count: 1 } }, { at: "R", stored: { kind: "vwc", count: 0 } }] } };
const wshFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-WSH", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Witnessed VRC with witness-share", channel: "candidate", choreography: "docs/25-ceremony-scenarios.md section 6.4: propose with witnessed true, the responder agrees; each party opens a witness session, submits a presentation bound to it and receives its credential; each shares it with the other (the receipt carries the credential's digest); each issues its relationship credential; no order between share and issue is asserted (docs/10 open question O7). The witness is the reference oracle in its labelled mode mint-on-verified, never the witness server." },
  scenarios: [wshOrdered, wshReversed, wshReplay, wshBounce],
};

// ---------------------------------------------------------------- FC-VET: identity vetting (ceremonies/vetting/identity-vetting/0.1)
// The definition is in the Trust Tasks repository: request (applicant), session (vetter, up to 3 rounds, answered with a signed Vetting Card), then attest
// (credential-exchange/issue, optional, terminal) or decline (optional, terminal); completion allOf request, session and anyOf attest, decline. The party is
// the reference's `vetter` and `applicant` kinds (src/adapters/reference/vetting-party.ts); it models only what the scenario observes (docs/25 section 6.6).
const VET_DEF = "TF ceremonies/vetting/identity-vetting/0.1/ceremony.json (sha256 09a77e48ded83e3df1e5c52dd07cb5505636d4cb870ef921507a998adeb91826)";
const VT = "https://trusttasks.org/spec/vetting";
const vetReqSrc = src("vetting/request", "0.1"), vetSessSrc = src("vetting/session", "0.1"), vetDeclSrc = src("vetting/decline", "0.1");
const VETP = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:trigger.consent"];
const vetParticipants = {
  A: { role: "applicant", requires: [...VETP, `${VT}/session/0.1`, `${VT}/decline/0.1`, `${CEX}/issue/0.1`] },
  V: { role: "vetter", requires: [...VETP, `${VT}/request/0.1`] },
};
const vetSpec = (extra: string): string[] => [VET_DEF, "ceremony steps request (applicant), session (vetter, maxRounds 3), attest (credential-exchange/issue, prev session, terminal), decline (prev session, terminal); completion allOf request, session, anyOf attest, decline",
  "TF specs/vetting/session/0.1/spec.md (the session's challenge and domain; the card bound to them, Conformance vetter 5; the statement cites the session by taskContext and taskDigestMultibase, the same outcome-evidence citation as FC-WSH)",
  "TF specs/vetting/_shared/0.1/vetting-card.schema.json (the signed Vetting Card the applicant answers a session with)", extra];
const vetBase = { source: vetReqSrc, participants: vetParticipants, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 30000 };
const vInit = (id: string, source: VectorSource, by: string, to: string, kind: string, extra: { thread?: string; capture?: string; args?: Record<string, unknown> }, expect?: ScenarioStep["expect"]): ScenarioStep =>
  step({ id, source, do: { initiate: { by, to, kind, ...extra } }, ...(expect === undefined ? {} : { expect }) });
const vetRequest = vInit("request", vetReqSrc, "A", "V", "vetting-request", { capture: "thread", args: { community: "did:example:vetting-community" } },
  [{ at: "V", received: { type: `${VT}/request/0.1`, count: 1 } }, { at: "A", received: { type: `${VT}/request/0.1#response`, count: 1 } }, { at: "A", ceremony: "open" }, { at: "V", ceremony: "open" }]);
const vetSession = (id = "session", cap = "session"): ScenarioStep => vInit(id, vetSessSrc, "V", "A", "vetting-session", { thread: "thread", capture: cap },
  [{ at: "A", received: { type: `${VT}/session/0.1`, count: 1 }, thread: cap }, { at: "A", ceremony: "held" }, { at: "V", ceremony: "open" }]);
const vetAnswer = (id = "answer", sess = "session"): ScenarioStep => vInit(id, vetSessSrc, "A", "V", "vetting-answer", { thread: sess },
  [{ at: "V", received: { type: `${VT}/session/0.1#response`, count: 1 }, thread: sess }, { at: "V", ceremony: "held" }]);
const vetAttest = vInit("attest", issueSrc, "V", "A", "vetting-attest", { thread: "thread" }, [{ at: "A", stored: { kind: "credential", count: 1 } }, { at: "V", ceremony: "completed" }, { at: "A", ceremony: "completed" }]);
const vetDecline = vInit("decline", vetDeclSrc, "V", "A", "vetting-decline", { thread: "thread", capture: "dec" }, [{ at: "A", received: { type: `${VT}/decline/0.1`, count: 1 }, thread: "dec" }, { at: "A", ceremony: "declined" }, { at: "V", ceremony: "declined" }]);
const vetAttested: Scenario = { id: "FC-VET-001", title: "request, session, the applicant's signed card bound to the session, then the vetter's statement citing that session: both read completed, the applicant holds the statement", ...vetBase,
  spec: vetSpec("the statement carries taskContext (the session's id) and taskDigestMultibase (the digest of the session document as received)"),
  steps: [connect, vetRequest, vetSession(), vetAnswer(), vetAttest], allowedTerminals: ["completed"],
  completion: { thread: "thread", assert: [{ at: "A", ceremony: "completed" }, { at: "V", ceremony: "completed" }, { at: "A", stored: { kind: "credential", count: 1 } }] } };
const vetDeclined: Scenario = { id: "FC-VET-002", title: "request, session, the applicant's card, then the vetter declines: both read declined, the applicant holds no statement", ...vetBase,
  spec: vetSpec("the decline is the other terminal step, after the session (prev session)"),
  steps: [connect, vetRequest, vetSession(), vetAnswer(), vetDecline], allowedTerminals: ["declined"],
  completion: { thread: "thread", assert: [{ at: "A", ceremony: "declined" }, { at: "V", ceremony: "declined" }, { at: "A", stored: { kind: "credential", count: 0 } }] } };
const vetReopened: Scenario = { id: "FC-VET-003", title: "the first session lapses unanswered, the vetter re-opens (round 2 of at most 3), the applicant answers the second, the statement cites the second session", ...vetBase,
  spec: vetSpec("session maxRounds 3: a session that lapses may be re-opened; each round is its own exchange with its own id and challenge"),
  steps: [connect, vetRequest, vetSession("session-1", "session1"), vetSession("session-2", "session2"), vetAnswer("answer", "session2"), vetAttest], allowedTerminals: ["completed"],
  completion: { thread: "thread", assert: [{ at: "A", ceremony: "completed" }, { at: "V", ceremony: "completed" }, { at: "A", stored: { kind: "credential", count: 1 } }] } };
const vetUnbound: Scenario = { id: "FC-VET-004", title: "a card bound to another challenge than the session's is refused by the vetter; no card is accepted and the applicant reads refused", ...vetBase,
  spec: vetSpec("Conformance vetter 5: community, challenge and domain of the card must equal the session's; a card that fails is not accepted"),
  steps: [connect, vetRequest, vetSession(),
    vInit("answer-unbound", vetSessSrc, "A", "V", "vetting-answer", { thread: "session", args: { bind: "other" } }, [{ at: "A", received: { code: "taskFailed", count: 1 }, thread: "session" }, { at: "V", ceremony: "open" }])],
  allowedTerminals: ["refused"], reads: ["A"], completion: { thread: "thread", assert: [{ at: "A", ceremony: "refused" }, { at: "V", ceremony: "open" }] } };
const vetUncited: Scenario = { id: "FC-VET-005", title: "a statement issued with no session (it cites the request exchange) is refused by the applicant; the vetter reads refused and the applicant holds nothing", ...vetBase,
  spec: vetSpec("vetting/session: the statement MUST carry the session's id as taskContext and its task digest; the request exchange is not the session"),
  steps: [connect, vetRequest,
    vInit("attest-no-session", issueSrc, "V", "A", "vetting-attest", { thread: "thread", args: { without: "session" } }, [{ at: "V", received: { code: "taskFailed", count: 1 } }, { at: "A", stored: { kind: "credential", count: 0 } }])],
  allowedTerminals: ["refused"], reads: ["V"], completion: { thread: "thread", assert: [{ at: "V", ceremony: "refused" }, { at: "A", stored: { kind: "credential", count: 0 } }] } };
const vetLate: Scenario = { id: "FC-VET-006", title: "after the statement the enactment has ended: a decline sent anyway is refused by the applicant, who still holds the statement; both read completed", ...vetBase,
  spec: vetSpec("attest and decline are the two ways the enactment ends (anyOf): a second terminal step does not reopen it"),
  steps: [connect, vetRequest, vetSession(), vetAnswer(), vetAttest,
    vInit("decline-after-attest", vetDeclSrc, "V", "A", "vetting-decline", { thread: "thread", capture: "dec", args: { force: true } }, [{ at: "V", received: { code: "taskFailed", count: 1 }, thread: "dec" }, { at: "A", ceremony: "completed" }])],
  allowedTerminals: ["completed"], completion: { thread: "thread", assert: [{ at: "A", ceremony: "completed" }, { at: "V", ceremony: "completed" }, { at: "A", stored: { kind: "credential", count: 1 } }] } };
const vetFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-VET", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Identity vetting", channel: "proposed", choreography: "docs/25-ceremony-scenarios.md section 6.6: request, session answered with a signed Vetting Card bound to the session (up to 3 rounds), then a Vetting Statement citing the session or a decline. The reference party models only what the scenario observes, never a community's vetter policy." },
  scenarios: [vetAttested, vetDeclined, vetReopened, vetUnbound, vetUncited, vetLate],
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "fc-onb.json"), JSON.stringify(onbFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-vet.json"), JSON.stringify(vetFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-wsh.json"), JSON.stringify(wshFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-mat.json"), JSON.stringify(matFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-cex.json"), JSON.stringify(cexFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-tca.json"), JSON.stringify(tcaFile, null, 2) + "\n");
writeFileSync(join(outDir, "fc-vrc.json"), JSON.stringify(file, null, 2) + "\n");
for (const p of [...pairFiles, ...onboardFiles, ...directoryFiles, ...personaFiles, ...voteFiles, ...ballotFiles, ...roomsFiles]) writeFileSync(join(outDir, p.file), JSON.stringify(p.data, null, 2) + "\n");
writeFileSync(join(outDir, "fc-kvc.json"), JSON.stringify(kvcFile(src), null, 2) + "\n");
writeFileSync(join(outDir, "fc-kvx.json"), JSON.stringify(kvxFile(src), null, 2) + "\n");
writeFileSync(join(outDir, SCENARIO_MANIFEST), JSON.stringify({ format: SCENARIO_MANIFEST_FORMAT, files: ["fc-vrc.json", "fc-tca.json", "fc-cex.json", "fc-mat.json", "fc-wsh.json", "fc-vet.json", "fc-onb.json", ...pairFiles.map((p) => p.file), ...onboardFiles.map((p) => p.file), ...directoryFiles.map((p) => p.file), ...personaFiles.map((p) => p.file), ...voteFiles.map((p) => p.file), ...ballotFiles.map((p) => p.file), ...roomsFiles.map((p) => p.file), "fc-kvc.json", "fc-kvx.json"] }, null, 2) + "\n");
