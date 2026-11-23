// SPDX-License-Identifier: Apache-2.0
// Reference verifier of `trust-ceremony-receipt` 0.1: the verifier rules of specs/trust-ceremony-receipt/0.1/spec.md:126-138 (rules 1 to 11),
// over data the verifier is given (the receipt, the resolved definition, the enactment's role bindings, the step documents it holds). It
// returns a verdict (`ReceiptOutcome`); the specification defines no wire output for it. Behaviour the specification leaves open is marked
// `OPEN` below and is what the CLARIFY vectors of group RCPT observe. A mutant (src/adapters/reference/mutants.ts) switches one rule off.
import type { ReceiptOutcome, VerifyReceiptParams, VerifyReceiptResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { verifyDocumentProof } from "../../crypto/proof.ts";
import { MULTIHASH, parseDigest, sameDigest, stepDigest } from "../../crypto/stepdigest.ts";
import type { HashName } from "../../crypto/stepdigest.ts";
import { isObject } from "../../util/json.ts";

export const RECEIPT_TYPE = "https://trusttasks.org/spec/trust-ceremony-receipt/0.1";
const DIGEST = /^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$/;
const EXT_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

/** Validate a receipt payload against specs/trust-ceremony-receipt/0.1/payload.schema.json (closed, required members, types, bounds). */
export function validateReceiptPayload(payload: unknown): string[] {
  const errs: string[] = [];
  if (!isObject(payload)) return ["payload must be an object"];
  const top = ["enactment", "parentEnactment", "definition", "definitionDigest", "complete", "salt", "steps", "ext"];
  for (const k of Object.keys(payload)) if (!top.includes(k)) errs.push(`unknown member ${k}`);
  for (const k of ["enactment", "definition", "definitionDigest", "complete", "steps"]) if (!(k in payload)) errs.push(`missing ${k}`);
  const str = (k: string, o: Record<string, unknown>, min = 1): void => {
    if (k in o && (typeof o[k] !== "string" || (o[k] as string).length < min)) errs.push(`${k} must be a string of at least ${min} characters`);
  };
  str("enactment", payload);
  str("parentEnactment", payload);
  str("definition", payload);
  if (typeof payload.definition === "string" && !URI.test(payload.definition)) errs.push("definition must be a URI");
  str("salt", payload, 22);
  if ("definitionDigest" in payload && (typeof payload.definitionDigest !== "string" || payload.definitionDigest.length < 16 || !DIGEST.test(payload.definitionDigest))) errs.push("definitionDigest must be a multibase multihash");
  if ("complete" in payload && typeof payload.complete !== "boolean") errs.push("complete must be a boolean");
  if ("ext" in payload && (!isObject(payload.ext) || Object.keys(payload.ext).length === 0 || Object.keys(payload.ext).some((k) => !EXT_KEY.test(k)))) errs.push("ext keys must be reverse-DNS namespaces");
  if ("steps" in payload) {
    if (!Array.isArray(payload.steps) || payload.steps.length < 1) errs.push("steps must have at least one entry");
    else {
      const members = ["step", "round", "typeUri", "issuer", "id", "digestMultibase", "terminal"];
      payload.steps.forEach((s: unknown, i: number) => {
        if (!isObject(s)) return void errs.push(`steps[${i}] must be an object`);
        for (const k of Object.keys(s)) if (!members.includes(k)) errs.push(`steps[${i}]: unknown member ${k}`);
        for (const k of ["step", "typeUri", "issuer", "id", "digestMultibase"]) if (!(k in s)) errs.push(`steps[${i}]: missing ${k}`);
        for (const k of ["step", "issuer", "id"]) if (k in s && (typeof s[k] !== "string" || s[k] === "")) errs.push(`steps[${i}].${k} must be a non-empty string`);
        if ("typeUri" in s && (typeof s.typeUri !== "string" || !URI.test(s.typeUri))) errs.push(`steps[${i}].typeUri must be a URI`);
        if ("digestMultibase" in s && (typeof s.digestMultibase !== "string" || s.digestMultibase.length < 16 || !DIGEST.test(s.digestMultibase))) errs.push(`steps[${i}].digestMultibase must be a multibase multihash`);
        if ("round" in s && (!Number.isInteger(s.round) || (s.round as number) < 1)) errs.push(`steps[${i}].round must be an integer of at least 1`);
        if ("terminal" in s && typeof s.terminal !== "boolean") errs.push(`steps[${i}].terminal must be a boolean`);
      });
    }
  }
  return errs;
}

interface StepEntry {
  step: string;
  round: number;
  typeUri: string;
  issuer: string;
  id: string;
  digestMultibase: string;
  terminal: boolean;
}

function payload0(doc: Record<string, unknown>): Record<string, unknown> {
  return isObject(doc.payload) ? doc.payload : {};
}

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the completion predicate (registry closed combinators: a step name, allOf, anyOf, threshold) holds over the present step instances. */
function satisfied(p: unknown, present: Map<string, Set<string>>): boolean {
  if (typeof p === "string") return (present.get(p)?.size ?? 0) > 0;
  if (!isObject(p)) return false;
  if (Array.isArray(p.allOf)) return p.allOf.every((x) => satisfied(x, present));
  if (Array.isArray(p.anyOf)) return p.anyOf.some((x) => satisfied(x, present));
  if (isObject(p.threshold)) {
    const t = p.threshold;
    const n = Number(t.n);
    if (typeof t.ofStep === "string") return (present.get(t.ofStep)?.size ?? 0) >= n;
    if (Array.isArray(t.of)) return t.of.filter((x) => satisfied(x, present)).length >= n;
  }
  return false;
}

/** Steps that are ancestors of `step` in the definition's `prev` graph. */
function ancestors(steps: Record<string, Record<string, unknown>>, step: string): Set<string> {
  const out = new Set<string>();
  const walk = (s: string): void => {
    for (const p of Array.isArray(steps[s]?.prev) ? (steps[s]!.prev as string[]) : []) {
      if (!out.has(p)) {
        out.add(p);
        walk(p);
      }
    }
  };
  walk(step);
  return out;
}

export function verifyReceipt(params: VerifyReceiptParams, nowMs: number, mutants: ReadonlySet<string>): VerifyReceiptResult {
  const m = (id: string): boolean => mutants.has(id);
  const done = (outcome: ReceiptOutcome, reason: string): VerifyReceiptResult => ({ outcome, reason });
  const invalid = (reason: string): VerifyReceiptResult => done("invalid", reason);

  // Rule 1: the SPEC.md 7.2 pipeline. The type, the envelope, the payload schema, the receipt's own proof.
  const doc = parseObject(params.receipt);
  if (doc === undefined) return invalid("the receipt is not a JSON object");
  if (!m("rcptNoTypeCheck") && doc.type !== RECEIPT_TYPE) return invalid(`type ${String(doc.type)} is not ${RECEIPT_TYPE}`);
  if (typeof doc.id !== "string" || doc.id === "" || !isObject(doc.payload)) return invalid("envelope: id and payload are required");
  if (m("rcptStrictEnvelope")) {
    const known = ["id", "threadId", "parentThreadId", "ceremony", "type", "issuer", "recipient", "issuedAt", "expiresAt", "payload", "@context", "proof", "ext", "extCritical"];
    if (Object.keys(doc).some((k) => !known.includes(k))) return invalid("unknown top-level member");
  }
  if (!m("rcptNoSchema")) {
    const errs = validateReceiptPayload(doc.payload);
    if (errs.length > 0) return invalid(`payload schema: ${errs[0]}`);
  }
  // OPEN: a receipt that names its own enactment as its parent breaks the producer rule of SPEC.md:658; the verifier rules do not say what to do with it.
  if (payload0(doc).parentEnactment !== undefined && payload0(doc).parentEnactment === payload0(doc).enactment) return invalid("parentEnactment is the receipt's own enactment");
  if (doc.proof === undefined) {
    if (!m("rcptProofOptional")) return invalid("proofRequired: the receipt carries no proof");
  } else if (!m("rcptNoProofCheck")) {
    const v = verifyDocumentProof(doc, { nowMs });
    if (!v.valid) return invalid(`proofInvalid: ${v.detail ?? v.failure ?? ""}`);
  }
  const payload = doc.payload;
  const entries: StepEntry[] = (payload.steps as Record<string, unknown>[] ?? []).map((s) => ({
    step: String(s.step), round: typeof s.round === "number" ? s.round : 1, typeUri: String(s.typeUri), issuer: String(s.issuer),
    id: String(s.id), digestMultibase: String(s.digestMultibase), terminal: s.terminal === true,
  }));

  // Rule 2: resolve the definition and check its digest. A mismatch or an unresolvable definition is "could not verify", not "invalid".
  const def = params.definition;
  if (def === undefined || def === null) return m("rcptUnresolvableAsInvalid") ? invalid("the definition could not be resolved") : done("unverifiable", "the definition could not be resolved");
  if (!m("rcptNoDefinitionDigestCheck") && !sameDigest(digestMultibase(def), String(payload.definitionDigest))) {
    return m("rcptDigestMismatchAsInvalid") ? invalid("definition digest mismatch") : done("unverifiable", "the resolved definition does not match definitionDigest");
  }
  const steps = isObject(def.steps) ? (def.steps as Record<string, Record<string, unknown>>) : {};
  const unverifiable: string[] = [];

  // Rule 4 (before anything is counted): de-duplicate. The same document id twice, or one step at one round twice (perRole: per issuer).
  if (!m("rcptNoDedupe")) {
    const ids = new Set<string>();
    const slots = new Set<string>();
    for (const e of entries) {
      if (ids.has(e.id)) return invalid(`document id ${e.id} is enumerated twice`);
      ids.add(e.id);
      const perRole = steps[e.step]?.multiplicity === "perRole";
      const slot = `${e.step}|${e.round}${perRole ? `|${e.issuer}` : ""}`;
      if (slots.has(slot)) return invalid(`step ${e.step} is enumerated twice at round ${e.round}`);
      slots.add(slot);
    }
  }
  // OPEN: the receipt text states none of these checks (the type, an undeclared step, a round beyond maxRounds); the registry's schema descriptions imply them.
  for (const e of entries) {
    const d = steps[e.step];
    if (d === undefined) return invalid(`step ${e.step} is not in the definition`);
    if (typeof d.type === "string" && d.type !== e.typeUri) return invalid(`step ${e.step} enacted ${e.typeUri}, the definition declares ${d.type}`);
    if (e.round > (typeof d.maxRounds === "number" ? d.maxRounds : 1)) return invalid(`step ${e.step} round ${e.round} exceeds maxRounds`);
  }

  // Rule 3: the recorder is one the definition names (roles; their VIDs come from the enactment's bindings, rule 8).
  const evidence = isObject(def.evidence) ? def.evidence : {};
  const recorderRoles = Array.isArray(evidence.recorders) ? (evidence.recorders as string[]) : [];
  const bindings = params.roleBindings;
  const bound = (role: string): string[] | undefined => (bindings === undefined || bindings === null ? undefined : bindings[role]);
  if (!m("rcptAnyIssuerRecorder")) {
    const roleList = m("rcptFirstRecorderOnly") ? recorderRoles.slice(0, 1) : recorderRoles;
    if (bindings === undefined || bindings === null) {
      if (!m("rcptBindingsAssumed")) unverifiable.push("the enactment's role bindings are not available (the recorder)");
    } else if (!roleList.some((r) => bound(r)?.includes(String(doc.issuer)))) return invalid("the issuer is not a recorder the definition names");
  }

  // Rule 8: each enumerated step's issuer is bound to the role the definition names as that step's issuer.
  if (!m("rcptNoIssuerRoleCheck")) {
    if (bindings === undefined || bindings === null) {
      if (!m("rcptBindingsAssumed")) unverifiable.push("the enactment's role bindings are not available (step issuers)");
    } else {
      for (const e of entries) if (!(bound(String(steps[e.step]!.issuer)) ?? []).includes(e.issuer)) return invalid(`step ${e.step} was issued by ${e.issuer}, which is not bound to its issuer role`);
    }
  }

  // Rules 6 and 7: the terminal step. Declared terminal steps only; the echo is the recorder's word.
  const declaredTerminal = entries.filter((e) => steps[e.step]?.terminal === true);
  if (!m("rcptNoTerminalDeclaredCheck") && entries.some((e) => e.terminal && steps[e.step]?.terminal !== true)) return invalid("a step the definition does not declare terminal is marked terminal");

  // Rules 9 to 11 over the documents held.
  const held = (params.steps ?? []).map((t) => ({ doc: parseObject(t) })).filter((h): h is { doc: Record<string, unknown> } => h.doc !== undefined);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const salt = typeof payload.salt === "string" ? payload.salt : undefined;
  const hashOf = (e: StepEntry): HashName | undefined => {
    const p = parseDigest(e.digestMultibase);
    return (Object.entries(MULTIHASH).find(([, v]) => v.code === p?.code)?.[0]) as HashName | undefined;
  };
  const heldTerminal = new Map<string, boolean>();
  for (const { doc: sd } of held) {
    const e = byId.get(String(sd.id));
    if (e === undefined) continue;
    const c = isObject(sd.ceremony) ? sd.ceremony : {};
    // Rule 9: recompute the digest; the document's enactment, definition digest, step, round and issuer agree with the receipt.
    if (!m("rcptNoDigestRecompute")) {
      const hash = hashOf(e);
      if (salt === undefined) unverifiable.push("no salt: the step digests cannot be recomputed");
      else if (hash === undefined) unverifiable.push(`a digest names a multihash function the verifier does not implement (${e.id})`);
      else {
        const want = stepDigest(sd, salt, { hash, ...(m("rcptSaltPrefix") ? { saltAt: "prefix" as const } : {}), ...(m("rcptDigestExcludesProof") ? { withoutProof: true } : {}) });
        if (!sameDigest(want, e.digestMultibase)) return invalid(`the digest of step ${e.id} does not match the document held`);
      }
    }
    if (!m("rcptNoEnactmentCheck") && c.enactment !== payload.enactment) return invalid(`step ${e.id} belongs to enactment ${String(c.enactment)}, not ${String(payload.enactment)}`);
    if (!m("rcptNoStepDefinitionCheck") && (typeof c.definitionDigest !== "string" || !sameDigest(c.definitionDigest, String(payload.definitionDigest)))) return invalid(`step ${e.id} pins another definition`);
    if (!m("rcptNoStepFieldCheck") && (c.step !== e.step || (typeof c.round === "number" ? c.round : 1) !== e.round || sd.issuer !== e.issuer)) return invalid(`step ${e.id} disagrees with the receipt on step, round or issuer`);
    // Rule 8 for a held document: its recipient is bound to the recipient role.
    if (!m("rcptNoRecipientRoleCheck") && bindings !== undefined && bindings !== null && !(bound(String(steps[e.step]!.recipient)) ?? []).includes(String(sd.recipient))) return invalid(`step ${e.id} was addressed to a party not bound to its recipient role`);
    // Rule 7: the terminal marker in the document's signed content; a contradicted echo is rejected.
    if (steps[e.step]?.terminal === true) {
      const marked = c.terminal === true;
      if (!m("rcptTrustTerminalEcho") && e.terminal && !marked) return invalid(`step ${e.id} is echoed terminal but the document does not carry the marker`);
      heldTerminal.set(e.id, marked);
    }
    // Rule 10: walk the chain.
    if (!m("rcptNoChainWalk") && Array.isArray(c.prev)) {
      for (const p of c.prev) {
        if (!isObject(p)) return invalid(`step ${e.id} has a malformed prev entry`);
        const named = byId.get(String(p.id));
        if (named === undefined) return invalid(`step ${e.id} follows ${String(p.id)}, which the receipt does not enumerate (an omitted step)`);
        if (!m("rcptChainDigestIgnored") && !sameDigest(String(p.digestMultibase), named.digestMultibase)) return invalid(`step ${e.id} commits to another digest of ${named.id} than the receipt does`);
        if (!m("rcptNoAncestorCheck") && !(ancestors(steps, e.step).has(named.step) || (named.step === e.step && named.round < e.round))) return invalid(`step ${named.step} is not an ancestor of ${e.step} in the definition`);
      }
    }
    // Rule 11: the held document's own proof.
    if (!m("rcptNoStepProofCheck")) {
      if (sd.proof === undefined) return invalid(`OPEN: step ${e.id} carries no proof`);
      if (!verifyDocumentProof(sd, { nowMs }).valid) return invalid(`the proof of step ${e.id} does not verify`);
    }
  }

  // Rule 5: evaluate the completion rule over the enumerated steps; payload.complete is never relied on.
  const present = new Map<string, Set<string>>();
  for (const e of entries) present.set(e.step, (present.get(e.step) ?? new Set()).add(`${e.issuer}`));
  const completionHolds = m("rcptTrustCompleteFlag") ? payload.complete === true : satisfied(def.completion, present);
  if (!completionHolds) return done("incomplete", "the enumerated steps do not satisfy the completion rule");
  // Rule 6: at least one enumerated step the definition declares terminal; none is a prefix.
  if (!m("rcptNoTerminalCheck") && declaredTerminal.length === 0) return done("incomplete", "no enumerated step is a terminal step: the receipt is a prefix");
  // Rule 7: the verifier confirms the marker in a held document; with none held it cannot say complete.
  if (!m("rcptTrustTerminalEcho") && !(m("rcptNoDocsAsComplete") && held.length === 0)) {
    const docs = declaredTerminal.filter((e) => heldTerminal.has(e.id));
    if (docs.length === 0) unverifiable.push("no step document the definition declares terminal is held: the terminal marker was not checked");
    else if (!docs.some((e) => heldTerminal.get(e.id) === true)) return done("incomplete", "the held terminal step document does not carry ceremony.terminal");
  }
  if (unverifiable.length > 0) return done("unverifiable", unverifiable[0]!);
  return done("complete", "verified");
}
