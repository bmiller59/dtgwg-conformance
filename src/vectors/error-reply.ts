// SPDX-License-Identifier: Apache-2.0
// O-01: a rejection's error reply is a SHOULD (SPEC.md 7.2 closing paragraph; a MAY at :1196), so an `error` step of a vector that judges the rejection by
// state (noSideEffect) carries `errorReply: "should"`, and a consumer that rejects and stays silent is noted, not failed (docs/decisions/README.md error-reply-should).
// The exception is a task whose own text puts the reply inside a MUST (vectors-src/complete/reply-required.json, scripts/derive-reply-required.ts): there a
// missing reply stays a FAIL. A document of a type with no task text (a framework type, an unknown slug) falls under the framework rule: a SHOULD.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { taskOfType } from "./effects.ts";
import type { VectorFile } from "./types.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let required: Set<string> | undefined;
export const replyRequiredTasks = (): Set<string> => (required ??= new Set(Object.keys((JSON.parse(readFileSync(join(root, "vectors-src", "complete", "reply-required.json"), "utf8")) as { required: J }).required)));

/** Whether a step's rejection reply is a SHOULD: an `error` step that sends a document of a task whose text does not require the reply. */
export function replyIsShould(step: J): boolean {
  const ex = step["expect"];
  if (!isObj(ex) || ex["disposition"] !== "error" || ex["errorReply"] !== undefined) return false;
  const send = step["send"];
  if (!isObj(send) || !isObj(send["document"])) return false;
  const task = taskOfType(send["document"]["type"]);
  return task === null || !replyRequiredTasks().has(task);
}

/** Mark every such step of the files (in place) and return how many steps were marked. */
export function applyErrorReply(files: { vectors: unknown[] }[]): number {
  let n = 0;
  for (const f of files as VectorFile[]) for (const v of f.vectors as unknown as { steps?: J[]; retired?: unknown }[]) {
    // a retired vector is a tombstone that is never run, but the seeded probe re-issues its expectation (src/coverage/probe.ts), so it is marked too
    for (const s of v.steps ?? []) if (replyIsShould(s)) { (s["expect"] as J)["errorReply"] = "should"; n++; }
  }
  return n;
}
