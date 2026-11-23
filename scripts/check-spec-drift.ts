// SPDX-License-Identifier: Apache-2.0
// Spec-drift check (docs/23). Run:
//   npm run check:spec-drift -- --tf <Trust Tasks checkout> [--old <checkout at the pinned commit>] [--flag] [--tf-commit <sha>] [--today YYYY-MM-DD]
// Re-hashes every vector that carries spec hashes against the checkout and lists the vectors whose cited text changed, was removed or renamed (with a short
// passage diff), changed schemas, new task versions with no vector, and task versions that vanished. Exits 1 when anything is flagged, and 2 when no
// vector carries hashes (it never passes silently). `--flag` writes vectors-src/spec-flags.json: the runner then records those vectors as SPEC-CHANGED.
// Hashes catch change, not correctness; this is run on demand before each measurement and is not scheduled.
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCensus } from "../src/coverage/families.ts";
import { checkSpecDrift, flagged, flagsFromReport, formatReport } from "../src/vectors/spec-drift.ts";
import { loadSpecFlags, SPEC_FLAGS_FILE, SPEC_FLAGS_FORMAT } from "../src/vectors/spec-flags.ts";
import { hashTfPath } from "../src/vectors/spec-hash.ts";
import { loadTfManifest } from "../src/vectors/tfref.ts";
import { collectAllVectors } from "../src/vectors/tfresolve.ts";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
const tf = opt("--tf");
if (tf === undefined || !existsSync(join(tf, "specs"))) { console.error("check:spec-drift: pass --tf <Trust Tasks checkout> (a directory with specs/)"); process.exit(2); }
const old = opt("--old");
const git = (dir: string, ...a: string[]): string | null => { try { return execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 }); } catch { return null; } };
const head = git(tf, "rev-parse", "HEAD")?.trim() ?? opt("--tf-commit");

const vectors = collectAllVectors().map((v) => ({ id: v.id, source: v.source }));
const report = checkSpecDrift({
  vectors, tf, manifest: loadTfManifest(), census: new Set(loadCensus().map((r) => r.type)),
  oldText: (p, commit) => (old !== undefined ? (hashTfPath(old, p) === null ? null : readFileSync(join(old, p), "utf8")) : git(tf, "show", `${commit}:${p}`)),
});
console.log(formatReport(report));
if (report.hashedVectors === 0) { console.error("check:spec-drift: no vector carries spec hashes (source.specHash): nothing was checked. Run scripts/backfill-spec-hashes.ts and regenerate."); process.exit(2); }
if (argv.includes("--flag")) {
  if (head === undefined) { console.error("--flag needs the checkout's commit: it is not a git checkout, so pass --tf-commit <sha>"); process.exit(2); }
  const today = opt("--today") ?? new Date().toISOString().slice(0, 10);
  const next = flagsFromReport(report, head, today, loadSpecFlags());
  writeFileSync(SPEC_FLAGS_FILE, JSON.stringify({ format: SPEC_FLAGS_FORMAT, flags: Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1))) }, null, 2) + "\n");
  console.log(`wrote vectors-src/spec-flags.json: ${Object.keys(next).length} flagged vector(s)`);
}
process.exit(flagged(report) ? 1 : 0);
