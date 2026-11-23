// SPDX-License-Identifier: Apache-2.0
// Ceremony scenarios, format `tt-ceremony-scenarios/0.1` (docs/25): types, loader and validator. A scenario is data: roles bound to
// participants at run time, steps, the states each participant must read, and the terminal states it allows. Scenario files live in
// vectors/ceremony-scenarios/ with their own manifest (`scenarios-manifest.json`, deliberately not named manifest.json, so no vector
// loader, catalog or count picks them up); the default suite run never reads them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CEREMONY_STATES } from "../adapter/contract.ts";
import type { CeremonyState } from "../adapter/contract.ts";
import { isChannel } from "../vectors/source.ts";
import type { VectorSource } from "../vectors/source.ts";

export const SCENARIO_FORMAT = "tt-ceremony-scenarios/0.1";
export const SCENARIO_MANIFEST_FORMAT = "tt-ceremony-scenarios-manifest/0.1";
export const SCENARIO_MANIFEST = "scenarios-manifest.json";
/** The one evidence kind of this track. It is never a conformance count, never in a headline figure and never in the exit code of the default run. */
export const EVIDENCE_KIND = "complete-ceremony";
export const CARRIER_MODES = ["runner-carried", "live"] as const;
export type CarrierMode = (typeof CARRIER_MODES)[number];
/** The states a scenario may name as its end (the others, `open`, `held` and `unknown`, are readings along the way). */
export const TERMINAL_STATES = ["completed", "declined", "refused", "expired", "aborted"] as const satisfies readonly CeremonyState[];
export type TerminalState = (typeof TERMINAL_STATES)[number];
/** What a run of one scenario came to. None of these is a conformance verdict. */
export const SCENARIO_STATUSES = ["completed", "ended-as-specified", "failed", "inconclusive", "incomplete", "skipped"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];
export const MAX_WITHIN_MS = 60_000;
export const MAX_DEADLINE_MS = 600_000;

export interface ParticipantDecl { role: string; requires: string[] }

/** What one step does. Exactly one member. */
export interface StepDo {
  /** `"all"`: every participant is connected to every other one. */
  connect?: "all";
  /** A human or operator decision injected through the participant's own `trigger` (never a document built by the runner). */
  decide?: { by: string; action: string; args: Record<string, unknown> };
  /** The participant builds and signs the document of `kind` towards `to` (`initiate`); the runner relays it and the answers. `capture` names the thread the result opens. */
  initiate?: { by: string; to: string; kind: string; thread?: string; capture?: string; args?: Record<string, unknown> };
  /**
   * Approvals of a ceremony held under the executor's DECLARED essential governance (group FC-TCA). The runner reads k and the approver set from the
   * executor's declaration (never from the scenario): each not yet counted member of the declared set is asked by the executor (a consent request)
   * and decides (a consent decision), until `upTo` approvals are counted (`repeat`: then the member counted last decides once more): `k-1` (the quorum is one short) or `k`. A begin that counts as the
   * proposer's own approval (as the executor declares) is counted first. Every document is built by a participant.
   */
  /** The documents a participant pushed on its own (the reference's handlers answer an offer, a request or a deferred query by pushing the next task): the runner hands each not yet delivered one addressed to `to` to its recipient, and at least one must exist. */
  relayPushed?: { from: string; to: string; type?: string; /** A sender that does not offer `observe.pushed` has nothing to hand out: the step does nothing (a sender that does, and pushed nothing, still fails it). */ ifOffered?: boolean };
  approve?: { executor: string; upTo: "k-1" | "k"; thread?: string; repeat?: boolean };
  /**
   * Re-send a document a participant already built (docs/26), to the same recipient, unchanged (`same`: a replay), without its proof (`stripProof`), with one payload value altered
   * after signing under a fresh id (`tamper`: only the proof can refuse it) or under the same id (`conflict`). The runner signs nothing; the recipient's answer is read by a `reply` check.
   */
  replay?: { step: string; by: string; to: string; mode: "same" | "stripProof" | "tamper" | "conflict"; /** Which document the step built (continuations included), default the first. */ index?: number };
}
/** Where a scenario takes its governance from: the participant whose declared essential governance fixes k and the approver set, and the slots that stand for the members of that set (in order; the first is the requester). The scenario fixes no role name and no k. */
export interface ScenarioGovernance { from: string; approvers: string[] }

/** `{"$received": ...}` in a step's arguments: a payload member (dotted path) of the newest document of `type` that reached participant `at` on a captured thread (default `thread`). */
export interface ReceivedRef { at: string; type: string; thread?: string; member: string }

/** One check of a participant's own state. `thread` is a captured name (default `thread`). */
export interface Check {
  at?: string;
  thread?: string;
  /** The participant's reading of the thread. */
  ceremony?: CeremonyState;
  /** Documents that reached the participant: `count` is exact, otherwise at least one. `code` matches `/payload/code` of the document. */
  received?: { type?: string; from?: string; count?: number; code?: string };
  /** The participant's stored count of a kind. */
  stored?: { kind: string; count: number };
  /** The recipient's answer to the newest `replay` of this step (`code` may list alternatives joined with `|`; `type` is the answer's type; `status` the transport status). */
  reply?: { code?: string; type?: string; status?: number };
  /** The delivery receipt for the credential `step` issued carries the digest of that credential, on the credential's thread, at the issuer. */
  receiptMatches?: { step: string };
}

export interface ScenarioStep {
  id: string;
  /** The Trust Tasks specification the step's document belongs to, with its pin and hashes (withSource). Absent on a step that sends no document. */
  source?: VectorSource;
  /** Further tasks the step's documents belong to (a step that sends two kinds), each with its pin and hashes. */
  also?: VectorSource[];
  do: StepDo;
  expect?: Check[];
  /** The step (its action and its checks) runs only when participant `at` does (`is` true, the default) or does not (`is` false) offer the optional capability `offers`; otherwise it is not applicable and passes with no effect. Used where a spec lets a participant's own policy pick the path (credential-exchange/query: pre-trusted answered at once, any other deferred). */
  when?: { at: string; offers: string; is?: boolean };
}

export interface Scenario {
  id: string;
  title: string;
  spec: string[];
  /** The primary step's source: it carries the tfRef and the hashes the drift check reads. */
  source: VectorSource;
  participants: Record<string, ParticipantDecl>;
  carrier: { modes: CarrierMode[] };
  deadlineMs: number;
  steps: ScenarioStep[];
  allowedTerminals: TerminalState[];
  completion: { thread: string; assert: Check[] };
  /** Present when k and the approver set come from a participant's declared governance (see `StepDo.approve`). */
  governance?: ScenarioGovernance;
  /** The participants whose reading of the completion thread decides how the scenario ended (default: all). Others are still checked by `completion.assert`. */
  reads?: string[];
}

export interface ScenarioFile {
  format: typeof SCENARIO_FORMAT;
  group: string;
  family: "ceremony-scenarios";
  evidence: typeof EVIDENCE_KIND;
  ceremony: { name: string; channel: string; choreography: string };
  scenarios: Scenario[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Problems with the `$received` markers inside a step's arguments. */
function receivedProblems(v: unknown, path: string, who: Set<string>): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => receivedProblems(x, `${path}[${i}]`, who));
  if (!isObj(v)) return [];
  if (v.$received !== undefined) {
    const r = v.$received;
    return Object.keys(v).length === 1 && isObj(r) && who.has(String(r.at)) && typeof r.type === "string" && typeof r.member === "string" && (r.thread === undefined || typeof r.thread === "string") ? [] : [`${path}.$received: {at (participant), type, member, thread?} and nothing else`];
  }
  return Object.entries(v).flatMap(([k, x]) => receivedProblems(x, `${path}.${k}`, who));
}

function checkProblems(c: unknown, path: string, who: Set<string>, stepIds: Set<string>): string[] {
  if (!isObj(c)) return [`${path}: not an object`];
  const out: string[] = [];
  const kinds = ["ceremony", "received", "stored", "receiptMatches", "reply"].filter((k) => c[k] !== undefined);
  if (kinds.length !== 1) out.push(`${path}: exactly one of ceremony, received, stored, receiptMatches, reply (got ${kinds.join(", ") || "none"})`);
  if (c.at !== undefined && !who.has(String(c.at))) out.push(`${path}.at: ${String(c.at)} is not a participant`);
  if (c.at === undefined && c.receiptMatches === undefined && c.reply === undefined) out.push(`${path}: at is required`);
  if (c.ceremony !== undefined && !(CEREMONY_STATES as readonly string[]).includes(String(c.ceremony))) out.push(`${path}.ceremony: unknown state ${String(c.ceremony)}`);
  if (isObj(c.stored) && (typeof c.stored.kind !== "string" || !Number.isInteger(c.stored.count))) out.push(`${path}.stored: kind and integer count`);
  if (isObj(c.receiptMatches) && !stepIds.has(String(c.receiptMatches.step))) out.push(`${path}.receiptMatches.step: no step ${String(c.receiptMatches.step)}`);
  return out;
}

/** Problems with one parsed scenario file (empty when it is well formed). */
export function validateScenarioFile(f: unknown): string[] {
  if (!isObj(f)) return ["not an object"];
  const out: string[] = [];
  if (f.format !== SCENARIO_FORMAT) out.push(`format must be ${SCENARIO_FORMAT}`);
  if (typeof f.group !== "string" || !/^FC-[A-Z]{3}$/.test(f.group)) out.push("group must be FC-<three capitals>");
  if (f.family !== "ceremony-scenarios") out.push("family must be ceremony-scenarios");
  if (f.evidence !== EVIDENCE_KIND) out.push(`evidence must be ${EVIDENCE_KIND}`);
  if (!isObj(f.ceremony) || typeof f.ceremony.name !== "string" || !isChannel(f.ceremony.channel)) out.push("ceremony: {name, channel (proposed or candidate), choreography}");
  else if (f.ceremony.channel === "registry") out.push("ceremony.channel: a suite choreography is proposed or candidate, never registry (docs/25)");
  if (!Array.isArray(f.scenarios) || f.scenarios.length === 0) return [...out, "scenarios: a non-empty array"];
  const seen = new Set<string>();
  for (const [i, s] of (f.scenarios as unknown[]).entries()) {
    const p = `scenarios[${i}]`;
    if (!isObj(s)) { out.push(`${p}: not an object`); continue; }
    const id = String(s.id);
    if (!/^FC-[A-Z]{3}-\d{3}$/.test(id) || !id.startsWith(`${String(f.group)}-`)) out.push(`${p}.id: <group>-<NNN>, got ${id}`);
    if (seen.has(id)) out.push(`${p}.id: duplicate ${id}`);
    seen.add(id);
    if (typeof s.title !== "string" || s.title === "") out.push(`${p}.title`);
    if (!Array.isArray(s.spec) || s.spec.length === 0) out.push(`${p}.spec: citations`);
    if (!isObj(s.source) || !isChannel(s.source.channel) || (s.source.channel !== "candidate" && !isObj(s.source.tfRef))) out.push(`${p}.source: a VectorSource with tfRef (or channel candidate)`);
    if (!isObj(s.participants) || Object.keys(s.participants).length < 2) { out.push(`${p}.participants: at least two`); continue; }
    const who = new Set(Object.keys(s.participants));
    for (const [n, d] of Object.entries(s.participants)) if (!isObj(d) || typeof d.role !== "string" || !Array.isArray(d.requires)) out.push(`${p}.participants.${n}: {role, requires[]}`);
    if (!isObj(s.carrier) || !Array.isArray(s.carrier.modes) || s.carrier.modes.some((m) => !(CARRIER_MODES as readonly string[]).includes(String(m)))) out.push(`${p}.carrier.modes: ${CARRIER_MODES.join(" / ")}`);
    if (!Number.isInteger(s.deadlineMs) || (s.deadlineMs as number) < 1 || (s.deadlineMs as number) > MAX_DEADLINE_MS) out.push(`${p}.deadlineMs: 1..${MAX_DEADLINE_MS} (nothing waits without a bound)`);
    if (!Array.isArray(s.allowedTerminals) || s.allowedTerminals.length === 0 || s.allowedTerminals.some((t) => !(TERMINAL_STATES as readonly string[]).includes(String(t)))) out.push(`${p}.allowedTerminals: from ${TERMINAL_STATES.join(", ")}`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) { out.push(`${p}.steps: non-empty`); continue; }
    const stepIds = new Set((s.steps as unknown[]).map((x) => (isObj(x) ? String(x.id) : "")));
    if (stepIds.size !== s.steps.length) out.push(`${p}.steps: ids must be unique`);
    for (const [j, st] of (s.steps as unknown[]).entries()) {
      const sp = `${p}.steps[${j}]`;
      if (!isObj(st) || !isObj(st.do)) { out.push(`${sp}: {id, do}`); continue; }
      const dos = ["connect", "decide", "initiate", "approve", "relayPushed", "replay"].filter((k) => (st.do as Record<string, unknown>)[k] !== undefined);
      if (dos.length !== 1) out.push(`${sp}.do: exactly one of connect, decide, initiate, approve, relayPushed, replay`);
      const d = st.do as { connect?: unknown; decide?: Record<string, unknown>; initiate?: Record<string, unknown> };
      out.push(...receivedProblems((d.decide?.args ?? d.initiate?.args), `${sp}.do.args`, who));
      if (d.connect !== undefined && d.connect !== "all") out.push(`${sp}.do.connect: "all"`);
      if (d.decide !== undefined && (!who.has(String(d.decide.by)) || typeof d.decide.action !== "string")) out.push(`${sp}.do.decide: {by (participant), action, args}`);
      if (d.initiate !== undefined) {
        if (!who.has(String(d.initiate.by)) || !who.has(String(d.initiate.to)) || d.initiate.by === d.initiate.to) out.push(`${sp}.do.initiate: by and to are two participants`);
        if (typeof d.initiate.kind !== "string") out.push(`${sp}.do.initiate.kind`);
        if (!isObj(st.source)) out.push(`${sp}.source: a step that sends a document cites its task (source with tfRef and hashes)`);
      }
      const rp = (st.do as { relayPushed?: Record<string, unknown> }).relayPushed;
      if (rp !== undefined) {
        if (!who.has(String(rp.from)) || !who.has(String(rp.to)) || rp.from === rp.to) out.push(`${sp}.do.relayPushed: from and to are two participants`);
        if (!isObj(st.source)) out.push(`${sp}.source: a step that sends a document cites its task (source with tfRef and hashes)`);
      }
      const rpl = (st.do as { replay?: Record<string, unknown> }).replay;
      if (rpl !== undefined) {
        if (!stepIds.has(String(rpl.step)) || !who.has(String(rpl.by)) || !who.has(String(rpl.to)) || rpl.by === rpl.to) out.push(`${sp}.do.replay: {step (an earlier step), by and to (two participants), mode}`);
        if (!["same", "stripProof", "tamper", "conflict"].includes(String(rpl.mode))) out.push(`${sp}.do.replay.mode: same, stripProof, tamper or conflict`);
        if (!isObj(st.source)) out.push(`${sp}.source: a step that sends a document cites its task (source with tfRef and hashes)`);
      }
      const ap = (st.do as { approve?: Record<string, unknown> }).approve;
      if (ap !== undefined) {
        if (!who.has(String(ap.executor)) || (ap.upTo !== "k-1" && ap.upTo !== "k")) out.push(`${sp}.do.approve: {executor (participant), upTo "k-1" or "k"}`);
        if (!isObj(s.governance)) out.push(`${sp}.do.approve: the scenario declares no governance (k and the approver set come from a participant's declaration)`);
        if (!isObj(st.source)) out.push(`${sp}.source: a step that sends a document cites its task (source with tfRef and hashes)`);
      }
      for (const [k, c] of (Array.isArray(st.expect) ? st.expect : []).entries()) out.push(...checkProblems(c, `${sp}.expect[${k}]`, who, stepIds));
    }
    if (s.governance !== undefined && (!isObj(s.governance) || !who.has(String(s.governance.from)) || !Array.isArray(s.governance.approvers) || s.governance.approvers.length === 0 || s.governance.approvers.some((a) => !who.has(String(a))))) out.push(`${p}.governance: {from (participant), approvers[] (participants)}`);
    if (s.reads !== undefined && (!Array.isArray(s.reads) || s.reads.length === 0 || s.reads.some((a) => !who.has(String(a))))) out.push(`${p}.reads: participants`);
    if (!isObj(s.completion) || typeof s.completion.thread !== "string" || !Array.isArray(s.completion.assert)) out.push(`${p}.completion: {thread, assert[]}`);
    else for (const [k, c] of (s.completion.assert as unknown[]).entries()) out.push(...checkProblems(c, `${p}.completion.assert[${k}]`, who, stepIds));
  }
  return out;
}

export interface LoadedScenarios { dir: string; files: { path: string; file: ScenarioFile }[] }
export class ScenarioLoadError extends Error {}

/** Load and validate every file in `<dir>/scenarios-manifest.json`. Throws ScenarioLoadError on any problem. */
export function loadScenarios(dir: string): LoadedScenarios {
  const mp = join(dir, SCENARIO_MANIFEST);
  if (!existsSync(mp)) throw new ScenarioLoadError(`no ${SCENARIO_MANIFEST} in ${dir}`);
  const m = JSON.parse(readFileSync(mp, "utf8")) as { format?: string; files?: string[] };
  if (m.format !== SCENARIO_MANIFEST_FORMAT || !Array.isArray(m.files)) throw new ScenarioLoadError(`${mp}: format ${SCENARIO_MANIFEST_FORMAT} with files[]`);
  const files = m.files.map((rel) => {
    const path = join(dir, rel);
    const file = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const problems = validateScenarioFile(file);
    if (problems.length > 0) throw new ScenarioLoadError(`${path}:\n  ${problems.join("\n  ")}`);
    return { path, file: file as ScenarioFile };
  });
  return { dir, files };
}
