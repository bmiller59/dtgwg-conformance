// SPDX-License-Identifier: Apache-2.0
// The explicit map from run folders to platforms (decision D300). A run folder is assigned to a platform by an entry in
// results/platform-run-map.json, never by guessing from its name: a folder that is not in the map is reported and read for nothing.
import { existsSync, readFileSync } from "node:fs";

export type PlatformId = "vti" | "keyring-wallet";
export const PLATFORM_IDS: PlatformId[] = ["vti", "keyring-wallet"];

export interface RunMapEntry {
  /** Run folder path relative to the run-records root it is read from (`runs/2026-11-19-final-upstream-keyring-wallet`, `kw-upstream-shim`); every results file below it belongs to the entry. */
  folder: string;
  platform: PlatformId;
  /** What was measured: shim, didcomm, emit, 2l, gap-shim, agent, community, witness-server. */
  surface: string;
  /** The code revision the run README names, or why it is not known. */
  checkout: string;
  date: string;
}

export interface CeremonyRowEntry {
  /** Ceremony row folder under `ceremonies/` of the results directory. */
  row: string;
  /** The wallet platform that took part, or null when the row has no wallet. Ceremony outcomes are an overlay, never conformance counts. */
  platform: PlatformId | null;
  note: string;
}

export interface RunMap {
  format: "tt-platform-run-map/0.1";
  about: string;
  runs: RunMapEntry[];
  ceremonyRows: CeremonyRowEntry[];
  /** Run folders that are read but belong to no measured platform (reference adapter, truststackers, witness oracle). */
  notPlatform: string[];
}

export function parseRunMap(text: string): RunMap {
  const j = JSON.parse(text) as RunMap;
  if (j.format !== "tt-platform-run-map/0.1") throw new Error(`run map: unknown format ${String(j.format)}`);
  const seen = new Set<string>();
  for (const r of j.runs) {
    if (!PLATFORM_IDS.includes(r.platform)) throw new Error(`run map: unknown platform ${String(r.platform)} for ${r.folder}`);
    if (seen.has(r.folder)) throw new Error(`run map: folder listed twice: ${r.folder}`);
    seen.add(r.folder);
  }
  for (const c of j.ceremonyRows) if (c.platform !== null && !PLATFORM_IDS.includes(c.platform)) throw new Error(`run map: unknown platform ${String(c.platform)} for ceremony row ${c.row}`);
  return j;
}

export function loadRunMap(path: string): RunMap {
  if (!existsSync(path)) throw new Error(`run map not found: ${path} (see results/platform-run-map.json and docs/22)`);
  return parseRunMap(readFileSync(path, "utf8"));
}

const under = (folder: string, key: string): boolean => folder === key || folder.startsWith(`${key}/`);

/** The entry a results file's folder belongs to (the longest matching key); undefined when the folder is not in the map. */
export function entryOf(map: RunMap, folder: string): RunMapEntry | undefined {
  let best: RunMapEntry | undefined;
  for (const e of map.runs) if (under(folder, e.folder) && (best === undefined || e.folder.length > best.folder.length)) best = e;
  return best;
}

export const isNotPlatform = (map: RunMap, folder: string): boolean => map.notPlatform.some((k) => under(folder, k));

/** The run-folder key (the part a map entry would name) of a results file's folder: `runs/<name>` under a results set, the first path part otherwise. */
export function keyOf(folder: string): string {
  const parts = folder.split("/");
  return parts[0] === "runs" && parts.length > 1 ? `runs/${parts[1]}` : (parts[0] as string);
}
