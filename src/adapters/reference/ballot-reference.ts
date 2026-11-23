// SPDX-License-Identifier: Apache-2.0
// Reference oracle for the ballot-cast ceremony (docs/32, group FC-BAL): a ballot box that serves voting/ballot/cast 0.1 over its HTTPS door and runs the specification's consumer steps in order, and a voter's client that sends the
// cast its agent built and keeps the receipt only when it is the ballot box's (the checks the keyring-wallet's postCast makes). Written from the Trust Tasks specification text (voting/ballot/cast 0.1). The attestation is modelled
// (ballot-model.ts, class D); the checks and their order are not. Eleven mutants of the box end the scenario that watches for them `failed` (test/ballot-pairs.test.ts).
import { randomUUID } from "node:crypto";
import type { Adapter, Capabilities, InitiateParams, InitiateResult, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult } from "../../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { jcsBytes, isObject } from "../../util/json.ts";
import { ballotStoredKind, type CastState } from "./ballot-state.ts";
import { CAST_TYPE, S, attest, buildCast, classOf, digestOf, manifestOf, stamp, tagOf, votingKey } from "./ballot-model.ts";

type Doc = Record<string, unknown>;
export const BALLOT_MUTANTS = ["ballotCountsTwice", "ballotNoOpenCheck", "ballotNoManifestCheck", "ballotNoAnswerCheck", "ballotNoClassCheck", "ballotAcceptsForged", "ballotRevoteIgnored", "ballotReplaceKeepsBoth", "ballotNoProofCheck", "ballotReceiptWrongThread", "ballotReceiptToWrongKey"] as const;
export const BALLOT_KINDS = ["ballot-cast"];
const pl = (d: Doc): Doc => (isObject(d.payload) ? (d.payload as Doc) : {});
const canon = (v: unknown): string => Buffer.from(jcsBytes(v)).toString("utf8");
const local = (c: string): string => c.slice(c.lastIndexOf(":") + 1);

interface Entry { kind: "cast"; tag: string; ballot: string; attestation: string; receipt: Doc }
interface Election { state: "registration" | "voting" | "closed"; revote: "refuse" | "replace"; casts: Entry[]; counted: Map<string, number> }

export class BallotBox implements Adapter {
  readonly signer = ed25519Signer(seedOf(0xb7));
  private readonly mutants: ReadonlySet<string>;
  private elections = new Map<string, Election>();
  private seen = new Map<string, string>();
  constructor(o: { mutants?: string[] } = {}) { this.mutants = new Set(o.mutants ?? []); }
  async capabilities(): Promise<Capabilities> {
    return { name: this.mutants.size === 0 ? "reference-ballot-box" : `reference-ballot-box+${[...this.mutants].join("+")}`, implementation: "reference-ballot-box", version: "suite reference, ballot box (voting/ballot/cast 0.1)", tierMax: 1, bindings: ["in-process"],
      supportedTypes: [CAST_TYPE], carriers: [], cryptosuites: ["eddsa-jcs-2022"], optional: ["clockFree", "trigger.openElection"], ceremonyRoles: [{ ceremony: "FC-BAL", roles: ["ballot-box"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* in memory */ }
  async snapshot(): Promise<string> { return String([...this.elections.values()].reduce((n, e) => n + e.casts.length, 0)); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== (await this.snapshot()) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.elections.clear(); this.seen.clear(); }
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    const id = String(args.electionId ?? "e1");
    if (action === "openElection") { this.elections.set(id, { state: args.state === "registration" ? "registration" : "voting", revote: args.revote === "replace" ? "replace" : "refuse", casts: [], counted: new Map() }); return { documents: [] }; }
    if (action === "closeElection") { const e = this.elections.get(id); if (e !== undefined) e.state = "closed"; return { documents: [] }; }
    throw new Error(`the ballot box has no trigger ${action}`);
  }
  private reply(req: Doc, type: string, payload: Doc, wrongThread = false): Doc {
    const now = Date.now();
    return signDocument({ id: `urn:uuid:${randomUUID()}`, type, threadId: wrongThread ? "urn:uuid:wrong-thread" : String(req.threadId ?? req.id), issuer: this.signer.did, recipient: this.mutants.has("ballotReceiptToWrongKey") ? this.signer.did : String(req.issuer), issuedAt: stamp(now), payload }, this.signer, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
  }
  private refuse(req: Doc, code: string, message: string, details?: Doc): Doc { return this.reply(req, `${S}trust-task-error/0.6`, { code, message, retryable: false, ...(details === undefined ? {} : { details }), inResponseTo: { id: req.id, typeUri: req.type } }); }
  async send(p: SendParams): Promise<SendResult> {
    let doc: Doc;
    try { doc = JSON.parse(p.bytes) as Doc; } catch { return { replies: [], transport: { status: 400, kind: "refused" }, quiescentAfterMs: 0 }; }
    const r = this.dispatch(doc);
    return { replies: [JSON.stringify(r)], transport: { status: String(r.type).includes("/trust-task-error/") ? 422 : 200, kind: "document" }, quiescentAfterMs: 0 };
  }
  private receipt(req: Doc, e: Entry, outcome: string, election: string, leaf: number): Doc {
    return this.reply(req, `${CAST_TYPE}#response`, { ...(e.receipt as Doc), outcome, leafIndex: leaf, electionId: election }, this.mutants.has("ballotReceiptWrongThread"));
  }
  private dispatch(doc: Doc): Doc {
    const cast = CAST_TYPE.replace(/0\.1$/, "");
    const type = String(doc.type);
    // step 1: the document, its recipient, its proof (the one-time key's: intact, not authority)
    if (doc.recipient !== this.signer.did) return this.refuse(doc, "wrongRecipient", "the recipient is another party");
    if (!type.startsWith(cast)) return this.refuse(doc, "unsupportedType", `unsupported type: ${type}`);
    if (type.replace(/#request$/, "") !== CAST_TYPE) return this.refuse(doc, "unsupportedVersion", `unsupported version: ${type}`, { requestedType: type, servedVersions: [CAST_TYPE] });
    if (!this.mutants.has("ballotNoProofCheck")) {
      if (doc.proof === undefined) return this.refuse(doc, "proofRequired", "a proof is required");
      if (!verifyDocumentProof(doc, { nowMs: Date.now() }).valid) return this.refuse(doc, "proofInvalid", "the proof did not verify");
    }
    const prior = this.seen.get(String(doc.id));
    if (prior !== undefined) return JSON.parse(prior) as Doc;
    const out = this.admit(doc);
    this.seen.set(String(doc.id), JSON.stringify(out));
    return out;
  }
  private admit(doc: Doc): Doc {
    const c = "voting/ballot/cast:", m = this.mutants, p = pl(doc), id = String(p.electionId);
    const cs = isObject(p.cast) ? (p.cast as Doc) : {}, ballot = isObject(cs.ballot) ? (cs.ballot as Doc) : {}, tag = String(cs.tag), att = String(cs.attestation);
    const e = this.elections.get(id);
    if (e === undefined) return this.refuse(doc, `${c}electionUnknown`, "no election with this identifier exists for this community");
    if (e.state !== "voting" && !m.has("ballotNoOpenCheck")) return this.refuse(doc, `${c}notOpen`, "voting in the election is not open");
    if (!m.has("ballotNoManifestCheck") && (ballot.electionId !== id || ballot.manifestDigest !== digestOf(id))) return this.refuse(doc, `${c}manifestMismatch`, "the ballot names another election or manifest digest");
    if (!m.has("ballotNoAnswerCheck") && !this.answers(ballot)) return this.refuse(doc, `${c}ballotInvalid`, "the ballot does not answer the manifest's questions as the manifest admits");
    if (!m.has("ballotNoClassCheck") && !att.startsWith(`z${classOf(id)}:`)) return this.refuse(doc, `${c}classMismatch`, "the attestation is not under this election's ticket class");
    const same = e.casts.find((x) => x.tag === tag && x.ballot === canon(ballot) && x.attestation === att);
    if (same !== undefined && !m.has("ballotCountsTwice")) return this.receipt(doc, same, "alreadyCounted", id, Number(same.receipt.leafIndex));
    const counted = e.counted.get(tag), countedEntry = counted === undefined ? undefined : e.casts[counted];
    if (countedEntry !== undefined && countedEntry.ballot !== canon(ballot) && e.revote === "refuse" && !m.has("ballotRevoteIgnored")) return this.refuse(doc, `${c}alreadyVoted`, "a different ballot under this tag is counted and the manifest refuses revotes");
    if (!m.has("ballotAcceptsForged") && (att !== attest(votingKey(id), classOf(id), ballot, tag) || tag !== tagOf(id, "ticket-1"))) return this.refuse(doc, `${c}castInvalid`, "the attestation does not verify for this election and this ballot, or its tag is not tag");
    if (countedEntry !== undefined && countedEntry.ballot === canon(ballot) && !m.has("ballotCountsTwice")) return this.receipt(doc, countedEntry, "alreadyCounted", id, Number(countedEntry.receipt.leafIndex));
    const leaf = e.casts.length;
    const entry: Entry = { kind: "cast", tag, ballot: canon(ballot), attestation: att, receipt: { entryHash: `z${randomUUID().replaceAll("-", "")}`, head: { electionId: id, treeSize: leaf + 1, rootHash: `z${randomUUID().replaceAll("-", "")}`, issuedAt: stamp(Date.now()) }, receiptToken: `z${randomUUID().replaceAll("-", "")}`, leafIndex: leaf } };
    e.casts.push(entry);
    // a revote under `replace` moves the counted ballot to this cast (the earlier one stays on the board); the mutant counts both
    if (!(counted !== undefined && m.has("ballotReplaceKeepsBoth"))) e.counted.set(tag, leaf);
    else e.counted.set(`${tag}#${leaf}`, leaf);
    return this.receipt(doc, entry, counted === undefined ? "counted" : "replaced", id, leaf);
  }
  private answers(ballot: Doc): boolean {
    const answers = Array.isArray(ballot.answers) ? (ballot.answers as Doc[]) : [];
    const qs = manifestOf("x").questions;
    if (answers.length !== qs.length) return false;
    return qs.every((q) => {
      const a = answers.find((x) => x.question === q.key);
      const choice = isObject(a) && Array.isArray(a.choice) ? (a.choice as string[]) : undefined;
      return choice !== undefined && choice.length >= q.minSelections && choice.length <= q.maxSelections && choice.every((k) => q.options.some((o) => o.key === k));
    });
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") return { value: "unknown" };
    if (q.query !== "stored") throw new Error(`the ballot box does not answer ${q.query}`);
    const all = [...this.elections.values()];
    if (q.kind === "casts") return { value: all.reduce((n, e) => n + e.casts.length, 0) };
    if (q.kind === "counted") return { value: all.reduce((n, e) => n + e.counted.size, 0) };
    throw new Error(`the ballot box does not answer stored ${q.kind}`);
  }
}

interface CFlow { thread: string; to: string; cast?: Doc; state: "open" | "completed" | "refused"; received: Doc[] }
export class BallotVoter implements Adapter {
  readonly signer = ed25519Signer(seedOf(0x4e));
  private flows: CFlow[] = [];
  private st: CastState = {};
  async capabilities(): Promise<Capabilities> {
    return { name: "reference-ballot-voter", implementation: "reference-ballot-voter", version: "suite reference, voter's client (cast)", tierMax: 1, bindings: ["in-process"], supportedTypes: [], carriers: [], cryptosuites: ["eddsa-jcs-2022"],
      optional: ["clockFree", "initiate", "observe.ceremony", "observe.received", "castFutureVersion"], initiates: BALLOT_KINDS, ceremonyRoles: [{ ceremony: "FC-BAL", roles: ["member-phone"] }], pins: { framework: "0.6.0", error: "0.6", binding: "none" } };
  }
  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> { return Object.fromEntries(roles.map((r) => [r, { vid: this.signer.did, didDocument: { id: this.signer.did }, transportAddress: "in-process", keyCustody: "iut" as const }])); }
  async trust(): Promise<void> { /* did:key */ }
  async setClock(): Promise<void> { throw new Error("not supported"); }
  async advance(): Promise<void> { throw new Error("not supported"); }
  async restart(): Promise<void> { /* none */ }
  async snapshot(): Promise<string> { return String(this.flows.length); }
  async diff(id: string): Promise<{ changed: boolean }> { return { changed: id !== String(this.flows.length) }; }
  async verifyProof(p: { bytes: string }): Promise<ProofVerifyResult> { try { return { valid: verifyDocumentProof(JSON.parse(p.bytes) as Doc, { nowMs: Date.now() }).valid }; } catch { return { valid: false }; } }
  async reset(): Promise<void> { this.flows = []; this.st = {}; }
  async trigger(): Promise<{ documents: string[] }> { throw new Error("the voter has no triggers"); }
  async initiate(p: InitiateParams): Promise<InitiateResult> {
    const thread = `urn:uuid:${randomUUID()}`, a = p.args ?? {}, id = String(a.electionId ?? "e1");
    const f: CFlow = { thread, to: p.to, state: "open", received: [] };
    this.flows.push(f);
    // class D: the voter's agent (vta/pcs/vote) builds the cast; with BALLOT_CTL set the cast comes from the platform's own voting library instead
    const ctl = process.env.BALLOT_CTL;
    const cast = ctl === undefined || ctl === "" ? buildCast(p.to, id, String(a.variant ?? "ok"), thread, String(a.version ?? "0.1"))
      : ((await (await fetch(`${ctl}/ctl/cast`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ electionId: id, variant: String(a.variant ?? "ok"), version: String(a.version ?? "0.1"), threadId: thread }) })).json()) as { document: Doc }).document;
    f.cast = cast;
    // the wallet's own check before anything is sent: a cast addressed to another ballot box is never sent (postCast)
    if (cast.recipient !== p.to) { f.state = "refused"; this.st.refused = "wrongRecipient"; return { threadId: thread, documents: [], sent: false, continues: false }; }
    return { threadId: thread, documents: [JSON.stringify(cast)], sent: false, continues: false };
  }
  async send(p: SendParams): Promise<SendResult> {
    const d = JSON.parse(p.bytes) as Doc;
    const f = this.flows.find((x) => x.thread === d.threadId) ?? this.flows.find((x) => x.cast !== undefined && d.threadId === "urn:uuid:wrong-thread");
    if (f === undefined) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    f.received.push(d);
    const cast = f.cast!;
    if (String(d.type).includes("/trust-task-error/")) { f.state = "refused"; this.st.refused = local(String(pl(d).code ?? "refused")); return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 }; }
    // a receipt is kept only when it is the ballot box's, answers this cast, is addressed to its one-time key and is for this poll (ballotBox.ts postCast)
    const ok = d.type === `${CAST_TYPE}#response` && verifyDocumentProof(d, { nowMs: Date.now() }).valid && d.issuer === f.to && d.threadId === (cast.threadId ?? cast.id) && d.recipient === cast.issuer && pl(d).electionId === pl(cast).electionId;
    if (!ok) { f.state = "refused"; this.st.refused = "receiptInvalid"; return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 }; }
    f.state = "completed";
    this.st.outcome = String(pl(d).outcome); this.st.leaf = Number(pl(d).leafIndex); this.st.firstLeaf ??= this.st.leaf; this.st.receipts = (this.st.receipts ?? 0) + 1; delete this.st.refused;
    return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
  }
  async observe(q: ObserveQuery): Promise<ObserveResult> {
    if (q.query === "ceremony") { const f = this.flows.find((x) => x.thread === q.threadId); return { value: f === undefined ? "unknown" : f.state }; }
    if (q.query === "received") { const f = this.flows.find((x) => x.thread === q.threadId); const docs = (f?.received ?? []).filter((d) => q.type === undefined || d.type === q.type); return { value: docs.length, documents: docs.map((d) => JSON.stringify(d)) }; }
    if (q.query !== "stored") throw new Error(`the voter does not answer observe ${q.query}`);
    return { value: ballotStoredKind(this.st, q.kind) };
  }
}
