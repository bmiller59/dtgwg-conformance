// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the persona ceremony (docs/31, group FC-PER): an agent (the VTA's role) that serves vta/contexts/list, create, vta/webvh/servers/list, vta/webvh/dids/create (1.2, 1.1, 1.0), vta/dids/list 0.1 (vta/webvh/dids/list 1.0 is retired, supersededBy vta/dids/list/0.1, D730) and
// keys/export-secret, and the member's phone that asks for them in the order the wallet does (the contexts, the hosting servers, then a serverless persona). Written from the Trust Tasks specification text. It models only what
// a scenario observes: contexts, minted DIDs, and the refusal to release a key over a carrier that is not confidential. No keys are derived, no log entry is signed (the minted DID carries the scid the oracle chose and a log entry
// shell). Mutants of the agent end the scenario that watches for them failed (test/persona-pairs.test.ts).
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { isObject } from "../../util/json.ts";
import { personaStoredKind } from "./persona-state.ts";

type Doc = Record<string, unknown>;
const S = "https://trusttasks.org/spec/";
const AGENT_SEED = 0xb5, PHONE_SEED = 0x4e;
export const PERSONA_MUTANTS = ["perContextMerges", "perNoServerlessFlag", "perExportOverRest"] as const;
export const PERSONA_KINDS = ["persona-mint", "persona-context", "persona-borrow-key"];
const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});

export class PersonaAgent implements Adapter {
  readonly signer = ed25519Signer(seedOf(AGENT_SEED));
  private readonly mutants: ReadonlySet<string>;
  private legacy: boolean;
  private contexts = new Map<string, { id: string; name: string }>([["ctx1", { id: "ctx1", name: "ctx1" }]]);
  private dids: { did: string; contextId: string; serverless: boolean }[] = [];
  private createCodes: string[] = [];
  private exported = 0;
  private seen = new Map<string, string>();
  constructor(o: { mutants?: string[]; legacy?: boolean } = {}) { this.mutants = new Set(o.mutants ?? []); this.legacy = o.legacy === true; }
  async capabilities(): Promise<Capabilities> {
    const v = this.legacy ? ["1.0"] : ["1.2", "1.1", "1.0"];
    const types = ["vta/contexts/list/1.0", "vta/contexts/create/1.0", "vta/webvh/servers/list/1.0", ...v.map((x) => `vta/webvh/dids/create/${x}`), "vta/dids/list/0.1", "keys/export-secret/0.1"].map((t) => `${S}${t}`);
    return { name: this.mutants.size === 0 ? `reference-persona-agent${this.legacy ? ":legacy" : ""}` : `reference-persona-agent+${[...this.mutants].join("+")}`, implementation: "reference-persona-agent", version: "suite reference, agent (contexts, persona mint)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: types, carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.serveVersions"], ceremonyRoles: [{ ceremony: "FC-PER", roles: ["agent"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return `${this.contexts.size}:${this.dids.length}`; }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.contexts = new Map([["ctx1", { id: "ctx1", name: "ctx1" }]]); this.dids = []; this.createCodes = []; this.exported = 0; this.seen.clear(); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "serveVersions") { this.legacy = args.profile === "legacy"; return { documents: [] }; }
    throw new Error(`the agent has no trigger ${action}`);
  }
  private reply(req: Doc, type: string, payload: Doc): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: String(req.threadId ?? req.id), issuer: this.signer.did, recipient: String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc { return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } }); }
  private out(d: Doc): SendResult { return { replies: [JSON.stringify(d)], transport: { status: String(d.type).includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 }; }
  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const now = Date.now(), key = String(doc.id);
    const prior = this.seen.get(key);
    if (prior !== undefined) return { replies: [prior], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
    if (doc.recipient !== this.signer.did) return this.out(this.refuse(doc, "wrongRecipient", "the recipient is another party"));
    if (doc.proof !== undefined && !verifyDocumentProof(doc, { nowMs: now }).valid) return this.out(this.refuse(doc, "proofInvalid", "the proof did not verify"));
    const r = this.dispatch(doc, String(doc.type));
    this.seen.set(key, JSON.stringify(r));
    return this.out(r);
  }
  private dispatch(doc: Doc, type: string): Doc {
    const p = pl(doc), t = type.replace(S, ""), slug = t.slice(0, t.lastIndexOf("/")), version = t.slice(t.lastIndexOf("/") + 1);
    const served: Record<string, string[]> = { "vta/contexts/list": ["1.0"], "vta/contexts/create": ["1.0"], "vta/webvh/servers/list": ["1.0"], "vta/webvh/dids/create": this.legacy ? ["1.0"] : ["1.2", "1.1", "1.0"], "vta/dids/list": ["0.1"], "keys/export-secret": ["0.1"] };
    if (served[slug] === undefined) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (!served[slug]!.includes(version)) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: served[slug]!.map((v) => `${S}${slug}/${v}`) });
    const rec = (c: { id: string; name: string }) => ({ id: c.id, name: c.name, basePath: `m/26'/2'/${[...this.contexts.keys()].indexOf(c.id)}'`, createdAt: stamp(Date.now()), updatedAt: stamp(Date.now()) });
    if (slug === "vta/contexts/list") return this.reply(doc, `${type}#response`, { contexts: [...this.contexts.values()].map(rec) });
    if (slug === "vta/contexts/create") {
      const id = String(p.id);
      if (this.contexts.has(id) && !this.mutants.has("perContextMerges")) { this.createCodes.push("idConflict"); return this.refuse(doc, "idConflict", `context already exists: ${id}`); }
      this.contexts.set(id, { id, name: String(p.name) });
      this.createCodes.push("ok");
      return this.reply(doc, `${type}#response`, rec(this.contexts.get(id)!));
    }
    if (slug === "vta/webvh/servers/list") return this.reply(doc, `${type}#response`, { servers: [] });
    if (slug === "vta/dids/list") return this.reply(doc, `${type}#response`, { dids: this.dids.filter((d) => p.contextId === undefined || d.contextId === p.contextId).map((d) => ({ did: d.did, method: "webvh", contextId: d.contextId, level: 1, primary: false, deactivated: false, alsoKnownAs: [], createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z" })) });
    if (slug === "vta/webvh/dids/create") {
      if (!this.contexts.has(String(p.contextId))) return this.refuse(doc, "vta/contexts:notFound", `no such context: ${String(p.contextId)}`);
      const scid = `Qm${randomUUID().replaceAll("-", "").slice(0, 44)}`;
      const url = String(p.url ?? "https://persona.example/p");
      const host = url.replace(/^https?:\/\//, "").replace("/", ":");
      const did = `did:webvh:${scid}:${host}`;
      this.dids.push({ did, contextId: String(p.contextId), serverless: p.serverId === undefined });
      const body: Doc = { did, contextId: String(p.contextId), scid, signingKeyId: `${did}#key-0`, kaKeyId: `${did}#key-1`, createdAt: stamp(Date.now()), didDocument: { id: did }, ...(p.serverId === undefined ? { logEntry: { versionId: `1-${scid}`, parameters: { scid } } } : { serverId: String(p.serverId) }) };
      if (!this.mutants.has("perNoServerlessFlag") && version !== "1.0") body.serverless = p.serverId === undefined;
      return this.reply(doc, `${type}#response`, body);
    }
    // keys/export-secret: the exchange is carried over a channel confidential to the two parties (spec); a runner-carried document is not
    if (this.mutants.has("perExportOverRest")) { this.exported++; return this.reply(doc, `${type}#response`, { keyId: String(p.keyId), curve: "Ed25519", secret: "z-not-a-key", publicKeyMultibase: "z-not-a-key" }); }
    return this.refuse(doc, "permissionDenied", "a private key is released only over a channel confidential to the two parties");
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the agent does not answer observe ${q.query}`);
    const k = q.kind;
    if (k.startsWith("context:")) return { value: this.contexts.has(k.slice(8)) ? 1 : 0 };
    if (k.startsWith("context-create:")) return { value: this.createCodes.filter((c) => c === k.slice(15)).length };
    if (k.startsWith("dids-in:")) return { value: this.dids.filter((d) => d.contextId === k.slice(8)).length };
    if (k === "dids") return { value: this.dids.length };
    if (k === "key-released") return { value: this.exported };
    throw new Error(`the agent does not answer stored ${k}`);
  }
}

/** The phone: asks for the contexts and the hosting servers and mints a serverless persona, creates a context, asks for a key, as the wallet's VTA client does. */
export class PersonaPhone implements Adapter {
  readonly signer = ed25519Signer(seedOf(PHONE_SEED));
  private queue: PFlow[] = [];
  private st: { minted?: Doc; refused?: string; ctxCode?: string } = {};
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-persona-phone", implementation: "reference-persona-phone", version: "suite reference, phone (persona)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received"], initiates: PERSONA_KINDS, ceremonyRoles: [{ ceremony: "FC-PER", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
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
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the phone has no triggers"); }
  private doc(to: string, type: string, payload: Doc, thread: string): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type: `${S}${type}`, threadId: thread, issuer: this.signer.did, recipient: to, issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "authentication" }) as unknown as Doc;
  }
  private next(f: PFlow): Doc | undefined {
    const a = f.args, to = f.to, last = f.received.at(-1), lp = last === undefined ? {} : pl(last);
    const refused = String(last?.type ?? "").includes("/trust-task-error/");
    switch (f.kind) {
      case "persona-context": return f.step === 0 ? this.doc(to, "vta/contexts/create/1.0", { id: String(a.id ?? "keyring"), name: String(a.name ?? "Keyring") }, f.thread) : undefined;
      case "persona-borrow-key": return f.step === 0 ? this.doc(to, "keys/export-secret/0.1", { keyId: String(a.keyId ?? (this.st.minted as Doc | undefined)?.signingKeyId ?? "did:webvh:example#key-0") }, f.thread) : undefined;
      case "persona-mint": {
        if (f.step === 0) return this.doc(to, "vta/contexts/list/1.0", {}, f.thread);
        if (f.step === 1 && !refused) { const cs = (lp.contexts as Doc[] | undefined) ?? []; f.scratch.ctx = cs.find((c) => c.id === "keyring")?.id ?? cs.find((c) => c.id === "vta")?.id ?? cs[0]?.id ?? "vta"; return this.doc(to, "vta/webvh/servers/list/1.0", {}, f.thread); }
        const ladder = ["1.2", "1.1", "1.0"];
        if (f.step === 2 && !refused) return this.doc(to, `vta/webvh/dids/create/${ladder[0]}`, this.mint(f), f.thread);
        // the phone's own ladder: a version refusal means nothing was minted, so the same payload goes at the next rung
        if (f.step >= 3 && refused && lp.code === "unsupportedVersion" && f.scratch.rung !== undefined) { const i = Number(f.scratch.rung) + 1; return i < ladder.length ? this.doc(to, `vta/webvh/dids/create/${ladder[i]}`, this.mint(f), f.thread) : undefined; }
        return undefined;
      }
      default: return undefined;
    }
  }
  private mint(f: PFlow): Doc { f.scratch.rung = f.scratch.rung === undefined ? 0 : Number(f.scratch.rung) + 1; return { contextId: String(f.scratch.ctx), url: `${String(f.args.didUrl ?? "https://persona.example")}/${String(f.args.label ?? "p1")}`, label: String(f.args.label ?? "p1"), addMediatorService: true, addTspService: false, setPrimary: false }; }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`;
    const f: PFlow = { kind: p.kind, step: 0, args: p.args ?? {}, to: p.to, thread, state: "open", received: [], scratch: {} };
    this.queue.push(f);
    const d = this.next(f);
    if (d === undefined) throw new Error(`the phone has no kind ${p.kind}`);
    return { threadId: thread, documents: [JSON.stringify(d)], sent: false, continues: true };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.queue.find((x) => x.thread === d.threadId);
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const refused = String(d.type).includes("/trust-task-error/"), code = refused ? String(pl(d).code ?? "") : "";
    if (!refused && String(d.type).includes("/dids/create/")) this.st.minted = pl(d);
    if (f.kind === "persona-context") this.st.ctxCode = refused ? code : "ok";
    f.step++;
    const stepping = refused && code === "unsupportedVersion" && f.kind === "persona-mint";
    const nxt = refused && !stepping ? undefined : this.next(f);
    if (nxt !== undefined) return { replies: [JSON.stringify(nxt)], transport: { status: 200, kind: "document" }, quiescentAfterMs: 0 };
    f.state = refused ? "refused" : "completed";
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.queue.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") { const f = this.queue.find((x) => x.thread === q.threadId); const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type); return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) }; }
    if (q.query !== "stored") throw new Error(`the phone does not answer observe ${q.query}`);
    return { value: personaStoredKind({ minted: this.st.minted }, q.kind) };
  }
}
interface PFlow { kind: string; step: number; args: Record<string, unknown>; to: string; thread: string; state: "open" | "completed" | "refused"; received: Doc[]; scratch: Doc }
