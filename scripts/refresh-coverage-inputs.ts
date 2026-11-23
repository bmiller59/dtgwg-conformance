// SPDX-License-Identifier: Apache-2.0
// Vendor the task force's own invalid payload examples (specs/<slug>/<version>/payload.invalid-examples.json) for the types in the
// coverage census into vectors-src/coverage/tf-invalid-examples.json, so the coverage generator runs offline and is reproducible.
//   node --experimental-strip-types scripts/refresh-coverage-inputs.ts --kit <task-force checkout> [--check]
// These examples are the task force's text, not derived from the registry schema: they are the independent input of the probes that
// use them (a vector generated from the registry schema alone is not independent evidence of that schema).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTfManifest } from "../src/vectors/tfref.ts";
import { INVALID_EXAMPLES_FILE, loadCensus, type InvalidExample } from "../src/coverage/families.ts";

const argv = process.argv.slice(2);
const kit = argv[argv.indexOf("--kit") + 1];
if (!argv.includes("--kit") || kit === undefined) { console.error("pass --kit <task-force checkout>"); process.exit(2); }
const examples: Record<string, InvalidExample[]> = {};
for (const r of loadCensus()) {
  const dir = join(kit, "specs", r.slug, r.version);
  const p = join(dir, "payload.invalid-examples.json");
  if (!existsSync(p)) continue;
  const list = JSON.parse(readFileSync(p, "utf8")) as InvalidExample[];
  // A list task whose specification says it clamps `limit` serves a `limit` above the maximum: the clamp is documented behaviour, not an error.
  const clamps = /\bclamped to\b/.test(readFileSync(join(dir, "spec.md"), "utf8"));
  if (list.length > 0) examples[r.type] = list.map((e) => ({ note: e.note, payload: e.payload, ...(clamps && /^`limit`/.test(e.note) && /\b(above|capped)\b/.test(e.note) ? { clamped: true as const } : {}) }));
}
const out = { format: "tt-coverage-invalid-examples/0.1", kit: `Trust Tasks task-force repository, origin/main ${loadTfManifest().main.commit} (status draft)`, examples };
const text = JSON.stringify(out, null, 1) + "\n";
if (argv.includes("--check")) { process.exit(readFileSync(INVALID_EXAMPLES_FILE, "utf8") === text ? 0 : 1); }
writeFileSync(INVALID_EXAMPLES_FILE, text);
console.log(`${Object.keys(examples).length} types, ${Object.values(examples).reduce((n, l) => n + l.length, 0)} examples`);
