// SPDX-License-Identifier: Apache-2.0
// FC-MAT (docs/25): in-person mutual attestation, defined by ceremonies/mutual-attestation/0.1 in the Trust Tasks repository (two credential-exchange/issue
// steps, anchor-rooted, no order between them), as a whole ceremony between two reference parties. The oracle first, then the mutants that must end a
// scenario `failed`. Never a statement about a platform.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const party = (seed: number, mut?: string) => `reference-party:seed=${seed},attested${mut === undefined ? "" : `,mut=${mut}`}`;
const run = async (specs: Record<string, string>, id: string) => (await runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", only: [id] })).results[0]!;
const PAIR = (f?: string, s?: string) => ({ F: party(120, f), S: party(121, s) });
const IDS = ["FC-MAT-001", "FC-MAT-002", "FC-MAT-003"];

describe("FC-MAT: the oracle", () => {
  for (const id of IDS) {
    it(`${id} completes, both parties read completed in both directions, never a conformance count`, async () => {
      const r = await run(PAIR(), id);
      assert.equal(r.status, "completed", r.reason);
      assert.deepEqual(Object.values(r.participants).map((p) => p.states), ["completed", "completed"]);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
      assert.ok(r.assertions.length >= 6 && r.assertions.every((a) => a.ok));
    });
  }
  it("each direction builds its own three documents, and the two issues come from different parties", async () => {
    const out = await runScenarios(files(), { make: (s) => makeAdapter(PAIR()[s as "F" | "S"]), specs: PAIR(), today: "2026-11-18", only: ["FC-MAT-001"] });
    const issues = out.transcript.filter((t) => t.kind === "built" && t.bytes.includes("credential-exchange/issue/0.1"));
    assert.equal(issues.length, 2);
    assert.notEqual(issues[0]!.from, issues[1]!.from);
    assert.equal(out.transcript.filter((t) => t.kind === "built").length, 6);
  });
  it("the scenario's steps match the ceremony definition: the two issue steps carry the definition's step names, issuers and recipients, and no prev between them", () => {
    const tf = process.env["TT_KIT"];
    const defPath = tf === undefined ? "" : join(tf, "ceremonies/mutual-attestation/0.1/ceremony.json");
    if (!existsSync(defPath)) return; // no Trust Tasks checkout named by TT_KIT: this check is not run
    const def = JSON.parse(readFileSync(defPath, "utf8")) as { steps: Record<string, { type: string; issuer: string; recipient: string; prev: string[] }>; completion: { allOf: string[] } };
    const s = files().flatMap((f) => f.scenarios).find((x) => x.id === "FC-MAT-001")!;
    const roleSlot = Object.fromEntries(Object.entries(s.participants).map(([slot, p]) => [p.role, slot]));
    for (const [name, d] of Object.entries(def.steps)) {
      assert.deepEqual(d.prev, []);
      const st = s.steps.find((x) => x.id === name)!;
      assert.ok(st, `step ${name}`);
      assert.equal(st.source?.slug, "credential-exchange/issue");
      assert.equal(st.do.relayPushed?.from, roleSlot[d.issuer]);
      assert.equal(st.do.relayPushed?.to, roleSlot[d.recipient]);
    }
    assert.deepEqual(def.completion.allOf, ["attest-first", "attest-second"]);
  });
  it("an adapter that serves no credential exchange is skipped with the reason", async () => {
    assert.equal((await run({ F: "reference-witness", S: party(121) }, "FC-MAT-001")).status, "skipped");
  });
});

describe("FC-MAT: non-vacuity", () => {
  // [scenario, specs, step it must fail at]
  const MUT: [string, string, Record<string, string>, string][] = [
    ["the first person never keeps the credential issued to it", "FC-MAT-001", PAIR("cexNeverStores"), "attest-second"],
    ["the second person never keeps the credential issued to it", "FC-MAT-001", PAIR(undefined, "cexNeverStores"), "attest-first"],
    ["the second person pushes no request", "FC-MAT-001", PAIR(undefined, "noPush"), "request-second"],
    ["the first person pushes no request", "FC-MAT-001", PAIR("noPush"), "offer-first"],
    ["the second person's request is on another thread", "FC-MAT-001", PAIR(undefined, "pushedWrongThread"), "request-second"],
    ["the first person's documents are of a wrong type", "FC-MAT-001", PAIR("pushedWrongType"), "offer-first"],
    ["the first person's documents go to a wrong recipient", "FC-MAT-001", PAIR("pushedWrongRecipient"), "offer-first"],
    ["the first person never keeps the credential (attestations issued in the other order)", "FC-MAT-002", PAIR("cexNeverStores"), "attest-second"],
    ["the second person never keeps the credential (all offers and requests first)", "FC-MAT-003", PAIR(undefined, "cexNeverStores"), "attest-first"],
  ];
  for (const [name, id, specs, step] of MUT) {
    it(`${name}: ${id} ends failed at ${step}`, async () => {
      const r = await run(specs, id);
      assert.equal(r.status, "failed", `${r.status}: ${r.reason}`);
      assert.equal(r.failedStep, step, r.reason);
    });
  }
});
