// SPDX-License-Identifier: Apache-2.0
// Stable vector ids for a generated group (docs/04 section 20.3: an id is never reused and never deleted). A generated vector keeps the id
// the committed file gives the vector with the same key; a vector new to the group takes the next number after every id the group has
// ever issued (the committed file and the ledger); a committed vector the generator no longer writes stays as a tombstone (`retired`).
import { existsSync, readFileSync } from "node:fs";
import type { Vector } from "./types.ts";

export interface StableIdOptions {
  group: string;
  /** The committed vector file of the group (read, never written here); absent for a new group. */
  committedFile: string;
  /** Every id ever issued (vectors-src/id-ledger.json `ids`). */
  ledger: readonly string[];
  /** Identity of a vector across regenerations (for example task and kind); must be unique within the group. */
  keyOf: (v: Vector) => string;
  /** Why a committed vector that is no longer generated is retired, and the suite version that retires it. */
  retire: { reason: string; since: string };
}

const numberOf = (group: string, id: string): number => Number(id.slice(group.length + 1));

/** Assigns ids in place and returns the group's vectors (generated ones and tombstones), sorted by id number. */
export function assignStableIds(generated: Vector[], o: StableIdOptions): Vector[] {
  const committed: Vector[] = existsSync(o.committedFile) ? (JSON.parse(readFileSync(o.committedFile, "utf8")) as { vectors: Vector[] }).vectors : [];
  const byKey = new Map<string, Vector>();
  for (const v of committed) if (v.retired === undefined) byKey.set(o.keyOf(v), v);
  const issued = [...committed.map((v) => v.id), ...o.ledger].filter((id) => id.startsWith(`${o.group}-`));
  let next = 1 + Math.max(0, ...issued.map((id) => numberOf(o.group, id)).filter((n) => Number.isFinite(n)));
  const seen = new Set<string>();
  for (const v of generated) {
    const k = o.keyOf(v);
    if (seen.has(k)) throw new Error(`${o.group}: two generated vectors share the key ${k}`);
    seen.add(k);
    v.id = byKey.get(k)?.id ?? `${o.group}-${String(next++).padStart(3, "0")}`;
  }
  const tombs = committed.filter((v) => v.retired !== undefined || !seen.has(o.keyOf(v))).map((v) => (v.retired !== undefined ? v : ({ ...v, retired: { ...o.retire } } as Vector)));
  return [...generated, ...tombs].sort((a, b) => numberOf(o.group, a.id) - numberOf(o.group, b.id));
}

/** A key from a vector's task and the kind its title names: "<slug> <version>: <kind> (<details>)" without the trailing details. */
export function taskKindKey(v: Vector): string {
  const s = (v as unknown as { source?: { slug?: string; version?: string } }).source;
  const kind = v.title.slice(v.title.indexOf(": ") + 2).replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*$/, "");
  return `${s?.slug ?? ""} ${s?.version ?? ""}|${kind}`;
}
