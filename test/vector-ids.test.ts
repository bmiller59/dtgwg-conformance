// SPDX-License-Identifier: Apache-2.0
// Test-id policy (docs/04 section 20.3): ids are never reused or deleted; a vector is retired, not deleted, and a retired vector is a
// tombstone that is never run, counted or reported as SKIP. Retirement is not exclusion from a run (excludedFromRun, section 18.7).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { ledgerProblems, readLedger } from "../src/vectors/ledger.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

describe("vector id ledger", () => {
  it("every id ever issued is still in vectors/, and every vector id is in the ledger", () => {
    assert.deepEqual(ledgerProblems(ROOT), []);
  });
  it("is not vacuous: a deleted id and an unledgered id are both reported", () => {
    const ids = collectAllVectors(VECTORS).map((v) => v.id);
    const p = ledgerProblems(ROOT, [...readLedger(ROOT), "ZZZ-999"], [...ids.slice(1), "ZZZ-998"]);
    assert.ok(p.some((x) => x.startsWith(`${ids[0]} was issued`)), "deleted id reported");
    assert.ok(p.some((x) => x.startsWith("ZZZ-999 was issued")));
    assert.ok(p.some((x) => x.startsWith("ZZZ-998 is not in")));
  });
});

describe("retired vectors", () => {
  const suite = loadSuite(VECTORS);
  const base = suite.files.find((f) => f.file.group === "ENV")!;
  it("the validator takes {reason, since: <suite version>, replacedBy?} and refuses anything else", () => {
    const withRetired = (r: unknown): unknown => ({ ...base.file, vectors: [{ ...base.file.vectors[0]!, retired: r }] });
    assert.deepEqual(validateVectorFile(withRetired({ reason: "superseded", since: "0.1.0-draft", replacedBy: "ENV-002" })), []);
    for (const bad of [{ reason: "", since: "0.1.0" }, { reason: "r" }, { reason: "r", since: "next" }, { reason: "r", since: "0.2.0", replacedBy: "nope" }, true]) {
      assert.match(validateVectorFile(withRetired(bad)).join(), /retired/, JSON.stringify(bad));
    }
  });
  it("a retired vector is kept in its file but never run, counted or reported as SKIP; the run lists it apart", async () => {
    const file = structuredClone(base.file);
    const id = file.vectors[0]!.id;
    file.vectors[0]!.retired = { reason: "superseded by a clearer vector", since: "0.1.0-draft" };
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite: { root: suite.root, files: [{ path: base.path, file }] }, tier: 1, today: "2026-11-13", fixtureRoot: FIXTURES });
    assert.equal(run.results.find((r) => r.id === id), undefined);
    assert.deepEqual(Object.keys(run.retired ?? {}), [id]);
    assert.match(run.retired![id]!, /^retired in 0\.1\.0-draft: /);
    assert.equal(run.excludedFromRun?.[id], undefined, "retirement is not exclusion from a run");
    assert.equal(run.results.length + (run.excludedByTier ?? []).length, file.vectors.length - 1); // the rest run, or are left out by tier
  });
});
