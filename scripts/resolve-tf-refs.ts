// SPDX-License-Identifier: Apache-2.0
// Verifies that every vector's tfRef resolves: against vectors/tf-manifest.json (always) and against a local Trust Tasks clone (when present).
// Usage: node --experimental-strip-types scripts/resolve-tf-refs.ts [--kit <clone>]   (clone: --kit, $TT_KIT, or ../dtgwg-trust-tasks-tf; see src/vectors/tfresolve.ts)
// Exit 0 = all refs resolve (a missing clone is reported as SKIPPED, not a failure); exit 1 = a ref does not resolve.
import { collectAllVectors, verifyAgainstClone, verifyAgainstManifest } from "../src/vectors/tfresolve.ts";

const args = process.argv.slice(2);
const ki = args.indexOf("--kit");
const vs = collectAllVectors();
const withRef = vs.filter((v) => v.source.tfRef !== undefined);
const bad = verifyAgainstManifest(vs);
console.log(`${vs.length} vectors, ${withRef.length} with tfRef, ${vs.length - withRef.length} candidates without; manifest check: ${bad.length === 0 ? "ok" : `${bad.length} problem(s)`}`);
const c = verifyAgainstClone(vs, ki >= 0 ? args[ki + 1] : undefined);
if ("skipped" in c) console.log(`SKIPPED: ${c.skipped}`);
else { console.log(`clone check: ${c.checked} distinct refs, ${c.problems.length === 0 ? "ok" : `${c.problems.length} problem(s)`}`); bad.push(...c.problems); }
for (const p of bad) console.error(`  ${p}`);
process.exit(bad.length === 0 ? 0 : 1);
