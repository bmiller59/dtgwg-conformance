// SPDX-License-Identifier: Apache-2.0
// Per-platform vector statuses from run records (one or more results directories: SUITE_RESULTS_DIR, or folders of coverage run folders).
// A run folder is assigned to a platform by the explicit map in results/platform-run-map.json (src/coverage/matrix/runmap.ts), never by its name.
// Run records are held outside the repository; without them every platform column reads `not-run` where vectors exist.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { entryOf, isNotPlatform, keyOf, PLATFORM_IDS, type PlatformId, type RunMap } from "./runmap.ts";
import type { PlatformInfo, PlatformStatus } from "./types.ts";

/** The measured platforms, in the order VTI, keyring-wallet . The reference adapter is not a platform. */
export const PLATFORMS: (PlatformInfo & { id: PlatformId })[] = [
  { id: "vti", label: "VTI", runs: [], note: "agent, community and emit surfaces merged" },
  { id: "keyring-wallet", label: "keyring-wallet", runs: [], note: "shim, DIDComm v1 and v2, emit and 2L surfaces merged" },
];

export const EXECUTED = new Set(["PASS", "FAIL", "KNOWN-FAIL", "CLARIFY"]);

interface Block {
  results?: { id: string; status: string; reason?: string }[];
}

export interface RunRecord {
  folder: string;
  id: string;
  status: string;
  reason?: string;
}

function blocksOf(j: unknown): Block[] {
  if (Array.isArray(j)) return j as Block[];
  if (j && typeof j === "object") return Object.values(j as Record<string, Block>);
  return [];
}

/** Every results.json and results-advisory.json under `dir`, as (run folder relative to `dir`, vector id, status, reason). */
export function readRunResults(dir: string): RunRecord[] {
  const out: RunRecord[] = [];
  if (!existsSync(dir)) return out;
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "results.json" || e.name === "results-advisory.json") {
        try {
          for (const b of blocksOf(JSON.parse(readFileSync(p, "utf8")))) for (const r of b.results ?? []) out.push({ folder: relative(dir, d), id: r.id, status: r.status, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
        } catch {
          /* an unreadable record is left out */
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** One status per platform and vector id: an executed result beats a SKIP. Only folders the run map assigns to a platform are read. */
export function statusesByPlatform(records: RunRecord[], map: RunMap): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>(PLATFORM_IDS.map((p) => [p, new Map<string, string>()]));
  for (const r of records) {
    const e = entryOf(map, r.folder);
    if (!e) continue;
    const m = out.get(e.platform) as Map<string, string>;
    const prev = m.get(r.id);
    if (!prev || (!EXECUTED.has(prev) && EXECUTED.has(r.status))) m.set(r.id, r.status);
  }
  return out;
}

/** Every record of a platform for the vectors a participation row needs: status, the first SKIP reason, and the surfaces it was seen on. */
export interface VectorSeen {
  /** Best status over all runs (an executed result beats a SKIP; among executed, FAIL > KNOWN-FAIL > CLARIFY > PASS is kept as the worst). */
  status: string;
  skipReason?: string;
  surfaces: string[];
}

const WORST = ["FAIL", "KNOWN-FAIL", "CLARIFY", "PASS"];

/** Latest-record view per platform and vector: the worst executed status (so a difference is never hidden by a later pass), else SKIP. */
export function detailsByPlatform(records: RunRecord[], map: RunMap): Map<string, Map<string, VectorSeen>> {
  const out = new Map<string, Map<string, VectorSeen>>(PLATFORM_IDS.map((p) => [p, new Map<string, VectorSeen>()]));
  for (const r of records) {
    const e = entryOf(map, r.folder);
    if (!e) continue;
    const m = out.get(e.platform) as Map<string, VectorSeen>;
    const prev = m.get(r.id);
    if (!prev) {
      m.set(r.id, { status: r.status, ...(r.reason !== undefined && r.status === "SKIP" ? { skipReason: r.reason } : {}), surfaces: [e.surface] });
      continue;
    }
    if (!prev.surfaces.includes(e.surface)) prev.surfaces.push(e.surface);
    if (EXECUTED.has(r.status) && !EXECUTED.has(prev.status)) {
      prev.status = r.status;
      delete prev.skipReason;
    } else if (EXECUTED.has(r.status) && EXECUTED.has(prev.status) && WORST.indexOf(r.status) < WORST.indexOf(prev.status)) prev.status = r.status;
    else if (!EXECUTED.has(prev.status) && prev.skipReason === undefined && r.reason !== undefined) prev.skipReason = r.reason;
  }
  return out;
}

/** Run folders (keys) that hold results but are in neither the platform list nor the not-a-platform list of the map. */
export function unmappedFolders(records: RunRecord[], map: RunMap): string[] {
  const out = new Set<string>();
  for (const r of records) if (!entryOf(map, r.folder) && !isNotPlatform(map, r.folder)) out.add(keyOf(r.folder));
  return [...out].sort();
}

export function taskStatus(vectorIds: string[], statuses: Map<string, string>): PlatformStatus {
  if (vectorIds.length === 0) return "none";
  const seen = vectorIds.map((v) => statuses.get(v)).filter((s): s is string => s !== undefined);
  if (seen.length === 0) return "not-run";
  return seen.some((s) => EXECUTED.has(s)) ? "covered" : "skip";
}

/** Run surface (from the run map) to the VTI surface it exercises: the agent and community services answer, the emit surface is the client builders' side; anything else (2L, shim, didcomm) is no VTI surface. */
export function vtiSurfaceOfRun(surface: string): "vta" | "vtc" | "client" | null {
  if (/^(gap-)?agent/.test(surface)) return "vta";
  if (/^(gap-)?community/.test(surface)) return "vtc";
  if (/^(gap-)?emit/.test(surface) || surface === "2l") return "client";
  return null;
}

/** Like `detailsByPlatform`, but kept apart per VTI surface (`<platform>/<vta|vtc|client>`): a vector's status on a surface is the worst executed result of the runs of that surface alone. */
export function detailsByVtiSurface(records: RunRecord[], map: RunMap): Map<string, Map<string, VectorSeen>> {
  const out = new Map<string, Map<string, VectorSeen>>();
  for (const r of records) {
    const e = entryOf(map, r.folder);
    if (!e || (e.platform !== "vti")) continue;
    const s = vtiSurfaceOfRun(e.surface);
    if (s === null) continue;
    const key = `${e.platform}/${s}`;
    const m = out.get(key) ?? out.set(key, new Map<string, VectorSeen>()).get(key) as Map<string, VectorSeen>;
    const prev = m.get(r.id);
    if (!prev) {
      m.set(r.id, { status: r.status, ...(r.reason !== undefined && r.status === "SKIP" ? { skipReason: r.reason } : {}), surfaces: [e.surface] });
      continue;
    }
    if (!prev.surfaces.includes(e.surface)) prev.surfaces.push(e.surface);
    if (EXECUTED.has(r.status) && !EXECUTED.has(prev.status)) {
      prev.status = r.status;
      delete prev.skipReason;
    } else if (EXECUTED.has(r.status) && EXECUTED.has(prev.status) && WORST.indexOf(r.status) < WORST.indexOf(prev.status)) prev.status = r.status;
  }
  return out;
}
