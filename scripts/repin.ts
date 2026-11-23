// SPDX-License-Identifier: Apache-2.0
// Re-pin flagged vectors after a reviewer has re-read the changed Trust Tasks text (docs/23). Run:
//   npm run repin -- <vector id>... | --all-clear --decision still-correct|vector-changed|exception-changed [--wording-only] --reviewer "<name>" --tf <checkout> [--tf-commit <sha>] [--today YYYY-MM-DD]
// Updates the hash table (vectors-src/spec-hashes.json), clears the flags (vectors-src/spec-flags.json), appends a record per vector to
// vectors-src/spec-pin-log.json, and regenerates the vector files. `--wording-only` (no semantic change) is allowed only with `still-correct`.
// Commit the result as its own deliberate commit.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyRepin } from "../src/vectors/repin.ts";
import { loadSpecHashes, SPEC_HASHES_FILE, SUITE_ROOT } from "../src/vectors/source.ts";
import { loadPinLog, loadSpecFlags, SPEC_FLAGS_FILE, SPEC_FLAGS_FORMAT, SPEC_PIN_LOG_FILE, SPEC_PIN_LOG_FORMAT } from "../src/vectors/spec-flags.ts";
import type { Decision } from "../src/vectors/spec-flags.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";

const argv = process.argv.slice(2);
const ids: string[] = [];
let allClear = false, wordingOnly = false;
const o: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--all-clear") allClear = true;
  else if (a === "--wording-only") wordingOnly = true;
  else if (["--decision", "--reviewer", "--tf", "--tf-commit", "--today"].includes(a)) o[a] = argv[++i] ?? "";
  else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
  else ids.push(a);
}
const fail = (m: string): never => { console.error(`repin: ${m}`); return process.exit(2); };
if (allClear === (ids.length > 0)) fail("name vector ids, or --all-clear, not both and not neither");
if (o["--tf"] === undefined) fail("--tf <Trust Tasks checkout> is required: the new hashes are read from it");
const tf = o["--tf"]!;
let tfCommit = o["--tf-commit"];
if (tfCommit === undefined) { try { tfCommit = execFileSync("git", ["-C", tf, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { fail("the checkout is not a git checkout: pass --tf-commit <sha>"); } }
const table = loadSpecHashes();
if (table === null) fail("vectors-src/spec-hashes.json is missing: run scripts/backfill-spec-hashes.ts first");
try {
  const r = applyRepin({
    ids: allClear ? "all-clear" : ids, decision: (o["--decision"] ?? "") as Decision, wordingOnly, reviewer: o["--reviewer"] ?? "", today: o["--today"] ?? new Date().toISOString().slice(0, 10), tfCommit: tfCommit!,
    vectors: collectAllVectors().map((v) => ({ id: v.id, source: v.source })), flags: loadSpecFlags(), table: table!, log: loadPinLog(), hashes: (p) => hashTfPath(tf, p),
  });
  const sorted = <T>(x: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(SPEC_HASHES_FILE, JSON.stringify({ ...r.table, paths: sorted(r.table.paths) }, null, 2) + "\n");
  writeFileSync(SPEC_FLAGS_FILE, JSON.stringify({ format: SPEC_FLAGS_FORMAT, flags: sorted(r.flags) }, null, 2) + "\n");
  writeFileSync(SPEC_PIN_LOG_FILE, JSON.stringify({ format: SPEC_PIN_LOG_FORMAT, log: r.log }, null, 2) + "\n");
  for (const g of ["generate-vectors.ts", "generate-plain.ts", "generate-emit.ts", "generate-emit-more.ts", "generate-witness-vectors.ts", "generate-2l.ts", "generate-governance.ts"]) {
    const dir = { "generate-vectors.ts": "vectors", "generate-plain.ts": "vectors/plain", "generate-emit.ts": "vectors/emit", "generate-emit-more.ts": "vectors/emit-more", "generate-witness-vectors.ts": "vectors/witness", "generate-2l.ts": "vectors/2l", "generate-governance.ts": "vectors/governance" }[g]!;
    execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(SUITE_ROOT, "scripts", g), join(SUITE_ROOT, dir)], { cwd: SUITE_ROOT, stdio: "pipe" });
  }
  console.log(`repin: ${r.repinned.length} vector(s) re-pinned (${o["--decision"]}${wordingOnly ? ", wording-only" : ""}) by ${o["--reviewer"]}: ${r.repinned.join(", ")}`);
} catch (e) { fail((e as Error).message); }
