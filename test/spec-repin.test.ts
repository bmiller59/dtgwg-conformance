// SPDX-License-Identifier: Apache-2.0
// Re-pin and the pin rule (src/vectors/repin.ts, docs/23).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyRepin, pinRuleProblems } from "../src/vectors/repin.ts";
import { loadPinLog, loadSpecFlags, validatePinLog, validateSpecFlags } from "../src/vectors/spec-flags.ts";
import type { PinLogEntry, SpecFlag } from "../src/vectors/spec-flags.ts";
import type { SpecHashesFile, VectorSource } from "../src/vectors/source.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";
import { loadTfManifest } from "../src/vectors/tfref.ts";

const C = "0dbc98f1c059af300ff84eb1ab407edea16a16c1", D = "d".repeat(40);
const h = (c: string): string => `sha256:${c.repeat(64)}`;
const P = "specs/acl/grant/0.3/spec.md";
const src = (specHash: string, tfCommit = C): VectorSource => ({ slug: "acl/grant", version: "0.3", channel: "proposed", profile: "2L", ref: "kit:specs/acl/grant/0.3", pinnedDigest: null, tfRef: { status: "draft", repoPath: P, commit: C }, tfCommit, specHash });
const flag = (over: Partial<SpecFlag> = {}): SpecFlag => ({ oldHash: h("a"), newHash: h("b"), tfCommit: D, detectedOn: "2026-11-18", what: "spec", ...over });
const table: SpecHashesFile = { format: "tt-spec-hashes/0.1", tfCommit: C, paths: { [P]: { specHash: h("a") } } };
const base = { vectors: [{ id: "A-001", source: src(h("a")) }, { id: "A-002", source: src(h("a")) }], flags: { "A-001": flag(), "A-002": flag() }, table, log: [] as PinLogEntry[], today: "2026-11-19", tfCommit: D, reviewer: "Reviewer One", hashes: () => ({ specHash: h("b") }) };

describe("applyRepin", () => {
  it("updates the table, clears the flags and logs each vector", () => {
    const r = applyRepin({ ...base, ids: "all-clear", decision: "still-correct", wordingOnly: false });
    assert.equal(r.table.paths[P]!.specHash, h("b"));
    assert.equal(r.table.paths[P]!.tfCommit, D);
    assert.deepEqual(r.flags, {});
    assert.deepEqual(r.log.map((e) => [e.vector, e.oldHash, e.newHash, e.decision, e.reviewer, e.date]), [["A-001", h("a"), h("b"), "still-correct", "Reviewer One", "2026-11-19"], ["A-002", h("a"), h("b"), "still-correct", "Reviewer One", "2026-11-19"]]);
    assert.deepEqual(validatePinLog({ format: "tt-spec-pin-log/0.1", log: r.log }), []);
  });
  it("logs wording-only, and allows it only with still-correct", () => {
    const r = applyRepin({ ...base, ids: "all-clear", decision: "still-correct", wordingOnly: true });
    assert.ok(r.log.every((e) => e.wordingOnly === true));
    assert.throws(() => applyRepin({ ...base, ids: "all-clear", decision: "vector-changed", wordingOnly: true }), /only with --decision still-correct/);
  });
  it("refuses a missing reviewer, an unflagged vector, a partial set for one file and a removed file", () => {
    assert.throws(() => applyRepin({ ...base, ids: "all-clear", decision: "still-correct", wordingOnly: false, reviewer: " " }), /--reviewer/);
    assert.throws(() => applyRepin({ ...base, ids: ["A-003"], decision: "still-correct", wordingOnly: false }), /not flagged/);
    assert.throws(() => applyRepin({ ...base, ids: ["A-001"], decision: "still-correct", wordingOnly: false }), /also name A-002/);
    assert.throws(() => applyRepin({ ...base, ids: "all-clear", decision: "still-correct", wordingOnly: false, hashes: () => null }), /not in the checkout/);
  });
});

describe("pin rule", () => {
  it("holds for a flag whose hash is unchanged and which has no log entry", () => {
    assert.deepEqual(pinRuleProblems(base), []);
  });
  it("fails when a flagged vector's hash changed with no log entry (a bulk bump)", () => {
    const p = pinRuleProblems({ ...base, vectors: [{ id: "A-001", source: src(h("b")) }, base.vectors[1]!] });
    assert.equal(p.length, 1);
    assert.match(p[0]!, /A-001: the hash changed .* no entry/);
  });
  it("allows a changed hash that the log records, but then the flag must be cleared", () => {
    const entry: PinLogEntry = { vector: "A-001", oldHash: h("a"), newHash: h("b"), tfCommit: D, decision: "still-correct", reviewer: "R", date: "2026-11-19" };
    const p = pinRuleProblems({ ...base, vectors: [{ id: "A-001", source: src(h("b"), D) }, base.vectors[1]!], log: [entry] });
    assert.equal(p.length, 1);
    assert.match(p[0]!, /flag is not cleared/);
    assert.deepEqual(pinRuleProblems({ ...base, vectors: [{ id: "A-001", source: src(h("b"), D) }], flags: {}, log: [entry] }), []);
  });
  it("refuses a bumped pin whose vectors were not re-hashed and re-pinned", () => {
    const p = pinRuleProblems({ vectors: [{ id: "A-001", source: src(h("a"), D) }], flags: {}, log: [] });
    assert.match(p[0]!, /hashes are from Trust Tasks dddddddd.* re-pin/);
  });
  it("fails a flag for a vector that does not exist", () => {
    assert.match(pinRuleProblems({ vectors: [], flags: { X: flag() }, log: [] })[0]!, /no such vector/);
  });
});

describe("the committed flags and log", () => {
  it("are valid and satisfy the pin rule, and the manifest names a pin date", () => {
    const flags = loadSpecFlags();
    assert.deepEqual(validateSpecFlags({ format: "tt-spec-flags/0.1", flags }), []);
    assert.deepEqual(validatePinLog({ format: "tt-spec-pin-log/0.1", log: loadPinLog() }), []);
    assert.deepEqual(pinRuleProblems({ vectors: collectAllVectors().map((v) => ({ id: v.id, source: v.source })), flags, log: loadPinLog() }), []);
    assert.match(loadTfManifest().main.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});
