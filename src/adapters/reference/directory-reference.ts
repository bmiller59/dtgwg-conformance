// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the directory ceremony (docs/31, group FC-DIR): a community that serves the member directory (vtc/directory/fields/list 0.1, card/show 0.1, card/update 0.1,
// entries/list 0.2 (0.1 on the legacy profile), entries/show 0.1, query 0.1) and a member who reads and writes their own card and reads other members' entries, each written from the
// Trust Tasks specification text. It models only what a scenario observes: the audience order, the intersection of the member's visibility and the community's ceiling, listing,
// completeness of required fields, revision and ordering of changes. No groups, connections, introductions, images, facets or paging (the specification's other rules). The oracle pair
// completes every scenario and each deliberate mutant of the community ends the scenario that watches for it `failed` (test/directory-pairs.test.ts).
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { dirStoredKind } from "./dir-state.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
const D = "vtc/directory/";
const COMMUNITY_SEED = 0xb4, MEMBER_SEED = 0x4d;
/** The stand-in second member (class D: the community's own member who reads and writes cards, driven through the community's trigger). */
export const READER_SEED = 0x61;
export const readerDid = (): string => ed25519Signer(seedOf(READER_SEED)).did;
export const DIR_MUTANTS = ["dirClampsSilently", "dirHiddenStillListed", "dirWithheldAsNull", "dirNoRevisionCheck", "dirServesNonMember", "dirDerivedWritable", "dirNarrowingDeferred", "dirQueryEmptyNotNotFound", "dirListsIncomplete"] as const;
export type DirMutant = (typeof DIR_MUTANTS)[number];
export const DIR_KINDS = ["dir-my-card", "dir-set-name", "dir-list-members", "dir-show-member", "dir-lookup-name", "dir-member-by-did"];

type Aud = "admins" | "groups" | "connections" | "members" | "public";
const RANK: Record<Aud, number> = { admins: 0, groups: 1, connections: 1, members: 2, public: 3 };
interface Def { key: string; label: string; type: string; source: "member" | "derived"; ceiling: Aud; def: Aud; required: boolean; order: number }
/** The base fields: the keys are the specification's; the ceilings and default visibilities are the specification's worked example (an illustration, not a rule). */
const FIELDS: Def[] = [
  { key: "displayName", label: "Name", type: "text", source: "member", ceiling: "public", def: "members", required: true, order: 0 },
  { key: "nickname", label: "Nickname", type: "text", source: "member", ceiling: "public", def: "members", required: false, order: 10 },
  { key: "avatar", label: "Photo", type: "image", source: "member", ceiling: "public", def: "members", required: false, order: 20 },
  { key: "pronouns", label: "Pronouns", type: "text", source: "member", ceiling: "public", def: "members", required: false, order: 30 },
  { key: "bio", label: "About", type: "longText", source: "member", ceiling: "public", def: "members", required: false, order: 40 },
  { key: "links", label: "Links", type: "url", source: "member", ceiling: "public", def: "members", required: false, order: 50 },
  { key: "role", label: "Role", type: "text", source: "derived", ceiling: "public", def: "members", required: false, order: 80 },
  { key: "joinedAt", label: "Joined", type: "date", source: "derived", ceiling: "members", def: "members", required: false, order: 85 },
  { key: "did", label: "DID", type: "did", source: "derived", ceiling: "members", def: "admins", required: false, order: 90 },
  { key: "personhood", label: "Personhood", type: "text", source: "derived", ceiling: "members", def: "admins", required: false, order: 95 },
];
const DEFS = new Map(FIELDS.map((f) => [f.key, f]));
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const dig = (d: Doc): string => digestMultibase(d as never);
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});
const entryId = (): string => `dir_${randomUUID().replaceAll("-", "")}`;

interface Card { did: string; entryId: string; values: Doc; visibility: Record<string, Aud>; projVis: Record<string, Aud>; listing: "listed" | "findable" | "hidden"; search: string; introductions: string; revision: number; updatedAt: string; inForceAt: number }
interface ViewLog { code: string; inList: boolean; fields: string[]; kind: string }

export class DirCommunity implements Adapter {
  readonly signer = ed25519Signer(seedOf(COMMUNITY_SEED));
  private readonly mutants: ReadonlySet<string>;
  private legacy: boolean;
  private cards = new Map<string, Card>();
  private members = new Set<string>();
  private seen = new Map<string, { digest: string; reply: string }>();
  private bLog: ViewLog[] = [];
  private updates: string[] = [];
  private adminSees = new Map<string, string[]>();
  constructor(o: { mutants?: string[]; legacy?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.legacy = o.legacy === true; }
  private m(id: DirMutant): boolean { return this.mutants.has(id); }

  async capabilities(): Promise<Capabilities> {
    const list = this.legacy ? "entries/list/0.1" : "entries/list/0.2";
    const types = [`${D}fields/list/0.1`, `${D}card/show/0.1`, `${D}card/update/0.1`, `${D}${list}`, `${D}entries/show/0.1`, `${D}query/0.1`].map((t) => `${S}${t}`);
    return { name: this.mutants.size === 0 ? `reference-dir-community${this.legacy ? ":legacy" : ""}` : `reference-dir-community+${[...this.mutants].join("+")}`, implementation: "reference-dir-community", version: "suite reference, community (member directory)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: types, carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-DIR", roles: ["community"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return `${this.cards.size}:${this.members.size}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.cards.clear(); this.members.clear(); this.seen.clear(); this.bLog = []; this.updates = []; this.adminSees.clear(); }

  /** Harness stand-ins for what a deployment does out of band. `seedMember {vid}`: the community's records hold this DID as an active member. `dirMember {op}`: the stand-in second member (class D) acts. */
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "knowApplicant") return { documents: [] };
    if (action === "seedMember") { this.members.add(String(args.vid)); return { documents: [] }; }
    // a deployment that serves the older members-list version (class D, labelled so in a row)
    if (action === "serveVersions") { this.legacy = args.profile === "legacy"; return { documents: [] }; }
    if (action !== "dirMember") throw new Error(`the community has no trigger ${action}`);
    const b = readerDid();
    this.members.add(b);
    const op = String(args.op);
    if (op === "update") {
      const r = this.update(b, { values: args.values ?? {}, visibility: args.visibility ?? {}, ...(args.listing === undefined ? {} : { discoverability: { listing: args.listing, search: "byName", external: false } }) }, Date.now());
      this.updates.push(r.code);
    } else if (op === "view") {
      const target = String(args.target);
      const t = this.cards.get(target);
      const list = this.entriesList(b);
      const inList = t !== undefined && Array.isArray(list.items) && (list.items as Doc[]).some((e) => e.entryId === t.entryId);
      if (t === undefined) this.bLog.push({ code: "noCard", inList: false, fields: [], kind: "show" });
      else {
        const s = this.entriesShow(b, { entryId: t.entryId });
        this.bLog.push({ code: s.code, inList, fields: s.code === "ok" ? Object.keys(((s.body.entry as Doc).fields as Doc)) : [], kind: "show" });
      }
    } else if (op === "query") {
      const q = this.query(b, { subject: String(args.target), ...(args.fields === undefined ? {} : { fields: String(args.fields) }) });
      this.bLog.push({ code: q.code, inList: false, fields: q.code === "ok" ? Object.keys(q.body.fields as Doc) : [], kind: "query" });
    } else throw new Error(`the community has no dirMember op ${op}`);
    return { documents: [] };
  }

  // ---- the model
  private card(did: string, now = Date.now()): Card {
    let c = this.cards.get(did);
    if (c === undefined) { c = { did, entryId: entryId(), values: {}, visibility: {}, projVis: {}, listing: "listed", search: "byName", introductions: "anyone", revision: 0, updatedAt: stamp(now), inForceAt: 0 }; this.cards.set(did, c); }
    return c;
  }
  private covers(aud: Aud, viewer: "member" | "admin"): boolean { return viewer === "admin" || RANK[aud] >= RANK.members; }
  /** The fields of `c` a viewer sees: the member's visibility (or the default) intersected with the ceiling; a withheld field is absent. */
  private project(c: Card, viewer: "member" | "admin"): Doc {
    const out: Doc = {};
    const vis = this.m("dirNarrowingDeferred") ? c.projVis : c.visibility;
    for (const f of FIELDS) {
      const chosen = vis[f.key] ?? f.def;
      const effective: Aud = RANK[chosen] <= RANK[f.ceiling] ? chosen : f.ceiling;
      const value = f.source === "derived" ? (f.key === "role" ? "member" : f.key === "did" ? c.did : f.key === "joinedAt" ? c.updatedAt.slice(0, 10) : "false") : c.values[f.key];
      const shown = this.covers(effective, viewer);
      if (shown && value !== undefined) out[f.key] = value;
      else if (this.m("dirWithheldAsNull") && !shown) out[f.key] = null;
    }
    return out;
  }
  private complete(c: Card): boolean { return c.values.displayName !== undefined; }
  private cardBody(c: Card): Doc { return { entryId: c.entryId, values: c.values, visibility: c.visibility, discoverability: { listing: c.listing, search: c.search, external: false }, introductions: c.introductions, revision: c.revision, updatedAt: c.updatedAt }; }
  private err(code: string, details?: Doc): { code: string; body: Doc } { return { code, body: details === undefined ? {} : { details } }; }

  private update(who: string, p: Doc, now: number, issuedAtMs = now, expected?: number): { code: string; body: Doc } {
    if (!this.members.has(who)) return this.err(`${D}card/update:notMember`);
    const c = this.card(who, now);
    if (c.inForceAt > issuedAtMs) return this.err(`${D}card/update:superseded`, { revision: c.revision });
    const exp = expected ?? (typeof p.expectedRevision === "number" ? p.expectedRevision : undefined);
    if (exp !== undefined && exp !== c.revision && !this.m("dirNoRevisionCheck")) return this.err(`${D}card/update:superseded`, { revision: c.revision });
    const values = isObject(p.values) ? (p.values as Doc) : {}, vis = isObject(p.visibility) ? (p.visibility as Doc) : {};
    for (const [k, v] of Object.entries(values)) {
      const f = DEFS.get(k);
      if (f === undefined) return this.err(`${D}card/update:fieldUnknown`, { field: k });
      if (f.source !== "member" && !this.m("dirDerivedWritable")) return this.err(`${D}card/update:fieldNotWritable`, { field: k });
      if (v !== null && typeof v === "string" && k === "displayName" && (v.length === 0 || v.length > 64)) return this.err(`${D}card/update:valueInvalid`, { field: k });
    }
    const nextVis = { ...c.visibility };
    for (const [k, v] of Object.entries(vis)) {
      const f = DEFS.get(k);
      if (f === undefined) return this.err(`${D}card/update:fieldUnknown`, { field: k });
      if (v === null) { delete nextVis[k]; continue; }
      const a = v as Aud;
      if (RANK[a] > RANK[f.ceiling]) { if (this.m("dirClampsSilently")) { nextVis[k] = f.ceiling; continue; } return this.err(`${D}card/update:aboveCeiling`, { field: k }); }
      nextVis[k] = a;
    }
    const prior = { ...c.visibility };
    for (const [k, v] of Object.entries(values)) { if (v === null) delete c.values[k]; else c.values[k] = v; }
    c.visibility = nextVis;
    c.projVis = prior;
    if (isObject(p.discoverability)) c.listing = (p.discoverability as Doc).listing as Card["listing"];
    c.revision += 1;
    c.updatedAt = stamp(now);
    c.inForceAt = issuedAtMs;
    return { code: "ok", body: { card: this.cardBody(c), missingRequired: this.complete(c) ? [] : ["displayName"] } };
  }
  private entriesList(who: string): Doc {
    const items = [...this.cards.values()].filter((c) => (c.listing === "listed" || (this.m("dirHiddenStillListed") && c.listing === "hidden")) && (this.complete(c) || this.m("dirListsIncomplete"))).map((c) => ({ entryId: c.entryId, fields: this.project(c, "member") }));
    void who;
    return { items };
  }
  private entriesShow(who: string, p: Doc): { code: string; body: Doc } {
    if (p.did !== undefined) return this.err("permissionDenied");
    const c = [...this.cards.values()].find((x) => x.entryId === p.entryId);
    if (c === undefined || (c.listing === "hidden" && !this.m("dirHiddenStillListed") && c.did !== who)) return this.err(`${D}entries/show:notFound`);
    return { code: "ok", body: { entry: { entryId: c.entryId, fields: this.project(c, "member") } } };
  }
  private query(_who: string, p: Doc): { code: string; body: Doc } {
    const c = this.cards.get(String(p.subject));
    const hint = typeof p.fields === "string" ? p.fields.split(",").map((s) => s.trim()) : undefined;
    const proj = c === undefined ? {} : this.project(c, "member");
    const fields = Object.fromEntries(Object.entries(proj).filter(([k]) => hint === undefined || hint.includes(k)));
    if (c === undefined || (Object.keys(fields).length === 0 && !this.m("dirQueryEmptyNotNotFound"))) return this.err(`${D}query:notFound`);
    return { code: "ok", body: { subject: c.did, fields } };
  }

  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc {
    return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } });
  }
  private out(d: Doc): SendResult { const t = String(d.type); return { replies: [JSON.stringify(d)], transport: { status: t.includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 }; }

  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const now = Date.now();
    const key = String(doc.id), digest = dig(doc);
    const prior = this.seen.get(key);
    if (prior !== undefined) return prior.digest !== digest ? this.out(this.refuse(doc, "idConflict", "the id was used by a different document")) : { replies: [prior.reply], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
    if (doc.recipient !== this.signer.did) return this.out(this.refuse(doc, "wrongRecipient", "the recipient is another party"));
    const t = String(doc.type).replace(S, "");
    const proofRequired = t.startsWith(`${D}card/update/`);
    if (doc.proof === undefined && proofRequired) return this.out(this.refuse(doc, "proofRequired", "a proof is required"));
    if (doc.proof !== undefined && !verifyDocumentProof(doc, { nowMs: now }).valid) return this.out(this.refuse(doc, "proofInvalid", "the proof did not verify"));
    if (!(Math.abs(now - Date.parse(String(doc.issuedAt))) <= 300_000)) return this.out(this.refuse(doc, "expired", "issuedAt is outside the acceptance window"));
    const result = this.dispatch(doc, String(doc.type), now);
    this.seen.set(key, { digest, reply: JSON.stringify(result) });
    return this.out(result);
  }
  private dispatch(doc: Doc, type: string, now: number): Doc {
    const who = String(doc.issuer), p = pl(doc);
    const t = type.replace(S, "");
    const slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1);
    const served: Record<string, string> = { [`${D}fields/list`]: "0.1", [`${D}card/show`]: "0.1", [`${D}card/update`]: "0.1", [`${D}entries/list`]: this.legacy ? "0.1" : "0.2", [`${D}entries/show`]: "0.1", [`${D}query`]: "0.1" };
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (served[slug] !== version) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: [`${S}${slug}/${served[slug]}`] });
    const member = this.members.has(who);
    const ok = (r: { code: string; body: Doc }): Doc => (r.code === "ok" ? this.reply(doc, `${type}#response`, r.body) : this.refuse(doc, r.code, `refused: ${r.code}`, isObject(r.body.details) ? (r.body.details as Doc) : undefined));
    if (slug === `${D}card/show`) {
      if (!member && !this.m("dirServesNonMember")) return this.refuse(doc, `${D}card/show:notMember`, "the signer is not an active member");
      const c = this.card(who, now);
      return this.reply(doc, `${type}#response`, { card: this.cardBody(c), missingRequired: this.complete(c) ? [] : ["displayName"] });
    }
    if (!member) return this.refuse(doc, "permissionDenied", "the caller is neither an active member nor an administrator");
    if (slug === `${D}fields/list`) return this.reply(doc, `${type}#response`, { fields: FIELDS.map((f) => ({ key: f.key, label: f.label, type: f.type, source: f.source, base: true, required: f.required, ceiling: f.ceiling, defaultVisibility: f.def, searchable: f.key === "displayName", facet: false, order: f.order, state: "active" })), listingDefaults: { defaultListing: "listed" } });
    if (slug === `${D}card/update`) return ok(this.update(who, p, now, Date.parse(String(doc.issuedAt))));
    if (slug === `${D}entries/list`) return this.reply(doc, `${type}#response`, this.entriesList(who));
    if (slug === `${D}entries/show`) return ok(this.entriesShow(who, p));
    return ok(this.query(who, p));
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the community does not answer observe ${q.query}`);
    const k = q.kind, last = this.bLog.at(-1);
    if (k.startsWith("dir-card-revision:")) return { value: this.cards.get(k.split(":")[1]!)?.revision === Number(k.split(":")[2]) ? 1 : 0 };
    if (k.startsWith("dir-admin-has:")) { const rest = k.slice(14), at = rest.indexOf(":"), field = rest.slice(0, at), did = rest.slice(at + 1); const c = this.cards.get(did); return { value: c !== undefined && Object.keys(this.project(c, "admin")).includes(String(field)) ? 1 : 0 }; }
    if (k === "dir-b:inList") return { value: last?.inList === true ? 1 : 0 };
    if (k.startsWith("dir-b:field:")) return { value: last?.fields.includes(k.slice(12)) ? 1 : 0 };
    if (k.startsWith("dir-b:code:")) return { value: last?.code === k.slice(11) ? 1 : 0 };
    if (k.startsWith("dir-b:update:")) return { value: this.updates.filter((c) => c === k.slice(13)).length };
    if (k === "dir-cards") return { value: this.cards.size };
    throw new Error(`the community does not answer stored ${k}`);
  }
}

/** The member: reads and writes their own card, lists and reads other members' entries, with the versions the specification names. */
export class DirMember implements Adapter {
  readonly signer = ed25519Signer(seedOf(MEMBER_SEED));
  private queue: DirFlow[] = [];
  private st: Record<string, unknown> = {};
  private known = new Map<string, string>();
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-dir-member", implementation: "reference-dir-member", version: "suite reference, member (directory)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: DIR_KINDS, ceremonyRoles: [{ ceremony: "FC-DIR", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.queue.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.queue.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.queue = []; this.st = {}; this.known.clear(); }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the member has no triggers"); }
  private doc(to: string, type: string, payload: Doc, thread: string, tamper?: boolean): Doc {
    const now = Date.now();
    void tamper;
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${type}`, threadId: thread, issuer: this.signer.did, recipient: to, issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "authentication" }) as unknown as Doc;
  }
  private listType(f: DirFlow): string { return `${D}entries/list/${(f.scratch.listVersion as string | undefined) ?? "0.2"}`; }
  private next(f: DirFlow): Doc | undefined {
    const a = f.args, to = String(a.recipient ?? f.to), last = f.received.at(-1), lp = last === undefined ? {} : pl(last);
    const refused = String(last?.type ?? "").includes("/trust-task-error/");
    switch (f.kind) {
      case "dir-my-card": return f.step === 0 ? this.doc(to, `${D}card/show/0.1`, {}, f.thread) : f.step === 1 && !refused ? this.doc(to, `${D}fields/list/0.1`, {}, f.thread) : undefined;
      case "dir-set-name": {
        if (f.step === 0) return this.doc(to, `${D}card/show/0.1`, {}, f.thread);
        if (f.step === 1 && !refused) { const rev = a.expectedRevision === "stale" ? Number((lp.card as Doc).revision) - 1 : Number((lp.card as Doc).revision); f.scratch.rev = rev; return this.doc(to, `${D}card/update/0.1`, { values: { displayName: String(a.name) }, expectedRevision: Math.max(0, rev) }, f.thread); }
        return undefined;
      }
      case "dir-list-members": {
        if (f.step === 0) return this.doc(to, `${this.listType(f)}`, { limit: 25 }, f.thread);
        // the member's own version step: the community names what it serves; asked once in the other version
        if (f.step === 1 && refused && lp.code === "unsupportedVersion" && f.scratch.listVersion === undefined) { f.scratch.listVersion = "0.1"; return this.doc(to, `${D}entries/list/0.1`, { limit: 25 }, f.thread); }
        return undefined;
      }
      case "dir-show-member": {
        // by the members list (the wallet reads the list, then the entry of the row it wants) or, with `list: false`, by an entry id it kept from an earlier list
        const byList = a.list !== false, showStep = byList ? 1 : 0;
        if (f.step === 0 && byList) return this.doc(to, this.listType(f), { limit: 25 }, f.thread);
        if (f.step === showStep) { const eid = this.known.get(String(a.target)); return eid === undefined ? undefined : this.doc(to, `${D}entries/show/0.1`, { entryId: eid }, f.thread); }
        return f.step === showStep + 1 && !refused ? this.doc(to, `${D}fields/list/0.1`, {}, f.thread) : undefined;
      }
      case "dir-lookup-name": return f.step === 0 ? this.doc(to, `${D}query/0.1`, { subject: String(a.subject), fields: "displayName" }, f.thread) : undefined;
      case "dir-member-by-did": return f.step === 0 ? this.doc(to, `${D}query/0.1`, { subject: String(a.subject) }, f.thread) : f.step === 1 && !refused ? this.doc(to, `${D}fields/list/0.1`, {}, f.thread) : undefined;
      default: return undefined;
    }
  }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`;
    const f: DirFlow = { kind: p.kind, step: 0, args: p.args ?? {}, to: p.to, thread, state: "open", received: [], sent: [], scratch: {} };
    this.queue.push(f);
    const d = this.next(f);
    if (d === undefined) throw new Error(`the member has no kind ${p.kind}`);
    f.sent.push(d);
    return { threadId: thread, documents: [JSON.stringify(d)], sent: false, continues: true };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const refused = String(d.type).includes("/trust-task-error/");
    const code = refused ? String(pl(d).code ?? "") : "";
    const body = pl(d);
    if (refused) { this.st.refused = code.slice(code.lastIndexOf(":") + 1); if (f.kind === "dir-set-name" && this.st.refused === "superseded") { this.st.conflict = true; this.st.refused = undefined; } }
    if (!refused && f.kind === "dir-my-card" && isObject(body.card)) { const c = body.card as Doc; this.st.card = { revision: c.revision, name: (c.values as Doc).displayName, missing: body.missingRequired }; }
    if (!refused && f.kind === "dir-set-name" && isObject(body.card)) { const c = body.card as Doc; this.st.card = { revision: c.revision, name: (c.values as Doc).displayName, missing: body.missingRequired }; this.st.conflict = false; }
    if (!refused && Array.isArray(body.fields) && f.kind === "dir-my-card") this.st.fieldKeys = (body.fields as Doc[]).map((x) => String(x.key));
    if (!refused && Array.isArray(body.items)) {
      const rows = (body.items as Doc[]).map((e) => ({ entryId: String(e.entryId), name: (e.fields as Doc).displayName as string | undefined }));
      this.st.rows = rows;
      for (const r of rows) if (r.name !== undefined) this.known.set(r.name, r.entryId);
    }
    if (!refused && isObject(body.entry)) { const e = body.entry as Doc; this.st.seen = Object.keys(e.fields as Doc); this.st.seenName = (e.fields as Doc).displayName; this.st.none = false; }
    if (refused && f.kind === "dir-show-member" && code.endsWith("notFound")) { this.st.seen = []; this.st.seenName = undefined; this.st.none = true; }
    if (!refused && f.kind === "dir-lookup-name") this.st.lookup = (body.fields as Doc | undefined)?.displayName;
    if (refused && f.kind === "dir-lookup-name" && code.endsWith("notFound")) this.st.lookup = undefined;
    if (!refused && f.kind === "dir-member-by-did" && isObject(body.fields)) { this.st.seen = Object.keys(body.fields as Doc); this.st.seenName = (body.fields as Doc).displayName; this.st.none = false; }
    if (refused && f.kind === "dir-member-by-did" && code.endsWith("notFound")) { this.st.seen = []; this.st.none = true; }
    f.step++;
    const stepping = refused && code === "unsupportedVersion" && f.kind === "dir-list-members" && f.scratch.listVersion === undefined;
    const nxt = refused && !stepping ? undefined : this.next(f);
    if (nxt !== undefined) { f.sent.push(nxt); return { replies: [JSON.stringify(nxt)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 }; }
    const notFoundOk = refused && code.endsWith("notFound") && ["dir-show-member", "dir-lookup-name", "dir-member-by-did"].includes(f.kind);
    f.state = refused && !notFoundOk && !(f.kind === "dir-set-name" && this.st.conflict === true) ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") {
      const f = this.queue.find((x) => x.thread === q.threadId);
      const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type);
      return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) };
    }
    if (q.query !== "stored") throw new Error(`the member does not answer observe ${q.query}`);
    return { value: dirStoredKind(this.st, q.kind) };
  }
}
interface DirFlow { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; sent: Doc[]; scratch: Doc }
