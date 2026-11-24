// SPDX-License-Identifier: Apache-2.0
// The alignment analysis: what the Trust Tasks checkout holds that can be tested, what the suite uses of it, and where the suite's record of it
// has gone stale. Pure over a TfSource and a suite directory; deterministic (no clock, no random, sorted output); read-only.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { variantOf, type Variant } from "../plain/invalid-examples.ts";
import { formatOk } from "../plain/schema.ts";
import { hashTfPath } from "../vectors/spec-hash.ts";
import { git, gitOk, type TfSource } from "./source.ts";
import { loadPins, loadSuiteFacts, TYPE_BASE, type DocUse, type J, type SuiteFacts } from "./suite.ts";

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
export const STATUS_LINE = "Draft proposal for discussion and review by the DTGWG. Every specification measured here is a draft; this report says nothing about adoption or endorsement.";

export const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** A vector payload matches an example when they are equal, except that a vector string beginning with `$` (a suite token: minted id, actor,
 * clock) stands for a value of its own kind: a clock token (`$now...`) matches only an RFC 3339 date-time string, any other token only a string. */
export function payloadMatches(vec: unknown, ex: unknown): boolean {
  if (typeof vec === "string" && vec.startsWith("$")) return typeof ex === "string" && (!vec.startsWith("$now") || formatOk("date-time", ex));
  if (Array.isArray(vec)) return Array.isArray(ex) && vec.length === ex.length && vec.every((v, i) => payloadMatches(v, ex[i]));
  if (isObj(vec)) {
    if (!isObj(ex)) return false;
    const a = Object.keys(vec).sort(), b = Object.keys(ex).sort();
    return a.length === b.length && a.every((k, i) => k === b[i] && payloadMatches(vec[k], ex[k]));
  }
  return vec === ex;
}

export interface TaskInfo { typeUri: string; slug: string; version: string; path: string; status: string; invalidExamples: number; embeddedRequestExamples: number; embeddedResponseExamples: number }
/** `variant` is the entry's own marker (an invalid example marked `"variant": "response"` is an invalid reply); a request example is always "request". */
export interface Example { typeUri: string; index: number; note: string | null; payload: unknown; variant: Variant }

function frontStatus(text: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  const m = /^status:\s*(\S+)/m.exec(fm?.[1] ?? "");
  return m?.[1]?.replace(/^["']|["']$/g, "") ?? "unknown";
}

/** Fenced json blocks of a spec.md that are Trust Task documents: split into request and response examples. */
export function embeddedExamples(md: string): { request: J[]; response: J[] } {
  const out = { request: [] as J[], response: [] as J[] };
  for (const m of md.matchAll(/```json\s*\n([\s\S]*?)\n\s*```/g)) {
    let v: unknown;
    try { v = JSON.parse(m[1]!); } catch { continue; }
    if (!isObj(v) || typeof v["type"] !== "string" || !v["type"].startsWith(TYPE_BASE) || !("payload" in v)) continue;
    (v["type"].includes("#response") ? out.response : out.request).push(v);
  }
  return out;
}

export interface Loaded { tasks: TaskInfo[]; invalid: Example[]; request: Example[]; invalidFiles: number }

export function loadTasks(tf: TfSource): Loaded {
  const tasks: TaskInfo[] = [], invalid: Example[] = [], request: Example[] = [];
  let invalidFiles = 0;
  for (const f of tf.files) {
    const m = /^specs\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+)\/(\d+\.\d+)\/spec\.md$/.exec(f);
    if (m === null || m[1]!.split("/").some((s) => s.startsWith("_"))) continue;
    const typeUri = `${TYPE_BASE}${m[1]}/${m[2]}`;
    const dir = `specs/${m[1]}/${m[2]}`;
    const md = readFileSync(join(tf.root, f), "utf8");
    const emb = embeddedExamples(md);
    emb.request.forEach((d, i) => request.push({ typeUri, index: i, note: null, payload: d["payload"], variant: "request" }));
    let ninv = 0;
    const invFile = join(tf.root, dir, "payload.invalid-examples.json");
    if (existsSync(invFile)) {
      invalidFiles++;
      const arr = JSON.parse(readFileSync(invFile, "utf8")) as unknown;
      if (Array.isArray(arr)) arr.forEach((e, i) => { ninv++; invalid.push({ typeUri, index: i, note: isObj(e) && typeof e["note"] === "string" ? e["note"] : null, payload: isObj(e) ? e["payload"] : undefined, variant: variantOf(isObj(e) ? e : {}) }); });
    }
    tasks.push({ typeUri, slug: m[1]!, version: m[2]!, path: f, status: frontStatus(md), invalidExamples: ninv, embeddedRequestExamples: emb.request.length, embeddedResponseExamples: emb.response.length });
  }
  tasks.sort((a, b) => a.typeUri.localeCompare(b.typeUri));
  return { tasks, invalid, request, invalidFiles };
}

type Bucket = "exact" | "namedOnly" | "notMatched";
const REASONS = ["taskRetired", "taskNotInSuite", "taskInSuiteNoVectorFromExamples", "taskVectorFromExamplesButThisOneNotMatched"] as const;
export type Reason = (typeof REASONS)[number];

export interface ExampleMapping { total: number; exact: number; /** of the exact matches, those sent in a step that expects a refusal (an error or any-refusal outcome; a ceremony scenario, which has no such step, is judged by its whole text) */ exactExpectingRefusal: number; namedOnly: number; notMatched: number; reasons: Record<Reason, number>; unmappedSample: { typeUri: string; index: number; reason: Reason }[];
  /** entries by variant; `exact` counts an entry only when a document of ITS variant carries it (a response entry is never counted as used by a request send) */
  requestEntries: number; responseEntries: number; exactRequestEntries: number; exactResponseEntries: number;
  /** response entries whose payload equals a REQUEST some vector sends for the task (no generator sends a response entry as a request; what remains is a
   * coincidence of payload, mostly an empty `{}` that is also a request negative): never counted in `exact` */
  responseEntriesSentAsRequests: number }

export function mapExamples(examples: Example[], docs: DocUse[], taskByType: Map<string, TaskInfo>, facts: SuiteFacts, kind: "invalid" | "request", receiptFile?: string): { mapping: ExampleMapping; unmapped: { typeUri: string; index: number; reason: Reason; note: string | null }[] } {
  const byType = new Map<string, DocUse[]>();
  for (const d of docs) { const l = byType.get(d.typeUri) ?? []; l.push(d); byType.set(d.typeUri, l); }
  const textByVec = new Map(facts.vectors.map((v) => [v.id, v.text]));
  const reasons = Object.fromEntries(REASONS.map((r) => [r, 0])) as Record<Reason, number>;
  let exact = 0, named = 0, refusing = 0, exactReq = 0, exactResp = 0, respAsReq = 0;
  const vectorRefuses = (id: string): boolean => /"disposition":"(error|any-refusal)"/.test(textByVec.get(id) ?? "");
  const refuses = (d: DocUse): boolean => (d.refusing === null ? vectorRefuses(d.vectorId) : d.refusing);
  const unmapped: { typeUri: string; index: number; reason: Reason; note: string | null }[] = [];
  for (const e of examples) {
    const here = byType.get(e.typeUri) ?? [];
    let bucket: Bucket = "notMatched";
    const hit = here.filter((d) => d.variant === e.variant && payloadMatches(d.payload, e.payload));
    if (e.variant === "response" && here.some((d) => d.variant === "request" && payloadMatches(d.payload, e.payload))) respAsReq++;
    if (hit.length > 0) { bucket = "exact"; if (hit.some(refuses)) refusing++; }
    else if (kind === "invalid" && receiptFile !== undefined && e.typeUri.endsWith("/trust-ceremony-receipt/0.1") && facts.payloadFrom.get(receiptFile)?.has(e.index)) bucket = "exact";
    else if (kind === "invalid" && here.some((d) => /invalid-examples|invalid payload example/.test(textByVec.get(d.vectorId) ?? ""))) bucket = "namedOnly";
    if (bucket === "exact") { exact++; if (e.variant === "response") exactResp++; else exactReq++; continue; }
    if (bucket === "namedOnly") named++;
    const t = taskByType.get(e.typeUri);
    const reason: Reason = t?.status === "retired" ? "taskRetired" : !facts.mentioned.has(e.typeUri) && here.length === 0 ? "taskNotInSuite" : bucket === "namedOnly" ? "taskVectorFromExamplesButThisOneNotMatched" : "taskInSuiteNoVectorFromExamples";
    reasons[reason]++;
    unmapped.push({ typeUri: e.typeUri, index: e.index, reason, note: e.note });
  }
  return { mapping: { total: examples.length, exact, exactExpectingRefusal: refusing, namedOnly: named, notMatched: examples.length - exact - named, reasons, unmappedSample: unmapped.slice(0, 10).map(({ typeUri, index, reason }) => ({ typeUri, index, reason })),
    requestEntries: examples.filter((e) => e.variant === "request").length, responseEntries: examples.filter((e) => e.variant === "response").length, exactRequestEntries: exactReq, exactResponseEntries: exactResp, responseEntriesSentAsRequests: respAsReq }, unmapped };
}

export interface Options { suiteRoot: string; /** Name recorded for the checkout (never a path). */ label?: string }

export function analyse(tf: TfSource, opts: Options): Record<string, unknown> {
  const suite = loadSuiteFacts(opts.suiteRoot);
  const loaded = loadTasks(tf);
  const taskByType = new Map(loaded.tasks.map((t) => [t.typeUri, t]));
  const tfHas = (p: string): boolean => existsSync(join(tf.root, p));

  // ---- snapshot and staleness
  const pins = loadPins(opts.suiteRoot).map((p) => {
    const base: Record<string, unknown> = { source: p.source, commit: p.commit, ...(p.note === undefined ? {} : { note: p.note }) };
    if (p.commit !== null && tf.git !== null && tf.gitDir !== null) {
      const gd = tf.gitDir;
      const known = gitOk(gd, "cat-file", "-e", `${p.commit}^{commit}`);
      base["knownToCheckout"] = known;
      if (known) {
        const full = git(gd, "rev-parse", `${p.commit}^{commit}`).trim();
        base["date"] = git(gd, "show", "-s", "--format=%cs", full).trim();
        base["ancestorOfRead"] = gitOk(gd, "merge-base", "--is-ancestor", full, tf.git.commit);
        base["commitsInReadNotInPin"] = Number(git(gd, "rev-list", "--count", `${full}..${tf.git.commit}`).trim());
        base["commitsInPinNotInRead"] = Number(git(gd, "rev-list", "--count", `${tf.git.commit}..${full}`).trim());
      }
    }
    return base;
  });
  const manifest = existsSync(join(opts.suiteRoot, "vectors/tf-manifest.json")) ? (JSON.parse(readFileSync(join(opts.suiteRoot, "vectors/tf-manifest.json"), "utf8")) as { paths: Record<string, { status: string }> }) : { paths: {} };
  const mTasks = new Set(Object.keys(manifest.paths).filter((p) => /^specs\/.+\/\d+\.\d+\/spec\.md$/.test(p) && !p.split("/").some((s) => s.startsWith("_"))));
  const nowTasks = new Set(loaded.tasks.map((t) => t.path));
  const newerTasks = [...nowTasks].filter((p) => !mTasks.has(p)).sort();
  const vanishedTasks = [...mTasks].filter((p) => !nowTasks.has(p)).sort();
  const retiredNow = loaded.tasks.filter((t) => t.status === "retired" && manifest.paths[t.path]?.status !== "retired").map((t) => t.path);

  // ---- inventory of the checkout
  const fixtureFiles = tf.files.filter((p) => /^fixtures\/[^/]+\/[^/]+\.json$/.test(p) && !p.endsWith("/manifest.json")).sort();
  const ceremonyDefs = tf.files.filter((p) => /^ceremonies\/.+\/ceremony\.json$/.test(p)).sort();
  const ceremonyInvalid = tf.files.includes("ceremonies/ceremony.invalid-examples.json") ? (() => { const j = JSON.parse(readFileSync(join(tf.root, "ceremonies/ceremony.invalid-examples.json"), "utf8")) as J; return Array.isArray(j["cases"]) ? j["cases"].length : 0; })() : 0;
  const libs: Record<string, Record<string, number>> = { rust: {}, typescript: {}, go: {}, dart: {} };
  for (const f of tf.files) {
    const top = f.split("/")[0]!;
    if (!top.startsWith("trust-tasks")) continue;
    const lang = /\.rs$/.test(f) && /\/tests\//.test(f) ? "rust" : /\.(test|spec)\.ts$/.test(f) ? "typescript" : /_test\.go$/.test(f) ? "go" : /_test\.dart$/.test(f) ? "dart" : null;
    if (lang !== null) libs[lang]![top] = (libs[lang]![top] ?? 0) + 1;
  }
  const libTotals = Object.fromEntries(Object.entries(libs).map(([k, v]) => [k, { packages: Object.keys(v).length, testFiles: Object.values(v).reduce((a, b) => a + b, 0) }]));

  // ---- mapping: examples
  const inv = mapExamples(loaded.invalid, suite.docs, taskByType, suite, "invalid", "receipt/payload.invalid-examples.json");
  // the advisory alignment set (vectors/alignment, docs/tf-alignment.md) is kept out of the first-share figure: the same mapping without it
  const firstShare = mapExamples(loaded.invalid, suite.docs.filter((d) => !d.file.startsWith("alignment/")), taskByType, suite, "invalid", "receipt/payload.invalid-examples.json");
  const req = mapExamples(loaded.request, suite.docs, taskByType, suite, "request", undefined);
  const invByTask = new Map<string, number>();
  for (const e of inv.unmapped) invByTask.set(e.typeUri, (invByTask.get(e.typeUri) ?? 0) + 1);

  // ---- mapping: tasks
  const activeTasks = loaded.tasks.filter((t) => t.status !== "retired");
  const noVectors = loaded.tasks.filter((t) => !suite.mentioned.has(t.typeUri) && !suite.stepTypes.has(t.typeUri));
  const mentionOnly = loaded.tasks.filter((t) => !suite.stepTypes.has(t.typeUri) && suite.mentioned.has(t.typeUri));
  const withStep = loaded.tasks.filter((t) => suite.stepTypes.has(t.typeUri));

  // ---- mapping: fixtures
  const importedDir = join(opts.suiteRoot, "vectors/imported");
  const fixtures = fixtureFiles.map((p) => {
    const rel = p.slice("fixtures/".length);
    const mine = join(importedDir, rel);
    const theirs = sha(readFileSync(join(tf.root, p)));
    const imported = existsSync(mine);
    const identical = imported && sha(readFileSync(mine)) === theirs;
    const rows = (() => { try { const j = JSON.parse(readFileSync(join(tf.root, p), "utf8")) as J; return Array.isArray(j["cases"]) ? j["cases"].length : null; } catch { return null; } })();
    const used = suite.fixtureUse.get(rel)?.size ?? 0;
    return { path: p, imported, identical, rows, vectorsUsing: used };
  });
  const prov = existsSync(join(importedDir, "PROVENANCE.json")) ? (JSON.parse(readFileSync(join(importedDir, "PROVENANCE.json"), "utf8")) as { files: { path: string }[] }).files.map((f) => f.path) : [];
  const importedGone = prov.filter((rel) => !rel.startsWith("receipt/") && !tfHas(`fixtures/${rel}`)).sort();
  const proofManifest = tf.files.includes("fixtures/proof/manifest.json") ? JSON.parse(readFileSync(join(tf.root, "fixtures/proof/manifest.json"), "utf8")) as { entries?: unknown[] } : null;

  // ---- mapping: ceremonies
  const ceremonies = ceremonyDefs.map((p) => {
    const key = p.replace(/^ceremonies\//, "").replace(/\/ceremony\.json$/, "");
    const m = suite.ceremonyMentions.get(key);
    const cur = sha(readFileSync(join(tf.root, p)));
    const quoted = m === undefined ? [] : [...m.sha256].sort();
    return { path: p, scenarios: m === undefined ? [] : [...m.scenarios].sort(), quotedSha256: quoted, shaCurrent: cur, quotedShaMatches: quoted.length === 0 ? null : quoted.includes(cur) };
  });
  const ceremonyInvalidUsed = suite.vectors.some((v) => v.text.includes("ceremony.invalid-examples"));

  // ---- citations that no longer resolve or changed
  const citedBranchOnly: { path: string; vectors: number; heads: { head: string; holdsFile: boolean }[] }[] = [], citedMissing: { path: string; vectors: number }[] = [], citedChanged: { path: string; vectors: number; kind: string }[] = [];
  const hashOf = new Map<string, { specHash?: string; schemaHash?: string } | null>();
  for (const [p, ids] of [...suite.citedPaths].sort(([a], [b]) => a.localeCompare(b))) {
    if (tfHas(p)) continue;
    // a file that is only on a pull request or branch is not "missing": a vector that cites it names the head commit it follows (tfRef.status pr). Recorded apart, with whether that head still holds the file.
    const citing = suite.vectors.filter((v) => ids.has(v.id));
    const heads = [...new Set(citing.map((v) => v.prHead))];
    if (citing.length > 0 && !heads.includes(null)) {
      const gd = tf.gitDir;
      const holds = heads.map((h) => ({ head: h as string, holdsFile: gd !== null && gitOk(gd, "cat-file", "-e", `${h}:${p}`) }));
      citedBranchOnly.push({ path: p, vectors: ids.size, heads: holds });
      continue;
    }
    citedMissing.push({ path: p, vectors: ids.size });
  }
  let hashChecked = 0, hashOk = 0;
  for (const v of suite.vectors) {
    if (v.specHash === null) continue;
    // the recorded hash belongs to the file the vector itself cites (tfRef.repoPath), never to another spec its text happens to mention
    const p = v.ownPath;
    if (p === null || !(p.endsWith("spec.md") || p === "SPEC.md")) continue;
    if (!hashOf.has(p)) hashOf.set(p, hashTfPath(tf.root, p));
    const h = hashOf.get(p);
    if (h === null || h === undefined) continue;
    hashChecked++;
    if (h.specHash === v.specHash) hashOk++;
    else { const e = citedChanged.find((c) => c.path === p && c.kind === "text"); if (e === undefined) citedChanged.push({ path: p, vectors: 1, kind: "text" }); else e.vectors++; }
  }
  citedChanged.sort((a, b) => a.path.localeCompare(b.path));

  const g = tf.git;
  return {
    format: "tt-tf-alignment/0.1",
    status: STATUS_LINE,
    taskForce: { mode: tf.mode, ref: tf.ref, commit: g?.commit ?? null, date: g?.date ?? null, branch: g?.branch ?? null, originMain: g?.originMain ?? null },
    snapshot: { pins, tasksNewerThanManifest: newerTasks.length, tasksVanishedSinceManifest: vanishedTasks.length, newerTasks, vanishedTasks, retiredSinceManifest: retiredNow.sort() },
    inventory: {
      tasks: { total: loaded.tasks.length, draft: loaded.tasks.filter((t) => t.status === "draft").length, retired: loaded.tasks.filter((t) => t.status === "retired").length, otherStatus: loaded.tasks.filter((t) => t.status !== "draft" && t.status !== "retired").length },
      payloadExamplesFiles: tf.files.filter((p) => /payload\.examples\.json$/.test(p)).length,
      invalidExampleFiles: loaded.invalidFiles, invalidExamples: loaded.invalid.length,
      embeddedRequestExamples: loaded.request.length, embeddedResponseExamples: loaded.tasks.reduce((a, t) => a + t.embeddedResponseExamples, 0),
      fixtureFiles: fixtureFiles.length, proofManifestEntries: proofManifest?.entries?.length ?? null,
      ceremonyDefinitions: ceremonyDefs.length, ceremonyInvalidCases: ceremonyInvalid,
      bindingsConformanceScript: tf.files.includes("scripts/check-bindings-conformance.mjs"),
      libraryTestFiles: libTotals,
    },
    mapping: {
      invalidExamples: { ...inv.mapping, exactPct: pct(inv.mapping.exact, inv.mapping.total), exactOrNamedPct: pct(inv.mapping.exact + inv.mapping.namedOnly, inv.mapping.total), exactWithoutAlignmentSet: firstShare.mapping.exact, exactWithoutAlignmentSetPct: pct(firstShare.mapping.exact, firstShare.mapping.total), exactRequestPct: pct(inv.mapping.exactRequestEntries, inv.mapping.requestEntries), exactWithoutAlignmentSetRequestPct: pct(firstShare.mapping.exactRequestEntries, firstShare.mapping.requestEntries), tasksWithUnmapped: invByTask.size },
      requestExamplesInSpecs: { ...req.mapping, exactPct: pct(req.mapping.exact, req.mapping.total) },
      responseExamplesInSpecs: { total: loaded.tasks.reduce((a, t) => a + t.embeddedResponseExamples, 0), note: "not mapped: a response is produced by the implementation under test and the suite checks it against the response schema, not against an example" },
      tasks: { total: loaded.tasks.length, active: activeTasks.length, withStep: withStep.length, mentionedOnly: mentionOnly.length, noVectors: noVectors.length, withStepPct: pct(withStep.length, loaded.tasks.length), noVectorsList: noVectors.map((t) => t.typeUri) },
      fixtures: { total: fixtureFiles.length, importedIdentical: fixtures.filter((f) => f.identical).length, importedChanged: fixtures.filter((f) => f.imported && !f.identical).length, notImported: fixtures.filter((f) => !f.imported).length, usedByAVector: fixtures.filter((f) => f.vectorsUsing > 0).length, importedGone: importedGone.length, importedGoneList: importedGone, notImportedList: fixtures.filter((f) => !f.imported).map((f) => f.path), files: fixtures },
      ceremonies: { definitions: ceremonyDefs.length, withScenarios: ceremonies.filter((c) => c.scenarios.length > 0).length, items: ceremonies, invalidCases: ceremonyInvalid, invalidCasesCitedBySuite: ceremonyInvalidUsed },
      citations: { filesCited: suite.citedPaths.size, missing: citedMissing.length, missingList: citedMissing, branchOnly: citedBranchOnly.length, branchOnlyList: citedBranchOnly, textHashChecked: hashChecked, textHashUnchanged: hashOk, changedFiles: citedChanged.length, changedList: citedChanged },
    },
    suite: { vectorFiles: suite.files.length, vectorsAndScenarios: suite.vectors.length, stepDocuments: suite.docs.length },
    unmappedInvalidExamples: inv.unmapped.map((e) => `${e.typeUri.slice(TYPE_BASE.length)}#${e.index}`),
    unmappedRequestExamples: req.unmapped.map((e) => `${e.typeUri.slice(TYPE_BASE.length)}#${e.index}`),
  };
}
