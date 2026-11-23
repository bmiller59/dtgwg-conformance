// SPDX-License-Identifier: Apache-2.0
// Acceptance windows (docs/04 section 6). The framework text states no numbers; the profile pins are the defaults the task force's
// consequential fixtures use. A vector that depends on the window takes it from here: the implementation's declared window, or one
// given to the runner, else the profile pins.
import type { AcceptanceWindow, Capabilities } from "../adapter/contract.ts";

export const PROFILE_WINDOW: AcceptanceWindow = { maxAgeSeconds: 300, clockSkewSeconds: 60, expiryHorizonSeconds: 2_592_000 };

export function effectiveWindow(caps: Capabilities, given?: Partial<AcceptanceWindow>): AcceptanceWindow {
  return { ...PROFILE_WINDOW, ...(caps.window ?? {}), ...(given ?? {}) };
}

/** The members that differ from the profile, as `name: effective (profile P)` texts; empty when the window is the profile window. */
export function windowDifferences(w: AcceptanceWindow): string[] {
  return (Object.keys(PROFILE_WINDOW) as (keyof AcceptanceWindow)[])
    .filter((k) => w[k] !== PROFILE_WINDOW[k])
    .map((k) => `${k} ${w[k]} (profile ${PROFILE_WINDOW[k]})`);
}

/** `--window maxAge=600,skew=60,horizon=2592000` (any subset). */
export function parseWindowArg(text: string): Partial<AcceptanceWindow> {
  const names: Record<string, keyof AcceptanceWindow> = { maxAge: "maxAgeSeconds", skew: "clockSkewSeconds", horizon: "expiryHorizonSeconds" };
  const out: Partial<AcceptanceWindow> = {};
  for (const part of text.split(",").filter((p) => p !== "")) {
    const [k, v] = part.split("=");
    const key = names[k ?? ""];
    if (key === undefined || v === undefined || !/^\d+$/.test(v)) throw new Error(`bad --window member ${part} (maxAge=, skew=, horizon= in whole seconds)`);
    out[key] = Number(v);
  }
  return out;
}
