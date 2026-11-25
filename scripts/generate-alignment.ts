// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/alignment/ (advisory; layer 3a, NOT core; outside every first-share figure). Run:
//   node --experimental-strip-types scripts/generate-alignment.ts [outDir]
// Found by `npm run tf-alignment` (docs/tf-alignment.md): the task force ships payloads it lists as invalid (payload.invalid-examples.json) and
// no other vector set sends some of them. For each task version in the committed snapshot (vectors-src/gap/tf-snapshot.json) this writes one vector
// (or, for a task outside the gap snapshot, in the alignment snapshot vectors-src/alignment/tf-snapshot.json, scripts/gap-snapshot.ts --out) this writes one vector
// that sends every such example and expects a refusal (SPEC.md 7.2 item 2: a payload that fails the task's schema is malformedRequest). An example is
// written only when it is a request entry (an entry marked `"variant": "response"` is an invalid reply: it is classified against the response schema and
// never sent as a request), the task's own payload schema refuses it without `format` asserted (checked here, never assumed; an entry invalid only
// through `format` is its own class, src/plain/invalid-examples.ts) and no other vector set already sends an equal payload as a request.
// Every vector is channel `proposed`, profile `tf-alignment`, advisory. A retired task and a task that exists only on a pull request are left out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUSAL_CODES } from "../src/coverage/build.ts";
import { standingCodes } from "../src/coverage/standing.ts";
import { hasRoleMember } from "../src/plain/negatives.ts";
import { gapTasks, RESPONSE_ONLY_SLUGS } from "../src/plain/gap.ts";
import { isObj, type J } from "../src/plain/build.ts";
import { loadAlignmentSnapshot } from "../src/plain/alignment-snapshot.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { classifyInvalidExample, FORMAT_ONLY_REASON, RESPONSE_ENTRY_REASON, SCHEMA_ACCEPTED_REASON } from "../src/plain/invalid-examples.ts";
import { loadSnapshot, type SnapshotTask } from "../src/plain/snapshot.ts";
import { loadTfManifest } from "../src/vectors/tfref.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { labelVersionRole } from "../src/vectors/version-role.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import type { Step, Vector, VectorFile } from "../src/vectors/types.ts";
import { payloadMatches } from "../src/tfalign/analyse.ts";
import { assignStableIds, restampCommit } from "../src/vectors/stable-ids.ts";
import { RETIRED_REASON } from "../src/vectors/source.ts";
import { loadSuiteFacts } from "../src/tfalign/suite.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = process.argv[2] === undefined ? join(root, "vectors", "alignment") : resolve(process.argv[2]);
const snap = loadSnapshot();
const GROUP = "TFA-INV";
// a vector cites the task force at the commit the committed manifest pins (every tfRef is resolved against it): a task that file does not hold is left out
const manifest = loadTfManifest();

// the payloads every other vector set already sends, by task (this set's own earlier output is not counted: the result must not depend on itself)
const sent = new Map<string, unknown[]>();
for (const d of loadSuiteFacts(root).docs) { if (d.file.startsWith("alignment/") || d.variant !== "request") continue; const l = sent.get(d.typeUri) ?? []; l.push(d.payload); sent.set(d.typeUri, l); }

const vectors: Vector[] = [];
const notWritten: { typeUri: string; index: number; reason: string; class?: string }[] = [];
// Ids are never reused (docs/04 section 20.3): a task keeps the id it was given in the committed file, and a task new to the set takes the next number after
// the highest id ever issued (the ledger). The result does not depend on the order tasks are read in.
const committedIds = new Map<string, string>();
const committedFile = join(root, "vectors", "alignment", "tfa-inv.json");
if (existsSync(committedFile)) for (const v of (JSON.parse(readFileSync(committedFile, "utf8")) as { vectors: { id: string; requires?: string[] }[] }).vectors) if (v.requires?.[0] !== undefined) committedIds.set(v.requires[0], v.id);
const numberOf = (id: string): number => Number(id.slice(GROUP.length + 1));
let nextNo = 1 + Math.max(0, ...[...committedIds.values()].map(numberOf), ...((JSON.parse(readFileSync(join(root, "vectors-src", "id-ledger.json"), "utf8")) as { ids: string[] }).ids.filter((i) => i.startsWith(`${GROUP}-`)).map(numberOf)));
const idFor = (typeUri: string): string => { const have = committedIds.get(typeUri); if (have !== undefined) return have; const id = `${GROUP}-${String(nextNo++).padStart(3, "0")}`; committedIds.set(typeUri, id); return id; };

// the tasks to read: the gap snapshot's (schema from the package or the snapshot), then every other task of the alignment snapshot (sorted, so new ids are in a fixed order)
const inGap = new Set(snap.tasks.map((t) => t.typeUri));
const cands: { s: SnapshotTask; schema: J | undefined; response: J | undefined }[] = gapTasks().map((g) => ({ s: g.snap, schema: g.task.payloadSchema as J, response: g.task.responseSchema as J | undefined }));
for (const s of [...loadAlignmentSnapshot().tasks].filter((t) => !inGap.has(t.typeUri)).sort((a, b) => (a.typeUri < b.typeUri ? -1 : 1))) { const t = loadTask(s.typeUri); cands.push({ s, schema: (t?.payloadSchema ?? s.payloadSchema) as J | undefined, response: (t === undefined ? s.responseSchema : t.responseSchema) as J | undefined }); }
for (const { s, schema, response } of cands) {
  if (s.status === "retired" || s.origin !== undefined) continue;
  // a reply type (an error or success reply) is never a request a consumer is sent: SPEC.md section 4.4, as in scripts/generate-gap.ts
  if (RESPONSE_ONLY_SLUGS.includes(s.slug)) { s.invalidExamples.forEach((_e, i) => notWritten.push({ typeUri: s.typeUri, index: i, reason: "a reply type: it is never sent to a consumer as a request" })); continue; }
  const mEntry = manifest.paths[s.tfPath];
  if (mEntry === undefined || mEntry.status !== "draft") { s.invalidExamples.forEach((_e, i) => notWritten.push({ typeUri: s.typeUri, index: i, reason: "the task is not a draft specification in the committed manifest, which pins an older task-force commit than the snapshot" })); continue; }
  if (schema === undefined) { s.invalidExamples.forEach((_e, i) => notWritten.push({ typeUri: s.typeUri, index: i, reason: "the task has no payload schema in the pinned package or the snapshot, so no refusal can be checked" })); continue; }
  const root0 = schema;
  const picked: { i: number; note: string; payload: J }[] = [];
  s.invalidExamples.forEach((e, i) => {
    const note = String((e as { note?: string }).note ?? "invalid example");
    const p = (e as { payload: unknown }).payload;
    // classified against the schema of the entry's own variant, with and without `format` asserted (src/plain/invalid-examples.ts)
    const c = classifyInvalidExample({ request: schema, response }, e);
    if (c.variant === "response") { notWritten.push({ typeUri: s.typeUri, index: i, reason: `${RESPONSE_ENTRY_REASON}; response schema: ${c.class === "refused" ? "refuses it" : c.class === "format-only" ? "refuses it only with `format` asserted" : c.class === "no-schema" ? "none available to the suite for this version" : "accepts it"}`, class: c.class === "refused" ? "response-entry" : `response-entry, ${c.class}` }); return; }
    if (c.class === "format-only") { notWritten.push({ typeUri: s.typeUri, index: i, reason: FORMAT_ONLY_REASON, class: "format-only" }); return; }
    if (c.class !== "refused") { notWritten.push({ typeUri: s.typeUri, index: i, reason: SCHEMA_ACCEPTED_REASON, class: "schema-accepted" }); return; }
    if (!isObj(p)) { notWritten.push({ typeUri: s.typeUri, index: i, reason: "the payload is not a JSON object" }); return; }
    if (hasRoleMember(p)) { notWritten.push({ typeUri: s.typeUri, index: i, reason: "it carries a governance role member: the role is the deployment's choice (docs/02 section 5)" }); return; }
    if ((sent.get(s.typeUri) ?? []).some((q) => payloadMatches(q, p))) return;
    picked.push({ i, note, payload: p });
  });
  if (picked.length === 0) continue;
  const steps: Step[] = picked.map((e, k) => ({ send: { document: { id: `$id(i${k + 1})`, type: s.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: e.payload } }, expect: { disposition: "error", code: [...REFUSAL_CODES, ...standingCodes(s.typeUri, root0, e.payload)], noSideEffect: true } }));
  const source: VectorSource = { slug: s.slug, version: s.version, channel: "proposed", profile: "tf-alignment", ref: `kit:specs/${s.slug}/${s.version}`, pinnedDigest: s.dirDigest,
    note: `Advisory, outside every first-share figure. Spec maturity: ${s.status} (a draft). Written from the examples the task force lists as invalid that no other vector set sends (decision D920).`,
    tfRef: { repoPath: s.tfPath, commit: manifest.main.commit, status: "draft" } };
  const v = { id: idFor(s.typeUri), title: `${s.slug} ${s.version}: the payload examples the specification lists as invalid and no other set sends are refused (${picked.length})`, tier: 1,
    spec: ["SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; a payload that fails is rejected with malformedRequest, 8.3)", `payload.invalid-examples.json of ${s.typeUri} (entries ${picked.map((e) => e.i + 1).join(", ")}): ${picked.map((e) => e.note).join(" | ").slice(0, 500)}`, "Each payload was checked against the task's payload schema when this vector was generated, and the schema refuses it", "malformedRequest, permissionDenied and the task's own standing codes are accepted: SPEC.md 7.2 items 2 and 10 do not order validation against the authorisation decision (O-03)"],
    source, clarify: null, requires: [s.typeUri], mutants: ["noPayloadValidation"], steps } as unknown as Vector;
  vectors.push(v);
}
vectors.sort((a, b) => numberOf(a.id) - numberOf(b.id));
const files: VectorFile[] = [{ format: "tt-conformance-vectors/0.1", group: GROUP, family: "tf-alignment", clock: { start: "2026-11-12T10:00:00Z" }, vectors }];
applyErrorReply(files);
labelVersionRole(files);
// a committed vector no longer written stays as a tombstone: ids are never deleted (docs/04 section 20.3). Its reason says why: the task's specification
// is now retired in the committed manifest (named with its successor), or all of its examples were response entries
const retiredSpec = (v: Vector): { supersededBy?: string } | undefined => { const p = (v.source as { tfRef?: { repoPath?: string } } | undefined)?.tfRef?.repoPath; const m = p === undefined ? undefined : manifest.paths[p]; return m?.status === "retired" ? m : undefined; };
const retireReason = (v: Vector): { reason: string; since: string } => {
  const r = retiredSpec(v);
  if (r !== undefined) return { reason: `no longer generated: the cited specification is retired in the committed manifest${r.supersededBy === undefined ? "" : ` (superseded by ${r.supersededBy})`}, and a vector on a retired specification is never run`, since: "0.1.0-draft" };
  return { reason: "no longer generated: every example it sent was a response entry (`variant: response`) of payload.invalid-examples.json, which is an invalid reply and is never sent as a request (src/plain/invalid-examples.ts)", since: "0.1.0-draft" };
};
// a tombstone cites the manifest's commit and the status the manifest gives its specification; one on a retired specification is excluded from every run
// with the successor named, as every vector on a retired specification is (src/vectors/validate.ts)
function restampTomb(t: Vector): Vector {
  const v = restampCommit(t, manifest.main.commit) as Vector & { source: { tfRef?: Record<string, unknown>; versionRole?: string }; excludedFromRun?: unknown };
  const r = retiredSpec(v);
  if (r === undefined || v.source.tfRef === undefined) return v;
  v.source.tfRef = { ...v.source.tfRef, status: "retired", supersededBy: r.supersededBy ?? "unknown" };
  v.source.versionRole = "retired";
  // the same reason the other generators give (src/vectors/source.ts, src/vectors/version-role.ts)
  v.excludedFromRun = r.supersededBy !== undefined && /\/0\.2$/.test(r.supersededBy) ? { reason: RETIRED_REASON } : { reason: `cites a retired TF spec; successor ${r.supersededBy ?? "unknown"} is draft on main` };
  return v;
}
files[0]!.vectors = assignStableIds(vectors, { group: GROUP, committedFile, ledger: [], keyOf: (v) => String(v.requires?.[0] ?? v.id), retire: retireReason, restamp: restampTomb });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "tfa-inv.json"), JSON.stringify(files[0], null, 1) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["tfa-inv.json"] }, null, 2) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "Invalid examples the generator did not turn into a vector, with the reason (and, where it was classified, the class: response-entry, format-only or schema-accepted; each entry is checked against the schema of its own variant, src/plain/invalid-examples.ts). Not an implementation result.", items: notWritten }, null, 1) + "\n");
console.log(`${vectors.length} alignment vectors, ${vectors.reduce((a, v) => a + (v.steps as unknown[]).length, 0)} examples; ${notWritten.length} examples not written`);
