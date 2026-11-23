// SPDX-License-Identifier: Apache-2.0
// Writes vectors-src/complete/reply-required.json: the task versions whose own text puts an error reply to a rejection inside a MUST (src/coverage/reply-required.ts, O-01).
//   node --experimental-strip-types scripts/derive-reply-required.ts <task-force checkout at the pinned commit> [--check]
// The checkout is read only. With --check the file is compared and nothing is written (exit 1 when it differs).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replyRequiredClause } from "../src/coverage/reply-required.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const kit = args.find((a) => !a.startsWith("--"));
if (kit === undefined) { console.error("usage: derive-reply-required.ts <task-force checkout> [--check]"); process.exit(2); }
const OUT = join(root, "vectors-src", "complete", "reply-required.json");
const specs = join(kit, "specs");
const required: Record<string, { line: number; text: string }> = {};
let scanned = 0;
const walk = (dir: string, rel: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) walk(join(dir, e.name), rel === "" ? e.name : `${rel}/${e.name}`);
    else if (e.name === "spec.md" && /\/\d+\.\d+$/.test(rel)) {
      scanned++;
      const c = replyRequiredClause(readFileSync(join(dir, e.name), "utf8"));
      if (c !== null) required[`https://trusttasks.org/spec/${rel}`] = c;
    }
  }
};
walk(specs, "");
const commit = (() => { try { return readFileSync(join(kit, ".git", "HEAD"), "utf8").trim(); } catch { return "bd0c05013 (snapshot; no .git)"; } })();
const body = JSON.stringify({ format: "tt-reply-required/0.1", note: "Task versions whose spec.md puts the error reply to a rejection inside a MUST (a consumer MUST list item or sentence that returns, answers or replies with a trust-task-error). SPEC.md 7.2 makes that reply a SHOULD for every other task (O-01). Written by scripts/derive-reply-required.ts from the task-force specification text; an ambiguous task is kept here (its silence stays a FAIL).", tfCommit: "bd0c05013", scanned, required }, null, 1) + "\n";
if (args.includes("--check")) { let cur = ""; try { cur = readFileSync(OUT, "utf8"); } catch { /* absent */ } process.exit(cur === body ? 0 : 1); }
writeFileSync(OUT, body);
console.log(`${Object.keys(required).length} of ${scanned} task versions require an error reply (${commit.slice(0, 12)})`);
