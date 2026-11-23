// SPDX-License-Identifier: Apache-2.0
// The minimum quiet period a verdict resting on "no reply" needs (docs/04 section 3.3).
import type { Capabilities, SendResult } from "../adapter/contract.ts";
import type { Expect } from "../vectors/types.ts";

/** The minimum over an asynchronous binding (DIDComm, or a binding the suite does not know): a reply can still be in flight when `send` returns. */
export const ASYNC_MIN_QUIET_MS = 1500;

/** Bindings whose `send` returns only once the implementation has finished handling the document: every reply is in the call's answer. */
export const SYNCHRONOUS_BINDINGS: readonly string[] = ["in-process", "https"];

/** The effective minimum quiet period of a run, and why it is that value. Recorded in SuiteRun and run.json. */
export interface QuietPeriod {
  minimumMs: number;
  /** `binding:<name>` (the rule below chose it from the declared bindings) or `runner option` (`--min-quiet-ms`). */
  basis: string;
}

/** The reason prefix of a step whose no-reply verdict the adapter's reported quiet period does not establish. */
export const QUIET_NOT_ESTABLISHED = "QUIET-NOT-ESTABLISHED";

/**
 * The minimum quiet period for an implementation: a runner override when given; else 0 when the adapter declares a synchronous binding
 * (`in-process`, `https`), since sends then travel over it; else 1500 ms (DIDComm, or no binding the suite knows).
 */
export function minimumQuiet(caps: Pick<Capabilities, "bindings">, overrideMs?: number): QuietPeriod {
  if (overrideMs !== undefined) {
    if (!Number.isFinite(overrideMs) || overrideMs < 0) throw new Error(`minimum quiet period must be a non-negative number of milliseconds, got ${String(overrideMs)}`);
    return { minimumMs: overrideMs, basis: "runner option" };
  }
  const bindings = caps.bindings ?? [];
  const sync = SYNCHRONOUS_BINDINGS.find((b) => bindings.includes(b));
  if (sync !== undefined) return { minimumMs: 0, basis: `binding:${sync}` };
  const asyncBinding = bindings.find((b) => b.startsWith("didcomm")) ?? bindings[0];
  return { minimumMs: ASYNC_MIN_QUIET_MS, basis: asyncBinding === undefined ? "binding:none declared" : `binding:${asyncBinding}` };
}

/**
 * Whether a step's verdict rests on having observed no reply: `silence`, `any-refusal` and `duplicate` (with or without `priorReplyLost`)
 * all accept an empty reply set, and the verdict is about absence only when no reply arrived. A step that got a reply is judged on it.
 */
export function restsOnNoReply(ex: Expect, replies: readonly string[]): boolean {
  return replies.length === 0 && (ex.disposition === "silence" || ex.disposition === "any-refusal" || ex.disposition === "duplicate" || (ex.disposition === "error" && ex.errorReply === "should"));
}

/** The failure line for a send whose reported quiet period is below the minimum, or undefined when the absence is established. */
export function quietFailure(ex: Expect, result: Pick<SendResult, "replies" | "quiescentAfterMs">, quiet: QuietPeriod): string | undefined {
  if (!restsOnNoReply(ex, result.replies)) return undefined;
  const observed = typeof result.quiescentAfterMs === "number" && Number.isFinite(result.quiescentAfterMs) ? result.quiescentAfterMs : undefined;
  if (observed !== undefined && observed >= quiet.minimumMs) return undefined;
  const what = ex.disposition === "duplicate" ? `no reply to the duplicate${ex.priorReplyLost === true ? " (prior reply lost)" : ""}` : ex.disposition === "silence" ? "silence" : ex.disposition === "error" ? "an error reply that is only a SHOULD, so a refusal by silence" : "a refusal by silence";
  return `${QUIET_NOT_ESTABLISHED}: ${what} not established: the adapter reported ${observed === undefined ? "no quiet period" : `${Math.round(observed)} ms of quiet`}, the minimum is ${quiet.minimumMs} ms (${quiet.basis})`;
}
