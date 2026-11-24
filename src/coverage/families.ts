// SPDX-License-Identifier: Apache-2.0
// The coverage families (docs/22): vectors for every Trust Task type keyring-wallet or VTI uses, grouped by domain. They are layer 3a
// application-task checks, NOT core: channel `proposed` where the Trust Tasks repository holds a specification, `candidate` where it
// holds none; none gates, none enters a headline count, none runs in a default run (they live in vectors/coverage, run with
// `--vectors vectors/coverage --channels proposed,candidate`). The census (vectors-src/coverage/task-census.tsv) is the list of used
// types; it is read here, never re-derived from a platform at test time.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CENSUS_FILE = join(root, "vectors-src", "coverage", "task-census.tsv");
export const INVALID_EXAMPLES_FILE = join(root, "vectors-src", "coverage", "tf-invalid-examples.json");

/** The eight coverage families by domain (decision CV-4). FW (framework) is covered by the core groups and is not a coverage family. */
export const COVERAGE_FAMILIES = [
  { id: "RM", label: "Rooms", plain: "rooms and room keys, records and blobs" },
  { id: "VP", label: "Vetting, process attestation and voting", plain: "vetting, process attestation, elections and ballots" },
  { id: "MB", label: "Membership and directory", plain: "community membership, invitations, directory, roles and relationships" },
  { id: "CS", label: "Consent and step-up", plain: "consent, task consent and step-up approval" },
  { id: "SD", label: "Session, device, vault, keys, access and policy", plain: "sign-in, devices, vaults, keys, access control and policy" },
  { id: "AA", label: "Agent administration", plain: "administration of a personal agent (VTI agent service only)" },
  { id: "CA", label: "Community administration", plain: "administration of a community (VTI community service only)" },
  { id: "PW", label: "Peer ceremony wire", plain: "witness session and verifiable relationship credential wire tasks" },
] as const;
export type CoverageFamilyId = (typeof COVERAGE_FAMILIES)[number]["id"];
export const FAMILY_IDS: readonly string[] = COVERAGE_FAMILIES.map((f) => f.id);

/** Channel of a coverage vector: `proposed` when the Trust Tasks repository has a specification, otherwise `candidate`; never `registry`. */
export const channelFor = (tfStatus: string): "proposed" | "candidate" => (tfStatus === "draft" ? "proposed" : "candidate");

/**
 * What keyring-wallet (KW) does with a type its source names (evidence in vectors-src/coverage/kw-roles-evidence.md):
 * `sent` builds and sends it; `received` only reads it inbound; `both`; `declared-only` names it in a list, rule, capability or
 * comment and neither sends nor receives it. A row KW does not use has `-`.
 */
export const KW_ROLES = ["sent", "received", "both", "declared-only"] as const;
export type KwRole = (typeof KW_ROLES)[number];

/** The census header. Changing the columns changes this string on purpose: a stale file or parser is refused, not misread. */
export const CENSUS_HEADER = "type,used_by,tf_status,family,error_codes,kw_role";

export interface CensusRow {
  type: string; slug: string; version: string;
  usedBy: string[]; kw: boolean; vti: boolean; vtiSent: boolean; vta: boolean; vtc: boolean;
  /** KW's role for this type; undefined when KW does not use it. */
  kwRole: KwRole | undefined;
  /** KW sends this type (role `sent` or `both`): the headline KW denominator. */
  kwSends: boolean;
  tfStatus: string; family: string; errorCodes: number;
}

export function parseCensus(text: string): CensusRow[] {
  const lines = text.trim().split("\n");
  const head = lines.shift()!.split("\t");
  if (head.join(",") !== CENSUS_HEADER) throw new Error("task-census.tsv: unexpected header");
  return lines.map((l) => {
    const [type, usedBy, tfStatus, family, errs, role] = l.split("\t") as [string, string, string, string, string, string];
    const i = type.lastIndexOf("/");
    const by = usedBy.split("+");
    const kwRole = by.includes("KW") ? (KW_ROLES as readonly string[]).includes(role) ? (role as KwRole) : undefined : undefined;
    if (by.includes("KW") && kwRole === undefined) throw new Error(`task-census.tsv: ${type} is used by KW and has no kw_role (${role})`);
    if (!by.includes("KW") && role !== "-") throw new Error(`task-census.tsv: ${type} is not used by KW and must have kw_role "-" (${role})`);
    return {
      kwRole, kwSends: kwRole === "sent" || kwRole === "both",
      type, slug: type.slice(0, i), version: type.slice(i + 1), usedBy: by, kw: by.includes("KW"), vta: by.includes("VTA"), vtc: by.includes("VTC"),
      vti: by.includes("VTA") || by.includes("VTC"), vtiSent: by.includes("VTIsend"), tfStatus, family, errorCodes: Number(errs),
    };
  });
}

let cached: CensusRow[] | undefined;
export function loadCensus(): CensusRow[] {
  return (cached ??= parseCensus(readFileSync(CENSUS_FILE, "utf8")));
}

/** Verbs whose task changes or removes state that is hard to undo. Such a task is probed with schema-invalid payloads only (decision CV-5; plan rule). */
export const DESTRUCTIVE_VERBS = ["wipe", "delete", "purge", "restore", "remove", "revoke", "reset", "destroy", "rotate", "swap-key", "self-remove", "decommission", "erase"];
export const isDestructive = (slug: string): boolean => {
  const last = slug.split("/").pop()!;
  return DESTRUCTIVE_VERBS.some((v) => last === v || last.startsWith(`${v}-`));
};

/** Task versions of a family that the registry package can build a payload for are generated; the rest are listed, never guessed. */
export const familyRows = (id: string): CensusRow[] => loadCensus().filter((r) => r.family === id);

/** Skip classes this work adds to results/skip-classes.json: a SKIP of a coverage vector says which of these (docs/22). */
export const COVERAGE_SKIP_CLASSES = {
  notServed: "not served by this surface: the platform does not declare the task type as served (the check applies to a server of this task)",
  sendOnly: "send-only: the platform sends this task and does not serve it, so only the emit check applies",
  noCounterpart: "no counterpart: no implementation answers this task, so the receive check has no host",
} as const;

export interface InvalidExample { note: string; payload: unknown; /** Present (always "response") for an entry the task force checks against the response schema: never sent as a request. */ variant?: "response"; /** The task's specification says it clamps this member (`limit`): serving the request is documented behaviour, so a response is accepted beside a refusal. */ clamped?: true }
export interface InvalidExamplesFile { format: "tt-coverage-invalid-examples/0.1"; kit: string; examples: Record<string, InvalidExample[]> }
let invalid: InvalidExamplesFile | undefined;
export function loadInvalidExamples(): InvalidExamplesFile {
  return (invalid ??= JSON.parse(readFileSync(INVALID_EXAMPLES_FILE, "utf8")) as InvalidExamplesFile);
}
