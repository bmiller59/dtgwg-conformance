// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the paired ceremonies (docs/26): a member phone and an agent that follow the specification text, each as a small adapter. They exist for two
// reasons: (1) the scenarios of groups FC-ACL, FC-DEV and FC-VLT are validated against them (the oracle pair completes, each deliberate mutant of the agent makes a scenario end
// `failed`, so no scenario passes vacuously), and (2) they separate a platform's difference from the specification from a scenario that over-reads it. They model only what
// a scenario observes: no key custody, no real access policy, no push gateway. The agent keeps an access list, device bindings and a credential vault; the member signs its own
// requests and sends the version the specification names. Mutants are in AGENT_MUTANTS.
import { randomBytes, randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
const AGENT_SEED = 0xa7, MEMBER_SEED = 0x4b;
export const AGENT_MUTANTS = ["aclRevokeKeepsEntry", "aclAnyoneMayGrant", "aclReplayExecutes", "aclNoProofCheck", "aclNoRecipientCheck", "aclNoWindow", "aclSwapKeepsOld", "deviceRegisterTwice", "deviceWipeDeletes", "deviceHeartbeatUnregistered", "vaultFilesNothing", "vaultQueryError", "stepUpNoGate", "stepUpAnyChallenge", "stepUpDeniedElevates", "stepUpHoldAsError", "stepUpBoundElevates"] as const;
export type AgentMutant = (typeof AGENT_MUTANTS)[number];
export const MEMBER_KINDS = ["acl-list", "acl-grant", "acl-update", "acl-revoke", "acl-swap-key", "device-register", "device-heartbeat", "device-list", "device-set-wake", "device-remove-other", "device-wipe-other", "device-wipe", "step-up-unprompted", "vault-keep-card", "vault-restore"];
const GROUPS = ["FC-ACL", "FC-DEV", "FC-VLT", "FC-STU"];

const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const dig = (d: Doc): string => digestMultibase(d as never);

/** The agent: serves the ACL, device and vault tasks of the ceremonies, as the specifications state them. */
export class PairAgent implements Adapter {
  readonly signer = ed25519Signer(seedOf(AGENT_SEED));
  private readonly mutants: ReadonlySet<string>;
  private acl = new Map<string, { role: string; purposes?: Doc; label?: string }>();
  private devices = new Map<string, { id: string; did: string; name: string; seenAt: number; wipedAt?: number }>();
  private vault: Doc[] = [];
  private roles = new Map<string, string>();
  private seen = new Map<string, { digest: string; reply: string }>();
  private devBase = 0;
  /** Every identity that has sent the agent a document: the participants' own rows are not counted by `acl-entry`. */
  private readonly actors = new Set<string>();
  private readonly defaultRole: string;
  /** Step-up: gated task types, the challenge pending per caller, the callers whose session is elevated. */
  private gated = new Set<string>();
  private pending = new Map<string, { challenge: string; sessionId: string }>();
  private elevated = new Set<string>();
  private denied = new Set<string>();
  /** Bound step-up (approve-request 0.6, Inline delivery): gated task types whose hold is bound to the one operation, the bound step-up pending per caller, and the
   *  operations an approval authorized (read from the agent's own state, never from the approve-response; each is consumed by the operation it names). */
  private boundGated = new Set<string>();
  private boundPending = new Map<string, { challenge: string; boundTo: string; op: string }>();
  private authorized = new Map<string, Set<string>>();
  /** `legacyStepUp`: hold a gated task the way deployed agents do today (`taskFailed` with details.reason auth:step_up_required) instead of the next step SPEC 8.6 requires. */
  private readonly legacyStepUp: boolean;
  /** Callers whose key was swapped away: their old key no longer authorizes. */
  private retired = new Set<string>();
  constructor(o: { mutants?: string[]; actorRole?: string; legacyStepUp?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.defaultRole = o.actorRole ?? "admin"; this.legacyStepUp = o.legacyStepUp === true; }
  private m(id: AgentMutant): boolean { return this.mutants.has(id); }

  async capabilities(): Promise<Capabilities> {
    const types = ["auth/step-up/approve-response/0.7", "acl/list/0.4", "acl/grant/0.3", "acl/update/0.3", "acl/revoke/0.3", "acl/swap-key/0.1", "device/register/0.2", "device/heartbeat/0.3", "device/list/0.3", "device/set-wake/0.2", "device/wipe/0.2", "vault/credentials/receive/0.1", "vault/credentials/query/0.1", "vault/credentials/get/0.2"].map((t) => `${S}${t}`);
    return {
      name: this.mutants.size === 0 ? "reference-agent" : `reference-agent+${[...this.mutants].join("+")}`, implementation: "reference-agent", version: "suite reference, agent (ACL, device, vault)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: types, carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "observe.ceremony", "trigger.requireStepUp", "trigger.requireBoundStepUp"], ceremonyRoles: GROUPS.map((ceremony) => ({ ceremony, roles: ["agent"] })),
      pins: { framework: "0.6.0", error: "0.6", binding: "none" },
    };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }]));
  }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return `${this.acl.size}:${this.devices.size}:${this.vault.length}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.retired.clear(); this.gated.clear(); this.pending.clear(); this.elevated.clear(); this.denied.clear(); this.boundGated.clear(); this.boundPending.clear(); this.authorized.clear(); this.actors.clear(); this.acl.clear(); this.devices.clear(); this.vault = []; this.roles.clear(); this.seen.clear(); }

  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "actorRole") this.roles.set(String(args.vid), String(args.role));
    else if (action === "requireStepUp") this.gated.add(`${S}${String(args.type)}`);
    else if (action === "requireBoundStepUp") this.boundGated.add(`${S}${String(args.type)}`);
    else if (action === "seedDevice") {
      const other = ed25519Signer(seedOf(Number(args.seed ?? 0x2b)));
      this.acl.set(other.did, { role: "admin" });
      this.devices.set(other.did, { id: `dev_${other.did.slice(-10)}`, did: other.did, name: String(args.displayName ?? "Second phone"), seenAt: Date.now() });
    } else throw new Error(`the agent has no trigger ${action}`);
    return { documents: [] };
  }

  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string): Doc {
    return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, inResponseTo: { id: req.id, typeUri: req.type } });
  }
  private out(d: Doc, status = 200): SendResult { const t = String(d.type); return { replies: [JSON.stringify(d)], transport: { status: t.includes("/trust-task-error/") ? 422 : status, kind: "document" }, quiescentAfterMs: 0 }; }

  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const now = Date.now();
    const payload = isObject(doc.payload) ? (doc.payload as Doc) : {};
    const type = String(doc.type);
    const key = JSON.stringify([doc.id]);
    const digest = dig(doc);
    const prior = this.seen.get(key);
    if (prior !== undefined && !this.m("aclReplayExecutes")) {
      if (prior.digest !== digest) return this.out(this.refuse(doc, "idConflict", "the id was used by a different document"));
      return { replies: [prior.reply], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
    }
    if (doc.recipient !== this.signer.did && !this.m("aclNoRecipientCheck")) return this.out(this.refuse(doc, "wrongRecipient", "the recipient is another party"));
    if (doc.proof === undefined && !this.m("aclNoProofCheck")) return this.out(this.refuse(doc, "proofRequired", "a proof is required"));
    if (!this.m("aclNoProofCheck") && !verifyDocumentProof(doc, { nowMs: now }).valid) return this.out(this.refuse(doc, "proofInvalid", "the proof did not verify"));
    const at = Date.parse(String(doc.issuedAt));
    if (!this.m("aclNoWindow") && !(Math.abs(now - at) <= 300_000)) return this.out(this.refuse(doc, "expired", "issuedAt is outside the acceptance window"));
    const who = String(doc.issuer);
    this.actors.add(who);
    if (this.retired.has(who)) return this.out(this.refuse(doc, "permissionDenied", "the key was swapped out of the access list"));
    const role = this.roles.get(who) ?? (this.acl.get(who)?.role ?? this.defaultRole);
    const isAdmin = role === "admin" || this.m("aclAnyoneMayGrant");
    let result: Doc;
    if (type === `${S}auth/step-up/approve-response/0.7`) result = this.approveResponse(doc, payload, who, now);
    else if (this.boundGated.has(type)) result = this.boundHold(doc, type, payload, who, isAdmin, now);
    else if (this.gated.has(type) && !this.elevated.has(who) && !this.m("stepUpNoGate")) result = this.hold(doc, who, now);
    else if (this.gated.has(type) && this.denied.has(who)) result = this.refuse(doc, "permissionDenied", "the step-up was declined");
    else result = this.dispatch(doc, type.replace(S, ""), payload, who, isAdmin, now);
    this.seen.set(key, { digest, reply: JSON.stringify(result) });
    return this.out(result);
  }

  /** A gated task from a caller whose session is not elevated: held. SPEC 8.6: a hold is a next step; `legacyStepUp` answers the way deployed agents do. */
  private hold(doc: Doc, who: string, now: number): Doc {
    if (this.denied.has(who)) return this.refuse(doc, "permissionDenied", "the step-up was declined");
    const challenge = `chal-${randomUUID()}`;
    const sessionId = `sess-${randomUUID().slice(0, 8)}`;
    this.pending.set(who, { challenge, sessionId });
    const approveRequest = signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}auth/step-up/approve-request/0.5`, issuer: this.signer.did, recipient: who, issuedAt: stamp(now), payload: { subject: who, sessionId, challenge, reason: "Approve this change", targetAcr: "aal2", accepts: ["didSigned"], ttlSeconds: 300 } }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
    if (this.legacyStepUp) return this.reply(doc, `${S}trust-task-error/0.6`, { code: "taskFailed", message: "auth:step_up_required", retryable: true, details: { reason: "auth:step_up_required", approveRequest }, inResponseTo: { id: doc.id, typeUri: doc.type } });
    return this.reply(doc, `${S}trust-task-next-step/0.1`, { expects: [{ typeUri: `${S}auth/step-up/approve-response/0.7`, reason: "step-up required", hint: { approveRequest } }], continuation: "resubmit" });
  }
  /**
   * A task gated by a step-up bound to that one operation (approve-request 0.6 Inline delivery): the relying party has no push channel to the approver, so the hold
   * is a trust-task-next-step whose `expects` entry names approve-response/0.7 and carries the approve-request payload as its `hint` (`boundTo` present, `sessionId`
   * absent), never an error response. The operation runs when it is sent again after an approval recorded for it; a declined step-up ends the hold (permissionDenied).
   */
  private boundHold(doc: Doc, type: string, payload: Doc, who: string, isAdmin: boolean, now: number): Doc {
    const op = dig({ type, payload });
    const authorized = this.authorized.get(who);
    if (authorized?.has(op) || (this.m("stepUpBoundElevates") && this.elevated.has(who))) { authorized?.delete(op); return this.dispatch(doc, type.replace(S, ""), payload, who, isAdmin, now); }
    if (this.denied.has(who)) return this.refuse(doc, "permissionDenied", "the step-up bound to this operation was declined");
    const challenge = randomBytes(24).toString("base64url");
    // salted with the challenge (approve-request 0.6 producer rule 5): a digest of the operation's type and payload
    const boundTo = dig({ salt: challenge, type, payload });
    this.boundPending.set(who, { challenge, boundTo, op });
    const hint = { subject: who, challenge, boundTo, reason: "Approve this change", accepts: ["didSigned"], ttlSeconds: 300 };
    const inResponseTo = { typeUri: doc.type, id: doc.id };
    // the 0.5 shape: the request carried in an error response, as details.stepUpRequest
    if (this.m("stepUpHoldAsError")) return this.reply(doc, `${S}trust-task-error/0.6`, { code: "permissionDenied", message: "a step-up bound to this operation is required", retryable: true, details: { stepUpRequest: hint }, inResponseTo });
    return this.reply(doc, `${S}trust-task-next-step/0.1`, { expects: [{ typeUri: `${S}auth/step-up/approve-response/0.7`, reason: "a step-up bound to this operation is required", hint }], continuation: "resubmit", inResponseTo, message: "held for a step-up bound to this operation" });
  }
  /** The approve-response to a bound step-up (approve-response 0.7 consumer step 5a): the operation is read from the agent's own state; no session is elevated. */
  private approveBound(doc: Doc, p: Doc, who: string, bp: { challenge: string; boundTo: string; op: string }): Doc {
    if (p.subject !== who || p.sessionId !== undefined) return this.refuse(doc, "auth/step-up/approve-response:subjectMismatch", "the subject is not the signer, or a sessionId was echoed for a step-up with no session");
    const proofPurpose = isObject(doc.proof) ? String((doc.proof as Doc).proofPurpose) : "";
    if (proofPurpose !== "assertionMethod") return this.refuse(doc, "proofInvalid", "the approval must be signed for assertionMethod");
    this.boundPending.delete(who);
    if (p.decision === "denied") { this.denied.add(who); return this.reply(doc, `${S}auth/step-up/approve-response/0.7#response`, { status: "rejected", reason: "the step-up was declined" }); }
    const set = this.authorized.get(who) ?? new Set<string>();
    set.add(bp.op);
    this.authorized.set(who, set);
    if (this.m("stepUpBoundElevates")) this.elevated.add(who);
    return this.reply(doc, `${S}auth/step-up/approve-response/0.7#response`, { status: "recorded", boundTo: bp.boundTo });
  }
  private approveResponse(doc: Doc, p: Doc, who: string, now: number): Doc {
    const bp = this.boundPending.get(who);
    if (bp !== undefined && bp.challenge === p.challenge) return this.approveBound(doc, p, who, bp);
    const pend = this.pending.get(who);
    if (!this.m("stepUpAnyChallenge") && (pend === undefined || pend.challenge !== p.challenge)) return this.refuse(doc, "auth/step-up/approve-response:challengeUnknown", "no pending challenge matches");
    if (p.subject !== who) return this.refuse(doc, "auth/step-up/approve-response:subjectMismatch", "the subject is not the signer");
    const proofPurpose = isObject(doc.proof) ? String((doc.proof as Doc).proofPurpose) : "";
    if (proofPurpose !== "assertionMethod") return this.refuse(doc, "proofInvalid", "the approval must be signed for assertionMethod");
    // approve-response 0.7 response schema: status is elevated, recorded or rejected; a denial is not applied, so it is acknowledged `rejected` with a reason (consumer step 6)
    if (p.decision === "denied" && !this.m("stepUpDeniedElevates")) { this.denied.add(who); this.pending.delete(who); return this.reply(doc, `${S}auth/step-up/approve-response/0.7#response`, { status: "rejected", reason: "the step-up was declined" }); }
    this.pending.delete(who);
    this.elevated.add(who);
    // consumer step 5 (not bound to an operation): acknowledged `elevated` with the session snapshot (a Session: id, subject, issuedAt, expiresAt; amr "did" for a did-signed gate)
    const session = { id: pend?.sessionId ?? `sess-${randomUUID().slice(0, 8)}`, subject: who, issuedAt: stamp(now), expiresAt: stamp(now + 1_800_000), amr: ["did"], acr: "aal2" };
    return this.reply(doc, `${S}auth/step-up/approve-response/0.7#response`, { status: "elevated", session });
  }

  private dispatch(doc: Doc, t: string, p: Doc, who: string, isAdmin: boolean, now: number): Doc {
    const ok = (payload: Doc): Doc => this.reply(doc, `${S}${t}#response`, payload);
    const entryOf = (subject: string): Doc => ({ subject, role: this.acl.get(subject)?.role ?? "admin", purposes: this.acl.get(subject)?.purposes ?? { scope: "any" }, ...(this.acl.get(subject)?.label === undefined ? {} : { label: this.acl.get(subject)?.label }) });
    const denied = (): Doc => this.refuse(doc, "permissionDenied", "the caller holds no authority for this task");
    switch (t) {
      case "acl/list/0.4": return isAdmin ? ok({ entries: [...this.acl.keys()].map(entryOf) }) : denied();
      case "acl/grant/0.3": {
        if (!isAdmin) return denied();
        const e = isObject(p.entry) ? (p.entry as Doc) : {};
        const subject = String(e.subject);
        // acl/grant 0.3 (AclEntry 0.3): `purposes` is REQUIRED; an entry without it is malformedRequest, never read as unrestricted
        if (!isObject(e.purposes)) return this.refuse(doc, "malformedRequest", "purposes is required at acl/grant 0.3");
        if (this.acl.has(subject) && this.acl.get(subject)!.role !== String(e.role)) return this.refuse(doc, "permissionDenied", "role changes use acl/change-role");
        if (!this.acl.has(subject)) this.acl.set(subject, { role: String(e.role), purposes: e.purposes as Doc, ...(typeof e.label === "string" ? { label: e.label } : {}) });
        return ok({ entry: entryOf(subject) });
      }
      case "acl/update/0.3": {
        if (!isAdmin) return denied();
        const subject = String(p.subject);
        const cur = this.acl.get(subject);
        if (cur === undefined) return this.refuse(doc, "acl/update:notFound", "no such subject");
        if (typeof p.label === "string") cur.label = p.label;
        return ok({ entry: entryOf(subject) });
      }
      case "acl/revoke/0.3": {
        if (!isAdmin) return denied();
        const subject = String(p.subject);
        if (!this.acl.has(subject)) return this.refuse(doc, "acl/revoke:subjectNotPresent", "no such subject");
        const entry = entryOf(subject);
        if (!this.m("aclRevokeKeepsEntry")) { this.acl.delete(subject); this.devices.delete(subject); }
        return ok({ entry });
      }
      case "acl/swap-key/0.1": {
        const cur = String(p.currentSubject), next = String(p.newSubject);
        if (cur !== who) return this.refuse(doc, "acl/swap-key:notHolder", "the issuer does not hold the entry");
        if (!this.acl.has(cur) && !this.roles.has(cur) && this.acl.size > 0) return this.refuse(doc, "acl/swap-key:subjectNotFound", "no such subject");
        if (this.acl.has(next)) return this.refuse(doc, "acl/swap-key:subjectAlreadyInUse", "the new subject is bound to an entry");
        const row = this.acl.get(cur) ?? { role: this.roles.get(cur) ?? this.defaultRole };
        this.acl.set(next, row);
        if (!this.m("aclSwapKeepsOld")) { this.acl.delete(cur); this.retired.add(cur); }
        return ok({ entry: entryOf(next), previousSubject: cur });
      }
      case "device/register/0.2": {
        if (!this.acl.has(who)) this.acl.set(who, { role: this.defaultRole });
        if (this.devices.has(who) && !this.m("deviceRegisterTwice")) return this.refuse(doc, "device/register:alreadyRegistered", "a binding already exists");
        this.devices.set(who, { id: `dev_${randomUUID().slice(0, 12)}`, did: who, name: String(p.displayName), seenAt: now });
        return ok({ binding: { deviceId: this.devices.get(who)!.id, displayName: String(p.displayName) } });
      }
      case "device/heartbeat/0.3": {
        const d = this.devices.get(who);
        if (d === undefined && !this.m("deviceHeartbeatUnregistered")) return this.refuse(doc, "device/heartbeat:notRegistered", "no binding for the issuer");
        if (d !== undefined) d.seenAt = now;
        return ok({ respondedAt: stamp(now) });
      }
      case "device/list/0.3": return ok({ devices: [...this.devices.values()].map((d) => ({ deviceId: d.id, consumerDid: d.did, displayName: d.name, lastSeenAt: stamp(d.seenAt), ...(d.wipedAt === undefined ? {} : { wipedAt: stamp(d.wipedAt) }) })) });
      case "device/set-wake/0.2": {
        if (!this.devices.has(who)) return this.refuse(doc, "device/set-wake:notRegistered", "no binding for the issuer");
        return ok({ pushCapable: false });
      }
      case "device/wipe/0.2": {
        const d = [...this.devices.values()].find((x) => x.id === String(p.deviceId));
        if (d === undefined) return this.refuse(doc, "device/wipe:notFound", "no binding with this id");
        if (this.m("deviceWipeDeletes")) this.devices.delete(d.did); else d.wipedAt = now;
        return ok({ deviceId: d.id, status: "wipeQueued" });
      }
      case "vault/credentials/receive/0.1": {
        if (!isAdmin) return denied();
        if (!this.m("vaultFilesNothing")) this.vault.push(p.credential as Doc);
        return ok({ id: String(p.id ?? (p.credential as Doc)?.id) });
      }
      case "vault/credentials/query/0.1": {
        if (this.m("vaultQueryError")) return this.refuse(doc, "taskFailed", "query failed");
        const purpose = String(p.purpose ?? "membership");
        const hits = purpose === "membership" ? this.vault : [];
        return ok({ credentials: hits.map((c) => ({ id: String(c.id) })) });
      }
      case "vault/credentials/get/0.2": {
        const c = this.vault.find((x) => x.id === p.id);
        return c === undefined ? this.refuse(doc, "vault/credentials/get:notFound", "no such credential") : ok({ format: "ldp_vc", credential: c });
      }
      default: return this.refuse(doc, "unsupportedType", `${t} is not served`);
    }
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the agent does not answer observe ${q.query}`);
    const k = q.kind;
    if (k === "credential") return { value: this.vault.length };
    if (k === "acl-entry") return { value: [...this.acl.keys()].filter((d) => !this.actors.has(d)).length };
    if (k.startsWith("acl-subject:")) return { value: this.acl.has(k.slice(12)) ? 1 : 0 };
    if (k.startsWith("acl-label:")) { const [s, l] = k.slice(10).split("|"); return { value: this.acl.get(s!)?.label === l ? 1 : 0 }; }
    if (k === "device") return { value: this.devices.size - this.devBase };
    if (k === "device-wiped") return { value: [...this.devices.values()].filter((d) => d.wipedAt !== undefined).length };
    if (k === "device-live") return { value: [...this.devices.values()].filter((d) => d.wipedAt === undefined).length };
    throw new Error(`the agent does not answer stored ${k}`);
  }
}

/** The member phone: builds and signs the requests of the ceremonies with the version the specification names, and reads the answers. */
export class PairMember implements Adapter {
  readonly signer = ed25519Signer(seedOf(MEMBER_SEED));
  private queue: { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; sent: Doc[]; scratch: Doc }[] = [];
  private clockOffsetMs = 0;
  private asSuccessor = false;
  private n = 0;
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-member", implementation: "reference-member", version: "suite reference, member phone", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: MEMBER_KINDS, ceremonyRoles: GROUPS.map((ceremony) => ({ ceremony, roles: ["member-phone"] })), pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.queue.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.queue.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.queue = []; this.clockOffsetMs = 0; }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action !== "clockOffset") throw new Error(`the member has no trigger ${action}`);
    this.clockOffsetMs = Number(args.seconds ?? 0) * 1000;
    return { documents: [] };
  }
  private doc(to: string, type: string, payload: Doc, thread: string, purpose: "authentication" | "assertionMethod" = "authentication"): Doc {
    const now = Date.now() + this.clockOffsetMs;
    const signer = this.asSuccessor ? ed25519Signer(seedOf(0x4f)) : this.signer;
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${type}`, threadId: thread, issuer: signer.did, recipient: to, issuedAt: stamp(now), payload }, signer, { created: now, purpose }) as unknown as Doc;
  }
  /** The next document of a flow, given what the agent has answered so far. */
  private next(f: PairMember["queue"][number]): Doc | undefined {
    const a = f.args;
    // a held task (SPEC 8.6 next step, or the deployed taskFailed shape) is answered with the step-up approval; once recorded, the task is sent again
    const heldBy = f.received.at(-1);
    const hp = isObject(heldBy?.payload) ? (heldBy!.payload as Doc) : {};
    // approve-request 0.6 Inline delivery: the hint of an expects entry naming approve-response/0.7 is the request payload itself; 0.5 carried it as an error's
    // details.stepUpRequest (a producer MAY accept both, 0.6 "Changes from 0.5"). The producer validates it and checks the subject is the party it acts for.
    const inline = (): Doc | undefined => {
      const fromNext = Array.isArray(hp.expects) ? (hp.expects as Doc[]).find((e) => e.typeUri === `${S}auth/step-up/approve-response/0.7` && isObject(e.hint) && (e.hint as Doc).approveRequest === undefined)?.hint : undefined;
      const r = (fromNext ?? (isObject(hp.details) ? (hp.details as Doc).stepUpRequest : undefined)) as Doc | undefined;
      if (!isObject(r)) return undefined;
      const str = (v: unknown, min = 1) => typeof v === "string" && v.length >= min;
      const valid = str(r.subject) && str(r.challenge, 16) && str(r.reason) && str(r.boundTo) && r.sessionId === undefined && Array.isArray(r.accepts) && r.accepts.includes("didSigned");
      return valid && r.subject === this.signer.did ? r : undefined;
    };
    const approveReq = (): Doc | undefined => {
      const fromNext = Array.isArray(hp.expects) ? (hp.expects as Doc[]).map((e) => (isObject(e.hint) ? (e.hint as Doc).approveRequest : undefined)).find(isObject) : undefined;
      const fromError = isObject(hp.details) ? (hp.details as Doc).approveRequest : undefined;
      return (fromNext ?? fromError) as Doc | undefined;
    };
    const held = String(heldBy?.type ?? "").endsWith("trust-task-next-step/0.1") || (isObject(hp.details) && ((hp.details as Doc).reason === "auth:step_up_required" || isObject((hp.details as Doc).stepUpRequest)));
    if (held && f.scratch.stepUp === undefined) {
      const req = approveReq();
      const rp = (isObject(req?.payload) ? req!.payload : inline()) as Doc | undefined;
      if (rp === undefined) return undefined;
      f.scratch.stepUp = "answered";
      const decision = a.stepUp === "deny" ? "denied" : "approved";
      return this.doc(String(a.recipient ?? f.to), "auth/step-up/approve-response/0.7", { subject: String(rp.subject), ...(rp.sessionId === undefined ? {} : { sessionId: String(rp.sessionId) }), challenge: String(rp.challenge), decision, ...(decision === "denied" ? { deniedReason: "Declined on this phone" } : {}), evidence: { kind: "didSigned" } }, f.thread, "assertionMethod");
    }
    if (f.scratch.stepUp === "answered" && String(heldBy?.type).endsWith("approve-response/0.7#response")) {
      f.scratch.stepUp = "resubmitted";
      f.step = 0; // send the task again
      // `denied` is no approve-response status (0.5 to 0.7 define elevated, recorded, rejected); kept only as tolerance for an agent that answers it. On `rejected`
      // the task is sent again and the agent refuses it (permissionDenied), as approve-request 0.6 describes for a declined step-up.
      if (hp.status === "denied") { f.scratch.declined = true; return undefined; }
    }
    const to = String(a.recipient ?? f.to);
    const last = f.received.at(-1);
    const code = isObject(last?.payload) ? String((last!.payload as Doc).code ?? "") : "";
    const refused = String(last?.type ?? "").includes("/trust-task-error/") && !held;
    if (held || f.scratch.stepUp === "answered") return undefined;
    switch (f.kind) {
      case "acl-list": return f.step === 0 ? this.doc(to, "acl/list/0.4", {}, f.thread) : undefined;
      case "acl-grant": return f.step === 0 ? this.doc(to, "acl/grant/0.3", { entry: { subject: String(a.subject), role: "admin", purposes: { scope: "any" }, ...(a.label === undefined ? {} : { label: String(a.label) }) } }, f.thread) : undefined;
      case "acl-update": return f.step === 0 ? this.doc(to, "acl/update/0.3", { subject: String(a.subject), label: String(a.label) }, f.thread) : undefined;
      case "acl-revoke": return f.step === 0 ? this.doc(to, "acl/revoke/0.3", { subject: String(a.subject), revocation: { kind: "entry" } }, f.thread) : undefined;
      case "acl-swap-key": return f.step === 0 ? this.doc(to, "acl/swap-key/0.1", { currentSubject: this.signer.did, newSubject: ed25519Signer(seedOf(0x4f)).did, linkProof: {} }, f.thread) : undefined;
      case "device-register": return f.step === 0 ? this.doc(to, "device/register/0.2", { consumerKind: { kind: "companion", formFactor: "mobile" }, displayName: String(a.displayName ?? "Ceremony phone"), platform: "ios" }, f.thread) : undefined;
      case "device-heartbeat": return f.step === 0 ? this.doc(to, "device/heartbeat/0.3", {}, f.thread) : undefined;
      case "device-list": return f.step === 0 ? this.doc(to, "device/list/0.3", {}, f.thread) : undefined;
      case "device-set-wake": return f.step === 0 ? this.doc(to, "device/set-wake/0.2", { wakeHandle: { gateway: "did:web:push.example", handle: "ceremony-handle" } }, f.thread) : undefined;
      case "device-wipe": return f.step === 0 ? this.doc(to, "device/wipe/0.2", { deviceId: String(a.deviceId), scope: "cacheAndKeys" }, f.thread) : undefined;
      case "step-up-unprompted": return f.step === 0 ? this.doc(to, "auth/step-up/approve-response/0.7", { subject: this.signer.did, sessionId: "sess-unprompted", challenge: "unprompted-challenge-0123456789", decision: "approved", evidence: { kind: "didSigned" } }, f.thread, "assertionMethod") : undefined;
      case "device-wipe-other": {
        if (f.step === 0) return this.doc(to, "device/list/0.3", {}, f.thread);
        if (f.step === 1 && !refused) {
          const p = isObject(last?.payload) ? (last!.payload as Doc) : {};
          const other = (Array.isArray(p.devices) ? (p.devices as Doc[]) : []).find((d) => d.consumerDid !== this.signer.did);
          return other === undefined ? undefined : this.doc(to, "device/wipe/0.2", { deviceId: String(other.deviceId), scope: "cacheAndKeys" }, f.thread);
        }
        return undefined;
      }
      case "device-remove-other": {
        if (f.step === 0) return this.doc(to, "device/list/0.3", {}, f.thread);
        if (f.step === 1 && !refused) {
          const p = isObject(last?.payload) ? (last!.payload as Doc) : {};
          const other = (Array.isArray(p.devices) ? (p.devices as Doc[]) : []).find((d) => d.consumerDid !== this.signer.did);
          if (other === undefined) return undefined;
          f.scratch.did = String(other.consumerDid);
          return this.doc(to, "device/wipe/0.2", { deviceId: String(other.deviceId), scope: "cacheAndKeys" }, f.thread);
        }
        if (f.step === 2) return this.doc(to, "acl/revoke/0.3", { subject: String(f.scratch.did), revocation: { kind: "entry" } }, f.thread);
        return undefined;
      }
      case "vault-keep-card": return f.step === 0 ? this.doc(to, "vault/credentials/receive/0.1", { credential: a.card, id: (a.card as Doc).id, contextId: "ceremony-context" }, f.thread) : undefined;
      case "vault-restore": {
        if (f.step === 0) return this.doc(to, "vault/credentials/query/0.1", { purpose: "membership" }, f.thread);
        if (f.step === 1 && !refused) {
          const ids = isObject(last?.payload) && Array.isArray((last!.payload as Doc).credentials) ? ((last!.payload as Doc).credentials as Doc[]).map((c) => String(c.id)) : [];
          f.scratch.ids = ids;
          return ids.length > 0 ? this.doc(to, "vault/credentials/get/0.2", { id: ids[0] }, f.thread) : undefined;
        }
        return undefined;
      }
      default: void code; return undefined;
    }
  }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    if (!MEMBER_KINDS.includes(p.kind)) throw new Error(`the member has no kind ${p.kind}`);
    this.asSuccessor = p.args?.as === "successor";
    const f = { kind: p.kind, step: 0, args: p.args ?? {}, to: p.to, thread: `urn:uuid:${randomUUID()}`, state: "open" as const, received: [] as Doc[], sent: [] as Doc[], scratch: {} as Doc };
    this.queue.push(f as never);
    const d = this.next(f as never)!;
    f.sent.push(d);
    return { threadId: f.thread, documents: [JSON.stringify(d)], sent: false, continues: true, from: this.asSuccessor ? ed25519Signer(seedOf(0x4f)).did : this.signer.did };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    f.step++;
    const refused = String(d.type).includes("/trust-task-error/");
    const code = isObject(d.payload) ? String((d.payload as Doc).code ?? "") : "";
    const nxt = refused ? undefined : this.next(f);
    if (nxt !== undefined) { f.sent.push(nxt); return { replies: [JSON.stringify(nxt)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 }; }
    // a refusal ends the flow; "already registered" is the wallet's own reading of that refusal as success
    f.state = f.scratch.declined === true || (refused && !(f.kind === "device-register" && code === "device/register:alreadyRegistered")) ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") {
      const f = this.queue.find((x) => x.thread === q.threadId);
      const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type);
      return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) };
    }
    if (q.query === "stored" && q.kind === "step-up-asked") return { value: this.queue.reduce((n, f) => n + f.sent.filter((d) => String(d.type).includes("approve-response")).length, 0) };
    if (q.query === "stored" && q.kind === "restored-cards") { const f = [...this.queue].reverse().find((x) => x.kind === "vault-restore"); return { value: f?.received.filter((d) => String(d.type).endsWith("get/0.2#response")).length ?? 0 }; }
    throw new Error(`the member does not answer observe ${q.query}`);
  }
}
