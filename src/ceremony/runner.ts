// SPDX-License-Identifier: Apache-2.0
// The ceremony-scenario runner (docs/25): a separate entry, never part of the default suite run. It binds each role of a scenario to an adapter,
// starts the run, injects the operator decisions through each participant's own `trigger`, relays the documents the participants build (runner-carried
// mode) and reads every participant's own state. It never builds or signs a step document. A run ends in `completed`, `ended-as-specified`, `failed`,
// `inconclusive`, `incomplete` or `skipped`; none of these is a conformance verdict, and the result is never added to a conformance count.
import { createHash, randomUUID } from "node:crypto";
import type { Adapter, CeremonyState, ObserveResult } from "../adapter/contract.ts";
import { digestMultibase } from "../crypto/digest.ts";
import { TERMINAL_STATES } from "./scenario.ts";
import type { Check, ReceivedRef, Scenario, ScenarioFile, ScenarioStatus, ScenarioStep } from "./scenario.ts";

export interface TranscriptEntry {
  seq: number;
  scenario: string;
  step: string;
  /** `built` (a participant built it), `delivered` (the runner handed it to the recipient), `reply` (what the recipient answered), `reply-delivered`. */
  kind: "built" | "delivered" | "reply" | "reply-delivered";
  from: string;
  to: string;
  /** The carrier of this hop: always the runner's in-process relay in this mode. */
  carrier: "runner-relay";
  sha256: string;
  bytes: string;
}
export interface StepResult { id: string; ok: boolean; detail: string }
export interface ScenarioResult {
  id: string;
  title: string;
  status: ScenarioStatus;
  /** The terminal state read from the participants, when one was reached. */
  terminal: CeremonyState | null;
  reason: string;
  failedStep: string | null;
  participants: Record<string, { adapter: string; vid: string; role: string; states: CeremonyState | null; /** The labelled mode the participant ran in, when it declares one (the witness oracle's `mint-on-verified`). */ mode?: string }>;
  steps: StepResult[];
  assertions: StepResult[];
  /** The label the result may carry, and no other: what ran, between whom, over what, when. */
  label: string;
  evidence: "complete-ceremony";
  countedAsConformance: false;
}
export interface RunnerOptions {
  /** Adapter per role slot (`P`, `R`): fresh instances, one per participant. */
  make: (slot: string) => Promise<Adapter>;
  specs: Record<string, string>;
  today: string;
  /** Only these scenario ids (default: all). */
  only?: string[];
}
export interface RunOutput { results: ScenarioResult[]; transcript: TranscriptEntry[] }

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const ENDED = new Set<string>(TERMINAL_STATES.filter((s) => s !== "completed"));
/** The carrier of a run: the runner's in-process relay, or, when every participant declares a `wire:` mode, the wire that mode names (the participants carried their own documents). */
export const RELAY_CARRIER = "runner-carried relay, in process";
const label = (specs: Record<string, string>, today: string, carrier: string = RELAY_CARRIER): string => `ran together, one pair (${Object.entries(specs).map(([k, v]) => `${k}=${v}`).join(", ")}), one carrier (${carrier}), one date (${today})`;
export function carrierOf(modes: (string | undefined)[]): string {
  const wire = modes.filter((m): m is string => m !== undefined && m.startsWith("wire:"));
  return wire.length > 0 && wire.length === modes.length ? wire[0]! : RELAY_CARRIER;
}

/** The start of the message an adapter throws for a step its row cannot play (a stand-in or deployment limit, class D): the scenario is skipped with that reason, not failed. */
export const NOT_OFFERED = "not offered by the wire row:";

class Stop extends Error {
  readonly status: ScenarioStatus;
  readonly step: string | null;
  constructor(status: ScenarioStatus, step: string | null, message: string) {
    super(message);
    this.status = status;
    this.step = step;
  }
}

interface Ctx {
  scenario: Scenario;
  who: Record<string, { a: Adapter; vid: string; didDocument?: unknown }>;
  caps: Record<string, Awaited<ReturnType<Adapter["capabilities"]>>>;
  threads: Record<string, string>;
  /** What each initiate step built: its issuer slot, thread and documents. */
  built: Record<string, { by: string; thread: string; docs: string[] }>;
  /** The thread of the request each participant was last sent (the executor's own report), for an approver that decides on its own request. */
  asked: Record<string, string>;
  transcript: TranscriptEntry[];
  seq: number;
  /** What the executor's declaration fixed (FC-TCA): k, the slots standing for the declared approver set, and the approvals already counted. */
  delivered: Set<string>;
  /** The recipient's answers to the newest `replay` step (a `reply` check reads them). */
  lastReplay?: { step: string; status: number; replies: string[] };
  gov?: { k: number; admins: string[]; counted: Set<string>; asked: Set<string>; last?: string };
}

/**
 * A marker in an argument: `$<slot>` is that participant's identifier, `$declared.approvers` the identifiers of the declared approver set, `$thread:<name>` a captured
 * thread, and `{"$received": {at, type, thread?, member}}` a member of a document that reached participant `at` (the newest of that type on that thread): the way an
 * operator is told an identifier a party minted (FC-ONB: the request id the community returned, which the administrator decides on). The runner only reads it
 * through the participant's own `observe`; the document that uses it is still built and signed by a participant.
 */
async function subst(ctx: Ctx, v: unknown, step = ""): Promise<unknown> {
  if (v === "$declared.approvers") return ctx.gov === undefined ? [] : ctx.gov.admins.map((a) => ctx.who[a]!.vid);
  if (typeof v === "string" && v.startsWith("$thread:")) return ctx.threads[v.slice(8)] ?? v;
  // `$doc:<slot>`: the DID document the participant presented when it was provisioned (what a wallet resolves a community's DID to)
  if (typeof v === "string" && v.startsWith("$doc:") && ctx.who[v.slice(5)] !== undefined) return ctx.who[v.slice(5)]!.didDocument ?? null;
  if (typeof v === "string" && v.startsWith("$") && ctx.who[v.slice(1)] !== undefined) return ctx.who[v.slice(1)]!.vid;
  if (Array.isArray(v)) return Promise.all(v.map((x) => subst(ctx, x, step)));
  if (typeof v === "object" && v !== null) {
    const r = (v as { $received?: ReceivedRef }).$received;
    if (r !== undefined && Object.keys(v).length === 1) return readReceived(ctx, r, step);
    return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await subst(ctx, x, step)] as const)));
  }
  return v;
}

/** A member of the newest document of `type` that reached `at` on a thread (a dotted path under `payload`). The step fails when there is none. */
async function readReceived(ctx: Ctx, r: ReceivedRef, step: string): Promise<unknown> {
  const th = thread(ctx, r.thread, step);
  const res = await ctx.who[r.at]!.a.observe({ query: "received", threadId: th, type: r.type });
  const last = (res.documents ?? []).at(-1);
  if (last === undefined) throw new Stop("failed", step, `${r.at} received no ${r.type} on the thread to read ${r.member} from`);
  let cur: unknown = (JSON.parse(last) as { payload?: unknown }).payload;
  for (const k of r.member.split(".")) cur = typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[k] : undefined;
  if (cur === undefined) throw new Stop("failed", step, `the ${r.type} that reached ${r.at} has no payload member ${r.member}`);
  return cur;
}

/** What the executor's declared essential governance fixes, or why the scenario cannot run against it. */
function readGovernance(s: Scenario, caps: Ctx["caps"]): { k: number; n: number; b: number } | string {
  const g = s.governance!;
  const c = caps[g.from]!;
  const e = c.governance?.essential;
  if (e === undefined || e.source === "unreadable" || e.consent === undefined || e.principals === undefined) return `${g.from} (${c.name}) declares no readable essential governance: the suite does not decide k or the approver set`;
  const n = e.principals.filter((p) => p.role === e.consent!.approverSet).length;
  const k = e.consent.minApprovals;
  const b = c.ceremony?.proposerApproves === true ? 1 : 0;
  if (n > g.approvers.length) return `${g.from} declares ${n} approvers; the scenario has ${g.approvers.length} approver slots`;
  if (k > n) return `${g.from} declares k=${k} above its ${n} approvers`;
  if (k - 1 < 1 && s.steps.some((st) => st.do.approve?.repeat === true)) return `k=${k}: no counted approval exists to repeat`;
  if (k - 1 < b) return `k=${k} and the begin counts as the proposer's approval: no quorum that is one short exists to hold`;
  return { k, n, b };
}

function note(ctx: Ctx, step: string, kind: TranscriptEntry["kind"], from: string, to: string, bytes: string): void {
  ctx.transcript.push({ seq: ctx.seq++, scenario: ctx.scenario.id, step, kind, from, to, carrier: "runner-relay", sha256: sha256(bytes), bytes });
}

/** Why a participant cannot play its slot, or null: a `requires` entry it does not offer, or a role it does not list for the group. */
function skipReason(s: Scenario, group: string, slot: string, caps: Ctx["caps"][string]): string | null {
  const decl = s.participants[slot]!;
  for (const r of decl.requires) {
    const ok = r.startsWith("optional:") ? caps.optional.includes(r.slice(9)) : r.startsWith("https://") ? caps.supportedTypes.includes(r) : true;
    if (!ok) return `${slot} (${caps.name}) does not offer ${r}`;
  }
  const roles = caps.ceremonyRoles?.find((c) => c.ceremony === group)?.roles;
  if (roles === undefined || !roles.includes(decl.role)) return `role not offered: ${slot} (${caps.name}) does not list ${decl.role} for ${group}`;
  return null;
}

const thread = (ctx: Ctx, name: string | undefined, step: string): string => {
  const t = ctx.threads[name ?? "thread"];
  if (t === undefined) throw new Stop("failed", step, `no thread captured as ${name ?? "thread"}`);
  return t;
};

async function evalCheck(ctx: Ctx, c: Check, step: string): Promise<StepResult> {
  const id = `${step}: ${JSON.stringify(c)}`;
  const fail = (detail: string): StepResult => ({ id, ok: false, detail });
  if (c.receiptMatches !== undefined) {
    const b = ctx.built[c.receiptMatches.step];
    if (b === undefined) return fail(`step ${c.receiptMatches.step} built no document`);
    const doc = JSON.parse(b.docs[0]!) as { type: string; payload: { vrc?: unknown; presentation?: { verifiableCredential?: unknown[] } } };
    // the credential the document delivered: a relationship credential (issue) or the witnessed credential inside the presentation (witness-share)
    const delivered = doc.payload.vrc ?? doc.payload.presentation?.verifiableCredential?.[0];
    const want = digestMultibase(delivered as never);
    const field = doc.payload.vrc === undefined ? "vwcDigestMultibase" : "vrcDigestMultibase";
    const r = await ctx.who[b.by]!.a.observe({ query: "received", type: `${doc.type}#response`, threadId: b.thread });
    const got = (r.documents ?? []).map((t) => (JSON.parse(t) as { payload?: Record<string, string> }).payload?.[field]);
    return got.includes(want) ? { id, ok: true, detail: `the receipt at ${b.by} carries the digest of the credential built in ${c.receiptMatches.step}, on its thread` } : fail(`no delivery receipt at ${b.by} on the credential's thread carries ${want} (receipts seen: ${got.length === 0 ? "none" : got.join(", ")})`);
  }
  if (c.reply !== undefined) {
    const lr = ctx.lastReplay;
    if (lr === undefined) return fail("no replay step has run before this check");
    const want = c.reply;
    const docs = lr.replies.map((t) => JSON.parse(t) as { type?: string; payload?: { code?: string } });
    const ok = docs.length > 0 && docs.some((d) => (want.type === undefined || d.type === want.type) && (want.code === undefined || want.code.split("|").includes(String(d.payload?.code)))) && (want.status === undefined || lr.status === want.status);
    return ok ? { id, ok: true, detail: `the answer to ${lr.step} was ${docs.map((d) => `${String(d.type).split("/").slice(-3).join("/")}${d.payload?.code === undefined ? "" : ` ${d.payload.code}`}`).join(", ")} (HTTP ${lr.status})` } : fail(`the answer to ${lr.step} was ${docs.length === 0 ? "none" : docs.map((d) => `${String(d.type)} ${String(d.payload?.code ?? "")}`).join(", ")} (HTTP ${lr.status}); expected ${JSON.stringify(want)}`);
  }
  const at = ctx.who[c.at!]!;
  // an executor that issues one request per approver (each its own signed document with its own id) has each approver file its request under that id:
  // a `received` or `ceremony` check at a participant that was asked reads the thread of the request it was sent
  const own = (c.received !== undefined || c.ceremony !== undefined) && c.thread === undefined ? ctx.asked[c.at!] : undefined;
  const th = c.ceremony !== undefined || c.received !== undefined ? own ?? thread(ctx, c.thread, step) : "";
  if (c.ceremony !== undefined) {
    const r = await at.a.observe({ query: "ceremony", threadId: th });
    return r.value === c.ceremony ? { id, ok: true, detail: `${c.at} reads ${String(r.value)}` } : fail(`${c.at} reads ${String(r.value)}, expected ${c.ceremony}`);
  }
  if (c.received !== undefined) {
    const q = c.received;
    const from = q.from === undefined ? undefined : ctx.who[q.from]!.vid;
    // `type` may list alternatives joined with `|` (the shapes a hold can take); the participant is asked for every document of the thread and the runner filters
    const types = q.type === undefined ? undefined : q.type.split("|");
    const r = await at.a.observe({ query: "received", threadId: th, ...(types === undefined || types.length > 1 ? {} : { type: types[0]! }), ...(from === undefined ? {} : { from }) });
    const docs = (r.documents ?? []).filter((t) => types === undefined || types.length === 1 || types.includes(String((JSON.parse(t) as { type?: string }).type))).filter((t) => q.code === undefined || q.code.split("|").includes(String((JSON.parse(t) as { payload?: { code?: string } }).payload?.code)));
    const ok = q.count === undefined ? docs.length >= 1 : docs.length === q.count;
    return ok ? { id, ok: true, detail: `${c.at} received ${docs.length}` } : fail(`${c.at} received ${docs.length} matching document(s), expected ${q.count === undefined ? "at least 1" : q.count}`);
  }
  const s = c.stored!;
  // `$K` in a kind stands for that participant's identifier (a subject the scenario cannot spell in advance: the wallet's own DID)
  const kind = s.kind.replace(/\$([A-Za-z][A-Za-z0-9]*)/g, (m, n: string) => ctx.who[n]?.vid ?? m);
  const r = await at.a.observe({ query: "stored", kind });
  return r.value === s.count ? { id, ok: true, detail: `${c.at} stores ${String(r.value)} ${s.kind}` } : fail(`${c.at} stores ${String(r.value)} ${s.kind}, expected ${s.count}`);
}

async function doStep(ctx: Ctx, step: Scenario["steps"][number]): Promise<void> {
  const names = Object.keys(ctx.who);
  if (step.do.connect !== undefined) {
    for (const a of names) for (const b of names) {
      if (a === b) continue;
      const r = await ctx.who[a]!.a.connect!({ peer: { vid: ctx.who[b]!.vid }, role: ctx.scenario.participants[b]!.role });
      if (!r.connected) throw new Stop("failed", step.id, `${a} did not connect to ${b}: ${r.detail ?? ""}`);
    }
    return;
  }
  if (step.do.decide !== undefined) {
    const d = step.do.decide;
    await ctx.who[d.by]!.a.trigger(d.action, (await subst(ctx, d.args, step.id)) as Record<string, unknown>);
    return;
  }
  if (step.do.relayPushed !== undefined) {
    const rp = step.do.relayPushed;
    const by = ctx.who[rp.from]!, to = ctx.who[rp.to]!;
    if (rp.ifOffered === true && ctx.caps[rp.from]?.optional.includes("observe.pushed") !== true) return;
    const r = await by.a.observe({ query: "pushed", to: to.vid, ...(rp.type === undefined ? {} : { type: rp.type }) });
    const fresh = (r.documents ?? []).filter((d) => !ctx.delivered.has(d));
    if (fresh.length === 0) throw new Stop("failed", step.id, `${rp.from} pushed no document for ${rp.to}${rp.type === undefined ? "" : ` of type ${rp.type}`}`);
    for (const bytes of fresh) {
      ctx.delivered.add(bytes);
      note(ctx, step.id, "built", rp.from, rp.to, bytes);
      note(ctx, step.id, "delivered", rp.from, rp.to, bytes);
      const sent = await to.a.send({ from: { kind: "actor", vid: by.vid }, bytes });
      for (const reply of sent.replies) {
        note(ctx, step.id, "reply", rp.to, rp.from, reply);
        note(ctx, step.id, "reply-delivered", rp.to, rp.from, reply);
        await by.a.send({ from: { kind: "actor", vid: to.vid }, bytes: reply });
      }
    }
    return;
  }
  if (step.do.replay !== undefined) {
    const rp = step.do.replay;
    const b = ctx.built[rp.step];
    const nth = rp.index ?? 0;
    if (b === undefined || b.docs[nth] === undefined) {
      // a wire participant builds, signs and sends its own documents: the ones it never put on the wire (or never exposed) cannot be replayed by the harness (class D, not reached)
      if (b !== undefined && ctx.caps[b.by]?.mode?.startsWith("wire:") === true) throw new Stop("skipped", step.id, `${NOT_OFFERED} the harness cannot replay document ${nth} of step ${rp.step}, which the wire participant did not hand over (it builds and sends its own documents)`);
      throw new Stop("failed", step.id, `step ${rp.step} built no document ${nth} to replay`);
    }
    const doc = JSON.parse(b.docs[nth]!) as Record<string, unknown>;
    if (rp.mode === "stripProof") { delete doc.proof; doc.id = `urn:uuid:${randomUUID()}`; } // a fresh id: only the missing proof can refuse it
    // tamper: a payload value changed after signing, under a fresh id (so only the proof can refuse it); conflict: the same id with a changed payload (the proof fails too)
    if (rp.mode === "tamper" || rp.mode === "conflict") {
      // change the first string value of the payload, so the payload stays valid for its schema and only the proof (or the repeated id) can refuse it
      const alter = (o: unknown): boolean => {
        if (typeof o !== "object" || o === null) return false;
        for (const k of Object.keys(o)) {
          const v = (o as Record<string, unknown>)[k];
          if (typeof v === "string") { (o as Record<string, unknown>)[k] = `${v}x`; return true; }
          if (alter(v)) return true;
        }
        return false;
      };
      if (!alter(doc.payload)) doc.payload = { ...(doc.payload as Record<string, unknown>), tamperedAfterSigning: true };
    }
    if (rp.mode === "tamper") doc.id = `urn:uuid:${randomUUID()}`;
    const bytes = JSON.stringify(doc);
    note(ctx, step.id, "built", rp.by, rp.to, bytes);
    note(ctx, step.id, "delivered", rp.by, rp.to, bytes);
    const sent = await ctx.who[rp.to]!.a.send({ from: { kind: "actor", vid: ctx.who[rp.by]!.vid }, bytes });
    for (const reply of sent.replies) note(ctx, step.id, "reply", rp.to, rp.by, reply);
    ctx.lastReplay = { step: step.id, status: sent.transport.status ?? 0, replies: sent.replies };
    return;
  }
  if (step.do.approve !== undefined) {
    const ap = step.do.approve, g = ctx.gov!;
    const target = ap.upTo === "k" ? g.k : g.k - 1;
    while (g.counted.size < target) {
      const next = g.admins.find((a) => !g.counted.has(a));
      if (next === undefined) throw new Stop("failed", step.id, `no declared approver is left to ask (${g.counted.size} of ${target} counted)`);
      await decideBy(ctx, step.id, ap, next);
      g.counted.add(next);
    }
    if (ap.repeat === true) await decideBy(ctx, `${step.id}-again`, ap, g.last ?? g.admins[0]!);
    return;
  }
  const i = step.do.initiate!;
  await relay(ctx, step.id, step.id, i);
}

/** The executor asks one declared approver (once) and that approver decides. */
async function decideBy(ctx: Ctx, key: string, ap: NonNullable<ScenarioStep["do"]["approve"]>, who: string): Promise<void> {
  const g = ctx.gov!;
  if (!g.asked.has(who)) {
    await relay(ctx, `${key}/${who}`, key, { by: ap.executor, to: who, kind: "consent-request", thread: ap.thread ?? "thread" });
    g.asked.add(who);
  }
  await relay(ctx, `${key}/${who}`, key, { by: who, to: ap.executor, kind: "consent-decision", thread: ap.thread ?? "thread" });
  g.last = who;
}

/** The most documents one initiate step may add after the first, when the participant continues its own flow (a step-down, a next step). */
const MAX_CONTINUATIONS = 8;

/** One document built by a participant and relayed to its recipient (runner-carried mode), the answers relayed back, and, for a participant that runs its own flow (`continues`), whatever it sends in answer. */
async function relay(ctx: Ctx, key: string, step: string, i: NonNullable<ScenarioStep["do"]["initiate"]>): Promise<void> {
  const by = ctx.who[i.by]!, to = ctx.who[i.to]!;
  const own = i.kind === "consent-decision" && i.thread !== undefined ? ctx.asked[i.by] : undefined;
  const res = await by.a.initiate!({ kind: i.kind, to: to.vid, ...(i.thread === undefined ? {} : { thread: own ?? thread(ctx, i.thread, step) }), ...(i.args === undefined ? {} : { args: (await subst(ctx, i.args, step)) as Record<string, unknown> }) });
  if (i.capture !== undefined) ctx.threads[i.capture] = res.threadId;
  if (i.kind === "consent-gate" || i.kind === "consent-request") ctx.asked[i.to] = res.threadId;
  ctx.built[key] = { by: i.by, thread: res.threadId, docs: [...res.documents] };
  if (res.sent) return; // the participant carried its own documents (live mode): nothing for the runner to relay
  let budget = MAX_CONTINUATIONS;
  const carry = async (bytes: string): Promise<void> => {
    note(ctx, key, "built", i.by, i.to, bytes);
    note(ctx, key, "delivered", i.by, i.to, bytes);
    const sent = await to.a.send({ from: { kind: "actor", vid: res.from ?? by.vid }, bytes });
    for (const reply of sent.replies) {
      note(ctx, key, "reply", i.to, i.by, reply);
      note(ctx, key, "reply-delivered", i.to, i.by, reply);
      // one hop back: an answer to the answer is recorded by the participant, not relayed again, unless the participant runs its own flow
      const back = await by.a.send({ from: { kind: "actor", vid: to.vid }, bytes: reply });
      if (res.continues === true) for (const next of back.replies) {
        if (budget-- <= 0) throw new Stop("failed", step, `${i.by} kept sending documents after ${MAX_CONTINUATIONS} continuations in one step`);
        ctx.built[key]!.docs.push(next);
        await carry(next);
      }
    }
  };
  for (const bytes of res.documents) await carry(bytes);
}

async function readTerminal(ctx: Ctx): Promise<{ terminal: CeremonyState | null; states: Record<string, CeremonyState | null>; why: string }> {
  const states: Record<string, CeremonyState | null> = {};
  const th = ctx.threads[ctx.scenario.completion.thread];
  const reads = ctx.scenario.reads ?? Object.keys(ctx.who);
  for (const [n, p] of Object.entries(ctx.who)) {
    if (!reads.includes(n)) continue;
    if (th === undefined) { states[n] = null; continue; }
    const r: ObserveResult = await p.a.observe({ query: "ceremony", threadId: th });
    states[n] = r.value === "unknown" ? null : (r.value as CeremonyState);
  }
  const vals = Object.values(states);
  if (th === undefined) return { terminal: null, states, why: "no thread was opened" };
  if (vals.some((v) => v === null)) return { terminal: null, states, why: `a participant's state cannot be read (${Object.entries(states).filter(([, v]) => v === null).map(([k]) => k).join(", ")} reads unknown)` };
  const ended = vals.find((v) => v !== null && ENDED.has(v));
  if (ended !== undefined) return { terminal: ended!, states, why: "" };
  if (vals.every((v) => v === "completed")) return { terminal: "completed", states, why: "" };
  return { terminal: null, states, why: `no terminal state: ${Object.entries(states).map(([k, v]) => `${k} ${String(v)}`).join(", ")}` };
}

async function runOne(file: ScenarioFile, s: Scenario, o: RunnerOptions, out: RunOutput): Promise<ScenarioResult> {
  const base = { id: s.id, title: s.title, evidence: "complete-ceremony" as const, countedAsConformance: false as const };
  let carrier = RELAY_CARRIER;
  const res = (r: Pick<ScenarioResult, "status" | "terminal" | "reason" | "failedStep"> & Partial<ScenarioResult>): ScenarioResult => ({ participants: {}, steps: [], assertions: [], ...base, label: label(o.specs, o.today, carrier), ...r });
  const slots = Object.keys(s.participants);
  const unbound = slots.filter((n) => o.specs[n] === undefined);
  if (unbound.length > 0) return res({ status: "skipped", terminal: null, reason: `participant(s) not bound: ${unbound.join(", ")}`, failedStep: null });
  if (!s.carrier.modes.includes("runner-carried")) return res({ status: "skipped", terminal: null, reason: "this scenario needs a live carrier; only runner-carried mode exists", failedStep: null });
  const adapters: Adapter[] = [];
  const steps: StepResult[] = [];
  const assertions: StepResult[] = [];
  const who: Ctx["who"] = {};
  const caps: Ctx["caps"] = {};
  const parts: ScenarioResult["participants"] = {};
  const started = Date.now();
  try {
    for (const n of slots) {
      const a = await o.make(n);
      adapters.push(a);
      const c = await a.capabilities();
      caps[n] = c;
      carrier = carrierOf(Object.values(caps).map((x) => x.mode));
      const why = skipReason(s, file.group, n, c);
      if (why !== null) return res({ status: "skipped", terminal: null, reason: why, failedStep: null });
      await a.reset();
      const prov = await a.provision(["peer"]);
      who[n] = { a, vid: prov["peer"]!.vid, didDocument: prov["peer"]!.didDocument };
      parts[n] = { adapter: c.name, vid: who[n]!.vid, role: s.participants[n]!.role, states: null, ...(c.mode === undefined ? {} : { mode: c.mode }) };
    }
    if (new Set(Object.values(who).map((w) => w.vid)).size !== slots.length) return res({ status: "inconclusive", terminal: null, reason: "two participants share one identity (use two different keys)", failedStep: null, participants: parts });
    const ctx: Ctx = { scenario: s, who, caps, threads: {}, built: {}, asked: {}, delivered: new Set(), transcript: out.transcript, seq: out.transcript.length };
    if (s.governance !== undefined) {
      const g = readGovernance(s, caps);
      if (typeof g === "string") return res({ status: "skipped", terminal: null, reason: g, failedStep: null, participants: parts });
      const admins = s.governance.approvers.slice(0, g.n);
      ctx.gov = { k: g.k, admins, counted: new Set(g.b === 1 ? [admins[0]!] : []), asked: new Set() };
    }
    for (const step of s.steps) {
      if (step.when !== undefined && (ctx.caps[step.when.at]?.optional.includes(step.when.offers) === true) !== (step.when.is ?? true)) {
        steps.push({ id: step.id, ok: true, detail: `not applicable: ${step.when.at} ${step.when.is === false ? "offers" : "does not offer"} ${step.when.offers}` });
        continue;
      }
      try {
        await doStep(ctx, step);
        for (const c of step.expect ?? []) {
          const r = await evalCheck(ctx, c, step.id);
          steps.push(r);
          if (!r.ok) throw new Stop("failed", step.id, r.detail);
        }
        steps.push({ id: step.id, ok: true, detail: "done" });
      } catch (e) {
        if (e instanceof Stop) throw e;
        // an observation the platform cannot give (the adapter says "unobservable:") leaves the scenario inconclusive: nothing was shown either way
        // a step the row cannot play (an adapter says "not offered by the wire row:") is not reached, class D: skipped with that reason, never failed (D528)
        const m = (e as Error).message;
        if (m.startsWith(NOT_OFFERED)) throw new Stop("skipped", step.id, m);
        throw new Stop(m.includes("unobservable:") ? "inconclusive" : "failed", step.id, `participant error: ${m}`);
      }
      if (Date.now() - started > s.deadlineMs) throw new Stop("incomplete", step.id, `the scenario deadline of ${s.deadlineMs} ms passed`);
    }
    const t = await readTerminal(ctx);
    for (const [n, st] of Object.entries(t.states)) parts[n]!.states = st;
    if (t.terminal === null) {
      const unreadable = Object.values(t.states).some((v) => v === null);
      return res({ status: unreadable ? "inconclusive" : "incomplete", terminal: null, reason: t.why, failedStep: null, participants: parts, steps });
    }
    if (!(s.allowedTerminals as string[]).includes(t.terminal)) return res({ status: "failed", terminal: t.terminal, reason: `terminal state ${t.terminal} is not one of ${s.allowedTerminals.join(", ")}`, failedStep: null, participants: parts, steps });
    for (const c of s.completion.assert) assertions.push(await evalCheck(ctx, c, "completion"));
    const bad = assertions.find((a) => !a.ok);
    if (bad !== undefined) return res({ status: "failed", terminal: t.terminal, reason: bad.detail, failedStep: "completion", participants: parts, steps, assertions });
    return res({ status: t.terminal === "completed" ? "completed" : "ended-as-specified", terminal: t.terminal, reason: "", failedStep: null, participants: parts, steps, assertions });
  } catch (e) {
    if (e instanceof Stop) return res({ status: e.status, terminal: null, reason: e.message, failedStep: e.step, participants: parts, steps, assertions });
    return res({ status: "failed", terminal: null, reason: `participant error: ${(e as Error).message}`, failedStep: null, participants: parts, steps, assertions });
  } finally {
    for (const a of adapters) { const c = (a as { close?: () => Promise<void> }).close; if (typeof c === "function") await c.call(a); }
  }
}

/** Run every scenario of the loaded files (or the named ones), each against fresh participants. */
export async function runScenarios(files: ScenarioFile[], o: RunnerOptions): Promise<RunOutput> {
  const out: RunOutput = { results: [], transcript: [] };
  for (const f of files) for (const s of f.scenarios) {
    if (o.only !== undefined && !o.only.includes(s.id)) continue;
    out.results.push(await runOne(f, s, o, out));
  }
  return out;
}

