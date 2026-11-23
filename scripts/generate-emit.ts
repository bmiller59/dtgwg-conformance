// SPDX-License-Identifier: Apache-2.0
// Authoring source for vectors/emit/ (the producer class, docs/04 section 11.8; layer 3a, NOT core). Run:
//   node --experimental-strip-types scripts/generate-emit.ts [outDir]
// One vector per task version (request variant) of the acl, policy, vault, device, auth, keys and push families: the implementation is
// asked to emit that document through its own builders and the harness checks it against the payload schema and policy the pinned
// @openvtc/trust-tasks 0.29.0 ships (registry package; every registry specification is status draft). A task the implementation does
// not emit is SKIP (`emit:<type>` not in its declared `emits`), never a pass. Content and authority are not checked (docs/02 section 5).
import { labelVersionRole } from "../src/vectors/version-role.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EMIT_FAMILIES, loadPlainTasks } from "../src/plain/catalog.ts";
import { loadPins, pkgSource, withSource } from "../src/vectors/source.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";
import { applyClarifyMeta, loadClarifyMeta } from "../src/vectors/clarify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] === undefined ? join(resolve(here, ".."), "vectors", "emit") : resolve(process.argv[2]);
const PKG = "@openvtc/trust-tasks 0.29.0 (registry package; the specification is status draft)";
const GROUPS: Record<string, string> = { acl: "EM-ACL", policy: "EM-POL", vault: "EM-VLT", device: "EM-DEV", auth: "EM-AUT", keys: "EM-KEY", push: "EM-PSH" };

const tasks = loadPlainTasks(EMIT_FAMILIES);
const pins = loadPins();
const files: VectorFile[] = [];
for (const fam of EMIT_FAMILIES) {
  const vectors: Vector[] = [];
  let n = 1;
  for (const t of tasks.filter((x) => x.family === fam)) {
    const p = t.requestPolicy;
    const root = t.payloadSchema as Record<string, unknown>;
    const mutants = ["emitBadPayload", ...(p.isProofRequired ? ["emitNoProof"] : []), ...(p.isRecipientRequired ? ["emitNoRecipient"] : []), ...(p.isIssuedAtRequired ? ["emitNoIssuedAt"] : [])];
    const canMutate = t.validPayload !== undefined && (Array.isArray(root["required"]) ? (root["required"] as unknown[]).length > 0 : root["additionalProperties"] === false);
    vectors.push(withSource({
      id: `${GROUPS[fam]}-${String(n++).padStart(3, "0")}`,
      title: `${t.slug} ${t.version}: the document the implementation emits for this task conforms to its payload schema and declared policy`,
      tier: 1,
      spec: [
        `payload schema of ${t.typeUri} (${PKG})`,
        `declared policy (${PKG}): isProofRequired=${p.isProofRequired}, isRecipientRequired=${p.isRecipientRequired}, isIssuedAtRequired=${p.isIssuedAtRequired}`,
        "SPEC.md:1015, 1017 and 1137 (7.2 items 5 and 7, 7.3 item 17: a document lacking a REQUIRED recipient, proof or issuedAt is not conforming); SPEC.md 7.2 item 8 (a proof with no recipient on a non-bearer task is malformed)",
        "Mechanics only: the suite does not check what the document asks for or whether anyone is authorised to ask (docs/02 section 5)",
      ],
      clarify: null,
      requires: ["optional:emit", `emit:${t.typeUri}`],
      ...(canMutate ? { mutants: mutants.filter((m) => t.validPayload !== undefined) } : {}),
      steps: [{ emit: { type: t.typeUri, args: { recipient: "$X" } }, expect: { disposition: "emitted", plainType: t.typeUri } }],
    } as Vector, pkgSource(t, "0.29.0", pins)));
  }
  files.push({ format: "tt-conformance-vectors/0.1", group: GROUPS[fam]!, family: "emit", clock: { start: "2026-11-12T10:00:00Z" }, vectors });
}
mkdirSync(outDir, { recursive: true });
applyClarifyMeta(files, loadClarifyMeta(join(here, "..")));
labelVersionRole(files);
for (const f of files) writeFileSync(join(outDir, `${f.group.toLowerCase()}.json`), JSON.stringify(f, null, 2) + "\n");
writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: files.map((f) => `${f.group.toLowerCase()}.json`) }, null, 2) + "\n");
console.log(`${files.reduce((n, f) => n + f.vectors.length, 0)} emit vectors`);
