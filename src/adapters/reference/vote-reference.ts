// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the elections ceremony's reads (docs/31, group FC-VOT): a community that serves vtc/elections/list (0.5, 0.3) and vtc/elections/show (0.6, 0.3, 0.2) to its members and holds no election, and a member who
// reads them at the newest version both sides serve. Written from the Trust Tasks specification text. Creating an election needs a trusted ballot box and a registrar key; casting a ballot is served by a ballot box, not by a community
// (docs/31 section 6), so neither is modelled. Two mutants of the community end the scenario that watches for them failed (test/vote-pairs.test.ts).
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { voteStoredKind } from "./vote-state.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
const E = "vtc/elections/";
export const VOTE_MUTANTS = ["voteNonMemberServed", "voteUnknownShownEmpty"] as const;
export const VOTE_KINDS = ["vote-list", "vote-show"];
const LISTS = ["0.5", "0.3"], SHOWS = ["0.6", "0.3", "0.2"];
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});

export class VoteCommunity implements Adapter {
  readonly signer = ed25519Signer(seedOf(0xb6));
  private readonly mutants: ReadonlySet<string>;
  private legacy: boolean;
  private members = new Set<string>();
  private seen = new Map<string, string>();
  constructor(o: { mutants?: string[]; legacy?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.legacy = o.legacy === true; }
  async capabilities(): Promise<Capabilities> {
    return { name: this.mutants.size === 0 ? `reference-vote-community${this.legacy ? ":legacy" : ""}` : `reference-vote-community+${[...this.mutants].join("+")}`, implementation: "reference-vote-community", version: "suite reference, community (elections, reads)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: [...LISTS.map((v) => `${S}${E}list/${v}`), ...SHOWS.map((v) => `${S}${E}show/${v}`)], carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-VOT", roles: ["community"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return String(this.members.size); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.members.clear(); this.seen.clear(); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "seedMember") { this.members.add(String(args.vid)); return { documents: [] }; }
    if (action === "serveVersions") { this.legacy = args.profile === "legacy"; return { documents: [] }; }
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
    const r = prior !== undefined ? (JSON.parse(prior) as Doc) : this.dispatch(doc, String(doc.type), Date.now());
    this.seen.set(String(doc.id), JSON.stringify(r));
    return { replies: [JSON.stringify(r)], transport: { status: String(r.type).includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private dispatch(doc: Doc, type: string, now: number): Doc {
    if (doc.recipient !== this.signer.did) return this.refuse(doc, "wrongRecipient", "the recipient is another party");
    // the elections reads are roll-scoped: the caller is read from the proof, so an unsigned one is refused
    if (doc.proof === undefined) return this.refuse(doc, "proofRequired", "a proof is required");
    if (!verifyDocumentProof(doc, { nowMs: now }).valid) return this.refuse(doc, "proofInvalid", "the proof did not verify");
    const t = type.replace(S, ""), slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1);
    const served: Record<string, string[]> = { [`${E}list`]: this.legacy ? ["0.3"] : LISTS, [`${E}show`]: this.legacy ? ["0.3", "0.2"] : SHOWS };
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (!served[slug]!.includes(version)) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: served[slug]!.map((v) => `${S}${slug}/${v}`) });
    // an election is listed only to a caller who may see it; the community holds none a member may see, so every list is empty (the mutant shows an outsider one)
    if (slug === `${E}list`) return this.reply(doc, `${type}#response`, { elections: !this.members.has(String(doc.issuer)) && this.mutants.has("voteNonMemberServed") ? [{ electionId: "leak", state: "open" }] : [] });
    if (this.mutants.has("voteUnknownShownEmpty")) return this.reply(doc, `${type}#response`, {});
    return this.refuse(doc, `${E}show:electionUnknown`, "no such election is known to this community");
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query === "stored" && q.kind.startsWith("member:")) return { value: this.members.has(q.kind.slice(7)) ? 1 : 0 };
    throw new Error(`the community does not answer ${q.query}`);
  }
}

export class VoteMember implements Adapter {
  readonly signer = ed25519Signer(seedOf(0x4f));
  private queue: VFlow[] = [];
  private st: { polls?: number; refused?: string; version?: string } = {};
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-vote-member", implementation: "reference-vote-member", version: "suite reference, member (elections, reads)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: VOTE_KINDS, ceremonyRoles: [{ ceremony: "FC-VOT", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.queue.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.queue.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.queue = []; this.st = {}; }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the member has no triggers"); }
  private doc(f: VFlow): Doc {
    const now = Date.now(), ladder = f.kind === "vote-list" ? LISTS : SHOWS, v = ladder[f.rung]!;
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${E}${f.kind === "vote-list" ? "list" : "show"}/${v}`, threadId: f.thread, issuer: this.signer.did, recipient: f.to, issuedAt: stamp(now), payload: f.kind === "vote-list" ? {} : { electionId: String(f.args.electionId ?? "unknown-election") } }, this.signer, { created: now, purpose: "authentication" }) as unknown as Doc;
  }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`;
    const f: VFlow = { kind: p.kind, rung: 0, args: p.args ?? {}, to: p.to, thread, state: "open", received: [] };
    this.queue.push(f);
    return { threadId: thread, documents: [JSON.stringify(this.doc(f))], sent: false, continues: true };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const refused = String(d.type).includes("/trust-task-error/"), code = refused ? String(pl(d).code ?? "") : "";
    // the wallet's own ladder: a version refusal means the question was not taken; it asks at the next version
    const ladder = f.kind === "vote-list" ? LISTS : SHOWS;
    if (refused && code === "unsupportedVersion" && f.rung + 1 < ladder.length) { f.rung++; return { replies: [JSON.stringify(this.doc(f))], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 }; }
    if (!refused && f.kind === "vote-list") this.st.polls = Array.isArray(pl(d).elections) ? (pl(d).elections as unknown[]).length : undefined;
    this.st.version = String(d.type).includes("/trust-task-error/") ? undefined : ladder[f.rung];
    if (refused) this.st.refused = code.slice(code.lastIndexOf(":") + 1);
    f.state = refused ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") { const f = this.queue.find((x) => x.thread === q.threadId); const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type); return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) }; }
    if (q.query !== "stored") throw new Error(`the member does not answer observe ${q.query}`);
    return { value: voteStoredKind(this.st, q.kind) };
  }
}
interface VFlow { kind: string; rung: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[] }
