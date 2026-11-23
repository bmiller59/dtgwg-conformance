// SPDX-License-Identifier: Apache-2.0
// SPEC-CHANGED (docs/23): the cited spec moved and the vector has not been re-checked. The vector runs and is shown, but the result is
// advisory: in no count, no roll-up, never in the exit code, and never a pass or a fail.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { tally } from "../src/glance/model.ts";
import { specPinLine } from "../src/glance/spec-pin.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { exitCode, runSuite, STATUSES } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { SPEC_CHANGED_TEXT, validatePinLog, validateSpecFlags } from "../src/vectors/spec-flags.ts";
import type { SpecFlag } from "../src/vectors/spec-flags.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const full = loadSuite(VECTORS);
const env = full.files.find((f) => f.file.group === "ENV")!;
const suite = { root: full.root, files: [env] };
const id = env.file.vectors.find((v) => v.clarify === null)!.id;
const flag: SpecFlag = { oldHash: `sha256:${"a".repeat(64)}`, newHash: `sha256:${"b".repeat(64)}`, tfCommit: "c".repeat(40), detectedOn: "2026-11-18" };
const run = (specFlags: Record<string, SpecFlag>) => runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-18", fixtureRoot: FIXTURES, specFlags });

describe("SPEC-CHANGED", () => {
  it("is a status", () => assert.ok((STATUSES as readonly string[]).includes("SPEC-CHANGED")));
  it("records a flagged vector as SPEC-CHANGED, in no count, roll-up or exit code", async () => {
    const r = await run({ [id]: flag });
    const x = r.results.find((y) => y.id === id)!;
    assert.equal(x.status, "SPEC-CHANGED");
    assert.ok(x.reason!.startsWith(SPEC_CHANGED_TEXT));
    assert.match(x.reason!, /observed pass in this run/);
    assert.equal(exitCode([r]), 0);
    assert.equal(exitCode([{ ...r, results: [{ ...x, status: "SPEC-CHANGED", failures: ["boom"] }] }]), 0);
    const m = buildMatrix([r]);
    const counts = m.rows[0]!.families[env.file.family]!.counts;
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), r.results.length - 1);
    assert.deepEqual(m.rows[0]!.specChanged, [id]);
    assert.match(matrixMarkdown(m), new RegExp(`Spec changed, .*${id}.*the spec moved; this test has not been re-checked`));
    const t = tally(r.results.map((y) => ({ ...y, cls: undefined })) as unknown as Parameters<typeof tally>[0]);
    assert.equal(t.specChanged, 1);
    assert.equal(t.total, r.results.length - 1);
  });
  it("leaves every other vector untouched", async () => {
    const plain = await run({});
    assert.equal(plain.results.filter((y) => y.status === "SPEC-CHANGED").length, 0);
  });
});

describe("flag and log files", () => {
  it("validate their shape", () => {
    assert.deepEqual(validateSpecFlags({ format: "tt-spec-flags/0.1", flags: { [id]: flag } }), []);
    assert.ok(validateSpecFlags({ format: "x", flags: { A: { ...flag, tfCommit: "x", detectedOn: "soon" } } }).length >= 3);
    const e = { vector: id, oldHash: "a", newHash: "b", tfCommit: "c".repeat(40), decision: "still-correct", reviewer: "R", date: "2026-11-18" };
    assert.deepEqual(validatePinLog({ format: "tt-spec-pin-log/0.1", log: [e, { ...e, wordingOnly: true }] }), []);
    assert.ok(validatePinLog({ format: "tt-spec-pin-log/0.1", log: [{ ...e, decision: "vector-changed", wordingOnly: true }] }).some((m) => /wordingOnly/.test(m)));
  });
});

describe("the Spec pin line", () => {
  it("is empty with no flags and reads as specified otherwise", () => {
    assert.equal(specPinLine({ date: "2026-11-14", flagged: 0 }), "");
    assert.equal(specPinLine({ date: "2026-11-14", flagged: 3 }), "Spec pin: 2026-11-14; 3 tests need re-checking against newer spec");
    assert.equal(specPinLine({ date: "2026-11-14", flagged: 1 }), "Spec pin: 2026-11-14; 1 test needs re-checking against newer spec");
  });
});
