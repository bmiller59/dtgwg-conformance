// SPDX-License-Identifier: Apache-2.0
// The candidate coverage vectors (docs/22, decision CV-6, docs/24): task types a platform uses that have NO Trust Tasks specification.
// A vector exists only where a local text exists (docs/24 quotes the platform's own source, file and lines relative to that platform's
// repository); nothing here is invented. A type with no usable text is listed in BLOCKED with the reason and gets no vector.
// The reference oracle serves each candidate type from the small definition below (the payload schema written out from the quoted request
// struct, policy "nothing required": the quoted text declares none), so a mutant that skips payload validation can be shown to fail the vector.
import { TYPE_BASE, type PlainTask } from "../plain/catalog.ts";

/** The suite-owned local text every candidate coverage vector rests on. */
export const CANDIDATE_TEXT = "docs/24-candidate-task-notes.md";
/** The platform whose own source the text quotes (the name run folders use, src/vectors/implemented-by.ts). */
export const CANDIDATE_PLATFORM = "verifiable-trust-infrastructure";

export interface CandidateProbe { label: string; payload: Record<string, unknown> }
export interface CandidateTask {
  /** Census type, `slug/version`. */
  type: string;
  /** The request members, as the quoted struct declares them (docs/24). Only `required` and the member types are used; no range is asserted. */
  properties: Record<string, { type: "string" | "integer" }>;
  required: string[];
  /** Payloads that break the declared shape: each is checked against the schema above before a vector is written. */
  probes: CandidateProbe[];
  /** Section of docs/24 that holds the quotes. */
  section: string;
  /** The quoted lines the shape rests on (file:lines in the platform repository). */
  anchors: string[];
  /** Why the request shape is what the vector uses, in one line. */
  basis: string;
}

const VAULT_ANCHORS = ["vta-service/src/trust_tasks/vault.rs:252-265 (VaultLifecycleBody: id required; expectedVersion and reason optional)", "vta-service/src/trust_tasks/vault.rs:1359-1368 and :1400-1407 (capability gate, then payload)", "vta-sdk/src/trust_tasks.rs:675-694 (what the four verbs do)", "vta-service/src/trust_tasks/mod.rs:305-310 (listed as unspecified)"];
const vault = (name: string): CandidateTask => ({
  type: `vault/${name}/0.1`,
  properties: { id: { type: "string" }, expectedVersion: { type: "integer" }, reason: { type: "string" } },
  required: ["id"],
  probes: [{ label: "the entry id is missing", payload: {} }, { label: "the entry id is a number, not a string", payload: { id: 5 } }],
  section: "vault/archive, vault/unarchive, vault/restore, vault/purge (0.1)",
  anchors: VAULT_ANCHORS,
  basis: "the shared request body of the four archival lifecycle verbs",
});

export const CANDIDATE_TASKS: CandidateTask[] = [
  vault("archive"), vault("unarchive"), vault("restore"), vault("purge"),
  {
    type: "vta/audit/update-retention/1.0",
    properties: { retentionDays: { type: "integer" } },
    required: ["retentionDays"],
    probes: [{ label: "retentionDays is missing", payload: {} }, { label: "retentionDays is a string, not an integer", payload: { retentionDays: "x" } }],
    section: "vta/audit/update-retention (1.0)",
    anchors: ["vta-sdk/src/protocols/audit_management/retention.rs:27-34 (UpdateRetentionBody: retentionDays required)", "vta-service/src/trust_tasks/audit.rs:107-117 (payload parsed before authority is checked)", "vta-service/src/trust_tasks/mod.rs:288-290 (listed as unspecified)"],
    basis: "the request body of the audit retention update",
  },
];

/** Used types with no Trust Tasks specification and no vector of this kind, and why (generated into docs/22). */
export const BLOCKED: { type: string; reason: string }[] = [
  { type: "vta/audit/get-retention/1.0", reason: "blocked on text: the request body is an empty struct, so there is no required member to leave out, and the only request the text describes is a valid one (decision CV-5 leaves it out for administration)" },
  { type: "vta/seeds/list/1.0", reason: "blocked on text: the request body is an empty struct, so there is no required member to leave out, and the only request the text describes is a valid one (decision CV-5 leaves it out for administration)" },
  { type: "vta/seeds/rotate/1.0", reason: "blocked on text: the only request member is optional, so no required member can be left out, and a valid request rotates the agent's seed (destructive)" },
  { type: "vetting/vetters/grant/0.1", reason: "blocked on text: the keyring-wallet source mentions the type only in comments about a delivered credential; it states no request payload, response or refusal" },
];
/** Types whose candidate vectors already exist elsewhere in the suite: the census row is linked to them, no new vector is written. */
export const LINKED: { type: string; where: string }[] = [
  { type: "vrc/relationships/witness-share/0.1", where: "vectors/ceremony-vrc/witness-share.json (WSH, 23 vectors; local text docs/10-witness-share-profile.md)" },
];

const POLICY = { isBearer: false, isProofRequired: false, isRecipientRequired: false, isIssuedAtRequired: false };

/** The JSON Schema the oracle validates a candidate request against: the declared members, `required`, and nothing else (no range, no closed object). */
export const candidateSchema = (c: CandidateTask): Record<string, unknown> => ({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", required: c.required, properties: c.properties });

/** The candidate types as plain tasks for the reference oracle (request side only: no response schema, no valid payload). */
export function candidatePlainTasks(): PlainTask[] {
  return CANDIDATE_TASKS.map((c) => {
    const i = c.type.lastIndexOf("/");
    const slug = c.type.slice(0, i);
    return {
      family: slug.split("/")[0]!, slug, version: c.type.slice(i + 1), typeUri: `${TYPE_BASE}${c.type}`, responseTypeUri: `${TYPE_BASE}${c.type}#response`,
      requestPolicy: POLICY, responsePolicy: undefined, payloadSchema: candidateSchema(c), responseSchema: undefined, validPayload: undefined, validResponse: undefined, deprecated: false,
    };
  });
}
