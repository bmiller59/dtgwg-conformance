// SPDX-License-Identifier: Apache-2.0
// R4: the suite's pages make no conformance claims (docs/claims.md).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claimsLintFiles, claimsLintRunFiles, claimWordsIn, lintClaims } from "../src/glance/claims-lint.ts";
import { NEEDS_RUNS, RESULTS, ROOT } from "./helpers.ts";

describe("claims lint", () => {
  it("bites on each word and its forms, any case, whole words only", () => {
    for (const w of ["conformant", "Non-conformant", "nonconformant", "COMPLIANT", "non-compliant", "compliantly", "compliance", "certified", "certify", "certifies", "certification"]) {
      assert.deepEqual(claimWordsIn(`the platform is ${w} here`).map((h) => h.word), [w], w);
    }
    for (const ok of ["conformance suite", "a certificate chain", "dtgwg-conformance", "conformantx", "uncertified-ish"]) assert.deepEqual(claimWordsIn(ok), [], ok);
  });
  it("skips lint:skip blocks and reports the line", () => {
    assert.deepEqual(claimWordsIn("a\n<!-- lint:skip -->\ncertified\n<!-- /lint:skip -->\nb conformant"), [{ line: 5, word: "conformant" }]);
  });
  it("covers README, platforms.md, the results pages that are tracked and docs", () => {
    const fs = claimsLintFiles(ROOT);
    for (const f of ["README.md", "platforms.md", "results/vector-review.md", "docs/claims.md", "docs/README.md"]) assert.ok(fs.includes(f), f);
  });
  it("covers the run folders' pages in the results directory", NEEDS_RUNS, () => {
    assert.ok(claimsLintRunFiles(RESULTS).some((f) => /^runs\/[^/]+\/README\.md$/.test(f)));
  });
  it("finds no claim word in any page in scope", () => {
    assert.deepEqual(lintClaims(ROOT, RESULTS), []);
  });
});
