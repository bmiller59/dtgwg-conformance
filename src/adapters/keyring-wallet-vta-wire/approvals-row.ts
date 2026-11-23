// SPDX-License-Identifier: Apache-2.0
// The VTA's declarative approvals row (vta-sdk `approvals`, the reserved policy id `approvals`): the approver sets of a deployment, written over the wire with
// `policy/upsert/0.3`. The VTA re-derives the Rego module from `ext["openvtc.approvals"]` and byte-compares it, so the synthesis is a wire contract (pinned at
// vta-service 26d0da81, vta-sdk/src/approvals/mod.rs `synthesize_rego`); this file mirrors it for the rules this row needs (consent and reauth, no contexts).
export const APPROVALS_POLICY_ID = "approvals";
export const APPROVALS_POLICY_NAME = "Declarative approvals";
export const APPROVALS_POLICY_PRIORITY = 200;
export const EXT_KEY_RULES = "openvtc.approvals";
export const EXT_KEY_APPROVER_SETS = "openvtc.approver-sets";

export interface ApprovalRule { taskType: string; requires: "reauth" | "consent"; approverSet?: string; minApprovals?: number; excludeRequester?: boolean; contexts?: string[] }

const GENERATED_HEADER = [
  "# Generated from the declarative approvals rules — do not hand-edit.",
  "#",
  "# The VTA re-derives this module from ext[\"openvtc.approvals\"] on every upsert",
  "# and refuses the write if the two disagree, so an edit here is not a way to",
  "# change behaviour: change the rules instead.",
  "",
].join("\n");

export function regoString(s: string): string {
  let out = "\"";
  for (const c of s) out += c === "\"" ? "\\\"" : c === "\\" ? "\\\\" : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c;
  return out + "\"";
}

export function synthesizeRego(rules: ApprovalRule[]): string {
  let out = "package vta.policy\n\nimport rego.v1\n\n" + GENERATED_HEADER;
  for (const r of rules) {
    out += "\n";
    const guardType = `input.request.typeUri == ${regoString(r.taskType)}`;
    const ctx = r.contexts !== undefined && r.contexts.length > 0 ? `input.contextId in {${r.contexts.map(regoString).join(", ")}}` : undefined;
    const head = r.requires === "reauth"
      ? "decision := {\n\t\"decision\": \"requireStepUp\",\n}"
      : `decision := {\n\t"decision": "requireConsent",\n\t"requireConsent": {"approverSet": ${regoString(r.approverSet ?? "")}, "minApprovals": ${r.minApprovals ?? 1}, "excludeRequester": ${r.excludeRequester ?? false}},\n}`;
    out += ctx === undefined ? `${head} if ${guardType}\n` : `${head} if {\n\t${guardType}\n\t${ctx}\n}\n`;
  }
  return out;
}

/** The `policy/upsert/0.3` payload for the approvals row holding `rules` and `sets`; `expectedVersion` is the row's current version (0 when absent). */
export function approvalsUpsertPayload(rules: ApprovalRule[], sets: Record<string, string[]>, expectedVersion: number): Record<string, unknown> {
  return {
    id: APPROVALS_POLICY_ID, name: APPROVALS_POLICY_NAME, module: synthesizeRego(rules), priority: APPROVALS_POLICY_PRIORITY, enabled: true, expectedVersion,
    ext: { [EXT_KEY_RULES]: rules, [EXT_KEY_APPROVER_SETS]: sets },
  };
}
