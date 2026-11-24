// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/gap/ (the gap families: task versions of vta, vtc, rooms, did-management, git-ns and messaging that no
// other vector set referenced; layer 3a, NOT core). Run:
//   node --experimental-strip-types scripts/generate-gap.ts [outDir]
// Reads the specification facts from vectors-src/gap/tf-snapshot.json (scripts/gap-snapshot.ts) and the pinned @openvtc/trust-tasks package.
// A task version is a gap task when no vector under vectors/ (other than vectors/gap itself) names its Type URI or spec path: the same rule
// the coverage matrix uses. Per gap task version: the shared mechanics vectors (payload schema, declared policy, issuedAt, a valid request
// answered) and, from the specification itself, a negative per required member, per constraint, the spec's own invalid examples and its
// own request examples (src/plain/gap-build.ts). No role, role meaning or authority rule is fixed (docs/02 section 5).
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { assignStableIds, taskKindKey } from "../src/vectors/stable-ids.ts";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVectors } from "../src/coverage/matrix/vectors.ts";
import { buildGap, buildGapEmit } from "../src/plain/gap-build.ts";
import { GAP_EMIT_GROUPS, GAP_FAMILIES, GAP_GROUPS, RESPONSE_ONLY_SLUGS, gapTasks, type GapTask } from "../src/plain/gap.ts";
import { loadSnapshot } from "../src/plain/snapshot.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";
import { applyPromotions, loadPromotions } from "../src/vectors/promotion.ts";
import { applyClarifyMeta, loadClarifyMeta, type ClarifyClass } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = process.argv[2] === undefined ? join(root, "vectors", "gap") : resolve(process.argv[2]);
const T0 = "2026-11-12T10:00:00Z";
const snap = loadSnapshot();

// the tasks other vector sets already reference (everything under vectors/ except vectors/gap)
const held = new Set<string>();
// the seeded probes (set "probe") name the tasks that seed their state (rooms/create at the version the probed task links, O-05): a seed is not coverage of that task, so it does not hold it back from the gap set
for (const v of loadVectors(root).vectors) if (v.set !== "gap" && v.set !== "probe") for (const t of v.tasks) held.add(t);
// Held back pending the owner's decision: until response entries stopped being sent as requests, these versions were named only inside such a
// payload of a coverage vector, which kept them out of this set. Whether to add gap vectors for them (new ids, not yet run by any platform) is open.
const PENDING_DECISION = ["https://trusttasks.org/spec/vtc/elections/show/0.5", "https://trusttasks.org/spec/vtc/operator/offline-write/0.2"];
for (const t of PENDING_DECISION) held.add(t);

function sourceOf(g: GapTask, id: string): { source: VectorSource; excluded?: { reason: string; note: string } } {
  const s = g.snap;
  const retired = s.status === "retired";
  const branches = s.branches ?? [];
  const o = s.origin;
  const prNumber = o === undefined ? undefined : /^pr#(\d+)$/.exec(o.label)?.[1];
  const note = [
    `Spec maturity: ${s.status} (every current specification is draft or retired; none is candidate or standard). Source: ${o === undefined ? `main at ${snap.tfCommit.slice(0, 9)}` : `${o.label} (${o.rev} at ${o.sha.slice(0, 9)}); this version is not on main, so the vector is provisional and sits in the pr channel`}.`,
    ...(branches.length === 0 ? [] : [`PROVISIONAL AGAINST BRANCHES: a copy of this version on ${branches.map((b) => `${b.name} (${b.sha.slice(0, 9)})`).join(", ")} differs from main; the vector follows main and the branch text is not vectored.`]),
  ].join(" ");
  const common = { slug: s.slug, version: s.version, ref: `kit:specs/${s.slug}/${s.version}`, pinnedDigest: s.dirDigest, specHash: s.specHash, ...(s.schemaHash === null ? {} : { schemaHash: s.schemaHash }), note };
  const source: VectorSource = o !== undefined && prNumber !== undefined
    ? { ...common, channel: "pr", pr: { number: Number(prNumber), headSha: o.sha }, tfRef: { status: "pr", pr: Number(prNumber), head: o.sha }, tfCommit: o.sha }
    : { ...common, channel: "proposed", profile: "gap-families", tfRef: { repoPath: s.tfPath, commit: snap.tfCommit, status: retired ? "retired" : "draft", ...(retired ? { supersededBy: s.supersededBy ?? "unknown" } : {}) }, tfCommit: snap.tfCommit };
  return { source, ...(retired ? { excluded: { reason: "cites a retired TF spec (front matter status retired on main)", note: `${s.slug} ${s.version} is retired (superseded by ${s.supersededBy ?? "unknown"}); excluded from every run until the vector is re-sourced to the successor.` } } : {}) };
  void id;
}

// Ids are never reused or deleted (docs/04 section 20.3): a vector keeps the id the committed file gives the vector of the same task and kind, a new
// vector takes the next number after every id its group has issued, and a committed vector no longer generated stays as a tombstone (src/vectors/stable-ids.ts).
const LEDGER = (JSON.parse(readFileSync(join(root, "vectors-src", "id-ledger.json"), "utf8")) as { ids: string[] }).ids;
const RETIRE = { reason: "no longer generated: every step it had sent a response entry (`variant: response`) of payload.invalid-examples.json as a request; a response entry is an invalid reply and is never sent as a request (src/plain/invalid-examples.ts)", since: "0.1.0-draft" };
const stable = (group: string, list: Vector[]): Vector[] => assignStableIds(list, { group, committedFile: join(root, "vectors", "gap", `${group.toLowerCase()}.json`), ledger: LEDGER, keyOf: taskKindKey, retire: RETIRE });
const files: VectorFile[] = [];
const notGenerated: Record<string, unknown>[] = [];
const covered: Record<string, number> = {};
for (const fam of GAP_FAMILIES) {
  const tasks = gapTasks([fam]).filter((g) => !held.has(g.snap.typeUri));
  covered[fam] = tasks.length;
  if (tasks.length === 0) continue;
  const vectors: Vector[] = [];
  let n = 1;
  for (const g of tasks) {
    for (const d of g.dropped) notGenerated.push({ typeUri: g.snap.typeUri, ...d, ...(d.kind === "invalid-example" || d.kind === "format-only" ? { class: "C" } : {}) });
    const responseOnly = RESPONSE_ONLY_SLUGS.includes(g.snap.slug);
    if (responseOnly) notGenerated.push({ typeUri: g.snap.typeUri, kind: "response-only-type", class: "C", note: `${g.snap.slug} ${g.snap.version} is a reply type (SPEC.md section 4.4: success, failure and continuation replies are told apart by type; section 8 for errors)`, reason: "the text defines what a consumer RETURNS with this type and says nothing about a consumer that RECEIVES it as a request, so no request-style vector (a send expecting a refusal or an answer) is written; the producer-class vector (GE) is kept, because the text does say what the document must look like" });
    const built = responseOnly ? [] : buildGap(g, snap.tfCommit);
    // class C: nothing in the text beyond the closed-payload and policy mechanics (no required member, no constraint, no example of its own)
    if (!responseOnly && !built.some((b) => /missing any one required|breaks a constraint|listed as invalid|request examples in the specification/.test(b.title))) notGenerated.push({ typeUri: g.snap.typeUri, kind: "thin-text", class: "C", note: `${g.snap.slug} ${g.snap.version}: the payload schema states no required member and no checkable constraint, and the specification carries no request or invalid example`, reason: "only the shared mechanics vectors (payload schema, declared policy, issuedAt, a valid request answered) are written; nothing more can be derived from the text without inventing behaviour" });
    for (const v of built) {
      v.id = `${GAP_GROUPS[fam]}-new-${n++}`;
      if ((v.mutants ?? []).length === 0) delete v.mutants;
      const { source, excluded } = sourceOf(g, v.id);
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) { out[k] = x; if (k === "spec") out["source"] = source; }
      if (excluded !== undefined) out["excludedFromRun"] = excluded;
      vectors.push(out as unknown as Vector);
    }
  }
  const kept = stable(GAP_GROUPS[fam]!, vectors);
  if (kept.length > 0) files.push({ format: "tt-conformance-vectors/0.1", group: GAP_GROUPS[fam]!, family: "gap", clock: { start: T0 }, vectors: kept });
  // the producer class: one emit vector per task version
  const emits: Vector[] = [];
  let m = 1;
  for (const g of tasks) {
    const v = buildGapEmit(g, snap.tfCommit);
    v.id = `${GAP_EMIT_GROUPS[fam]}-new-${m++}`;
    if ((v.mutants ?? []).length === 0) delete v.mutants;
    const { source, excluded } = sourceOf(g, v.id);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { out[k] = x; if (k === "spec") out["source"] = source; }
    if (excluded !== undefined) out["excludedFromRun"] = excluded;
    emits.push(out as unknown as Vector);
  }
  files.push({ format: "tt-conformance-vectors/0.1", group: GAP_EMIT_GROUPS[fam]!, family: "gap", clock: { start: T0 }, vectors: stable(GAP_EMIT_GROUPS[fam]!, emits) });
}
mkdirSync(outDir, { recursive: true });
// every gap CLARIFY vector is the same one rule (issuedAt is REQUIRED; the text names neither the rejection nor its code): class spec-silent, no drafted question
const meta = loadClarifyMeta(root, { coverage: false });
const gapMeta: Record<string, { class: ClarifyClass; since: string; questions: string[] }> = {};
for (const f of files) for (const v of f.vectors) if (v.clarify !== null && v.retired === undefined) gapMeta[v.id] = { class: "spec-silent", since: "2026-11-19", questions: [] };
applyClarifyMeta(files, { ...meta, vectors: { ...meta.vectors, ...gapMeta } });
applyErrorReply(files);
labelVersionRole(files);
// promoted vectors (docs/33): the tag edit only; ids, steps and expectations do not change
const promoted = applyPromotions(files, loadPromotions(root));
if (promoted.length > 0) console.log(`  ${promoted.length} vector(s) promoted to the registry channel (vectors-src/promotions.json)`);
writeFileSync(join(outDir, "clarify-classes.json"), JSON.stringify({ format: "tt-conformance-clarify-classes/0.1", note: "Written by scripts/generate-gap.ts: every gap CLARIFY vector is the same one rule (issuedAt is REQUIRED; the text names neither the rejection nor its code), class spec-silent.", entries: gapMeta }, null, 1) + "\n");
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 1) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 2) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "Items of the gap families the specification states but the generator did not turn into a vector, with the reason. An example the task's own payload schema refuses, or an invalid example the schema of its own variant accepts even with `format` asserted, is an inconsistency inside the specification (a spec question); an invalid example that is invalid only through `format` is the open question whether a consumer asserts `format` (also a spec question); a response entry (`variant: response`) is never sent as a request. None is an implementation result.", tfCommit: snap.tfCommit, items: notGenerated }, null, 2) + "\n");
console.log(`${files.reduce((a, f) => a + f.vectors.length, 0)} gap vectors for ${Object.entries(covered).map(([k, c]) => `${k} ${c}`).join(", ")} task versions; ${notGenerated.length} items not generated`);
