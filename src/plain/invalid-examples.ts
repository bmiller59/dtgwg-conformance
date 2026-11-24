// SPDX-License-Identifier: Apache-2.0
// The one reader and classifier of the task force's invalid payload examples (specs/<slug>/<version>/payload.invalid-examples.json).
//
// An entry is checked against the REQUEST payload schema unless it carries `"variant": "response"`, in which case it is checked against the
// RESPONSE payload schema (the `$anchor: "response"` sub-schema): CONTRIBUTING-SPECS.md of the task-force repository, "A fixture is checked
// against the request payload unless it says otherwise". Every loader keeps the marker (readInvalidExamples), every classifier honours it
// (classifyInvalidExample), and a response entry is never sent to an implementation as a request.
//
// `format`: the task force's build asserts it; this suite's validator does only on request. An entry that the right schema accepts without
// `format` and refuses with it is its own class, "format-only" (the open question whether a consumer must assert `format`), never counted
// as accepted by the schema and never as refused by it.
import { validate } from "./schema.ts";

export type Variant = "request" | "response";
/** One entry as the suite stores it: `variant` is present only for a response entry, as in the task force's files. */
export interface InvalidExampleEntry { note: string; payload: unknown; variant?: "response" }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const variantOf = (e: { variant?: unknown }): Variant => (e.variant === "response" ? "response" : "request");

/** Normalise the parsed contents of a payload.invalid-examples.json: entries without a `payload` are skipped; `note`, `payload` and the `variant` marker are kept. */
export function readInvalidExamples(raw: unknown): InvalidExampleEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((i) => isObj(i) && "payload" in i).map((i) => {
    const e = i as Record<string, unknown>;
    return { note: String(e["note"] ?? ""), payload: e["payload"], ...(e["variant"] === "response" ? { variant: "response" as const } : {}) };
  });
}

export type InvalidClass =
  /** the schema of the entry's variant refuses it without `format` asserted: usable as a negative */
  | "refused"
  /** accepted without `format`, refused with it: depends on whether a consumer asserts `format` */
  | "format-only"
  /** accepted by the schema of its variant even with `format` asserted: a disagreement between the entry and its schema */
  | "schema-accepted"
  /** no schema of the entry's variant is available (a response entry for a version with no response schema) */
  | "no-schema";

export interface ClassifiedExample { variant: Variant; class: InvalidClass; /** first error under the schema of the entry's variant (formats asserted), when refused */ error?: string }

/** Classify an entry against the schema of ITS variant, with and without `format` asserted. */
export function classifyInvalidExample(schemas: { request: unknown; response?: unknown }, e: { payload: unknown; variant?: unknown }): ClassifiedExample {
  const variant = variantOf(e);
  const schema = variant === "response" ? schemas.response : schemas.request;
  if (schema === undefined || schema === null) return { variant, class: "no-schema" };
  const plain = validate(schema as Record<string, unknown>, e.payload);
  if (plain.length > 0) return { variant, class: "refused", error: plain[0] };
  const withFormats = validate(schema as Record<string, unknown>, e.payload, { formats: true });
  if (withFormats.length > 0) return { variant, class: "format-only", error: withFormats[0] };
  return { variant, class: "schema-accepted" };
}

export interface ClassCounts { total: number; request: number; response: number; refused: number; formatOnly: number; schemaAccepted: number; noSchema: number }

/** Counts by class. "schema-accepted" never includes a format-only entry: the two are always reported apart. */
export function countClasses(list: ClassifiedExample[]): ClassCounts {
  const c: ClassCounts = { total: list.length, request: 0, response: 0, refused: 0, formatOnly: 0, schemaAccepted: 0, noSchema: 0 };
  for (const x of list) {
    if (x.variant === "response") c.response++; else c.request++;
    if (x.class === "refused") c.refused++;
    else if (x.class === "format-only") c.formatOnly++;
    else if (x.class === "schema-accepted") c.schemaAccepted++;
    else c.noSchema++;
  }
  return c;
}

export const RESPONSE_ENTRY_REASON = "a response entry (`variant: response`): the task force lists it as an invalid reply, so it is checked against the task's response schema and never sent to a consumer as a request";
export const FORMAT_ONLY_REASON = "invalid only through a `format` keyword (the task force's build asserts `format`; the framework does not say whether a consumer must, an open specification question): not sent";
export const SCHEMA_ACCEPTED_REASON = "the schema of its variant accepts it even with `format` asserted (the specification lists it as invalid)";
