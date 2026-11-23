// SPDX-License-Identifier: Apache-2.0
// The adapter honesty check (decision 39, docs/04 section 11.4, docs/17): the harness verifies the essential governance E an adapter
// declares against the platform's behaviour with its own probe. The probe is not a vector: no channel, tier, `requires` or exception
// selects it, so an adapter cannot opt out of it. It runs in every suite run of an implementation that offers ceremonies and has two
// checks, each reading only the count of establishing effects after every step (the shape of the replies is left to the vectors):
//
//   completion-at-k        the begin, then distinct approvals from the authority set in order: no effect before the k-th distinct
//                          approval (the begin counting as the proposer's approval where the adapter declares that), the effect at it.
//   outsider-not-counted   with the ceremony held (k above the approvals the begin carries): an approval from a harness principal
//                          outside the declared set, then the members' approvals; the effect still comes exactly at the k-th member.
//                          Where the begin alone completes the ceremony (k = 1, a begin counted as an approval, so nothing can be
//                          held), the outsider sends the begin instead, and it must create no effect.
//
// A mismatch in either check (an effect earlier or later than the declared k, or an outsider counted) is a declaration mismatch: the
// run records it with a GOV-DECLARATION-MISMATCH finding, every result that rests on the declared E (each vector with a `quorum` step)
// becomes FAIL, and the run's exit code is non-zero whatever the channels (src/runner/suite.ts). Unlike the other GOV-* findings it
// gates: it is a fact about the adapter's declaration, not a ruling on governance. Where E is unreadable or names principals the harness
// cannot drive, the probe is not run and the record carries GOV-NOT-PROBED; where the platform offers no ceremony, it is not run.
import type { Adapter, Capabilities } from "../adapter/contract.ts";
import type { Actor } from "./build.ts";
import { makeFinding } from "../governance/findings.ts";
import type { GovFinding } from "../governance/findings.ts";
import type { Step, Vector } from "../vectors/types.ts";
import { approve, begin, counted, done, hold, outsiderOf, resolveEssential } from "./essential.ts";
import type { DrivableE } from "./essential.ts";
import { runVector } from "./engine.ts";
import type { EngineEnv } from "./engine.ts";

export const HONESTY_CHECKS = ["completion-at-k", "outsider-not-counted"] as const;
export type HonestyCheckName = (typeof HONESTY_CHECKS)[number];

export interface HonestyCheck {
  check: HonestyCheckName;
  result: "consistent" | "mismatch" | "not-run";
  /** What the harness observed, in plain words (for a mismatch, where the effect came or did not come). */
  observed: string;
}

/** The honesty probe's record in a suite run (results.json `essentialProbe`) and in run.json (implementations[].essentialProbe). */
export interface EssentialProbe {
  /** `mismatch` gates; `not-probed` (E unreadable or not drivable) and `not-run` (no ceremony offered) say why nothing was checked. */
  result: "consistent" | "mismatch" | "not-probed" | "not-run";
  /** The declaration probed, e.g. "k = 2 of an authority set of 3 ($A, $X, $B)". */
  declared?: string;
  checks: HonestyCheck[];
  reason?: string;
  /** GOV-DECLARATION-MISMATCH with a mismatch, GOV-NOT-PROBED where E could not be probed. */
  finding?: GovFinding;
}

/** The finding's probe id and title. */
export const HONESTY_PROBE = "essential-declaration";
const TITLE = "declared essential governance against observed behaviour";
/** Why the probe does not run where the platform offers no ceremony. */
export const NO_CEREMONY = "the platform offers no ceremony (optional:ceremony), so there is no held task to probe";

/** The step whose establishing-effect count differed from the expected one (1-based, from the engine's `step N:` labels), or null. */
function firstEffectMismatch(failures: string[]): { step: number; got: number } | null {
  for (const f of failures) {
    const m = /^step (\d+): ceremony effects (\d+), expected \d+$/.exec(f);
    if (m !== null) return { step: Number(m[1]), got: Number(m[2]) };
  }
  return null;
}

const vector = (id: string, steps: Step[]): Vector => ({ id, title: TITLE, tier: 1, spec: ["docs/04-suite-design.md section 11.4 (the adapter honesty check)"], clarify: null, steps });

/** The steps of the completion-at-k check, and the approval count each step brings the ceremony to. */
function completionSteps(e: DrivableE, c0: number): { steps: Step[]; counts: number[] } {
  const m1 = e.authority[0]!;
  const steps: Step[] = [begin(m1, e.k <= c0 ? done("begin") : hold())];
  const counts = [c0];
  e.authority.slice(c0, e.k).forEach((m, j) => {
    steps.push(approve(m, `app${m}`, c0 + j + 1 === e.k ? done("approve") : hold()));
    counts.push(c0 + j + 1);
  });
  return { steps, counts };
}

async function completionAtK(adapter: Adapter, e: DrivableE, c0: number, env: EngineEnv): Promise<HonestyCheck> {
  const { steps, counts } = completionSteps(e, c0);
  const out = await runVector(adapter, vector("PROBE-completion-at-k", steps), env);
  const miss = firstEffectMismatch(out.failures);
  if (miss === null) return { check: "completion-at-k", result: "consistent", observed: `the effect came at the declared k-th distinct approval (${e.k})` };
  const at = counts[miss.step - 1]!;
  return at < e.k
    ? { check: "completion-at-k", result: "mismatch", observed: `the ceremony completed at ${at} distinct approval(s), before the declared k of ${e.k}` }
    : { check: "completion-at-k", result: "mismatch", observed: `the ceremony did not complete at the declared k-th distinct approval (${e.k})` };
}

async function outsiderNotCounted(adapter: Adapter, e: DrivableE, c0: number, env: EngineEnv): Promise<HonestyCheck> {
  const q = outsiderOf(e, env.actors);
  if (q === undefined) return { check: "outsider-not-counted", result: "not-run", observed: "no harness principal outside the declared authority set" };
  if (e.k <= c0) {
    // Nothing can be held: the begin alone completes the ceremony, so the outsider sends the begin and it must create no effect.
    const out = await runVector(adapter, vector("PROBE-outsider-begin", [begin(q, { disposition: "any-refusal", state: { effects: 0 } })]), env);
    return firstEffectMismatch(out.failures) === null
      ? { check: "outsider-not-counted", result: "consistent", observed: "a begin from a principal outside the declared authority set created no effect" }
      : { check: "outsider-not-counted", result: "mismatch", observed: "a begin from a principal outside the declared authority set completed the ceremony" };
  }
  const { steps } = completionSteps(e, c0);
  steps.splice(1, 0, approve(q, "appOut", { disposition: "any-refusal", state: { effects: 0 } }));
  const out = await runVector(adapter, vector("PROBE-outsider-approval", steps), env);
  return firstEffectMismatch(out.failures) === null
    ? { check: "outsider-not-counted", result: "consistent", observed: "an approval from a principal outside the declared authority set was not counted" }
    : { check: "outsider-not-counted", result: "mismatch", observed: "an approval from a principal outside the declared authority set was counted toward k" };
}

/** Run the honesty probe against an adapter (`env` is the suite run's engine environment; the probe resets the adapter before each check). */
export async function probeEssential(adapter: Adapter, caps: Capabilities, env: EngineEnv, actors: Record<string, Actor>): Promise<EssentialProbe> {
  const platform = caps.platform ?? caps.name;
  const notProbed = (reason: string, declared?: string): EssentialProbe => ({
    result: "not-probed", ...(declared === undefined ? {} : { declared }), checks: [], reason,
    finding: makeFinding("GOV-NOT-PROBED", { probe: HONESTY_PROBE, title: TITLE, platform, channel: "registry", reason }),
  });
  if (!caps.optional.includes("ceremony") || caps.ceremony === undefined) return { result: "not-run", checks: [], reason: NO_CEREMONY };
  const r = resolveEssential(caps, actors);
  if (!r.readable) return notProbed(`essential governance unreadable: ${r.record.reason ?? ""}`);
  const declared = `k = ${r.record.minApprovals} of an authority set of ${r.record.authority.length} (${r.record.authority.join(", ")})`;
  if (r.drive === null) return notProbed(`authority set not drivable by the harness: ${r.driveReason ?? ""}`, declared);
  const c0 = counted(caps);
  const completion = await completionAtK(adapter, r.drive, c0, env);
  // With completion off the declared k, an outsider's effect could not be told apart from that, so the second check is not run.
  const outsider: HonestyCheck = completion.result === "consistent" ? await outsiderNotCounted(adapter, r.drive, c0, env) : { check: "outsider-not-counted", result: "not-run", observed: "not run: completion is not at the declared k, so an outsider's approval cannot be told apart" };
  const checks = [completion, outsider];
  await adapter.reset();
  const bad = checks.filter((c) => c.result === "mismatch");
  if (bad.length === 0) return { result: "consistent", declared, checks };
  const observed = bad.map((c) => c.observed).join("; ");
  return { result: "mismatch", declared, checks, finding: makeFinding("GOV-DECLARATION-MISMATCH", { probe: HONESTY_PROBE, title: TITLE, platform, channel: "registry", declared, observed }) };
}
