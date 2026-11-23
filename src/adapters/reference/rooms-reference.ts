// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the rooms ceremony (docs/32, group FC-RMS), written from the Trust Tasks specification text: a community that offers an `open` room to a member and hosts it
// (vtc/rooms/offers/list 0.4 and 0.3, offers/accept 0.1, memberships/list 0.1, rooms/records/put 0.3, rooms/blobs/upload/begin 0.2); the member's agent as key holder (rooms/keys/list 0.2 and 0.1,
// key-package 0.2, act 0.9 and 0.8); and the member who asks for them in the order the wallet's rooms code does. Credentials are the oracle's own compact form (a payload and the room's signature):
// the member passes them on unchanged and only the host reads them, so the form is the oracle's, not a claim about the platform's. No MLS: an `open` room has no group, so no KeyPackage is
// expected and no Welcome exists; the sealed tiers are not modelled. Mutants of the community and the agent end the scenario that watches for them failed (test/rooms-pairs.test.ts).
import { createHash, randomUUID, verify as nodeVerify } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { base58Encode } from "../../crypto/base58.ts";
import { ed25519PublicKeyObject, ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { blobManifest, roomsStoredKind, type RoomsReading } from "./rooms-state.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
export const ROOMS_MUTANTS = ["rmsListsToNonMember", "rmsExpiredAccepted", "rmsPutWithoutPresentation", "rmsNoVersionCheck", "rmsReplayWrites", "rmsInvalidManifestAccepted", "rmsActsAnyType", "rmsKeyPackageUninvited"] as const;
export const ROOMS_KINDS = ["rooms-offers", "rooms-memberships", "rooms-accept", "rooms-put", "rooms-blob-begin", "rooms-keys-list", "rooms-key-package", "rooms-act"];
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});
const b64u = (b: Uint8Array | string): string => (typeof b === "string" ? Buffer.from(b, "utf8") : Buffer.from(b)).toString("base64url");
const tail = (c: string): string => c.slice(c.lastIndexOf(":") + 1);
const ROOM = ed25519Signer(seedOf(0xc4));
/** A producer names a fresh upload key for each proxied begin (rooms/blobs/upload/begin 0.2 producer item 3), so a host has a transfer mode. */
let uploadKeys = 0;
/** A well-formed invitation credential (an unsigned DTG-shaped JSON text) that no room issued: it parses but does not verify. */
export const FOREIGN_INVITATION = JSON.stringify({ "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"], type: ["VerifiableCredential", "DTGCredential", "InvitationCredential"], issuer: "did:example:not-the-room", issuerScope: "public", validFrom: "2026-01-01T00:00:00Z", credentialSubject: { id: "did:example:member" } });
const COMMUNITY_SEED = 0xc1, AGENT_SEED = 0xa7, MEMBER_SEED = 0x4d;
const OFFERS = ["0.4", "0.3"], PUT = ["0.3"], BEGIN = ["0.2"], MEMBERSHIPS = ["0.1"], ACCEPT = ["0.1"];

/** A credential in the oracle's compact form: base64url(JSON claims) "." base64url(room signature over the claims text). */
function issue(kind: "membership" | "authority" | "invitation", subject: string, actions: string[], validUntil: string): string {
  const claims = b64u(JSON.stringify({ kind, iss: ROOM.did, sub: subject, actions, validUntil }));
  return `${claims}.${b64u(ROOM.sign(new TextEncoder().encode(claims)))}`;
}
function read(cred: unknown, nowMs: number): { kind: string; sub: string; actions: string[] } | undefined {
  if (typeof cred !== "string" || cred.split(".").length !== 2) return undefined;
  const [claims, sig] = cred.split(".") as [string, string];
  try {
    if (!nodeVerify(null, new TextEncoder().encode(claims), ed25519PublicKeyObject(ROOM.publicKey), Buffer.from(sig, "base64url"))) return undefined;
    const c = JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as { kind: string; iss: string; sub: string; actions: string[]; validUntil: string };
    if (c.iss !== ROOM.did || Date.parse(c.validUntil) <= nowMs) return undefined;
    return { kind: c.kind, sub: c.sub, actions: c.actions };
  } catch { return undefined; }
}
/** The host's check of a presentation: a membership for the signer, an authority chain leaf-first ending at the room conferring `write`. */
function authorised(presentation: unknown, signer: string, nowMs: number, action: string): boolean {
  if (!isObject(presentation)) return false;
  const m = read(presentation.membership, nowMs);
  if (m === undefined || m.kind !== "membership" || m.sub !== signer) return false;
  const chain = Array.isArray(presentation.authority) ? presentation.authority.map((a) => read(a, nowMs)) : [];
  return chain.length > 0 && chain.length <= 8 && chain.every((a) => a !== undefined && a.kind === "authority") && chain[0]!.sub === signer && chain[0]!.actions.includes(action);
}

interface Offer { roomId: string; member: string; offeredAt: number; validUntil: string; state: "open" | "accepted"; creds: { invitation: string; membership: string; authority: string } }

export class RoomsCommunity implements Adapter {
  readonly signer = ed25519Signer(seedOf(COMMUNITY_SEED));
  private readonly mutants: ReadonlySet<string>;
  private legacy: boolean;
  private members = new Set<string>();
  private offers: Offer[] = [];
  private records = new Map<string, { version: number; title: string }>();
  private counter = 0;
  private uploads = 0;
  private seen = new Map<string, string>();
  /** The replay mutant: a repeated document id is executed again, past the version check, instead of being answered from what was already answered. */
  private force = false;
  constructor(o: { mutants?: string[]; legacy?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.legacy = o.legacy === true; }
  private served(): Record<string, string[]> {
    return { "vtc/rooms/offers/list": this.legacy ? ["0.3"] : OFFERS, "vtc/rooms/offers/accept": ACCEPT, "vtc/rooms/memberships/list": MEMBERSHIPS, "rooms/records/put": PUT, "rooms/blobs/upload/begin": BEGIN };
  }
  async capabilities(): Promise<Capabilities> {
    return { name: this.mutants.size === 0 ? `reference-rooms-community${this.legacy ? ":legacy" : ""}` : `reference-rooms-community+${[...this.mutants].join("+")}`, implementation: "reference-rooms-community", version: "suite reference, community and room host (open tier)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: Object.entries(this.served()).flatMap(([s, vs]) => vs.map((v) => `${S}${s}/${v}`)), carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-RMS", roles: ["community"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return `${this.offers.length}:${this.records.size}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.members.clear(); this.offers = []; this.records.clear(); this.counter = 0; this.uploads = 0; this.seen.clear(); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "seedMember") { this.members.add(String(args.vid)); return { documents: [] }; }
    if (action === "serveVersions") { this.legacy = args.profile === "legacy"; return { documents: [] }; }
    if (action === "offerRoom") {
      const member = String(args.vid), roomId = ROOM.did, until = args.expired === true ? stamp(Date.now() - 60000) : stamp(Date.now() + 30 * 86400000);
      // the credentials are issued as of now and valid to the offer's end; an expired offer's are issued already lapsed, as the offer itself is
      this.offers.push({ roomId, member, offeredAt: Date.now(), validUntil: until, state: "open", creds: { invitation: issue("invitation", member, [], until), membership: issue("membership", member, ["read"], stamp(Date.now() + 30 * 86400000)), authority: issue("authority", member, ["read", "write"], stamp(Date.now() + 30 * 86400000)) } });
      return { documents: [] };
    }
    if (action === "waitPast") return { documents: [] };
    throw new Error(`the community has no trigger ${action}`);
  }
  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc { return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } }); }
  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const prior = this.seen.get(String(doc.id));
    // one change in force per document id: a repeat of a document already answered is answered again with the same reply and changes nothing (the mutant executes it a second time)
    this.force = prior !== undefined && this.mutants.has("rmsReplayWrites");
    const r = prior !== undefined && !this.force ? (JSON.parse(prior) as Doc) : this.dispatch(doc, String(doc.type), Date.now());
    this.force = false;
    this.seen.set(String(doc.id), JSON.stringify(r));
    return { replies: [JSON.stringify(r)], transport: { status: String(r.type).includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private dispatch(doc: Doc, type: string, now: number): Doc {
    if (doc.recipient !== this.signer.did) return this.refuse(doc, "wrongRecipient", "the recipient is another party");
    if (doc.proof === undefined) return this.refuse(doc, "proofRequired", "a proof is required");
    if (!verifyDocumentProof(doc, { nowMs: now }).valid) return this.refuse(doc, "proofInvalid", "the proof did not verify");
    const t = type.replace(S, ""), slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1);
    const served = this.served();
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (!served[slug]!.includes(version)) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: served[slug]!.map((v) => `${S}${slug}/${v}`) });
    const who = String(doc.issuer), p = pl(doc), mine = this.offers.filter((o) => o.member === who);
    const wire = (o: Offer): Doc => ({ roomId: o.roomId, host: this.signer.did, label: "Ceremony room", visibility: "open", actions: ["read", "write"], validUntil: o.validUntil, offeredAt: stamp(o.offeredAt) });
    if (slug === "vtc/rooms/offers/list") {
      if (!this.members.has(who) && !this.mutants.has("rmsListsToNonMember")) return this.refuse(doc, "vtc/rooms/offers/list:notAMember", "the caller is not an active member of this community");
      return this.reply(doc, `${type}#response`, { items: mine.map((o) => ({ ...wire(o), state: o.state, credentials: o.creds })), renewals: [] });
    }
    if (slug === "vtc/rooms/memberships/list") {
      if (!this.members.has(who)) return this.refuse(doc, "vtc/rooms/memberships/list:notAMember", "the caller is not an active member of this community");
      return this.reply(doc, `${type}#response`, { items: mine.map((o) => ({ ...wire(o), state: o.state === "accepted" ? "admitted" : "offered", ...(o.state === "accepted" ? { admittedAt: stamp(now) } : {}) })) });
    }
    if (slug === "vtc/rooms/offers/accept") {
      if (!this.members.has(who)) return this.refuse(doc, "vtc/rooms/offers/accept:notAMember", "the caller is not an active member of this community");
      const o = mine.find((x) => x.roomId === p.roomId);
      if (o === undefined) return this.refuse(doc, "vtc/rooms/offers/accept:notFound", "no open or recently accepted offer to this room is addressed to the caller");
      if (Date.parse(o.validUntil) <= now && !this.mutants.has("rmsExpiredAccepted")) return this.refuse(doc, "vtc/rooms/offers/accept:offerExpired", "the offer's validUntil has passed");
      if (p.keyPackage !== undefined) return this.refuse(doc, "vtc/rooms/offers/accept:keyPackageNotExpected", "the room is open, which has no group, and the request carries a KeyPackage");
      o.state = "accepted";
      return this.reply(doc, `${type}#response`, { roomId: o.roomId, state: "admitted" });
    }
    if (slug === "rooms/records/put") {
      if (!authorised(p.presentation, who, now, "write") && !this.mutants.has("rmsPutWithoutPresentation")) return this.refuse(doc, "permissionDenied", "the presentation does not authorise this write");
      const key = String(p.key), have = this.records.get(key), expected = typeof p.expectedVersion === "number" ? p.expectedVersion : 0;
      if (have !== undefined && have.version !== expected && !this.mutants.has("rmsNoVersionCheck") && !this.force) return this.refuse(doc, "rooms/records/put:versionConflict", "the record is at another version", { currentVersion: have.version });
      if (have === undefined && expected !== 0) return this.refuse(doc, "rooms/records/put:versionConflict", "the record does not exist at that version", { currentVersion: 0 });
      this.counter++;
      this.records.set(key, { version: this.counter, title: String((isObject(p.cleartext) ? p.cleartext.title : undefined) ?? "") });
      return this.reply(doc, `${type}#response`, { key, version: this.counter, epoch: 0 });
    }
    // rooms/blobs/upload/begin
    if (!authorised(p.presentation, who, now, "write") && !this.mutants.has("rmsPutWithoutPresentation")) return this.refuse(doc, "permissionDenied", "the presentation does not authorise this upload");
    const m = isObject(p.manifest) ? p.manifest : {}, ch = isObject(m.chunks) ? m.chunks : {};
    const ok = typeof m.size === "number" && typeof ch.chunkSize === "number" && ch.chunkSize >= 16384 && ch.chunkSize <= 262144 && Array.isArray(ch.chunkDigests) && ch.chunkCount === ch.chunkDigests.length && ch.chunkCount === Math.ceil(m.size / ch.chunkSize) && typeof m.digest === "string" && m.digest.startsWith("z");
    if (!ok && !this.mutants.has("rmsInvalidManifestAccepted")) return this.refuse(doc, "rooms/blobs/upload/begin:invalidManifest", "the manifest is not consistent");
    this.uploads++;
    return this.reply(doc, `${type}#response`, { uploadId: randomUUID(), mode: "proxied", missing: Array.from({ length: Number(ch.chunkCount ?? 1) }, (_, i) => i), expiresAt: stamp(now + 3600000) });
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query === "stored") {
      if (q.kind.startsWith("rooms-records:")) return { value: this.records.size === Number(q.kind.slice(14)) ? 1 : 0 };
      if (q.kind.startsWith("rooms-writes:")) return { value: this.counter === Number(q.kind.slice(13)) ? 1 : 0 };
      if (q.kind.startsWith("rooms-uploads:")) return { value: this.uploads === Number(q.kind.slice(14)) ? 1 : 0 };
    }
    throw new Error(`the community does not answer ${q.query}`);
  }
}

/** The member's key holder: lists the rooms it can open (none for an open room: there is no group), mints a KeyPackage only against an invitation the room issued, and completes a host-bound request as the member. */
export class RoomsAgent implements Adapter {
  readonly signer = ed25519Signer(seedOf(AGENT_SEED));
  private readonly mutants: ReadonlySet<string>;
  private legacy: boolean;
  private seen = new Map<string, string>();
  constructor(o: { mutants?: string[]; legacy?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.legacy = o.legacy === true; }
  private served(): Record<string, string[]> { return { "rooms/keys/list": this.legacy ? ["0.1"] : ["0.2", "0.1"], "rooms/keys/key-package": ["0.2"], "rooms/keys/act": this.legacy ? ["0.8"] : ["0.9", "0.8"] }; }
  async capabilities(): Promise<Capabilities> {
    return { name: this.mutants.size === 0 ? `reference-rooms-agent${this.legacy ? ":legacy" : ""}` : `reference-rooms-agent+${[...this.mutants].join("+")}`, implementation: "reference-rooms-agent", version: "suite reference, agent (room keys, open tier)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: Object.entries(this.served()).flatMap(([s, vs]) => vs.map((v) => `${S}${s}/${v}`)), carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-RMS", roles: ["agent"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return String(this.seen.size); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.seen.clear(); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "serveVersions") { this.legacy = args.profile === "legacy"; return { documents: [] }; }
    throw new Error(`the agent has no trigger ${action}`);
  }
  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc { return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } }); }
  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const prior = this.seen.get(String(doc.id));
    const r = prior !== undefined ? (JSON.parse(prior) as Doc) : this.dispatch(doc, String(doc.type), Date.now());
    this.seen.set(String(doc.id), JSON.stringify(r));
    return { replies: [JSON.stringify(r)], transport: { status: String(r.type).includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private dispatch(doc: Doc, type: string, now: number): Doc {
    if (doc.recipient !== this.signer.did) return this.refuse(doc, "wrongRecipient", "the recipient is another party");
    if (doc.proof === undefined) return this.refuse(doc, "proofRequired", "a proof is required");
    if (!verifyDocumentProof(doc, { nowMs: now }).valid) return this.refuse(doc, "proofInvalid", "the proof did not verify");
    const t = type.replace(S, ""), slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1), served = this.served(), p = pl(doc);
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (!served[slug]!.includes(version)) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: served[slug]!.map((v) => `${S}${slug}/${v}`) });
    if (slug === "rooms/keys/list") return this.reply(doc, `${type}#response`, { rooms: [] });
    if (slug === "rooms/keys/key-package") {
      const inv = read(p.invitation, now);
      if ((inv === undefined || inv.kind !== "invitation") && !this.mutants.has("rmsKeyPackageUninvited")) return this.refuse(doc, "rooms/keys/key-package:notInvited", "the invitation does not verify, was not issued by the room, or has expired");
      return this.reply(doc, `${type}#response`, { keyPackage: "AAEAAgADAAQ", expiresAt: stamp(now + 7 * 86400000), alreadyMinted: false });
    }
    // rooms/keys/act: the document must be one of the host-bound requests in the task's table; the agent holds the keys of no member here, so a table type naming an issuer is refused issuerNotPrincipal
    const d = isObject(p.document) ? p.document : {}, dt = String(d.type ?? ""), actable = [`${S}rooms/records/put/0.3`, `${S}rooms/blobs/upload/begin/0.2`, `${S}vtc/rooms/offers/accept/0.1`];
    if (!actable.includes(dt) && !this.mutants.has("rmsActsAnyType")) return this.refuse(doc, "rooms/keys/act:typeNotActable", "the document's type is not in this task's table", { type: dt });
    // the agent in this ceremony holds the keys of no member: a document naming an issuer is refused with issuerNotPrincipal (the issuer is not a member the recipient may act as for its caller)
    return this.refuse(doc, "rooms/keys/act:issuerNotPrincipal", "the document's issuer is not a member the recipient may act as for its caller", { issuer: String(d.issuer ?? "") });
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> { if (q.query === "ceremony") return { value: "unknown" }; throw new Error(`the agent does not answer ${q.query}`); }
}

interface RFlow { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; rung: number }

/** The member: asks for the offers, accepts, lists memberships, writes a note and opens an upload at the host, and asks its agent for keys, a KeyPackage and an act, signing each host-bound request itself (class D: the wallet's agent completes these as the member). */
export class RoomsMember implements Adapter {
  readonly signer = ed25519Signer(seedOf(MEMBER_SEED));
  private queue: RFlow[] = [];
  private st: RoomsReading = {};
  private creds: { invitation?: string; membership?: string; authority?: string } = {};
  private room: string | undefined;
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-rooms-member", implementation: "reference-rooms-member", version: "suite reference, member (rooms)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: ROOMS_KINDS, ceremonyRoles: [{ ceremony: "FC-RMS", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.queue.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.queue.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.queue = []; this.st = {}; this.creds = {}; this.room = undefined; }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the member has no triggers"); }
  private doc(to: string, type: string, payload: Doc, thread: string): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${type}`, threadId: thread, issuer: this.signer.did, recipient: to, issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "authentication" }) as unknown as Doc;
  }
  private presentation(a: Record<string, unknown>): Doc | undefined {
    if (a.presentation === "none") return undefined;
    if (a.presentation === "foreign") return { membership: issue("membership", "did:key:z6MkforeignMemberNotThisOne", ["read"], stamp(Date.now() + 86400000)), authority: [issue("authority", "did:key:z6MkforeignMemberNotThisOne", ["read", "write"], stamp(Date.now() + 86400000))] };
    return { membership: this.creds.membership, authority: [this.creds.authority] };
  }
  private next(f: RFlow): Doc | undefined {
    const a = f.args, to = f.to;
    switch (f.kind) {
      case "rooms-offers": return f.step === 0 ? this.doc(to, `vtc/rooms/offers/list/${OFFERS[f.rung]}`, {}, f.thread) : undefined;
      case "rooms-memberships": return f.step === 0 ? this.doc(to, "vtc/rooms/memberships/list/0.1", {}, f.thread) : undefined;
      case "rooms-accept": return f.step === 0 ? this.doc(to, "vtc/rooms/offers/accept/0.1", { roomId: String(a.roomId ?? this.room ?? "") }, f.thread) : undefined;
      case "rooms-put": {
        if (f.step !== 0) return undefined;
        const pres = this.presentation(a), payload: Doc = { roomId: String(a.roomId ?? this.room ?? ""), key: String(a.key ?? "note-1"), expectedVersion: Number(a.expectedVersion ?? 0), cleartext: { title: String(a.title ?? "Ceremony note"), body: String(a.body ?? "written by the ceremony") }, ...(pres === undefined ? {} : { presentation: pres }) };
        return this.doc(to, "rooms/records/put/0.3", payload, f.thread);
      }
      case "rooms-blob-begin": {
        if (f.step !== 0) return undefined;
        const pres = this.presentation(a), manifest = blobManifest(Number(a.size ?? 20000), 16384, (b) => new Uint8Array(createHash("sha256").update(b).digest()), base58Encode);
        if (a.corrupt === true) manifest.chunks.chunkCount += 1;
        return this.doc(to, "rooms/blobs/upload/begin/0.2", { roomId: String(a.roomId ?? this.room ?? ""), uploadKey: ed25519Signer(seedOf(0xe0 + (uploadKeys++ % 16))).did, manifest, ...(pres === undefined ? {} : { presentation: pres }) }, f.thread);
      }
      case "rooms-keys-list": return f.step === 0 ? this.doc(to, `rooms/keys/list/${["0.2", "0.1"][f.rung]}`, {}, f.thread) : undefined;
      case "rooms-key-package": return f.step === 0 ? this.doc(to, "rooms/keys/key-package/0.2", { roomId: String(a.roomId ?? this.room ?? "did:example:no-such-room"), invitation: a.invitation === "own" ? String(this.creds.invitation ?? "") : a.invitation === "foreign" ? FOREIGN_INVITATION : String(a.invitation ?? "not-a-credential") }, f.thread) : undefined;
      case "rooms-act": return f.step === 0 ? this.doc(to, `rooms/keys/act/${["0.9", "0.8"][f.rung]}`, { document: { id: `urn:uuid:${randomUUID()}`, type: `${S}${String(a.actType ?? "rooms/records/put/0.3")}`, issuer: this.signer.did, recipient: String(a.host ?? to), issuedAt: new Date().toISOString(), payload: { roomId: String(a.roomId ?? "did:example:no-such-room"), key: "k", cleartext: { body: "x" } } } }, f.thread) : undefined;
      default: return undefined;
    }
  }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`;
    const f: RFlow = { kind: p.kind, step: 0, args: p.args ?? {}, to: typeof p.args?.recipient === "string" ? p.args.recipient : p.to, thread, state: "open", received: [], rung: 0 };
    this.queue.push(f);
    const d = this.next(f);
    if (d === undefined) throw new Error(`the member has no kind ${p.kind}`);
    return { threadId: thread, documents: [JSON.stringify(d)], sent: false, continues: true };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const refused = String(d.type).includes("/trust-task-error/"), code = refused ? String(pl(d).code ?? "") : "", body = pl(d);
    // the member's own ladder: a version refusal means the question was not taken; it asks at the next version
    const ladder = f.kind === "rooms-offers" ? OFFERS : f.kind === "rooms-keys-list" ? ["0.2", "0.1"] : f.kind === "rooms-act" ? ["0.9", "0.8"] : undefined;
    if (refused && code === "unsupportedVersion" && ladder !== undefined && f.rung + 1 < ladder.length) { f.rung++; f.step = 0; return { replies: [JSON.stringify(this.next(f))], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 }; }
    if (refused) this.st.refused = tail(code);
    else switch (f.kind) {
      case "rooms-offers": { const items = Array.isArray(body.items) ? (body.items as Doc[]) : []; this.st.offers = items.length; this.st.offerState = String(items[0]?.state ?? ""); this.st.offersVersion = OFFERS[f.rung]; this.st.offerCreds = items[0] !== undefined && isObject(items[0].credentials);
        if (items[0] !== undefined) { this.room = String(items[0].roomId); this.creds = { ...(items[0].credentials as typeof this.creds) }; } break; }
      case "rooms-memberships": this.st.memberships = (Array.isArray(body.items) ? (body.items as Doc[]) : []).map((i) => String(i.state)); break;
      case "rooms-accept": this.st.accepted = String(body.state ?? ""); break;
      case "rooms-put": this.st.putKey = String(body.key); this.st.putVersion = Number(body.version); break;
      case "rooms-blob-begin": this.st.upload = String(body.uploadId); break;
      case "rooms-keys-list": this.st.keys = Array.isArray(body.rooms) ? body.rooms.length : undefined; this.st.keysVersion = ["0.2", "0.1"][f.rung]; break;
      case "rooms-key-package": this.st.keyPackage = typeof body.keyPackage === "string"; break;
      default: this.st.acted = true; this.st.actVersion = ["0.9", "0.8"][f.rung];
    }
    f.state = refused ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") { const f = this.queue.find((x) => x.thread === q.threadId); const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type); return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) }; }
    if (q.query !== "stored") throw new Error(`the member does not answer observe ${q.query}`);
    return { value: roomsStoredKind(this.st, q.kind) };
  }
}
