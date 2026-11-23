// SPDX-License-Identifier: Apache-2.0
// Clock handling for implementations whose clock the harness cannot set (docs/04 section 7).
//
// REBASE MODE: the real time at the start of a vector is the vector's clock start, and the vector's relative offsets are applied to it.
// That is sound only where one clock offset serves every step and no assertion sits within seconds of a window edge, so `clockGate`
// names the vectors that are SKIP in this mode, with the reason. Never PASS: an unmeasured vector is not a passing one.
import type { Step, Vector } from "../vectors/types.ts";
import { isObject } from "../util/json.ts";

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The distinct clock offsets a vector's steps run at, as text at which a step acts. Symbolic offsets count as one value each. */
export function stepOffsets(steps: Step[]): string[] {
  const used = new Set<string>();
  let cur = "+0s";
  for (const s of steps) {
    if (s.at !== undefined) cur = s.at;
    if (s.send !== undefined || s.trigger !== undefined || s.restart === true || s.verifyReceipt !== undefined) used.add(cur);
  }
  return [...used];
}

function hasAbsoluteInstantOutsideParams(v: Vector): boolean {
  for (const s of v.steps) {
    const send = s.send;
    if (send === undefined) continue;
    const rest = { ...send, params: undefined };
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(JSON.stringify(rest))) return true;
    for (const val of Object.values(send.params ?? {})) {
      if (typeof val === "string" && ISO_INSTANT.test(val)) continue;
      if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(JSON.stringify(val))) return true;
    }
  }
  return false;
}

/** The longest offset rebase mode realises by waiting in real time. */
export const REAL_WAIT_MAX_MS = 10_000;
const LITERAL_SECONDS = /^\+(\d+)s$/;

/** The offset in ms when `at` is a literal small forward offset (`+5s`) that rebase mode can wait out in real time; else undefined. */
export function realWaitMs(at: string): number | undefined {
  const m = LITERAL_SECONDS.exec(at);
  if (m === null) return undefined;
  const ms = Number(m[1]) * 1000;
  return ms <= REAL_WAIT_MAX_MS ? ms : undefined;
}

/**
 * Several clock offsets can still be measured in rebase mode when every one is a literal forward offset of at most 10 s: the runner waits
 * in real time until the offset has elapsed (the duplicate and refused-then-corrected vectors, +1s and +5s). The wait is real, so the
 * timestamps built for the later step are the real time at which it is sent; nothing here moves the implementation's clock.
 */
export function realTimeOffsets(steps: Step[]): boolean {
  return stepOffsets(steps).every((o) => realWaitMs(o) !== undefined);
}

/** Why a vector cannot be measured in rebase mode, or null when it can. */
export function clockGate(v: Vector): string | null {
  if (v.exactClock === true) return "needs exact clock control: an assertion sits within seconds of a window edge";
  if (v.steps.some((s) => s.atAbsolute !== undefined)) return "needs exact clock control: an absolute instant";
  const offsets = stepOffsets(v.steps);
  if (offsets.length > 1 && !realTimeOffsets(v.steps)) return `needs clock control: steps at several clock offsets (${offsets.join(", ")})`;
  if (hasAbsoluteInstantOutsideParams(v)) return "needs exact clock control: absolute timestamps in the document";
  return null;
}

/**
 * The vector with its clock start moved to `startMs` (real time), and the absolute `issuedAt` and `expiresAt` of its send parameters
 * moved by the same amount, so every relation to the clock start is kept.
 */
export function rebaseVector(v: Vector, startMs: number, fileClockStart: string): Vector {
  const shift = startMs - Date.parse(v.clockStart ?? fileClockStart);
  const move = (val: unknown): unknown => {
    if (typeof val !== "string" || !ISO_INSTANT.test(val)) return val;
    const ms = Date.parse(val);
    // a calendar-invalid instant (Feb 30) stays as it is: it is malformed, whatever the clock
    const canon = Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
    if (canon === undefined || (canon !== val && canon.replace(".000Z", "Z") !== val && !/\.\d+Z$/.test(val))) return val;
    const t = new Date(ms + shift).toISOString();
    return t.endsWith(".000Z") ? t.slice(0, -5) + "Z" : t;
  };
  const steps = v.steps.map((s): Step => {
    if (s.send?.params === undefined) return s;
    const params: Record<string, unknown> = { ...s.send.params };
    for (const k of ["issuedAt", "expiresAt"]) if (isObject(params) && k in params) params[k] = move(params[k]);
    return { ...s, send: { ...s.send, params } };
  });
  return { ...v, clockStart: new Date(startMs).toISOString(), steps };
}
