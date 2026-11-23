// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExceptionsFile, Manifest, VectorFile } from "./types.ts";
import { EXCEPTION_CLASSES } from "./types.ts";
import { checkNonVacuityDeclarations, validateVectorFile } from "./validate.ts";

export interface LoadedSuite {
  root: string;
  files: { path: string; file: VectorFile }[];
}

export class VectorLoadError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`vector load failed:\n  ${problems.join("\n  ")}`);
    this.problems = problems;
  }
}

/** Load and validate every file listed in `<dir>/manifest.json`. Throws VectorLoadError on any problem. */
export function loadSuite(dir: string): LoadedSuite {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  const problems: string[] = [];
  if (manifest.format !== "tt-conformance-manifest/0.1") problems.push("manifest.format must be tt-conformance-manifest/0.1");
  const files: LoadedSuite["files"] = [];
  const seen = new Map<string, string>();
  for (const rel of manifest.files ?? []) {
    const path = join(dir, rel);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      problems.push(`${rel}: ${(err as Error).message}`);
      continue;
    }
    const errs = validateVectorFile(parsed);
    if (errs.length > 0) {
      problems.push(...errs.map((m) => `${rel}: ${m}`));
      continue;
    }
    const file = parsed as VectorFile;
    // `nonVacuity: "pending-oracle"` is still honoured for a suite without an oracle (explicit, never silent); no shipped suite declares it.
    if ((manifest as { nonVacuity?: string }).nonVacuity !== "pending-oracle") problems.push(...checkNonVacuityDeclarations(file).map((m) => `${rel}: ${m}`));
    for (const v of file.vectors) {
      const prior = seen.get(v.id);
      if (prior !== undefined) problems.push(`${rel}: duplicate vector id ${v.id} (also in ${prior})`);
      seen.set(v.id, rel);
    }
    files.push({ path, file });
  }
  if (problems.length > 0) throw new VectorLoadError(problems);
  return { root: dirname(join(dir, "manifest.json")), files };
}

export function loadExceptions(path: string): ExceptionsFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ExceptionsFile;
  const problems: string[] = [];
  if (parsed.format !== "tt-conformance-exceptions/0.1") problems.push("format must be tt-conformance-exceptions/0.1");
  for (const [i, x] of (parsed.exceptions ?? []).entries()) {
    for (const k of ["impl", "vector", "reason", "owner"] as const) {
      if (typeof x[k] !== "string" || x[k] === "") problems.push(`exceptions[${i}].${k} required`);
    }
    if (x.tier !== undefined && x.tier !== 1 && x.tier !== 2) problems.push(`exceptions[${i}].tier must be 1 or 2 when given`);
    if (x.class !== undefined && !(EXCEPTION_CLASSES as readonly unknown[]).includes(x.class)) problems.push(`exceptions[${i}].class must be one of ${EXCEPTION_CLASSES.join(", ")} when given`);
    if (typeof x.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.expires)) problems.push(`exceptions[${i}].expires must be YYYY-MM-DD (owner and expiry are mandatory)`);
    problems.push(...acknowledgementProblems(x.acknowledged, `exceptions[${i}].acknowledged`));
    problems.push(...expectFailureProblems(x.expectFailure, `exceptions[${i}].expectFailure`));
    if (x.inherited !== undefined && (typeof x.inherited !== "string" || x.inherited === "")) problems.push(`exceptions[${i}].inherited must be a non-empty string when given`);
    problems.push(...notOnProblems(x.notOn, x.impl, `exceptions[${i}].notOn`));
  }
  if (problems.length > 0) throw new VectorLoadError(problems);
  return parsed;
}

/** `notOn`, when given: a non-empty object of implementation name -> non-empty reason, never naming the entry's own key. */
export function notOnProblems(x: unknown, impl: unknown, at: string): string[] {
  if (x === undefined) return [];
  if (typeof x !== "object" || x === null || Array.isArray(x) || Object.keys(x).length === 0) return [`${at} must be a non-empty object of implementation name -> reason when given`];
  const problems: string[] = [];
  for (const [name, why] of Object.entries(x)) {
    if (name === impl) problems.push(`${at} names the entry's own key ${name}`);
    if (typeof why !== "string" || why === "") problems.push(`${at}.${name} must be a non-empty reason`);
  }
  return problems;
}

/** `expectFailure`, when given: `{ failures: [regex, ...] }`, at least one pattern, each a valid regular expression. */
export function expectFailureProblems(x: unknown, at: string): string[] {
  if (x === undefined) return [];
  const f = typeof x === "object" && x !== null ? (x as { failures?: unknown }).failures : undefined;
  if (!Array.isArray(f) || f.length === 0 || Object.keys(x as object).length !== 1) return [`${at} must be { failures: [one or more regular expressions] }`];
  const out: string[] = [];
  for (const [j, p] of f.entries()) {
    if (typeof p !== "string" || p === "") { out.push(`${at}.failures[${j}] must be a non-empty string`); continue; }
    try { new RegExp(p); } catch { out.push(`${at}.failures[${j}] is not a valid regular expression`); }
  }
  return out;
}

/** `acknowledged` is required: null (not yet acknowledged by the platform's owner) or { by, on: YYYY-MM-DD, ref }, nothing else. */
export function acknowledgementProblems(a: unknown, at: string): string[] {
  if (a === null) return [];
  if (a === undefined) return [`${at} required (null until the implementer acknowledges the entry)`];
  if (typeof a !== "object" || Array.isArray(a)) return [`${at} must be null or { by, on, ref }`];
  const o = a as Record<string, unknown>;
  const p: string[] = [];
  for (const k of Object.keys(o)) if (!["by", "on", "ref"].includes(k)) p.push(`${at}.${k} is not a known member`);
  for (const k of ["by", "ref"]) if (typeof o[k] !== "string" || o[k] === "") p.push(`${at}.${k} required`);
  if (typeof o.on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.on)) p.push(`${at}.on must be YYYY-MM-DD`);
  return p;
}
