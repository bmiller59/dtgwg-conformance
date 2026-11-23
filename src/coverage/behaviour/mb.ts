// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family MB (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import { retire, unknownIdRule, type BehaviourRule, type J } from "./types.ts";

const F = "MB";
const q = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;
const unknown = (slug: string, version: string, member: string, code: string, words: string, suffix?: string): BehaviourRule =>
  unknownIdRule({ family: F, slug, version, member, code: `${slug}:${code}`, quote: [q(slug, version, words)], ...(suffix === undefined ? {} : { suffix }) });

/** An identifier whose type pattern rejects the generic unknown values: the same rule with a named value that names nothing. */
const unknownVal = (slug: string, version: string, member: string, code: string, words: string, value: string): BehaviourRule => ({
  key: `${slug}/${version}:${slug}:${code}`, family: F, slug, version,
  title: `${slug} ${version}: an identifier (${member}) that names nothing is refused with ${code}`, quote: [q(slug, version, words)], codes: [`${slug}:${code}`],
  trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, [member]: value } : undefined),
  refuses: (p, t) => isObj(p) && p[member] !== undefined && isObj(t.validPayload) && p[member] !== t.validPayload[member],
});

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

export const RULES: BehaviourRule[] = [
  unknown("vtc/directory/query", "0.1", "subject", "notFound", "No member with that DID, or none whose directory projection is visible to this caller"),
  unknownVal("vtc/join-requests/vetting/show", "0.1", "id", "notFound", "No join request with this id exists.", "00000000-0000-4000-8000-00000000c0de"),
  unknown("vtc/join-requests/wallet-session/status", "0.1", "sessionId", "notFound", "No session with the supplied `sessionId` exists"),
  unknownVal("vtc/join-requests/wallet-session/start", "0.1", "criterion", "criterionNotFound", "No criterion the community publishes, or still honours within its `requirementsGrace`, has the supplied `requirementsDigest`.", "zQmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS"),
  retire(unknown("vtc/join-requests/wallet-session/start", "0.1", "requestId", "requestNotFound", "No join request with the supplied `requestId` exists"),
    "the consumer list resolves the criterion first (item 1, criterionNotFound) and only then the request (item 2, requestNotFound), so the code needs a criterion the community publishes: prior state"),
  unknown("vtc/join-requests/query", "0.1", "criterionId", "criterionNotFound", "No Accepts criterion is registered under `criterionId`."),
  // the platform parses the id as a UUID before it looks it up (the schema says string only): a well-formed id that names nothing
  unknownIdRule({ family: F, slug: "vtc/join-requests/decide", version: "0.1", member: "id", code: "vtc/join-requests/decide:notFound", quote: [q("vtc/join-requests/decide", "0.1", "No join request with the supplied id exists.")], value: "00000000-0000-4000-8000-00000000c0de" }),
  unknown("vtc/members/credentials", "0.1", "did", "notFound", "No member with the supplied `did` exists in this community."),
  unknown("vtc/members/personhood/assert", "0.2", "did", "notFound", "No member with the supplied did exists."),
  retire(unknown("vtc/members/vmc", "0.1", "requestId", "requestNotFound", "`requestId` was supplied but no join request with that id exists."),
    "the text verifies the sender's membership (notAMember) and the credential (invalidCredential, subjectMismatch) before it resolves the join request, so the code needs an active member delivering a credential that verifies: prior state"),
  unknown("vtc/notifications/relay", "0.1", "recordId", "notificationUnknown", "`recordId` names no notification the community holds"),
  unknownVal("vtc/relationships/suspend", "0.2", "id", "notFound", "No edge with this id exists that the caller may suspend.", "00000000-0000-4000-8000-00000000c0de"),
  unknown("vtc/roles/show", "0.1", "name", "notFound", "No built-in or custom role of this name exists."),
  {
    key: "vtc/notifications/relay/0.1:vtc/notifications/relay:groupUnknown", family: F, slug: "vtc/notifications/relay", version: "0.1",
    title: "vtc/notifications/relay 0.1: recipients.groupId that names no community group is refused with groupUnknown",
    quote: [q("vtc/notifications/relay", "0.1", "`recipients.groupId` names no community group, or one the caller may not see.")],
    codes: ["vtc/notifications/relay:groupUnknown"],
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, recipients: { scope: "group", groupId: "grp_conformanceUnknown0000" } } : undefined),
    refuses: (p) => isObj(p) && isObj(p["recipients"]) && p["recipients"]["scope"] === "group" && p["recipients"]["groupId"] !== undefined,
  },
];
