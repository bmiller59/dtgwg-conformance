// SPDX-License-Identifier: Apache-2.0
// FC-ONB (docs/30 section 3): community member onboarding, defined by ceremonies/vtc/member-onboarding/0.1 in the Trust Tasks repository, authored at the task versions the platforms serve
// (manifest 0.4, submit 0.3; the definition cites 0.1). Two seats, the applicant's wallet (K) and the community (V); the administrator is a harness-held identity, the community's own console.
// The oracle pair first (src/adapters/reference/join-reference.ts), then the mutants that must end a scenario `failed`. Never a statement about a platform, never a conformance count.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const scenarios = () => files().flatMap((f) => f.scenarios).filter((s) => s.id.startsWith("FC-ONB-"));
const specsFor = (mut?: string) => ({ K: "reference-joiner", V: mut === undefined ? "reference-community" : `reference-community:mut=${mut}` });
const out = (id: string, mut?: string) => { const specs = specsFor(mut); return runScenarios(files(), { make: (s) => makeAdapter(specs[s as "K" | "V"]), specs, today: "2026-11-21", only: [id] }); };
const run = async (id: string, mut?: string) => (await out(id, mut)).results[0]!;
const IDS = Array.from({ length: 8 }, (_, i) => `FC-ONB-00${i + 1}`);
const TT = "https://trusttasks.org/spec/";

describe("FC-ONB: the oracle pair", () => {
  for (const [id, status, terminal] of [["FC-ONB-001", "completed", "completed"], ["FC-ONB-002", "completed", "completed"], ["FC-ONB-003", "completed", "completed"], ["FC-ONB-004", "completed", "completed"],
    ["FC-ONB-005", "completed", "completed"], ["FC-ONB-006", "ended-as-specified", "refused"], ["FC-ONB-007", "ended-as-specified", "refused"], ["FC-ONB-008", "completed", "completed"]] as const) {
    it(`${id} ends ${status} (${terminal}), never a conformance count`, async () => {
      const r = await run(id);
      assert.equal(r.status, status, r.reason);
      assert.equal(r.terminal, terminal);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
      assert.ok(r.assertions.length >= 2 && r.assertions.every((a) => a.ok));
    });
  }
  it("the group has exactly the eight scenarios, on the proposed channel, with two seats (the administrator is the community's console, not a participant)", () => {
    assert.deepEqual(scenarios().map((s) => s.id), IDS);
    assert.equal(files().find((f) => f.group === "FC-ONB")!.ceremony.channel, "proposed");
    for (const s of scenarios()) assert.deepEqual(Object.keys(s.participants).sort(), ["K", "V"], s.id);
  });
  it("every step runs at the latest versions: manifest 0.4, submit 0.3, and no step claims the retired submit 0.1 or the old manifest", () => {
    for (const s of scenarios()) for (const st of s.steps) {
      if (st.source === undefined) continue;
      if (st.source.slug === "vtc/join-requests/submit") assert.equal(st.source.version, "0.3", `${s.id}/${st.id}`);
      if (st.source.slug === "vtc/join-requests/manifest") assert.equal(st.source.version, "0.4", `${s.id}/${st.id}`);
      assert.notEqual(st.source.tfRef?.status, "retired", `${s.id}/${st.id}`);
    }
    for (const s of scenarios()) for (const r of s.participants["V"]!.requires) assert.ok(!/join-requests\/(submit|manifest)\/0\.[12]$/.test(r), `${s.id}: ${r}`);
  });
  it("the application is under a named criterion and the community's answer names the request (submit 0.3: requestId and a verdict)", async () => {
    const o = await out("FC-ONB-001");
    const docs = o.transcript.filter((x) => x.kind === "built" || x.kind === "reply").map((x) => JSON.parse(x.bytes) as { type: string; issuer?: string; payload: Record<string, unknown> });
    const submit = docs.find((d) => d.type === `${TT}vtc/join-requests/submit/0.3`)!;
    const answer = docs.find((d) => d.type === `${TT}vtc/join-requests/submit/0.3#response`)!;
    assert.equal(typeof answer.payload["requestId"], "string");
    assert.equal((answer.payload["verdict"] as { effect: string }).effect, "refer");
    assert.equal(typeof submit.payload["criterion"], "string");
    assert.equal((submit.payload["vp"] as { holder: string }).holder, submit.issuer);
  });
  it("the reciprocal exchange closes the approved request: the vmc carries the request id of the application", async () => {
    const o = await out("FC-ONB-004");
    const vmc = o.transcript.filter((x) => x.kind === "built").map((x) => JSON.parse(x.bytes) as { type: string; payload: { requestId?: string; vc: { type: string[] } } }).find((d) => d.type === `${TT}vtc/members/vmc/0.1`)!;
    const answer = o.transcript.filter((x) => x.kind === "reply").map((x) => JSON.parse(x.bytes) as { type: string; payload: Record<string, unknown> }).find((d) => d.type === `${TT}vtc/join-requests/submit/0.3#response`)!;
    assert.equal(vmc.payload.requestId, answer.payload["requestId"]);
    assert.ok(vmc.payload.vc.type.includes("MembershipCredential"));
  });
});

describe("FC-ONB: mutants of the community end the scenario that watches for them `failed`", () => {
  const WATCH: [string, string[]][] = [["joinAdmitsOnSubmit", ["FC-ONB-001"]], ["joinDecidesUnknown", ["FC-ONB-005"]], ["joinDecideByAnyone", ["FC-ONB-008"]], ["joinVmcBeforeApproval", ["FC-ONB-006"]], ["joinVmcNeverStored", ["FC-ONB-004"]]];
  for (const [m, ids] of WATCH) for (const id of ids) {
    it(`${m} is caught by ${id}`, async () => {
      const r = await run(id, m);
      assert.equal(r.status, "failed", `${m} should end ${id} failed, got ${r.status}`);
    });
  }
});

describe("FC-ONB: the documents match the Trust Tasks specifications (when TT_KIT names a checkout)", () => {
  it("the oracle's own documents carry the members of the payload schemas at the versions run", async () => {
    const tf = process.env["TT_KIT"];
    if (tf === undefined || !existsSync(join(tf, "specs/vtc/join-requests/submit/0.3/payload.schema.json"))) { console.log("# FC-ONB schema test skipped: TT_KIT names no Trust Tasks checkout"); return; }
    let checked = 0;
    for (const id of ["FC-ONB-001", "FC-ONB-004"]) {
      for (const t of (await out(id)).transcript.filter((x) => x.kind === "built" || x.kind === "reply")) {
        const d = JSON.parse(t.bytes) as { type: string; payload: Record<string, unknown> };
        if (d.type.includes("/trust-task-error/") || !d.type.startsWith(`${TT}vtc/`)) continue;
        const resp = d.type.endsWith("#response");
        const path = join(tf, "specs", d.type.slice(TT.length).replace("#response", ""), "payload.schema.json");
        if (!existsSync(path)) continue;
        const schema = JSON.parse(readFileSync(path, "utf8")) as { required?: string[]; properties?: Record<string, unknown>; $defs?: { Response?: { required?: string[]; properties?: Record<string, unknown> } } };
        const sh = resp ? schema.$defs?.Response : schema;
        if (sh === undefined) continue;
        for (const k of sh.required ?? []) assert.ok(k in d.payload, `${d.type}: payload member ${k}`);
        for (const k of Object.keys(d.payload)) assert.ok(k in (sh.properties ?? {}), `${d.type}: payload has no member ${k}`);
        checked++;
      }
    }
    assert.ok(checked >= 8, `checked ${checked} documents`);
  });
  it("the scenarios keep the definition's order and its three-round bound", () => {
    const tf = process.env["TT_KIT"];
    const defPath = tf === undefined ? "" : join(tf, "ceremonies/vtc/member-onboarding/0.1/ceremony.json");
    if (!existsSync(defPath)) { console.log("# FC-ONB definition test skipped: TT_KIT names no Trust Tasks checkout"); return; }
    const def = JSON.parse(readFileSync(defPath, "utf8")) as { steps: Record<string, { prev: string[]; maxRounds?: number }> };
    assert.equal(def.steps["supplement"]!.maxRounds, 3);
    assert.deepEqual(def.steps["solicit"]!.prev, ["decide"]);
    assert.deepEqual(def.steps["reciprocate"]!.prev, ["ask"]);
    for (const s of scenarios()) {
      const at = (n: string) => s.steps.findIndex((x) => x.id === n);
      for (const [n, p] of [["apply", "discover"], ["decide", "apply"], ["solicit", "decide"], ["reciprocate", "solicit"]] as const) if (at(n) >= 0 && at(p) >= 0) assert.ok(at(p) < at(n), `${s.id}: ${p} before ${n}`);
    }
    assert.ok(scenarios().some((s) => s.steps.filter((x) => x.id.startsWith("status")).length === 3), "a scenario polls three rounds");
  });
});

describe("FC-ONB-004: the credential delivery and the wallet's acknowledgement", () => {
  it("hands the community's pushed credential delivery to the applicant, only if the community can hand it out, before it asks for the acknowledgement", () => {
    const s = scenarios().find((x) => x.id === "FC-ONB-004")!;
    const at = (n: string) => s.steps.findIndex((x) => x.id === n);
    const d = s.steps[at("deliver")]!;
    assert.deepEqual(d.do.relayPushed, { from: "V", to: "K", type: `${TT}credential-exchange/issue/0.1`, ifOffered: true });
    assert.ok(at("decide") < at("deliver") && at("deliver") < at("solicit") && at("solicit") < at("reciprocate"));
  });
  it("is skipped by a sender without observe.pushed (the oracle community pushes only types), and still completes there", async () => {
    assert.equal((await run("FC-ONB-004")).status, "completed");
  });
  it("the wallet declares the reciprocate capability with the other ceremony capabilities", async () => {
    const { capabilities } = await import("../src/adapters/keyring-wallet/shim.ts");
    const c = capabilities({ commit: "x", bifoldCommit: "y", walletTypes: [], consent: false, ceremony: { initiates: ["join-vmc"] } } as never);
    assert.ok(c.optional.includes("initiate.reciprocate"));
    assert.ok(c.optional.includes("initiate.foreignPresentation"), "FC-ONB-007: the wallet's own VP builder with another holder named (driver stand-in)");
    assert.ok(c.optional.includes("observe.received"));
    assert.ok(c.optional.includes("castFutureVersion"), "FC-BAL-014: the ballot-cast kind posts a cast built at the version args name, through the wallet's own postCast");
  });
});
