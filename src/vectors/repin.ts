// SPDX-License-Identifier: Apache-2.0
// Re-pin (scripts/repin.ts) and the pin rule (docs/23). A re-pin is a deliberate act: a reviewer re-reads the changed text, decides, and the hashes, the
// flag and the pin log change together in one commit. The pin rule is the check that they did.
import type { Decision, PinLogEntry, SpecFlag } from "./spec-flags.ts";
import { DECISIONS } from "./spec-flags.ts";
import type { SpecHashesFile, VectorSource } from "./source.ts";

export interface RepinInput {
  /** Vector ids to re-pin; `"all-clear"` means every flagged vector. */
  ids: string[] | "all-clear";
  decision: Decision;
  wordingOnly: boolean;
  reviewer: string;
  today: string;
  /** The Trust Tasks commit the new hashes were read at. */
  tfCommit: string;
  vectors: { id: string; source: VectorSource }[];
  flags: Record<string, SpecFlag>;
  table: SpecHashesFile;
  log: PinLogEntry[];
  /** Current hashes of a cited path in the checkout; null when the file is absent. */
  hashes: (repoPath: string) => { specHash: string; schemaHash?: string } | null;
}
export interface RepinResult { table: SpecHashesFile; flags: Record<string, SpecFlag>; log: PinLogEntry[]; repinned: string[] }

/** Applies a re-pin, or throws with the reason it is refused. */
export function applyRepin(inp: RepinInput): RepinResult {
  if (!(DECISIONS as readonly string[]).includes(inp.decision)) throw new Error(`--decision must be one of ${DECISIONS.join(", ")}`);
  if (inp.wordingOnly && inp.decision !== "still-correct") throw new Error("--wording-only is allowed only with --decision still-correct");
  if (inp.reviewer.trim() === "") throw new Error("--reviewer is required: a re-pin is a named reviewer's decision");
  const ids = inp.ids === "all-clear" ? Object.keys(inp.flags).sort() : [...new Set(inp.ids)].sort();
  if (ids.length === 0) throw new Error("no vector to re-pin: name vector ids, or --all-clear with at least one flag");
  const pathOf = (id: string): string => {
    const p = inp.vectors.find((v) => v.id === id)?.source.tfRef?.repoPath;
    if (p === undefined) throw new Error(`${id}: no such vector, or it cites no Trust Tasks file`);
    return p;
  };
  for (const id of ids) if (inp.flags[id] === undefined) throw new Error(`${id} is not flagged: only a flagged vector is re-pinned`);
  // the hashes are kept per cited file, so every flagged vector citing a file is re-pinned together
  const paths = new Set(ids.map(pathOf));
  const missing = Object.keys(inp.flags).filter((f) => !ids.includes(f) && paths.has(pathOf(f)));
  if (missing.length > 0) throw new Error(`hashes are per cited file: also name ${missing.join(", ")} (flagged, citing the same file), or re-pin them in a separate decision after changing what they cite`);
  const table: SpecHashesFile = { ...inp.table, paths: { ...inp.table.paths } };
  for (const p of paths) {
    const h = inp.hashes(p);
    if (h === null) throw new Error(`${p} is not in the checkout: a removed or renamed file cannot be re-pinned; re-source the vectors (decision vector-changed) in the generators first`);
    table.paths[p] = { specHash: h.specHash, ...(h.schemaHash === undefined ? {} : { schemaHash: h.schemaHash }), tfCommit: inp.tfCommit };
  }
  const flags = { ...inp.flags };
  const log = [...inp.log];
  for (const id of ids) {
    const f = inp.flags[id]!;
    const now = table.paths[pathOf(id)]!;
    delete flags[id];
    log.push({ vector: id, oldHash: f.oldHash, newHash: f.what === "schema" ? (now.schemaHash ?? null) : now.specHash, tfCommit: inp.tfCommit, decision: inp.decision, ...(inp.wordingOnly ? { wordingOnly: true as const } : {}), reviewer: inp.reviewer.trim(), date: inp.today });
  }
  return { table, flags, log, repinned: ids };
}

/**
 * The pin rule (docs/23), over the committed files. Returns the problems; empty means the rule holds. For each flagged vector:
 *  1. the vector exists and carries hashes;
 *  2. its current hash still equals the flag's `oldHash`, or the pin log records the change (an entry for the vector, dated on or after the flag,
 *     whose `newHash` is the current hash): a hash may not change silently while the flag stands;
 *  3. no pin-log entry dated on or after the flag records this flag's `newHash`: that re-pin is done, so the flag must be cleared.
 * And for every vector that carries hashes: its `tfCommit` equals its `tfRef.commit` (the manifest's pin), or the pin log records a re-pin of that vector
 * at that `tfCommit`: bumping the manifest commit without re-hashing and re-pinning is refused.
 */
export function pinRuleProblems(inp: { vectors: { id: string; source: VectorSource }[]; flags: Record<string, SpecFlag>; log: PinLogEntry[] }): string[] {
  const out: string[] = [];
  const byId = new Map(inp.vectors.map((v) => [v.id, v.source]));
  for (const [id, f] of Object.entries(inp.flags)) {
    const s = byId.get(id);
    if (s === undefined) { out.push(`${id}: flagged but no such vector`); continue; }
    const cur = f.what === "schema" ? s.schemaHash : s.specHash;
    if (cur === undefined) { out.push(`${id}: flagged but the vector carries no ${f.what === "schema" ? "schemaHash" : "specHash"}`); continue; }
    const logged = inp.log.filter((e) => e.vector === id && e.date >= f.detectedOn);
    if (cur !== f.oldHash && !logged.some((e) => e.newHash === cur)) out.push(`${id}: the hash changed (${f.oldHash.slice(0, 15)} -> ${cur.slice(0, 15)}) while the flag stands, and the pin log has no entry for it: re-pin with scripts/repin.ts (a reviewer's decision), do not bump hashes in bulk`);
    if (f.newHash !== null && logged.some((e) => e.newHash === f.newHash)) out.push(`${id}: the pin log records a re-pin to the flagged hash but the flag is not cleared: clear it (scripts/repin.ts does)`);
  }
  for (const v of inp.vectors) {
    const s = v.source;
    if (s.specHash === undefined || s.tfCommit === undefined || s.tfRef?.commit === undefined) continue;
    if (s.tfCommit !== s.tfRef.commit && !inp.log.some((e) => e.vector === v.id && e.tfCommit === s.tfCommit)) out.push(`${v.id}: hashes are from Trust Tasks ${s.tfCommit.slice(0, 9)} but the pin is ${s.tfRef.commit.slice(0, 9)} and the pin log has no re-pin at that commit: run check:spec-drift, then re-pin`);
  }
  return out;
}
