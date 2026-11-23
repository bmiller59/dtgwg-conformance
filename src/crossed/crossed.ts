// SPDX-License-Identifier: Apache-2.0
// Artifact-crossed replay (docs/14 section 7). The documents one implementation emitted (live through its adapter's `emit`, or read
// back from a recorded `produced.json`) are handed to another implementation's receiver adapter through the ordinary adapter contract
// (`send`), and the receiver's verdict is recorded as evidence of its own kind, `artifact-crossed`.
//
// What this is not: a live exchange between two platforms. The runner relays the bytes, so carriage, sessions and discovery are not
// exercised, and the result is never called demonstrated interoperation. It is never summed with conformance counts, never asserts
// what the receiver should have done (no oracle: the verdict is recorded, not judged) and never enters the at-a-glance page.
import type { Adapter, Capabilities, ProvisionedRole, SendResult } from "../adapter/contract.ts";
import type { LoadedSuite } from "../vectors/load.ts";

export const PRODUCED_FORMAT = "tt-crossed-produced/0.1";
export const CROSSED_FORMAT = "tt-artifact-crossed/0.1";
export const EVIDENCE_KIND = "artifact-crossed";
/** Clock start of the producer when it has a settable clock: the start of the emit vector files, so live runs are reproducible. */
export const PRODUCER_CLOCK = "2026-11-12T10:00:00Z";
/**
 * Recorded as the producer clock when the producer's clock was set to the current time before each document: used when the receiver's
 * clock cannot be set (it judges freshness against real time), so the documents are fresh when relayed rather than dated at PRODUCER_CLOCK.
 */
export const REAL_TIME = "real time";

export const CROSSED_NOTE =
  "Evidence kind artifact-crossed: documents one implementation emitted, relayed by the runner to another implementation's receiver adapter. Not a live exchange (no carriage, session or discovery between the two), not demonstrated interoperation, not a conformance result and never summed with conformance counts. The receiver's verdict is recorded, not judged.";

export interface PartyRecord {
  spec: string;
  name: string;
  implementation: string;
  version: string;
  vid: string;
}

export interface ProducedDoc {
  type: string;
  /** The document exactly as the producer's builder returned it. */
  text: string;
  /** The emit-class vector ids (vectors/emit, vectors/emit-more) that check this Type URI on the producer side. */
  emitVectors: string[];
}

export interface Produced {
  format: typeof PRODUCED_FORMAT;
  producer: PartyRecord & { didDocument?: unknown };
  /** The recipient the documents were addressed to (the receiver's VID in a live run). */
  addressedTo: string;
  /** The producer's clock: PRODUCER_CLOCK, REAL_TIME (set to the current time before each document) or null (not settable). */
  clock: string | null;
  documents: ProducedDoc[];
  /** Types the producer declared in `emits` but could not emit (its error). */
  failed: { type: string; error: string }[];
}

/**
 * `accepted`: a reply that is neither an error nor a next-step. `held`: a `trust-task-next-step` reply. `rejected`: an error reply
 * (`errorCode`). `no-reply`: no reply and no refusal. `transport-refused`: the binding refused the bytes. `not-served`: the receiver
 * does not declare the Type URI (not sent). `adapter-error`: the adapter call threw.
 */
export type Verdict = "accepted" | "held" | "rejected" | "no-reply" | "transport-refused" | "not-served" | "adapter-error";
export const VERDICTS: readonly Verdict[] = ["accepted", "held", "rejected", "no-reply", "transport-refused", "not-served", "adapter-error"];

export interface CrossedCase {
  n: number;
  type: string;
  documentId: string | null;
  emitVectors: string[];
  verdict: Verdict;
  errorCode?: string;
  replyTypes: string[];
  /** The document's `recipient` is the receiver's own VID. False for a recorded replay into a receiver with another identity. */
  addressedToReceiver: boolean;
  /** `set`: the receiver's clock was set to the document's issuedAt; `not-set`: the receiver's clock cannot be set (real time). */
  receiverClock: "set" | "not-set";
  note?: string;
}

export interface CrossedResult {
  format: typeof CROSSED_FORMAT;
  evidence: typeof EVIDENCE_KIND;
  demonstrated: false;
  countedAsConformance: false;
  note: string;
  producer: PartyRecord;
  producerSource: "live" | "recorded";
  receiver: PartyRecord;
  /** The producer and the receiver are one party (same VID): the replay shows nothing about two parties. */
  sameParty: boolean;
  cases: CrossedCase[];
  totals: Record<Verdict, number>;
}

/** Emit-class vector ids per Type URI, from the loaded emit vector sets. */
export function emitVectorIndex(suites: LoadedSuite[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const s of suites) for (const { file } of s.files) for (const v of file.vectors) for (const st of v.steps ?? []) {
    if (st.emit === undefined) continue;
    const l = idx.get(st.emit.type) ?? [];
    if (!l.includes(v.id)) l.push(v.id);
    idx.set(st.emit.type, l);
  }
  return idx;
}

async function party(spec: string, a: Adapter): Promise<{ caps: Capabilities; iut: ProvisionedRole; rec: PartyRecord }> {
  const caps = await a.capabilities();
  const iut = (await a.provision(["iut"])).iut;
  if (iut === undefined) throw new Error(`${spec}: adapter did not provision role iut`);
  return { caps, iut, rec: { spec, name: caps.name, implementation: caps.implementation ?? caps.name, version: caps.version, vid: iut.vid } };
}

/** Whether the receiver's clock can be set (optional capability `clock`); when not, a live producer runs on real time. */
export async function receiverClockSettable(receiver: Adapter): Promise<boolean> {
  return (await receiver.capabilities()).optional.includes("clock");
}

/** The receiver's identity, needed before a live producer addresses its documents. */
export async function receiverVid(receiver: Adapter): Promise<string> {
  const iut = (await receiver.provision(["iut"])).iut;
  if (iut === undefined) throw new Error("receiver adapter did not provision role iut");
  return iut.vid;
}

/** Ask a producer adapter (optional capability `emit`) for one document of every Type URI it emits, addressed to `addressedTo`. */
export async function produceLive(spec: string, producer: Adapter, addressedTo: string, opts: { types?: string[]; emitIndex?: Map<string, string[]>; realTime?: boolean } = {}): Promise<Produced> {
  const { caps, iut, rec } = await party(spec, producer);
  if (!caps.optional.includes("emit") || (caps.emits ?? []).length === 0) throw new Error(`${spec}: the producer declares no emit capability (Capabilities.emits)`);
  const types = [...(caps.emits ?? [])].filter((t) => opts.types === undefined || opts.types.includes(t)).sort();
  const clock = caps.optional.includes("clock") ? (opts.realTime === true ? REAL_TIME : PRODUCER_CLOCK) : null;
  const documents: ProducedDoc[] = [];
  const failed: Produced["failed"] = [];
  // One reset before the first document, not one per type: a deterministic producer (the reference numbers its document ids from the
  // reset) would otherwise give every document the same id, which a receiver whose duplicate store outlives `reset` refuses as idConflict.
  await producer.reset();
  for (const type of types) {
    try {
      if (clock !== null) await producer.setClock(clock === REAL_TIME ? new Date().toISOString() : clock);
      const res = await producer.emit!({ type, args: { recipient: addressedTo } });
      for (const text of res.documents) documents.push({ type, text, emitVectors: opts.emitIndex?.get(type) ?? [] });
    } catch (e) {
      failed.push({ type, error: (e as Error).message });
    }
  }
  return { format: PRODUCED_FORMAT, producer: { ...rec, ...(iut.didDocument === undefined ? {} : { didDocument: iut.didDocument }) }, addressedTo, clock, documents, failed };
}

/** Check a produced.json read from disk. */
export function parseProduced(v: unknown): Produced {
  const p = v as Partial<Produced>;
  if (p === null || typeof p !== "object" || p.format !== PRODUCED_FORMAT) throw new Error(`produced.json: format must be ${PRODUCED_FORMAT}`);
  if (typeof p.producer?.vid !== "string" || !Array.isArray(p.documents)) throw new Error("produced.json: producer.vid and documents are required");
  for (const d of p.documents) if (typeof d?.type !== "string" || typeof d.text !== "string") throw new Error("produced.json: every document needs type and text");
  return p as Produced;
}

function classify(res: SendResult): Pick<CrossedCase, "verdict" | "errorCode" | "replyTypes"> {
  const replies = res.replies.map((r) => { try { return JSON.parse(r) as Record<string, unknown>; } catch { return {}; } });
  const replyTypes = replies.map((r) => String(r.type ?? ""));
  const err = replies.find((r) => String(r.type ?? "").includes("/trust-task-error/"));
  if (err !== undefined) {
    const code = (err.payload as { code?: unknown } | undefined)?.code;
    return { verdict: "rejected", ...(typeof code === "string" ? { errorCode: code } : {}), replyTypes };
  }
  if (replyTypes.some((t) => t.includes("/trust-task-next-step/"))) return { verdict: "held", replyTypes };
  if (replies.length > 0) return { verdict: "accepted", replyTypes };
  return { verdict: res.transport.kind === "refused" ? "transport-refused" : "no-reply", replyTypes };
}

/** Replay every produced document into the receiver, one at a time from a reset state, and record its verdict. */
export async function replay(receiverSpec: string, receiver: Adapter, produced: Produced, source: "live" | "recorded"): Promise<CrossedResult> {
  const { caps, rec } = await party(receiverSpec, receiver);
  const served = new Set([...caps.supportedTypes, ...(caps.unlistedTypes ?? [])]);
  const settable = caps.optional.includes("clock");
  const cases: CrossedCase[] = [];
  const { didDocument, ...producer } = produced.producer;
  for (const [i, d] of produced.documents.entries()) {
    let doc: Record<string, unknown> = {};
    try { doc = JSON.parse(d.text) as Record<string, unknown>; } catch { /* sent as is; the receiver decides */ }
    const base = {
      n: i + 1, type: d.type, documentId: typeof doc.id === "string" ? doc.id : null, emitVectors: d.emitVectors,
      addressedToReceiver: doc.recipient === rec.vid, receiverClock: (settable ? "set" : "not-set") as CrossedCase["receiverClock"],
    };
    if (!served.has(d.type)) { cases.push({ ...base, verdict: "not-served", replyTypes: [], note: "the receiver does not declare this Type URI; not sent" }); continue; }
    try {
      await receiver.reset();
      // A receiver that resolves the producer's identifier itself (VTI resolves did:key) answers `trust` with "not supported": the
      // document is still sent, and the case says the producer was not registered with the receiver.
      let trustNote: string | undefined;
      try { await receiver.trust(producer.vid, didDocument); } catch (e) {
        const m = (e as Error).message;
        if (!/^not supported\b/i.test(m)) throw e;
        trustNote = `trust not supported by the receiver, producer identifier not registered: ${m}`;
      }
      if (settable && typeof doc.issuedAt === "string" && !Number.isNaN(Date.parse(doc.issuedAt))) await receiver.setClock(doc.issuedAt);
      const issuer = typeof doc.issuer === "string" ? doc.issuer : producer.vid;
      const res = await receiver.send({ from: { kind: "actor", vid: issuer }, bytes: d.text });
      cases.push({ ...base, ...classify(res), ...(trustNote === undefined ? {} : { note: trustNote }) });
    } catch (e) {
      cases.push({ ...base, verdict: "adapter-error", replyTypes: [], note: (e as Error).message });
    }
  }
  const totals = Object.fromEntries(VERDICTS.map((v) => [v, cases.filter((c) => c.verdict === v).length])) as Record<Verdict, number>;
  return {
    format: CROSSED_FORMAT, evidence: EVIDENCE_KIND, demonstrated: false, countedAsConformance: false, note: CROSSED_NOTE,
    producer, producerSource: source, receiver: rec, sameParty: producer.vid === rec.vid, cases, totals,
  };
}

export function crossedMarkdown(r: CrossedResult, failed: Produced["failed"] = []): string {
  const lines = [
    `# Artifact-crossed replay: ${r.producer.name} documents into ${r.receiver.name}`,
    "",
    "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.",
    "",
    `> ${r.note} See docs/14 section 7.`,
    "",
    `- Producer (${r.producerSource}): \`${r.producer.spec}\`, ${r.producer.implementation} ${r.producer.version}`,
    `- Receiver: \`${r.receiver.spec}\`, ${r.receiver.implementation} ${r.receiver.version}`,
    ...(r.sameParty ? ["- **Producer and receiver are the same party (one VID): this replay shows nothing about two parties.**"] : []),
    `- Verdicts: ${VERDICTS.filter((v) => r.totals[v] > 0).map((v) => `${v} ${r.totals[v]}`).join(", ") || "none"} (of ${r.cases.length} documents)`,
    ...(r.cases.some((c) => c.note?.startsWith("trust not supported") === true) ? [`- The receiver does not support \`trust\`: the producer's identifier was not registered with it, and the receiver resolved it itself (${r.cases.filter((c) => c.note?.startsWith("trust not supported") === true).length} documents sent that way)`] : []),
    ...(failed.length > 0 ? [`- Not emitted by the producer: ${failed.length} type(s) (see produced.json)`] : []),
    "",
    "| # | Type | Verdict | Error code | Addressed to receiver | Receiver clock | Emit vectors |",
    "|---|---|---|---|---|---|---|",
    ...r.cases.map((c) => `| ${c.n} | ${c.type} | ${c.verdict} | ${c.errorCode ?? ""} | ${c.addressedToReceiver ? "yes" : "no"} | ${c.receiverClock} | ${c.emitVectors.join(", ")} |`),
    "",
  ];
  return lines.join("\n");
}
