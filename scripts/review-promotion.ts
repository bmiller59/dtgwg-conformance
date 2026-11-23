// SPDX-License-Identifier: Apache-2.0
// Mechanical checks of the promotion review (docs/33 section 3, src/promotion/review.ts). Read-only.
// Usage: node --experimental-strip-types scripts/review-promotion.ts --ids <ids.json> --kit <trust-tasks clone> --out <file.json> [--vectors vectors]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewVector, type Git, type ReviewVector } from "../src/promotion/review.ts";
import { readdirSync, statSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const a = process.argv.slice(2);
const arg = (f: string): string | undefined => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
const ids = JSON.parse(readFileSync(resolve(arg("--ids") ?? ""), "utf8")) as string[];
const kit = resolve(arg("--kit") ?? "");
const out = arg("--out") ?? "";
const git: Git = (commit, path) => { try { return execFileSync("git", ["-C", kit, "show", `${commit}:${path}`], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const all = new Map<string, ReviewVector>();
const walk = (d: string): void => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".json") && !/manifest|pins|not-generated|clarify/.test(n)) { try { const j = JSON.parse(readFileSync(p, "utf8")) as { vectors?: { id: string; title: string; spec: string[]; source: { tfRef?: ReviewVector["tfRef"] } }[] }; for (const v of j.vectors ?? []) if (v.source?.tfRef) all.set(v.id, { id: v.id, title: v.title, spec: v.spec, tfRef: v.source.tfRef }); } catch { /* not a vector file */ } } } };
walk(resolve(arg("--vectors") ?? join(root, "vectors")));
const rows = ids.map((id) => { const v = all.get(id); return v === undefined ? { id, problems: ["not found or no tfRef"], manual: [], thin: true } : reviewVector(v, git); });
const summary = { checked: rows.length, withProblems: rows.filter((r) => r.problems.length > 0).length, thin: rows.filter((r) => r.thin).length, manual: rows.filter((r) => r.manual.length > 0).length };
writeFileSync(out, JSON.stringify({ format: "tt-conformance-review-checks/0.1", kit, summary, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary));
