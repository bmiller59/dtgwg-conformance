// SPDX-License-Identifier: Apache-2.0
// Source survey behind the SKIP reasons of the VTI emit adapter (docs/19). For every Type URI of the emit catalogue that no VTI client
// builder in src/adapters/vti-emit/rust/src/flows.rs builds, it searches the pinned VTI checkout (read only) for the type's constant
// name and its URI outside the generated specification crates, tests and docs, and writes src/adapters/vti-emit/not-built.json:
// `emit:<type>` -> the evidence for "VTI has no builder for this type that the host can drive". Run:
//   VTI_ROOT=<VTI checkout at the pinned ref> node --experimental-strip-types scripts/survey-vti-emit.ts
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vti = process.env.VTI_ROOT;
if (vti === undefined) throw new Error("VTI_ROOT is required");
const BASE = "https://trusttasks.org/spec/";

const catalogue = new Set<string>();
for (const d of ["emit", "emit-more"]) for (const f of readdirSync(join(root, "vectors", d))) {
  if (f === "manifest.json") continue;
  for (const v of JSON.parse(readFileSync(join(root, "vectors", d, f), "utf8")).vectors) catalogue.add(v.steps[0].emit.type as string);
}
for (const f of readdirSync(join(root, "vectors", "2l"))) {
  if (f === "manifest.json") continue;
  for (const v of (JSON.parse(readFileSync(join(root, "vectors", "2l", f), "utf8")).vectors ?? [])) {
    const t = v.steps?.[0]?.emit?.type as string | undefined;
    if (t !== undefined) catalogue.add(t);
  }
}
// The coverage CE vectors (what a platform sends) name emit types too, among them types the emit and 2l catalogues do not.
for (const f of readdirSync(join(root, "vectors", "coverage"))) {
  if (!/^ce-.*\.json$/.test(f)) continue;
  for (const v of JSON.parse(readFileSync(join(root, "vectors", "coverage", f), "utf8")).vectors as { requires: string[] }[]) {
    for (const r of v.requires) if (r.startsWith("emit:")) catalogue.add(r.slice(5));
  }
}
const flows = readFileSync(join(root, "src/adapters/vti-emit/rust/src/flows.rs"), "utf8");
const built = new Map<string, string>(); // type -> method
for (const m of flows.matchAll(/^\s*"([^"]+)", "([\w:]+)",/gm)) built.set(BASE + m[1]!, m[2]!);
// Mobile-core builders are listed in a second table when present.
const bySlug = new Map<string, { versions: string[]; methods: string[] }>();
for (const [u, m] of built) {
  const mm = /^(.*)\/(\d+\.\d+)$/.exec(u.slice(BASE.length))!;
  const e = bySlug.get(mm[1]!) ?? { versions: [], methods: [] };
  e.versions.push(mm[2]!);
  e.methods.push(m);
  bySlug.set(mm[1]!, e);
}

const EXCLUDE = ["target", "vti-specs", "vti-specs-core", "vti-specs-rooms", "vti-specs-vta", "vti-specs-vtc", "vti-specs-vtn", "trust-tasks", "tests", "docs"];
function named(u: string): string[] {
  const mm = /^(.*)\/(\d+)\.(\d+)$/.exec(u.slice(BASE.length))!;
  const cn = "TASK_" + mm[1]!.toUpperCase().replace(/[/-]/g, "_") + `_${mm[2]}_${mm[3]}`;
  const files = new Set<string>();
  for (const pat of [`${cn}\\b`, u.replace(/\./g, "\\.") + '"']) {
    try {
      const out = execFileSync("grep", ["-rlE", pat, vti!, "--include=*.rs", ...EXCLUDE.map((e) => `--exclude-dir=${e}`)], { encoding: "utf8", maxBuffer: 1 << 24 });
      for (const l of out.split("\n")) if (l !== "" && !l.endsWith("/trust_tasks.rs")) files.add(l.slice(vti!.length + 1));
    } catch {
      /* grep exits 1 on no match */
    }
  }
  return [...files].sort();
}

const notBuilt: Record<string, string> = {};
for (const u of [...catalogue].sort()) {
  if (built.has(u)) continue;
  const mm = /^(.*)\/(\d+\.\d+)$/.exec(u.slice(BASE.length))!;
  const sib = bySlug.get(mm[1]!);
  const files = named(u);
  let why: string;
  if (sib !== undefined) why = `VTI's client builds ${mm[1]} at ${sib.versions.join(", ")} only (${[...new Set(sib.methods)].join(", ")}); no client method names ${mm[2]}`;
  else if (files.length === 0) why = "no VTI code outside the generated specification crates names this type, so no builder for it exists";
  else why = `named outside the specification crates only in ${files.slice(0, 4).join(", ")}${files.length > 4 ? ` (+${files.length - 4})` : ""}; no client builder that emits it was found, so it is built only where a live flow runs (handler, gateway or ceremony code) and the host cannot drive it`;
  notBuilt[`emit:${u}`] = why;
}
writeFileSync(join(root, "src/adapters/vti-emit/not-built.json"), JSON.stringify(notBuilt, null, 1) + "\n");
console.log(`${built.size} built, ${Object.keys(notBuilt).length} not built, of ${catalogue.size}`);
