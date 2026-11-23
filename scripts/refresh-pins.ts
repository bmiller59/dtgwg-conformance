// SPDX-License-Identifier: Apache-2.0
// Refresh the pinned digests of every vector's source (docs/04 section 18.4). Run:
//   node --experimental-strip-types scripts/refresh-pins.ts [--kit <task-force checkout>] [--check] [--ref <prefix>]
// Reads the current text or schema of each source the vectors name, writes vectors/pins.json and regenerates the vector files, so
// every vector's `source.pinnedDigest` follows. This is the human act of re-reading what changed and accepting it: the digest of a
// source that is not available locally is NOT changed (reported instead). `--check` writes nothing and lists the pins that would change.
// `--ref <prefix>` limits the refresh to sources whose ref starts with the prefix (for example `kit:specs/credential-exchange`).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentDigest, defaultKitRoot, loadPins, PINS_FILE, SUITE_ROOT } from "../src/vectors/source.ts";
import type { PinsFile } from "../src/vectors/source.ts";

const argv = process.argv.slice(2);
let kitArg: string | undefined;
let check = false;
let only = "";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--kit") kitArg = argv[++i];
  else if (argv[i] === "--check") check = true;
  else if (argv[i] === "--ref") only = argv[++i] ?? "";
  else throw new Error(`unknown option ${argv[i]}`);
}
const kit = defaultKitRoot(kitArg);
const GENERATORS = ["generate-vectors.ts", "generate-plain.ts", "generate-emit.ts", "generate-emit-more.ts", "generate-witness-vectors.ts"];
const regenerate = (): void => {
  for (const g of GENERATORS) execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(SUITE_ROOT, "scripts", g)], { cwd: SUITE_ROOT, stdio: "pipe" });
};

/** Every source ref the generated vectors name, with the vectors that use it. */
function refsInUse(): Map<string, number> {
  const refs = new Map<string, number>();
  for (const dir of ["vectors", "vectors/plain", "vectors/emit", "vectors/emit-more", "vectors/witness"]) {
    const manifest = JSON.parse(readFileSync(join(SUITE_ROOT, dir, "manifest.json"), "utf8")) as { files: string[] };
    for (const f of manifest.files) {
      const file = JSON.parse(readFileSync(join(SUITE_ROOT, dir, f), "utf8")) as { vectors: { source?: { ref: string } }[] };
      for (const v of file.vectors) if (v.source !== undefined) refs.set(v.source.ref, (refs.get(v.source.ref) ?? 0) + 1);
    }
  }
  // the ceremony scenarios (docs/25) cite the specification of each step they send (`source.ref`): those sources are pinned the same way
  const sdir = join(SUITE_ROOT, "vectors", "ceremony-scenarios");
  const sm = JSON.parse(readFileSync(join(sdir, "scenarios-manifest.json"), "utf8")) as { files: string[] };
  for (const f of sm.files) {
    const file = JSON.parse(readFileSync(join(sdir, f), "utf8")) as { scenarios: { source?: { ref?: string }; steps: { source?: { ref?: string }; also?: { ref?: string }[] }[] }[] };
    for (const sc of file.scenarios) for (const x of [sc.source, ...sc.steps.flatMap((st) => [st.source, ...(st.also ?? [])])]) if (typeof x?.ref === "string") refs.set(x.ref, (refs.get(x.ref) ?? 0) + 1);
  }
  return refs;
}

if (!check) regenerate(); // make sure every vector names its source before reading the refs
const old = loadPins();
const next: Record<string, string> = { ...old };
const changed: string[] = [];
const unavailable: string[] = [];
const refs = refsInUse();
for (const ref of [...refs.keys()].sort()) {
  if (!ref.startsWith(only)) continue;
  const cur = currentDigest(ref, { kit, suite: SUITE_ROOT });
  if (cur === null) { unavailable.push(ref); continue; }
  if (old[ref] !== cur) { changed.push(`${ref}: ${old[ref] ?? "(unpinned)"} -> ${cur}`); next[ref] = cur; }
}
for (const ref of Object.keys(next)) if (!refs.has(ref)) delete next[ref]; // a source no vector names any more
console.log(`${refs.size} sources, ${changed.length} pin(s) ${check ? "would change" : "changed"}, ${unavailable.length} not available locally${kit === undefined ? " (no task-force checkout: pass --kit or set TT_KIT)" : ""}`);
for (const c of changed) console.log(`  ${c}`);
for (const u of unavailable) console.log(`  not available, pin kept: ${u}`);
if (!check) {
  const file: PinsFile = { format: "tt-conformance-pins/0.1", pins: Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1))) };
  if (!existsSync(PINS_FILE) || JSON.stringify(file) !== JSON.stringify(JSON.parse(readFileSync(PINS_FILE, "utf8")))) writeFileSync(PINS_FILE, JSON.stringify(file, null, 2) + "\n");
  regenerate();
}
