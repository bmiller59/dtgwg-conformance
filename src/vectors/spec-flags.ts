// SPDX-License-Identifier: Apache-2.0
// Spec-drift flags and the re-pin log (docs/23). A flag says "the spec moved; this test has not been re-checked": the runner records the vector's
// result as SPEC-CHANGED (advisory, in no count, never in the exit code) until a reviewer re-pins it (scripts/repin.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SUITE_ROOT } from "./source.ts";

export const SPEC_FLAGS_FILE = join(SUITE_ROOT, "vectors-src", "spec-flags.json");
export const SPEC_PIN_LOG_FILE = join(SUITE_ROOT, "vectors-src", "spec-pin-log.json");
export const SPEC_FLAGS_FORMAT = "tt-spec-flags/0.1";
export const SPEC_PIN_LOG_FORMAT = "tt-spec-pin-log/0.1";

/** The plain-language meaning of the status, shown wherever SPEC-CHANGED appears. */
export const SPEC_CHANGED_TEXT = "the spec moved; this test has not been re-checked";

export interface SpecFlag {
  /** The hash the vector carried (specHash, or schemaHash when only the schema moved; see `what`). */
  oldHash: string;
  newHash: string | null;
  /** The Trust Tasks commit the new text was read at. */
  tfCommit: string;
  /** YYYY-MM-DD. */
  detectedOn: string;
  /** Which hash moved. */
  what?: "spec" | "schema" | "removed";
}
export interface SpecFlagsFile { format: typeof SPEC_FLAGS_FORMAT; flags: Record<string, SpecFlag> }

export const DECISIONS = ["still-correct", "vector-changed", "exception-changed"] as const;
export type Decision = (typeof DECISIONS)[number];
export interface PinLogEntry {
  vector: string;
  oldHash: string | null;
  newHash: string | null;
  tfCommit: string;
  decision: Decision;
  /** True for the quick path: wording-only change, no semantic change (decision still-correct only). */
  wordingOnly?: true;
  reviewer: string;
  /** YYYY-MM-DD. */
  date: string;
}
export interface PinLogFile { format: typeof SPEC_PIN_LOG_FORMAT; log: PinLogEntry[] }

export function loadSpecFlags(path = SPEC_FLAGS_FILE): Record<string, SpecFlag> {
  if (!existsSync(path)) return {};
  return (JSON.parse(readFileSync(path, "utf8")) as SpecFlagsFile).flags ?? {};
}
export function loadPinLog(path = SPEC_PIN_LOG_FILE): PinLogEntry[] {
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf8")) as PinLogFile).log ?? [];
}

export function validateSpecFlags(parsed: unknown): string[] {
  const p: string[] = [];
  const f = parsed as Partial<SpecFlagsFile> | null;
  if (f === null || typeof f !== "object") return ["not an object"];
  if (f.format !== SPEC_FLAGS_FORMAT) p.push(`format must be ${SPEC_FLAGS_FORMAT}`);
  if (typeof f.flags !== "object" || f.flags === null || Array.isArray(f.flags)) return [...p, "flags must be an object keyed by vector id"];
  for (const [id, x] of Object.entries(f.flags)) {
    if (typeof x.oldHash !== "string" || x.oldHash === "") p.push(`flags.${id}.oldHash required`);
    if (x.newHash !== null && typeof x.newHash !== "string") p.push(`flags.${id}.newHash must be a string or null (null: the cited text was removed)`);
    if (typeof x.tfCommit !== "string" || !/^[0-9a-f]{40}$/.test(x.tfCommit)) p.push(`flags.${id}.tfCommit must be a full commit`);
    if (typeof x.detectedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.detectedOn)) p.push(`flags.${id}.detectedOn must be YYYY-MM-DD`);
  }
  return p;
}

export function validatePinLog(parsed: unknown): string[] {
  const p: string[] = [];
  const f = parsed as Partial<PinLogFile> | null;
  if (f === null || typeof f !== "object") return ["not an object"];
  if (f.format !== SPEC_PIN_LOG_FORMAT) p.push(`format must be ${SPEC_PIN_LOG_FORMAT}`);
  if (!Array.isArray(f.log)) return [...p, "log must be an array"];
  for (const [i, x] of f.log.entries()) {
    for (const k of ["vector", "reviewer"] as const) if (typeof x[k] !== "string" || x[k] === "") p.push(`log[${i}].${k} required`);
    if (!(DECISIONS as readonly string[]).includes(x.decision)) p.push(`log[${i}].decision must be one of ${DECISIONS.join(", ")}`);
    if (x.wordingOnly !== undefined && (x.wordingOnly !== true || x.decision !== "still-correct")) p.push(`log[${i}].wordingOnly is allowed only as true with decision still-correct`);
    if (typeof x.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) p.push(`log[${i}].date must be YYYY-MM-DD`);
    if (typeof x.tfCommit !== "string" || !/^[0-9a-f]{40}$/.test(x.tfCommit)) p.push(`log[${i}].tfCommit must be a full commit`);
  }
  return p;
}
