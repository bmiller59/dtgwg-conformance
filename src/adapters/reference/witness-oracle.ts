// SPDX-License-Identifier: Apache-2.0
// Witness oracle (reference mode `reference-witness`, docs/13 section 6). A small, specification-driven witness for the three
// documents the vectors in vectors/witness exercise. It implements ONLY what the drafts state, from the pinned task-force checkout:
// Latest versions (D290): the sources are the 0.4 / 0.2 / 0.2 texts; the 0.1 texts are served as the older, non-focus versions.
//   - specs/trust-task-discovery/0.4 (spec.md Conformance responder 1-4, payload.schema.json): patterns, bare Type URIs, no duplicates.
//   - specs/witness/session/0.2 (spec.md Conformance witness 1-4, payload.schema.json): the issuer must be named in `parties`
//     (else `witness/session:refused`); the response carries a fresh `challenge` (>= 16) and a `domain`, under the REQUIRED proof.
//   - specs/witness/session/submit/0.2 (spec.md Conformance witness 1-4): binding to the session challenge verified before any
//     other check (`challengeMismatch`), the submitter must be the party that opened the session (`challengeMismatch`), then the
//     presentation's own proof (`presentationInvalid`).
// Not modelled in the default mode: the success path. The submit specification leaves minting to "the witness's own decision under its policy"
// (Authorization), and the suite can mint no verifiable relationship credential. An unmutated oracle therefore declines a presentation
// that verifies with `taskFailed`; the `mint` path exists only for the mutants that skip a check. A second, LABELLED mode exists
// for the ceremony scenario FC-WSH (docs/25 section 6.4): `mint-on-verified`, selected only by the explicit adapter option
// (`reference-witness:mode=mint-on-verified`). It is the suite's own choice, not a requirement of the drafts: for a presentation that
// verifies and is held by the submitter it mints a Verifiable Witness Credential shaped as the submit specification fixes it. It
// models the reference oracle only; it says nothing about the witness server, which was not run. The default mode is unchanged. Framework steps (recipient,
// proof, freshness, duplicate, payload) are the adopted runtime's pipeline, configured per document by `spec` below.
import { randomBytes } from "node:crypto";
import type { ErrorResponse, SpecPolicy, TrustTaskDocument } from "@openvtc/trust-tasks/runtime";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import type { MutantId } from "./mutants.ts";

const BASE = "https://trusttasks.org/spec/";
/** The latest versions (the focus, decision D290): discovery 0.4, session 0.2, submit 0.2. The older 0.1 types are served as well (non-focus), the session and submit pair one to one. */
export const WITNESS_DISCOVERY_TYPE = `${BASE}trust-task-discovery/0.4`;
export const WITNESS_SESSION_TYPE = `${BASE}witness/session/0.2`;
export const WITNESS_SUBMIT_TYPE = `${BASE}witness/session/submit/0.2`;
export const WITNESS_DISCOVERY_TYPE_01 = `${BASE}trust-task-discovery/0.1`;
export const WITNESS_SESSION_TYPE_01 = `${BASE}witness/session/0.1`;
export const WITNESS_SUBMIT_TYPE_01 = `${BASE}witness/session/submit/0.1`;
const isDisc = (t: string): boolean => t === WITNESS_DISCOVERY_TYPE || t === WITNESS_DISCOVERY_TYPE_01;
const isSession = (t: string): boolean => t === WITNESS_SESSION_TYPE || t === WITNESS_SESSION_TYPE_01;
const isSubmit = (t: string): boolean => t === WITNESS_SUBMIT_TYPE || t === WITNESS_SUBMIT_TYPE_01;
/** The submit type that closes a session opened as `sessionType` (witness/session 0.2, "What changed from 0.1, and how the versions pair"). */
const pairedSubmit = (sessionType: string): string => (sessionType === WITNESS_SESSION_TYPE ? WITNESS_SUBMIT_TYPE : WITNESS_SUBMIT_TYPE_01);
const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const CHALLENGE_MISMATCH = "witness/session/submit:challengeMismatch";
const PRESENTATION_INVALID = "witness/session/submit:presentationInvalid";
const WITNESS_DOMAIN = "witness.conformance.example";

/** What the oracle needs from the reference adapter; the adapter passes closures, so nothing private leaks. */
export interface WitnessHost {
  m(id: MutantId): boolean;
  now(): number;
  newId(): string;
  signer: Ed25519Signer;
  /** The labelled mint mode (absent: the unmutated oracle, which declines a presentation that verifies). */
  mode?: "mint-on-verified";
  finish<T extends TrustTaskDocument<unknown>>(reply: T, request: TrustTaskDocument<unknown>, errorKind: boolean): T;
  refuse(doc: TrustTaskDocument<unknown>, code: string, message: string): ErrorResponse;
}

interface Session {
  issuer: string;
  /** The Type URI the session was opened as: its submit must be the paired version. */
  type: string;
  challenge: string;
  domain: string;
  /** The session document as received, the exchange it belongs to (`parentThreadId`), its parties and the subject a credential was minted for (mint-on-verified only). */
  init: TrustTaskDocument<unknown>;
  parent: string | undefined;
  parties: string[];
  minted: string | undefined;
}

export class WitnessOracle {
  private sessions = new Map<string, Session>();
  private counter = 0;
  private readonly h: WitnessHost;
  constructor(host: WitnessHost) {
    this.h = host;
  }

  /** The Type URIs served: discovery (the oracle acts on it, so it lists it) and the two witness types, each at the latest version and at 0.1. */
  types(): string[] {
    return [WITNESS_DISCOVERY_TYPE, WITNESS_SESSION_TYPE, WITNESS_SUBMIT_TYPE, WITNESS_DISCOVERY_TYPE_01, WITNESS_SESSION_TYPE_01, WITNESS_SUBMIT_TYPE_01];
  }
  serves(type: string): boolean {
    return this.types().includes(type);
  }
  reset(): void {
    this.sessions.clear();
    this.counter = 0;
  }
  /**
   * Documents the framework pipeline checks with no duplicate record and no freshness bound: discovery (sideEffects none), and, as the
   * plain-task family does for a task with no issuedAt requirement, session and submit when a mutant removes that requirement (with the
   * bound left in place the runtime would still refuse a missing issuedAt as expired and the mutant would be invisible).
   */
  unguarded(type: string): boolean {
    return isDisc(type) || (this.serves(type) && (this.h.m("noFreshnessWindow") || this.h.m("noTimeChecks")));
  }
  /** Mutant `witnessPurposeAssertionOnly`: a request proof made for any purpose but assertionMethod is refused (the drafts pin none). */
  refusesPurpose(type: string, purpose: string): boolean {
    return this.h.m("witnessPurposeAssertionOnly") && isSubmit(type) && purpose !== "assertionMethod";
  }

  spec(type: string): SpecPolicy | undefined {
    const m = (id: MutantId): boolean => this.h.m(id);
    const bearer = m("ignoreAudienceBinding") || m("recipientOptional");
    const issuedAt = !m("noFreshnessWindow") && !m("noTimeChecks");
    const ext = { type: "object" };
    if (isDisc(type)) {
      // front matter: recipient REQUIRED, proof RECOMMENDED (not required), sideEffects none, no issuedAtRequirement
      return {
        typeUri: type, isBearer: bearer, isProofRequired: false, isRecipientRequired: !m("recipientOptional"), isIssuedAtRequired: false,
        payloadSchema: {
          $schema: SCHEMA, type: "object", additionalProperties: m("discoveryOpenPayload"),
          properties: { patterns: { type: "array", ...(m("discoveryNoPatternBound") ? {} : { maxItems: 16 }), items: { type: "string", minLength: 1 } }, ext },
        },
      } as SpecPolicy;
    }
    if (isSession(type)) {
      // front matter: request proof OPTIONAL, recipient REQUIRED, issuedAt REQUIRED, sideEffects mutating
      return {
        typeUri: type, isBearer: bearer, isProofRequired: false, isRecipientRequired: !m("recipientOptional"), isIssuedAtRequired: issuedAt,
        payloadSchema: {
          $schema: SCHEMA, type: "object", additionalProperties: false, required: ["parties"],
          properties: { parties: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", pattern: "^did:" } }, ext },
        },
      } as SpecPolicy;
    }
    if (isSubmit(type)) {
      // front matter: request proof REQUIRED, recipient REQUIRED, issuedAt REQUIRED, sideEffects mutating; memberPresentation (an object) is new in 0.2
      const member = type === WITNESS_SUBMIT_TYPE ? { memberPresentation: m("wsMemberUntyped") ? {} : { type: "object" } } : {};
      return {
        typeUri: type, isBearer: bearer, isProofRequired: !m("proofOptional"), isRecipientRequired: !m("recipientOptional"), isIssuedAtRequired: issuedAt,
        payloadSchema: { $schema: SCHEMA, type: "object", additionalProperties: false, required: ["vp"], properties: { vp: { type: "object" }, ...member, ext } },
      } as SpecPolicy;
    }
    return undefined;
  }

  /** Handles an accepted (consumed) document of a served type; the reply is finished and signed here. */
  handle(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const type = doc.type;
    if (isDisc(type)) return this.discover(doc);
    if (isSession(type)) return this.open(doc);
    return this.submit(doc);
  }

  private reply(doc: TrustTaskDocument<unknown>, type: string, payload: unknown): TrustTaskDocument<unknown> {
    const r = { id: this.h.newId(), threadId: doc.threadId ?? doc.id, type, issuer: this.h.signer.did, recipient: doc.issuer, issuedAt: "", payload } as TrustTaskDocument<unknown>;
    return this.seal(this.h.finish(r, doc, false));
  }
  private fail(doc: TrustTaskDocument<unknown>, code: string, message: string): TrustTaskDocument<unknown> {
    return this.h.finish(this.h.refuse(doc, code, message) as unknown as TrustTaskDocument<unknown>, doc, true);
  }
  /** The responses of session and submit carry a REQUIRED proof (front matter proofRequirement); discovery's is RECOMMENDED and signed too. */
  private seal(r: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    if (this.h.m("unsignedReplies") || (r as { proof?: unknown }).proof !== undefined) return r;
    return signDocument(r as unknown as Record<string, unknown>, this.h.signer, { created: this.h.now() }) as unknown as TrustTaskDocument<unknown>;
  }

  // ---- trust-task-discovery 0.4 (and 0.1, answered in the version asked)
  private discover(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const given = (doc.payload as { patterns?: string[] }).patterns ?? [];
    const patterns = given.length === 0 ? (this.h.m("discoveryNoDefaultStar") ? [] : ["*"]) : given;
    const slugOf = (t: string): string => t.slice(BASE.length).replace(/\/\d+\.\d+$/, "");
    const one = (pat: string, slug: string): boolean => (pat === "*" ? true : pat.endsWith("/*") ? slug.startsWith(pat.slice(0, -1)) : slug === pat);
    let listed = this.types().filter((t) => this.h.m("discoveryIgnoresPatterns") || patterns.some((p) => one(p, slugOf(t)))).sort();
    if (this.h.m("witnessDiscoveryOmitsSelf")) listed = listed.filter((t) => !isDisc(t));
    if (this.h.m("discoveryEmptyAsError") && listed.length === 0) return this.fail(doc, "taskFailed", "nothing matches");
    if (this.h.m("discoveryDuplicates") && listed.length > 0) listed = [listed[0]!, ...listed];
    if (this.h.m("discoveryFragmentsListed")) listed = listed.map((t) => `${t}#request`);
    const entries: unknown[] = this.h.m("witnessOffersExt") ? listed.map((t) => ({ type: t, offeredExt: ["example.org.locality"] })) : listed;
    return this.reply(doc, `${doc.type}#response`, { supportedTypes: entries });
  }

  // ---- witness/session 0.2 (and 0.1)
  private open(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const parties = (doc.payload as { parties?: unknown }).parties;
    const named = Array.isArray(parties) && parties.includes(doc.issuer);
    if (!named && !this.h.m("witnessSessionAnyIssuer")) return this.fail(doc, "witness/session:refused", "the session's issuer is not named in parties");
    const challenge = this.h.m("witnessChallengeReuse") ? "fixed-challenge-0123456789abcdef" : this.h.m("witnessShortChallenge") ? "short" : randomBytes(24).toString("base64url");
    this.sessions.set(doc.id, { issuer: String(doc.issuer), type: String(doc.type), challenge, domain: WITNESS_DOMAIN, init: doc, parent: typeof doc.parentThreadId === "string" ? doc.parentThreadId : undefined, parties: Array.isArray(parties) ? parties.map(String) : [], minted: undefined });
    this.counter++;
    return this.reply(doc, `${doc.type}#response`, { challenge, domain: WITNESS_DOMAIN });
  }

  // ---- witness/session/submit 0.2 (and 0.1)
  private submit(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const m = (id: MutantId): boolean => this.h.m(id);
    const vp = (doc.payload as { vp?: unknown }).vp;
    const session = typeof doc.threadId === "string" ? this.sessions.get(doc.threadId) : undefined;
    // The drafts state no code for a thread that names no session; a submission cannot hold a challenge that was never issued, so it is a mismatch.
    if (session === undefined) return m("witnessNoSessionCheck") ? this.mint(doc) : this.fail(doc, CHALLENGE_MISMATCH, "no such session");
    const bound = (): boolean => isObject(vp) && isObject(vp.proof) && vp.proof.challenge === session.challenge && vp.proof.domain === session.domain;
    const verifies = (): boolean => m("witnessSkipsPresentationVerification") || (isObject(vp) && verifyDocumentProof(vp, { nowMs: this.h.now(), ...(this.h.mode === "mint-on-verified" ? { controllerMember: "holder" as const } : {}) }).valid);
    // witness/session 0.2: a submission in the other version than the session was opened in is challengeMismatch
    if (doc.type !== pairedSubmit(session.type) && !m("wsAcceptWrongVersion")) return this.fail(doc, CHALLENGE_MISMATCH, "the submission is not in the version of the session");
    // Conformance witness 2: the binding is verified before any other check.
    if (m("witnessBindingAfterVerification")) {
      if (!verifies()) return this.fail(doc, PRESENTATION_INVALID, "the presentation does not verify");
      if (!bound()) return this.fail(doc, CHALLENGE_MISMATCH, "not bound to this session");
    } else if (!bound()) return this.fail(doc, CHALLENGE_MISMATCH, "not bound to this session");
    // Conformance witness 3: only the party that opened the session submits under it.
    if (doc.issuer !== session.issuer && !m("witnessAnyPartySubmits")) return this.fail(doc, CHALLENGE_MISMATCH, "the session was opened by another party");
    if (!m("witnessBindingAfterVerification") && !verifies()) return this.fail(doc, PRESENTATION_INVALID, "the presentation does not verify");
    if (m("witnessSkipsPresentationVerification")) return this.mint(doc);
    // A presentation that verifies: whether to mint is the witness's own decision (Authorization); the oracle declines, except in the labelled mode.
    if (this.h.mode === "mint-on-verified") return this.mintVerified(doc, session, vp);
    return this.fail(doc, "taskFailed", "the witness declines to mint under its policy");
  }

  /** The mode this oracle runs in (declared in the participant's capabilities so a scenario result says which). */
  get mode(): "mint-on-verified" | undefined {
    return this.h.mode;
  }

  /**
   * The oracle's reading of an exchange (the `parentThreadId` its sessions name): `completed` when it minted a credential for every party its session
   * names, `open` when sessions exist and some party has none, `unknown` for an exchange it never saw. Only meaningful in the labelled mode.
   */
  reading(thread: string): "completed" | "open" | "unknown" {
    const mine = [...this.sessions.values()].filter((s) => s.parent === thread);
    if (mine.length === 0) return "unknown";
    const minted = new Set(mine.map((s) => s.minted).filter((x): x is string => x !== undefined));
    const parties = new Set(mine.flatMap((s) => s.parties));
    return parties.size > 0 && [...parties].every((p) => minted.has(p)) ? "completed" : "open";
  }

  /**
   * Mode mint-on-verified, after the binding, the submitter and the presentation's own proof were checked: the presentation must be held by the
   * submitter and carry exactly one relationship credential issued by the submitter and verifying on its own. The credential minted is a DTG statement
   * credential under the witnessed predicate about the submitter, citing the session document by id and by task digest (spec "The credential delivered").
   */
  private mintVerified(doc: TrustTaskDocument<unknown>, session: Session, vp: unknown): TrustTaskDocument<unknown> {
    const p = isObject(vp) ? vp : {};
    const creds = p.verifiableCredential;
    const vrc = Array.isArray(creds) && creds.length === 1 && isObject(creds[0]) ? creds[0] : undefined;
    if (p.holder !== doc.issuer || vrc === undefined || vrc.issuer !== doc.issuer || !verifyDocumentProof(vrc, { nowMs: this.h.now() }).valid) {
      return this.fail(doc, PRESENTATION_INVALID, "the presentation is not held by the submitter or carries no verifying relationship credential issued by it");
    }
    const { proof: _p, ...unsignedInit } = session.init as unknown as Record<string, unknown>;
    const body = {
      "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"],
      type: ["VerifiableCredential", "DTGCredential", "StatementCredential"], issuer: this.h.signer.did, issuerScope: "directed",
      validFrom: new Date(this.h.now()).toISOString().replace(/\.\d{3}Z$/, "Z"),
      credentialSubject: { id: String(doc.issuer), predicate: "https://registry.trustoverip.org/dtg/vsc/witnessed/1", object: { digestMultibase: digestMultibase(vrc) } },
      taskContext: session.init.id, taskDigestMultibase: digestMultibase(unsignedInit),
    };
    const vwc = signDocument(body, this.h.signer, { created: this.h.now(), purpose: "assertionMethod" });
    session.minted = String(doc.issuer);
    return this.reply(doc, `${doc.type}#response`, { vwc, vwcDigestMultibase: digestMultibase(vwc) });
  }

  /** Only for the mutants that skip a check: a stub credential shaped as the submit specification fixes it (issuer, subject, taskContext, digest). */
  private mint(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const vwc = {
      "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"],
      type: ["VerifiableCredential", "DTGCredential", "StatementCredential"], issuer: this.h.signer.did,
      credentialSubject: { id: doc.issuer, predicate: "https://registry.trustoverip.org/dtg/vsc/witnessed/1" },
      taskContext: doc.threadId ?? doc.id,
    };
    return this.reply(doc, `${doc.type}#response`, { vwc, vwcDigestMultibase: digestMultibase(vwc) });
  }
}

