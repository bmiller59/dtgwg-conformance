// SPDX-License-Identifier: Apache-2.0
// Writes vectors-src/spec-hashes.json: the spec hash and schema hash of every Trust Tasks file the vectors cite (docs/23), read from a checkout at the pinned
// commit. Run:
//   npm run backfill-spec-hashes -- --tf <Trust Tasks checkout at the pinned commit> [--tf-commit <sha>]
// The generators then stamp `source.tfCommit`, `source.specHash` and `source.schemaHash` from this table (src/vectors/source.ts withSource), so regeneration
// stays offline and deterministic. This script regenerates the vector files after writing the table. A checkout that is a git checkout must be at the
// manifest's main commit; a plain copy is trusted on --tf-commit (default: the manifest's main commit).
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPEC_HASHES_FILE, SUITE_ROOT } from "../src/vectors/source.ts";
import type { SpecHashesFile } from "../src/vectors/source.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import { loadTfManifest } from "../src/vectors/tfref.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
const tf = opt("--tf");
if (tf === undefined || !existsSync(join(tf, "specs"))) { console.error("backfill-spec-hashes: pass --tf <Trust Tasks checkout at the pinned commit>"); process.exit(2); }
const pinned = loadTfManifest().main.commit;
let head: string | undefined;
try { head = execFileSync("git", ["-C", tf, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* a plain copy */ }
if (head !== undefined && head !== pinned) { console.error(`backfill-spec-hashes: the checkout is at ${head.slice(0, 9)}, not the pinned ${pinned.slice(0, 9)}; check out the pinned commit (re-pinning to a newer commit is scripts/repin.ts)`); process.exit(2); }
const tfCommit = opt("--tf-commit") ?? pinned;
const paths: SpecHashesFile["paths"] = {};
const missing: string[] = [];
for (const v of collectAllVectors()) {
  const t = v.source.tfRef;
  if (t === undefined || t.status === "pr" || t.repoPath === undefined || t.repoPath in paths) continue;
  const h = hashTfPath(tf, t.repoPath);
  if (h === null) { missing.push(t.repoPath); continue; }
  paths[t.repoPath] = { specHash: h.specHash, ...(h.schemaHash === undefined ? {} : { schemaHash: h.schemaHash }) };
}
if (missing.length > 0) console.warn(`not in the checkout, left without hashes: ${[...new Set(missing)].join(", ")}`);
const table: SpecHashesFile = { format: "tt-spec-hashes/0.1", tfCommit, paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : 1))) };
writeFileSync(SPEC_HASHES_FILE, JSON.stringify(table, null, 2) + "\n");
const GEN: [string, string][] = [["generate-vectors.ts", "vectors"], ["generate-plain.ts", "vectors/plain"], ["generate-emit.ts", "vectors/emit"], ["generate-emit-more.ts", "vectors/emit-more"], ["generate-witness-vectors.ts", "vectors/witness"], ["generate-2l.ts", "vectors/2l"], ["generate-governance.ts", "vectors/governance"]];
for (const [g, dir] of GEN) execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(SUITE_ROOT, "scripts", g), join(SUITE_ROOT, dir)], { cwd: SUITE_ROOT, stdio: "pipe" });
console.log(`backfill-spec-hashes: ${Object.keys(paths).length} file(s) hashed at ${tfCommit.slice(0, 9)}; vectors regenerated`);
