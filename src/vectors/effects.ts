// SPDX-License-Identifier: Apache-2.0
// What a vector does to a deployment, derived from the task facts when the vector carries no `effect` tag (R-05). The table
// `vectors-src/task-effects.json` maps every task version of the task-force specifications (front matter `sideEffects.level`, none read as
// read-only) to an effect; scripts/derive-task-effects.ts writes it. A vector's own `effect` tag always wins.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { POSITIVE_DISPOSITIONS } from "./dispositions.ts";
import type { Vector } from "./types.ts";

export type Effect = "destructive" | "mutating" | "read-only";
export type EffectTable = ReadonlyMap<string, Effect>;

const TT = /^(https:\/\/trusttasks\.org\/spec\/[a-z0-9][a-z0-9/_-]*?\/\d+\.\d+)(?:#response)?$/;
export const taskOfType = (t: unknown): string | null => { const m = typeof t === "string" ? TT.exec(t) : null; return m === null ? null : m[1]!; };

let cached: EffectTable | undefined;
export function loadTaskEffects(file = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "vectors-src", "task-effects.json")): EffectTable {
  if (cached !== undefined && file.endsWith("vectors-src/task-effects.json")) return cached;
  const j = JSON.parse(readFileSync(file, "utf8")) as { effects: Record<string, Effect> };
  const m = new Map(Object.entries(j.effects));
  if (file.endsWith("vectors-src/task-effects.json")) cached = m;
  return m;
}

/**
 * The effect a vector has: its own tag, else derived from the tasks its steps send to. A destructive task is never sent to by default (any step). A mutating
 * task is gated when the vector sends it a request that may succeed (the step expects a positive disposition); a request expected to be refused (a negative)
 * changes nothing on a conforming deployment. A step that names no Type URI (a template step) and a type outside the table are not judged: the vector keeps
 * the effect its other steps give, or none. `undefined`: no effect known, the vector runs.
 */
export function vectorEffect(v: Pick<Vector, "effect" | "steps">, table: EffectTable = loadTaskEffects()): Effect | undefined {
  if (v.effect !== undefined) return v.effect;
  let out: Effect | undefined;
  for (const s of v.steps as unknown as { send?: { document?: { type?: unknown } }; expect?: { disposition?: string } }[]) {
    const task = taskOfType(s.send?.document?.type);
    if (task === null) continue;
    const e = table.get(task);
    if (e === "destructive") return "destructive";
    if (e === "mutating" && POSITIVE_DISPOSITIONS.has(s.expect?.disposition ?? "")) out = "mutating";
    else if (e === "read-only" && out === undefined) out = "read-only";
  }
  return out;
}
