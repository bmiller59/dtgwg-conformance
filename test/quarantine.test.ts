// SPDX-License-Identifier: Apache-2.0
// Quarantine of flaky vectors (docs/04 section 18.9): a current entry records the result as QUARANTINED (advisory: in no count, roll-up
// or exit code; visible in the matrix, on the console and at a glance); an expired entry makes the result FAIL, like an expired exception.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { tally } from "../src/glance/model.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { loadQuarantine, validateQuarantine } from "../src/runner/quarantine.ts";
import type { QuarantineEntry } from "../src/runner/quarantine.ts";
import { exitCode, runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const full = loadSuite(VECTORS);
const env = full.files.find((f) => f.file.group === "ENV")!;
const suite = { root: full.root, files: [env] };
const id = env.file.vectors.find((v) => v.clarify === null)!.id;
const today = "2026-11-16";
const entry = (over: Partial<QuarantineEntry> = {}): QuarantineEntry => ({ vector: id, reason: "times out on a live relay", observedOn: ["2026-11-15-example"], owner: "suite maintainers", expires: "2026-12-01", ...over });
const run = (quarantine: QuarantineEntry[]) => runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, quarantine });

describe("quarantine file", () => {
  it("the shipped file is valid", () => {
    assert.ok(Array.isArray(loadQuarantine(join(ROOT, "exceptions", "quarantine.json")).quarantine));
  });
  it("requires vector, reason, at least one observation, owner and expiry", () => {
    assert.deepEqual(validateQuarantine({ format: "tt-conformance-quarantine/0.1", quarantine: [entry()] }), []);
    const bad = validateQuarantine({ format: "x", quarantine: [{ vector: "ENV-001", reason: "", observedOn: [], owner: "", expires: "soon" }] });
    for (const re of [/format/, /reason required/, /observedOn/, /owner required/, /expires must be YYYY-MM-DD/]) assert.ok(bad.some((p) => re.test(p)), String(re));
  });
});

describe("a quarantined vector", () => {
  it("runs, is recorded QUARANTINED with the observed outcome, and stays out of counts, roll-up and the exit code", async () => {
    const r = await run([entry()]);
    const x = r.results.find((y) => y.id === id)!;
    assert.equal(x.status, "QUARANTINED");
    assert.match(x.reason!, /owner suite maintainers, expires 2026-12-01; observed on 2026-11-15-example\): times out on a live relay; observed pass in this run/);
    assert.equal(exitCode([r]), 0);
    // even a quarantined FAIL-like outcome never reaches the exit code: only FAIL does
    assert.equal(exitCode([{ ...r, results: [{ ...x, status: "QUARANTINED" }] }]), 0);
    const m = buildMatrix([r]);
    const counts = m.rows[0]!.families[env.file.family]!.counts;
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), r.results.length - 1);
    assert.deepEqual(m.rows[0]!.quarantined, [id]);
    assert.match(matrixMarkdown(m), new RegExp(`Quarantined as flaky, .*${id}`));
    const t = tally(r.results.map((y) => ({ ...y, cls: undefined })) as unknown as Parameters<typeof tally>[0]);
    assert.equal(t.quarantined, 1);
    assert.equal(t.total, r.results.length - 1);
  });
  it("cannot stay quarantined past expiry: an expired entry makes the result FAIL and the exit code non-zero", async () => {
    const r = await run([entry({ expires: "2026-11-15" })]);
    const x = r.results.find((y) => y.id === id)!;
    assert.equal(x.status, "FAIL");
    assert.match(x.reason!, /^quarantine expired on 2026-11-15 \(owner suite maintainers\)/);
    assert.equal(exitCode([r]), 1);
  });
  it("applies only to the named implementation and tier", async () => {
    for (const q of [entry({ impl: "someone-else" }), entry({ tier: 2 })]) {
      const r = await run([q]);
      assert.equal(r.results.find((y) => y.id === id)!.status, "PASS");
    }
    const r = await run([entry({ impl: "reference" })]);
    assert.equal(r.results.find((y) => y.id === id)!.status, "QUARANTINED");
  });
});
