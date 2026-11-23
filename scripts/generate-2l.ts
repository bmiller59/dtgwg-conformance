// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/2l/ (the second-layer common application profiles 2L-2 to 2L-5: layer 3a, NOT core; channel `proposed`). Run:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/generate-2l.ts [outDir]
// Every rule is read from the pinned @openvtc/trust-tasks 0.29.0 (a registry package; every registry specification is status draft) or,
// for the few task-specific refusals, from the task's specification text in the task-force checkout at origin/main 0dbc98f1c (status
// draft; error codes are not shipped in the package). The profiles themselves are the suite's own proposal (docs/19), so every vector is
// channel `proposed` and advisory. Mechanics only: no role, admission rule, retention period, authorisation outcome or policy content is
// asserted. Where a refusal could legitimately be an authorisation refusal, the vector accepts permissionDenied as well.
//   probe vectors (TL-*): a task the implementation SERVES (plain-task pattern, docs/04 section 11.7), gated on the type being declared.
//   emit vectors  (TE-*): a task the implementation SENDS (producer class, docs/04 section 11.8), gated on `emit:<type>`.
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notifyDocument, TWO_L_GROUPS, twoLTasks, UNKNOWN_ID, unknownIdPayload, type TwoLGroup } from "../src/adapters/reference/2l-catalog.ts";
import { badResponsePayload, type PlainTask } from "../src/plain/catalog.ts";
import { resolveRef, validate } from "../src/plain/schema.ts";
import { REFUSAL_CODES, REFUSAL_NOTE } from "../src/coverage/build.ts";
import { standingCodes } from "../src/coverage/standing.ts";
import { applyPromotions, loadPromotions } from "../src/vectors/promotion.ts";
import { digestPackageTask, withSpecHashes } from "../src/vectors/source.ts";
import { loadTfManifest, tfRefFor } from "../src/vectors/tfref.ts";
import type { VectorSource } from "../src/vectors/source.ts";
import type { Step, Vector, VectorFile } from "../src/vectors/types.ts";
import { applyClarifyMeta, loadClarifyMeta } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] === undefined ? join(resolve(here, ".."), "vectors", "2l") : resolve(process.argv[2]);
const T0 = "2026-11-12T10:00:00Z";
const PKG = "@openvtc/trust-tasks 0.29.0 (registry package; the specification is status draft)";
const KIT = `task-force checkout origin/main ${loadTfManifest().main.commit.slice(0, 9)} (${loadTfManifest().main.date}), specification status draft`;
const RATIONALE_GOV = "Governance is the deployment's choice, never the suite's (docs/02 section 5): this vector fixes no role name, role meaning or authority rule; a role value is taken from the adapter's declared governance.roles.";
const MECH = "Mechanics only: this vector does not assert that the request is authorised, admitted, retained or what it does (that is the deployment's governance).";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

function tokenizeRoles(v: unknown, used: { n: boolean }): unknown {
  if (Array.isArray(v)) return v.map((x) => tokenizeRoles(x, used));
  if (!isObj(v)) return v;
  const o: J = {};
  for (const [k, x] of Object.entries(v)) {
    if ((k === "role" || k === "fromRole") && typeof x === "string") { o[k] = "$role(0)"; used.n = true; }
    else if (k === "toRole" && typeof x === "string") { o[k] = "$role(1)"; used.n = true; }
    else if (k === "roles" && Array.isArray(x)) { o[k] = x.map(() => "$role(0)"); used.n = true; }
    else o[k] = tokenizeRoles(x, used);
  }
  return o;
}

/** Absolute instants inside a payload (a forwarded document's issuedAt, proof.created, a validity bound) become clock-relative tokens, so the vector runs where the clock cannot be set (rebase mode). */
function relativize(v: unknown, key = ""): unknown {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return key === "issuedAt" || key === "created" ? "$now+0s" : "$now+1h";
  if (Array.isArray(v)) return v.map((x) => relativize(x, key));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relativize(x, k)]));
  return v;
}

function simpleType(root: J, s: unknown): string | undefined {
  if (!isObj(s)) return undefined;
  const t = typeof s["$ref"] === "string" ? resolveRef(root, s["$ref"]) : s;
  return isObj(t) && typeof t["type"] === "string" ? t["type"] : undefined;
}
const WRONG: Record<string, unknown> = { string: 5, object: "x", array: "x", boolean: "x", integer: "x", number: "x" };

const policyLine = (t: PlainTask): string => `declared policy: ${t.typeUri} (${PKG}), isProofRequired=${t.requestPolicy.isProofRequired}, isRecipientRequired=${t.requestPolicy.isRecipientRequired}, isIssuedAtRequired=${t.requestPolicy.isIssuedAtRequired}`;
const kitLine = (t: PlainTask): string => `specs/${t.slug}/${t.version}/spec.md (${KIT})`;

function sourceOf(t: PlainTask, g: TwoLGroup, extra?: string): VectorSource {
  const ref = `pkg:@openvtc/trust-tasks@0.29.0#${t.typeUri}`;
  const tfRef = tfRefFor(ref);
  if (tfRef === null) throw new Error(`no Trust Tasks reference for ${ref}`);
  return withSpecHashes({
    slug: t.slug, version: t.version, channel: "proposed", profile: "2L", ref, pinnedDigest: digestPackageTask(t), tfRef,
    note: `2L profile ${g.profile} member: the profile grouping is a suite proposal (docs/19) and advisory; the task itself is a Trust Tasks registry specification (tfRef, status ${tfRef.status}).${g.vtiNamed === true ? " VTI-named slug (vta/ or vtc/), not a generic registry slug." : ""}${g.note !== undefined ? ` ${g.note}.` : ""}${extra === undefined ? "" : ` ${extra}`}`,
  });
}

interface Draft { title: string; spec: string[]; clarify: string | null; steps: Step[]; mutants: string[]; extraRequires?: string[] }

function probeDrafts(t: PlainTask): { drafts: Draft[]; roles: boolean } {
  const used = { n: false };
  let payload = relativize(tokenizeRoles(t.validPayload, used)) as J;
  // a relay's forwarded document is addressed to the relayer (the issuer, $A): notifications/relay 0.1 producer item 1
  if (t.slug === "notifications/relay") payload = { ...payload, forwarded: { ...(payload["forwarded"] as J), recipient: "$A" } };
  const gov = used.n ? [RATIONALE_GOV] : [];
  const doc = (n: string, over: J = {}, pl: J = payload): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl, ...over });
  const refuse = (document: J, code: string | string[], sign?: null): Step => ({ send: { document, ...(sign === null ? { sign: null } : {}) }, expect: { disposition: "error", code, noSideEffect: true } });
  const label = `${t.slug} ${t.version}`;
  const served = t.responseSchema === undefined || t.validResponse !== undefined;
  const root = t.payloadSchema as J;
  const out: Draft[] = [];

  // O-02: the task's own standing codes are refusals a consumer may give before it reads the payload (src/coverage/standing.ts)
  const codesFor = (pl: unknown): string[] => [...REFUSAL_CODES, ...standingCodes(t.typeUri, t.payloadSchema, pl)];
  const pSteps: Step[] = [];
  const pMut = new Set<string>();
  const req0 = Array.isArray(root["required"]) ? (root["required"] as string[])[0] : undefined;
  if (req0 !== undefined) {
    const { [req0]: _x, ...rest } = payload;
    pSteps.push(refuse(doc("p1", {}, rest), codesFor(rest))); pMut.add("noPayloadValidation");
  }
  if (root["additionalProperties"] === false) { pSteps.push(refuse(doc("p2", {}, { ...payload, conformanceUnknownMember: true }), codesFor(payload))); pMut.add("openPayload"); }
  const props = isObj(root["properties"]) ? root["properties"] : {};
  const wrongKey = Object.keys(payload).find((k) => k in props && WRONG[simpleType(root, props[k]) ?? ""] !== undefined && !(typeof payload[k] === "string" && String(payload[k]).startsWith("$role")));
  if (wrongKey !== undefined) { pSteps.push(refuse(doc("p3", {}, { ...payload, [wrongKey]: WRONG[simpleType(root, props[wrongKey])!] }), codesFor(payload))); pMut.add("noPayloadValidation"); }
  if (pSteps.length > 0) {
    out.push({ title: `${label}: the payload is validated against the task's payload schema (${[req0 !== undefined ? `missing required member ${req0}` : "", root["additionalProperties"] === false ? "unknown member in a closed payload" : "", wrongKey !== undefined ? `wrong type for ${wrongKey}` : ""].filter((x) => x !== "").join("; ")})`,
      spec: ["SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; framework SPEC.md status draft, dtgwg-trust-tasks-spec e392d70, spec/body.md:758)", `payload schema of ${t.typeUri} (${PKG}): required ${JSON.stringify(root["required"] ?? [])}, additionalProperties ${JSON.stringify(root["additionalProperties"])}`, kitLine(t), REFUSAL_NOTE, ...gov], clarify: null, steps: pSteps, mutants: [...pMut] });
  }

  const eSteps: Step[] = [];
  const eMut = new Set<string>();
  if (t.requestPolicy.isRecipientRequired) { const { recipient: _r, ...noRecipient } = doc("e1"); eSteps.push(refuse(noRecipient, "malformedRequest")); eMut.add("recipientOptional"); }
  if (t.requestPolicy.isProofRequired) { eSteps.push(refuse(doc("e2"), "proofRequired", null)); eMut.add("proofOptional"); }
  if (eSteps.length > 0) {
    out.push({ title: `${label}: the policy the specification declares is enforced (${[t.requestPolicy.isRecipientRequired ? "recipient REQUIRED" : "", t.requestPolicy.isProofRequired ? "proof REQUIRED" : ""].filter((x) => x !== "").join(", ")})`,
      spec: ["SPEC.md:1015 (7.2 item 5: a document lacking an in-band recipient the specification declares REQUIRED is rejected with malformedRequest; spec/body.md:761)", "SPEC.md:1017 (7.2 item 7: proof declared REQUIRED and absent is rejected with proofRequired; spec/body.md:763)", policyLine(t), kitLine(t), ...gov], clarify: null, steps: eSteps, mutants: [...eMut] });
  }

  if (t.requestPolicy.isIssuedAtRequired) {
    const { issuedAt: _i, ...noIssuedAt } = doc("i1");
    out.push({ title: `${label}: a request without issuedAt is not executed (issuedAt REQUIRED by the specification)`,
      spec: ["SPEC.md:1137 (7.3 item 17: a consequential task's specification MUST require issuedAt; spec/body.md:864)", policyLine(t), kitLine(t), ...gov],
      clarify: "The text makes issuedAt a MUST of the specification but no consumer rule names the rejection or its code (inference: the pinned runtime enforceSpecPolicy rejects with malformedRequest). Any refusal or silence with no side effect is accepted. Not gating.",
      steps: [{ send: { document: noIssuedAt }, expect: { disposition: "any-refusal", noSideEffect: true } }], mutants: ["noFreshnessWindow"] });
  }

  if (served) {
    out.push({ title: `${label}: a schema-valid, signed, addressed request is not refused for an envelope reason, and any response conforms to the response schema`,
      spec: ["SPEC.md:1011-1023 (7.2 consumer rules 1-13: none of the rejection grounds applies to this request, so a refusal must not carry their codes, section 8.3)", "SPEC.md 4.4.1 (the reply dispositions) and 7.1 item 3 (a response payload validates against the schema of its type)", "SPEC.md:246, :1069 (a consumer MAY require its own ext namespace and then rejects a document lacking it with malformedRequest) and SPEC.md:388 (MAY reject a non-canonical VID-typed member with malformedRequest): where the payload schema admits ext, a malformedRequest here is recorded as a note and is not escalated on the attested profile", `payload and response schemas of ${t.typeUri} (${PKG})`, ...(t.responseSchema === undefined ? ["the version declares no response variant: silence is accepted"] : [`response type ${t.responseTypeUri}`]), kitLine(t), MECH, ...gov],
      clarify: null, steps: [{ send: { document: doc("a1") }, expect: { disposition: "answered", plainType: t.typeUri } }], mutants: badResponsePayload(t) !== undefined ? ["plainBadResponse"] : [] });
  }
  return { drafts: out, roles: used.n };
}

function mechanicsDrafts(t: PlainTask): Draft[] {
  const out: Draft[] = [];
  const doc = (n: string, pl: J): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl });
  if (t.slug === "notifications/relay") {
    const notExpected = relativize({ ...notifyDocument("$A"), type: "https://trusttasks.org/spec/device/list/0.3" });
    const notAddressed = relativize(notifyDocument("did:web:conformance-another-party.example"));
    out.push({
      title: `${t.slug} ${t.version}: a relay whose forwarded layers are not a chain of notify and relay documents each addressed to the relayer carrying it is refused with chainInvalid`,
      spec: [`${kitLine(t)}: errorCodes notifications/relay:chainInvalid ("a layer of the relay does not hold: ... a forwarded document is not addressed to the issuer of the relay carrying it, the innermost document is not a notification ..."); consumer item 2 ("refuses a relay that fails any of these ... with notifications/relay:chainInvalid, and holds nothing of it")`, "producer item 1: the relayer relays only a document addressed to it, carried in forwarded exactly as received", "The harness checks the refusal and its code only; the proofs inside the chain are not asserted (a relayer's acceptance policy is the deployment's governance)", MECH],
      clarify: null,
      steps: [
        { send: { document: doc("m1", { forwarded: notExpected }) }, expect: { disposition: "error", code: "notifications/relay:chainInvalid", noSideEffect: true } },
        { send: { document: doc("m2", { forwarded: notAddressed }) }, expect: { disposition: "error", code: "notifications/relay:chainInvalid", noSideEffect: true } },
      ],
      mutants: ["relayChainUnchecked"],
    });
  }
  if (t.slug === "audit/list") {
    const cursor = "conformance-cursor-this-maintainer-never-issued";
    if (validate(t.payloadSchema as J, { cursor }).length === 0) {
      out.push({
        title: `${t.slug} ${t.version}: a cursor the maintainer did not issue is refused, never answered with entries`,
        spec: [`${kitLine(t)}: errorCodes audit/list:invalidCursor ("The supplied cursor failed to verify ... The consumer restarts from the first page rather than retrying"); Paging ("a maintainer MUST NOT accept a cursor it did not issue")`, "The audit-read gate is the deployment's governance: a refusal for lack of the audit-read capability (permissionDenied) is accepted in place of invalidCursor, so no authorisation outcome is asserted", MECH],
        clarify: null,
        steps: [{ send: { document: doc("m1", { cursor }) }, expect: { disposition: "error", code: ["audit/list:invalidCursor", "permissionDenied", ...standingCodes(t.typeUri, t.payloadSchema, { cursor })], noSideEffect: true } }],
        mutants: ["auditCursorAccepted"],
      });
    }
  }
  const u = UNKNOWN_ID[t.slug];
  if (u !== undefined) {
    const built = unknownIdPayload(t, u.member);
    if (built !== undefined) {
      out.push({
        title: `${t.slug} ${t.version}: an identifier that names nothing is refused with the task's not-found code, never answered with a success`,
        spec: [`${kitLine(t)}: errorCodes ${u.code}`, "The caller's standing is the deployment's governance: a refusal for lack of authority (permissionDenied) is accepted in place of the not-found code, so no authorisation outcome is asserted", MECH],
        clarify: null,
        steps: [{ send: { document: doc("m1", built.payload) }, expect: { disposition: "error", code: [u.code, "permissionDenied", ...standingCodes(t.typeUri, t.payloadSchema, built.payload)], noSideEffect: true } }],
        mutants: ["unknownIdAccepted"],
      });
    }
  }
  return out;
}

const all = twoLTasks();
const tasks = all.filter((t) => t.validPayload !== undefined);
const files: VectorFile[] = [];
const notGenerated = all.filter((t) => t.validPayload === undefined).map((t) => t.typeUri);
const counts: Record<string, { probe: number; emit: number }> = {};
for (const g of TWO_L_GROUPS) {
  const probe: Vector[] = [];
  const emit: Vector[] = [];
  let np = 1;
  let ne = 1;
  for (const t of tasks.filter((x) => g.slugs.includes(x.slug))) {
    const { drafts, roles } = probeDrafts(t);
    const content = [t.typeUri, ...(roles ? ["optional:governance.roles"] : [])];
    for (const d of [...drafts, ...mechanicsDrafts(t).map((m) => ({ ...m }))]) {
      const v: Vector = { id: `TL-${g.stem}-${String(np++).padStart(3, "0")}`, title: d.title, tier: 1, spec: d.spec, clarify: d.clarify, requires: content, ...(d.mutants.length > 0 ? { mutants: d.mutants } : {}), steps: d.steps } as Vector;
      probe.push({ ...v, source: sourceOf(t, g) } as Vector);
    }
    const p = t.requestPolicy;
    const root = t.payloadSchema as J;
    const mutants = ["emitBadPayload", ...(p.isProofRequired ? ["emitNoProof"] : []), ...(p.isRecipientRequired ? ["emitNoRecipient"] : []), ...(p.isIssuedAtRequired ? ["emitNoIssuedAt"] : [])];
    const canMutate = Array.isArray(root["required"]) ? (root["required"] as unknown[]).length > 0 : root["additionalProperties"] === false;
    emit.push({
      id: `TE-${g.stem}-${String(ne++).padStart(3, "0")}`,
      title: `${t.slug} ${t.version}: the document the implementation emits for this task conforms to its payload schema and declared policy`, tier: 1,
      spec: [`payload schema of ${t.typeUri} (${PKG})`, policyLine(t), kitLine(t), "SPEC.md:1015, 1017 and 1137 (7.2 items 5 and 7, 7.3 item 17: a document lacking a REQUIRED recipient, proof or issuedAt is not conforming); SPEC.md 7.2 item 8 (a proof with no recipient on a non-bearer task is malformed)", "Mechanics only: the suite does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5)"],
      source: sourceOf(t, g), clarify: null, requires: ["optional:emit", `emit:${t.typeUri}`], ...(canMutate ? { mutants } : {}),
      steps: [{ emit: { type: t.typeUri, args: { recipient: "$X" } }, expect: { disposition: "emitted", plainType: t.typeUri } }],
    } as Vector);
  }
  counts[g.stem] = { probe: probe.length, emit: emit.length };
  if (probe.length > 0) files.push({ format: "tt-conformance-vectors/0.1", group: `TL-${g.stem}`, family: "2l", clock: { start: T0 }, vectors: probe });
  if (emit.length > 0) files.push({ format: "tt-conformance-vectors/0.1", group: `TE-${g.stem}`, family: "2l-emit", clock: { start: T0 }, vectors: emit });
}
mkdirSync(outDir, { recursive: true });
applyClarifyMeta(files, loadClarifyMeta(join(here, "..")));
applyErrorReply(files);
labelVersionRole(files);
// promoted vectors (docs/33): the tag edit only; ids, steps and expectations do not change
const promoted = applyPromotions(files, loadPromotions(join(here, "..")));
if (promoted.length > 0) console.log(`  ${promoted.length} vector(s) promoted to the registry channel (vectors-src/promotions.json)`);
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 2) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 2) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "2L task versions for which the schema-driven generator could not build a minimal valid request payload and no override exists; no vector is generated for them (a generator limit, not an implementation result).", types: notGenerated }, null, 2) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} vectors for ${tasks.length} task versions; ${notGenerated.length} versions without a buildable payload`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v.probe} probe, ${v.emit} emit`);
