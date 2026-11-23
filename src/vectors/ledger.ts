// SPDX-License-Identifier: Apache-2.0
// The vector id ledger (docs/04 section 20.3): every vector and probe id the suite has ever issued, append only. An id is never reused
// and never deleted: a vector that should no longer run is retired (`retired: {reason, since}`) and stays in its file as a tombstone.
// `npm run regen` appends new ids; `npm run check:docs` and test/vector-ids.test.ts fail when a ledger id is missing from vectors/ or
// a vector id is missing from the ledger.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectAllVectors } from "./tfresolve.ts";

export const LEDGER_FILE = join("vectors-src", "id-ledger.json");

const NOTE = "Every vector and probe id ever issued (docs/04 section 20.3). Append only, written by npm run regen: never remove or reuse an id; retire the vector instead.";

interface Ledger { note: string; ids: string[] }

export function readLedger(root: string): string[] {
  return (JSON.parse(readFileSync(join(root, LEDGER_FILE), "utf8")) as Ledger).ids;
}

function sortIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The ledger as it should be: its ids plus every id now in vectors/. */
export function ledgerText(root: string): string {
  let old: string[] = [];
  try { old = readLedger(root); } catch { /* first write */ }
  const ids = sortIds([...old, ...collectAllVectors(join(root, "vectors")).filter((v) => v.step !== true).map((v) => v.id)]);
  return JSON.stringify({ note: NOTE, ids } satisfies Ledger, null, 2) + "\n";
}

export function writeLedger(root: string): void {
  writeFileSync(join(root, LEDGER_FILE), ledgerText(root));
}

/** Problems: an issued id no longer in any vector file (deleted instead of retired), or a vector id not yet in the ledger. */
export function ledgerProblems(root: string, ledger: string[] = readLedger(root), current: string[] = collectAllVectors(join(root, "vectors")).filter((v) => v.step !== true).map((v) => v.id)): string[] {
  const now = new Set(current);
  const known = new Set(ledger);
  return [
    ...ledger.filter((id) => !now.has(id)).map((id) => `${id} was issued but is no longer in vectors/: retire it (retired: {reason, since}) instead of deleting it`),
    ...[...now].filter((id) => !known.has(id)).map((id) => `${id} is not in ${LEDGER_FILE}: run npm run regen`),
  ];
}
