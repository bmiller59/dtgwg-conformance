// SPDX-License-Identifier: Apache-2.0
// Writes vectors-src/complete/task-facts.json: for every task of vectors-src/complete/scope.json, the facts its own spec.md states
// (src/coverage/task-facts.ts), read with `git show <commit>:specs/<slug>/<version>/spec.md` from a task-force clone. Read-only on the clone.
//   node --experimental-strip-types scripts/derive-task-facts.ts <task-force clone> [commit] [--since <older commit>]   (default commit: the scope's task-force input)
// With --since, each task also records whether its whole directory (spec.md, schemas, invalid examples) is byte-identical at the older commit:
// the generator re-pins a vector that cited the older commit to the newer one only for a task so recorded (F-12).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scope } from "../src/coverage/completeness.ts";
import { factsOf } from "../src/coverage/task-facts.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const si = argv.indexOf("--since");
const since = si >= 0 ? argv[si + 1] : undefined;
const [clone, commitArg] = argv.filter((a, i) => a !== "--since" && i !== si + 1 || (si < 0));
if (clone === undefined) { console.error("usage: derive-task-facts.ts <task-force clone> [commit]"); process.exit(2); }
const scope = JSON.parse(readFileSync(join(root, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;
const commit = commitArg ?? scope.inputs["task force repository (origin/main)"]!;
const full = execFileSync("git", ["-C", clone, "rev-parse", commit], { encoding: "utf8" }).trim();
const git = (...a: string[]): string => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const sinceFull = since === undefined ? undefined : git("rev-parse", since);
const tree = (c: string, t: { slug: string; version: string }): string | null => { try { return git("rev-parse", `${c}:specs/${t.slug}/${t.version}`); } catch { return null; } };
// S-01: task versions that are not the latest (so not in the scope) but that a vector asserts a response from: the reachable-code audit (src/coverage/reachable.ts)
// needs their front-matter codes too. test/fixes3.test.ts fails when an asserting step names a task that has no facts.
const AUDITED_OLDER_VERSIONS = ["witness/session/0.1", "witness/session/submit/0.1", "rooms/create/0.2"];
const older = AUDITED_OLDER_VERSIONS.filter((x) => !scope.tasks.some((t) => `${t.slug}/${t.version}` === x)).map((x) => ({ typeUri: `https://trusttasks.org/spec/${x}`, slug: x.replace(/\/[^/]*$/, ""), version: x.replace(/^.*\//, "") }));
const facts = [...scope.tasks, ...older].map((t) => ({ ...factsOf(t.typeUri, execFileSync("git", ["-C", clone, "show", `${full}:specs/${t.slug}/${t.version}/spec.md`], { encoding: "utf8", maxBuffer: 1 << 26 })), ...(sinceFull === undefined ? {} : { identicalSince: { commit: sinceFull, identical: tree(sinceFull, t) !== null && tree(sinceFull, t) === tree(full, t) } }) }));
writeFileSync(join(root, "vectors-src", "complete", "task-facts.json"), JSON.stringify({ format: "tt-complete-task-facts/0.1", note: "Read from each task's spec.md at the task-force commit below by scripts/derive-task-facts.ts (effect = sideEffects.level, none read as read-only). Citations are file line numbers in that spec.md.", tfCommit: full, tasks: facts }, null, 1) + "\n");
console.log(`${facts.length} tasks at ${full.slice(0, 9)}`);
