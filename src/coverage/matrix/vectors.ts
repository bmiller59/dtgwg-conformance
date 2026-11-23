// SPDX-License-Identifier: Apache-2.0
// Which task versions the suite's vectors reference, read from every generated vector file under vectors/ (default-run sets,
// emit, emit-more, 2l, coverage, probe, plain, witness and the rest), plus the ceremony scenario files.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TYPE_BASE } from "./specs.ts";

export interface VectorInfo {
  id: string;
  group: string;
  /** The folder under vectors/ the file is in (`emit`, `coverage`, `2l` ...); `.` for files directly under vectors/. */
  set: string;
  /** The vector's own channel (registry, proposed, candidate) when it states one. */
  channel: string;
  tasks: string[];
  text: string;
}

export interface ScenarioFile {
  group: string;
  name: string;
  channel: string;
  ceremonyPaths: string[];
  ids: string[];
  tasks: string[];
  /** The Type URIs each scenario names, by scenario id (the ceremony overlay joins ceremony run records to these). */
  tasksById: Record<string, string[]>;
}

const SPEC_PATH_RE = /specs\/([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)\/spec\.md/g;
const URI_RE = /https:\/\/trusttasks\.org\/spec\/([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)(?![0-9.])/g;
const NOT_VECTORS = /(^|\/)(manifest|pins|tf-manifest|not-generated|clarify-classes|scenarios-manifest)\.json$/;

export function tasksReferencedBy(textBlob: string): string[] {
  const out = new Set<string>();
  for (const m of textBlob.matchAll(URI_RE)) out.add(`${TYPE_BASE}${m[1]}/${m[2]}`);
  for (const m of textBlob.matchAll(SPEC_PATH_RE)) out.add(`${TYPE_BASE}${m[1]}/${m[2]}`);
  return [...out].sort();
}

function jsonFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${n}` : n;
    if (n === "imported") continue; // imported task-force fixtures use their own format
    if (statSync(join(dir, n)).isDirectory()) out.push(...jsonFiles(join(dir, n), rel));
    else if (n.endsWith(".json") && !NOT_VECTORS.test(rel)) out.push(rel);
  }
  return out;
}

export function loadVectors(root: string): { vectors: VectorInfo[]; scenarios: ScenarioFile[] } {
  const vectors: VectorInfo[] = [];
  const scenarios: ScenarioFile[] = [];
  const dir = join(root, "vectors");
  if (!existsSync(dir)) return { vectors, scenarios };
  for (const f of jsonFiles(dir)) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const set = f.includes("/") ? (f.split("/")[0] as string) : ".";
    // the advisory alignment set (docs/tf-alignment.md) is outside every coverage and first-share figure, and never holds a task back from another set
    if (set === "alignment") continue;
    if (Array.isArray(j["vectors"])) {
      for (const v of j["vectors"] as { id: string; source?: { channel?: string } }[]) {
        const t = JSON.stringify(v);
        vectors.push({ id: v.id, group: String(j["group"]), set, channel: v.source?.channel ?? "registry", tasks: tasksReferencedBy(t), text: t });
      }
    } else if (Array.isArray(j["scenarios"])) {
      const t = JSON.stringify(j);
      const c = (j["ceremony"] ?? {}) as { name?: string; channel?: string };
      scenarios.push({
        group: String(j["group"]),
        name: c.name ?? String(j["group"]),
        channel: c.channel ?? "proposed",
        ceremonyPaths: [...new Set([...t.matchAll(/ceremonies\/([a-z0-9][a-z0-9/-]*?)\/\d+\.\d+/g)].map((m) => m[1] as string))],
        ids: (j["scenarios"] as { id: string }[]).map((s) => s.id),
        tasks: tasksReferencedBy(t),
        tasksById: Object.fromEntries((j["scenarios"] as { id: string }[]).map((sc) => [sc.id, tasksReferencedBy(JSON.stringify(sc))])),
      });
    }
  }
  return { vectors, scenarios };
}
