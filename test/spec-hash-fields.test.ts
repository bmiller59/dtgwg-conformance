// SPDX-License-Identifier: Apache-2.0
// The spec-hash fields on `source` (docs/23): format checks, and the rule that a vector of a coverage family in channel proposed or candidate carries them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSource, withSpecHashes } from "../src/vectors/source.ts";
import type { SpecHashesFile, VectorSource } from "../src/vectors/source.ts";
import { coverageHashErrors } from "../src/vectors/validate.ts";

const C = "0dbc98f1c059af300ff84eb1ab407edea16a16c1";
const H = `sha256:${"a".repeat(64)}`;
const base: VectorSource = { slug: "acl/grant", version: "0.3", channel: "proposed", profile: "2L", ref: "kit:specs/acl/grant/0.3", pinnedDigest: null, tfRef: { status: "draft", repoPath: "specs/acl/grant/0.3/spec.md", commit: C } };

describe("source hash fields", () => {
  it("accepts well-formed hashes and a matching tfCommit", () => {
    assert.deepEqual(validateSource({ ...base, tfCommit: C, specHash: H, schemaHash: H }, "s"), []);
  });
  it("rejects malformed values and a hash without tfCommit", () => {
    assert.match(validateSource({ ...base, tfCommit: C, specHash: "abc" }, "s").join("\n"), /specHash/);
    assert.match(validateSource({ ...base, specHash: H }, "s").join("\n"), /tfCommit: required/);
  });
  it("withSpecHashes fills from the table, with a per-path commit when one was re-pinned", () => {
    const table: SpecHashesFile = { format: "tt-spec-hashes/0.1", tfCommit: C, paths: { "specs/acl/grant/0.3/spec.md": { specHash: H, schemaHash: H } } };
    assert.equal(withSpecHashes(base, table).specHash, H);
    const d = "d".repeat(40);
    assert.equal(withSpecHashes(base, { ...table, paths: { "specs/acl/grant/0.3/spec.md": { specHash: H, tfCommit: d } } }).tfCommit, d);
    assert.equal(withSpecHashes({ ...base, tfRef: { status: "pr", pr: 1, head: "abc1234" } }, table).specHash, undefined);
    assert.equal(withSpecHashes(base, null).specHash, undefined);
  });
});

describe("coverage families require the hashes", () => {
  it("flags a proposed or candidate coverage vector without them, and only those", () => {
    assert.equal(coverageHashErrors(base, "coverage-acl", "v").length, 3);
    assert.equal(coverageHashErrors({ ...base, channel: "candidate" }, "coverage", "v").length, 3);
    assert.deepEqual(coverageHashErrors({ ...base, tfCommit: C, specHash: H, schemaHash: H }, "coverage-acl", "v"), []);
    assert.deepEqual(coverageHashErrors(base, "twol", "v"), []);
    assert.deepEqual(coverageHashErrors({ ...base, channel: "registry" }, "coverage-acl", "v"), []);
  });
  it("needs no schemaHash for a non-task document", () => {
    const framework = { ...base, tfRef: { status: "main", repoPath: "SPEC.md", commit: C }, tfCommit: C, specHash: H };
    assert.deepEqual(coverageHashErrors(framework, "coverage", "v"), []);
  });
});
