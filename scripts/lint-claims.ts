// SPDX-License-Identifier: Apache-2.0
// Lists every use of a claim word (conformant, compliant, certified and their forms) outside a lint:skip block in the suite's pages,
// and exits 1 when there is one (docs/claims.md). Run by npm run check:docs and by test/claims-lint.test.ts.
// Usage: node --experimental-strip-types scripts/lint-claims.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintClaims } from "../src/glance/claims-lint.ts";

const hits = lintClaims(join(dirname(fileURLToPath(import.meta.url)), ".."));
if (hits.length > 0) {
  console.error(`claim words outside a lint:skip block (docs/claims.md; rephrase, or quote inside <!-- lint:skip --> ... <!-- /lint:skip -->):\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log("lint-claims: no claim words");
