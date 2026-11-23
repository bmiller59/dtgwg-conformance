// SPDX-License-Identifier: Apache-2.0
// The plain tasks the probe covers, read from the pinned @openvtc/trust-tasks package (a suite dependency). Each task version ships
// its payload schema, its response schema and its policy (proof, recipient and issuedAt requirements) as values; nothing here is
// invented. Families are the profiles proposed as 2L-1 (access and approval: auth, acl, policy) and 2L-2 (holder, device and push:
// vault, device); they are layer 3a (plain tasks) and are not core.
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { example, resolveRef, validate } from "./schema.ts";
import { snapshotPlainTask } from "./snapshot.ts";

export const PLAIN_FAMILIES = ["acl", "policy", "vault", "device", "auth"] as const;
export const TYPE_BASE = "https://trusttasks.org/spec/";

export interface PlainPolicy {
  isBearer: boolean;
  isProofRequired: boolean;
  isRecipientRequired: boolean;
  isIssuedAtRequired: boolean;
}

export interface PlainTask {
  family: string;
  slug: string; // family/name
  version: string;
  typeUri: string;
  responseTypeUri: string;
  requestPolicy: PlainPolicy;
  /** Absent when the version declares no response variant. */
  responsePolicy: PlainPolicy | undefined;
  payloadSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown> | undefined;
  /** A minimal schema-valid request payload, or undefined when the generator could not build one. */
  validPayload: unknown;
  /** A minimal schema-valid response payload, or undefined. */
  validResponse: unknown;
  deprecated: boolean;
}

const req = createRequire(import.meta.url);

function distRoot(): string {
  return dirname(req.resolve("@openvtc/trust-tasks"));
}

type Mod = {
  TYPE_URI: string; RESPONSE_TYPE_URI: string; DEPRECATION: unknown; PAYLOAD_SCHEMA: Record<string, unknown>; RESPONSE_PAYLOAD_SCHEMA?: Record<string, unknown>;
  SPEC: PlainPolicy & { typeUri: string }; RESPONSE_SPEC?: PlainPolicy & { typeUri: string };
};

const pol = (p: PlainPolicy): PlainPolicy => ({ isBearer: p.isBearer === true, isProofRequired: p.isProofRequired === true, isRecipientRequired: p.isRecipientRequired === true, isIssuedAtRequired: p.isIssuedAtRequired === true });

/** Directories under `dir` that hold version folders (`0.3`), as slug paths relative to the dist root. */
function slugDirs(base: string, rel: string, out: string[]): void {
  const here = join(base, rel);
  const names = readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  if (names.some((n) => /^\d+\.\d+$/.test(n)) && existsSync(join(here, names.find((n) => /^\d+\.\d+$/.test(n))!, "payload.js"))) out.push(rel);
  for (const n of names) if (!n.startsWith("_") && !/^\d+\.\d+$/.test(n)) slugDirs(base, `${rel}/${n}`, out);
}

export const EMIT_FAMILIES = [...PLAIN_FAMILIES, "keys", "push"] as const;

export function loadPlainTasks(families: readonly string[] = PLAIN_FAMILIES): PlainTask[] {
  const base = distRoot();
  const out: PlainTask[] = [];
  for (const family of families) {
    const slugs: string[] = [];
    slugDirs(base, family, slugs);
    for (const slug of slugs.sort()) {
      const versions = readdirSync(join(base, slug)).filter((n) => /^\d+\.\d+$/.test(n)).sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
      for (const version of versions) {
        out.push(taskFrom(slug, version));
      }
    }
  }
  return out;
}

/** Whether the pinned package itself ships the version (the gap snapshot does not count). */
export function packageHas(typeUri: string): boolean {
  const m = /^(.+)\/(\d+\.\d+)$/.exec(typeUri.split("#")[0]!.slice(TYPE_BASE.length));
  return m !== null && existsSync(join(distRoot(), m[1]!, m[2]!, "payload.js"));
}

const cache = new Map<string, PlainTask | undefined>();

/** The task a Type URI names (request or response form), from the pinned package; undefined when the package has no such version. Needs Node 22.12 or later (synchronous require of an ES module). */
export function loadTask(typeUri: string): PlainTask | undefined {
  const bare = typeUri.split("#")[0]!;
  if (cache.has(bare)) return cache.get(bare);
  let task: PlainTask | undefined;
  if (bare.startsWith(TYPE_BASE)) {
    const m = /^(.+)\/(\d+\.\d+)$/.exec(bare.slice(TYPE_BASE.length));
    if (m !== null && existsSync(join(distRoot(), m[1]!, m[2]!, "payload.js"))) task = taskFrom(m[1]!, m[2]!);
    // a version newer than the pinned package: the gap snapshot (vectors-src/gap/tf-snapshot.json) carries its bundled schemas
    else task = snapshotPlainTask(bare);
  }
  cache.set(bare, task);
  return task;
}

function taskFrom(slug: string, version: string): PlainTask {
  const base = distRoot();
  const family = slug.split("/")[0]!;
  {
    {
      {
        const m = req(join(base, slug, version, "payload.js")) as Mod;
        return {
          family, slug, version, typeUri: m.TYPE_URI, responseTypeUri: m.RESPONSE_TYPE_URI,
          requestPolicy: pol(m.SPEC), responsePolicy: m.RESPONSE_SPEC === undefined ? undefined : pol(m.RESPONSE_SPEC),
          payloadSchema: m.PAYLOAD_SCHEMA, responseSchema: m.RESPONSE_PAYLOAD_SCHEMA,
          validPayload: example(m.PAYLOAD_SCHEMA), validResponse: m.RESPONSE_PAYLOAD_SCHEMA === undefined ? undefined : example(m.RESPONSE_PAYLOAD_SCHEMA), deprecated: m.DEPRECATION !== null && m.DEPRECATION !== undefined,
        };
      }
    }
  }
}

/** A response payload that violates the response schema (a required member removed, else `ext` of the wrong type), or undefined when none can be built. Used by the reference adapter's `plainBadResponse` mutant. */
export function badResponsePayload(t: PlainTask): unknown {
  if (t.responseSchema === undefined || !isRecord(t.validResponse)) return undefined;
  let root: Record<string, unknown> = t.responseSchema;
  if (typeof root["$ref"] === "string") {
    const r = resolveRef(root, root["$ref"]);
    if (!isRecord(r)) return undefined;
    root = r;
  }
  const req0 = Array.isArray(root["required"]) ? (root["required"] as string[])[0] : undefined;
  if (req0 !== undefined) {
    const { [req0]: _drop, ...rest } = t.validResponse;
    return rest;
  }
  const props = root["properties"];
  if (isRecord(props) && isRecord(props["ext"])) return { ...t.validResponse, ext: 5 };
  return undefined;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export { validate };
