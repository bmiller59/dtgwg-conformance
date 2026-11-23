// SPDX-License-Identifier: Apache-2.0
// Copies the task force's shared fixtures into vectors/imported/ and records provenance.
//   node --experimental-strip-types scripts/import-fixtures.ts <path to a dtgwg-trust-tasks-tf checkout or snapshot> [commit]
// The commit argument is the source revision, when known. A snapshot without version-control
// metadata has no recoverable commit; provenance then says so instead of guessing.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "../vectors/imported");
const src = process.argv[2];
const commit = process.argv[3] ?? null;
if (src === undefined) {
  console.error("usage: import-fixtures.ts <tf-root> [commit]");
  process.exit(2);
}
const files: { path: string; sha256: string }[] = [];
for (const dir of ["consume", "proof"]) {
  mkdirSync(join(dest, dir), { recursive: true });
  for (const name of readdirSync(join(src, "fixtures", dir)).filter((n) => n.endsWith(".json")).sort()) {
    const from = join(src, "fixtures", dir, name);
    copyFileSync(from, join(dest, dir, name));
    files.push({ path: `${dir}/${name}`, sha256: createHash("sha256").update(readFileSync(from)).digest("hex") });
  }
}
// The receipt specification's own payload schema and invalid examples (group RCPT): specs/trust-ceremony-receipt/0.1/.
mkdirSync(join(dest, "receipt"), { recursive: true });
for (const name of ["payload.invalid-examples.json", "payload.schema.json"]) {
  const from = join(src, "specs", "trust-ceremony-receipt", "0.1", name);
  copyFileSync(from, join(dest, "receipt", name));
  files.push({ path: `receipt/${name}`, sha256: createHash("sha256").update(readFileSync(from)).digest("hex") });
}
const provenance = {
  source: "dtgwg-trust-tasks-tf, fixtures/consume and fixtures/proof, and specs/trust-ceremony-receipt/0.1 (payload schema and invalid examples)",
  commit,
  commitNote:
    commit === null
      ? "UNKNOWN: the source was a snapshot without version-control metadata, so no commit could be recorded. The runtime package version below was current in that snapshot. Re-run this script against a checkout and pass the commit to replace this note."
      : "the task-force commit the files were copied from, as given when this script was run",
  runtimePackage: "@openvtc/trust-tasks 0.29.0",
  importedOn: new Date().toISOString().slice(0, 10),
  files,
};
writeFileSync(join(dest, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");
console.log(`imported ${files.length} files`);
