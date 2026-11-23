// SPDX-License-Identifier: Apache-2.0
// Registry of the behavioural coverage rules, one file per family (each family's rules are edited only in its own file).
import type { BehaviourRule } from "./types.ts";
import { RULES as RM } from "./rm.ts";
import { RULES as VP } from "./vp.ts";
import { RULES as MB } from "./mb.ts";
import { RULES as CS } from "./cs.ts";
import { RULES as SD } from "./sd.ts";
import { RULES as AA } from "./aa.ts";
import { RULES as CA } from "./ca.ts";
import { RULES as PW } from "./pw.ts";

export const BEHAVIOUR_RULES: BehaviourRule[] = [...RM, ...VP, ...MB, ...CS, ...SD, ...AA, ...CA, ...PW];
const keys = new Set<string>();
for (const r of BEHAVIOUR_RULES) { if (keys.has(r.key)) throw new Error(`duplicate behaviour rule ${r.key}`); keys.add(r.key); }

export const behaviourMutantId = (r: BehaviourRule): string => `bx:${r.key}`;
/** The rules in force: a retired rule is a tombstone (its vector id stays), with no oracle behaviour and no mutant. */
export const ACTIVE_RULES: BehaviourRule[] = BEHAVIOUR_RULES.filter((r) => r.retired === undefined);
/** Mutants of the reference oracle, one per rule in force: the rule is not enforced. */
export const BEHAVIOUR_MUTANTS: Record<string, string> = Object.fromEntries(ACTIVE_RULES.map((r) => [behaviourMutantId(r), `does not enforce the refusal ${r.key} (${r.title})`]));

/** The refusal the specification states for this request, or undefined. */
export function behaviourRefusal(task: { slug: string; version: string }, payload: unknown, mutated: (id: string) => boolean): { code: string; message: string } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  for (const r of ACTIVE_RULES) {
    if (r.slug === task.slug && r.version === task.version && !mutated(behaviourMutantId(r)) && r.refuses(payload as Record<string, unknown>, task as never)) return { code: r.codes[0]!, message: r.title };
  }
  return undefined;
}
