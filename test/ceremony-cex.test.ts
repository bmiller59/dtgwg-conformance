// SPDX-License-Identifier: Apache-2.0
// FC-CEX (docs/25): credential exchange as a whole ceremony between two reference parties. The oracle first, then the mutants that must end a scenario
// `failed`. Never a statement about a platform.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const party = (seed: number, mut?: string) => `reference-party:seed=${seed},attested${mut === undefined ? "" : `,mut=${mut}`}`;
const run = async (specs: Record<string, string>, id: string) => (await runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", only: [id] })).results[0]!;
const ISS = (mut?: string) => ({ I: party(110, mut), H: party(111) });
const HOLD = (mut?: string) => ({ I: party(110), H: party(111, mut) });
const VER = (vMut?: string, hMut?: string) => ({ V: party(112, vMut), H: party(111, hMut) });

describe("FC-CEX: the oracle", () => {
  for (const [id, specs] of [["FC-CEX-001", ISS()], ["FC-CEX-002", VER()], ["FC-CEX-003", VER()]] as const) {
    it(`${id} completes, both parties read completed, never a conformance count`, async () => {
      const r = await run(specs, id);
      assert.equal(r.status, "completed", r.reason);
      assert.deepEqual(Object.values(r.participants).map((p) => p.states), ["completed", "completed"]);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
    });
  }
  it("the pushed documents are relayed, never built, by the runner: each built entry is hashed and its pair delivered", async () => {
    const out = await runScenarios(files(), { make: (s) => makeAdapter(ISS()[s as "I" | "H"]), specs: ISS(), today: "2026-11-18", only: ["FC-CEX-001"] });
    assert.equal(out.transcript.filter((t) => t.kind === "built").length, 3);
    assert.equal(out.transcript.filter((t) => t.kind === "delivered").length, 3);
    for (const t of out.transcript) assert.match(t.sha256, /^[0-9a-f]{64}$/);
  });
  it("an adapter that serves no credential exchange is skipped with the reason", async () => {
    const r = await run({ I: "reference-witness", H: party(111) }, "FC-CEX-001");
    assert.equal(r.status, "skipped");
  });
});

describe("FC-CEX: non-vacuity", () => {
  // [scenario, specs, step it must fail at]
  const MUT: [string, string, Record<string, string>, string][] = [
    ["noPush at the holder: no request is pushed", "FC-CEX-001", HOLD("noPush"), "request"],
    ["request on a wrong thread (holder)", "FC-CEX-001", HOLD("pushedWrongThread"), "request"],
    ["holder never keeps the credential", "FC-CEX-001", HOLD("cexNeverStores"), "issue"],
    ["issue on a wrong thread (issuer), which also breaks its offer", "FC-CEX-001", ISS("pushedWrongThread"), "offer"],
    ["issue of a wrong type (issuer), which also breaks its offer", "FC-CEX-001", ISS("pushedWrongType"), "offer"],
    ["issue to a wrong recipient (issuer), which also breaks its offer", "FC-CEX-001", ISS("pushedWrongRecipient"), "offer"],
    ["presentation without the query's nonce (holder)", "FC-CEX-002", VER(undefined, "qryPresentNoNonce"), "query"],
    ["presentation on another thread (holder)", "FC-CEX-002", VER(undefined, "qryPresentOtherThread"), "query"],
    ["verifier keeps no presentation", "FC-CEX-002", VER("cexNeverStores"), "query"],
    ["the holder pre-trusts nobody but presents at once (deferral skipped)", "FC-CEX-003", VER(undefined, "qryAutoPresents"), "query"],
    ["deferred query is not kept for the human", "FC-CEX-003", VER(undefined, "qryNoDeferral"), "query"],
    ["the approved presentation is never pushed", "FC-CEX-003", VER(undefined, "noPush"), "present"],
    ["the approved presentation is pushed on a wrong thread", "FC-CEX-003", VER(undefined, "pushedWrongThread"), "present"],
  ];
  for (const [name, id, specs, step] of MUT) {
    it(`${name}: ${id} ends failed at ${step}`, async () => {
      const r = await run(specs, id);
      assert.equal(r.status, "failed", `${r.status}: ${r.reason}`);
      assert.equal(r.failedStep, step, r.reason);
    });
  }
});

// D610: FC-CEX-002 takes the path the holder's consent policy gives (credential-exchange/query 0.1, "Answer, defer, or refuse"). A pre-trusted verifier is answered at
// once; any other is deferred and decided out of band. The spec does not require a holder to keep a pre-trust list, so a holder that offers no `verifierTrust`
// trigger is not skipped: the scenario drives the deferred-then-consented path it follows. Steps guarded by `when` run for one of the two cases only.
describe("FC-CEX-002: the path follows the holder's consent policy (D610)", () => {
  const scenario = () => files().flatMap((f) => f.scenarios).find((s) => s.id === "FC-CEX-002")!;
  it("declares no verifierTrust requirement, and guards each path's steps by whether the holder offers it", () => {
    const s = scenario();
    assert.ok(!s.participants.H!.requires.includes("optional:trigger.verifierTrust"));
    const w = (id: string) => s.steps.find((x) => x.id === id)?.when;
    assert.deepEqual(w("trust"), { at: "H", offers: "trigger.verifierTrust", is: true });
    assert.deepEqual(w("query"), { at: "H", offers: "trigger.verifierTrust", is: true });
    for (const id of ["query-deferred", "approve", "present"]) assert.deepEqual(w(id), { at: "H", offers: "trigger.verifierTrust", is: false }, id);
  });
  it("a holder with a pre-trust list takes the immediate path (the oracle)", async () => {
    const r = await run(VER(), "FC-CEX-002");
    assert.equal(r.status, "completed", r.reason);
    assert.ok(!r.steps!.some((x) => x.id === "approve" && x.detail === "done"));
  });
  it("a holder without one is deferred, approved, and the presentation is kept: completed, not skipped", async () => {
    const specs = VER();
    const make = async (s: string) => {
      const a = await makeAdapter(specs[s as "V" | "H"]);
      if (s !== "H") return a;
      return new Proxy(a, { get: (t, p) => p === "capabilities" ? async () => { const c = await t.capabilities(); return { ...c, optional: c.optional.filter((o: string) => o !== "trigger.verifierTrust") }; } : ((v: unknown) => typeof v === "function" ? v.bind(t) : v)(Reflect.get(t, p, t)) });
    };
    const r = (await runScenarios(files(), { make, specs, today: "2026-11-18", only: ["FC-CEX-002"] })).results[0]!;
    assert.equal(r.status, "completed", r.reason);
    const done = (id: string) => r.steps!.some((x) => x.id === id && x.detail === "done");
    assert.ok(done("query-deferred") && done("approve") && done("present"), JSON.stringify(r.steps));
    assert.ok(!done("query") && !done("trust"));
  });
});
