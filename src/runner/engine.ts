// SPDX-License-Identifier: Apache-2.0
// Executes one vector against an adapter and reports whether the observed behaviour matched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Capabilities, SendFrom, SendResult } from "../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../crypto/didkey.ts";
import { resolverFromDidDocument, verifyDocumentProof } from "../crypto/proof.ts";
import { canonicalJson } from "@openvtc/trust-tasks/runtime";
import { isObject } from "../util/json.ts";
import { evidenceErrors } from "./witness-evidence.ts";
import type { EvidenceCheck } from "./witness-evidence.ts";
import { getPointer } from "../util/pointer.ts";
import type { Expect, FromSpec, ObservePushedSpec, Step, Tier, Vector } from "../vectors/types.ts";
import { buildSend, CEX_PRESENT_TYPE, CEX_QUERY_TYPE, DISCOVERY_TYPE, DISCOVERY_TYPE_V0_1, DISCOVERY_TYPE_V0_3, discoveryTypeOf, parseAt, substitute } from "./build.ts";
import { rebaseVector, realWaitMs } from "./clock.ts";
import { buildReceiptScenario } from "./receipt.ts";
import { PROFILE_WINDOW } from "./window.ts";
import { answeredErrors, emittedErrors } from "../plain/check.ts";
import { loadTask } from "../plain/catalog.ts";
import type { AcceptanceWindow } from "../adapter/contract.ts";
import type { Actor, BuildContext, BuiltSend } from "./build.ts";
import { expandQuorum } from "./essential.ts";
import { minimumQuiet, quietFailure } from "./quiet.ts";
import type { QuietPeriod } from "./quiet.ts";

export const ERROR_PREFIX = "https://trusttasks.org/spec/trust-task-error/";
export const NEXT_STEP_PREFIX = "https://trusttasks.org/spec/trust-task-next-step/";

/** Trigger actions that return a JSON value in `documents[0]` (captured by the step) instead of Trust Task documents. */
export const HELPER_ACTIONS: ReadonlySet<string> = new Set(["consentBinding", "presentationNonce", "enrolExecutor", "holdCredential", "verifierTrust", "makeOffer", "witnessPresentation"]);

/**
 * Pushed-document observation (docs/20): poll `observe {query: "pushed"}` for up to `withinMs` real milliseconds. Positive: pass as soon as a
 * matching document, issued by the IUT, satisfies every pointer and match assertion. Negative (`none`): wait the whole period, then require no match.
 * The filter the adapter gets is exactly the one given (`to`, `type`, `threadId`); a failure lists what else was pushed, for the report.
 */
export async function pushedErrors(adapter: Adapter, spec: ObservePushedSpec, ctx: BuildContext, iutVid: string, sleepFn?: (ms: number) => Promise<void>, minQuietMs = 0): Promise<string[]> {
  const sleep = sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const sub = (v: string | undefined): string | undefined => (v === undefined ? undefined : String(substitute(v, ctx)));
  const to = sub(spec.to), type = sub(spec.type), threadId = sub(spec.threadId);
  const filter = { query: "pushed" as const, ...(to === undefined ? {} : { to }), ...(type === undefined ? {} : { type }), ...(threadId === undefined ? {} : { threadId }) };
  const describe = `${[to && `to ${to}`, type && `type ${type}`, threadId && `thread ${threadId}`].filter(Boolean).join(", ")}`;
  const evaluate = async (): Promise<{ matching: number; ok: boolean; why: string }> => {
    const docs = (await adapter.observe(filter)).documents ?? [];
    let satisfied = 0;
    let why = "";
    for (const text of docs) {
      let d: Record<string, unknown>;
      try { d = JSON.parse(text) as Record<string, unknown>; } catch { why = "a pushed document is not JSON"; continue; }
      if (d.issuer !== iutVid) { why = `a pushed document is issued by ${String(d.issuer)}, not by the implementation`; continue; }
      const bad: string[] = [];
      for (const [ptr, want] of Object.entries(spec.pointer ?? {})) {
        const got = getPointer(d, ptr);
        if (canonicalJson(got ?? null) !== canonicalJson(substitute(want, ctx) ?? null)) bad.push(`${ptr} is ${JSON.stringify(got)}`);
      }
      for (const [ptr, re] of Object.entries(spec.match ?? {})) {
        const got = getPointer(d, ptr);
        if (typeof got !== "string" || !new RegExp(String(substitute(re, ctx))).test(got)) bad.push(`${ptr} ${JSON.stringify(got)} does not match ${re}`);
      }
      if (bad.length === 0) satisfied++;
      else why = bad.join("; ");
    }
    const ok = spec.count === undefined ? satisfied >= 1 : satisfied === spec.count && docs.length === spec.count;
    return { matching: docs.length, ok, why };
  };
  const until = Date.now() + (spec.withinMs ?? 0);
  if (spec.none === true) {
    // O-13: an absence is only observed once the binding's minimum quiet period has passed (docs/04 section 3.3: 1500 ms over DIDComm, where a push can still be in flight), so the wait is never shorter than it
    const wait = Math.max(spec.withinMs ?? 0, minQuietMs);
    if (wait > 0) await sleep(wait);
    const r = await evaluate();
    return r.matching === 0 ? [] : [`${r.matching} document(s) pushed (${describe}), expected none`];
  }
  let r = await evaluate();
  while (!r.ok && Date.now() < until) {
    await sleep(Math.min(50, Math.max(1, until - Date.now())));
    r = await evaluate();
  }
  if (r.ok) return [];
  if (r.matching === 0) {
    const all = (await adapter.observe({ query: "pushed" })).documents ?? [];
    const seen = all.map((t) => { try { const d = JSON.parse(t) as Record<string, unknown>; return `${String(d.type).replace(/^.*\/spec\//, "")} to ${String(d.recipient)} on ${String(d.threadId ?? d.id)}`; } catch { return "unreadable"; } });
    return [`no document pushed (${describe})${seen.length === 0 ? "; nothing was pushed" : `; pushed instead: ${seen.join(" | ")}`}`];
  }
  return [`pushed document does not satisfy the expectation (${describe}): ${r.why || `${r.matching} matched, expected ${String(spec.count)}`}`];
}

export function makeActors(): Record<string, Actor> {
  const mk = (name: string, seed: number): Actor => {
    const signer = ed25519Signer(seedOf(seed));
    return { name, signer, vid: signer.did };
  };
  // A and X are connection identities; R, S and Q are relationship identities (a second one of A, and a third party's); W is a witness.
  // B, C, D, F, G and H are further members an essential-governance authority set may name (docs/04 section 19).
  return {
    A: mk("A", 0x0a), X: mk("X", 0x0b), R: mk("R", 0x0c), S: mk("S", 0x0d), Q: mk("Q", 0x0e), W: mk("W", 0x0f),
    B: mk("B", 0x10), C: mk("C", 0x11), D: mk("D", 0x12), F: mk("F", 0x13), G: mk("G", 0x14), H: mk("H", 0x15),
  };
}

export interface EngineEnv {
  caps: Capabilities;
  iutVid: string;
  /** The DID document `provision` returned for the IUT, used to verify its proofs when the identifier is not did:key. */
  iutDidDocument?: unknown;
  actors: Record<string, Actor>;
  tier: Tier;
  /** Directory the `verifyProof.file` paths are relative to. */
  fixtureRoot: string;
  defaultClockStart: string;
  /** The effective acceptance window (declared, or given to the runner, else the profile pins). */
  window?: AcceptanceWindow;
  /** The harness cannot set the implementation's clock: rebase mode (real time is the clock start; `setClock` is never called). */
  clockless?: boolean;
  /** The run salt mixed into deterministic ids. */
  salt?: string;
  /** Waits in real time for a literal small offset in rebase mode (default: a timer). Tests replace it so they do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The minimum quiet period a no-reply verdict needs (src/runner/quiet.ts, docs/04 section 3.3). Absent: derived from the declared
   * bindings (0 ms over `in-process` or `https`, 1500 ms otherwise).
   */
  quiet?: QuietPeriod;
}

export interface VectorOutcome {
  pass: boolean;
  failures: string[];
  /**
   * SHOULD mismatches observed while the vector ran (docs/04 section 3.2): recorded in the run result and the matrix, never a failure at
   * Tier 1 and never hidden. At Tier 2 on an implementation that declares `attested` the same mismatch is a failure instead.
   */
  advisories: string[];
  /**
   * Informational, advisory-only: the error code each error step observed (one entry per step that was answered with a trust-task-error and
   * judged against a code list), recorded only for a vector whose list holds `permissionDenied` beside another code. Absent otherwise.
   */
  observedCodes?: string[];
  /** Present (true) when the vector passed and every recorded error step was answered `permissionDenied`, the task's own code never seen: only an authorisation gate answered first. */
  acceptedOnlyGate?: true;
}

/** A run of the attested profile: the SHOULDs the framework leaves open are requirements there (docs/04 section 3.2). */
export function strictRun(env: EngineEnv): boolean {
  return env.tier >= 2 && env.caps.optional.includes("attested");
}

export const STANDARD_CODES = [
  "malformedRequest", "unsupportedType", "unsupportedVersion", "unsupportedExtension", "expired", "proofRequired", "proofInvalid",
  "permissionDenied", "wrongRecipient", "identityMismatch", "idConflict", "cancelled", "taskFailed", "unavailable", "indeterminate", "internalError",
];
/** Extended code form `<slug>:<local>` (framework 8.5), for example vrc/relationships/issue:notAccepted. */
const EXTENDED_CODE = /^[a-z0-9][a-z0-9/-]*:[A-Za-z][A-Za-z0-9]*$/;

const WHOLE_SECOND = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

function sameDocument(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  return pa !== undefined && pb !== undefined && canonicalJson(pa) === canonicalJson(pb);
}

function resolveFrom(spec: FromSpec | undefined, ctx: BuildContext, fallback: SendFrom): SendFrom {
  if (spec === undefined) return fallback;
  if (typeof spec === "string") {
    if (spec === "none") return { kind: "none" };
    const a = ctx.actors[spec];
    if (a === undefined) throw new Error(`unknown actor ${spec}`);
    return { kind: "actor", vid: a.vid };
  }
  const named = ctx.actors[spec.spoof];
  return { kind: "spoof", vid: named === undefined ? spec.spoof : named.vid };
}

/**
 * A `malformedRequest` refusal. Where a document does not parse (truncated, no `id`, an impossible date) the consumer has no thread and no
 * issuer it can trust to address, so the SHOULDs that the reply continue the request's thread and name its issuer cannot apply to it.
 */
function isMalformedRefusal(r: Record<string, unknown>): boolean {
  return typeof r.type === "string" && r.type.startsWith(ERROR_PREFIX) && isObject(r.payload) && r.payload.code === "malformedRequest";
}

/** Generic validators run on every reply (docs/04-suite-design.md section 3). */
export function validateReply(
  replyText: string,
  request: Record<string, unknown> | undefined,
  from: SendFrom,
  env: EngineEnv,
  nowMs: number,
  advisories?: { push: (m: string) => unknown },
): string[] {
  const errs: string[] = [];
  // A SHOULD of the framework: an advisory (Tier 1), a failure on the attested profile.
  const should = (m: string): void => void ((strictRun(env) || advisories === undefined ? errs : advisories).push(m));
  const r = parse(replyText);
  if (r === undefined) return ["reply is not a JSON object"];
  if (typeof r.id !== "string" || r.id === "") errs.push("reply has no string id");
  if (typeof r.type !== "string") errs.push("reply has no string type");
  if (!isObject(r.payload)) errs.push("reply payload is not an object");
  const type = typeof r.type === "string" ? r.type : "";
  const isError = type.startsWith(ERROR_PREFIX);
  const senderVid = from.kind === "none" ? undefined : from.vid;
  if (request !== undefined) {
    if (typeof request.id === "string") {
      if (r.id === request.id) errs.push("reply id equals the request id");
      const expectThread = typeof request.threadId === "string" ? request.threadId : request.id;
      if (r.threadId !== expectThread && !(isMalformedRefusal(r))) {
        // framework 4.9: the producer SHOULD set threadId; the next-step specification makes it a MUST for a next step only
        const m = `reply threadId ${String(r.threadId)} != ${expectThread}`;
        if (type.startsWith(NEXT_STEP_PREFIX)) errs.push(m);
        else should(m);
      }
    }
  }
  if (r.issuer !== env.iutVid) should(`reply issuer ${String(r.issuer)} is not the IUT (issuer is OPTIONAL, SPEC.md 4.8)`);
  if (type === `${DISCOVERY_TYPE}#response`) errs.push(...discoveryResponseErrors(r));
  // 0.3: its payload schema is closed and lacks expiryHorizonSeconds (added by 0.4)
  else if (type === `${DISCOVERY_TYPE_V0_3}#response`) errs.push(...discoveryResponseErrors(r, false));
  // 0.1 (witness vectors): conformance responder rules 3 and 4 (bare Type URIs, no duplicates). The unknown-member rule of the expanded entry is asserted by WSD-010 alone, not by every discovery vector.
  else if (type === `${DISCOVERY_TYPE_V0_1}#response`) errs.push(...discoveryResponseErrors(r).filter((e) => !/unknown member/.test(e)));
  const code = isObject(r.payload) ? r.payload.code : undefined;
  if (request !== undefined) {
    if (isError && code === "identityMismatch") {
      if (r.recipient !== senderVid) errs.push("identityMismatch reply is not addressed to the transport sender");
    } else if (typeof request.issuer === "string" && r.recipient !== request.issuer && !isMalformedRefusal(r)) {
      should("reply is not addressed to the request issuer (recipient is OPTIONAL, SPEC.md 4.8)");
    }
    if (!isError && typeof request.type === "string" && type !== `${request.type.split("#")[0]}#response` && !(request.type === CEX_QUERY_TYPE && type === CEX_PRESENT_TYPE)) {
      if (!type.startsWith(NEXT_STEP_PREFIX)) errs.push(`reply type ${type} is not the request's #response`);
    }
  }
  if (isError && isObject(r.payload)) {
    const p = r.payload;
    if (typeof p.code !== "string") errs.push("error code is not a string");
    else if (!STANDARD_CODES.includes(p.code) && !EXTENDED_CODE.test(p.code)) errs.push(`error code ${p.code} is neither a standard code nor an extended code (8.2, 8.5)`);
    if (typeof p.retryable !== "boolean") errs.push("error retryable is not a boolean (framework 8.2 MUST)");
    if (p.message !== undefined && typeof p.message !== "string") errs.push("error message is not a string");
    if (p.details !== undefined) {
      if (!isObject(p.details)) errs.push("details is not an object");
      else {
        if (Object.keys(p.details).length > 16) errs.push("details has more than 16 members (8.2.2)");
        if (Buffer.byteLength(canonicalJson(p.details), "utf8") > 4096) errs.push("details exceeds 4096 bytes (8.2.2)");
      }
    }
    const forbidden: unknown[] = [];
    if (code === "identityMismatch") forbidden.push(request?.issuer, senderVid);
    if (code === "wrongRecipient") forbidden.push(request?.recipient);
    if (code === "proofInvalid" && isObject(request?.proof)) forbidden.push((request!.proof as Record<string, unknown>).verificationMethod);
    for (const f of forbidden) {
      if (typeof f === "string" && typeof p.message === "string" && p.message.includes(f)) errs.push("error message discloses a contested identity (8.2.1)");
    }
    if (request !== undefined && isObject(p.inResponseTo)) {
      if (p.inResponseTo.typeUri !== request.type) should("inResponseTo.typeUri does not name the request type (SPEC.md 8.4: SHOULD)");
      if (code === "identityMismatch" && p.inResponseTo.id !== undefined) errs.push("identityMismatch echoes inResponseTo.id (8.2)");
    }
  }
  if (strictRun(env)) {
    const v = verifyDocumentProof(r, { nowMs, skewMs: 60_000, ...(env.iutDidDocument === undefined ? {} : { resolve: resolverFromDidDocument(env.iutDidDocument) }) });
    if (r.proof === undefined) errs.push("tier 2: reply is not signed");
    else if (!v.valid) errs.push(`tier 2: reply proof invalid (${v.detail ?? v.failure ?? ""})`);
    else {
      if (v.purpose !== "authentication") errs.push(`tier 2: reply proof purpose ${String(v.purpose)} is not authentication`);
      if (v.signer !== env.iutVid) errs.push("tier 2: reply signer is not the IUT");
      if (typeof request?.recipient === "string" && request.recipient === env.iutVid && v.signer !== request.recipient) errs.push("tier 2: reply does not verify under the request's recipient");
    }
    const created = isObject(r.proof) ? r.proof.created : undefined;
    for (const [k, val] of [["issuedAt", r.issuedAt], ["proof.created", created]] as const) {
      if (typeof val !== "string" || !WHOLE_SECOND.test(val)) errs.push(`tier 2: ${k} is not a whole-second UTC timestamp`);
    }
  }
  return errs;
}

/**
 * Slug of a Type URI: the registry form `https://trusttasks.org/spec/<slug>/<MAJOR.MINOR>`, or the URN form
 * `urn:<NID>:<prefix>:spec:<slug-segments>:<MAJOR.MINOR>` (framework 6.1, a `:` in the slug segments stands for `/`); else undefined.
 */
export function slugOf(typeUri: string): string | undefined {
  const web = /^https:\/\/trusttasks\.org\/spec\/(.+)\/\d+\.\d+$/.exec(typeUri)?.[1];
  if (web !== undefined) return web;
  const urn = /^urn:[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*:spec:([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)*):\d+\.\d+$/.exec(typeUri)?.[1];
  return urn?.split(":").join("/");
}

/** The pattern grammar of trust-task-discovery 0.4: `*`, `<prefix>/*` (the literal prefix and slash), otherwise an exact slug. */
export function patternMatches(pattern: string, slug: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return slug.startsWith(pattern.slice(0, -1));
  return slug === pattern;
}

const ACCEPTANCE_WINDOW_MEMBERS = ["maxAgeSeconds", "clockSkewSeconds", "expiryHorizonSeconds"];
const BARE_TYPE_URI = /^(https:\/\/trusttasks\.org\/spec\/[a-z0-9][a-z0-9/-]*\/\d+\.\d+|urn:[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*:spec:[a-z0-9][a-z0-9:-]*:\d+\.\d+)$/;

function acceptanceWindowErrors(where: string, w: unknown, allowHorizon = true): string[] {
  if (!isObject(w)) return [`${where} is not an object`];
  const errs: string[] = [];
  for (const k of Object.keys(w)) if (!ACCEPTANCE_WINDOW_MEMBERS.includes(k) || (k === "expiryHorizonSeconds" && !allowHorizon)) errs.push(`${where} has unknown member ${k}`);
  for (const [k, min, required] of [["maxAgeSeconds", 1, true], ["clockSkewSeconds", 0, true], ["expiryHorizonSeconds", 1, false]] as const) {
    const val = w[k];
    if (val === undefined) {
      if (required) errs.push(`${where}.${k} is required`);
    } else if (!Number.isInteger(val) || (val as number) < min) errs.push(`${where}.${k} is not a whole number of seconds of at least ${min}`);
  }
  return errs;
}

/** The response payload schema of trust-task-discovery 0.4 (payload.schema.json `$anchor: response`) and its conformance rules 3 and 4. */
export function discoveryResponseErrors(doc: Record<string, unknown>, allowHorizon = true): string[] {
  const p = doc.payload;
  if (!isObject(p)) return ["discovery response payload is not an object"];
  const errs: string[] = [];
  for (const k of Object.keys(p)) if (!["supportedTypes", "frameworkVersion", "acceptanceWindow"].includes(k)) errs.push(`discovery response has unknown member ${k}`);
  if (!Array.isArray(p.supportedTypes)) errs.push("discovery response supportedTypes is not an array");
  else {
    const seen = new Set<string>();
    for (const [i, e] of p.supportedTypes.entries()) {
      const t = typeof e === "string" ? e : isObject(e) ? e.type : undefined;
      if (typeof t !== "string") {
        errs.push(`supportedTypes[${i}] is neither a Type URI string nor an object with a type`);
        continue;
      }
      if (t.includes("#")) errs.push(`supportedTypes[${i}] is not a bare Type URI (carries a fragment): ${t}`);
      else if (!BARE_TYPE_URI.test(t)) errs.push(`supportedTypes[${i}] is not a Type URI: ${t}`);
      if (seen.has(t)) errs.push(`supportedTypes lists ${t} more than once`);
      seen.add(t);
      if (isObject(e)) {
        for (const k of Object.keys(e)) if (!["type", "requiredExt", "acceptanceWindow"].includes(k)) errs.push(`supportedTypes[${i}] has unknown member ${k}`);
        if (e.acceptanceWindow !== undefined) errs.push(...acceptanceWindowErrors(`supportedTypes[${i}].acceptanceWindow`, e.acceptanceWindow, allowHorizon));
      }
    }
  }
  if (p.frameworkVersion !== undefined && !(typeof p.frameworkVersion === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(p.frameworkVersion))) {
    errs.push("discovery response frameworkVersion is not MAJOR.MINOR.PATCH");
  }
  if (p.acceptanceWindow !== undefined) errs.push(...acceptanceWindowErrors("acceptanceWindow", p.acceptanceWindow, allowHorizon));
  return errs;
}

const NEXT_STEP_MEMBERS = ["expects", "continuation", "inResponseTo", "message", "ext"];
const EXPECT_ENTRY_MEMBERS = ["typeUri", "reason", "hint"];

/** The payload schema of trust-task-next-step 0.1 (closed object; `expects` is a non-empty list of entries naming a Type URI). */
export function nextStepShapeErrors(doc: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const p = doc.payload;
  if (!isObject(p)) return ["next-step payload is not an object"];
  for (const k of Object.keys(p)) if (!NEXT_STEP_MEMBERS.includes(k)) errs.push(`next-step payload has unknown member ${k}`);
  if (!Array.isArray(p.expects) || p.expects.length < 1) errs.push("next-step expects must be a non-empty array");
  else {
    for (const [i, e] of p.expects.entries()) {
      if (!isObject(e) || typeof e.typeUri !== "string" || e.typeUri === "") errs.push(`next-step expects[${i}] has no typeUri`);
      else {
        for (const k of Object.keys(e)) if (!EXPECT_ENTRY_MEMBERS.includes(k)) errs.push(`next-step expects[${i}] has unknown member ${k}`);
        if (e.reason !== undefined && (typeof e.reason !== "string" || e.reason.length > 1024)) errs.push(`next-step expects[${i}].reason is not a string of at most 1024 characters`);
        if (e.hint !== undefined && !isObject(e.hint)) errs.push(`next-step expects[${i}].hint is not an object`);
      }
    }
  }
  if (p.continuation !== undefined && p.continuation !== "resubmit" && p.continuation !== "proceed") errs.push("next-step continuation is neither resubmit nor proceed");
  if (p.inResponseTo !== undefined && !(isObject(p.inResponseTo) && typeof p.inResponseTo.typeUri === "string" && p.inResponseTo.typeUri !== "")) errs.push("next-step inResponseTo has no typeUri");
  if (p.message !== undefined && (typeof p.message !== "string" || p.message.length > 1024)) errs.push("next-step message is not a string of at most 1024 characters");
  return errs;
}

/**
 * The hold rule (framework 8.6, "A hold is a next step"): the next step belongs to the request's thread and names the request in
 * `inResponseTo`; where `expects` names the request's own Type URI (the consumer offers no status task) the continuation is
 * `resubmit` (the schema default). Where it names only other types the specification states no value, so none is asserted. When the
 * implementation declares a status task (`statusType`), `expects` must name it (SPEC.md 8.6: where the act belongs to a third party and
 * the consumer offers a task to learn the outcome, `expects` names that task); the continuation value is still not asserted.
 */
export function holdErrors(reply: Record<string, unknown>, request: Record<string, unknown> | undefined, statusType?: string, soft?: (m: string) => void): string[] {
  const errs: string[] = [];
  const should = (m: string): void => (soft === undefined ? void errs.push(m) : soft(m));
  const p = isObject(reply.payload) ? reply.payload : {};
  if (request === undefined) return errs;
  const own = typeof request.type === "string" ? request.type.split("#")[0] : "";
  const irt = isObject(p.inResponseTo) ? p.inResponseTo : undefined;
  if (irt === undefined || irt.typeUri !== request.type || irt.id !== request.id) should("hold: inResponseTo does not name the request (next-step specification: SHOULD)");
  const expects = Array.isArray(p.expects) ? p.expects : [];
  const namesOwn = expects.some((e) => isObject(e) && typeof e.typeUri === "string" && e.typeUri.split("#")[0] === own);
  if (statusType !== undefined && !expects.some((e) => isObject(e) && typeof e.typeUri === "string" && e.typeUri.split("#")[0] === statusType.split("#")[0])) {
    should("hold: the implementation offers a status task, so expects should name it (SPEC.md 8.6)");
  }
  if (statusType === undefined && namesOwn && (p.continuation ?? "resubmit") !== "resubmit") errs.push("hold: expects names the request's own type, so the continuation must be resubmit (SPEC.md 8.6)");
  return errs;
}

function checkExpect(
  ex: Expect,
  replies: string[],
  prevReplies: string[] | undefined,
  handledBefore: number,
  handledAfter: number,
  storedAfter: number,
  ctx: BuildContext,
  adapterDocState: (id: string) => Promise<string>,
  adapterStored: (kind: string, digest?: string) => Promise<number>,
  earlier: (string | undefined)[],
  extra: { observed?: { code: string; accepted: string[] }[]; transport?: SendResult["transport"]; caps: Capabilities; should: (m: string) => void; note?: (m: string) => void; strict: boolean; request?: Record<string, unknown>; sentBytes?: (string | undefined)[]; retained?: (id: string, side: "request" | "reply") => Promise<string> },
): Promise<string[]> {
  return (async () => {
    const errs: string[] = [];
    // SPEC.md 4.4.1 and 4.12: a next step leaves the exchange open, so a request held for a decision can be answered by a next step and
    // later by the terminal reply on the same thread (the sequence the threadId text of SPEC.md 4.4 names: a request, an intermediate
    // trust-task-next-step response, and the final result). For a step that expects the terminal reply, the interim next steps before it are not extra replies.
    if ((ex.disposition === "response" || ex.disposition === "error") && replies.length > 1) {
      const isNext = (r: string): boolean => { const d = parse(r); return typeof d?.type === "string" && d.type.startsWith(NEXT_STEP_PREFIX); };
      let i = 0;
      while (i < replies.length - 1 && isNext(replies[i]!)) i++;
      if (i > 0 && !isNext(replies[replies.length - 1]!)) replies = replies.slice(i);
    }
    const first = replies[0] === undefined ? undefined : parse(replies[0]);
    const typeOf = (d: Record<string, unknown> | undefined): string => (typeof d?.type === "string" ? d.type : "");
    let heldInstead = false;
    switch (ex.disposition) {
      case "response": {
        if (replies.length !== 1) errs.push(`expected one response, got ${replies.length} replies`);
        else if (ex.orHold === true && typeOf(first).startsWith(NEXT_STEP_PREFIX)) {
          heldInstead = true;
          errs.push(...nextStepShapeErrors(first!), ...holdErrors(first!, extra.request, extra.caps.ceremony?.statusType, extra.should));
        } else if (ex.orRefusal !== undefined && typeOf(first).startsWith(ERROR_PREFIX)) {
          heldInstead = true;
          const got = String((first!.payload as Record<string, unknown>).code);
          if (!ex.orRefusal.includes(got)) errs.push(`expected the response or a refusal with code ${ex.orRefusal.join("|")}, got ${got}`);
        } else {
          const want = substitute(ex.type ?? "$carrierResponse", ctx) as string;
          if (typeOf(first) !== want) errs.push(`expected type ${want}, got ${typeOf(first)}`);
        }
        break;
      }
      case "next-step":
        if (replies.length !== 1 || !typeOf(first).startsWith(NEXT_STEP_PREFIX)) errs.push("expected a trust-task-next-step reply");
        else {
          errs.push(...nextStepShapeErrors(first!));
          if (ex.hold === true) errs.push(...holdErrors(first!, extra.request, extra.caps.ceremony?.statusType, extra.should));
        }
        break;
      case "error": {
        if (replies.length === 0 && ex.errorReply === "should") extra.should("no error response was returned (SPEC.md 7.2 closing paragraph and section 8: returning one is a SHOULD or MAY; the refusal itself is judged by noSideEffect and state)");
        else if (replies.length !== 1) errs.push(`expected one error, got ${replies.length} replies`);
        else if (!typeOf(first).startsWith(ERROR_PREFIX)) errs.push(`expected a trust-task-error, got ${typeOf(first)}`);
        else {
          const codes = Array.isArray(ex.code) ? ex.code : [ex.code!];
          const got = (first!.payload as Record<string, unknown>).code;
          if (!codes.includes(String(got))) errs.push(`expected code ${codes.join("|")}, got ${String(got)}`);
          else extra.observed?.push({ code: String(got), accepted: codes });
          // `retryable` must be a boolean (checked on every reply); its default values are SHOULDs (SPEC.md 8.2: the value sent is authoritative)
          if (ex.retryable !== undefined && (first!.payload as Record<string, unknown>).retryable !== ex.retryable) extra.should(`expected retryable ${String(ex.retryable)} (the default for this code; SHOULD)`);
        }
        break;
      }
      case "silence":
        if (ex.acknowledgement === "allowed" && replies.length === 1) {
          // SPEC.md 4.4.2 items 1 and 4: the courtesy acknowledgement is the originating type with #response and exactly the empty payload
          const want = `${extra.request?.type ?? ""}#response`;
          if (typeOf(first) !== want) errs.push(`expected silence or an empty acknowledgement ${want}, got ${typeOf(first)}`);
          else if (canonicalJson(first!.payload ?? null) !== "{}") errs.push("an acknowledgement payload must be exactly {} (SPEC.md 4.4.2 item 1)");
        } else if (replies.length !== 0) errs.push(`expected silence, got ${replies.length} replies`);
        break;
      case "answered": {
        const task = ex.plainType === undefined ? undefined : loadTask(ex.plainType);
        if (task === undefined) errs.push(`answered: the pinned @openvtc/trust-tasks has no ${String(ex.plainType)}`);
        else errs.push(...answeredErrors(task, replies, { should: extra.should, note: extra.note ?? extra.should, ...(ex.success === true ? { success: true } : {}), ...(ex.acceptCodes === undefined ? {} : { acceptCodes: ex.acceptCodes }), ...(ex.followOn === undefined ? {} : { followOn: ex.followOn }) }));
        break;
      }
      case "any-refusal":
        if (replies.length > 1 || (replies.length === 1 && !typeOf(first).startsWith(ERROR_PREFIX))) errs.push("expected silence or an error");
        break;
      case "duplicate": {
        if (replies.length > 1) errs.push("duplicate produced several replies");
        if (replies.length === 1) {
          if (typeOf(first).startsWith(ERROR_PREFIX)) errs.push(`a duplicate was reported as an error (${String((first!.payload as Record<string, unknown>).code)})`);
          else if (ex.priorReplyLost === true) {
            if (!typeOf(first).endsWith("#response")) errs.push("a duplicate of a completed execution answered with something other than the response");
          } else if (prevReplies === undefined || !prevReplies.some((p) => sameDocument(p, replies[0]!))) {
            // SPEC.md 7.2 item 11: the duplicate is not executed twice (MUST); returning the previously determined result "or an equivalent
            // receipt" is a SHOULD, and silence is allowed. An equivalent #response (same type and payload) is an advisory, anything else fails.
            const prior = (prevReplies ?? []).map(parse).find((d) => d !== undefined && typeOf(d) === typeOf(first) && canonicalJson(d.payload ?? null) === canonicalJson(first!.payload ?? null));
            if (prior === undefined || !typeOf(first).endsWith("#response")) errs.push("duplicate reply is neither the prior reply nor an equivalent response");
            else extra.should("duplicate answered with an equivalent response rather than the retained document (SPEC.md 7.2 item 11: SHOULD return the previously determined result)");
          }
        }
        if (handledAfter !== handledBefore) errs.push("a duplicate was executed again");
        break;
      }
    }
    if (ex.noSideEffect === true && handledAfter !== handledBefore) errs.push("observable state changed (noSideEffect)");
    if (ex.state?.handled !== undefined && handledAfter !== ex.state.handled) errs.push(`handled count ${handledAfter}, expected ${ex.state.handled}`);
    if (ex.state?.stored !== undefined && storedAfter !== ex.state.stored) errs.push(`stored credentials ${storedAfter}, expected ${ex.state.stored}`);
    if (ex.state?.effects !== undefined) {
      const n = await adapterStored("ceremony-effect");
      if (n !== ex.state.effects) errs.push(`ceremony effects ${n}, expected ${ex.state.effects}`);
    }
    if (ex.state?.retained !== undefined) {
      const r = ex.state.retained;
      const id = substitute(r.id, ctx) as string;
      if (extra.retained === undefined) errs.push("retained: no observation available");
      else {
        if (r.request !== undefined) {
          const want = extra.sentBytes?.[r.request - 1];
          const got = await extra.retained(id, "request");
          if (want === undefined || got !== want) errs.push(`retained request ${id} is not the bytes sent at step ${r.request}`);
        }
        if (r.reply !== undefined) {
          const want = earlier[r.reply - 1];
          const got = await extra.retained(id, "reply");
          if (want === undefined || got !== want) errs.push(`retained reply to ${id} is not the reply received at step ${r.reply}`);
        }
      }
    }
    if (ex.state?.storedVwc !== undefined) {
      const n = await adapterStored("vwc");
      if (n !== ex.state.storedVwc) errs.push(`stored witnessed credentials ${n}, expected ${ex.state.storedVwc}`);
    }
    if (ex.state?.storedCredential !== undefined) {
      const n = await adapterStored("credential");
      if (n !== ex.state.storedCredential) errs.push(`stored credentials ${n}, expected ${ex.state.storedCredential}`);
    }
    if (ex.state?.deferred !== undefined) {
      const n = await adapterStored("deferral");
      if (n !== ex.state.deferred) errs.push(`deferred queries ${n}, expected ${ex.state.deferred}`);
    }
    if (ex.state?.storedPresentation !== undefined) {
      const n = await adapterStored("presentation");
      if (n !== ex.state.storedPresentation) errs.push(`stored presentations ${n}, expected ${ex.state.storedPresentation}`);
    }
    if (ex.state?.storedVwcDigest !== undefined) {
      const digest = substitute(ex.state.storedVwcDigest.digest, ctx) as string;
      const n = await adapterStored("vwc", digest);
      if (n !== ex.state.storedVwcDigest.count) errs.push(`stored witnessed credentials with digest ${digest}: ${n}, expected ${ex.state.storedVwcDigest.count}`);
    }
    if (ex.discovery !== undefined) {
      const types = first !== undefined && isObject(first.payload) && Array.isArray(first.payload.supportedTypes) ? first.payload.supportedTypes : undefined;
      if (types === undefined) errs.push("discovery: reply carries no supportedTypes");
      else {
        const listed = types.map((t) => (typeof t === "string" ? t : isObject(t) ? String(t.type) : ""));
        const patterns = ex.discovery.matches.length === 0 ? ["*"] : ex.discovery.matches;
        const want = extra.caps.supportedTypes.filter((t) => {
          const slug = slugOf(t);
          return slug !== undefined && patterns.some((pt) => patternMatches(pt, slug));
        });
        const missing = want.filter((t) => !listed.includes(t));
        const surplus = listed.filter((t) => !want.includes(t));
        if (missing.length > 0) errs.push(`discovery: declared types not listed: ${missing.join(", ")}`);
        if (surplus.length > 0) errs.push(`discovery: listed types the implementation does not declare or the patterns do not match: ${surplus.join(", ")}`);
        if (ex.discovery.sorted === true && listed.some((t, i) => i > 0 && listed[i - 1]! > t)) errs.push("discovery: supportedTypes is not sorted lexicographically by Type URI");
      }
    }
    for (const bad of ex.forbidInReply ?? []) {
      if (replies.some((r) => r.includes(String(substitute(bad, ctx))))) errs.push(`reply discloses a string it must not: ${bad}`);
    }
    if (extra.caps.bindings.includes("https") && extra.transport !== undefined) {
      const status = extra.transport.status;
      if (ex.httpStatus !== undefined) {
        const want = Array.isArray(ex.httpStatus) ? ex.httpStatus : [ex.httpStatus];
        if (status === undefined || !want.includes(status)) errs.push(`HTTP status ${String(status)}, expected ${want.join("|")}`);
      }
      if (ex.httpStatusShould !== undefined) {
        const want = Array.isArray(ex.httpStatusShould) ? ex.httpStatusShould : [ex.httpStatusShould];
        if (status === undefined || !want.includes(status)) extra.should(`HTTP status ${String(status)}, expected ${want.join("|")} (bindings/https/0.3 section 4: SHOULD)`);
      }
      if (ex.httpBody === "json") {
        if (replies.length !== 1) errs.push("expected a body");
        else if (!/^application\/json(\s*;|$)/i.test(extra.transport.contentType ?? "")) errs.push(`Content-Type ${String(extra.transport.contentType)}, expected application/json`);
      } else if (ex.httpBody === "none") {
        if (replies.length !== 0) errs.push("expected no body");
        if (extra.transport.contentType !== undefined) errs.push("a bodiless answer carries a Content-Type");
      }
    }
    if (ex.sameErrorAs !== undefined) {
      const other = earlier[ex.sameErrorAs - 1] === undefined ? undefined : parse(earlier[ex.sameErrorAs - 1]!);
      const a = other?.payload;
      const b = first?.payload;
      if (!isObject(a) || !isObject(b)) errs.push(`sameErrorAs step ${ex.sameErrorAs}: both steps must have produced an error`);
      else {
        for (const k of ["code", "retryable", "message", "details"] as const) {
          if (canonicalJson(a[k] ?? null) !== canonicalJson(b[k] ?? null)) errs.push(`reply differs from step ${ex.sameErrorAs} in ${k} (an existence oracle)`);
        }
      }
    }
    if (ex.state?.documentState !== undefined) {
      for (const [k, want] of Object.entries(ex.state.documentState)) {
        const id = substitute(k, ctx) as string;
        const got = await adapterDocState(id);
        if (got !== want) errs.push(`documentState(${id}) = ${got}, expected ${want}`);
      }
    }
    if (ex.pointer !== undefined && first !== undefined && !heldInstead) {
      const statusTask = extra.caps.ceremony?.statusType !== undefined;
      for (const [ptr, want] of Object.entries(ex.pointer)) {
        // Where the implementation declares a status task a hold names it, not the request's own type, and the continuation value is not
        // stated (SPEC.md 8.6): the `expects` and `continuation` pointers describe the no-status-task form only.
        if (statusTask && (ptr.startsWith("/payload/expects") || ptr === "/payload/continuation")) continue;
        const got = getPointer(first, ptr);
        if (canonicalJson(got ?? null) !== canonicalJson(substitute(want, ctx) ?? null)) {
          const m = `pointer ${ptr}: got ${JSON.stringify(got)}`;
          // SHOULDs: inResponseTo (MUST only where the error is retained, SPEC.md 8.4), and threadId except on a next step (SPEC.md 4.9)
          const soft = (ptr.startsWith("/payload/inResponseTo") && ex.state?.retained === undefined) || (ptr === "/threadId" && !typeOf(first).startsWith(NEXT_STEP_PREFIX));
          if (soft) extra.should(m);
          else errs.push(m);
        }
      }
    }
    if (ex.evidence !== undefined && first !== undefined) {
      const opened = (extra.sentBytes?.[ex.evidence.session - 1] === undefined ? undefined : parse(extra.sentBytes[ex.evidence.session - 1]!));
      const doc = first;
      if (opened === undefined || doc === undefined) errs.push("evidence: the session request or the reply is not a document");
      else errs.push(...evidenceErrors(ex.evidence.checks as EvidenceCheck[], doc, opened));
    }
    if (first !== undefined) {
      for (const [ptr, re] of Object.entries(ex.match ?? {})) {
        const got = getPointer(first, ptr);
        if (typeof got !== "string" || !new RegExp(re).test(got)) errs.push(`pointer ${ptr}: ${JSON.stringify(got)} does not match ${re}`);
      }
      for (const [ptr, bad] of Object.entries(ex.notEqual ?? {})) {
        const got = getPointer(first, ptr);
        for (const b of bad) if (canonicalJson(got ?? null) === canonicalJson(substitute(b, ctx) ?? null)) errs.push(`pointer ${ptr}: must not equal ${JSON.stringify(got)}`);
      }
    }
    return errs;
  })();
}

/**
 * Capture named values from a step's replies. A pointer names a member of the reply the step expects (the response its `expect` matches), and a
 * consumer that holds a task answers with a next step before the response (SPEC.md 8.6), so the first reply need not carry the member: each
 * value is taken from the first reply, in arrival order, in which its pointer resolves. A consumer that answers once is read exactly as before.
 */
export function captureFrom(replies: readonly string[], spec: Record<string, string>, into: Record<string, string>): void {
  const docs = replies.map((r) => parse(r)).filter((d) => d !== undefined);
  for (const [name, ptr] of Object.entries(spec)) {
    for (const doc of docs) {
      const v = getPointer(doc, ptr);
      if (typeof v === "string") { into[name] = v; break; }
      if (typeof v === "number" && Number.isFinite(v)) { into[name] = String(v); break; }
    }
  }
}

export async function runVector(adapter: Adapter, source: Vector, env: EngineEnv): Promise<VectorOutcome> {
  const failures: string[] = [];
  const advisories: string[] = [];
  const observed: { code: string; accepted: string[] }[] = [];
  const strict = strictRun(env);
  await adapter.reset();
  const window = env.window ?? PROFILE_WINDOW;
  // Rebase mode: real time (whole seconds) is the clock start, and absolute timestamps of the vector keep their relation to it.
  // Ceremony steps relative to the declared essential governance become concrete sends from the authority set (src/runner/essential.ts).
  const expanded = source.steps.some((s) => s.quorum !== undefined) ? { ...source, steps: expandQuorum(source.steps, env.caps, env.actors) } : source;
  const vector = env.clockless === true ? rebaseVector(expanded, Math.floor(Date.now() / 1000) * 1000, env.defaultClockStart) : expanded;
  const start = env.clockless === true ? (vector.clockStart === undefined ? Math.floor(Date.now() / 1000) * 1000 : Date.parse(vector.clockStart)) : Date.parse(vector.clockStart ?? env.defaultClockStart);
  const setClock = async (ms: number): Promise<void> => {
    if (env.clockless !== true) await adapter.setClock(new Date(ms).toISOString());
  };
  let nowMs = start;
  await setClock(nowMs);
  let atOffset = 0;
  let previous: BuiltSend | undefined;
  let previousFrom: SendFrom = { kind: "actor", vid: env.actors.A!.vid };
  let previousReplies: string[] | undefined;
  const captures: Record<string, string> = {};
  const stepFirstReplies: (string | undefined)[] = [];
  const sentBytes: (string | undefined)[] = [];
  const retainedOf = async (id: string, side: "request" | "reply"): Promise<string> => String((await adapter.observe({ query: "retained", id, side })).value);
  const storedOf = async (kind: string, digest?: string): Promise<number> =>
    Number((await adapter.observe({ query: "stored", kind, ...(digest === undefined ? {} : { digest }) })).value);
  const storedNow = async (): Promise<number> => Number((await adapter.observe({ query: "stored", kind: "vrc" })).value);
  const carrier = env.caps.carriers.find((c) => c.class === "consequential")?.typeUri ?? "";
  const quiet = env.quiet ?? minimumQuiet(env.caps);

  for (const [i, step] of vector.steps.entries()) {
    const label = `step ${i + 1}`;
    const should = (m: string): void => void (strict ? failures : advisories).push(`${label}: ${m}`);
    // validateReply takes a collector of plain messages; label them here
    // An observation the text permits (a MAY): recorded, never escalated on the attested profile.
    const note = (m: string): void => void advisories.push(`${label}: ${m}`);
    const advisoriesAt = (l: string): { push: (m: string) => unknown } => ({ push: (m: string) => advisories.push(`${l}: ${m}`) });
    if (step.when !== undefined && step.when.proposerApproves !== env.caps.ceremony?.proposerApproves) {
      stepFirstReplies[i] = undefined;
      continue;
    }
    try {
      if (step.atAbsolute !== undefined) nowMs = Date.parse(step.atAbsolute);
      else {
        if (step.at !== undefined) atOffset = parseAt(step.at, window);
        nowMs = start + atOffset;
      }
      await setClock(nowMs);
      // Rebase mode with a literal small offset: let the real time pass (docs/04 section 7), then build the step on the real clock.
      if (env.clockless === true && step.at !== undefined && realWaitMs(step.at) !== undefined) {
        const wait = nowMs - Date.now();
        if (wait > 0) await (env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
      }
      const carrierPayload = env.caps.carriers.find((c) => c.class === "consequential")?.validPayload;
      const discoveryType = discoveryTypeOf(env.caps.supportedTypes);
      const ctx: BuildContext = { vectorId: vector.id, iutVid: env.iutVid, actors: env.actors, carrier, ...(discoveryType === undefined ? {} : { discoveryType }), ...(env.caps.ceremony === undefined ? {} : { ceremony: env.caps.ceremony }), ...(carrierPayload === undefined ? {} : { carrierPayload }), ...(env.caps.governance?.roles === undefined ? {} : { roles: env.caps.governance.roles }), nowMs, startMs: start, captures, window, ...(env.salt === undefined ? {} : { salt: env.salt }) };

      if (step.restart === true) {
        await adapter.restart();
        stepFirstReplies[i] = undefined;
        continue;
      }
      if (step.verifyProof !== undefined) {
        const bytes = readFileSync(join(env.fixtureRoot, step.verifyProof.file), "utf8");
        const res = await adapter.verifyProof({ bytes });
        const got = res.valid ? "valid" : "invalid";
        if (got !== step.verifyProof.expect) failures.push(`${label}: ${step.verifyProof.file} is ${got}, expected ${step.verifyProof.expect}`);
        continue;
      }
      if (step.verifyReceipt !== undefined) {
        if (adapter.verifyReceipt === undefined) throw new Error("the adapter implements no verifyReceipt method");
        const scenario = buildReceiptScenario(step.verifyReceipt.scenario, ctx, env.fixtureRoot);
        const res = await adapter.verifyReceipt(scenario.params);
        const want = Array.isArray(step.verifyReceipt.expect.outcome) ? step.verifyReceipt.expect.outcome : [step.verifyReceipt.expect.outcome];
        if (!(want as string[]).includes(res.outcome)) failures.push(`${label}: verifyReceipt gave ${res.outcome}, expected ${want.join(" or ")}${res.reason === undefined ? "" : ` (${res.reason})`}`);
        continue;
      }
      if (step.observePushed !== undefined) {
        if (!env.caps.optional.includes("observe.pushed")) throw new Error("the adapter does not declare observe.pushed");
        for (const e of await pushedErrors(adapter, step.observePushed, ctx, env.iutVid, env.sleep, quiet.minimumMs)) failures.push(`${label}: ${e}`);
        stepFirstReplies[i] = undefined;
        continue;
      }
      if (step.trigger !== undefined) {
        const args = substitute(step.trigger.args ?? {}, ctx) as Record<string, unknown>;
        const handledBefore = Number((await adapter.observe({ query: "handled" })).value);
        const res = await adapter.trigger(step.trigger.action, args);
        const handledAfter = Number((await adapter.observe({ query: "handled" })).value);
        // Helper actions return a JSON value, not a Trust Task document (docs/04 section 4.4): only captured, never validated as a reply.
        for (const reply of HELPER_ACTIONS.has(step.trigger.action) ? [] : res.documents) {
          for (const e of validateReply(reply, previous?.doc, previousFrom, env, nowMs, advisoriesAt(label))) failures.push(`${label}: ${e}`);
        }
        if (step.capture !== undefined) captureFrom(res.documents.slice(0, 1), step.capture, captures);
        if (step.expect !== undefined) {
          const errs = await checkExpect(step.expect, res.documents, undefined, handledBefore, handledAfter, await storedNow(), ctx, async (id) => String((await adapter.observe({ query: "documentState", id })).value), storedOf, stepFirstReplies, { caps: env.caps, should, note, strict });
          for (const e of errs) failures.push(`${label}: ${e}`);
        }
        stepFirstReplies[i] = res.documents[0];
        continue;
      }
      if (step.emit !== undefined) {
        if (adapter.emit === undefined) throw new Error("the adapter implements no emit method");
        const args = substitute(step.emit.args ?? {}, ctx) as Record<string, unknown>;
        const res = await adapter.emit({ type: step.emit.type, args });
        for (const n of res.standIn ?? []) advisories.push(`${label}: ${n}`);
        const task = loadTask(step.emit.type);
        if (task === undefined) failures.push(`${label}: the pinned @openvtc/trust-tasks has no ${step.emit.type}`);
        else if (res.documents.length === 0) failures.push(`${label}: nothing was emitted for ${step.emit.type}`);
        else for (const e of emittedErrors(task, step.emit.type, res.documents, { should: (m: string) => void (strict ? failures : advisories).push(`${label}: ${m}`), ...(typeof args.recipient === "string" ? { recipient: args.recipient } : {}) })) failures.push(`${label}: ${e}`);
        stepFirstReplies[i] = res.documents[0];
        continue;
      }
      const send = step.send!;
      const built = buildSend(send, ctx, previous);
      const from = resolveFrom(send.from, ctx, send.same === "previous" ? previousFrom : send.raw !== undefined ? { kind: "none" } : { kind: "actor", vid: env.actors.A!.vid });
      const handledBefore = Number((await adapter.observe({ query: "handled" })).value);
      const useHttp = send.http !== undefined && env.caps.bindings.includes("https");
      const result = await adapter.send({ from, bytes: built.bytes, ...(useHttp ? { http: send.http! } : {}) });
      const handledAfter = Number((await adapter.observe({ query: "handled" })).value);
      if (step.capture !== undefined) captureFrom(result.replies, step.capture, captures);

      for (const reply of result.replies) {
        for (const e of validateReply(reply, built.doc, from, env, nowMs, advisoriesAt(label))) failures.push(`${label}: ${e}`);
      }
      const ex = step.expect!;
      stepFirstReplies[i] = result.replies[0];
      sentBytes[i] = built.bytes;
      const errs = await checkExpect(ex, result.replies, previousReplies, handledBefore, handledAfter, await storedNow(), ctx, async (id) => String((await adapter.observe({ query: "documentState", id })).value), storedOf, stepFirstReplies, { observed, transport: result.transport, caps: env.caps, should, note, strict, request: built.doc, sentBytes, retained: retainedOf });
      for (const e of errs) failures.push(`${label}: ${e}`);
      // A verdict that rests on no reply needs the adapter to have watched for one at least the minimum quiet period. The engine cannot
      // ask again (a later reply is not attributable to this step), so a shorter period is a failure, never a pass on silence.
      const short = quietFailure(ex, result, quiet);
      if (short !== undefined) failures.push(`${label}: ${short}`);
      previous = built;
      previousFrom = from;
      // A duplicate answers with the first reply: keep the original reply set.
      if (ex.disposition === "response") previousReplies = result.replies;
    } catch (err) {
      failures.push(`${label}: adapter or harness error: ${(err as Error).message}`);
    }
  }
  const pass = failures.length === 0;
  // only a vector that accepts permissionDenied beside a task's own code says which one it saw
  const twoWay = observed.some((o) => o.accepted.includes("permissionDenied") && o.accepted.some((c) => c !== "permissionDenied"));
  return {
    pass, failures, advisories,
    ...(twoWay ? { observedCodes: observed.map((o) => o.code) } : {}),
    ...(twoWay && pass && observed.every((o) => o.code === "permissionDenied") ? { acceptedOnlyGate: true as const } : {}),
  };
}
