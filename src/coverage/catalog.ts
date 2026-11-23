// SPDX-License-Identifier: Apache-2.0
// The task versions the coverage generator and the reference oracle work from: census rows joined to the pinned registry package.
// A row with no Trust Tasks specification, a retired one, or a version whose valid payload the schema-driven builder cannot build is
// listed in `skipped` with its reason (a generator limit or a missing text), never guessed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUITE_ROOT } from "../vectors/source.ts";
import { loadTask, TYPE_BASE, type PlainTask } from "../plain/catalog.ts";
import { exampleExtended } from "../plain/schema.ts";
import { payloadOverride } from "../adapters/reference/2l-catalog.ts";
import { loadCensus, type CensusRow } from "./families.ts";

export interface CoverageTask { row: CensusRow; task: PlainTask; probe: boolean; emit: boolean; /** The reference oracle serves this task (so a mutant can be named). */ oracle: boolean;
  /** The valid payload comes from the extended builder (`exampleExtended`), not from `example` or an override: the version built nothing before, and its new vectors are numbered after every earlier one (the id ledger is append-only). */ extended: boolean }
export interface Skipped { type: string; family: string; reason: "no-specification" | "retired" | "not-in-package" | "payload-not-buildable" | "probe-held-elsewhere" | "emit-held-elsewhere" | "no-oracle";
  /** A `no-specification` type: the candidate vector group that covers it, or why none can be written, or where its vectors already are (decision CV-6, docs/24). */
  candidate?: string; blockedOn?: string; linkedTo?: string }

/** Slugs the reference leaves to its own witness and relationship handlers: no coverage oracle, so no probe vector (a negative vector needs a mutant). */
export const oracleServes = (slug: string): boolean => !/(^|\/)(vrc|witness)\//.test(slug);
/** Slugs the reference oracle answers through dedicated handlers (the DTG family, vectors/dtg): their single-task checks live there. */
const DEDICATED = /^(task-consent|credential-exchange)\//;

/** Type (`slug/version`) sets the suite already holds mechanics vectors for: probes (vectors/plain, vectors/2l) and emit (vectors/emit, vectors/2l). Read from the committed files, so the coverage families add what is missing and do not repeat it. */
export function heldElsewhere(root = SUITE_ROOT): { probe: Set<string>; emit: Set<string> } {
  const probe = new Set<string>();
  const emit = new Set<string>();
  for (const [dir, into] of [["plain", probe], ["2l", probe], ["emit", emit], ["emit-more", emit], ["2l", emit]] as const) {
    const m = join(root, "vectors", dir, "manifest.json");
    if (!existsSync(m)) continue;
    for (const f of (JSON.parse(readFileSync(m, "utf8")) as { files: string[] }).files) {
      const d = JSON.parse(readFileSync(join(root, "vectors", dir, f), "utf8")) as { family: string; vectors: { source?: { slug?: string; version?: string } }[] };
      const isEmit = d.family === "emit" || d.family === "2l-emit" || d.family === "emit-more";
      if (into === emit ? !isEmit : isEmit) continue;
      for (const v of d.vectors) if (v.source?.slug !== undefined) into.add(`${v.source.slug}/${v.source.version}`);
    }
  }
  return { probe, emit };
}

export function coverageTasks(families?: readonly string[]): { tasks: CoverageTask[]; skipped: Skipped[] } {
  const held = heldElsewhere();
  const tasks: CoverageTask[] = [];
  const skipped: Skipped[] = [];
  for (const row of loadCensus()) {
    if (row.family === "FW" || (families !== undefined && !families.includes(row.family))) continue;
    const s = (reason: Skipped["reason"]): void => { skipped.push({ type: row.type, family: row.family, reason }); };
    if (row.tfStatus === "none") { s("no-specification"); continue; }
    if (row.tfStatus === "retired") { s("retired"); continue; }
    const t = loadTask(`${TYPE_BASE}${row.type}`);
    if (t === undefined) { s("not-in-package"); continue; }
    const o = payloadOverride(row.slug, row.version);
    // a version `example` and the overrides cannot build gets one more attempt with the extended builder (src/plain/schema.ts); what
    // `example` builds is never replaced, so the vectors derived from it do not change
    const base = o !== undefined ? o : t.validPayload;
    const ext = base === undefined ? exampleExtended(t.payloadSchema as Record<string, unknown>) : undefined;
    const valid = base !== undefined ? base : ext;
    // a version whose valid payload cannot be built keeps only the task-force-example probes (and an emit vector without a mutant)
    if (valid === undefined) s("payload-not-buildable");
    const probe = row.vti && !DEDICATED.test(row.slug) && !held.probe.has(row.type) && oracleServes(row.slug);
    const emit = (row.kw || row.vtiSent) && !DEDICATED.test(row.slug) && !held.emit.has(row.type);
    if (row.vti && !probe) s(!oracleServes(row.slug) ? "no-oracle" : "probe-held-elsewhere");
    if ((row.kw || row.vtiSent) && !emit) s("emit-held-elsewhere");
    const validResponse = ext !== undefined && t.validResponse === undefined && t.responseSchema !== undefined ? exampleExtended(t.responseSchema as Record<string, unknown>) : t.validResponse;
    tasks.push({ row, task: valid === t.validPayload && validResponse === t.validResponse ? t : { ...t, validPayload: valid, validResponse }, probe, emit, oracle: oracleServes(row.slug), extended: ext !== undefined });
  }
  return { tasks, skipped };
}
