// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/complete/ (the positive-path completion of the VTI and keyring-wallet scope; layer 3a, NOT core). Run:
//   node --experimental-strip-types scripts/generate-complete.ts [outDir]
// For every task in vectors-src/complete/scope.json (latest version of each task VTI serves or the wallet's source gives a role) that no
// other vector set gives a positive vector (a send expecting an answer, or an emit), this writes what the specification and the task's own
// schemas support, and nothing else: the shared "a schema-valid, signed, addressed request is not refused for an envelope reason, and any
// response conforms to the response schema" vector (SPEC.md 7.2), the specification's own valid request examples where it lists them,
// and for a task the wallet emits with no emit vector, the producer-class vector. A task whose response cannot be built from its schema is
// listed in not-generated.json (a generator limit, never an implementation result). Every vector is channel `proposed`, profile
// `vectors-complete`, advisory: promotion needs recorded runs (docs/33) and this step runs no platform. Maturity is the spec's `status`.
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVecRows, type Scope } from "../src/coverage/completeness.ts";
import type { TaskFacts } from "../src/coverage/task-facts.ts";
import { badResponsePayload } from "../src/plain/catalog.ts";
import { REFUSAL_CODES, REFUSAL_NOTE } from "../src/coverage/build.ts";
import { standingCodes } from "../src/coverage/standing.ts";
import { build, isObj, RATIONALE_GOV, tokenizeRoles, type J } from "../src/plain/build.ts";
import { loadTask, type PlainTask } from "../src/plain/catalog.ts";
import { gapTasks, type GapTask } from "../src/plain/gap.ts";
import { rolesAreGovernance } from "../src/plain/gap-build.ts";
import { classifyInvalidExample, variantOf } from "../src/plain/invalid-examples.ts";
import { hasRoleMember } from "../src/plain/negatives.ts";
import { exampleExtended, validate } from "../src/plain/schema.ts";
import { stateCodes, type StateCode } from "../src/coverage/reachable.ts";
import { loadSnapshot, type Snapshot } from "../src/plain/snapshot.ts";
import { loadPins, pinFor, withSpecHashes, type VectorSource } from "../src/vectors/source.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import type { Step, Vector, VectorFile } from "../src/vectors/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = process.argv[2] === undefined ? join(root, "vectors", "complete") : resolve(process.argv[2]);
const T0 = "2026-11-12T10:00:00Z";
const PROFILE = "vectors-complete";
const scope = JSON.parse(readFileSync(join(root, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;
const snap = loadSnapshot();
const gapBy = new Map<string, GapTask>(gapTasks().map((g) => [g.snap.typeUri, g]));
const pins = loadPins();
// facts for scope tasks the gap snapshot does not hold (other sets cover them): the spec's own request examples; the schemas come from the pinned package
const extra = new Map((JSON.parse(readFileSync(join(root, "vectors-src", "complete", "tf-extra.json"), "utf8")) as Snapshot).tasks.map((x) => [x.typeUri, x]));

// facts each task's own spec.md states (scripts/derive-task-facts.ts): effect (sideEffects.level) and the framework codes its text names
const facts = new Map((JSON.parse(readFileSync(join(root, "vectors-src", "complete", "task-facts.json"), "utf8")) as { tasks: TaskFacts[] }).tasks.map((f) => [f.typeUri, f]));
// Codes a valid, signed, in-window, addressed request may still draw where the task's own text names them (a payload-level rule: an id already in
// use, a proof checked against live state, a transport that cannot stream, a version the task itself negotiates). The clock, addressing and
// proof-presence codes (expired, proofRequired, wrongRecipient, identityMismatch) stay failures: the vector controls those itself.
const PAYLOAD_LEVEL_CODES = ["idConflict", "proofInvalid", "unsupportedType", "unsupportedVersion"];
// S-04: a mandated code is accepted only where the vector can create the situation the spec names it for. `idConflict` is "an id already in use": the vectors
// send suite-minted ids (`$id(..)`, fresh per run salt), so no earlier registration holds one. `proofInvalid` of claim/finish is the live-document check of rule 3, behind
// rule 1 (an unknown `claimId` is `registrationMismatch`) and the vector sends a claimId nobody issued. A code that cannot arise is not accepted: a refusal with it
// is then not a conforming answer for this request, and accepting it would let a wrong refusal pass.
function cannotArise(code: string, effect: string | null): string | null {
  if (code === "idConflict" && effect !== "read-only") return "the request names suite-minted ids ($id, fresh for each run salt), so none is already in use";
  if (code === "proofInvalid") return "the code is the live-state proof check of the specification's rule 3, behind rule 1 (an unknown claimId is refused first), and the vector sends a claimId nobody issued";
  return null;
}
// R-01: a task's own front-matter `errorCodes` that a conforming implementation can return for a valid request of this vector make success unassertable.
// Standing codes are covered by `optional:authorised` (administrator or member standing, R-06); a code that needs a request member the vector does not send
// cannot fire (read from the code's own text: a backticked payload member that the payload lacks, or a cursor code with no cursor); the rest are reachable.
// a success response that opens a stream is followed by the stream's documents on the same delivery (vtc/admin/events/subscribe/0.6 spec.md line 130)
const STREAM_FOLLOW_ON: Record<string, { follow: string[]; cite: string }> = {
  "https://trusttasks.org/spec/vtc/admin/events/subscribe/0.6": { follow: ["vtc/admin/events/event/0.5"], cite: "vtc/admin/events/subscribe 0.6 spec.md line 130: the community sends the #response first, then vtc/admin/events/event/0.5 documents on the same delivery until the stream ends" },
};
// what the other vector sets already give each task
const rows = loadVecRows(root, ["complete"]);
const has = (u: string, k: "pos" | "neg" | "emit"): boolean => rows.some((r) => r.by?.[u]?.[k] === true); // R-02: polarity is credited to the task a step sends or emits, not to every task a vector names

const notGenerated: Record<string, unknown>[] = [];
const MATURITY = (status: string): string => `Spec maturity: ${status} (every current specification is draft or retired; none is candidate or standard).`;

function sourceOf(t: PlainTask, g: GapTask | undefined): VectorSource {
  const note = `${MATURITY(g?.snap.status ?? "draft")} Advisory vector of the completion step (profile ${PROFILE}); it is not promoted (strength and effect are tagged on the vector).`;
  if (g !== undefined) {
    const s = g.snap;
    return ({ slug: s.slug, version: s.version, ref: `kit:specs/${s.slug}/${s.version}`, pinnedDigest: s.dirDigest, specHash: s.specHash, ...(s.schemaHash === null ? {} : { schemaHash: s.schemaHash }), note, channel: "proposed", profile: PROFILE, tfRef: { repoPath: s.tfPath, commit: snap.tfCommit, status: s.status === "retired" ? "retired" : "draft", ...(s.status === "retired" ? { supersededBy: s.supersededBy ?? "unknown" } : {}) }, tfCommit: snap.tfCommit } as VectorSource);
  }
  const ref = `pkg:@openvtc/trust-tasks@0.29.0#${t.typeUri}`;
  const tfRef0 = tfRefFor(ref);
  if (tfRef0 === null) throw new Error(`no Trust Tasks reference for ${ref}`);
  // F-12: a vector sourced from the package cites the manifest's main commit (older than the snapshot's). Where the task's whole directory is byte-identical at
  // the snapshot commit (scripts/derive-task-facts.ts --since), it is cited at the snapshot commit, so one checkout satisfies every complete vector.
  const idn = facts.get(t.typeUri)?.identicalSince;
  const tfRef = idn !== undefined && idn.identical && tfRef0.commit === idn.commit ? { ...tfRef0, commit: snap.tfCommit } : tfRef0;
  const withHashes = withSpecHashes({ slug: t.slug, version: t.version, ref, pinnedDigest: pinFor(ref, pins), tfRef, note, channel: "proposed", profile: PROFILE } as VectorSource);
  return idn !== undefined && idn.identical && withHashes.tfCommit === idn.commit ? { ...withHashes, tfCommit: snap.tfCommit } : withHashes;
}

const srcText = (t: PlainTask, g: GapTask | undefined): string => g === undefined ? "@openvtc/trust-tasks 0.29.0 (registry package; the specification is status draft)" : `Trust Tasks specification ${g.snap.slug} ${g.snap.version} (status ${g.snap.status}) on main at ${snap.tfCommit.slice(0, 9)}; payload schema from ${g.schemaFrom === "package" ? "the pinned @openvtc/trust-tasks 0.29.0 package" : "the gap snapshot"}`;


const RATIONALE = RATIONALE_GOV;
const withheld: Record<string, unknown>[] = [];
const negNotGenerated: Record<string, unknown>[] = [];

/** Every string an enum or const of the schema allows: a payload made only of these carries no identifier or free text the deployment's state could contradict. */
function enumStrings(schema: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) { for (const x of schema) enumStrings(x, out); return out; }
  if (!isObj(schema)) return out;
  if (Array.isArray(schema["enum"])) for (const x of schema["enum"]) if (typeof x === "string") out.add(x);
  if (typeof schema["const"] === "string") out.add(schema["const"]);
  for (const x of Object.values(schema)) enumStrings(x, out);
  return out;
}
function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (isObj(v)) for (const x of Object.values(v)) stringLeaves(x, out);
  return out;
}
/** The request names no identifier or free text: every string in it is an enumerated value (so the answer does not depend on what the deployment holds). */
const stateIndependent = (schema: J, payload: unknown): boolean => { const e = enumStrings(schema); return stringLeaves(payload).every((x) => e.has(x)); };

function notBuildable(t: PlainTask): string {
  const text = JSON.stringify(t.responseSchema ?? {});
  const why = /"allOf"/.test(text) && /"unevaluatedProperties"/.test(text) ? "the response schema combines allOf with unevaluatedProperties, which neither example() nor the extended builder satisfies" : "neither example() nor the extended builder finds an instance of the response schema";
  return `${why}, so the reference adapter cannot answer it and no positive vector is written`;
}
function weakWhy(t: PlainTask, effect: string, strongOk: boolean, reach: StateCode[] = []): string {
  if (strongOk) return "";
  const r = reach.filter((x) => x.reachable);
  if (effect === "read-only" && r.length > 0) return `the specification names ${r.map((x) => x.code).join(", ")}, which a conforming implementation may return for this request depending on state`;
  if (t.responseSchema === undefined) return "the version declares no response, so there is nothing to assert";
  if (effect !== "read-only") return `the task is ${effect} and authorisation or state decides whether it succeeds`;
  return "the request names an identifier or free text, so deployment state decides the answer";
}
/** Where a create-type payload carries a top-level `id`, a minted id replaces the specification's example id (no dependence on a prior run), when the schema accepts the token. */
function mintIds(payload: J, schema: J, n: number): J {
  if (!isObj(payload) || typeof payload["id"] !== "string") return payload;
  const minted = { ...payload, id: `$id(m${n})` };
  return validate(schema, minted).length === 0 ? minted : payload;
}
function mechanicsCite(t: PlainTask, g: GapTask | undefined, strong: boolean, acceptCite: string[], gov: string[], reach: StateCode[] = [], reachCandidate = false): string[] {
  return [
    "SPEC.md:1011-1023 (7.2 consumer rules 1-13: none of the rejection grounds applies to this request, so a refusal must not carry their codes, section 8.3)",
    "SPEC.md 4.4.1 (the reply dispositions) and 7.1 item 3 (a response payload validates against the schema of its type)",
    `payload and response schemas of ${t.typeUri} (${srcText(t, g)})`,
    ...(t.responseSchema === undefined ? ["the version declares no response variant: silence is accepted", "Spec-open (class C, recorded, not filed): whether a follow-on task document sent on-thread (for example `issue` in answer to a credential-exchange `request`) is a reply under SPEC.md 4.4.1's three dispositions is not settled by the text; the vector observes such a reply and asserts neither way"] : [`response type ${t.responseTypeUri}`]),
    "SPEC.md:246, :1069 (a consumer MAY require its own ext namespace and then rejects a document lacking it with malformedRequest) and SPEC.md:388 (MAY reject a non-canonical VID-typed member with malformedRequest): where the payload schema admits ext, a malformedRequest here is recorded as a note and is not escalated on the attested profile",
    strong ? "Success asserted: the specification defines the response, the task changes nothing, the request names no identifier or free text, and the vector requires optional:authorised (SPEC.md 7.2 item 10: authorisation is the deployment's, never the suite's)"
      : "Weak form: any non-envelope answer passes, and silence is an advisory (SPEC.md 7.2 closing paragraph: returning an error is a SHOULD; section 8: a MAY); the vector does not assert that the request succeeds",
    ...acceptCite,
    ...(strong || reach.some((x) => x.reachable) && reachCandidate ? reach : []).map((x) => `Front-matter error code ${x.code} (spec.md line ${x.line}): ${x.reachable ? "reachable for a valid request, so success is not asserted" : `not reachable here (${x.why})`}`),
    ...gov,
  ];
}

/** The identity of a generated vector across regenerations: the task it sends to (or emits), and its kind (mechanics, examples, negative, emit). */
function vectorKey(v: Vector): string {
  const s = v.steps[0] as unknown as { send?: { document?: { type?: string } }; emit?: { type?: string } };
  const type = s.send?.document?.type ?? s.emit?.type ?? "";
  const kind = /request examples in the specification/.test(v.title) ? "examples" : /invalid payload examples/.test(v.title) || /the payload is validated against/.test(v.title) ? "negative" : /schema-valid, signed, addressed/.test(v.title) ? "mechanics" : /emits for this task/.test(v.title) ? "emit" : "other";
  const n = kind === "negative" ? v.title.replace(/^.*?: /, "").slice(0, 40) : "";
  return `${type}|${kind}|${n}`;
}
function existingIds(group: string): Map<string, string> {
  const m = new Map<string, string>();
  let j: VectorFile;
  try { j = JSON.parse(readFileSync(join(root, "vectors", "complete", `${group.toLowerCase()}.json`), "utf8")) as VectorFile; } catch { return m; }
  const seen = new Map<string, number>();
  for (const v of j.vectors) {
    if ((v as { retired?: unknown }).retired !== undefined) continue;
    const k0 = vectorKey(v); const n = (seen.get(k0) ?? 0) + 1; seen.set(k0, n);
    m.set(`${k0}|${n}`, v.id);
  }
  return m;
}
const POSITIVE_TITLE = /a schema-valid, signed, addressed request is not refused/;
const byFamily = new Map<string, Vector[]>();
const emitVectors: Vector[] = [];
const add = (fam: string, v: Vector, src: VectorSource): void => {
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) { o[k] = x; if (k === "spec") o["source"] = src; }
  (byFamily.get(fam) ?? byFamily.set(fam, []).get(fam)!).push(o as unknown as Vector);
};

for (const st of scope.tasks) {
  const g = gapBy.get(st.typeUri);
  let t = g?.task ?? loadTask(st.typeUri);
  let exs: { payload: unknown }[] = g?.examples ?? [];
  if (g === undefined && t !== undefined) {
    // the schema-driven builder of the gap tasks (`example`, then the extended builder), as gapTasks does for a task of the snapshot
    const root0 = t.payloadSchema;
    exs = (extra.get(st.typeUri)?.examples ?? []).filter((e) => validate(root0, e.payload).length === 0);
    const valid = t.validPayload ?? exampleExtended(root0) ?? exs[0]?.payload;
    t = { ...t, validPayload: valid };
  }
  // the oracle answers with the extended builder's response (the one already used for request payloads): F-08, no longer the catalog's `example` only
  if (t !== undefined && t.responseSchema !== undefined) t = { ...t, validResponse: exampleExtended(t.responseSchema) };
  if (t === undefined || t.validPayload === undefined) { if (!has(st.typeUri, "pos")) notGenerated.push({ typeUri: st.typeUri, kind: "no-payload-schema", class: "D", note: "no payload schema or valid payload can be built for this version (not in the pinned package or snapshot)" }); continue; }
  const needPos = !has(st.typeUri, "pos");
  const needNeg = !has(st.typeUri, "neg");
  const fact = facts.get(st.typeUri);
  if (fact === undefined) throw new Error(`no task facts for ${st.typeUri}: run scripts/derive-task-facts.ts`);
  // a task whose text states no sideEffects is treated as mutating (the safe reading)
  const effect: "destructive" | "mutating" | "read-only" = fact.effect ?? "mutating";
  const mandated = [...new Set(fact.mandatedCodes.map((c) => c.code))].filter((c) => PAYLOAD_LEVEL_CODES.includes(c));
  const gate = (c: string): string | null => cannotArise(c, fact.effect);
  const accept = mandated.filter((c) => gate(c) === null);
  const acceptCite = [
    ...accept.map((c) => { const m = fact.mandatedCodes.find((x) => x.code === c)!; return `Accepted at the payload level (the task's own text): ${t.slug} ${t.version} spec.md line ${m.line} names ${c}: "${m.text}"`; }),
    ...mandated.filter((c) => gate(c) !== null).map((c) => { const m = fact.mandatedCodes.find((x) => x.code === c)!; return `Not accepted (S-04): ${t.slug} ${t.version} spec.md line ${m.line} names ${c}, but ${gate(c)!}`; }),
  ];
  for (const n of fact.noResponseOk) acceptCite.push(`Silence or a dropped connection is not a failure (the task's own text): ${t.slug} ${t.version} spec.md line ${n.line}: "${n.text}"`);
  const gov0 = rolesAreGovernance(t.payloadSchema as J, t.validPayload);
  const tok = (v: unknown, used: { n: boolean }): unknown => (gov0 ? tokenizeRoles(v, used) : v);
  const made = needPos || needNeg ? build(t, srcText(t, g), tok) : [];
  const finishV = (v: Vector, kind: string, extraRequires: string[] = []): Vector => {
    const o = v as unknown as Record<string, unknown>;
    o["requires"] = [...new Set([...((o["requires"] as string[] | undefined) ?? []), ...extraRequires])];
    o["effect"] = effect;
    void kind;
    return o as unknown as Vector;
  };
  if (needPos) {
    const posMade = made.filter((v) => POSITIVE_TITLE.test(v.title));
    if (posMade.length === 0) notGenerated.push({ typeUri: st.typeUri, kind: "response-not-constructible", class: "D", note: `${t.slug} ${t.version}: ${notBuildable(t)}`, reason: "a generator limit, not an implementation result" });
    // F-02: a vector asserts success only where the specification defines a response and neither prior state nor a free-form value decides it (read-only, no
    // identifier or free text in the request, a response the schema can build); every other positive is the weak form, tagged as such
    const reach = stateCodes(fact, t.payloadSchema as J, t.validPayload);
    const strongOk = t.responseSchema !== undefined && t.validResponse !== undefined && effect === "read-only" && stateIndependent(t.payloadSchema as J, t.validPayload) && !reach.some((x) => x.reachable);
    const stream = STREAM_FOLLOW_ON[st.typeUri];
    for (const v0 of posMade) {
      const step = (v0.steps[0] as unknown as { expect: Record<string, unknown> }).expect;
      // a task that changes state gets a suite-minted id in place of a fixed one, so the vector does not depend on a prior run (F-04)
      const doc0 = (v0.steps[0] as unknown as { send: { document: { payload: J } } }).send.document;
      if (effect !== "read-only") doc0.payload = mintIds(doc0.payload, t.payloadSchema as J, 0);
      const v = finishV(v0, "mechanics", strongOk ? ["optional:authorised"] : []) as unknown as Record<string, unknown>;
      v["title"] = strongOk ? `${t.slug} ${t.version}: a schema-valid, signed, addressed request is answered with the task's response, which conforms to the response schema (success asserted)` : `${t.slug} ${t.version}: a schema-valid, signed, addressed request is not refused for an envelope reason, and any response conforms to the response schema (weak: ${weakWhy(t, effect, strongOk, reach)})`;
      v["spec"] = mechanicsCite(t, g, strongOk, [...acceptCite, ...(stream === undefined ? [] : [`Follow-on documents of the answer's stream are noted, not a second answer: ${stream.cite}`])], gov0 ? [RATIONALE] : [], reach, effect === "read-only" && t.responseSchema !== undefined && t.validResponse !== undefined && stateIndependent(t.payloadSchema as J, t.validPayload));
      v["strength"] = strongOk ? "asserted" : "weak";
      if (strongOk) { step["success"] = true; v["mutants"] = [...new Set([...((v["mutants"] as string[] | undefined) ?? []), "plainInternalError"])]; }
      if (accept.length > 0) step["acceptCodes"] = accept;
      if (stream !== undefined) step["followOn"] = stream.follow;
      add(t.family, v as unknown as Vector, sourceOf(t, g));
    }
    // the specification's own valid request examples (up to three), where it lists them. A destructive task gets none: an example carries the specification's own
    // identifiers, which on a real deployment can name real objects (F-06); the mechanics vector above sends a synthetic payload instead
    const ex = effect === "destructive" ? [] : exs.slice(0, 3);
    if (effect === "destructive" && exs.length > 0) withheld.push({ typeUri: st.typeUri, effect, examples: exs.length, reason: "destructive task: the specification's example identifiers are not sent verbatim (F-06)" });
    if (posMade.length > 0 && ex.length > 0) {
      const used = { n: false };
      const doc = (n: string, pl: J): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl });
      const steps: Step[] = ex.map((e, i) => ({ send: { document: doc(`x${i + 1}`, mintIds(tok(e.payload, used) as J, t.payloadSchema as J, i + 1)) }, expect: { disposition: "answered", plainType: t.typeUri, ...(accept.length > 0 ? { acceptCodes: accept } : {}) } }));
      const v = finishV({ id: "", title: `${t.slug} ${t.version}: the request examples in the specification are not refused for an envelope reason (${ex.length}; weak: the examples name state the deployment decides)`, tier: 1,
        spec: [...mechanicsCite(t, g, false, acceptCite, []).slice(0, 2), `request examples in the specification of ${t.typeUri} (${srcText(t, g)})`, "Weak form: a non-envelope answer of any kind passes; the example's own content and the deployment's authorisation and state decide the outcome (SPEC.md 7.2 item 10)", ...(used.n ? ["Governance is the deployment's choice, never the suite's (docs/02 section 5): a role value is taken from the adapter's declared governance.roles."] : [])],
        strength: "weak", clarify: null, requires: [t.typeUri, ...(used.n ? ["optional:governance.roles"] : [])], steps } as unknown as Vector, "examples");
      add(t.family, v, sourceOf(t, g));
    }
  }
  if (needNeg) {
    // F-07: a negative from the task's own required members, closed payload, or the invalid examples its specification ships. Only where something receives the task
    // (VTI serves it or the wallet serves it): an emit-only task has no send path, so it is recorded instead
    const receivable = st.vti.length > 0 || st.kw === "serves";
    const negMade = made.filter((v) => /the payload is validated against/.test(v.title));
    // only request entries the request schema refuses without `format` asserted, with no governance role member (src/plain/invalid-examples.ts): a response
    // entry, an entry invalid only through `format` and one whose invalidity may rest on a role value are never sent as a request
    const invalid = ((g?.snap.invalidExamples ?? (extra.get(st.typeUri)?.invalidExamples ?? [])) as { note?: string; payload: unknown; variant?: unknown }[])
      .filter((e) => isObj(e.payload) && !hasRoleMember(e.payload) && classifyInvalidExample({ request: t.payloadSchema, response: t.responseSchema }, e).class === "refused" && variantOf(e) === "request");
    if (!receivable) negNotGenerated.push({ typeUri: st.typeUri, kind: "negative-emit-only", class: "D", note: `${t.slug} ${t.version}: no negative vector. VTI does not serve it and the wallet only emits it, so there is no receiving side to send an invalid request to; the emit vector's emitBadPayload mutant is the check that the producer-side payload rules bite` });
    else {
      for (const v0 of negMade) add(t.family, finishV(v0, "negative"), sourceOf(t, g));
      const bad = negMade.length > 0 ? [] : invalid.slice(0, 3);
      if (bad.length > 0) {
        const doc = (n: string, pl: unknown): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl });
        const steps: Step[] = bad.map((e, i) => ({ send: { document: doc(`n${i + 1}`, e.payload) }, expect: { disposition: "error", code: [...REFUSAL_CODES, ...standingCodes(t.typeUri, t.payloadSchema, e.payload)], noSideEffect: true } }));
        add(t.family, finishV({ id: "", title: `${t.slug} ${t.version}: the invalid payload examples the specification ships are refused (${bad.length})`, tier: 1,
          spec: ["SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; a payload that fails is rejected with malformedRequest, 8.3)", `payload.invalid-examples.json of ${t.typeUri}: ${bad.map((e) => e.note ?? "invalid example").join(" | ")} (${srcText(t, g)})`, REFUSAL_NOTE],
          clarify: null, requires: [t.typeUri], mutants: ["noPayloadValidation"], steps } as unknown as Vector, "negative"), sourceOf(t, g));
      }
      if (negMade.length === 0 && bad.length === 0) negNotGenerated.push({ typeUri: st.typeUri, kind: "negative-no-source", class: "D", note: `${t.slug} ${t.version}: no required member, closed payload, wrong-type member or shipped invalid example to build a negative from` });
    }
  }
  if (st.kw === "emits" && !has(st.typeUri, "emit")) {
    const p = t.requestPolicy;
    const canMutate = isObj(t.payloadSchema) && (Array.isArray((t.payloadSchema as J)["required"]) ? ((t.payloadSchema as J)["required"] as unknown[]).length > 0 : (t.payloadSchema as J)["additionalProperties"] === false);
    const v = { id: "", title: `${t.slug} ${t.version}: the document the implementation emits for this task conforms to its payload schema and declared policy`, tier: 1,
      spec: [`payload schema of ${t.typeUri} (${srcText(t, g)})`, `declared policy: isProofRequired=${p.isProofRequired}, isRecipientRequired=${p.isRecipientRequired}, isIssuedAtRequired=${p.isIssuedAtRequired}`,
        "SPEC.md:996-998 (7.1 items 1-3: a conforming producer emits the top-level structure, the task's Type URI and a payload that validates against its schema)", "SPEC.md:1137 (7.3 item 17: a consequential task's specification requires issuedAt) and 7.3 items 5 and 8 (the task's declared parties and proof requirements): the declared recipient, proof and issuedAt requirements are the task's own, and a document lacking one does not conform to it",
        "Mechanics only: the suite does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5)"],
      clarify: null, requires: ["optional:emit", `emit:${t.typeUri}`], ...(canMutate ? { mutants: ["emitBadPayload", ...(p.isProofRequired ? ["emitNoProof"] : []), ...(p.isRecipientRequired ? ["emitNoRecipient"] : []), ...(p.isIssuedAtRequired ? ["emitNoIssuedAt"] : [])] } : {}),
      steps: [{ emit: { type: t.typeUri, args: { recipient: "$X" } }, expect: { disposition: "emitted", plainType: t.typeUri } }] } as unknown as Vector;
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { o[k] = x; if (k === "spec") o["source"] = sourceOf(t, g); }
    emitVectors.push(o as unknown as Vector);
  }
}

// ids are never reused (docs/04 section 20.3): tombstones of retired ids come first in their group and the group's new ids continue after them
const retiredGroups = (JSON.parse(readFileSync(join(root, "vectors-src", "complete", "retired.json"), "utf8")) as { groups: Record<string, Vector[]> }).groups;
const files: VectorFile[] = [];
for (const [fam, list] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
  const group = `VC-${fam.toUpperCase()}`;
  const tombs = retiredGroups[group] ?? [];
  // a vector keeps the id it had in the committed file (matched by task, kind and occurrence); a new vector takes the next number after every id the group has used
  const existing = existingIds(group);
  const used = new Set<string>([...tombs.map((x) => x.id), ...existing.values()]);
  let next = Math.max(0, ...[...used].map((x) => Number(x.slice(x.lastIndexOf("-") + 1)))) + 1;
  const seen = new Map<string, number>();
  for (const v of list) {
    const k0 = vectorKey(v); const n = (seen.get(k0) ?? 0) + 1; seen.set(k0, n);
    v.id = existing.get(`${k0}|${n}`) ?? `${group}-${String(next++).padStart(3, "0")}`;
    if ((v.mutants ?? []).length === 0) delete v.mutants;
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  files.push({ format: "tt-conformance-vectors/0.1", group, family: "complete", clock: { start: T0 }, vectors: [...tombs, ...list] });
}
if (emitVectors.length > 0) {
  emitVectors.forEach((v, i) => { v.id = `VC-EMIT-${String(i + 1).padStart(3, "0")}`; });
  files.push({ format: "tt-conformance-vectors/0.1", group: "VC-EMIT", family: "complete", clock: { start: T0 }, vectors: emitVectors });
}
applyErrorReply(files);
labelVersionRole(files);
mkdirSync(outDir, { recursive: true });
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 1) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 2) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "Scope tasks lacking a positive vector for which none could be written (items), tasks lacking a negative vector (negativeItems) and destructive tasks whose specification examples are withheld (withheldExamples), each with the reason. A generator limit or text limit, not an implementation result.", scopeInputs: scope.inputs, items: notGenerated, negativeItems: negNotGenerated, withheldExamples: withheld }, null, 2) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} completion vectors; ${notGenerated.length} items not generated`);
