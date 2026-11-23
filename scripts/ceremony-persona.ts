// SPDX-License-Identifier: Apache-2.0
// Authoring source of the persona group (docs/31): a member's phone (keyring-wallet's VTA client, `K`) against the member's agent (VTI's VTA, `V`). Imported by scripts/generate-ceremony-scenarios.ts.
// Every step cites the Trust Tasks specification of the document it sends. The choreography is the suite's own proposal (channel `proposed`); the result of a run is evidence of kind complete-ceremony, never a
// conformance count. Not exercised: keys/export-secret success and the wallet's borrowing of the minted keys (the specification requires a channel confidential to the two parties; the runner carries documents over
// HTTPS, so the agent refuses, which FC-PER-004 records), a hosting server (the agent is registered with none), rotate-keys, contexts/delete (step-up).
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
const parts = (extra: string[] = []) => ({ K: { role: "member-phone", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"] }, V: { role: "agent", requires: extra } });
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[]): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }) } }, expect });
const trig = (id: string, action: string, args: Record<string, unknown>): ScenarioStep => step({ id, do: { decide: { by: "V", action, args } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const kst = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });
const vst = (kind: string, count = 1): Check => ({ at: "V", stored: { kind, count } });
const code = (c: string, count = 1): Check => ({ at: "K", received: { code: c, count } });
const p = { ctxCreate: src("vta/contexts/create", "1.0"), ctxList: src("vta/contexts/list", "1.0"), mint: src("vta/webvh/dids/create", "1.2"), mint10: src("vta/webvh/dids/create", "1.0"), key: src("keys/export-secret", "0.1") };
const P = "TF specs/vta/";
const DOC = "docs/31-persona-rooms-elections-ceremonies.md section 4";
const req = [`${S}vta/contexts/list/1.0`, `${S}vta/contexts/create/1.0`, `${S}vta/webvh/servers/list/1.0`, `${S}vta/dids/list/0.1`];
const pb = { ...base, participants: parts(req) };
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });
const mint = (id: string, extra: Check[] = [], args: Record<string, unknown> = {}) => init(id, p.mint, "persona-mint", args, [kdone("completed"), ...extra]);

const mintServerless: Scenario = {
  id: "FC-PER-001", title: "the phone asks the agent for its contexts and its hosting servers (none), then mints a serverless persona in the context it chose: the agent holds one new DID, the answer is a did:webvh and says it is serverless",
  spec: [`${P}contexts/list/1.0/spec.md (the caller's contexts)`, `${P}webvh/servers/list/1.0/spec.md (the registered hosting servers; none here)`, `${P}webvh/dids/create/1.2/spec.md (serverless: no serverId; the answer MUST carry serverless true and the first logEntry, MUST NOT carry serverId)`, DOC],
  source: p.mint, ...pb,
  steps: [mint("mint", [kst("persona:did-method:webvh"), kst("persona:serverless:true"), vst("dids", 1)])],
  allowedTerminals: ["completed"], completion: done([vst("dids", 1)]),
};
const afterContext: Scenario = {
  id: "FC-PER-002", title: "the phone creates the context it keeps personas in, then mints a persona: the context exists and the new DID belongs to it",
  spec: [`${P}contexts/create/1.0/spec.md (a new top-level context)`, `${P}webvh/dids/create/1.2/spec.md (contextId: the context the DID belongs to)`, DOC],
  source: p.ctxCreate, ...pb,
  steps: [init("create-context", p.ctxCreate, "persona-context", { id: "keyring", name: "Keyring" }, [kdone("completed"), vst("context:keyring")]), mint("mint", [kst("persona:did-method:webvh"), vst("dids-in:keyring", 1)])],
  allowedTerminals: ["completed"], completion: done([vst("dids-in:keyring", 1)]),
};
const duplicateContext: Scenario = {
  id: "FC-PER-003", title: "the phone creates a context that already exists: the agent refuses it with idConflict and does not treat the request as an update, and the context is unchanged",
  spec: [`${P}contexts/create/1.0/spec.md (consumer: refuse an id that already exists under the same parent with idConflict; MUST NOT treat the request as an update)`, "SPEC.md 8.3 (idConflict)", DOC],
  source: p.ctxCreate, ...pb,
  steps: [init("create-context", p.ctxCreate, "persona-context", { id: "keyring", name: "Keyring" }, [kdone("completed")]), init("create-again", p.ctxCreate, "persona-context", { id: "keyring", name: "Renamed" }, [code("idConflict"), kdone("refused")])],
  allowedTerminals: ["refused"], completion: refused([vst("context:keyring")]),
};
const borrow: Scenario = {
  id: "FC-PER-004", title: "the phone asks the agent to release a persona key over the runner's carrier, which is not confidential to the two parties: the agent refuses and releases nothing (the wallet's key borrowing, which the app does over DIDComm, therefore does not run here)",
  spec: [`${P.replace("vta/", "")}keys/export-secret/0.1/spec.md (the exchange MUST be carried over a channel confidential to the two parties)`, DOC],
  source: p.key, ...pb,
  steps: [mint("mint", [vst("dids", 1)]), init("borrow-key", p.key, "persona-borrow-key", undefined, [kdone("refused"), vst("key-released", 0)])],
  allowedTerminals: ["refused"], completion: refused([vst("key-released", 0)]),
};
const stepDown: Scenario = {
  id: "FC-PER-005", title: "the version skew: the phone mints at 1.2 of an agent that serves 1.0 only: the agent names what it serves each time nothing was minted, the phone's own ladder goes down to 1.0, and exactly one persona is minted (a labelled step-down against a legacy profile)",
  spec: [`${P}webvh/dids/create/1.0/spec.md, 1.1 and 1.2 (one payload, three served versions)`, "SPEC.md 8.3 (unsupportedVersion: the request was not taken, so asking again in a served version is a first request)", DOC],
  source: p.mint10, carrier: base.carrier, deadlineMs: base.deadlineMs, reads: base.reads, participants: parts(["optional:trigger.serveVersions"]),
  steps: [trig("serve-legacy", "serveVersions", { profile: "legacy" }), mint("mint", [code("unsupportedVersion", 2), vst("dids", 1)])],
  allowedTerminals: ["completed"], completion: done([vst("dids", 1)]),
};
export const personaFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-PER", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Persona and DID creation on the agent (phone and agent)", channel: "proposed", choreography: "docs/31-persona-rooms-elections-ceremonies.md section 4: contexts, hosting servers, a serverless persona mint, the context the persona lives in, a duplicate context, a key release over a carrier that is not confidential, and the version step-down (against a legacy profile only)." },
  scenarios: [mintServerless, afterContext, duplicateContext, borrow, stepDown],
};
export const personaFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-per.json", data: personaFile }];
