// SPDX-License-Identifier: Apache-2.0
// R-03: extends vectors-src/complete/scope.json with the tasks the (fixed) VTI scanner finds served through a typed dispatcher or an HTTPS route that the
// committed coverage matrix recorded as served by nothing, and records every other latest-version task VTI names or serves without a KW role (outOfScope,
// with the reason and the KW role). Idempotent. The scope rule (D742): a task is in scope when it is the latest version of a task-force task and
// VTI serves it (dispatch table, typed dispatcher, HTTPS route) or keyring-wallet has a role with code for it (emits, serves, names-only).
// A task VTI only produces and KW has no role for is not exchanged between the two: out of scope, recorded.
//   node --experimental-strip-types scripts/scope-add-served.ts <VTI source dir> <results/coverage dir> <VTI revision label>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanVti } from "../src/coverage/matrix/vti.ts";
import type { Scope, ScopeTask } from "../src/coverage/completeness.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [vtiDir, covDir, label] = process.argv.slice(2);
if (vtiDir === undefined || covDir === undefined || label === undefined) { console.error("usage: scope-add-served.ts <VTI dir> <coverage dir> <label>"); process.exit(2); }
const file = join(root, "vectors-src", "complete", "scope.json");
const scope = JSON.parse(readFileSync(file, "utf8")) as Scope;
const matrix = JSON.parse(readFileSync(join(covDir, "matrix.json"), "utf8")) as { tasks: { typeUri: string; slug: string; version: string; family: string; latest: boolean; vti: { served: string[] } }[] };
const roles = JSON.parse(readFileSync(join(covDir, "vti-roles.json"), "utf8")) as { rows: { slug: string; version: string; surfaces: Record<string, { role: string }> }[] };
const kwRows = JSON.parse(readFileSync(join(covDir, "kw-participation.json"), "utf8")) as { rows: { slug: string; version: string; role: string }[] };
const kwRole = new Map(kwRows.rows.map((r) => [`${r.slug}/${r.version}`, r.role]));
const byUri = new Map(matrix.tasks.map((t) => [t.typeUri, t]));
const inScope = new Set(scope.tasks.map((t) => t.typeUri));
const served = scanVti(vtiDir).served;

let added = 0;
for (const [uri, surfaces] of [...served].sort(([a], [b]) => a.localeCompare(b))) {
  const t = byUri.get(uri);
  if (t === undefined || !t.latest || inScope.has(uri) || t.vti.served.length > 0) continue;
  const how = uri.includes("/voting/") ? "the voting service's routing table (`const SERVED` of `uri!(..)` entries, vti-voting-service/src/dispatch.rs, read by `served()` for HTTP and messaging; S-02)" : uri.includes("/git-ns/") ? "a typed dispatcher (`AsyncDispatcher::on_async`, vtc-service/src/git_ns/tasks.rs, routed from trust_tasks/mod.rs through `git_ns::tasks::serves`)" : "an HTTPS route mounted with `tt(routes!(..), \"<uri>\")` (vtc-service/src/routes/mod.rs)";
  const e: ScopeTask = { typeUri: uri, slug: t.slug, version: t.version, family: t.family, vti: [...surfaces].sort(), kw: null, note: `${uri.includes("/voting/") ? "S-02" : "R-03"}: served by VTI through ${how}; ${uri.includes("/voting/") ? "the matrix scanner did not read the voting service's routing table" : "the matrix scanner read only dispatch tables and \\`on!\\` registrations"}, so it recorded this task as served by nothing (fixed in src/coverage/matrix/vti.ts; read at VTI ${label}). The task-force latest version equals the served version.` };
  scope.tasks.push(e);
  added++;
}
// S-02: a task already in scope that the voting service also serves names that surface (ballot/cast 0.1 had vti: [])
for (const t of scope.tasks) { const sf = served.get(t.typeUri); if (sf?.has("voting") && !t.vti.includes("voting")) t.vti = [...t.vti, "voting"].sort(); }
scope.tasks.sort((a, b) => a.typeUri.localeCompare(b.typeUri));
// a task that is now in scope is no longer recorded as out of scope
if (scope.outOfScope !== undefined) scope.outOfScope = scope.outOfScope.filter((o) => !scope.tasks.some((t) => t.slug === o.slug && o.servedVersions.includes(t.version)));

const have = new Set((scope.outOfScope ?? []).map((o) => o.slug));
const out = scope.outOfScope ?? (scope.outOfScope = []);
const sc = new Set(scope.tasks.map((t) => `${t.slug}/${t.version}`));
let recorded = 0;
for (const r of roles.rows) {
  const k = `${r.slug}/${r.version}`;
  const t = byUri.get(`https://trusttasks.org/spec/${k}`);
  if (t === undefined || !t.latest || sc.has(k) || have.has(r.slug)) continue;
  const active = Object.entries(r.surfaces).filter(([, v]) => v.role !== "not-involved" && v.role !== "not-built").map(([s, v]) => `${s} ${v.role}`);
  if (active.length === 0) continue;
  const kw = kwRole.get(k) ?? "not listed";
  const voting = r.surfaces["voting"]?.role === "serves";
  out.push({ slug: r.slug, servedVersions: [r.version], reason: voting
    ? `latest version ${r.version} is served by vti-voting-service (role scan: ${active.join(", ")}); the scope scanner does not read that service's dispatcher, so it is not added in this pass (recorded, follow-up). KW role: ${kw}.`
    : `VTI role: ${active.join(", ")}; KW role: ${kw} (no role with code). Not served by VTI at ${r.version} and not exchanged between VTI and keyring-wallet at any latest version, so out of scope under D742 (a task VTI only names or produces, with no keyring-wallet role, has no second party in the pair). If keyring-wallet adopts it, it joins the scope.` });
  recorded++;
}
// types VTI serves that the task force has no specification for at the pinned commit: the authority is the specification, so there is nothing to test against
for (const [uri, surfaces] of [...served].sort(([a], [b]) => a.localeCompare(b))) {
  if (byUri.has(uri)) continue;
  const slug = uri.replace("https://trusttasks.org/spec/", "").replace(/\/\d+\.\d+$/, "");
  if (have.has(slug) || out.some((o) => o.slug === slug)) continue;
  out.push({ slug, servedVersions: [uri.slice(uri.lastIndexOf("/") + 1)], reason: `VTI (${[...surfaces].join(", ")}) serves it, but the task-force repository has no specification for it at ${scope.inputs["task force repository (origin/main)"] ?? "the pinned commit"}; the authority is the specification, so no vector can cite one (recorded).` });
  recorded++;
}
scope.inputs["extension S-02"] = `voting service routing table (uri! entries of const SERVED), VTI ${label}: ${scope.tasks.filter((t) => t.vti.includes("voting")).length} voting tasks in the scope`;
scope.inputs["extension R-03"] ??= `typed-dispatch and tt-route scan, VTI ${label}: ${added} tasks added; ${recorded} outOfScope entries recorded (D742)`;
writeFileSync(file, JSON.stringify(scope, null, 1) + "\n");
console.log(`added ${added}, recorded ${recorded}; scope ${scope.tasks.length}`);
