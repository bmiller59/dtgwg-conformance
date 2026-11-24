// SPDX-License-Identifier: Apache-2.0
// Draft vectors for one coverage task version (docs/22). Mechanics only, every rule read from the pinned @openvtc/trust-tasks package
// (registry schema: NOT independent evidence of that schema) or from the task force's own invalid examples (independent input).
// No role, authority rule or policy content is asserted; a role value is the token $role(n).
import { badResponsePayload, type PlainTask } from "../plain/catalog.ts";
import { resolveRef, validate } from "../plain/schema.ts";
import type { Step } from "../vectors/types.ts";
import { fileURLToPath } from "node:url";
import { isDestructive, loadInvalidExamples } from "./families.ts";
import { loadTaskFacts, stateCodes } from "./reachable.ts";
import { standingCodes, standingNote as standingNoteOf } from "./standing.ts";
import { loadTfManifest } from "../vectors/tfref.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
export const PKG = "@openvtc/trust-tasks 0.29.0 (registry package; the specification is status draft)";
export const KIT = `task-force repository origin/main ${loadTfManifest().main.commit.slice(0, 9)}, specification status draft`;
const GOV = "Governance is the deployment's choice, never the suite's (docs/02 section 5): this vector fixes no role name, role meaning or authority rule; a role value is taken from the adapter's declared governance.roles.";
const MECH = "Mechanics only: this vector does not assert that the request is authorised or what it does (that is the deployment's governance).";
const WRONG: Record<string, unknown> = { string: 5, object: "x", array: "x", boolean: "x", integer: "x", number: "x" };

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

/**
 * The codes a payload probe accepts as a refusal. SPEC.md 7.2 lists "validate the payload" (item 2) and "evaluate whatever authorization
 * requirements apply" before executing (item 10) without ordering the two, and 8.3 gives `permissionDenied` for a requester who is not authorised.
 * A consumer may therefore refuse a schema-invalid document for authority (or, as the backup tasks' Channel requirement says, for the channel it
 * arrived on) before it reads the payload: governance is the deployment's, never the suite's (docs/02 section 5), as the 2L rule already holds.
 * NOT accepted: `taskFailed` or a task's not-found code from an object lookup. A consumer that acts on a schema-invalid payload and fails later
 * on a missing object has not validated it (item 2 is a MUST), and the reference's own `noPayloadValidation` mutant answers exactly so.
 */
export const REFUSAL_CODES = ["malformedRequest", "permissionDenied"];
export const REFUSAL_NOTE = "SPEC.md 7.2 items 2 and 10 do not order payload validation against the authorisation decision, and 8.3 gives permissionDenied for a requester who is not authorised, so this vector accepts malformedRequest, permissionDenied or (where the task's front matter names one) the task's own standing code, and fixes no check order. An answer from an object lookup (taskFailed, a not-found code) is not accepted: it is what a consumer that never validated the payload gives (7.2 item 2 is a MUST). noSideEffect still holds.";
/** A refusal the task's own specification states for the very condition an example breaks (the example's note starts with `note`): accepted beside the two above. */
export const DOCUMENTED_REFUSALS: Record<string, { note: string; code: string; quote: string }[]> = {
  "vtc/admin/invites/create 0.2": [{ note: "`ttlSeconds` is capped at 24 hours.", code: "vtc/admin/invites/create:ttlTooLong", quote: "**MUST** refuse a `ttlSeconds` over the 24-hour maximum with `ttlTooLong`" }],
};

let factsCache: ReturnType<typeof loadTaskFacts> | undefined;
const taskFacts = (): ReturnType<typeof loadTaskFacts> => (factsCache ??= loadTaskFacts(fileURLToPath(new URL("../..", import.meta.url))));

export interface Draft { title: string; spec: string[]; clarify: string | null; steps: Step[]; mutants: string[]; basis: "registry-schema" | "task-force-invalid-examples" }
export interface Built { drafts: Draft[]; roles: boolean; droppedExamples: number }

/** `withA`: also build the valid-request probe (omitted for rooms, administration and destructive tasks: state is needed or the task changes state). */
export function buildDrafts(t: PlainTask, opts: { withA: boolean }): Built {
  const buildable = t.validPayload !== undefined;
  const destructive = isDestructive(t.slug);
  const used = { n: false };
  const payload = (buildable ? relativize(tokenizeRoles(t.validPayload, used)) : {}) as J;
  const gov = used.n ? [GOV] : [];
  const doc = (n: string, over: J = {}, pl: unknown = payload): J => ({ id: `$id(${n})`, type: t.typeUri, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: pl, ...over });
  const refuse = (document: J, code: string | string[], sign?: null): Step => ({ send: { document, ...(sign === null ? { sign: null } : {}) }, expect: { disposition: "error", code, noSideEffect: true } });
  const label = `${t.slug} ${t.version}`;
  const kit = `specs/${t.slug}/${t.version}/spec.md (${KIT})`;
  const root = t.payloadSchema as J;
  const drafts: Draft[] = [];
  const ex0 = loadInvalidExamples().examples[`${t.slug}/${t.version}`] ?? [];
  // the backup family's Channel requirement: a task that carries the password is refused with permissionDenied over any non-confidential channel (the HTTPS door is one)
  const channelNote = /^(vtc\/)?backup\/(initiate-export|initiate-import|finalize-import|export)$/.test(t.slug) ? [`specs/${t.slug}/${t.version}/spec.md "when it arrives over any other channel. It refuses after establishing entitlement and before" (the Channel requirement: a recipient MUST refuse with permissionDenied). A vector carried over a binding that is not end-to-end confidential therefore meets permissionDenied, whatever the payload says.`] : [];
  const clampNote = ex0.some((e) => e.clamped === true) ? [`specs/${t.slug}/${t.version}/spec.md says the task clamps \`limit\` ("clamped to"): a request whose \`limit\` is above the maximum is served with the clamped page, so that step accepts the response or a refusal. The payload schema states that same value as its \`maximum\`, so the request is schema-invalid as well (SPEC.md 7.2 item 2 is a MUST): the text conflicts with itself and does not say whether a consumer validates or clamps. Spec-open (class C, O-17), recorded only, nothing filed; the step therefore asserts neither outcome, and a consumer that answers success without clamping is not caught by it.`] : [];
  const fact = taskFacts().get(t.typeUri);
  // O-02: the task's own standing codes (front matter errorCodes that say the caller lacks standing) are accepted on every payload negative, beside
  // malformedRequest and permissionDenied: SPEC.md 7.2 items 2 and 10 do not order the two checks. An object lookup or state code is never accepted here,
  // and the reference oracle's `noPayloadValidation` mutant answers success (not a standing code) so it is still caught (src/adapters/reference).
  const standingOf = (pl: unknown): string[] => standingCodes(t.typeUri, root, pl);
  const codesFor = (pl: unknown): string[] => [...REFUSAL_CODES, ...standingOf(pl)];
  const standingAll = [...new Set([buildable ? payload : {}, ...ex0.map((e) => e.payload)].flatMap((pl) => standingOf(pl)))];
  const standingNote = standingNoteOf(`${t.slug}/${t.version}`, standingAll);
  const safe = destructive ? ["Destructive task: only payloads that fail the schema are sent (nothing is sent that could be executed)."] : [];

  // P: payload schema
  const pSteps: Step[] = [];
  const pMut = new Set<string>();
  const req0 = Array.isArray(root["required"]) ? (root["required"] as string[])[0] : undefined;
  if (buildable && req0 !== undefined && isObj(payload)) { const { [req0]: _x, ...rest } = payload; pSteps.push(refuse(doc("p1", {}, rest), codesFor(rest))); pMut.add("noPayloadValidation"); }
  if (buildable && !destructive && root["additionalProperties"] === false) { pSteps.push(refuse(doc("p2", {}, { ...payload, conformanceUnknownMember: true }), codesFor(payload))); pMut.add("openPayload"); }
  const props = isObj(root["properties"]) ? root["properties"] : {};
  const wrongKey = !buildable ? undefined : Object.keys(payload).find((k) => k in props && WRONG[simpleType(root, props[k]) ?? ""] !== undefined && !(typeof payload[k] === "string" && String(payload[k]).startsWith("$role")));
  if (wrongKey !== undefined) { pSteps.push(refuse(doc("p3", {}, { ...payload, [wrongKey]: WRONG[simpleType(root, props[wrongKey])!] }), codesFor(payload))); pMut.add("noPayloadValidation"); }
  if (pSteps.length > 0) {
    drafts.push({ title: `${label}: the payload is validated against the task's payload schema`, basis: "registry-schema",
      spec: ["SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type; framework SPEC.md status draft, dtgwg-trust-tasks-spec e392d70, spec/body.md:758)", `payload schema of ${t.typeUri} (${PKG}): required ${JSON.stringify(root["required"] ?? [])}, additionalProperties ${JSON.stringify(root["additionalProperties"])}`, kit, "Built from the registry schema the platforms also build against: not independent evidence of that schema", REFUSAL_NOTE, ...standingNote, ...channelNote, ...safe, ...gov], clarify: null, steps: pSteps, mutants: [...pMut] });
  }

  // X: the task force's own invalid examples (independent input), each checked invalid against the package schema before use
  let dropped = 0;
  const ex = loadInvalidExamples().examples[`${t.slug}/${t.version}`] ?? [];
  const xSteps: Step[] = [];
  const docNote: string[] = [];
  const stateNotes: string[] = [];
  const rewrittenSteps: number[] = [];
  ex.forEach((e, i) => {
    const local = { n: false };
    const pl = relativize(tokenizeRoles(e.payload, local));
    // O-15: an RFC 3339 literal of the example is rewritten to a `$now` offset (a fixed date would be stale at run time); the cite says where
    if (JSON.stringify(pl) !== JSON.stringify(tokenizeRoles(e.payload, { n: false }))) rewrittenSteps.push(xSteps.length + 1);
    // an example that carries a role value is left out: its invalidity may rest on that value, and no vector fixes a role value
    // a response entry (`variant: response`) is an invalid reply: it is never sent as a request (src/plain/invalid-examples.ts)
    if (e.variant === "response" || local.n || validate(root, e.payload as J).length === 0) { dropped++; return; }
    if (!isObj(pl) && !Array.isArray(pl)) { dropped++; return; }
    const documented = (DOCUMENTED_REFUSALS[label] ?? []).filter((d) => e.note.startsWith(d.note));
    const codes = [...codesFor(pl), ...documented.map((d) => d.code)];
    docNote.push(...documented.map((d) => `specs/${t.slug}/${t.version}/spec.md: "${d.quote}": step ${xSteps.length + 1} also accepts ${d.code}`));
    // R-01 for the step that expects the task's own response: any other front-matter code the request can draw (a member that never exists: notFound) is accepted too
    const drawn = e.clamped === true && fact !== undefined ? stateCodes(fact, root, pl).filter((c) => c.reachable && !codes.includes(c.code)).map((c) => c.code) : [];
    if (drawn.length > 0) stateNotes.push(`specs/${t.slug}/${t.version}/spec.md front matter errorCodes: ${drawn.join(", ")} (reachable for this request, depending on state): step ${xSteps.length + 1} also accepts it`);
    xSteps.push(e.clamped === true
      ? { send: { document: doc(`x${i + 1}`, {}, pl) }, expect: { disposition: "response", type: `${t.typeUri}#response`, orRefusal: [...codes, ...drawn], noSideEffect: true } }
      : refuse(doc(`x${i + 1}`, {}, pl), codes));
  });
  if (xSteps.length > 0) {
    drafts.push({ title: `${label}: the payloads the task force lists as invalid for this task are refused`, basis: "task-force-invalid-examples",
      spec: [`payload.invalid-examples.json of ${t.slug} ${t.version} (${KIT}): ${xSteps.length} example(s) that the payload schema also rejects`, "SPEC.md:1012 (7.2 item 2: validate the payload against the schema of the type)", kit, "The examples are the task force's own text, not derived from the registry schema", REFUSAL_NOTE, ...standingNote, ...docNote, ...stateNotes, ...(rewrittenSteps.length === 0 ? [] : [`The example payloads are copied verbatim except their RFC 3339 timestamps, which are rewritten to offsets from the run clock ($now) so a fixed date is never stale at run time: step${rewrittenSteps.length === 1 ? "" : "s"} ${rewrittenSteps.join(", ")}.`]), ...channelNote, ...clampNote, ...safe], clarify: null, steps: xSteps, mutants: ["noPayloadValidation"] });
  }

  // E: declared policy (not for a destructive task: its request would otherwise carry a valid payload)
  if (buildable && !destructive) {
    const eSteps: Step[] = [];
    const eMut = new Set<string>();
    if (t.requestPolicy.isRecipientRequired) { const { recipient: _r, ...noRecipient } = doc("e1"); eSteps.push(refuse(noRecipient, "malformedRequest")); eMut.add("recipientOptional"); }
    if (t.requestPolicy.isProofRequired) { eSteps.push(refuse(doc("e2"), "proofRequired", null)); eMut.add("proofOptional"); }
    if (eSteps.length > 0) {
      drafts.push({ title: `${label}: the policy the specification declares is enforced (${[t.requestPolicy.isRecipientRequired ? "recipient REQUIRED" : "", t.requestPolicy.isProofRequired ? "proof REQUIRED" : ""].filter((x) => x !== "").join(", ")})`, basis: "registry-schema",
        spec: ["SPEC.md:1015 (7.2 item 5: a document lacking an in-band recipient the specification declares REQUIRED is rejected with malformedRequest; spec/body.md:761)", "SPEC.md:1017 (7.2 item 7: proof declared REQUIRED and absent is rejected with proofRequired; spec/body.md:763)", `declared policy: ${t.typeUri} (${PKG}), isProofRequired=${t.requestPolicy.isProofRequired}, isRecipientRequired=${t.requestPolicy.isRecipientRequired}, isIssuedAtRequired=${t.requestPolicy.isIssuedAtRequired}`, kit, ...gov], clarify: null, steps: eSteps, mutants: [...eMut] });
    }
    if (t.requestPolicy.isIssuedAtRequired) {
      const { issuedAt: _i, ...noIssuedAt } = doc("i1");
      drafts.push({ title: `${label}: a request without issuedAt is not executed (issuedAt REQUIRED by the specification)`, basis: "registry-schema",
        spec: ["SPEC.md:1137 (7.3 item 17: a consequential task's specification MUST require issuedAt; spec/body.md:864)", kit, ...gov],
        clarify: "The text makes issuedAt a MUST of the specification but no consumer rule names the rejection or its code. Any refusal or silence with no side effect is accepted. Not gating.",
        steps: [{ send: { document: noIssuedAt }, expect: { disposition: "any-refusal", noSideEffect: true } }], mutants: ["noFreshnessWindow"] });
    }
  }

  // A: a valid request is answered conformingly
  const served = t.responseSchema === undefined || t.validResponse !== undefined;
  if (buildable && opts.withA && !destructive && served) {
    drafts.push({ title: `${label}: a schema-valid, signed, addressed request is not refused for an envelope reason, and any response conforms to the response schema`, basis: "registry-schema",
      spec: ["SPEC.md:1011-1023 (7.2 consumer rules 1-13: none of the rejection grounds applies to this request, so a refusal must not carry their codes, section 8.3)", "SPEC.md 4.4.1 (the reply dispositions) and 7.1 item 3 (a response payload validates against the schema of its type)", "SPEC.md:246, :1069 (a consumer MAY require its own ext namespace and then rejects a document lacking it with malformedRequest): where the payload schema admits ext, a malformedRequest here is recorded as a note", `payload and response schemas of ${t.typeUri} (${PKG})`, kit, MECH, ...gov],
      clarify: null, steps: [{ send: { document: doc("a1") }, expect: { disposition: "answered", plainType: t.typeUri } }], mutants: badResponsePayload(t) !== undefined ? ["plainBadResponse"] : [] });
  }
  return { drafts, roles: used.n, droppedExamples: dropped };
}
