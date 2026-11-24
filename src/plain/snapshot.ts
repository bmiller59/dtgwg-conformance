// SPDX-License-Identifier: Apache-2.0
// The task-force specification facts the gap generator (scripts/generate-gap.ts) works from, read from the committed
// vectors-src/gap/tf-snapshot.json (refreshed by scripts/gap-snapshot.ts from a clone of the task-force repository). The pinned
// @openvtc/trust-tasks package is older than the repository, so a few versions are not in it: for those the snapshot carries the
// bundled schemas and `loadTask` falls back to it; for every other version the package stays the schema source.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleExtended } from "./schema.ts";
import type { PlainPolicy, PlainTask } from "./catalog.ts";
import type { InvalidExampleEntry } from "./invalid-examples.ts";

export interface SnapshotTask {
  typeUri: string; slug: string; version: string; family: string; title: string;
  /** The spec's own `status` (draft or retired on main). */
  status: string;
  tfPath: string; dirDigest: string; specHash: string; schemaHash: string | null; supersededBy?: string;
  inPackage: boolean; hasPayloadSchema: boolean; hasResponse: boolean;
  requestPolicy: PlainPolicy; responsePolicy: PlainPolicy | null;
  /** Remote branches of the task-force repository whose copy of this version differs from main (the vectors follow main). */
  branches?: { name: string; sha: string }[];
  /** Set only for a version that is not on main: the pull request (label `pr#<n>`) or branch revision the text was read from. */
  origin?: { label: string; rev: string; sha: string };
  errorCodes: string[];
  /** Every entry of payload.invalid-examples.json, with its `variant` marker kept (src/plain/invalid-examples.ts). */
  invalidExamples: InvalidExampleEntry[];
  examples: { payload: unknown }[];
  payloadSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
}
export interface Snapshot { format: "tt-gap-snapshot/0.1"; tfCommit: string; tfDate: string; families: string[]; tasks: SnapshotTask[] }

export const SNAPSHOT_FILE = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "vectors-src", "gap", "tf-snapshot.json");
let cached: Snapshot | undefined;
export function loadSnapshot(): Snapshot {
  if (cached === undefined) {
    try { cached = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Snapshot; } catch { cached = { format: "tt-gap-snapshot/0.1", tfCommit: "", tfDate: "", families: [], tasks: [] }; }
  }
  return cached;
}
const byType = (): Map<string, SnapshotTask> => new Map(loadSnapshot().tasks.map((t) => [t.typeUri, t]));
let index: Map<string, SnapshotTask> | undefined;
export const snapshotTask = (typeUri: string): SnapshotTask | undefined => (index ??= byType()).get(typeUri.split("#")[0]!);

/** A PlainTask for a version only the snapshot holds (not in the pinned package), or undefined. */
export function snapshotPlainTask(typeUri: string): PlainTask | undefined {
  const s = snapshotTask(typeUri);
  if (s === undefined || s.payloadSchema === undefined) return undefined;
  const root = s.payloadSchema;
  const resp = s.responseSchema;
  // the same builder order as the coverage tasks: `example`, then the extended builder for a schema `example` cannot build
  return {
    family: s.family, slug: s.slug, version: s.version, typeUri: s.typeUri, responseTypeUri: `${s.typeUri}#response`,
    requestPolicy: s.requestPolicy, responsePolicy: s.responsePolicy ?? undefined,
    payloadSchema: root, responseSchema: resp,
    validPayload: exampleExtended(root), validResponse: resp === undefined ? undefined : exampleExtended(resp),
    deprecated: s.status === "retired",
  };
}
