// SPDX-License-Identifier: Apache-2.0
// Turns a vector step into bytes: templates, `$`-token substitution, mutation, signing.
import { createHash } from "node:crypto";
import type { Ed25519Signer } from "../crypto/didkey.ts";
import { signDocument } from "../crypto/proof.ts";
import { buildSdJwtPresentation } from "../crypto/sdjwt.ts";
import { specifiedProofPurpose } from "../crypto/proof-purpose.ts";
import { deepClone, isObject } from "../util/json.ts";
import { removePointer, setPointer } from "../util/pointer.ts";
import { digestMultibase } from "../crypto/digest.ts";
import { jcsBytes } from "../util/json.ts";
import { toMultibase, fromMultibase } from "../crypto/base58.ts";
import type { AcceptanceWindow, CeremonyDecl } from "../adapter/contract.ts";
import { PROFILE_WINDOW } from "./window.ts";
import type { CredentialSpec, Mutation, PresentationSpec, SendSpec, VrcSpec, WitnessSpec } from "../vectors/types.ts";

export const PROPOSE_TYPE = "https://trusttasks.org/spec/vrc/relationships/propose/0.1";
export const ISSUE_TYPE = "https://trusttasks.org/spec/vrc/relationships/issue/0.1";

export interface Actor {
  name: string;
  signer: Ed25519Signer;
  vid: string;
}

export interface BuildContext {
  vectorId: string;
  iutVid: string;
  actors: Record<string, Actor>;
  carrier: string;
  /** The discovery Type URI the implementation serves (`discoveryTypeOf`); default 0.4. */
  discoveryType?: string;
  /** The carrier's declared valid payload (`CarrierDecl.validPayload`); default `{subject}`. */
  carrierPayload?: Record<string, unknown>;
  /** The role values the deployment declared (`Capabilities.governance.roles`), for `$role(n)`. The suite never supplies one. */
  roles?: string[];
  nowMs: number;
  /** The vector's clock start: a built credential is dated here, so a redelivery later is byte-identical. */
  startMs?: number;
  /** Values captured from earlier replies (`$cap(name)`) and digests of built credentials (`$digest(name)`). */
  captures?: Record<string, string>;
  /** The implementation's declared ceremony family (`Capabilities.ceremony`), for the `ceremony.*` templates. */
  ceremony?: CeremonyDecl;
  /** The effective acceptance window: `$nowAt(-windowMaxAge,...)` and symbolic `at` offsets read it. Default: the profile pins. */
  window?: AcceptanceWindow;
  /** The run salt (docs/04 section 7): mixed into every deterministic document id so a second run against a durable peer does not replay the first run's ids. Empty or absent: unsalted ids. */
  salt?: string;
}

export const CONSENT_REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
export const CONSENT_DECISION_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.2";
export const CEX_ISSUE_TYPE = "https://trusttasks.org/spec/credential-exchange/issue/0.1";
export const CEX_PRESENT_TYPE = "https://trusttasks.org/spec/credential-exchange/present/0.1";
export const CEX_QUERY_TYPE = "https://trusttasks.org/spec/credential-exchange/query/0.1";
export const CEX_OFFER_TYPE = "https://trusttasks.org/spec/credential-exchange/offer/0.1";
export const CEX_REQUEST_TYPE = "https://trusttasks.org/spec/credential-exchange/request/0.1";
export const CONSENT_GRANTED_TYPE = "https://trusttasks.org/spec/task-consent/granted/0.1";
export const CONSENT_DECISION_01_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.1";
/** The credential type the query vectors ask for, and the one the holder helper `holdCredential` makes the implementation hold (an expanded type IRI, as DCQL `type_values` names it). */
export const QUERY_CRED_TYPE = "https://example.org/conformance#ConformanceCredential";
export const WITNESS_SHARE_TYPE = "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1";
export const WITNESS_SHARE_DOMAIN = "vrc:witness-share";
export const SESSION_TYPE = "https://trusttasks.org/spec/witness/session/0.2";
export const SUBMIT_TYPE = "https://trusttasks.org/spec/witness/session/submit/0.2";
export const ERROR_TYPE = "https://trusttasks.org/spec/trust-task-error/0.6";
export const DISCOVERY_TYPE = "https://trusttasks.org/spec/trust-task-discovery/0.4";
/** trust-task-discovery 0.1 (the witness vectors, docs/13): its response rules 3 and 4 are those the engine already checks. */
export const DISCOVERY_TYPE_V0_1 = "https://trusttasks.org/spec/trust-task-discovery/0.1";
export const DISCOVERY_TYPE_V0_3 = "https://trusttasks.org/spec/trust-task-discovery/0.3";

/**
 * The discovery version the implementation serves: 0.4 when it declares it, else 0.3 (the pattern grammar and the response are the same;
 * 0.4 adds `expiryHorizonSeconds` to the window), else undefined. The DIS vectors run against whichever it serves.
 */
export function discoveryTypeOf(supportedTypes: readonly string[]): string | undefined {
  if (supportedTypes.includes(DISCOVERY_TYPE)) return DISCOVERY_TYPE;
  if (supportedTypes.includes(DISCOVERY_TYPE_V0_3)) return DISCOVERY_TYPE_V0_3;
  return undefined;
}
export const CONTROL_TYPE = "https://trusttasks.org/spec/trust-task-control/0.1";

export function parseOffsetMs(text: string): number {
  const m = /^([+-])(\d+)(ms|s|m|h)$/.exec(text);
  if (m === null) throw new Error(`bad offset ${text}`);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[3] as "ms" | "s" | "m" | "h"];
  return (m[1] === "-" ? -1 : 1) * Number(m[2]) * unit;
}

/**
 * Offset text: a sequence of terms, each a sign and either a literal (`5m`, `30s`, `250ms`, `1h`) or a window member
 * (`windowMaxAge`, `windowSkew`, `windowHorizon`), for example `+windowMaxAge+windowSkew+0s`.
 */
export function parseAt(text: string, window: AcceptanceWindow = PROFILE_WINDOW): number {
  const term = /([+-])(\d+(?:ms|s|m|h)|windowMaxAge|windowSkew|windowHorizon)/y;
  let total = 0;
  let pos = 0;
  while (pos < text.length) {
    term.lastIndex = pos;
    const m = term.exec(text);
    if (m === null) throw new Error(`bad offset ${text}`);
    const sign = m[1] === "-" ? -1 : 1;
    const t = m[2]!;
    if (t === "windowMaxAge") total += sign * window.maxAgeSeconds * 1000;
    else if (t === "windowSkew") total += sign * window.clockSkewSeconds * 1000;
    else if (t === "windowHorizon") total += sign * window.expiryHorizonSeconds * 1000;
    else total += parseOffsetMs(`${m[1]}${t}`);
    pos = term.lastIndex;
  }
  return total;
}

export function deterministicId(vectorId: string, name: string, salt = ""): string {
  const h = createHash("sha256").update(salt === "" ? `${vectorId}/${name}` : `${salt}/${vectorId}/${name}`).digest("hex");
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function isoMs(ms: number): string {
  const s = new Date(ms).toISOString();
  return s.endsWith(".000Z") ? s.slice(0, -5) + "Z" : s;
}

/** Substitute whole-string `$` tokens anywhere in a JSON value. */
export function substitute(value: unknown, ctx: BuildContext): unknown {
  if (typeof value === "string") {
    // `$capJson(name)`: a captured value that holds JSON text (a built presentation), put in as the JSON value itself
    const json = /^\$capJson\(([^)]+)\)$/.exec(value);
    if (json !== null && ctx.captures?.[json[1]!] !== undefined) return JSON.parse(ctx.captures[json[1]!]!) as unknown;
    return substituteString(value, ctx);
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (isObject(value)) {
    const variant = carrierVariant(value, ctx);
    if (variant !== undefined) return variant;
  }
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, ctx)]));
  return value;
}

/** `{"$carrierInvalid": true}`: the carrier's valid payload with its first member given the wrong type. `{"$carrierExtra": true}`: plus an unknown member. */
function carrierVariant(value: Record<string, unknown>, ctx: BuildContext): Record<string, unknown> | undefined {
  const base = deepClone(ctx.carrierPayload ?? { subject: "did:web:alice.example" });
  if (value["$carrierInvalid"] === true) {
    const first = Object.keys(base)[0];
    return first === undefined ? { unexpected: 5 } : { ...base, [first]: typeof base[first] === "number" ? "not-a-number" : 5 };
  }
  if (value["$carrierExtra"] === true) return { ...base, extra: true };
  return undefined;
}

/**
 * `$mint(name)` (S-01): a short lowercase token (`m` and 15 hex digits) that is a hash of the run salt, the vector id and the name, so a re-run with
 * another salt names a new object; it satisfies a segment, key or room-name pattern, which a `$id` (a `urn:uuid`) does not. It may sit inside a longer string
 * (`github.com/$mint(own)/widgets`). With `--salt ""` it is the same on every run, as `$id` is.
 */
export function mintToken(vectorId: string, name: string, salt = ""): string {
  const h = createHash("sha256").update(salt === "" ? `mint/${vectorId}/${name}` : `${salt}/mint/${vectorId}/${name}`).digest("hex");
  return `m${h.slice(0, 15)}`;
}

export function substituteString(s: string, ctx: BuildContext): string {
  if (s.includes("$mint(")) return s.replace(/\$mint\(([^)]+)\)/g, (_m, n: string) => mintToken(ctx.vectorId, n, ctx.salt));
  if (!s.startsWith("$")) return s;
  if (s === "$iut") return ctx.iutVid;
  if (s === "$carrier") return ctx.carrier;
  if (s === "$carrierResponse") return `${ctx.carrier}#response`;
  if (s === "$discovery") return ctx.discoveryType ?? DISCOVERY_TYPE;
  if (s === "$discoveryResponse") return `${ctx.discoveryType ?? DISCOVERY_TYPE}#response`;
  // The carrier's own Type URI with its MAJOR raised: a version of a served family that no implementation serves (ENV-010).
  if (s === "$carrierMajor") return ctx.carrier.replace(/(\d+)\.(\d+)$/, (_m, major: string) => `${Number(major) + 1}.0`);
  const role = /^\$role\((\d+)\)$/.exec(s);
  if (role !== null) {
    const r = ctx.roles?.[Number(role[1]) % Math.max(1, ctx.roles?.length ?? 1)];
    if (r === undefined) throw new Error("governance not declared: the implementation declares no governance.roles");
    return r;
  }
  const actor = /^\$([A-Z])$/.exec(s);
  if (actor !== null && ctx.actors[actor[1]!] !== undefined) return ctx.actors[actor[1]!]!.vid;
  const cerType = /^\$cer(Type|Response)\((begin|approve|reset|status)\)$/.exec(s);
  if (cerType !== null) {
    const c = ctx.ceremony;
    if (c === undefined) throw new Error("the implementation declares no ceremony family");
    const t = { begin: c.beginType, approve: c.approveType, reset: c.resetType, status: c.statusType }[cerType[2] as "begin" | "approve" | "reset" | "status"];
    if (t === undefined) throw new Error("the implementation declares no status task");
    return cerType[1] === "Response" ? `${t}#response` : t;
  }
  const id = /^\$id\(([^)]+)\)$/.exec(s);
  if (id !== null) return deterministicId(ctx.vectorId, id[1]!, ctx.salt);
  const cap = /^\$cap\(([^)]+)\)$/.exec(s);
  if (cap !== null) return ctx.captures?.[cap[1]!] ?? s;
  const dig = /^\$digest\(([^)]+)\)$/.exec(s);
  if (dig !== null) return ctx.captures?.[`digest:${dig[1]!}`] ?? s;
  const at = /^\$nowAt\(([^)]*)\)$/.exec(s);
  if (at !== null) return isoMs(ctx.nowMs + nowAtOffset(at[1]!, ctx));
  const now = /^\$now([+-]\d+(?:ms|s|m|h))$/.exec(s);
  if (now !== null) return isoMs(ctx.nowMs + parseOffsetMs(now[1]!));
  return s;
}

/**
 * `$nowAt(-maxAge,+60s)`: now plus the sum of terms. A term is a sign and either a number of seconds (`60s`) or the name of a
 * captured value that holds a number of seconds (an advertised acceptance window member).
 */
function nowAtOffset(terms: string, ctx: BuildContext): number {
  let total = 0;
  for (const raw of terms.split(",")) {
    const m = /^([+-])(?:(\d+)s|([A-Za-z][A-Za-z0-9]*))$/.exec(raw.trim());
    if (m === null) throw new Error(`bad $nowAt term ${raw}`);
    const w = ctx.window ?? PROFILE_WINDOW;
    const named = { windowMaxAge: w.maxAgeSeconds, windowSkew: w.clockSkewSeconds, windowHorizon: w.expiryHorizonSeconds }[m[3] as "windowMaxAge"];
    const seconds = m[2] !== undefined ? Number(m[2]) : named !== undefined ? named : Number(ctx.captures?.[m[3]!]);
    if (!Number.isFinite(seconds)) throw new Error(`$nowAt: no numeric capture named ${String(m[3])}`);
    total += (m[1] === "-" ? -1 : 1) * seconds * 1000;
  }
  return total;
}

/**
 * The document a named template builds, with its tokens left in place, for the reachable-code audit (src/coverage/reachable.ts, F3-01): the audit reads the task the template
 * sends and the payload members it carries. A template that needs a run-time value (the carrier's own type, a captured thread) answers undefined or carries the token.
 */
export function templateDocument(name: string): Record<string, unknown> | undefined {
  try { return template(name, { captures: {}, vectorId: "audit", salt: "" } as unknown as BuildContext); } catch { return undefined; }
}

function template(name: string, ctx: BuildContext): Record<string, unknown> {
  switch (name) {
    case "carrier.request":
      return {
        id: "$id(req)", type: "$carrier", issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: ctx.carrierPayload === undefined ? { subject: "did:web:alice.example" } : deepClone(ctx.carrierPayload),
      };
    case "ceremony.begin":
    case "ceremony.approve":
    case "ceremony.reset":
    case "ceremony.status": {
      const c = ctx.ceremony;
      if (c === undefined) throw new Error("the implementation declares no ceremony family");
      const kind = name.slice("ceremony.".length) as "begin" | "approve" | "reset" | "status";
      const type = { begin: c.beginType, approve: c.approveType, reset: c.resetType, status: c.statusType }[kind];
      const payload = { begin: c.beginPayload, approve: c.approvePayload, reset: c.resetPayload, status: c.statusPayload }[kind];
      if (type === undefined || payload === undefined) throw new Error("the implementation declares no status task (statusType and statusPayload)");
      const id = { begin: "$id(begin)", approve: "$id(app)", reset: "$id(rst)", status: "$id(sts)" }[kind];
      return { id, threadId: "$id(begin)", type, issuer: kind === "approve" ? "$X" : "$A", recipient: "$iut", issuedAt: "$now+0s", payload: deepClone(payload) };
    }
    case "consent.decision":
      return {
        id: "$id(dec)", type: CONSENT_DECISION_TYPE, issuer: "$X", recipient: "$iut", issuedAt: "$now+0s",
        payload: { challenge: "$cap(consentChallenge)", payloadDigest: "$cap(consentDigest)", decision: "approve" },
      };
    case "consent.request":
      return {
        id: "$id(creq)", type: CONSENT_REQUEST_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: {
          challenge: "9c1f4b7a2e6d80f35a4c9b1e7d2f6083", taskType: "https://trusttasks.org/spec/conformance/widget/0.1",
          payloadDigest: "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d", sideEffects: "mutating", exposure: { discloses: "none", actsAsSubject: false },
          effects: [{ kind: "documentChange", summary: "Changes one record." }], requester: "$Q", approverSet: "operators", minApprovals: 1,
          excludeRequester: false, expiresAt: "$nowAt(+600s)",
        },
      };
    case "cex.issue":
      return { id: "$id(cxi)", type: CEX_ISSUE_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: {} };
    case "cex.query":
      return {
        id: "$id(qry)", threadId: "$id(qry)", type: CEX_QUERY_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: {
          dcql_query: { credentials: [{ id: "membership", format: "ldp_vc", meta: { type_values: [[QUERY_CRED_TYPE]] } }] },
          nonce: "qry-nonce-0001", purpose: "to confirm your membership before admitting you to the community",
        },
      };
    case "cex.offer":
      return {
        id: "$id(off)", threadId: "$id(off)", type: CEX_OFFER_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { credential_offer: { credential_issuer: "https://issuer.example", credential_configuration_ids: ["https://example.org/conformance#ConformanceCredential"] } },
      };
    case "cex.request":
      return {
        id: "$id(crq)", threadId: "$id(crq)", type: CEX_REQUEST_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { credential_request: { credential_configuration_id: "https://example.org/conformance#ConformanceCredential", proofs: { jwt: ["eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5pZDR2Y2ktcHJvb2Yrand0In0.e30.c2ln"] } } },
      };
    case "consent.granted":
      return {
        id: "$id(grt)", threadId: "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d", type: CONSENT_GRANTED_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { status: "granted", payloadDigest: "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d", taskType: "https://trusttasks.org/spec/conformance/widget/0.1" },
      };
    case "cex.present":
      return { id: "$id(cxp)", threadId: "$cap(presThread)", type: CEX_PRESENT_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: {} };
    case "propose.request":
      return {
        id: "$id(req)", threadId: "$id(req)", type: PROPOSE_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { relationshipDid: "$R" },
      };
    case "issue.request":
      return {
        id: "$id(iss)", threadId: "$id(req)", type: ISSUE_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: {},
      };
    case "witness-share.request":
      return {
        id: "$id(wsh)", threadId: "$id(req)", type: WITNESS_SHARE_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: {},
      };
    case "discovery.request":
      return {
        id: "$id(dis)", type: "$discovery", issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: {},
      };
    case "error.inbound":
      return {
        id: "$id(err)", threadId: "$id(req)", type: ERROR_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { code: "taskFailed", message: "failed", retryable: false, inResponseTo: { typeUri: "$carrier", id: "$id(req)" } },
      };
    case "control.cancel":
      return {
        id: "$id(ctl)", type: CONTROL_TYPE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s",
        payload: { operation: "cancel", target: { id: "$id(req)" } },
      };
    default:
      throw new Error(`unknown template ${name}`);
  }
}

export interface BuiltSend {
  bytes: string;
  doc: Record<string, unknown> | undefined;
}

function applyMutation(doc: Record<string, unknown>, m: Mutation, ctx: BuildContext): void {
  if (m.op === "set") setPointer(doc, m.path!, substitute(m.value, ctx));
  else if (m.op === "remove") removePointer(doc, m.path!);
}

/** A relationship credential as the issue payload carries it, signed with an inner proof; returns it and its digest. */
export function buildVrc(spec: VrcSpec, ctx: BuildContext): { vrc: Record<string, unknown>; digest: string } {
  const issuer = substituteString(spec.issuer ?? "$R", ctx);
  const subject = substituteString(spec.subject ?? "$cap(ibr)", ctx);
  const signerActor = spec.signer !== undefined
    ? ctx.actors[spec.signer]
    : Object.values(ctx.actors).find((a) => a.vid === issuer);
  if (signerActor === undefined) throw new Error(`vrc: no actor signs for ${issuer}`);
  const body: Record<string, unknown> = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "VerifiableRelationshipCredential"],
    issuer,
    validFrom: isoMs(ctx.startMs ?? ctx.nowMs),
    issuerScope: "pairwise",
    credentialSubject: { id: subject, ...(spec.nonce === undefined ? {} : { nonce: spec.nonce }) },
  };
  let vrc: Record<string, unknown> = signDocument(body, signerActor.signer, {
    created: ctx.startMs ?? ctx.nowMs,
    purpose: spec.purpose ?? "assertionMethod",
    ...(spec.allowIssuerMismatch === true || signerActor.vid !== issuer ? { allowIssuerMismatch: true } : {}),
  });
  if (spec.corrupt === true) {
    const proof = vrc.proof as Record<string, unknown>;
    const raw = fromMultibase(String(proof.proofValue));
    raw[0] = raw[0]! ^ 0x01;
    vrc = { ...vrc, proof: { ...proof, proofValue: toMultibase(raw) } };
  }
  return { vrc, digest: digestMultibase(vrc) };
}

/** A W3C Data-Integrity credential as `credential-exchange/issue` and `present` carry it; dated at the vector's clock start so a redelivery is byte-identical. */
export function buildCredential(spec: CredentialSpec, ctx: BuildContext): Record<string, unknown> {
  const issuer = substituteString(spec.issuer ?? "$A", ctx);
  const signerActor = spec.signer !== undefined ? ctx.actors[spec.signer] : Object.values(ctx.actors).find((a) => a.vid === issuer);
  if (signerActor === undefined) throw new Error(`credential: no actor signs for ${issuer}`);
  const body: Record<string, unknown> = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "MembershipCredential"],
    issuer,
    validFrom: isoMs(ctx.startMs ?? ctx.nowMs),
    credentialSubject: { id: substituteString(spec.subject ?? "$iut", ctx), ...(spec.nonce === undefined ? {} : { nonce: spec.nonce }) },
  };
  let vc: Record<string, unknown> = signDocument(body, signerActor.signer, {
    created: ctx.startMs ?? ctx.nowMs,
    purpose: spec.purpose ?? "assertionMethod",
    ...(signerActor.vid !== issuer ? { allowIssuerMismatch: true } : {}),
  });
  if (spec.corrupt === true) {
    const proof = vc.proof as Record<string, unknown>;
    const raw = fromMultibase(String(proof.proofValue));
    raw[0] = raw[0]! ^ 0x01;
    vc = { ...vc, proof: { ...proof, proofValue: toMultibase(raw) } };
  }
  return vc;
}

/** The presentation of a `credential-exchange/present` request: a Data-Integrity VP over one credential, bound by `challenge` (nonce) and `domain` (audience). */
// A keyed vp_token (present 0.2) wraps it as `{ <key>: [presentation] }`; `format: "sd-jwt"` builds an SD-JWT-VC string instead; the
// nonce and audience go in the proof, in the presentation's own signed members, in both or in neither (`nonceAt`, `audienceAt`).
export function buildPresentation(spec: PresentationSpec, ctx: BuildContext): unknown {
  const holder = ctx.actors[spec.holder ?? "A"];
  if (holder === undefined) throw new Error("presentation: unknown holder");
  const signer = ctx.actors[spec.signer ?? holder.name]!;
  const nonce = substituteString(spec.nonce ?? "$cap(presNonce)", ctx);
  const audience = substituteString(spec.audience ?? "$iut", ctx);
  let vp: unknown;
  if (spec.format === "sd-jwt") {
    const issuer = ctx.actors[(spec.credential?.signer ?? spec.credential?.issuer ?? "X").replace(/^\$/, "")];
    if (issuer === undefined) throw new Error("presentation: unknown credential issuer");
    vp = buildSdJwtPresentation({ issuer: issuer.signer, holder: signer.signer, claims: { memberOf: "https://example.org/conformance" }, vct: "https://example.org/conformance#ConformanceCredential", nonce, audience, iatSec: Math.floor((ctx.startMs ?? ctx.nowMs) / 1000) });
  } else {
    const inProof = (at: string | undefined): boolean => at === undefined || at === "proof" || at === "both";
    const inVp = (at: string | undefined): boolean => at === "presentation" || at === "both";
    const vc = buildCredential({ issuer: "$X", subject: `$${holder.name}`, ...(spec.credential ?? {}) }, ctx);
    vp = signDocument(
      {
        "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: holder.vid,
        ...(inVp(spec.nonceAt) ? { nonce: spec.presentationNonce === undefined ? nonce : substituteString(spec.presentationNonce, ctx) } : {}),
        ...(inVp(spec.audienceAt) ? { domain: spec.presentationAudience === undefined ? audience : substituteString(spec.presentationAudience, ctx) } : {}),
        verifiableCredential: [vc],
      },
      signer.signer,
      {
        created: ctx.startMs ?? ctx.nowMs, purpose: spec.purpose ?? "authentication", controllerMember: "holder",
        ...(inProof(spec.nonceAt) ? { challenge: nonce } : {}), ...(inProof(spec.audienceAt) ? { domain: audience } : {}),
        ...(signer.vid === holder.vid ? {} : { allowIssuerMismatch: true }),
      },
    );
  }
  return spec.keyed === undefined ? vp : { [substituteString(spec.keyed, ctx)]: [vp] };
}

/** The multibase spellings of a SHA-256 multihash a citation may use, and a multihash the verifier does not implement. */
export function digestSpelling(value: unknown, kind: "u" | "sha512"): string {
  if (kind === "sha512") {
    return toMultibase(new Uint8Array([0x13, 0x40, ...createHash("sha512").update(jcsBytes(value)).digest()]));
  }
  const raw = new Uint8Array([0x12, 0x20, ...createHash("sha256").update(jcsBytes(value)).digest()]);
  return `u${Buffer.from(raw).toString("base64url")}`;
}

/**
 * The bundle of a witness-share request: a presentation wrapping the sender's witnessed credential, plus the outcome-evidence
 * pair. Everything is dated at the vector's clock start so that a redelivery is byte-identical. Returns the payload and the
 * digest of the credential (the receipt must carry it).
 */
export function buildWitness(spec: WitnessSpec, thread: string, ctx: BuildContext): { payload: Record<string, unknown>; digest: string } {
  const at = ctx.startMs ?? ctx.nowMs;
  const who = (name: string): Actor => {
    const a = ctx.actors[name];
    if (a === undefined) throw new Error(`witness: unknown actor ${name}`);
    return a;
  };
  const R = who(spec.sender ?? "R");
  const W = who("W");
  const mine = ctx.captures?.[spec.mineCapture ?? "ibr"] ?? "";
  const sessionId = deterministicId(ctx.vectorId, "wsess", ctx.salt);
  const inSubject = spec.parties === "subject";
  const partyList = Array.isArray(spec.parties) ? spec.parties.map((p) => substituteString(p, ctx)) : [R.vid, mine];
  // The initiating document: the witness/session request the sender made to the witness.
  const initBody: Record<string, unknown> = {
    id: sessionId, threadId: sessionId, parentThreadId: thread, type: SESSION_TYPE, issuer: R.vid, recipient: W.vid, issuedAt: isoMs(at),
    payload: inSubject ? {} : { parties: partyList },
  };
  if (spec.nestedProof === true) {
    // under payload.ext (a reverse-DNS key, opaque content), so the payload stays valid against the closed session payload schema
    (initBody.payload as Record<string, unknown>).ext = { "org.example.conformance": { attachment: signDocument({ id: "urn:example:attachment", issuer: R.vid }, R.signer, { created: at }) } };
  }
  const sign = (doc: Record<string, unknown>, a: Actor, created: number, extra: { purpose?: string } = {}): Record<string, unknown> =>
    signDocument(doc, a.signer, { created, purpose: extra.purpose ?? "authentication", ...(doc.issuer === a.vid ? {} : { allowIssuerMismatch: true }) });
  // The citation is computed over the document without its top-level proof (framework 4.9.3).
  const cited = digestMultibase(initBody);
  let initiating: Record<string, unknown> = initBody;
  if (spec.alterInitiating === true) initiating = { ...initBody, payload: { ...(initBody.payload as Record<string, unknown>), ext: { "org.example.conformance": { note: "altered after the citation" } } } };
  const initMode = spec.initiating ?? "signed";
  if (initMode === "signed") initiating = sign(initiating, R, at);
  else if (initMode === "resigned") initiating = sign(sign(initiating, R, at), R, at + 7000);
  const taskDigest =
    spec.digest === "none" ? undefined
    : spec.digest === "wrong" ? digestMultibase({ other: true })
    : spec.digest === "u" || spec.digest === "sha512" ? digestSpelling(initBody, spec.digest)
    : cited;
  const vwcSigner = who(spec.vwcSigner ?? "W");
  const vwcBody: Record<string, unknown> = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "VerifiableWitnessCredential"],
    issuer: W.vid,
    validFrom: isoMs(at),
    taskContext: spec.taskContext === undefined ? sessionId : substituteString(spec.taskContext, ctx),
    ...(taskDigest === undefined ? {} : { taskDigestMultibase: taskDigest }),
    credentialSubject: { id: substituteString(spec.subject ?? "$" + R.name, ctx), ...(inSubject ? { parties: [R.vid, mine] } : {}) },
  };
  let vwc = signDocument(vwcBody, vwcSigner.signer, { created: at, purpose: "assertionMethod", ...(vwcSigner.vid === W.vid ? {} : { allowIssuerMismatch: true }) }) as Record<string, unknown>;
  if (spec.corruptVwc === true) {
    const proof = vwc.proof as Record<string, unknown>;
    const raw = fromMultibase(String(proof.proofValue));
    raw[0] = raw[0]! ^ 0x01;
    vwc = { ...vwc, proof: { ...proof, proofValue: toMultibase(raw) } };
  }
  const vpSigner = who(spec.vpSigner ?? R.name);
  const vp = signDocument(
    { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: R.vid, verifiableCredential: [vwc] },
    vpSigner.signer,
    {
      created: at, purpose: "authentication", controllerMember: "holder",
      challenge: spec.challenge === undefined ? thread : substituteString(spec.challenge, ctx),
      domain: spec.domain === undefined ? WITNESS_SHARE_DOMAIN : spec.domain,
      ...(vpSigner.vid === R.vid ? {} : { allowIssuerMismatch: true }),
    },
  ) as Record<string, unknown>;
  const termSigner = who(spec.terminalSigner ?? "W");
  const termType =
    spec.terminalType === undefined ? `${SUBMIT_TYPE}#response`
    : spec.terminalType === "error" ? ERROR_TYPE
    : spec.terminalType === "session" ? `${SESSION_TYPE}#response`
    : spec.terminalType;
  let terminal: Record<string, unknown> = {
    id: deterministicId(ctx.vectorId, "wterm", ctx.salt),
    threadId: spec.terminalThread === undefined ? sessionId : substituteString(spec.terminalThread, ctx),
    type: termType, issuer: termSigner.vid, recipient: R.vid, issuedAt: isoMs(at),
    payload: spec.terminalType === "error" ? { code: "taskFailed", message: "failed", retryable: false } : { vwc },
  };
  if (spec.terminalProof !== "none") terminal = sign(terminal, termSigner, at);
  return {
    payload: { presentation: vp, outcomeEvidence: { initiating, terminal } },
    digest: digestMultibase(vwc),
  };
}

export function buildSend(send: SendSpec, ctx: BuildContext, previous: BuiltSend | undefined): BuiltSend {
  const mutations = send.mutate ?? [];
  let doc: Record<string, unknown> | undefined;
  let signAsDefault: boolean;

  if (send.raw !== undefined) {
    let text = send.raw;
    if (ctx.salt !== undefined && ctx.salt !== "") {
      // fixture ids are literals in the text: map each to a salted id, consistently, so equal ids stay equal
      text = text.replace(/urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => deterministicId("fixture", u, ctx.salt));
    }
    for (const [from, to] of Object.entries(send.substitute ?? {})) text = text.split(from).join(substituteString(to, ctx));
    let bytes = text;
    for (const m of mutations) bytes = textMutation(bytes, m);
    return { bytes, doc: tryParse(bytes) };
  }
  if (send.same === "previous") {
    if (previous?.doc === undefined) throw new Error("same: previous has no document");
    doc = deepClone(previous.doc);
    signAsDefault = false;
  } else if (send.template !== undefined) {
    doc = substitute(template(send.template, ctx), ctx) as Record<string, unknown>;
    if (send.params !== undefined) {
      for (const [k, v] of Object.entries(send.params)) {
        if (isObject(v) && v["$omit"] === true) delete doc[k];
        else doc[k] = substitute(v, ctx);
      }
    }
    signAsDefault = true;
  } else {
    doc = substitute(deepClone(send.document), ctx) as Record<string, unknown>;
    signAsDefault = doc.proof === undefined;
  }

  if (send.vrc !== undefined) {
    const built = buildVrc(send.vrc, ctx);
    const payload = (isObject(doc.payload) ? doc.payload : (doc.payload = {})) as Record<string, unknown>;
    payload.vrc = built.vrc;
    if (send.vrc.digest !== "none") payload.vrcDigestMultibase = send.vrc.digest === "wrong" ? digestMultibase({ other: true }) : built.digest;
    if (ctx.captures !== undefined) ctx.captures[`digest:${send.vrc.name ?? "vrc"}`] = built.digest;
  }
  if (send.credential !== undefined) {
    const payload = (isObject(doc.payload) ? doc.payload : (doc.payload = {})) as Record<string, unknown>;
    payload.credential_response = { credential: buildCredential(send.credential, ctx) };
  }
  if (send.presentation !== undefined) {
    const payload = (isObject(doc.payload) ? doc.payload : (doc.payload = {})) as Record<string, unknown>;
    payload.vp_token = buildPresentation(send.presentation, ctx);
  }
  if (send.witness !== undefined) {
    const built = buildWitness(send.witness, String(doc.threadId ?? doc.id), ctx);
    const payload = (isObject(doc.payload) ? doc.payload : (doc.payload = {})) as Record<string, unknown>;
    Object.assign(payload, built.payload);
    if (ctx.captures !== undefined) ctx.captures[`digest:${send.witness.name ?? "vwc"}`] = built.digest;
  }
  for (const m of mutations.filter((x) => x.afterSign !== true)) applyMutation(doc, m, ctx);

  if (send.sign !== null && (send.sign !== undefined || signAsDefault)) {
    const spec = send.sign ?? {};
    const actor = spec.as !== undefined
      ? ctx.actors[spec.as]
      : Object.values(ctx.actors).find((a) => a.vid === doc!.issuer);
    if (actor !== undefined) {
      const created = ctx.nowMs + (spec.created === undefined ? 0 : parseAt(spec.created, ctx.window));
      const purpose = spec.purpose ?? specifiedProofPurpose(doc.type);
      doc = signDocument(doc, actor.signer, {
        created,
        ...(purpose === undefined ? {} : { purpose }),
        ...(spec.allowIssuerMismatch === true ? { allowIssuerMismatch: true } : {}),
      });
    }
  }
  for (const m of mutations.filter((x) => x.afterSign === true)) applyMutation(doc, m, ctx);

  let out: unknown = doc;
  let text: string;
  if (mutations.some((m) => m.op === "reorder")) {
    out = Object.fromEntries(Object.entries(doc).reverse());
    text = JSON.stringify(out, null, 2);
  } else text = JSON.stringify(out);
  for (const m of mutations) if (m.op === "bom" || m.op === "truncate") text = textMutation(text, m);
  return { bytes: text, doc };
}

function textMutation(text: string, m: Mutation): string {
  if (m.op === "bom") return "﻿" + text;
  if (m.op === "truncate") return text.slice(0, Math.max(0, text.length - (m.bytes ?? 1)));
  return text;
}

function tryParse(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
