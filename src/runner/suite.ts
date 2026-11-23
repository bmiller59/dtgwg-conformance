// SPDX-License-Identifier: Apache-2.0
// Suite orchestration: capability gating, tier selection, exceptions (KNOWN-FAIL) and results.
import { randomBytes } from "node:crypto";
import { notOfferedEvidence, notOfferedReason } from "../adapter/contract.ts";
import type { AcceptanceWindow, Adapter, Capabilities } from "../adapter/contract.ts";
import { discoveryTypeOf } from "./build.ts";
import { clockGate } from "./clock.ts";
import { vectorEffect } from "../vectors/effects.ts";
import { effectiveWindow, PROFILE_WINDOW, windowDifferences } from "./window.ts";
import { ReferenceAdapter } from "../adapters/reference/reference.ts";
import type { LoadedSuite } from "../vectors/load.ts";
import { ADVISORY_CHANNELS, DEFAULT_CHANNELS, detectDrift } from "../vectors/source.ts";
import type { Channel, DigestRoots, DriftFinding } from "../vectors/source.ts";
import { receiptExpectsComplete } from "../vectors/validate.ts";
import { acknowledgementText } from "../vectors/types.ts";
import type { ExceptionEntry, Subgroup, Tier, Vector } from "../vectors/types.ts";
import { makeActors, runVector } from "./engine.ts";
import type { Actor } from "./build.ts";
import { quorumGate } from "./essential.ts";
import { probeEssential } from "./honesty.ts";
import type { EssentialProbe } from "./honesty.ts";
import type { EngineEnv } from "./engine.ts";
import { minimumQuiet } from "./quiet.ts";
import type { QuietPeriod } from "./quiet.ts";
import { quarantineFor } from "./quarantine.ts";
import type { QuarantineEntry } from "./quarantine.ts";
import { SPEC_CHANGED_TEXT } from "../vectors/spec-flags.ts";
import type { SpecFlag } from "../vectors/spec-flags.ts";

export const STATUSES = ["PASS", "FAIL", "SKIP", "KNOWN-FAIL", "CLARIFY", "QUARANTINED", "SPEC-CHANGED", "SKIPPED-SAFETY"] as const;
export type Status = (typeof STATUSES)[number];
/** The statuses a count or roll-up covers: QUARANTINED (a flaky vector, docs/04 section 18.9) and SPEC-CHANGED (the cited spec moved and the vector has not been re-checked, docs/23) are advisory and listed apart. */
export type CountedStatus = Exclude<Status, "QUARANTINED" | "SPEC-CHANGED" | "SKIPPED-SAFETY">;

/** Environment variable that names a disposable deployment: the opt-in to run vectors whose `effect` is mutating or destructive. */
export const ALLOW_EFFECTS_ENV = "CONFORMANCE_DISPOSABLE_DEPLOYMENT";
/** Whether a vector would change a deployment's state (its `effect` is mutating or destructive). */
export const changesState = (v: Pick<Vector, "effect">): boolean => v.effect === "mutating" || v.effect === "destructive";
export const SAFETY_SKIP_TEXT = "skipped for safety: the vector changes deployment state and no disposable deployment is named (--allow-effects <name> or CONFORMANCE_DISPOSABLE_DEPLOYMENT); not run, neither pass nor fail";

export interface VectorResult {
  id: string;
  group: string;
  family: string;
  tier: Tier;
  /** The Tier 2 sub-group (absent on Tier 1 vectors). */
  subgroup?: Subgroup;
  status: Status;
  /** The vector's spec-maturity channel (docs/04 section 18). Absent means registry. Results of `pr` and `proposed` are advisory: never gating, never in a headline total. */
  channel?: Channel;
  reason?: string;
  failures?: string[];
  /** SHOULD mismatches observed (docs/04 section 3.2): reported, never a failure at Tier 1, never hidden. */
  advisories?: string[];
  /**
   * Advisory channels only (never a registry row): the error code each error step of a passing vector observed, where the vector accepts
   * `permissionDenied` beside the task's own code. Informational: no count uses it.
   */
  observedCodes?: string[];
  /** With `observedCodes`: every such step passed on `permissionDenied` alone, so only an authorisation gate answered first and the stated rule was not shown to hold. */
  acceptedOnlyGate?: true;
  /** A positive vector (not CLARIFY; some step expects an accepted response): the matrix shows a group green only when these pass. */
  anchor?: true;
  /** The vector's carrier task type is a suite stand-in, not a Trust Tasks task: reports do not count it as a tested task. */
  synthetic?: true;
  /** On a SKIP from a cited `notOffered` entry only: its evidence. Such a SKIP is "not applicable"; any other SKIP is not (docs/04 section 8). */
  evidence?: string;
}

/** The rule by which a run's SKIPs are "not applicable" (recorded on every run since it applies): only from a cited `notOffered` entry. */
export const NOT_APPLICABLE_RULE = "cited-notOffered";

/** One vector left out because of the selected tier, with the reason and its channel. */
export interface TierExclusion { id: string; reason: string; channel: Channel }

/** Whether a gate reason is a tier selection (recorded under `excludedByTier`, never SKIP). */
export const isTierExclusion = (reason: string): boolean => /^(tier [0-9] not selected|only runs at tier [0-9])$/.test(reason);

export interface SuiteRun {
  impl: string;
  /** Key under which runs of the same implementation in different modes are merged into one matrix row. */
  implementation?: string;
  tier: Tier;
  results: VectorResult[];
  /** The window the run measured against (declared, or given to the runner, else the profile pins). */
  window?: AcceptanceWindow;
  /** Members of that window that differ from the profile pins; empty when none. A difference, not a failure. */
  windowDifference?: string[];
  /** `set`: the harness set the clock; `rebase`: it could not (or `rebase` was forced) and real time was the clock start. */
  clockMode?: "set" | "rebase";
  /** The run salt that went into every deterministic document id (empty: unsalted). */
  salt?: string;
  /** The channels this run selected (default registry). Vectors of other channels were not run and are not in `results`. */
  channels?: Channel[];
  /** Vectors excluded from every run (`excludedFromRun` on the vector, for example because the cited TF spec is retired): never run, counted or reported as SKIP. id -> reason. */
  excludedFromRun?: Record<string, string>;
  /** Retired vector ids (docs/04 section 20.3), kept in the files as tombstones: never run, counted or reported as SKIP. id -> "retired in <version>: <reason>". */
  retired?: Record<string, string>;
  /** Vectors left out because their channel was not selected: reported as "excluded by channel", never as SKIP. */
  excludedByChannel?: Record<Channel, string[]>;
  /**
   * Vectors outside the selected tier (a Tier 2 vector in a Tier 1 run, `tier 2 not selected`; an `exactTier` vector at the other tier,
   * `only runs at tier N`): never run, counted or reported as SKIP (docs/04 section 8). Absent on runs recorded before the split, whose
   * results hold them as SKIP with those reasons.
   */
  excludedByTier?: TierExclusion[];
  /** `spec-drift` advisory findings: a vector's pinned source digest differs from the source available now, or the source is missing. Needs human review; never a failure. */
  drift?: DriftFinding[];
  /**
   * The adapter honesty check (src/runner/honesty.ts): the declared essential governance probed against behaviour. A `mismatch` fails
   * every result that rests on the declaration (`DECLARATION_MISMATCH_REASON`) and the exit code, whatever the channels.
   */
  essentialProbe?: EssentialProbe;
  /** The minimum quiet period no-reply verdicts were held to (docs/04 section 3.3). Absent on runs recorded before the rule. */
  quietPeriod?: QuietPeriod;
  /** `cited-notOffered`: a SKIP is not applicable only when it carries `evidence` (docs/04 section 8). Absent on runs recorded before the rule. */
  notApplicableRule?: typeof NOT_APPLICABLE_RULE;
}

/** The reason prefix of a result made FAIL because the declared essential governance does not match behaviour. */
export const DECLARATION_MISMATCH_REASON = "GOV-DECLARATION-MISMATCH: the declared essential governance does not match the behaviour the harness observed";

/** The reason prefix of a result made FAIL because the failure differs from the one its exception excuses (`expectFailure`). */
export const EXPECT_FAILURE_MISMATCH = "KNOWN-FAIL exception does not match the observed failure";

/**
 * Whether an exception entry applies to a row: keyed on the row's implementation name, or on the platform the row declares unless the
 * entry's `notOn` names the row (a surface whose path does not carry the difference).
 */
export function exceptionApplies(x: Pick<ExceptionEntry, "impl" | "notOn">, caps: Pick<Capabilities, "name" | "platform">): boolean {
  if (x.impl === caps.name) return true;
  return caps.platform !== undefined && x.impl === caps.platform && !(x.notOn !== undefined && Object.hasOwn(x.notOn, caps.name));
}

/** The `expectFailure` patterns of an exception that no failure line matches (empty: the failure is the excused one, or none is stated). */
export function unmatchedExpectations(exc: ExceptionEntry, failures: readonly string[]): string[] {
  return (exc.expectFailure?.failures ?? []).filter((p) => { const re = new RegExp(p); return !failures.some((f) => re.test(f)); });
}

/** Whether a channel's results are advisory (`pr`, `proposed`). */
export const isAdvisoryChannel = (c: Channel | undefined): boolean => c !== undefined && ADVISORY_CHANNELS.includes(c);
/** The channel of a vector (a vector with no `source` is registry; the loader refuses such a vector, so this is for hand-built ones). */
export const channelOf = (v: Vector): Channel => v.source?.channel ?? "registry";

/** A named profile sub-group: selected by running Tier 2, and measured whether or not the implementation claims `attested`. */
export function isProfile(v: Vector): boolean {
  return v.subgroup !== undefined && v.subgroup.startsWith("profile-");
}

export function isAnchor(v: Vector): boolean {
  return v.clarify === null && v.steps.some((s) => s.expect?.disposition === "response" || (s.verifyReceipt !== undefined && receiptExpectsComplete(s.verifyReceipt.expect.outcome)) || (s.expect?.state?.storedCredential ?? 0) > 0 || (s.expect?.state?.storedPresentation ?? 0) > 0);
}

export interface GateContext {
  /** The harness cannot set the clock (rebase mode). */
  clockless?: boolean;
  window?: AcceptanceWindow;
  /** The harness actors (default `makeActors()`), for resolving the declared essential governance. */
  actors?: Record<string, Actor>;
}

/** Whether one `requires` entry is met by the declared capabilities (the `notOffered` note applies only to an unmet one). */
function gateMet(req: string, caps: Capabilities): boolean {
  if (req.startsWith("carrier:")) return caps.carriers.some((c) => c.class === req.slice(8));
  if (req.startsWith("optional:")) return caps.optional.includes(req.slice(9));
  if (req.startsWith("emit:")) return (caps.emits ?? []).includes(req.slice(5));
  if (req.startsWith("window:")) return caps.window !== undefined;
  return caps.supportedTypes.includes(req) || (caps.unlistedTypes ?? []).includes(req) || caps.carriers.some((c) => c.typeUri === req);
}

/** Why a vector is not run for an implementation, or null when it applies. */
export function gateReason(v: Vector, caps: Capabilities, selected: Tier, ctx: GateContext = {}): string | null {
  return gateDecision(v, caps, selected, ctx)?.reason ?? null;
}

/**
 * Why a vector is not run, with the evidence when the gate is a cited `notOffered` entry: the only SKIP that is "not applicable"
 * (docs/04 section 8). Every other gate (an undeclared type or capability, an uncited `notOffered` entry, the clock, the window, E) has no
 * evidence and is "not reached" unless a reader classes it otherwise from a checked fact.
 */
export function gateDecision(v: Vector, caps: Capabilities, selected: Tier, ctx: GateContext = {}): { reason: string; evidence?: string } | null {
  const r = gateCore(v, caps, selected, ctx);
  return r === null ? null : typeof r === "string" ? { reason: r } : r;
}

function gateCore(v: Vector, caps: Capabilities, selected: Tier, ctx: GateContext): string | { reason: string; evidence?: string } | null {
  if (v.exactTier === true && v.tier !== selected) return `only runs at tier ${v.tier}`;
  if (v.tier > selected) return `tier ${v.tier} not selected`;
  if (v.tier > caps.tierMax && !isProfile(v)) return `implementation claims tier ${caps.tierMax}`;
  for (const o of v.skipIfOptional ?? []) if (caps.optional.includes(o)) return `implementation declares optional ${o}`;
  for (const req of v.requires ?? []) {
    const refused = caps.notOffered?.[req];
    if (refused !== undefined && !gateMet(req, caps)) {
      const evidence = notOfferedEvidence(refused);
      return { reason: `not offered by the implementation: ${notOfferedReason(refused)} (${req})`, ...(evidence === undefined ? {} : { evidence }) };
    }
    if (req.startsWith("carrier:")) {
      if (!caps.carriers.some((c) => c.class === req.slice(8))) return `missing capability ${req}`;
    } else if (req.startsWith("optional:")) {
      if (!caps.optional.includes(req.slice(9))) return req.startsWith("optional:governance.") ? `governance not declared (${req})` : `missing capability ${req}`;
    } else if (req.startsWith("emit:")) {
      if (!caps.optional.includes("emit")) return "missing capability optional:emit";
      if (!(caps.emits ?? []).includes(req.slice(5))) return `type not emitted: ${req.slice(5)}`;
    } else if (req === "window:declared") {
      // a maximum age is consumer policy (SPEC.md:1014, :1023): a vector that crosses it needs the window the implementation declares or the runner is given, never the profile pin
      if (caps.window === undefined && ctx.window === undefined) return "window not declared: the vector crosses the implementation's maximum age, which the framework text does not set";
    } else if (req.startsWith("binding:")) {
      if (!caps.bindings.includes(req.slice(8))) return `missing capability ${req}`;
    } else if (req.startsWith("cryptosuite:")) {
      if (!caps.cryptosuites.includes(req.slice(12))) return `missing capability ${req}`;
    } else if (req === "discovery") {
      if (discoveryTypeOf(caps.supportedTypes) === undefined) return "type not declared: trust-task-discovery (0.4 or 0.3)";
    } else if (!caps.supportedTypes.includes(req) && !(caps.unlistedTypes ?? []).includes(req) && !caps.carriers.some((c) => c.typeUri === req)) {
      return `type not declared: ${req}`;
    }
  }
  const q = quorumGate(v, caps, ctx.actors ?? makeActors());
  if (q !== null) return q;
  if (v.profileWindow === true) {
    const diff = windowDifferences(ctx.window ?? effectiveWindow(caps));
    if (diff.length > 0) return `window difference: the row pins the profile window and the implementation's is ${diff.join(", ")}`;
  }
  if (ctx.clockless === true) {
    const g = clockGate(v);
    if (g !== null) return `clock not settable (rebase mode): ${g}`;
  }
  return null;
}

export interface RunOptions {
  adapter: Adapter;
  suite: LoadedSuite;
  tier: Tier;
  exceptions?: ExceptionEntry[];
  /** Quarantined flaky vectors (src/runner/quarantine.ts): recorded as QUARANTINED while current, FAIL once expired. */
  quarantine?: QuarantineEntry[];
  /** Vectors flagged by the spec-drift check (vectors-src/spec-flags.json): recorded as SPEC-CHANGED, advisory, in no count and never in the exit code. */
  specFlags?: Record<string, SpecFlag>;
  /** YYYY-MM-DD used to judge exception and quarantine expiry. */
  today: string;
  fixtureRoot: string;
  /** A window given to the runner; overrides the adapter's declared window. */
  window?: Partial<AcceptanceWindow>;
  /** Force rebase mode even for an adapter that can set its clock. */
  rebase?: boolean;
  /** Run salt (docs/04 section 7). Default: random per run. Give one to reproduce a run; `""` leaves ids unsalted. */
  salt?: string;
  /** Channels to run (default registry only). Vectors of other channels are excluded, not skipped. */
  channels?: readonly Channel[];
  /** Where to find the sources the vectors pin; when given, spec-drift is checked. */
  drift?: DigestRoots;
  /** Real-time wait used by rebase mode for literal small offsets (default: a timer; tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Name of a disposable deployment (a throwaway instance whose state may be changed). Without it a vector whose `effect` is mutating or destructive is not run: SKIPPED-SAFETY. */
  allowEffects?: string;
  /**
   * Derive the effect of a vector that has no `effect` tag from the tasks it sends to (src/vectors/effects.ts, vectors-src/task-effects.json). The command line sets it;
   * a library call that does not ask for it sees only the tags (S-06, D780). Why the library default is not "derive": about 80 call sites run every set against the
   * in-process reference oracle, a disposable adapter that is never a deployment, and they must run the mutating and destructive vectors; the gate protects a real
   * deployment, and the only path to one is the command line, which always derives. A library caller that drives a real deployment must pass `deriveEffects: true` itself.
   * Limit of the derivation: a step that names no Type URI (a template step: `$carrier`, the ceremony and witness templates) is not judged, so a vector whose only
   * sends are template steps keeps its tag (or none); a negative step to a mutating task is not gated, because a refusal changes nothing.
   */
  deriveEffects?: boolean;
  /** Minimum quiet period for no-reply verdicts, overriding the binding rule (`--min-quiet-ms`; docs/04 section 3.3). */
  minQuietMs?: number;
}

export function newSalt(): string {
  return randomBytes(6).toString("hex");
}

export async function runSuite(opts: RunOptions): Promise<SuiteRun> {
  const caps = await opts.adapter.capabilities();
  const provisioned = await opts.adapter.provision(["iut"]);
  const iut = provisioned.iut;
  if (iut === undefined) throw new Error("adapter did not provision role iut");
  if (caps.ceremony !== undefined) {
    if (typeof caps.ceremony.proposerApproves !== "boolean") throw new Error("capabilities.ceremony.proposerApproves must be declared (true or false; docs/04 section 11.4)");
    if (caps.optional.includes("ceremony.status") !== (caps.ceremony.statusType !== undefined)) throw new Error("the optional capability ceremony.status and capabilities.ceremony.statusType must be declared together");
    if (caps.ceremony.statusType !== undefined && caps.ceremony.statusPayload === undefined) throw new Error("capabilities.ceremony.statusPayload is required with statusType");
  }
  const settable = caps.optional.includes("clock");
  if (settable === caps.optional.includes("clockFree")) throw new Error("capabilities.optional must declare exactly one of clock (the harness can set the clock) and clockFree (it cannot; docs/04 section 7)");
  const clockless = !settable || opts.rebase === true;
  const window = effectiveWindow(caps, opts.window);
  const salt = opts.salt ?? newSalt();
  const results: VectorResult[] = [];
  const channels = [...(opts.channels ?? DEFAULT_CHANNELS)];
  const excludedByChannel: Record<Channel, string[]> = { registry: [], pr: [], proposed: [], candidate: [] };
  const excludedFromRun: Record<string, string> = {};
  const excludedByTier: TierExclusion[] = [];
  const retired: Record<string, string> = {};
  const included: { id: string; source: NonNullable<Vector["source"]> }[] = [];
  const actors = makeActors();
  const quiet = minimumQuiet(caps, opts.minQuietMs);
  // The honesty check runs before any vector, independent of the selected vectors and channels (src/runner/honesty.ts).
  const probeClock = opts.suite.files.find((f) => f.file.group === "CER")?.file.clock.start ?? opts.suite.files[0]?.file.clock.start ?? "2026-11-12T10:00:00Z";
  const essentialProbe = await probeEssential(opts.adapter, caps, {
    caps, iutVid: iut.vid, ...(iut.didDocument === undefined ? {} : { iutDidDocument: iut.didDocument }), actors, tier: opts.tier,
    fixtureRoot: opts.fixtureRoot, defaultClockStart: probeClock, window, clockless, salt, quiet, ...(opts.sleep === undefined ? {} : { sleep: opts.sleep }),
  }, actors);
  /** Results that rest on the declared E: every vector with a quorum step, except a SKIP for a reason other than E. */
  const restsOnE = new Set<VectorResult>();
  for (const { file } of opts.suite.files) {
    const env: EngineEnv = {
      caps, iutVid: iut.vid, ...(iut.didDocument === undefined ? {} : { iutDidDocument: iut.didDocument }), actors: makeActors(), tier: opts.tier,
      fixtureRoot: opts.fixtureRoot, defaultClockStart: file.clock.start, window, clockless, salt, quiet, ...(opts.sleep === undefined ? {} : { sleep: opts.sleep }),
    };
    for (const v of file.vectors) {
      if (v.retired !== undefined) {
        retired[v.id] = `retired in ${v.retired.since}: ${v.retired.reason}`;
        continue;
      }
      if (v.excludedFromRun !== undefined) {
        excludedFromRun[v.id] = v.excludedFromRun.reason;
        continue;
      }
      const channel = channelOf(v);
      if (!channels.includes(channel)) {
        excludedByChannel[channel].push(v.id);
        continue;
      }
      if (v.source !== undefined) included.push({ id: v.id, source: v.source });
      const base: { id: string; group: string; family: string; tier: Tier; channel: Channel; synthetic?: true; subgroup?: Subgroup; anchor?: true; advisories?: string[]; observedCodes?: string[]; acceptedOnlyGate?: true } = { id: v.id, group: file.group, family: file.family, tier: v.tier, channel, ...(v.synthetic === true ? { synthetic: true as const } : {}), ...(v.subgroup === undefined ? {} : { subgroup: v.subgroup }), ...(isAnchor(v) ? { anchor: true as const } : {}) };
      const gate = gateDecision(v, caps, opts.tier, { clockless, window });
      const eDriven = v.steps.some((s) => s.quorum !== undefined);
      if (gate !== null && isTierExclusion(gate.reason)) {
        excludedByTier.push({ id: v.id, reason: gate.reason, channel });
        continue;
      }
      if (gate !== null) {
        results.push({ ...base, status: "SKIP", reason: gate.reason, ...(gate.evidence === undefined ? {} : { evidence: gate.evidence }) });
        if (eDriven && gate.reason === quorumGate(v, caps, actors)) restsOnE.add(results[results.length - 1]!);
        continue;
      }
      // R-05: a vector with no `effect` tag takes the effect of the tasks it sends to (vectors-src/task-effects.json), so the gate covers every set
      const effect = opts.deriveEffects === true ? vectorEffect(v) : v.effect;
      if (changesState({ effect }) && (opts.allowEffects === undefined || opts.allowEffects === "")) {
        results.push({ ...base, status: "SKIPPED-SAFETY", reason: `${SAFETY_SKIP_TEXT} (effect ${effect}${v.effect === undefined ? ", derived from the task" : ""})` });
        continue;
      }
      const outcome = await runVector(opts.adapter, v, env);
      if (outcome.advisories.length > 0) base.advisories = outcome.advisories;
      if (channel !== "registry" && outcome.pass && outcome.observedCodes !== undefined) {
        base.observedCodes = outcome.observedCodes;
        if (outcome.acceptedOnlyGate === true) base.acceptedOnlyGate = true;
      }
      const flag = (opts.specFlags ?? {})[v.id];
      if (flag !== undefined) {
        const seen = v.clarify !== null ? "CLARIFY" : outcome.pass ? "pass" : "fail";
        results.push({ ...base, status: "SPEC-CHANGED", reason: `${SPEC_CHANGED_TEXT} (cited text changed, detected ${flag.detectedOn} against Trust Tasks ${flag.tfCommit.slice(0, 9)}); observed ${seen} in this run`, failures: outcome.failures });
        continue;
      }
      const q = quarantineFor(opts.quarantine ?? [], v.id, [caps.name, ...(caps.platform === undefined ? [] : [caps.platform])], opts.tier);
      const observed = v.clarify !== null ? "CLARIFY" : outcome.pass ? "pass" : "fail";
      if (q !== undefined && q.expires < opts.today) {
        results.push({ ...base, status: "FAIL", reason: `quarantine expired on ${q.expires} (owner ${q.owner}): fix the cause, renew the entry with a fresh observation, or remove it; observed ${observed}. ${q.reason}`, failures: outcome.failures });
        if (eDriven && v.clarify === null) restsOnE.add(results[results.length - 1]!);
        continue;
      }
      if (q !== undefined) {
        results.push({ ...base, status: "QUARANTINED", reason: `quarantined as flaky (owner ${q.owner}, expires ${q.expires}; observed on ${q.observedOn.join(", ")}): ${q.reason}; observed ${observed} in this run`, failures: outcome.failures });
        continue;
      }
      const exc = (opts.exceptions ?? []).find((x) => exceptionApplies(x, caps) && x.vector === v.id && (x.tier === undefined || x.tier === opts.tier));
      if (v.clarify !== null) {
        results.push({ ...base, status: "CLARIFY", reason: `${v.clarify} (observed: ${outcome.pass ? "pass" : "fail"})`, failures: outcome.failures });
      } else if (exc !== undefined && exc.expires < opts.today) {
        results.push({ ...base, status: "FAIL", reason: `exception expired on ${exc.expires} (owner ${exc.owner}): ${exc.reason}`, failures: outcome.failures });
      } else if (exc !== undefined) {
        const missed = outcome.pass ? [] : unmatchedExpectations(exc, outcome.failures);
        results.push(
          outcome.pass
            ? { ...base, status: "FAIL", reason: `KNOWN-FAIL exception is stale: the vector now passes; delete the exception (owner ${exc.owner})${exc.inherited === undefined ? "" : `; it was inherited (${exc.inherited})`}` }
            : missed.length > 0
              ? { ...base, status: "FAIL", reason: `${EXPECT_FAILURE_MISMATCH}: no failure line matches ${missed.map((p) => `/${p}/`).join(", ")}; review the entry (owner ${exc.owner}). Excused failure: ${exc.reason}`, failures: outcome.failures }
              : { ...base, status: "KNOWN-FAIL", reason: `${exc.reason} (owner ${exc.owner}, expires ${exc.expires}, ${acknowledgementText(exc.acknowledged)}${exc.inherited === undefined ? "" : `; inherited, not yet recorded on this surface: ${exc.inherited}`})`, failures: outcome.failures },
        );
      } else {
        results.push(outcome.pass ? { ...base, status: "PASS" } : { ...base, status: "FAIL", failures: outcome.failures });
      }
      if (eDriven && v.clarify === null) restsOnE.add(results[results.length - 1]!);
    }
  }
  if (essentialProbe.result === "mismatch") {
    const observed = essentialProbe.checks.filter((c) => c.result === "mismatch").map((c) => c.observed).join("; ");
    for (const x of restsOnE) {
      x.reason = `${DECLARATION_MISMATCH_REASON} (${observed})${x.reason === undefined ? "" : `; was ${x.status}: ${x.reason}`}`;
      x.status = "FAIL";
    }
  }
  return { impl: caps.name, implementation: caps.implementation ?? caps.name, tier: opts.tier, results, window, windowDifference: windowDifferences(window), clockMode: clockless ? "rebase" : "set", salt, channels, excludedByChannel, excludedByTier, ...(Object.keys(excludedFromRun).length > 0 ? { excludedFromRun } : {}), ...(Object.keys(retired).length > 0 ? { retired } : {}), ...(opts.drift === undefined ? {} : { drift: detectDrift(included, opts.drift) }), essentialProbe, quietPeriod: quiet, notApplicableRule: NOT_APPLICABLE_RULE };
}

/**
 * Non-zero for a FAIL in a gating (registry) vector, and for a declaration mismatch of the honesty check whatever the channels: `pr`,
 * `proposed` and `candidate` results are otherwise advisory and never change the exit code.
 */
export function exitCode(runs: SuiteRun[]): number {
  return runs.some((r) => r.essentialProbe?.result === "mismatch" || r.results.some((x) => x.status === "FAIL" && !isAdvisoryChannel(x.channel))) ? 1 : 0;
}

export interface NonVacuityRow {
  vector: string;
  mutant: string;
  /** Which reference configuration the mutant was applied to (see `NON_VACUITY_CONFIGS`). */
  config: string;
  /** True when the vector failed against the mutant (the required outcome), or, for an advisory mutant, the vector recorded an advisory (or failed). */
  caught: boolean;
  /** How it was caught: `failure` (a Tier 1 or attested assertion) or `advisory` (a SHOULD the vector observes, docs/04 section 3.2). */
  by: "failure" | "advisory";
}

/**
 * The reference configurations a mutant is applied to. Ceremony vectors depend on two declared properties (docs/04 section 11.4):
 * every vector that is not status-only runs against each `proposerApproves` value, and the vectors that need a status task
 * (`requires` `optional:ceremony.status`) run against the status variant in both values. Mutants of other groups are indifferent to the
 * ceremony options, so for them the two runs are the same measurement and one is kept.
 */
export const NON_VACUITY_CONFIGS = [
  { name: "proposer-approves", options: { proposerApproves: true }, status: false },
  { name: "proposer-cosigns", options: { proposerApproves: false }, status: false },
  { name: "status-proposer-approves", options: { proposerApproves: true, ceremonyStatus: true }, status: true },
  { name: "status-proposer-cosigns", options: { proposerApproves: false, ceremonyStatus: true }, status: true },
] as const;

/** Run every negative vector against each mutant it names; the mutant must make it fail. */
export async function checkNonVacuity(suite: LoadedSuite, fixtureRoot: string): Promise<NonVacuityRow[]> {
  const rows: NonVacuityRow[] = [];
  for (const { file } of suite.files) {
    for (const v of file.vectors) {
      const ceremonyVector = (v.requires ?? []).includes("optional:ceremony");
      const needsStatus = (v.requires ?? []).includes("optional:ceremony.status");
      for (const [mutant, by] of [...(v.mutants ?? []).map((m) => [m, "failure"] as const), ...(v.advisoryMutants ?? []).map((m) => [m, "advisory"] as const)]) {
        // a profile sub-group is measured against a server that does not claim `attested`; the attested sub-group needs one that does
        const attested = v.tier === 2 && !isProfile(v);
        for (const cfg of NON_VACUITY_CONFIGS) {
          if (cfg.status !== needsStatus) continue;
          if (!ceremonyVector && cfg.options.proposerApproves === false) continue;
          const adapter = new ReferenceAdapter({ attested, mutants: [mutant], ...(mutant === "qryRefusalDiscriminates" ? { queryUniformRefusal: true } : {}), ...((v.requires ?? []).includes("binding:didcomm") ? { witness: true, vrc: false, ceremony: false, dtg: false, plain: false } : {}), ...cfg.options });
          const caps = await adapter.capabilities();
          const iut = (await adapter.provision(["iut"])).iut!;
          const env: EngineEnv = {
            caps, iutVid: iut.vid, actors: makeActors(), tier: v.tier,
            fixtureRoot, defaultClockStart: file.clock.start, window: PROFILE_WINDOW, salt: "",
          };
          const outcome = await runVector(adapter, v, env);
          rows.push({ vector: v.id, mutant, config: cfg.name, by, caught: by === "failure" ? !outcome.pass : outcome.advisories.length > 0 || !outcome.pass });
        }
      }
    }
  }
  return rows;
}
