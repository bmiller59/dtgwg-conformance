// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/coverage/ (the coverage families, docs/22: layer 3a application tasks, NOT core; channel `proposed`). Run:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/generate-coverage.ts [outDir]
// One engine for the eight families (decision CV-4). Per used task version (census, vectors-src/coverage/task-census.tsv):
//   CV-<F>  probe vectors for a task VTI serves (payload schema, declared policy, a valid request is answered), registry-schema basis
//   CX-<F>  probe vectors from the task force's own invalid payload examples (independent input)
//   CE-<F>  emit vectors for a task keyring-wallet or VTI sends
// Mechanics only; no governance value is asserted. Types with no specification, retired specifications and versions whose payload the
// schema-driven builder cannot build are listed in not-generated.json, never guessed.
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDrafts, KIT, PKG } from "../src/coverage/build.ts";
import { coverageTasks } from "../src/coverage/catalog.ts";
import { COVERAGE_FAMILIES, channelFor, isDestructive, loadCensus } from "../src/coverage/families.ts";
import { cbExtraCodes } from "../src/coverage/standing.ts";
import { BEHAVIOUR_RULES, behaviourMutantId } from "../src/coverage/behaviour/index.ts";
import { alsoAcceptNote, PERMISSION_DENIED_NOTE, stateFreeNote, withActorStandIn, withCanonicalValid } from "../src/coverage/behaviour/types.ts";
import { validate } from "../src/plain/schema.ts";
import { digestPackageTask, withSpecHashes } from "../src/vectors/source.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";
import { BLOCKED, CANDIDATE_PLATFORM, CANDIDATE_TASKS, CANDIDATE_TEXT, LINKED } from "../src/coverage/candidates.ts";
import { deriveImplementedBy } from "../src/vectors/implemented-by.ts";
import { currentDigest, SUITE_ROOT } from "../src/vectors/source.ts";
import { applyPromotions, loadPromotions } from "../src/vectors/promotion.ts";
import { applyClarifyMeta, loadClarifyMeta, type ClarifyClass } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] === undefined ? join(resolve(here, ".."), "vectors", "coverage") : resolve(process.argv[2]);
const T0 = "2026-11-12T10:00:00Z";
/** Families where the valid-request probe is left out: rooms (state needed) and the two administration families (decision CV-5). */
const NO_VALID_PROBE = new Set(["RM", "AA", "CA"]);

const { tasks, skipped } = coverageTasks();
const tasksCensus = loadCensus();
const files: VectorFile[] = [];
const counts: Record<string, { probe: number; examples: number; emit: number }> = {};
for (const fam of COVERAGE_FAMILIES) {
  const mine = tasks.filter((x) => x.row.family === fam.id);
  const probe: Vector[] = [];
  const probeExtended: Vector[] = []; // versions only the extended payload builder can build: numbered after every other probe, so no issued id moves (the id ledger is append-only)
  const ex: Vector[] = [];
  const emit: Vector[] = [];
  const src = (t: (typeof mine)[number], note: string): VectorSource => {
    const ref = `pkg:@openvtc/trust-tasks@0.29.0#${t.task.typeUri}`;
    const tfRef = tfRefFor(ref);
    if (tfRef === null) throw new Error(`no Trust Tasks reference for ${ref}`);
    return withSpecHashes({ slug: t.task.slug, version: t.task.version, channel: channelFor(t.row.tfStatus), profile: "coverage", ref, pinnedDigest: digestPackageTask(t.task), tfRef,
      note: `Coverage family ${fam.id} (${fam.label}): the grouping is a suite proposal (docs/22) and advisory; the task is a Trust Tasks specification (tfRef, status ${tfRef.status}). ${note}` });
  };
  for (const t of mine) {
    const sent = t.emit;
    if (t.probe) {
      const { drafts, roles } = buildDrafts(t.task, { withA: !NO_VALID_PROBE.has(fam.id) });
      for (const d of drafts) {
        const list = d.basis === "registry-schema" ? (t.extended ? probeExtended : probe) : ex;
        const stem = d.basis === "registry-schema" ? "CV" : "CX";
        list.push({ id: `${stem}-${fam.id}-${String(list.length + 1).padStart(3, "0")}`, title: d.title, tier: 1, spec: d.spec, clarify: d.clarify, requires: [t.task.typeUri, ...(roles ? ["optional:governance.roles"] : [])], ...(d.mutants.length > 0 && t.oracle ? { mutants: d.mutants } : {}), source: src(t, d.basis === "registry-schema" ? "Evidence basis: the registry schema (not independent of the platforms' own build)." : "Evidence basis: the task force's own invalid payload examples."), steps: d.steps } as Vector);
      }
    }
    if (sent) {
      const p = t.task.requestPolicy;
      const root = t.task.payloadSchema as Record<string, unknown>;
      const mutants = ["emitBadPayload", ...(p.isProofRequired ? ["emitNoProof"] : []), ...(p.isRecipientRequired ? ["emitNoRecipient"] : []), ...(p.isIssuedAtRequired ? ["emitNoIssuedAt"] : [])];
      const canMutate = t.task.validPayload !== undefined && (Array.isArray(root["required"]) ? (root["required"] as unknown[]).length > 0 : root["additionalProperties"] === false);
      emit.push({
        id: `CE-${fam.id}-${String(emit.length + 1).padStart(3, "0")}`,
        title: `${t.task.slug} ${t.task.version}: the document the implementation emits for this task conforms to its payload schema and declared policy`, tier: 1,
        spec: [`payload schema of ${t.task.typeUri} (${PKG})`, `declared policy (${PKG}): isProofRequired=${p.isProofRequired}, isRecipientRequired=${p.isRecipientRequired}, isIssuedAtRequired=${p.isIssuedAtRequired}`, `specs/${t.task.slug}/${t.task.version}/spec.md (${KIT})`, "SPEC.md:1015, 1017 and 1137 (7.2 items 5 and 7, 7.3 item 17: a document lacking a REQUIRED recipient, proof or issuedAt is not conforming)", "Mechanics only: the suite does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5)", ...(isDestructive(t.task.slug) ? ["Destructive task: the platform is asked to build the document, nothing is sent to a service"] : [])],
        source: src(t, "Evidence basis: the registry schema (not independent of the platforms' own build)."), clarify: null, requires: ["optional:emit", `emit:${t.task.typeUri}`], ...(canMutate && t.oracle ? { mutants } : {}),
        steps: [{ emit: { type: t.task.typeUri, args: { recipient: "$X" } }, expect: { disposition: "emitted", plainType: t.task.typeUri } }],
      } as Vector);
    }
  }
  probe.push(...probeExtended.map((v, i) => ({ ...v, id: `CV-${fam.id}-${String(probe.length + i + 1).padStart(3, "0")}` })));
  // CB: behavioural rules (phase 4): a refusal the specification text states, reachable from one document, one vector per rule
  const behaviour: Vector[] = [];
  for (const r of BEHAVIOUR_RULES.filter((x) => x.family === fam.id)) {
    const found = mine.find((x) => x.task.slug === r.slug && x.task.version === r.version);
    if (found === undefined || !found.oracle || isDestructive(r.slug)) throw new Error(`behaviour rule ${r.key}: no oracle-served, non-destructive coverage task`);
    // the rules start from a valid payload whose base64url members decode (the builder's placeholders satisfy the schema's pattern but do not)
    const t = { ...found, task: withCanonicalValid(found.task) };
    const payload = r.trigger(t.task);
    if (payload === undefined) throw new Error(`behaviour rule ${r.key}: no trigger payload`);
    if (validate(t.task.payloadSchema as Record<string, unknown>, withActorStandIn(payload)).length > 0) throw new Error(`behaviour rule ${r.key}: the trigger payload is not schema-valid (it would test the schema, not the rule)`);
    if (!r.refuses(payload, t.task) || (t.task.validPayload !== undefined && r.refuses(t.task.validPayload as Record<string, unknown>, t.task))) throw new Error(`behaviour rule ${r.key}: refuses() must hold for the trigger and not for the valid payload`);
    const doc = { id: "$id(b1)", type: t.task.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", ...(r.envelope?.(t.task, payload) ?? {}), payload };
    // O-02 / O-04: the task's own standing codes, and (for a rule whose own code is a validation code, not a lookup) the lookup codes the task lists for an object the
    // request names, are refusals a conforming implementation may give first: SPEC 7.2 items 2 and 10 do not order them (src/coverage/standing.ts)
    // a retired rule is a tombstone whose expectation the seeded probe re-issues (src/coverage/probe.ts): there the object exists, so no lookup code is accepted
    const extra = cbExtraCodes(t.task, payload, r.codes, r.alsoAccept ?? [], r.retired === undefined);
    behaviour.push({
      id: `CB-${fam.id}-${String(behaviour.length + 1).padStart(3, "0")}`, title: r.title, tier: 1,
      spec: [...r.quote, `specs/${t.task.slug}/${t.task.version}/spec.md (${KIT})`, "The caller's standing is the deployment's governance: a refusal for lack of authority (permissionDenied) is accepted in place of the task's code, so no authorisation outcome is asserted", PERMISSION_DENIED_NOTE, ...(r.alsoAccept ?? []).map(alsoAcceptNote), ...extra.map((e) => e.note), ...(r.stateFree === true ? [stateFreeNote()] : []), "Evidence basis: the task force's specification text (the quoted words)"],
      source: src(t, "Evidence basis: the task force's specification text."), clarify: r.clarify ?? null, requires: [t.task.typeUri], ...(r.retired === undefined ? { mutants: [behaviourMutantId(r)] } : { retired: r.retired }),
      steps: [{ send: { document: doc }, expect: { disposition: "error", code: [...new Set([...r.codes, ...(r.alsoAccept ?? []).map((a) => a.code), ...extra.map((e) => e.code), "permissionDenied"])], noSideEffect: true } }],
    } as Vector);
  }
  if (behaviour.length > 0) files.push({ format: "tt-conformance-vectors/0.1", group: `CB-${fam.id}`, family: "coverage", clock: { start: T0 }, vectors: behaviour });
  counts[fam.id] = { probe: probe.length, examples: ex.length, emit: emit.length };
  for (const [stem, fam2, list] of [["CV", "coverage", probe], ["CX", "coverage", ex], ["CE", "coverage-emit", emit]] as const) {
    if (list.length > 0) files.push({ format: "tt-conformance-vectors/0.1", group: `${stem}-${fam.id}`, family: fam2, clock: { start: T0 }, vectors: list });
  }
}
// CC: candidate vectors (decision CV-6): a used type with no Trust Tasks specification gets a vector only where docs/24 quotes a local text.
// Mechanics only: a payload that breaks the request shape the platform's own source declares is refused; no valid request is sent.
{
  const root = resolve(here, "..");
  const implementedByRuns = deriveImplementedBy((id) => id.startsWith("CC-"));
  const counters: Record<string, number> = {};
  const byFam = new Map<string, Vector[]>();
  for (const c of CANDIDATE_TASKS) {
    const row = tasksCensus.find((r) => r.type === c.type);
    if (row === undefined || row.tfStatus !== "none") throw new Error(`candidate ${c.type}: not a census row without a Trust Tasks specification`);
    const typeUri = `https://trusttasks.org/spec/${c.type}`;
    const schema = { type: "object", required: c.required, properties: c.properties } as Record<string, unknown>;
    for (const p of c.probes) if (validate(schema, p.payload).length === 0) throw new Error(`candidate ${c.type}: probe "${p.label}" satisfies the declared shape`);
    const n = (counters[row.family] = (counters[row.family] ?? 0) + 1);
    const ref = `suite:${CANDIDATE_TEXT}`;
    const doc = (k: number, payload: unknown): Record<string, unknown> => ({ id: `$id(c${k})`, type: typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload });
    // the platform runs the capability or authority gate and the payload parse in an order docs/24 quotes; who may ask is the deployment's governance, so permissionDenied is accepted in place of malformedRequest
    const steps = c.probes.map((p, i) => ({ send: { document: doc(i + 1, p.payload) }, expect: { disposition: "error", code: ["malformedRequest", "permissionDenied"], noSideEffect: true } }));
    const list = byFam.get(row.family) ?? [];
    list.push({
      id: `CC-${row.family}-${String(n).padStart(3, "0")}`,
      title: `${c.type}: a request whose payload breaks the request shape the platform's own source declares is refused (candidate; mechanics only)`, tier: 1,
      spec: [...c.anchors.map((a) => `${CANDIDATE_TEXT}, section "${c.section}": ${a}, in ${CANDIDATE_PLATFORM}`),
        "SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type): the general consumer rule; this type has no Trust Tasks schema, so the shape checked is the one the platform's source declares for it",
        `Candidate: no Trust Tasks specification exists for ${c.type} (census tf_status none); the vector rests on ${CANDIDATE_TEXT} only and asserts nothing about what the task does or who may ask for it`,
        "Evidence basis: the platform's own source (not independent of that platform; it can only say the platform refuses what its own request struct rejects)",
        "A destructive or state-changing task: only payloads that break the declared shape are sent; no valid request is sent"],
      source: { slug: row.slug, version: row.version, channel: "candidate", ref, pinnedDigest: currentDigest(ref, { suite: SUITE_ROOT }),
        candidate: { implementedBy: [...new Set([...implementedByRuns, CANDIDATE_PLATFORM])].sort(), localText: CANDIDATE_TEXT,
          adoptionNote: "No Trust Tasks specification for this type is in the pinned registry package (census tf_status none), and the suite has filed no issue or pull request. The platform's own source lists the type as unspecified and names its intent (docs/24)." },
        note: `${c.basis}; candidate coverage vector (decision CV-6): the shape is the platform's own, quoted in docs/24; advisory, never an endorsement. implementedBy is what the quoted source shows until a recorded run of these vectors says otherwise` },
      clarify: null, requires: [typeUri], mutants: ["noPayloadValidation"], steps,
    } as Vector);
    byFam.set(row.family, list);
  }
  for (const [fam, vectors] of byFam) files.push({ format: "tt-conformance-vectors/0.1", group: `CC-${fam}`, family: "coverage", clock: { start: T0 }, vectors });
  for (const s of skipped) {
    if (s.reason !== "no-specification") continue;
    const cand = CANDIDATE_TASKS.find((c) => c.type === s.type);
    const blocked = BLOCKED.find((b) => b.type === s.type);
    const linked = LINKED.find((l) => l.type === s.type);
    if (cand !== undefined) s.candidate = `CC-${s.family}`;
    else if (blocked !== undefined) s.blockedOn = blocked.reason;
    else if (linked !== undefined) s.linkedTo = linked.where;
    else throw new Error(`${s.type}: a type with no specification has neither a candidate vector, a blocked reason nor a link (decision CV-6)`);
  }
}
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".json")) rmSync(join(outDir, f)); // no stale group file survives a regeneration
// every coverage CLARIFY vector is the same one rule (issuedAt REQUIRED, rejection and code unnamed): class spec-silent, no drafted question
const meta = loadClarifyMeta(join(here, ".."), { coverage: false });
const covMeta: Record<string, { class: ClarifyClass; since: string; questions: string[] }> = {};
for (const f of files) for (const v of f.vectors) if (v.clarify !== null) covMeta[v.id] = meta.vectors[v.id] ?? { class: "spec-silent", since: "2026-11-18", questions: [] };
applyClarifyMeta(files, { ...meta, vectors: { ...meta.vectors, ...covMeta } });
applyErrorReply(files);
labelVersionRole(files);
// promoted vectors (docs/33): the tag edit only; ids, steps and expectations do not change
const promoted = applyPromotions(files, loadPromotions(join(here, "..")));
if (promoted.length > 0) console.log(`  ${promoted.length} vector(s) promoted to the registry channel (vectors-src/promotions.json)`);
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 1) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 1) + "\n");
writeFileSync(join(outDir, "clarify-classes.json"), JSON.stringify({ format: "tt-conformance-clarify-classes/0.1", note: "Written by scripts/generate-coverage.ts: every coverage CLARIFY vector is the same one rule (issuedAt is REQUIRED; the text names neither the rejection nor its code), class spec-silent.", entries: covMeta }, null, 1) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "Used task types the generator leaves out, wholly or in part, with the reason: held elsewhere (the suite already holds that kind of vector, or the DTG family holds the single-task checks), no Trust Tasks specification (candidate work needs a local text, decision CV-6), a retired specification, a type missing from the pinned package, or a payload the schema-driven builder cannot build (none at present, docs/22). A generator or text limit, not an implementation result.", types: skipped }, null, 1) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} vectors for ${tasks.length} task versions; ${skipped.length} not generated`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v.probe} probe, ${v.examples} task-force-example, ${v.emit} emit`);
