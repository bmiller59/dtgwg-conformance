// SPDX-License-Identifier: Apache-2.0
// The gap families' tasks: every version of the named families, from the pinned package where it ships the version and from the gap
// snapshot (vectors-src/gap/tf-snapshot.json) where it does not, joined to the facts the specification states (policy, error codes,
// its own invalid payload examples and request examples). Shared by scripts/generate-gap.ts and the reference oracle.
import { loadTask, type PlainTask } from "./catalog.ts";
import { classifyInvalidExample, FORMAT_ONLY_REASON, RESPONSE_ENTRY_REASON, SCHEMA_ACCEPTED_REASON } from "./invalid-examples.ts";
import { exampleExtended, validate } from "./schema.ts";
import { loadSnapshot, type SnapshotTask } from "./snapshot.ts";

/**
 * The families the gap vectors cover: the project owner's first six (vta, vtc, rooms, did-management, git-ns, messaging), then the families
 * whose remaining versions no other vector set referenced (the "uncovered families" step: every version of the task-force repository that
 * still had no vector after the first gap step).
 */
export const GAP_FAMILIES = ["vta", "vtc", "rooms", "did-management", "git-ns", "messaging", "vtn", "voting", "registry", "persona", "external", "webvh", "trust-task-error", "credential-exchange", "understanding", "chat", "confirm", "consent", "git-trust", "provision", "sync", "audit", "peer-check", "process-attestation", "push", "trust-task-discovery", "trust-task-ok"] as const;
/** Group id per family. */
export const GAP_GROUPS: Record<string, string> = { vta: "GP-VTA", vtc: "GP-VTC", rooms: "GP-ROO", "did-management": "GP-DID", "git-ns": "GP-GIT", messaging: "GP-MSG", vtn: "GP-VTN", voting: "GP-VOT", registry: "GP-REG", persona: "GP-PER", external: "GP-EXT", webvh: "GP-WEB", "trust-task-error": "GP-TTE", "credential-exchange": "GP-CRX", understanding: "GP-UND", chat: "GP-CHT", confirm: "GP-CNF", consent: "GP-CNS", "git-trust": "GP-GTR", provision: "GP-PRV", sync: "GP-SYN", audit: "GP-AUD", "peer-check": "GP-PCK", "process-attestation": "GP-PAT", push: "GP-PSH", "trust-task-discovery": "GP-TTD", "trust-task-ok": "GP-TTK" };

/** Group id of the producer-class (emit) vectors per family. */
export const GAP_EMIT_GROUPS: Record<string, string> = { vta: "GE-VTA", vtc: "GE-VTC", rooms: "GE-ROO", "did-management": "GE-DID", "git-ns": "GE-GIT", messaging: "GE-MSG", vtn: "GE-VTN", voting: "GE-VOT", registry: "GE-REG", persona: "GE-PER", external: "GE-EXT", webvh: "GE-WEB", "trust-task-error": "GE-TTE", "credential-exchange": "GE-CRX", understanding: "GE-UND", chat: "GE-CHT", confirm: "GE-CNF", consent: "GE-CNS", "git-trust": "GE-GTR", provision: "GE-PRV", sync: "GE-SYN", audit: "GE-AUD", "peer-check": "GE-PCK", "process-attestation": "GE-PAT", push: "GE-PSH", "trust-task-discovery": "GE-TTD", "trust-task-ok": "GE-TTK" };

/**
 * Reply types of the framework (SPEC.md section 4.4 table and section 8): a consumer returns them; nothing in the text says what a consumer
 * does when one arrives as a request, so request-style vectors (a send that expects a refusal or an answer) are not generated for them.
 * Class C (the text is silent); the producer-class (emit) vectors, which the text does support, are kept.
 */
export const RESPONSE_ONLY_SLUGS: readonly string[] = ["trust-task-error", "trust-task-ok"];

export interface GapTask {
  task: PlainTask;
  snap: SnapshotTask;
  /** Where the schema came from. */
  schemaFrom: "package" | "snapshot";
  /** The payload the generator builds (the task's own `example`, then the extended builder, then the first valid spec example), or undefined. */
  valid: unknown;
  /** Spec request examples the task's payload schema accepts. */
  examples: { payload: unknown }[];
  /** Spec invalid examples the schema refuses. */
  invalid: { note: string; payload: unknown }[];
  /** What was not turned into a vector, and why (reported in the run, never silently dropped). */
  dropped: { kind: "example" | "invalid-example" | "response-example" | "format-only"; note: string; reason: string }[];
}

const cache = new Map<string, GapTask[]>();

export function gapTasks(families: readonly string[] = GAP_FAMILIES): GapTask[] {
  const key = families.join(",");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out: GapTask[] = [];
  for (const snap of loadSnapshot().tasks) {
    if (!families.includes(snap.family)) continue;
    const t = loadTask(snap.typeUri);
    if (t === undefined) continue;
    const root = t.payloadSchema;
    const dropped: GapTask["dropped"] = [];
    const examples: GapTask["examples"] = [];
    for (const [i, e] of snap.examples.entries()) {
      const errs = validate(root, e.payload);
      if (errs.length === 0) examples.push(e);
      else dropped.push({ kind: "example", note: `request example ${i + 1}`, reason: `the task's own payload schema refuses it: ${errs[0]}` });
    }
    const invalid: GapTask["invalid"] = [];
    // each entry is classified against the schema of its own variant (the `variant` marker, never the note text), with and without `format` asserted
    for (const e of snap.invalidExamples) {
      const c = classifyInvalidExample({ request: root, response: t.responseSchema }, e);
      if (c.variant === "response") dropped.push({ kind: "response-example", note: e.note.slice(0, 160), reason: `${RESPONSE_ENTRY_REASON}; ${c.class === "refused" ? "the response schema refuses it" : c.class === "format-only" ? "the response schema refuses it only with `format` asserted" : c.class === "no-schema" ? "no response schema is available for this version" : "the response schema accepts it"}` });
      else if (c.class === "refused") invalid.push(e);
      else if (c.class === "format-only") dropped.push({ kind: "format-only", note: e.note.slice(0, 160), reason: `${FORMAT_ONLY_REASON} (${c.error ?? ""})` });
      else dropped.push({ kind: "invalid-example", note: e.note.slice(0, 160), reason: SCHEMA_ACCEPTED_REASON });
    }
    const built = t.validPayload ?? exampleExtended(root);
    const valid = built ?? examples[0]?.payload;
    const validResponse = t.validResponse ?? (t.responseSchema === undefined ? undefined : exampleExtended(t.responseSchema));
    out.push({ task: { ...t, validPayload: valid, validResponse }, snap, schemaFrom: snap.inPackage ? "package" : "snapshot", valid, examples, invalid, dropped });
  }
  cache.set(key, out);
  return out;
}
