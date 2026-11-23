// SPDX-License-Identifier: Apache-2.0
// The wider task-force snapshot the alignment generator (scripts/generate-alignment.ts) reads: every task version of every family that lists invalid payload
// examples, at the manifest's commit. Written by `scripts/gap-snapshot.ts --out vectors-src/alignment/tf-snapshot.json`. It is a separate file from the gap
// snapshot on purpose: `loadTask` and the gap generator read only the gap snapshot, so widening this one cannot add a task version to any other vector set.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Snapshot } from "./snapshot.ts";

export const ALIGNMENT_SNAPSHOT_FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "vectors-src", "alignment", "tf-snapshot.json");
let cached: Snapshot | undefined;
export function loadAlignmentSnapshot(): Snapshot {
  if (cached === undefined) {
    try { cached = JSON.parse(readFileSync(ALIGNMENT_SNAPSHOT_FILE, "utf8")) as Snapshot; } catch { cached = { format: "tt-gap-snapshot/0.1", tfCommit: "", tfDate: "", families: [], tasks: [] }; }
  }
  return cached;
}
