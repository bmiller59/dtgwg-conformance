// SPDX-License-Identifier: Apache-2.0
// The witness side of `witness/session` and `witness/session/submit` for the reference adapter (docs/29-witness-tasks.md): an oracle written
// from the two specifications (0.2 is the focus; 0.1 is served as the older version, the pair kept one to one), so the witness vectors can be shown to detect their mutants. It is the executable
// reading of the specification text, not a copy of any implementation. The presentation it verifies is a Data-Integrity one (eddsa-jcs-2022,
// the suite's own crypto); a witness server that verifies JSON-LD presentations is measured through its own adapter.
import { createHash } from "node:crypto";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { taskDigest, WITNESSED_PREDICATE } from "../../runner/witness-evidence.ts";
import type { MutantId } from "./mutants.ts";

export const WIT_SESSION_01 = "https://trusttasks.org/spec/witness/session/0.1";
export const WIT_SUBMIT_01 = "https://trusttasks.org/spec/witness/session/submit/0.1";
export const WIT_SESSION_02 = "https://trusttasks.org/spec/witness/session/0.2";
export const WIT_SUBMIT_02 = "https://trusttasks.org/spec/witness/session/submit/0.2";
export const WIT_TYPES: readonly string[] = [WIT_SESSION_01, WIT_SUBMIT_01, WIT_SESSION_02, WIT_SUBMIT_02];
export const WIT_DOMAIN = "witness-session-reference";
/** The reference witness's own policy: a session that has not been submitted in ten minutes is closed (the specifications leave the expiry to the witness). */
export const WIT_SESSION_TTL_MS = 10 * 60 * 1000;
export const WIT_REFUSED = "witness/session:refused";
export const WIT_MISMATCH = "witness/session/submit:challengeMismatch";
export const WIT_INVALID = "witness/session/submit:presentationInvalid";

type Doc = Record<string, unknown>;

export interface WitnessHost {
  signer: Ed25519Signer;
  now(): number;
  newId(): string;
  stamp(): string;
  m(id: MutantId): boolean;
  /** An error document answering `doc`. */
  refuse(doc: Doc, code: string, message: string): Doc;
}

interface Session {
  type: string;
  id: string;
  doc: Doc;
  opener: string;
  parties: string[];
  challenge: string;
  domain: string;
  openedAt: number;
}

/** The variants of a presentation the `witnessPresentation` helper builds (src/adapters/witness-server/shim.ts has the same list). */
export type VpVariant = "valid" | "wrongChallenge" | "wrongDomain" | "outsiderHolder" | "noCredential" | "unsigned" | "tamperedCredential" | "member";

export class ReferenceWitness {
  private sessions = new Map<string, Session>();
  private issued: string[] = [];
  private counter = 0;

  private readonly host: WitnessHost;
  private readonly actors: Record<string, Ed25519Signer>;

  constructor(host: WitnessHost, actors: Record<string, Ed25519Signer> = actorSigners()) {
    this.host = host;
    this.actors = actors;
  }

  reset(): void {
    this.sessions.clear();
    this.issued = [];
    this.counter = 0;
  }
  stateText(): unknown {
    return { open: [...this.sessions.keys()].sort(), issued: this.issued.length };
  }
  issuedCount(): number {
    return this.issued.length;
  }
  openCount(): number {
    return this.sessions.size;
  }

  private challenge(): string {
    if (this.host.m("wsSharedChallenge")) return "0123456789abcdef0123456789abcdef";
    const hex = createHash("sha256").update(`witness-challenge:${this.host.signer.did}:${this.counter++}`).digest("hex");
    return this.host.m("wsShortChallenge") ? hex.slice(0, 8) : hex.slice(0, 32);
  }

  /** The versions pair one to one: session 0.1 with submit 0.1, 0.2 with 0.2 (witness/session 0.2, "What changed from 0.1"). */
  private static pairedSubmit(sessionType: string): string {
    return sessionType === WIT_SESSION_02 ? WIT_SUBMIT_02 : WIT_SUBMIT_01;
  }

  handle(doc: Doc): Doc {
    return doc.type === WIT_SESSION_01 || doc.type === WIT_SESSION_02 ? this.onSession(doc) : this.onSubmit(doc);
  }

  private respond(doc: Doc, payload: Doc): Doc {
    const r: Doc = {
      id: this.host.newId(),
      threadId: doc.threadId ?? doc.id,
      ...(doc.parentThreadId !== undefined && !this.host.m("wsDropsParentThreadId") ? { parentThreadId: doc.parentThreadId } : {}),
      type: `${String(doc.type)}#response`,
      issuer: this.host.signer.did,
      recipient: doc.issuer,
      payload,
    };
    return r;
  }

  /** The signature of a `#response` (REQUIRED by both specifications), applied after the envelope is final. */
  seal(reply: Doc): Doc {
    if (reply.proof !== undefined || this.host.m("wsNoResponseProof")) return reply;
    return signDocument(reply, this.host.signer, { created: this.host.now(), purpose: "assertionMethod" });
  }

  private onSession(doc: Doc): Doc {
    const p = isObject(doc.payload) ? doc.payload : {};
    const parties = p.parties;
    const wellFormed = Array.isArray(parties) && parties.length === 2 && parties.every((x) => typeof x === "string" && x.startsWith("did:"));
    if (!wellFormed && !this.host.m("wsNoPartiesCheck")) return this.host.refuse(doc, "malformedRequest", "parties must be exactly two DIDs");
    if (!this.host.m("wsNoMembershipCheck") && !(parties as string[]).includes(String(doc.issuer))) return this.host.refuse(doc, WIT_REFUSED, "the issuer is not one of the named parties");
    const session: Session = { type: String(doc.type), id: String(doc.id), doc, opener: String(doc.issuer), parties: parties as string[], challenge: this.challenge(), domain: WIT_DOMAIN, openedAt: this.host.now() };
    this.sessions.set(session.id, session);
    return this.respond(doc, { challenge: session.challenge, domain: session.domain });
  }

  private onSubmit(doc: Doc): Doc {
    const p = isObject(doc.payload) ? doc.payload : {};
    if (!isObject(p.vp)) return this.host.refuse(doc, "malformedRequest", "payload.vp is required");
    const vp = p.vp;
    const threadId = String(doc.threadId ?? doc.id);
    const s = this.sessions.get(threadId);
    const expired = s !== undefined && !this.host.m("wsNoExpiry") && this.host.now() - s.openedAt > WIT_SESSION_TTL_MS;
    if (s === undefined || expired) return this.host.refuse(doc, s === undefined && this.host.m("wsUnknownThreadAsInvalid") ? WIT_INVALID : WIT_MISMATCH, expired ? "the session has expired" : "no session on this thread");
    // 0.1 pairs with 0.1 and 0.2 with 0.2
    if (doc.type !== ReferenceWitness.pairedSubmit(s.type) && !this.host.m("wsAcceptWrongVersion")) return this.host.refuse(doc, WIT_MISMATCH, "the submission is not in the version of the session");
    // 3. the submitting party is the one that opened the session
    if (doc.issuer !== s.opener && !this.host.m("wsNoSubmitterCheck")) return this.host.refuse(doc, WIT_MISMATCH, "the session was opened by another party");
    const mismatch = this.host.m("wsMismatchForAll") ? WIT_MISMATCH : WIT_INVALID;
    // 2. the binding to the session challenge, before any other check on the presentation
    const proof = isObject(vp.proof) ? vp.proof : undefined;
    if (proof === undefined && !this.host.m("wsAcceptUnsignedVp")) return this.host.refuse(doc, WIT_MISMATCH, "the presentation carries no proof bound to the challenge");
    if (proof === undefined) return this.accept(doc, s, threadId, vp);
    if (!this.host.m("wsNoChallengeCheck") && proof.challenge !== s.challenge) return this.host.refuse(doc, WIT_MISMATCH, "the presentation is not bound to this session's challenge");
    if (!this.host.m("wsNoDomainCheck") && proof.domain !== s.domain) return this.host.refuse(doc, WIT_MISMATCH, "the presentation is not bound to this witness's domain");
    // presentation validity: its own proof, its holder binding, its party bindings
    if (!verifyDocumentProof(vp, { nowMs: this.host.now(), controllerMember: "holder" }).valid) return this.host.refuse(doc, mismatch, "the presentation proof does not verify");
    if (!this.host.m("wsNoHolderCheck") && !s.parties.includes(String(vp.holder))) return this.host.refuse(doc, mismatch, "the presentation holder is not a party to the session");
    return this.accept(doc, s, threadId, vp);
  }

  private accept(doc: Doc, s: Session, threadId: string, vp: Doc): Doc {
    const mismatch = this.host.m("wsMismatchForAll") ? WIT_MISMATCH : WIT_INVALID;
    const creds = Array.isArray(vp.verifiableCredential) ? vp.verifiableCredential : [];
    const vrc = creds[0];
    if (!isObject(vrc)) return this.host.refuse(doc, mismatch, "the presentation carries no relationship credential");
    if (!this.host.m("wsNoCredentialVerify") && (!verifyDocumentProof(vrc, { nowMs: this.host.now(), controllerMember: "issuer" }).valid || vrc.issuer !== vp.holder)) return this.host.refuse(doc, mismatch, "the relationship credential does not verify");
    if (!this.host.m("wsChallengeReusable")) this.sessions.delete(threadId);
    const member = isObject(doc.payload) && isObject(doc.payload.memberPresentation) && typeof doc.payload.memberPresentation.holder === "string" ? doc.payload.memberPresentation.holder : undefined;
    const vwc = this.buildVwc(s, vrc, member);
    this.issued.push(digestMultibase(vwc));
    return this.respond(doc, { vwc, vwcDigestMultibase: this.host.m("wsWrongVwcDigest") ? digestMultibase({ other: true }) : digestMultibase(vwc) });
  }

  private buildVwc(s: Session, vrc: Doc, member?: string): Doc {
    const body: Doc = {
      "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"],
      id: `urn:uuid:${this.host.newId().slice(9)}`,
      type: ["VerifiableCredential", "DTGCredential", "StatementCredential"],
      issuer: this.host.m("wsVwcIssuerNotResponder") ? ed25519Signer(seedOf(0x4d)).did : this.host.signer.did,
      issuerScope: "directed",
      validFrom: this.host.stamp(),
      taskContext: this.host.m("wsWrongTaskContext") ? this.host.newId() : s.id,
      ...(this.host.m("wsNoTaskDigest") ? {} : { taskDigestMultibase: this.host.m("wsTaskDigestWithProof") ? digestMultibase(s.doc) : taskDigest(s.doc) }),
      // mutant wsMemberInVwc: the member DID of an optional memberPresentation must not appear in the credential (submit 0.2, "The VWC does not carry it")
      ...(this.host.m("wsMemberInVwc") && member !== undefined ? { witnessContext: { member } } : {}),
      credentialSubject: { id: this.host.m("wsSubjectNotOpener") ? s.parties.find((x) => x !== s.opener) : s.opener, predicate: WITNESSED_PREDICATE, object: { digestMultibase: taskDigest(vrc) } },
    };
    const signer = this.host.m("wsVwcIssuerNotResponder") ? ed25519Signer(seedOf(0x4d)) : this.host.signer;
    return signDocument(body, signer, { created: this.host.now(), purpose: "assertionMethod" });
  }

  /**
   * The `witnessPresentation` helper: a party's presentation of its relationship credential, bound to `{challenge, domain}`, as a Data-Integrity
   * presentation signed by the harness actor `holder`. The variants each break one thing.
   */
  presentation(args: Doc): string {
    const holderVid = String(args.holder);
    const actor = Object.values(this.actors).find((a) => a.did === holderVid);
    if (actor === undefined) throw new Error(`witnessPresentation: no key held for ${holderVid}`);
    const variant = String(args.variant ?? "valid") as VpVariant;
    const created = this.host.now();
    // a presentation by someone outside the exchange is that someone's own credential in that someone's own presentation
    const holder = variant === "outsiderHolder" ? (this.actors.S ?? actor) : actor;
    let vrc: Doc = signDocument(
      { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "RelationshipCredential"], issuer: holder.did, validFrom: new Date(created - 300000).toISOString().replace(".000Z", "Z"), credentialSubject: { id: variant === "member" ? holder.did : String(args.partner ?? "did:example:partner") } },
      holder,
      { created, purpose: "assertionMethod" },
    );
    // a credential changed after it was signed: its own proof no longer verifies, while the presentation over it is sound
    if (variant === "tamperedCredential") vrc = { ...vrc, credentialSubject: { id: "did:example:someone-else" } };
    const body = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: holder.did, verifiableCredential: variant === "noCredential" ? [] : [vrc] };
    if (variant === "unsigned") return JSON.stringify(body);
    const challenge = variant === "wrongChallenge" ? "0000000000000000000000000000000f" : String(args.challenge);
    const domain = variant === "wrongDomain" ? "another-witness-domain" : String(args.domain);
    const signed = signDocument(body, holder, { created, purpose: "authentication", controllerMember: "holder", challenge, domain });
    return JSON.stringify(signed);
  }
}

/** The harness actors' signers (the same seeds as `makeActors`, src/runner/engine.ts). */
function actorSigners(): Record<string, Ed25519Signer> {
  const seeds: Record<string, number> = { A: 0x0a, X: 0x0b, R: 0x0c, S: 0x0d, Q: 0x0e, W: 0x0f };
  return Object.fromEntries(Object.entries(seeds).map(([k, b]) => [k, ed25519Signer(seedOf(b))]));
}
