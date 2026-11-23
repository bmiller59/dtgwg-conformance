// SPDX-License-Identifier: Apache-2.0
// The second-layer (2L) common application profile members the 2L vectors (vectors/2l, scripts/generate-2l.ts) cover, read from the
// pinned @openvtc/trust-tasks package (registry package; every registry specification is status draft). The 2L profiles are the
// suite's own proposal (docs/19, channel `proposed`): this list says which registry slugs a profile names, it fixes no governance value.
// Shared by the generator and the reference oracle (2l-oracle.ts).
import { example, resolveRef, validate } from "../../plain/schema.ts";
import { loadTask, packageHas, TYPE_BASE, type PlainTask } from "../../plain/catalog.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

export interface TwoLGroup {
  /** Vector group stem: probe vectors are `TL-<stem>`, emit vectors `TE-<stem>`. */
  stem: string;
  /** The 2L profile the slugs belong to (draft numbering of the profiles document). */
  profile: "2L-2" | "2L-3" | "2L-4" | "2L-5";
  label: string;
  slugs: string[];
  /** The slugs are named after VTI (`vta/...`, `vtc/...`), not generic registry slugs. */
  vtiNamed?: boolean;
  /** The task is served only by a role KW alone plays today (vetting): written, expected to be SKIP on VTI. */
  note?: string;
}

export const TWO_L_GROUPS: TwoLGroup[] = [
  { stem: "NTF", profile: "2L-3", label: "notifications (generic): notify and relay", slugs: ["notifications/notify", "notifications/relay"] },
  { stem: "NTV", profile: "2L-3", label: "notifications inbox, VTI-named (no generic list, show, dismiss or deposit slug exists)", vtiNamed: true, slugs: ["vta/notifications/deposit", "vta/notifications/dismiss", "vta/notifications/list", "vta/notifications/show", "vtc/notifications/list", "vtc/notifications/relay", "vtc/notifications/show"] },
  { stem: "AUD", profile: "2L-4", label: "audit: list and verify", slugs: ["audit/list", "audit/verify"] },
  { stem: "INV", profile: "2L-5", label: "community invitations", vtiNamed: true, slugs: ["vtc/invitations/issue", "vtc/invitations/list", "vtc/invitations/revoke", "vtc/invitations/deliver"] },
  { stem: "JRQ", profile: "2L-5", label: "community join requests", vtiNamed: true, slugs: ["vtc/join-requests/submit", "vtc/join-requests/status", "vtc/join-requests/manifest", "vtc/join-requests/withdraw", "vtc/join-requests/supplement"] },
  { stem: "MBR", profile: "2L-5", label: "membership credential (VMC)", vtiNamed: true, slugs: ["vtc/members/vmc", "vtc/members/request-vmc"] },
  { stem: "DIR", profile: "2L-5", label: "community directory", vtiNamed: true, slugs: ["vtc/directory/entries/list", "vtc/directory/entries/show", "vtc/directory/card/show", "vtc/directory/card/update", "vtc/directory/fields/list", "vtc/directory/images/get", "vtc/directory/images/upload", "vtc/directory/query"] },
  { stem: "PSH", profile: "2L-2", label: "push registration (device and push/wake, push/provision are already in vectors/plain and vectors/emit)", slugs: ["push/register"] },
  { stem: "VET", profile: "2L-5", label: "vetting (applicant and vetter; KW only today, no VTI handler)", slugs: ["vetting/request", "vetting/session", "vetting/attestation", "vetting/decline"], note: "no server implements these; written for implementations that do" },
];

/** Versions of a slug in the pinned package that are not deprecated (retired), ascending. A version only the gap snapshot carries (newer than the package) is not a 2L version: the gap vectors cover it. */
export function versionsOf(slug: string): string[] {
  const out: string[] = [];
  for (let minor = 0; minor < 12; minor++) {
    if (!packageHas(`${TYPE_BASE}${slug}/0.${minor}`)) continue;
    const t = loadTask(`${TYPE_BASE}${slug}/0.${minor}`);
    if (t !== undefined && !t.deprecated) out.push(`0.${minor}`);
  }
  return out;
}

const PLACEHOLDER_DID = "did:web:conformance-originator.example";

/** A `notifications/notify/0.1` document shaped like what a relayer received (its proof is a placeholder that does not verify; the vector checks mechanics, not who signed). */
export function notifyDocument(recipient: string): J {
  const n = loadTask(`${TYPE_BASE}notifications/notify/0.1`)!;
  return {
    id: "urn:uuid:00000000-0000-4000-8000-00000000a001", type: n.typeUri, issuer: PLACEHOLDER_DID, recipient,
    issuedAt: "2026-11-12T10:00:00Z", payload: n.validPayload,
    proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", proofPurpose: "authentication", verificationMethod: `${PLACEHOLDER_DID}#key-0`, created: "2026-11-12T10:00:00Z", proofValue: "z3placeholder" },
  };
}

/** Payloads the schema-driven generator cannot build (an opaque document member): supplied here, from the task's own schema description. */
export function payloadOverride(slug: string, version: string): unknown {
  const key = `${slug}/${version}`;
  if (key === "notifications/relay/0.1") return { forwarded: notifyDocument(PLACEHOLDER_DID) };
  if (key === "vta/notifications/deposit/0.1") return { contextId: "example", document: notifyDocument(PLACEHOLDER_DID) };
  if (key === "vtc/directory/entries/show/0.1") return { did: "did:web:conformance-member.example" };
  if (key === "vtc/directory/images/get/0.1") return { entryId: "dir_conformanceEntry0001", field: "avatar" };
  return undefined;
}

/** The tasks of every 2L group at every non-deprecated version, with `validPayload` taken from the override where the generator could not build one. */
export function twoLTasks(): PlainTask[] {
  const out: PlainTask[] = [];
  for (const g of TWO_L_GROUPS) {
    for (const slug of g.slugs) {
      for (const version of versionsOf(slug)) {
        const t = loadTask(`${TYPE_BASE}${slug}/${version}`)!;
        const o = payloadOverride(slug, version);
        const valid = o !== undefined ? o : t.validPayload;
        out.push(valid === t.validPayload ? t : { ...t, validPayload: valid });
      }
    }
  }
  return out;
}

// --------------------------------------------------------------- unknown-identifier mechanics

/** A task whose specification declares a code for an identifier that names nothing: the member to replace and the code. Codes are from the task's spec (task-force origin/main 0dbc98f1c). */
export const UNKNOWN_ID: Record<string, { member: string; code: string }> = {
  "vta/notifications/show": { member: "recordId", code: "vta/notifications/show:notificationUnknown" },
  "vta/notifications/dismiss": { member: "recordId", code: "vta/notifications/dismiss:notificationUnknown" },
  "vtc/notifications/show": { member: "recordId", code: "vtc/notifications/show:notificationUnknown" },
  "vtc/join-requests/status": { member: "requestId", code: "vtc/join-requests/status:notFound" },
  "vtc/join-requests/withdraw": { member: "requestId", code: "vtc/join-requests/withdraw:notFound" },
  "vtc/invitations/revoke": { member: "id", code: "vtc/invitations/revoke:notFound" },
  "vtc/invitations/deliver": { member: "id", code: "vtc/invitations/deliver:notFound" },
};

/** A payload like the valid one with the identifier replaced by a value that names nothing and still satisfies the schema, or undefined when none validates. */
export function unknownIdPayload(t: PlainTask, member: string): { payload: J; known: unknown } | undefined {
  const root = t.payloadSchema as J;
  const base: J = isObj(t.validPayload) ? { ...t.validPayload } : {};
  const props = isObj(root["properties"]) ? root["properties"] : {};
  let known: unknown = base[member];
  if (known === undefined && isObj(props[member])) {
    const sub = props[member] as J;
    known = example({ $defs: root["$defs"], ...(typeof sub["$ref"] === "string" ? (resolveRef(root, sub["$ref"]) as J) : sub) } as J);
    base[member] = known;
  }
  if (typeof known !== "string") return undefined;
  const cands = [/^did:/.test(known) ? "did:web:conformance-unknown.example" : "", "conformance-unknown-identifier", "urn:uuid:00000000-0000-4000-8000-00000000c0de", `${known}-unknown`].filter((c) => c !== "");
  for (const c of cands) {
    const p = { ...base, [member]: c };
    if (validate(t.payloadSchema as J, p).length === 0) return { payload: p, known };
  }
  return undefined;
}
