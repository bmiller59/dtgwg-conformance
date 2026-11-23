// SPDX-License-Identifier: Apache-2.0
// Re-maps the outcomes in a ceremony run record made before the runner mapped "not offered by the row" to skipped (D528): a scenario the row cannot play
// (a stand-in or deployment limit, class D) was recorded as `failed` with a participant error; it is skipped with that reason. A scenario that failed for any
// other reason is left as it is. The record gets a `reclassified` list (id, old status) so nothing is hidden. The source folder is never modified.
// Usage: node --experimental-strip-types src/ceremony/reclassify.ts <source run folder> <new folder>
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_OFFERED } from "./runner.ts";

interface Entry { id: string; status: string; reason: string; failedStep?: string | null; terminal?: string | null; participants?: Record<string, { mode?: string }> }
interface Record_ { participants?: Record<string, string>; results: Entry[]; reclassified?: { id: string; from: string }[]; [k: string]: unknown }

/** The reason in the form the runner now writes, or null when the failure is not a "not offered" one. `wire` is whether a participant of the record runs in wire mode. */
export function notOfferedReason(reason: string, wire: boolean): string | null {
  const m = reason.replace(/^participant error: /, "");
  if (m.startsWith(NOT_OFFERED)) return m;
  const clock = /^the wire participant has no trigger (clockOffset) \(a real wire has real time\)$/.exec(m);
  if (clock !== null) return `${NOT_OFFERED} the wire participant has no trigger ${clock[1]} (a real wire has real time)`;
  const replay = /^step (\S+) built no document (\d+) to replay$/.exec(m);
  if (replay !== null && wire) return `${NOT_OFFERED} the harness cannot replay document ${replay[2]} of step ${replay[1]}, which the wire participant did not hand over (it builds and sends its own documents)`;
  return null;
}

export function reclassify(rec: Record_): Record_ {
  const wireOf = (r: Entry): boolean => Object.values(r.participants ?? {}).some((p) => p.mode?.startsWith("wire:") === true);
  const done: { id: string; from: string }[] = [];
  const results = rec.results.map((r) => {
    if (r.status !== "failed") return r;
    const why = notOfferedReason(r.reason, wireOf(r));
    if (why === null) return r;
    done.push({ id: r.id, from: r.status });
    return { ...r, status: "skipped", reason: why };
  });
  return { ...rec, results, reclassified: [...(rec.reclassified ?? []), ...done] };
}

if (process.argv[1]?.endsWith("reclassify.ts")) {
  const [src, dst] = process.argv.slice(2);
  if (src === undefined || dst === undefined || existsSync(dst)) throw new Error("usage: reclassify.ts <source run folder> <new folder (must not exist)>");
  mkdirSync(dst, { recursive: true });
  for (const f of ["run.json", "transcript.jsonl"]) if (existsSync(join(src, f))) cpSync(join(src, f), join(dst, f));
  const out = reclassify(JSON.parse(readFileSync(join(src, "scenario-result.json"), "utf8")) as Record_);
  writeFileSync(join(dst, "scenario-result.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.reclassified!.length} reclassified: ${out.reclassified!.map((r) => r.id).join(", ")}`);
}
