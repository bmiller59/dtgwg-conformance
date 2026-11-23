// SPDX-License-Identifier: Apache-2.0
// CLARIFY classes, age and task-force question ids (docs/04 section 18.10). The hand input is vectors-src/clarify-classes.json; every
// vector generator copies each entry into its CLARIFY vectors (clarifyClass, clarifySince, clarifyQuestions) through applyClarifyMeta.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Vector, VectorFile } from "./types.ts";

export const CLARIFY_CLASSES = ["spec-silent", "spec-inconsistent", "vector-overreads", "unclassified"] as const;
export type ClarifyClass = (typeof CLARIFY_CLASSES)[number];
/** A suite version (semver) or a YYYY-MM-DD date: when the vector became CLARIFY. */
export const CLARIFY_SINCE = /^(\d{4}-\d{2}-\d{2}|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/;
/** A drafted task-force question: tfq:Q<n> (docs/proposals/tf-question-list.md) or d09:<n> (docs/09, Draft n). */
export const CLARIFY_QUESTION = /^(tfq:Q\d+|d09:\d+)$/;

export interface ClarifyMeta { class: ClarifyClass; since: string; questions: string[] }
export interface ClarifyFile { format: "tt-conformance-clarify-classes/0.1"; note: string; vectors: Record<string, ClarifyMeta> }

/** Problems with one entry (or with the same three fields on a vector). */
export function clarifyMetaProblems(m: { class?: unknown; since?: unknown; questions?: unknown }, at: string): string[] {
  const p: string[] = [];
  if (!(CLARIFY_CLASSES as readonly unknown[]).includes(m.class)) p.push(`${at}: class must be one of ${CLARIFY_CLASSES.join(", ")}`);
  if (typeof m.since !== "string" || !CLARIFY_SINCE.test(m.since)) p.push(`${at}: since must be a suite version or YYYY-MM-DD`);
  if (!Array.isArray(m.questions) || !m.questions.every((q) => typeof q === "string" && CLARIFY_QUESTION.test(q))) p.push(`${at}: questions must be an array of tfq:Q<n> or d09:<n> ids`);
  return p;
}

export function loadClarifyMeta(root: string, opts: { coverage?: boolean } = {}): ClarifyFile {
  const f = JSON.parse(readFileSync(join(root, "vectors-src", "clarify-classes.json"), "utf8")) as ClarifyFile;
  const p: string[] = [];
  if (f.format !== "tt-conformance-clarify-classes/0.1") p.push("format must be tt-conformance-clarify-classes/0.1");
  for (const [id, m] of Object.entries(f.vectors ?? {})) p.push(...clarifyMetaProblems(m, id));
  if (p.length > 0) throw new Error(`vectors-src/clarify-classes.json:\n  ${p.join("\n  ")}`);
  // the coverage families' entries are written by scripts/generate-coverage.ts (one rule for all of them), not by hand
  const cov = join(root, "vectors", "coverage", "clarify-classes.json");
  if (opts.coverage !== false && existsSync(cov)) Object.assign(f.vectors, (JSON.parse(readFileSync(cov, "utf8")) as { entries: ClarifyFile["vectors"] }).entries);
  // the gap families' entries are written by scripts/generate-gap.ts (every gap CLARIFY vector is the one issuedAt rule)
  const gap = join(root, "vectors", "gap", "clarify-classes.json");
  if (opts.coverage !== false && existsSync(gap)) Object.assign(f.vectors, (JSON.parse(readFileSync(gap, "utf8")) as { entries: ClarifyFile["vectors"] }).entries);
  return f;
}

/**
 * Copies the class, age and question ids into every CLARIFY vector of `files` (placed right after `clarify`), and removes them from
 * vectors that are not CLARIFY. Throws when a CLARIFY vector has no entry.
 */
export function applyClarifyMeta(files: Iterable<VectorFile>, meta: ClarifyFile): void {
  const missing: string[] = [];
  for (const f of files) {
    f.vectors = f.vectors.map((v) => {
      const m = v.clarify !== null ? meta.vectors[v.id] : undefined;
      if (v.clarify !== null && m === undefined) missing.push(v.id);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k === "clarifyClass" || k === "clarifySince" || k === "clarifyQuestions") continue;
        out[k] = val;
        if (k === "clarify" && m !== undefined) Object.assign(out, { clarifyClass: m.class, clarifySince: m.since, clarifyQuestions: [...m.questions] });
      }
      return out as unknown as Vector;
    });
  }
  if (missing.length > 0) throw new Error(`CLARIFY vectors without an entry in vectors-src/clarify-classes.json: ${missing.join(", ")}`);
}
