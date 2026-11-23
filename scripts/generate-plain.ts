// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/plain/ (the plain-task family: layer 3a, the profiles proposed as 2L-1 and 2L-2; NOT core). Run:
//   node --experimental-strip-types scripts/generate-plain.ts [outDir]
// Every rule is read from the pinned @openvtc/trust-tasks 0.29.0 (a registry package; every registry spec is status draft): each task
// version's PAYLOAD_SCHEMA, RESPONSE_PAYLOAD_SCHEMA and SPEC policy (isProofRequired, isRecipientRequired, isIssuedAtRequired), plus the
// framework SPEC.md 7.2 consumer pipeline. No role, role meaning or authority rule is fixed here (docs/02 section 5): a role value is the
// token $role(n), taken from the adapter's declared governance.roles, and policy content is gated on governance.content.
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { applyErrorReply } from "../src/vectors/error-reply.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlainTasks, PLAIN_FAMILIES } from "../src/plain/catalog.ts";
import { build } from "../src/plain/build.ts";
import { loadPins, pkgSource, withSource } from "../src/vectors/source.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";
import { applyClarifyMeta, loadClarifyMeta } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] === undefined ? join(resolve(here, ".."), "vectors", "plain") : resolve(process.argv[2]);
const T0 = "2026-11-12T10:00:00Z";
const PKG = "@openvtc/trust-tasks 0.29.0 (registry package; the specification is status draft)";
const GROUPS: Record<string, string> = { acl: "PP-ACL", policy: "PP-POL", vault: "PP-VLT", device: "PP-DEV", auth: "PP-AUT" };

const tasks = loadPlainTasks().filter((t) => t.validPayload !== undefined);
const skipped = loadPlainTasks().filter((t) => t.validPayload === undefined).map((t) => t.typeUri);
const pins = loadPins();
const files: VectorFile[] = [];
for (const fam of PLAIN_FAMILIES) {
  const vectors: Vector[] = [];
  let n = 1;
  for (const t of tasks.filter((x) => x.family === fam)) {
    for (const v of build(t, PKG)) {
      v.id = `${GROUPS[fam]}-${String(n++).padStart(3, "0")}`;
      if ((v.mutants ?? []).length === 0) delete v.mutants;
      vectors.push(withSource(v, pkgSource(t, "0.29.0", pins)));
    }
  }
  files.push({ format: "tt-conformance-vectors/0.1", group: GROUPS[fam]!, family: "plain", clock: { start: T0 }, vectors });
}
mkdirSync(outDir, { recursive: true });
applyClarifyMeta(files, loadClarifyMeta(join(here, "..")));
applyErrorReply(files);
labelVersionRole(files);
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 2) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 2) + "\n");
writeFileSync(join(outDir, "not-generated.json"), JSON.stringify({ note: "Task versions in the pinned package for which the schema-driven generator could not build a minimal valid request payload; no vector is generated for them (a generator limit, not an implementation result).", types: skipped }, null, 2) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} vectors for ${tasks.length} task versions; ${skipped.length} versions without a buildable payload`);
