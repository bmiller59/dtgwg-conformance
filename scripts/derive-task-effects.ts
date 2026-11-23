// SPDX-License-Identifier: Apache-2.0
// Writes vectors-src/task-effects.json: the effect (sideEffects.level of the front matter; none = read-only) of EVERY task version in a task-force
// checkout or archive (R-05), so the runner can derive the safety tag of a vector that carries none.
//   node --experimental-strip-types scripts/derive-task-effects.ts <task-force dir with specs/> <commit label>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { effectOf } from "../src/coverage/task-facts.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [dir, label] = process.argv.slice(2);
if (dir === undefined || label === undefined) { console.error("usage: derive-task-effects.ts <task-force dir> <commit label>"); process.exit(2); }
const specs = join(dir, "specs");
const effects: Record<string, string> = {};
let none = 0;
const walk = (d: string, rel: string): void => {
  for (const n of readdirSync(d).sort()) {
    const p = join(d, n);
    if (n === "spec.md") {
      const m = /^(.*)\/(\d+\.\d+)$/.exec(rel);
      if (m === null) continue;
      const e = effectOf(readFileSync(p, "utf8"));
      if (e === null) { none++; effects[`https://trusttasks.org/spec/${m[1]}/${m[2]}`] = "mutating"; } else effects[`https://trusttasks.org/spec/${m[1]}/${m[2]}`] = e;
    } else if (statSync(p).isDirectory()) walk(p, rel === "" ? n : `${rel}/${n}`);
  }
};
walk(specs, "");
const sorted = Object.fromEntries(Object.entries(effects).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(root, "vectors-src", "task-effects.json"), JSON.stringify({ format: "tt-task-effects/0.1", note: "sideEffects.level of every task version's spec.md (none = read-only; a spec that states none is treated as mutating, the safe reading). Derived by scripts/derive-task-effects.ts; the runner uses it for a vector with no effect tag (R-05).", tfCommit: label, tasks: Object.keys(sorted).length, statesNoLevel: none, effects: sorted }, null, 1) + "\n");
console.log(`${Object.keys(sorted).length} task versions at ${label} (${none} state no sideEffects level, read as mutating)`);
