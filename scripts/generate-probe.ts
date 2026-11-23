// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/probe/ (the seeded-state probe, docs/22, decision CV-16). Run:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/generate-probe.ts [outDir]
// Reads the committed vectors/coverage/ (run generate-coverage.ts first) and derives, from each held finding's vector, a vector that
// first creates the object the request names through the platform's own task, then re-sends the schema-invalid payloads naming it.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFiles } from "../src/coverage/probe.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = process.argv[2] === undefined ? join(root, "vectors", "probe") : resolve(process.argv[2]);
const covDir = join(root, "vectors", "coverage");
const byId = new Map<string, Vector>();
for (const f of (JSON.parse(readFileSync(join(covDir, "manifest.json"), "utf8")) as { files: string[] }).files) {
  for (const v of (JSON.parse(readFileSync(join(covDir, f), "utf8")) as VectorFile).vectors) byId.set(v.id, v);
}
const { files, map } = probeFiles(byId);
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".json")) rmSync(join(outDir, f));
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 1) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 1) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} probe vectors`);
for (const m of map) console.log(`  ${m.probe} from ${m.of}: ${m.kept} step(s) kept, ${m.dropped} left out (the identifier itself is invalid or absent)`);
