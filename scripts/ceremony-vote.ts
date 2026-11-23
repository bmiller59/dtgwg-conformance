// SPDX-License-Identifier: Apache-2.0
// Authoring source of the elections group (docs/31): a member's wallet (keyring-wallet, `K`) reads the community's elections (VTI's VTC built with the voting feature, `V`). Imported by scripts/generate-ceremony-scenarios.ts.
// The reads only: the community holds no election, because creating one needs a trusted ballot box and a registrar key, and the wallet's `voting/ballot/cast/0.1` goes to a ballot box, which no VTC handler serves (docs/31 section 6).
// Channel `proposed`; the result is evidence of kind complete-ceremony, never a conformance count.
import type { Check, Scenario, ScenarioFile, ScenarioStep } from "../src/ceremony/scenario.ts";
import { SCENARIO_FORMAT } from "../src/ceremony/scenario.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import { src } from "./ceremony-pairs.ts";

const S = "https://trusttasks.org/spec/";
const step = (s: ScenarioStep): ScenarioStep => s;
const parts = (extra: string[] = []) => ({ K: { role: "member-phone", requires: ["optional:initiate", "optional:observe.ceremony", "optional:observe.received"] }, V: { role: "community", requires: extra } });
const base = { carrier: { modes: ["runner-carried" as const] }, deadlineMs: 120000, reads: ["K"] };
const init = (id: string, source: VectorSource, kind: string, args: Record<string, unknown> | undefined, expect: Check[]): ScenarioStep =>
  step({ id, source, do: { initiate: { by: "K", to: "V", kind, capture: "thread", ...(args === undefined ? {} : { args }) } }, expect });
const trig = (id: string, action: string, args: Record<string, unknown>): ScenarioStep => step({ id, do: { decide: { by: "V", action, args } } });
const kdone = (state: "completed" | "refused"): Check => ({ at: "K", ceremony: state });
const kst = (kind: string, count = 1): Check => ({ at: "K", stored: { kind, count } });
const code = (c: string, count = 1): Check => ({ at: "K", received: { code: c, count } });
const e = { list: src("vtc/elections/list", "0.5"), list3: src("vtc/elections/list", "0.3"), show: src("vtc/elections/show", "0.6") };
const P = "TF specs/vtc/elections/";
const DOC = "docs/31-persona-rooms-elections-ceremonies.md section 6";
const need = [`${S}vtc/elections/list/0.5`, `${S}vtc/elections/show/0.6`];
const vb = { ...base, participants: parts(need) };
const seedK = trig("seed-member", "seedMember", { vid: "$K" });
const done = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("completed"), ...extra] });
const refused = (extra: Check[] = []): Scenario["completion"] => ({ thread: "thread", assert: [kdone("refused"), ...extra] });

const list: Scenario = {
  id: "FC-VOT-001", title: "a member reads the community's polls at the newest version both sides serve (list 0.5): the community holds no election, so the list is empty",
  spec: [`${P}list/0.5/spec.md (a roll-scoped read of the elections the caller may see)`, "TF ceremonies (no election ceremony definition covers the member's reads; the choreography is the suite's)", DOC],
  source: e.list, ...vb, steps: [seedK, init("list", e.list, "vote-list", undefined, [kdone("completed"), kst("vote:polls:0"), kst("vote:version:0.5")])],
  allowedTerminals: ["completed"], completion: done([kst("vote:polls:0")]),
};
const unknown: Scenario = {
  id: "FC-VOT-002", title: "a member asks to see an election the community does not hold (show 0.6): refused with vtc/elections/show:electionUnknown",
  spec: [`${P}show/0.6/spec.md (errorCodes: vtc/elections/show:electionUnknown)`, DOC],
  source: e.show, ...vb, steps: [seedK, init("show", e.show, "vote-show", { electionId: "no-such-election" }, [code("vtc/elections/show:electionUnknown"), kdone("refused")])],
  allowedTerminals: ["refused"], completion: refused([kst("vote:refused:electionUnknown")]),
};
const outsider: Scenario = {
  id: "FC-VOT-003", title: "a wallet whose persona is not on the community's roll asks for the polls: the community includes an election only when the caller may see it, so the answer is an empty list, not a refusal, and the wallet reads no poll",
  spec: [`${P}list/0.5/spec.md (consumer item 1: MUST include an election only when the caller may see it; the task declares no error code, so a caller who may see none is answered with an empty list)`, DOC],
  source: e.list, ...vb, steps: [init("list", e.list, "vote-list", undefined, [kdone("completed"), kst("vote:polls:0")])],
  allowedTerminals: ["completed"], completion: done([kst("vote:polls:0")]),
};
const stepDown: Scenario = {
  id: "FC-VOT-004", title: "the version skew: the wallet asks for the polls at 0.5 of a community that serves 0.3 only: the community names what it serves, the wallet's ladder asks at 0.3, and the list is read (a labelled step-down against a legacy profile)",
  spec: [`${P}list/0.3 and 0.5 (two served versions)`, "SPEC.md 8.3 (unsupportedVersion)", DOC],
  source: e.list3, carrier: base.carrier, deadlineMs: base.deadlineMs, reads: base.reads, participants: parts(["optional:trigger.serveVersions"]),
  steps: [trig("serve-legacy", "serveVersions", { profile: "legacy" }), seedK, init("list", e.list3, "vote-list", undefined, [code("unsupportedVersion"), kdone("completed"), kst("vote:polls:0"), kst("vote:version:0.3")])],
  allowedTerminals: ["completed"], completion: done([kst("vote:version:0.3")]),
};
export const voteFile: ScenarioFile = {
  format: SCENARIO_FORMAT, group: "FC-VOT", family: "ceremony-scenarios", evidence: "complete-ceremony",
  ceremony: { name: "Elections, the member's reads (wallet and community)", channel: "proposed", choreography: "docs/31-persona-rooms-elections-ceremonies.md section 6: the polls list, an unknown election, an outsider, and the version step-down against a legacy profile. Creating an election, registering, taking a ticket and casting are not run." },
  scenarios: [list, unknown, outsider, stepDown],
};
export const voteFiles: { file: string; data: ScenarioFile }[] = [{ file: "fc-vot.json", data: voteFile }];
