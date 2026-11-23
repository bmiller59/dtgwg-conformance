// SPDX-License-Identifier: Apache-2.0
// Trust Tasks repository references (`tfRef`): the committed manifest of TF paths and statuses, and the derivation of a tfRef from a vector's source `ref`.
//
// Where the manifest comes from: `scripts/tf-manifest.ts` reads a local clone of the Trust Tasks task-force repository (`dtgwg-trust-tasks-tf`) at two pinned commits:
//   main = origin/main 0dbc98f1c059af300ff84eb1ab407edea16a16c1 (2026-11-14, the commit every tfRef is resolved against) and
//   kit  = 640d498909dc2e0a6b979b8189e8b845c6b86c62 (2026-10-29, the pinned kit copy, an ancestor of main; the manifest records which paths it also holds).
// The manifest is committed so the loader tests run offline; `scripts/resolve-tf-refs.ts` re-verifies it against the clone when the clone is present.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TfRef, TfStatus } from "./source.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const TF_MANIFEST_FILE = join(root, "vectors", "tf-manifest.json");

export interface TfManifestPath { status: TfStatus; inKit: boolean; supersededBy?: string }
export interface TfManifest {
  format: "tt-tf-manifest/0.1";
  about: string;
  main: { ref: string; commit: string; /** YYYY-MM-DD, the commit date: the "spec pin" date shown on the status pages (docs/23) */ date: string };
  kit: { commit: string };
  paths: Record<string, TfManifestPath>;
}

let cached: TfManifest | undefined;
export function loadTfManifest(path = TF_MANIFEST_FILE): TfManifest {
  if (path === TF_MANIFEST_FILE && cached !== undefined) return cached;
  const m = JSON.parse(readFileSync(path, "utf8")) as TfManifest;
  if (path === TF_MANIFEST_FILE) cached = m;
  return m;
}

/** The Trust Tasks repository path a source `ref` points at, or null when it points at no TF artifact (a suite-local document). */
export function tfPathOf(ref: string): string | null {
  let m = /^kit:(specs\/.+?\/\d+\.\d+)$/.exec(ref);
  if (m !== null) return `${m[1]}/spec.md`;
  m = /^kit:(bindings\/\w+\/\d+\.\d+)$/.exec(ref);
  if (m !== null) return `${m[1]}/spec.md`;
  if (ref === "kit:SPEC.md") return "SPEC.md";
  m = /^kit:(ceremonies\/ceremony\.meta\.schema\.json)$/.exec(ref);
  if (m !== null) return m[1]!;
  m = /^pkg:[^#]+#https:\/\/trusttasks\.org\/spec\/(.+?)\/(\d+\.\d+)$/.exec(ref);
  if (m !== null) return `specs/${m[1]}/${m[2]}/spec.md`;
  // the imported fixtures are the Trust Tasks fixtures directory; they exercise the framework text
  if (/^suite:vectors\/imported\//.test(ref)) return "SPEC.md";
  return null;
}

/** The tfRef a source `ref` resolves to in the manifest (status read from the manifest), or null when the ref is not a TF artifact or the manifest lacks it. */
export function tfRefFor(ref: string, manifest: TfManifest = loadTfManifest()): TfRef | null {
  const p = tfPathOf(ref);
  if (p === null) return null;
  const e = manifest.paths[p];
  if (e === undefined) return null;
  return { repoPath: p, commit: manifest.main.commit, status: e.status, ...(e.supersededBy === undefined ? {} : { supersededBy: e.supersededBy }) };
}
