// SPDX-License-Identifier: Apache-2.0
// Essential governance, E (docs/02 section 5.1, docs/04 sections 11.4 and 19, decision 39): the authority set and minApprovals an
// adapter declares for its platform. The suite never asserts what E should be. It records E in run.json, labels a declared set of
// one "single-party", and drives the ceremony from E: a `quorum` step of a vector is expanded here into concrete sends from the
// authority set, so the same vector runs at k = 1 and at any larger k.
import type { Capabilities, EssentialGovernance, EssentialSource } from "../adapter/contract.ts";
import type { Actor } from "./build.ts";
import type { Expect, QuorumPattern, Step, Vector } from "../vectors/types.ts";

/** The SKIP reason of a per-declared-E vector when the adapter states no readable E (with GOV-NOT-PROBED in the record). */
export const UNREADABLE = "authority set unreadable";
/** The SKIP reason of a vector that needs two or more approvers when the declared authority set has one member. */
export const SET_OF_ONE = "authority set of one";
/** The SKIP reason of a vector that needs an approval before completion when k is 1 and the set has more members. */
export const K_OF_ONE = "declared minApprovals of one";
/** What a run records when the adapter states nothing. */
export const NOT_STATED = "the adapter states no essential governance (capabilities.governance.essential)";

/** The patterns that measure behaviour relative to the declared E (they SKIP when E is unreadable). */
export const PER_E_PATTERNS: readonly QuorumPattern[] = ["exact", "outsider", "repeat"];

/** E as the harness drives it: the authority set as harness actor names, k, and the outsider the harness uses. */
export interface DrivableE {
  authority: string[];
  k: number;
}

/** E as recorded in run.json for every run (and read by the at-a-glance model). */
export interface EssentialRecord {
  source: EssentialSource;
  /** The authority set as declared (actor tokens or DIDs). Empty when unreadable. */
  authority: string[];
  minApprovals: number | null;
  /** The declared authority set has exactly one member. */
  singleParty: boolean;
  evidence?: string;
  reason?: string;
  /** The advisory governance finding the declaration gives by itself: GOV-FIXED (fixed built-in rule) or GOV-NOT-PROBED (unreadable). */
  finding?: "GOV-FIXED" | "GOV-NOT-PROBED";
}

export type ResolvedE =
  | { readable: true; record: EssentialRecord; drive: DrivableE | null; driveReason?: string }
  | { readable: false; record: EssentialRecord };

/** The two-administrator scenario the registry ceremony vectors used before E was declared; used only where E is unreadable. */
export const LEGACY_SCENARIO: DrivableE = { authority: ["A", "X"], k: 2 };

function unreadable(reason: string, evidence?: string): ResolvedE {
  return { readable: false, record: { source: "unreadable", authority: [], minApprovals: null, singleParty: false, reason, finding: "GOV-NOT-PROBED", ...(evidence === undefined ? {} : { evidence }) } };
}

/** Resolve the declared E of an implementation; `actors` maps harness actor names to identities (for DIDs in `principals`). */
export function resolveEssential(caps: Capabilities, actors?: Record<string, Actor>): ResolvedE {
  const e: EssentialGovernance | undefined = caps.governance?.essential;
  if (e === undefined) return unreadable(NOT_STATED);
  if (e.source === "unreadable") return unreadable(e.reason ?? "no reason given", e.evidence);
  const c = e.consent;
  if (c === undefined || e.principals === undefined) return unreadable(`source ${e.source} but no consent and principals given`, e.evidence);
  const authority = e.principals.filter((p) => p.role === c.approverSet).map((p) => p.vid);
  if (!Number.isInteger(c.minApprovals) || c.minApprovals < 1) return unreadable(`minApprovals ${String(c.minApprovals)} is not an integer of at least 1`, e.evidence);
  if (authority.length === 0) return unreadable(`no principal holds the approver role ${c.approverSet}`, e.evidence);
  if (c.minApprovals > authority.length) return unreadable(`minApprovals ${c.minApprovals} exceeds the authority set of ${authority.length}`, e.evidence);
  const record: EssentialRecord = {
    source: e.source, authority, minApprovals: c.minApprovals, singleParty: authority.length === 1,
    ...(e.evidence === undefined ? {} : { evidence: e.evidence }), ...(e.source === "fixed-rule" ? { finding: "GOV-FIXED" as const } : {}),
  };
  const names: string[] = [];
  for (const vid of authority) {
    const tok = /^\$([A-Z])$/.exec(vid);
    const name = tok !== null ? tok[1]! : Object.values(actors ?? {}).find((a) => a.vid === vid)?.name;
    if (name === undefined || (actors !== undefined && actors[name] === undefined)) return { readable: true, record, drive: null, driveReason: `authority set member ${vid} is not a harness actor` };
    names.push(name);
  }
  return { readable: true, record, drive: { authority: names, k: c.minApprovals } };
}

export const hold = (): Expect => ({ disposition: "next-step", hold: true, noSideEffect: true, state: { effects: 0 }, pointer: { "/threadId": "$id(begin)" } });
export const done = (kind: "begin" | "approve", effects = 1): Expect => ({ disposition: "response", type: `$cerResponse(${kind})`, state: { effects } });
export const begin = (m: string, expect: Expect): Step => ({ send: { template: "ceremony.begin", from: m, ...(m === "A" ? {} : { params: { issuer: `$${m}` } }) }, expect });
export const approve = (m: string, id: string, expect: Expect): Step => ({ send: { template: "ceremony.approve", from: m, params: { id: `$id(${id})`, issuer: `$${m}` } }, expect });

/** Approvals counted by the begin alone: the proposer's, where the implementation declares that a begin is one. */
export const counted = (caps: Capabilities): number => (caps.ceremony?.proposerApproves === true ? 1 : 0);

/** The first harness actor outside the authority set (Q where it is free). */
export function outsiderOf(e: DrivableE, actors: Record<string, Actor>): string | undefined {
  return ["Q", ...Object.keys(actors)].find((n) => !e.authority.includes(n) && actors[n] !== undefined);
}

/** Why a vector's quorum steps cannot run against this implementation, or null. */
export function quorumGate(v: Vector, caps: Capabilities, actors?: Record<string, Actor>): string | null {
  const patterns = v.steps.flatMap((s) => (s.quorum === undefined ? [] : [s.quorum]));
  if (patterns.length === 0) return null;
  const r = resolveEssential(caps, actors);
  const perE = patterns.some((p) => PER_E_PATTERNS.includes(p));
  if (!r.readable) {
    if (perE) return `${UNREADABLE}: ${r.record.reason ?? ""}`;
  } else if (r.drive === null) return `authority set not drivable by the harness: ${r.driveReason ?? ""}`;
  const e = r.readable ? r.drive! : LEGACY_SCENARIO;
  const c0 = counted(caps);
  if (usesToken(v, "EN") && e.authority.length === 1) return SET_OF_ONE;
  // A repeat by the proposer before the deciding approval needs the proposer counted and distinct from the k-th member.
  if (patterns.includes("pending") && usesToken(v, "E1") && e.k < 2) return e.authority.length === 1 ? SET_OF_ONE : `${K_OF_ONE}: no approval precedes the deciding one`;
  if (((patterns.includes("begin") || patterns.includes("pending")) && e.k <= c0) || (patterns.includes("repeat") && e.k < 2)) {
    return e.authority.length === 1 ? SET_OF_ONE : `${K_OF_ONE}: ${patterns.includes("repeat") ? "no approval precedes completion" : "the begin completes the ceremony"}`;
  }
  if ((patterns.includes("outsider") || usesToken(v, "EO")) && actors !== undefined && outsiderOf(e, actors) === undefined) return "no harness actor outside the declared authority set";
  return null;
}

/** The distinct approvals after the begin, up to the k-th: held before it, answered with the response at it. */
function rest(e: DrivableE, c0: number, skipFirst = 0): Step[] {
  const out: Step[] = [];
  const members = e.authority.slice(c0 + skipFirst, e.k);
  members.forEach((m, j) => out.push(approve(m, `app${m}`, c0 + skipFirst + j + 1 === e.k ? done("approve") : hold())));
  return out;
}

/**
 * Member tokens in a step, resolved against the declared E: `$E1` / `from: "E1"` is the first member of the authority set (the
 * proposer, who sends the begin), `$EK` / `"EK"` the k-th (the member whose approval completes the ceremony after a `pending`
 * step), `$EN` / `"EN"` a member other than the k-th and `$EO` / `"EO"` a harness actor outside the set.
 */
function memberTokens(s: Step, tokens: Record<string, string>): Step {
  let j = JSON.stringify(s);
  if (!Object.keys(tokens).some((t) => j.includes(`"${t}"`) || j.includes(`"$${t}"`))) return s;
  for (const [t, name] of Object.entries(tokens)) j = j.split(`"$${t}"`).join(`"$${name}"`);
  const out = JSON.parse(j) as Step;
  const from = out.send?.from;
  if (typeof from === "string" && tokens[from] !== undefined) out.send!.from = tokens[from];
  return out;
}

/** Whether a vector uses a member token (and so needs E, or the fallback scenario, to resolve it). */
const usesToken = (v: Vector, t: string): boolean => JSON.stringify(v.steps).includes(`"${t}"`) || JSON.stringify(v.steps).includes(`"$${t}"`);

/** Expand every `quorum` step of a vector into concrete steps (gate first with `quorumGate`). */
export function expandQuorum(steps: Step[], caps: Capabilities, actors: Record<string, Actor>): Step[] {
  if (!steps.some((s) => s.quorum !== undefined)) return steps;
  const r = resolveEssential(caps, actors);
  const e = r.readable && r.drive !== null ? r.drive : LEGACY_SCENARIO;
  const c0 = counted(caps);
  const m1 = e.authority[0]!;
  const ek = e.authority[e.k - 1]!;
  const tokens: Record<string, string> = { E1: m1, EK: ek, EN: e.authority.find((m) => m !== ek) ?? ek, EO: outsiderOf(e, actors) ?? "Q" };
  const opening = (): Step => begin(m1, e.k <= c0 ? done("begin") : hold());
  const out: Step[] = [];
  for (const s of steps) {
    if (s.quorum === undefined) {
      out.push(memberTokens(s, tokens));
      continue;
    }
    let x: Step[];
    switch (s.quorum) {
      case "begin":
        x = [begin(m1, s.expect ?? hold())];
        break;
      case "rest":
        x = rest(e, c0);
        break;
      case "pending":
        // A ceremony held one approval short of k: the begin and every approval before the k-th, each held. The k-th member (`EK`)
        // decides next (the task-consent family).
        x = [begin(m1, hold()), ...e.authority.slice(c0, e.k - 1).map((m) => approve(m, `app${m}`, hold()))];
        break;
      case "complete":
      case "exact":
        // Exactly at the k-th distinct approval: every earlier one is held with no effect, the k-th is answered with the effect.
        x = [opening(), ...rest(e, c0)];
        break;
      case "outsider": {
        // An approval from outside the authority set is refused and not counted: completion still needs k distinct members.
        const q = outsiderOf(e, actors) ?? "Q";
        const before = e.k <= c0 ? 1 : 0;
        x = [opening(), approve(q, "appOut", { disposition: "any-refusal", noSideEffect: true, state: { effects: before } }), ...rest(e, c0)];
        break;
      }
      case "repeat": {
        // A repeat by the same member (a fresh document) is not counted as another member's approval (k >= 2).
        const first = c0 === 1 ? [] : [approve(m1, `app${m1}`, hold())];
        x = [opening(), ...first, approve(m1, `app${m1}r`, hold()), ...rest(e, c0, c0 === 1 ? 0 : 1)];
        break;
      }
    }
    if (s.at !== undefined && x.length > 0) x[0] = { at: s.at, ...x[0]! };
    out.push(...x);
  }
  return out;
}
