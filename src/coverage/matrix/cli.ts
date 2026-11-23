// SPDX-License-Identifier: Apache-2.0
// Usage: node src/coverage/matrix/cli.ts --tasks-tf <clone> [--kw <checkout>] [--vti <checkout>] [--vti-rev <sha>] [--vti-role-rules results/coverage/vti-role-rules.json] [--base origin/main] [--out results/coverage] [--runs <run records folder>]... [--run-map results/platform-run-map.json] [--role-rules results/coverage/kw-role-rules.json] [--no-gh]
// --runs may be given several times (each a results directory or a folder of run folders); run folders are assigned to platforms by the run map only.
// Read-only against every source: git (fetch is done separately by the project owner) and `gh pr list/view`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAll } from "./build.ts";
import { renderParticipation } from "./participation.ts";
import { renderVtiParticipation } from "./vti-participation.ts";
import { loadVtiRoleRules, scanVtiRoles } from "./vti-roles.ts";
import type { RoleRules } from "./roles.ts";
import { loadRunMap } from "./runmap.ts";
import { git } from "./git.ts";
import { scanKw } from "./kw.ts";
import { renderReadme } from "./render.ts";
import { gather } from "./sources.ts";
import { loadVectors } from "./vectors.ts";
import { scanVti } from "./vti.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const args = (name: string): string[] => process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1] as string] : []));

const tf = arg("tasks-tf");
if (!tf) {
  console.error("--tasks-tf <clone of trustoverip/dtgwg-trust-tasks-tf> is required");
  process.exit(2);
}
const suiteRoot = resolve(arg("suite") ?? ".");
const base = arg("base") ?? "origin/main";
const out = resolve(suiteRoot, arg("out") ?? "results/coverage");
const kwRoot = arg("kw") ? resolve(arg("kw") as string) : null;
const vtiRoot = arg("vti") ? resolve(arg("vti") as string) : null;
// A read-only archive has no git history, so --vti-rev names its commit; without it the checkout's own HEAD is read.
const head = (r: string | null, rev = "HEAD"): string => { try { return r ? git(r, ["rev-parse", "--short", rev]).trim() : "not read"; } catch { return "unknown"; } };

const gathered = gather({ repo: resolve(tf), ghRepo: "trustoverip/dtgwg-trust-tasks-tf", baseRev: base, prs: process.argv.includes("--no-gh") ? [] : undefined });
const lv = loadVectors(suiteRoot);
const runsDirs = args("runs").map((r) => resolve(r));
const runMapPath = resolve(suiteRoot, arg("run-map") ?? "results/platform-run-map.json");
const rulesPath = resolve(suiteRoot, arg("role-rules") ?? "results/coverage/kw-role-rules.json");
const vtiRulesPath = resolve(suiteRoot, arg("vti-role-rules") ?? "results/coverage/vti-role-rules.json");
const vtiRules = vtiRoot ? loadVtiRoleRules(vtiRulesPath) : null;
const { matrix, roles, participation, vtiRoles, vtiParticipation } = buildAll({
  vtiRoleRules: vtiRules, vtiRoleUsage: vtiRoot && vtiRules ? scanVtiRoles(vtiRoot, vtiRules) : null,
  gathered, kw: kwRoot ? scanKw(kwRoot) : null, vti: vtiRoot ? scanVti(vtiRoot) : null, vectors: lv.vectors, scenarios: lv.scenarios, runsDirs, runMap: runsDirs.length > 0 ? loadRunMap(runMapPath) : null, roleRules: kwRoot ? (JSON.parse(readFileSync(rulesPath, "utf8")) as RoleRules) : null,
  suiteRoot, kwRoot, vtiRoot,
  inputs: {
    "task force repository (origin/main)": head(resolve(tf), base),
    "keyring-wallet": head(kwRoot),
    ["verifiable-trust-infrastructure (upstream main)"]: arg("vti-rev") ?? head(vtiRoot),
  },
  generated: new Date().toISOString().slice(0, 10),
});
for (const n of gathered.notes) matrix.limits.push(n);
matrix.limits.push(
  `Open PRs read: ${gathered.prs.map((p) => `#${p.number}${p.draft ? " (draft)" : ""} ${p.specs} spec file(s)`).join("; ") || "none that touch specs or ceremonies"}. Branches with spec changes: ${gathered.branches.map((b) => `${b.name} (${b.specs})`).join("; ") || "none"}.`,
);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "matrix.json"), JSON.stringify(matrix, null, 2) + "\n");
writeFileSync(join(out, "README.md"), renderReadme(matrix));
if (roles.length > 0) {
  const kwInputs = { "keyring-wallet": matrix.inputs["keyring-wallet"] as string, "task force repository (origin/main)": matrix.inputs["task force repository (origin/main)"] as string };
  const runInfo = Object.fromEntries(matrix.platforms.filter((p) => p.id.startsWith("keyring-wallet")).map((p) => [p.label, p.note.split("; ").pop() as string]));
  writeFileSync(join(out, "kw-roles.json"), JSON.stringify({ format: "tt-kw-roles/0.1", generated: matrix.generated, inputs: kwInputs, about: "The keyring-wallet's role per focus slug with the evidence (decision D301). Derived by `npm run coverage-matrix` from the wallet source (comments stripped) and results/coverage/kw-role-rules.json; a rule-based role is judgement and carries its reason.", rows: roles }, null, 1) + "\n");
  writeFileSync(join(out, "kw-participation.json"), JSON.stringify({ format: "tt-kw-participation/0.1", generated: matrix.generated, inputs: kwInputs, rows: participation }, null, 1) + "\n");
  writeFileSync(join(out, "kw-participation.md"), renderParticipation(participation, { inputs: kwInputs, generated: matrix.generated, runInfo }));
}
if (vtiRoles.length > 0 && vtiRules) {
  const vtiInputs = { "task force repository (origin/main)": matrix.inputs["task force repository (origin/main)"] as string, "verifiable-trust-infrastructure (upstream main)": arg("vti-rev") ?? head(vtiRoot) };
  const runInfo = Object.fromEntries(matrix.platforms.filter((p) => p.id.startsWith("vti")).map((p) => [p.label, /\d+ run folders read/.exec(p.note)?.[0] ?? p.note]));
  /** One row per line: the data files stay diffable and about a third of the size of an indented dump. */
  const lines = (head: Record<string, unknown>, rows: unknown[]): string => `${JSON.stringify(head).slice(0, -1)},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
  const surfaces = vtiRules.surfaces.map((x) => x.id);
  const strip = (rows: typeof vtiRoles) => rows.map((r) => ({ slug: r.slug, version: r.version, family: r.family, surfaces: r.surfaces }));
  const about = "VTI's role per focus slug and surface with the evidence (decision D420). Derived by `npm run coverage-matrix` from the VTI source (comments stripped, tests removed, constants and module aliases resolved) and results/coverage/vti-role-rules.json; a rule-based role is judgement and carries its reason.";
  writeFileSync(join(out, "vti-roles.json"), lines({ format: "tt-vti-roles/0.1", generated: matrix.generated, inputs: vtiInputs, about, surfaces: vtiRules.surfaces.map((x) => ({ id: x.id, label: x.label, kind: x.kind, crates: x.crates })) }, strip(vtiRoles)));
  writeFileSync(join(out, "vti-participation.json"), lines({ format: "tt-vti-participation/0.1", generated: matrix.generated, inputs: vtiInputs }, vtiParticipation));
  writeFileSync(join(out, "vti-participation.md"), renderVtiParticipation(vtiParticipation, vtiRules, { inputs: vtiInputs, generated: matrix.generated, runInfo }));
}
console.log(`tasks ${matrix.tasks.length} (slugs ${new Set(matrix.tasks.map((t) => t.slug)).size}), vectors ${matrix.vectors.length}, ceremonies ${matrix.ceremonies.length}`);
