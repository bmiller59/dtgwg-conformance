// SPDX-License-Identifier: Apache-2.0
// Hashes against a Trust Tasks checkout (docs/23): when TT_KIT names a checkout at the pinned commit, every spec hash and schema hash a vector carries must
// equal the hash of the checkout's text. A mismatch fails this suite. Without TT_KIT the test is skipped, with a message saying so (never a silent pass).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { loadSpecFlags } from "../src/vectors/spec-flags.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";

const kit = process.env["TT_KIT"];
const skip = kit === undefined || kit === "" || !existsSync(kit) ? "TT_KIT is not set to a Trust Tasks checkout at the pinned commit: spec hashes were NOT re-checked (set TT_KIT=<checkout> to run this test)" : false;

describe("spec hashes against the pinned Trust Tasks commit", { skip }, () => {
  it("every vector's specHash and schemaHash equals the hash of the checkout's text", () => {
    const flags = loadSpecFlags();
    const cache = new Map<string, ReturnType<typeof hashTfPath>>();
    const bad: string[] = [];
    let checked = 0;
    for (const v of collectAllVectors()) {
      const s = v.source;
      if (s.specHash === undefined || s.tfRef?.repoPath === undefined) continue;
      // a vector excluded from every run is never measured, so a changed text cannot make a result wrong; the three on webvh/dids/list 1.0 are excluded since D901
      if (v.excludedFromRun !== undefined) continue;
      checked++;
      if (!cache.has(s.tfRef.repoPath)) cache.set(s.tfRef.repoPath, hashTfPath(kit!, s.tfRef.repoPath));
      const now = cache.get(s.tfRef.repoPath)!;
      const why = now === null ? "file absent" : now.specHash !== s.specHash ? "specHash differs" : s.schemaHash !== undefined && now.schemaHash !== s.schemaHash ? "schemaHash differs" : null;
      if (why !== null) bad.push(`${v.id} (${s.tfRef.repoPath}): ${why}${flags[v.id] === undefined ? "" : " [flagged SPEC-CHANGED]"}`);
    }
    assert.ok(checked > 0, "no vector carries spec hashes: nothing was checked");
    assert.deepEqual(bad, [], `${bad.length} vector(s) do not match the checkout. If TT_KIT is not at the pinned commit use one that is; if it is, the cited text changed: run npm run check:spec-drift -- --tf <checkout>`);
  });
});
