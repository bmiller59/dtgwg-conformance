// SPDX-License-Identifier: Apache-2.0
// The pin agreement check (src/vectors/pins-check.ts): every generator input that records a task-force commit records the manifest's.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPins, formatPinReport, sameCommit } from "../src/vectors/pins-check.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const A = "a".repeat(40), B = "b".repeat(40);
const tmp = mkdtempSync(join(tmpdir(), "tt-pins-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const put = (root: string, p: string, body: unknown): void => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), JSON.stringify(body)); };
/** A small suite tree whose recorded commits are given (null leaves the imported fixtures without one). */
function tree(name: string, o: { main?: string; kit?: string; snap?: string; extra?: string; inv?: string; scope?: string; hashes?: string; prov?: string | null } = {}): string {
  const r = join(tmp, name);
  put(r, "vectors/tf-manifest.json", { main: { commit: o.main ?? A }, kit: { commit: o.kit ?? A } });
  put(r, "vectors-src/gap/tf-snapshot.json", { tfCommit: o.snap ?? A });
  put(r, "vectors-src/complete/tf-extra.json", { tfCommit: o.extra ?? A });
  put(r, "vectors-src/coverage/tf-invalid-examples.json", { kit: `repo origin/main ${o.inv ?? A} (status draft)` });
  put(r, "vectors/complete/not-generated.json", { scopeInputs: { "task force repository (origin/main)": o.scope ?? A.slice(0, 9) } });
  put(r, "vectors-src/spec-hashes.json", { tfCommit: o.hashes ?? A });
  put(r, "vectors/imported/PROVENANCE.json", { commit: o.prov === undefined ? A : o.prov, importedOn: "2026-01-01" });
  return r;
}

describe("sameCommit", () => {
  it("accepts a full commit or a prefix of at least nine characters, and nothing shorter", () => {
    assert.ok(sameCommit(A, A));
    assert.ok(sameCommit(A, A.slice(0, 9)));
    assert.ok(!sameCommit(A, A.slice(0, 8)));
    assert.ok(!sameCommit(A, B));
    assert.ok(!sameCommit(A, "not-a-commit"));
  });
});

describe("checkPins", () => {
  it("passes when every recorded commit is the manifest's (a nine-character scope input counts)", () => {
    const r = checkPins(tree("ok"));
    assert.deepEqual(r.problems, []);
    assert.equal(r.pins.length, 8);
  });
  for (const [what, o, source] of [
    ["the kit pin", { kit: B }, "vectors/tf-manifest.json (kit)"],
    ["the gap snapshot", { snap: B }, "vectors-src/gap/tf-snapshot.json"],
    ["the completion extras", { extra: B }, "vectors-src/complete/tf-extra.json"],
    ["the invalid-example snapshot", { inv: B }, "vectors-src/coverage/tf-invalid-examples.json"],
    ["the scope inputs", { scope: B.slice(0, 9) }, "vectors/complete/not-generated.json (scope input)"],
    ["the spec-hash table", { hashes: B }, "vectors-src/spec-hashes.json"],
    ["the imported fixtures", { prov: B }, "vectors/imported/PROVENANCE.json"],
  ] as const) {
    it(`fails when ${what} records another commit`, () => {
      const r = checkPins(tree(`bad-${source.replace(/\W/g, "")}`, o));
      assert.deepEqual(r.problems.map((p) => p.source), [source]);
      assert.match(formatPinReport(r), /DISAGREE/);
    });
  }
  it("fails when the imported fixtures record no commit", () => {
    const r = checkPins(tree("nocommit", { prov: null }));
    assert.deepEqual(r.problems.map((p) => [p.source, p.why]), [["vectors/imported/PROVENANCE.json", "no commit recorded"]]);
  });
  it("holds on the committed suite: the manifest, the snapshots, the scope inputs, the spec hashes and the imported fixtures agree", () => {
    const r = checkPins(ROOT);
    assert.deepEqual(r.problems, [], formatPinReport(r));
  });
});
