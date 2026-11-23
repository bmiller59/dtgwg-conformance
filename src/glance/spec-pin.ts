// SPDX-License-Identifier: Apache-2.0
// The "Spec pin" line of the generated status output (docs/23): the pin date of the Trust Tasks commit the vectors cite, and how many flagged
// vectors need re-checking against the newer spec. Generated from vectors-src/spec-flags.json and the date in vectors/tf-manifest.json.
import { join } from "node:path";
import { loadSpecFlags } from "../vectors/spec-flags.ts";
import { loadTfManifest } from "../vectors/tfref.ts";

export interface SpecPin { date: string; flagged: number }

export function specPinOf(root: string): SpecPin {
  return { date: loadTfManifest(join(root, "vectors", "tf-manifest.json")).main.date, flagged: Object.keys(loadSpecFlags(join(root, "vectors-src", "spec-flags.json"))).length };
}

/** The line; EMPTY when no test needs re-checking. */
export function specPinLine(pin: SpecPin): string {
  return pin.flagged === 0 ? "" : `Spec pin: ${pin.date}; ${pin.flagged} test${pin.flagged === 1 ? "" : "s"} need${pin.flagged === 1 ? "s" : ""} re-checking against newer spec`;
}
