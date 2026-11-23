// SPDX-License-Identifier: Apache-2.0
// The spec-drift check (src/vectors/spec-drift.ts, docs/23) over a small Trust Tasks checkout built in a temporary directory.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { checkSpecDrift, flagged, flagsFromReport, formatReport } from "../src/vectors/spec-drift.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import type { VectorSource } from "../src/vectors/source.ts";

const C = "0dbc98f1c059af300ff84eb1ab407edea16a16c1";
const OLD = "# Grant\n\nThe recipient MUST reject an expired grant.\n\nSecond paragraph.\n";
const SCHEMA = '{"type":"object"}';
const put = (root: string, p: string, t: string): void => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), t); };
const fixture = (): string => {
  const root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "tt-drift-"));
  put(root, "specs/acl/grant/0.3/spec.md", OLD);
  put(root, "specs/acl/grant/0.3/payload.schema.json", SCHEMA);
  return root;
};
const mk = (tf: string): { vectors: { id: string; source: VectorSource }[]; manifest: { paths: Record<string, { status: "draft"; inKit: boolean }> } } => {
  const h = hashTfPath(tf, "specs/acl/grant/0.3/spec.md")!;
  const source: VectorSource = { slug: "acl/grant", version: "0.3", channel: "proposed", profile: "2L", ref: "kit:specs/acl/grant/0.3", pinnedDigest: null, tfRef: { status: "draft", repoPath: "specs/acl/grant/0.3/spec.md", commit: C }, tfCommit: C, specHash: h.specHash, schemaHash: h.schemaHash! };
  return { vectors: [{ id: "A-001", source }, { id: "A-002", source }], manifest: { paths: { "specs/acl/grant/0.3/spec.md": { status: "draft", inKit: true } } } };
};
const run = (tf: string, m = mk(tf)) => checkSpecDrift({ ...m, tf, census: new Set(["acl/grant/0.3"]), oldText: () => OLD });

describe("check:spec-drift", () => {
  it("flags nothing for an unchanged or markup-only-changed checkout", () => {
    const tf = fixture();
    const m = mk(tf);
    put(tf, "specs/acl/grant/0.3/spec.md", "## Grant\n\nThe recipient **MUST**   reject an\nexpired grant.\n\nSecond paragraph.\n");
    const r = run(tf, m);
    assert.equal(flagged(r), false);
    assert.equal(r.hashedVectors, 2);
    rmSync(tf, { recursive: true });
  });
  it("flags a changed word with a passage diff, and every vector citing the file", () => {
    const tf = fixture();
    const m = mk(tf);
    put(tf, "specs/acl/grant/0.3/spec.md", OLD.replace("reject", "ignore"));
    const r = run(tf, m);
    assert.equal(r.findings.length, 1);
    const f = r.findings[0]!;
    assert.equal(f.kind, "changed");
    assert.deepEqual(f.vectors, ["A-001", "A-002"]);
    assert.ok(f.diff.some((d) => d.startsWith("- ") && d.includes("reject")) && f.diff.some((d) => d.startsWith("+ ") && d.includes("ignore")));
    assert.match(formatReport(r), /CHANGED specs\/acl\/grant\/0.3\/spec.md/);
    const flags = flagsFromReport(r, C, "2026-11-18");
    assert.deepEqual(Object.keys(flags), ["A-001", "A-002"]);
    assert.equal(flags["A-001"]!.what, "spec");
    rmSync(tf, { recursive: true });
  });
  it("checks each vector's own hash: a vector with a stale hash is flagged although another vector citing the same file carries the current one (F-13)", () => {
    const tf = fixture();
    const m = mk(tf);
    const cur = hashTfPath(tf, "specs/acl/grant/0.3/spec.md")!;
    const stale = { ...m.vectors[0]!.source, specHash: "sha256:" + "0".repeat(64) } as VectorSource;
    const current = { ...m.vectors[0]!.source, specHash: cur.specHash } as VectorSource;
    const r = run(tf, { ...m, vectors: [{ id: "S-1", source: current }, { id: "S-2", source: stale }, { id: "S-3", source: current }] });
    assert.equal(r.findings.length, 1);
    assert.deepEqual(r.findings[0]!.vectors, ["S-2"]);
    assert.equal(r.paths, 1);
    rmSync(tf, { recursive: true });
  });
  it("flags a changed schema even when the text is the same", () => {
    const tf = fixture();
    const m = mk(tf);
    put(tf, "specs/acl/grant/0.3/payload.schema.json", '{"type":"array"}');
    const r = run(tf, m);
    assert.deepEqual(r.findings.map((f) => f.kind), ["schema-changed"]);
    rmSync(tf, { recursive: true });
  });
  it("reports a removed file, and a renamed one where the same text is at a new path", () => {
    const tf = fixture();
    const m = mk(tf);
    renameSync(join(tf, "specs/acl/grant/0.3"), join(tf, "specs/acl/grant/0.4"));
    const r = run(tf, m);
    assert.equal(r.findings[0]!.kind, "renamed");
    assert.equal(r.findings[0]!.renamedTo, "specs/acl/grant/0.4/spec.md");
    assert.deepEqual(r.vanished, []); // a rename is not also a vanish
    assert.deepEqual(r.newVersions, []); // the rename target is not a new version
    rmSync(tf, { recursive: true });
    const tf2 = fixture();
    const m2 = mk(tf2);
    rmSync(join(tf2, "specs/acl/grant/0.3"), { recursive: true });
    mkdirSync(join(tf2, "specs/acl"), { recursive: true });
    const r2 = run(tf2, m2);
    assert.equal(r2.findings[0]!.kind, "removed");
    assert.deepEqual(r2.vanished, ["specs/acl/grant/0.3/spec.md"]);
    rmSync(tf2, { recursive: true });
  });
  it("reports a new task version with no vector, but not one a census row names", () => {
    const tf = fixture();
    const m = mk(tf);
    put(tf, "specs/acl/grant/0.4/spec.md", "# new\n");
    put(tf, "specs/acl/list/0.1/spec.md", "# other\n");
    const r = checkSpecDrift({ ...m, tf, census: new Set(["acl/grant/0.3", "acl/list/0.1"]) });
    assert.deepEqual(r.newVersions, ["specs/acl/grant/0.4/spec.md"]);
    assert.equal(flagged(r), true);
    rmSync(tf, { recursive: true });
  });
  it("counts no hashed vectors when none carry hashes (the command then says so and exits 2)", () => {
    const tf = fixture();
    const m = mk(tf);
    const bare = m.vectors.map((v) => { const { specHash: _a, schemaHash: _b, tfCommit: _c, ...rest } = v.source; return { id: v.id, source: rest as VectorSource }; });
    assert.equal(checkSpecDrift({ ...m, vectors: bare, tf, census: new Set() }).hashedVectors, 0);
    rmSync(tf, { recursive: true });
  });
});
