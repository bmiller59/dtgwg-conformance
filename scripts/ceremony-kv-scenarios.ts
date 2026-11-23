// SPDX-License-Identifier: Apache-2.0
// Authoring source of the KW-to-VTI ceremony set (docs/27): FC-KVC (task-consent, an executor and its approvers) and FC-KVX (credential exchange, a verifier and a
// holder). Imported by generate-ceremony-scenarios.ts, which writes the files. Both groups use the choreography of FC-TCA and FC-CEX, but their steps are written so that
// ANY executor (the reference oracle, VTI's VTA) and ANY approver (the reference, the wallet) can play a slot: the step kinds are the same, each participant builds
// its own documents with its own code. The executor is never given k or the approver set by the scenario: the `consentSetup` step names the approver set the scenario
// uses, and the executor's own policy (a VTA's rule and configuration, the oracle's declaration) does the rest.
import type { Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { TAMPER_MODES } from "../src/ceremony/tamper.ts";

type Src = (slug: string, version: string, kitRef?: string) => VectorSource;
const step = (s: ScenarioStep): ScenarioStep => s;
const CONSENT = "https://trusttasks.org/spec/task-consent";
const REQUEST = `${CONSENT}/request/0.1`;
const DECISION = `${CONSENT}/decision/0.2`;
const IN = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony"];

export function kvcFile(src: Src): ScenarioFile {
  const request = src("task-consent/request", "0.1");
  const decision = src("task-consent/decision", "0.2");
  const RS = "TF specs/task-consent/request/0.1/spec.md", DS = "TF specs/task-consent/decision/0.2/spec.md";
  const connect = step({ id: "connect", do: { connect: "all" } });
  const E = (role = "executor") => ({ role, requires: [...IN, ...(role === "executor-leg" ? [] : ["optional:trigger.consentSetup"]), role === "executor-v01" ? `${CONSENT}/decision/0.1` : DECISION] });
  const A = (role = "approver") => ({ role, requires: [...IN, "optional:trigger.consentEnrol"] });
  const base = { source: request, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 60000, reads: ["E"], allowedTerminals: ["completed" as const] };
  const enrol = (who: string): ScenarioStep => step({ id: `enrol-${who}`, do: { decide: { by: who, action: "enrolExecutor", args: { vid: "$E" } } } });
  const setup = (approvers: string[], k: number): ScenarioStep => step({ id: "setup", do: { decide: { by: "E", action: "consentSetup", args: { approvers: approvers.map((a) => `$${a}`), minApprovals: k } } } });
  const gate = (approvers: string[]): ScenarioStep => step({ id: "gate", source: request, do: { initiate: { by: "E", to: "K1", kind: "consent-gate", capture: "thread", args: { approvers: approvers.map((a) => `$${a}`) } } },
    expect: [{ at: "K1", received: { type: REQUEST, count: 1 } }, { at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] });
  const ask = (who: string): ScenarioStep => step({ id: `ask-${who}`, source: request, do: { initiate: { by: "E", to: who, kind: "consent-request", thread: "thread" } }, expect: [{ at: who, received: { type: REQUEST, count: 1 } }] });
  const decide = (id: string, who: string, args?: Record<string, unknown>, expect: ScenarioStep["expect"] = []): ScenarioStep =>
    step({ id, source: decision, do: { initiate: { by: who, to: "E", kind: "consent-decision", thread: "thread", ...(args === undefined ? {} : { args }) } }, expect });
  const resubmit = step({ id: "resubmit", source: request, do: { initiate: { by: "E", to: "K1", kind: "consent-resubmit", thread: "thread" } }, expect: [{ at: "E", ceremony: "completed" }, { at: "E", stored: { kind: "ceremony-effect", count: 1 } }] });
  const done: Scenario["completion"] = { thread: "thread", assert: [{ at: "E", ceremony: "completed" }, { at: "E", stored: { kind: "ceremony-effect", count: 1 } }] };
  const one = (id: string, title: string, spec: string[], steps: ScenarioStep[], extra: Partial<Scenario> = {}): Scenario => ({
    id, title, spec: [...spec, "docs/27-kw-vti-ceremonies.md section 2 (the choreography and its stand-ins)"], ...base, participants: { E: E(), K1: A() }, steps, completion: done, ...extra });
  const ok = (who = "K1"): Check => ({ at: who, ceremony: "completed" });
  type Check = NonNullable<ScenarioStep["expect"]>[number];

  const happy = one("FC-KVC-001", "one approver: the executor refuses the gated task for consent, the approver's decision is accepted, the requester's re-submit executes it once",
    [`${RS} (the executor asks an enrolled approver)`, `${DS} (the decision echoes the challenge and payloadDigest of the request; its proof by the approver's own DID is the authorization)`],
    [connect, enrol("K1"), setup(["K1"], 1), gate(["K1"]), decide("decide", "K1", undefined, [ok()]), resubmit]);
  const two = one("FC-KVC-002", "two approvers, both required: one decision holds the task, the second lets it execute once",
    [`${RS}`, `${DS} (the approval threshold: the task runs only at the k-th distinct approval)`],
    [connect, enrol("K1"), enrol("K2"), setup(["K1", "K2"], 2), gate(["K1", "K2"]), ask("K2"),
      decide("decide-K1", "K1", undefined, [{ at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]), decide("decide-K2", "K2", undefined, [ok("K2")]), resubmit],
    { participants: { E: E(), K1: A(), K2: A() } });
  const outsider = one("FC-KVC-003", "a device outside the approver set that holds a copy of the request cannot approve: its decision is refused notAnApprover and not counted; the declared approver then completes it",
    [`${DS} (notAnApprover: the proven signer is not a member of the approver set)`, "docs/27 section 2 (the outsider's copy of the request is the harness's stand-in, class D)"],
    [connect, enrol("K1"), enrol("O"), setup(["K1"], 1), gate(["K1"]), ask("O"),
      decide("outsider-decides", "O", undefined, [{ at: "O", received: { code: "task-consent/decision:notAnApprover", count: 1 } }, { at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]),
      decide("decide", "K1", undefined, [ok()]), resubmit],
    { participants: { E: E(), K1: A(), O: A("outsider") } });
  const replay = one("FC-KVC-004", "a decision delivered twice is counted once: the executor stays one short at k=2 until the second approver decides, and executes once",
    [`${DS} (single-use: a decision authorises one execution)`, "SPEC.md section 7.2 item 11 (a repeated document does not cause a second effect)"],
    [connect, enrol("K1"), enrol("K2"), setup(["K1", "K2"], 2), gate(["K1", "K2"]), ask("K2"),
      decide("decide-K1-twice", "K1", { repeat: true }, [{ at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]), decide("decide-K2", "K2", undefined, [ok("K2")]), resubmit],
    { participants: { E: E(), K1: A(), K2: A() } });
  const deny = one("FC-KVC-005", "the approver denies: the pending task is closed, nothing executes and the executor reads aborted",
    [`${DS} (a denial closes the pending request for every approver)`],
    [connect, enrol("K1"), setup(["K1"], 1), gate(["K1"]), decide("deny", "K1", { decision: "deny" }, [{ at: "E", ceremony: "aborted" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }])],
    { allowedTerminals: ["aborted" as const], completion: { thread: "thread", assert: [{ at: "E", ceremony: "aborted" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }] } });

  const twice = one("FC-KVC-014", "an approver who decides twice with two different documents is counted once: at k=2 the executor stays one short until the second approver decides",
    [`${DS} (the approval threshold counts distinct approvers)`],
    [connect, enrol("K1"), enrol("K2"), setup(["K1", "K2"], 2), gate(["K1", "K2"]), ask("K2"),
      decide("decide-K1", "K1", undefined, [{ at: "E", ceremony: "held" }]), decide("decide-K1-again", "K1", undefined, [{ at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]),
      decide("decide-K2", "K2", undefined, [ok("K2")]), resubmit],
    { participants: { E: E(), K1: A(), K2: A() } });

  // negatives: one tampered decision is refused and not counted; the real one then completes (the refusal wedged nothing)
  const NEG: Record<string, { id: string; code?: string; what: string; spec: string }> = {
    wrongPurpose: { id: "FC-KVC-006", what: "a decision whose proof is made for authentication, not assertionMethod", spec: `${DS} (consumer 1: refuse a proof whose proofPurpose is not assertionMethod)` },
    noProof: { id: "FC-KVC-007", code: "proofRequired", what: "a decision with no proof", spec: "SPEC.md section 7.2 item 7 (proofRequired) and decision 0.2 proofRequirement REQUIRED" },
    badSignature: { id: "FC-KVC-008", code: "proofInvalid", what: "a decision whose signature does not verify", spec: "SPEC.md section 7.2 item 7 (proofInvalid)" },
    wrongRecipient: { id: "FC-KVC-009", code: "wrongRecipient", what: "a decision addressed to another party", spec: "SPEC.md section 8.3 (wrongRecipient)" },
    staleIssuedAt: { id: "FC-KVC-010", what: "a decision issued long outside the acceptance window", spec: "decision 0.2 issuedAtRequirement (a replayed decision must not authorise a second execution) and SPEC.md section 7.2 item 11" },
    wrongDigest: { id: "FC-KVC-011", code: "task-consent/decision:noPending", what: "a decision whose payloadDigest names no pending request", spec: `${DS} (consumer 2: absent or lapsed is noPending)` },
    wrongChallenge: { id: "FC-KVC-012", code: "task-consent/decision:challengeMismatch", what: "a decision whose challenge is not the one issued", spec: `${DS} (consumer 3: challengeMismatch)` },
  };
  const negatives = (Object.keys(NEG) as (keyof typeof NEG)[]).map((m) => {
    if (!(TAMPER_MODES as readonly string[]).includes(String(m))) throw new Error(`unknown tamper ${String(m)}`);
    const n = NEG[m]!;
    return one(n.id, `${n.what} is refused and not counted; the approver's real decision then completes the task, which executes once`, [n.spec],
      [connect, enrol("K1"), setup(["K1"], 1), gate(["K1"]),
        decide("tampered", "K1", { tamper: m }, [{ at: "K1", ceremony: "refused" }, ...(n.code === undefined ? [] : [{ at: "K1", received: { code: n.code, count: 1 } } as Check]), { at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]),
        decide("decide", "K1", undefined, [ok()]), resubmit]);
  });
  const stepDown = one("FC-KVC-013", "version skew: an executor that serves only task-consent/decision 0.1 refuses the wallet's 0.2 decision as unsupportedVersion; the wallet steps down once by its own ladder and the 0.1 decision is accepted",
    ["SPEC.md section 5.2 and 8.3 (unsupportedVersion, an executor serving an older minor version)", "decision 0.2 'What changed from 0.1' (a 0.1 decision re-typed as 0.2 means the same: both versions carry the same members)", "KW taskVersions.ts (step down only on unsupportedVersion/unsupportedType, once per rung)"],
    [connect, enrol("K1"), setup(["K1"], 1), gate(["K1"]),
      decide("decide-0.2", "K1", undefined, [{ at: "K1", received: { code: "unsupportedVersion", count: 1 } }, { at: "E", ceremony: "held" }, { at: "E", stored: { kind: "ceremony-effect", count: 0 } }]),
      decide("decide-stepped-down", "K1", undefined, [ok()]), resubmit],
    { participants: { E: E("executor-v01"), K1: A("approver-laddered") } });
  // the decision leg alone (a host whose gate cannot be switched on): the request is a stand-in (class D), so the end state is the executor's own refusal
  const leg = one("FC-KVC-101", "decision leg only (the gate cannot be raised on this host): the approver's real decision is verified and routed, and answered noPending because no request was raised",
    [`${DS} (consumer 1 and 2: the proof is verified first, then the pending request is looked up: absent is noPending)`, "docs/27 section 3 (this scenario exists because the gated flow needs the host's policy configuration; the request is the harness's stand-in, class D)"],
    [connect, enrol("K1"), step({ id: "gate", source: request, do: { initiate: { by: "E", to: "K1", kind: "consent-gate", capture: "thread", args: { approvers: ["$K1"] } } }, expect: [{ at: "K1", received: { type: REQUEST, count: 1 } }] }),
      decide("decide", "K1", undefined, [{ at: "K1", received: { code: "task-consent/decision:noPending", count: 1 } }, { at: "K1", ceremony: "refused" }])],
    { participants: { E: E("executor-leg"), K1: A() }, allowedTerminals: ["refused" as const], reads: ["E", "K1"], completion: { thread: "thread", assert: [{ at: "E", ceremony: "refused" }, { at: "K1", ceremony: "refused" }] } });

  return {
    format: "tt-ceremony-scenarios/0.1", group: "FC-KVC", family: "ceremony-scenarios", evidence: "complete-ceremony",
    ceremony: { name: "KW-to-VTI task-consent: an executor holds a gated task, approvers decide", channel: "proposed",
      choreography: "docs/27-kw-vti-ceremonies.md section 2: the requester submits a gated task, the executor refuses it for consent and asks its approvers, each approver's decision (built and signed by the approver's own code) is relayed back, the requester re-submits and the executor executes once. The steps are the same whichever executor (the reference oracle, a VTA) and whichever approver (the reference, the wallet) plays." },
    scenarios: [happy, two, outsider, replay, deny, ...negatives, stepDown, twice, leg],
  };
}

// ---------------------------------------------------------------- FC-KVX: credential exchange, a verifier and a holder (query, present)
// The holder is the wallet (its own handler and its own `respondToCredentialExchangeQuery`); the verifier is the reference oracle or the community service (VTC). The steps are
// those of FC-CEX-003 (a query to a holder that does not pre-trust the verifier is deferred until its human decides), plus the holder's decline and three presentations that were
// changed in one way after the holder built them (class D, src/ceremony/tamper.ts). The issuing leg (offer, request, issue) is not here: the wallet never builds `credential-exchange/offer`,
// `request` or `issue` (it redeems an invitation offer by an HTTP request to the community, a different path), so no KW-to-VTI pair exists for it (docs/27 section 6).
export function kvxFile(src: Src): ScenarioFile {
  const CEX = "https://trusttasks.org/spec/credential-exchange";
  const querySrc = src("credential-exchange/query", "0.1"), presentSrc = src("credential-exchange/present", "0.1");
  const connect = step({ id: "connect", do: { connect: "all" } });
  const P = ["optional:initiate", "optional:peer.connect", "optional:observe.received", "optional:observe.ceremony", "optional:observe.pushed"];
  const verifier = { role: "verifier", requires: [...P, `${CEX}/present/0.1`] };
  const holder = { role: "holder", requires: [...P, "optional:trigger.holdCredential", "optional:trigger.queryDecision", `${CEX}/query/0.1`] };
  const base = { source: querySrc, participants: { V: verifier, H: holder }, carrier: { modes: ["runner-carried" as const] }, deadlineMs: 60000 };
  // the holder holds a credential of the reference's type AND one of the community's membership type, so the query of either verifier (the oracle asks for the first, the VTC for `MembershipCredential`) finds a match
  const hold = step({ id: "hold", do: { decide: { by: "H", action: "holdCredential", args: {} } } });
  const holdMembership = step({ id: "hold-membership", do: { decide: { by: "H", action: "holdCredential", args: { type: "MembershipCredential" } } } });
  const query = step({ id: "query", source: querySrc, do: { initiate: { by: "V", to: "H", kind: "cex-query", capture: "thread" } },
    expect: [{ at: "H", received: { type: `${CEX}/query/0.1`, count: 1 } }, { at: "H", ceremony: "held" }, { at: "V", stored: { kind: "presentation", count: 0 } }] });
  const decideH = (decision: "approve" | "decline", tamper?: string): ScenarioStep => step({ id: decision, do: { decide: { by: "H", action: "queryDecision", args: { thread: "$thread:thread", decision, ...(tamper === undefined ? {} : { tamper }) } } } });
  const present = (expect: NonNullable<ScenarioStep["expect"]>): ScenarioStep => step({ id: "present", source: presentSrc, do: { relayPushed: { from: "H", to: "V", type: `${CEX}/present/0.1` } }, expect });
  const spec = ["TF specs/credential-exchange/query/0.1/spec.md (a query to a holder that does not pre-trust the verifier waits for the holder's decision)", "TF specs/credential-exchange/present/0.1/spec.md (the presentation is bound to the verifier's nonce and audience, once)", "docs/27-kw-vti-ceremonies.md section 4"];
  const happy: Scenario = { id: "FC-KVX-001", title: "the verifier's query is deferred by the wallet until its person approves; the wallet's presentation is accepted on the query's thread and the verifier keeps it", spec, ...base, allowedTerminals: ["completed"],
    steps: [connect, hold, holdMembership, query, decideH("approve"), present([{ at: "V", stored: { kind: "presentation", count: 1 } }])],
    completion: { thread: "thread", assert: [{ at: "V", ceremony: "completed" }, { at: "H", ceremony: "completed" }, { at: "V", stored: { kind: "presentation", count: 1 } }] } };
  const declined: Scenario = { id: "FC-KVX-002", title: "the wallet's person declines the deferred query: nothing is presented, the verifier keeps nothing and the wallet reads declined", spec, ...base, allowedTerminals: ["declined"], reads: ["H"],
    steps: [connect, hold, holdMembership, query, decideH("decline")],
    completion: { thread: "thread", assert: [{ at: "H", ceremony: "declined" }, { at: "V", stored: { kind: "presentation", count: 0 } }] } };
  const NEG: [string, string, string, string?][] = [
    ["FC-KVX-003", "noProof", "a presentation document with no proof", "proofRequired"],
    ["FC-KVX-004", "badSignature", "a presentation document whose signature does not verify", "proofInvalid"],
    ["FC-KVX-005", "wrongRecipient", "a presentation document addressed to another party", "wrongRecipient"],
  ];
  const neg = NEG.map(([id, mode, what, code]): Scenario => ({ id, title: `${what} is refused by the verifier and keeps nothing; the wallet reads refused`, spec: [...spec, "SPEC.md section 7.2 and 8.3 (the standard refusal codes)"], ...base, allowedTerminals: ["refused"], reads: ["H"],
    steps: [connect, hold, holdMembership, query, decideH("approve", mode), present([{ at: "H", received: { code, count: 1 } }, { at: "V", stored: { kind: "presentation", count: 0 } }])],
    completion: { thread: "thread", assert: [{ at: "H", ceremony: "refused" }, { at: "V", stored: { kind: "presentation", count: 0 } }] } }));
  return {
    format: "tt-ceremony-scenarios/0.1", group: "FC-KVX", family: "ceremony-scenarios", evidence: "complete-ceremony",
    ceremony: { name: "KW-to-VTI credential exchange: a verifier queries the wallet, the wallet presents", channel: "proposed",
      choreography: "docs/27-kw-vti-ceremonies.md section 4: the verifier's query, the wallet's own deferral and its person's decision, the presentation relayed to the verifier on the query's thread, the verifier's own reading" },
    scenarios: [happy, declined, ...neg],
  };
}
