// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family AA (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import type { BehaviourRule, J } from "./types.ts";
import { memberValueRule, retire, unknownIdRule } from "./types.ts";

const F = "AA";
const sp = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;
/** A free-form string identifier that names nothing. */
const unknown = (slug: string, version: string, member: string, code: string, words: string): BehaviourRule =>
  unknownIdRule({ family: F, slug, version, member, code, quote: [sp(slug, version, words)] });
/** An identifier whose schema is a pattern (or a UUID): the value that names nothing is given explicitly. */
const value = (slug: string, version: string, member: string, v: unknown, code: string, words: string): BehaviourRule =>
  memberValueRule({ family: F, slug, version, member, value: v, code, quote: [sp(slug, version, words)] });

const UUID = "00000000-0000-4000-8000-00000000c0de";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const HEX32 = "fedcba9876543210fedcba9876543210";
const CURSOR = "conformance-unissued-cursor";

const backup = (pre: string, v: Record<string, string>): BehaviourRule[] => [
  value(`${pre}abort`, v["abort"]!, "bundleId", UUID, `${pre}abort:notFound`, "holds no bundle under this identifier"),
  value(`${pre}complete-export`, v["complete-export"]!, "bundleId", UUID, `${pre}complete-export:notFound`, "holds no export bundle under this identifier"),
  value(`${pre}finalize-import`, v["finalize-import"]!, "bundleId", UUID, `${pre}finalize-import:notFound`, "holds no import bundle under this identifier"),
  value(`${pre}get-chunk`, v["get-chunk"]!, "bundleId", UUID, `${pre}get-chunk:notFound`, "holds no live chunked export bundle under this identifier"),
  value(`${pre}put-chunk`, v["put-chunk"]!, "bundleId", UUID, `${pre}put-chunk:notFound`, "holds no open chunked import slot under this identifier"),
];

export const RULES: BehaviourRule[] = [
  // backup (VTC 0.1 and VTA 1.x): a bundle identifier that names nothing the producer may act on
  ...backup("backup/", { abort: "0.1", "complete-export": "0.1", "finalize-import": "0.1", "get-chunk": "0.1", "put-chunk": "0.1" }),
  ...backup("vta/backup/", { abort: "1.0", "complete-export": "1.0", "finalize-import": "1.1", "get-chunk": "1.0", "put-chunk": "1.0" }),
  // provision (keyring-wallet): a reservation handle that names nothing
  value("provision/vta/claim", "0.1", "handle", HEX32, "provision/vta:handleNotFound", "No reservation has this handle."),
  value("provision/vta/redeem", "0.1", "handle", HEX32, "provision/vta:handleNotFound", "No reservation has this handle."),
  // persona: contacts and lists
  value("persona/contact/get", "1.1", "contactId", ULID, "persona/contact/get:notFound", "No contact exists at that identifier in this context."),
  value("persona/contact/lists/show", "1.0", "listId", ULID, "persona/contact/lists/show:notFound", "names no list in this context"),
  value("persona/contact/lists/put", "1.1", "listId", ULID, "persona/contact/lists/put:notFound", "names no list in this context"),
  value("persona/contact/list", "1.1", "listId", ULID, "persona/contact/list:listUnknown", "names no list in this context"),
  value("persona/contact/list", "1.1", "cursor", CURSOR, "persona/contact/list:cursorInvalid", "The supplied cursor is unrecognised"),
  value("persona/contact/lists/list", "1.0", "cursor", CURSOR, "persona/contact/lists/list:cursorInvalid", "The supplied cursor is unrecognised or expired"),
  value("persona/world/list", "1.0", "cursor", CURSOR, "persona/world/list:invalidCursor", "The supplied cursor was not one this maintainer issued"),
  // vta: cursors and identifiers
  value("vta/app-state/list", "1.1", "cursor", CURSOR, "vta/app-state/list:cursorInvalid", "issued against maintainer state that no longer exists"),
  value("vta/credentials/list", "0.2", "cursor", CURSOR, "vta/credentials/list:cursorInvalid", "issued against agent state no longer recognised"),
  unknown("vta/contexts/get", "1.0", "id", "vta/contexts/get:notFound", "No context with this id is reachable by the caller."),
  unknown("vta/contexts/preview-delete", "1.0", "id", "vta/contexts/preview-delete:notFound", "No context with this id is reachable by the caller."),
  unknown("vta/contexts/update", "1.0", "id", "vta/contexts/update:notFound", "No context with this id is reachable by the caller."),
  unknown("vta/contexts/update-did", "1.1", "id", "vta/contexts/update-did:notFound", "No context with this id is reachable by the caller."),
  unknown("vta/contexts/secrets", "1.0", "id", "vta/contexts/secrets:notFound", "No context with this id exists within the caller's entitlement."),
  unknown("vta/contexts/create", "1.0", "parent", "vta/contexts/create:parentNotFound", "The named parent context does not exist or is not reachable by the caller."),
  unknown("vta/did-templates/get", "3.1", "name", "vta/did-templates/get:notFound", "No template with this name in the selected scope."),
  unknown("vta/did-templates/render", "2.0", "name", "vta/did-templates/render:notFound", "No template with this name in the selected scope."),
  unknown("vta/did-templates/update", "3.1", "name", "vta/did-templates/update:notFound", "No template with this name in the selected scope to replace."),
  unknown("vta/did-templates/create", "3.1", "contextId", "vta/did-templates/create:contextNotFound", "The context named by contextId does not exist."),
  // the text lists `unavailable` for a VTA whose passkey feature is not configured (item 4, after didNotFound in the list but with no order stated)
  { ...unknown("vta/passkey-vms/enroll-challenge", "0.1", "did", "vta/passkey-vms/enroll-challenge:didNotFound", "The target DID is not managed by this VTA"),
    alsoAccept: [{ code: "unavailable", quote: sp("vta/passkey-vms/enroll-challenge", "0.1", "Where the passkey feature is not configured on this VTA, respond with the framework's `unavailable`") }] },
  unknown("vta/passkey-vms/list", "0.1", "did", "vta/passkey-vms/list:didNotFound", "The target DID is not managed by this VTA."),
  retire(unknown("vta/passkey-vms/enroll-submit", "0.2", "ceremonyId", "vta/passkey-vms/enroll-submit:unknownCeremony", "is unknown, has expired, or has already been consumed"),
    "reachable only on a host whose passkey feature is configured (a public origin): a host without it answers unavailable, which this task's text does not list, and the adapter contract has no capability name to declare the need; to be re-issued under a new id once one exists"),
  unknown("vta/webvh/agent-name/list", "1.1", "did", "vta/webvh/agent-name/list:notFound", "The DID is unknown to this VTA or unreachable by the caller."),
  unknown("vta/webvh/agent-name/set", "1.0", "did", "vta/webvh/agent-name/set:notFound", "The DID is unknown to this VTA, unreachable by the caller, or does not hold this name."),
  unknown("vta/webvh/agent-name/enable", "1.0", "did", "vta/webvh/agent-name/enable:notFound", "The DID is unknown to this VTA, unreachable by the caller, or does not hold this name."),
  unknown("vta/webvh/dids/get", "1.0", "did", "vta/webvh/dids/get:notFound", "No such DID is held by this VTA, or the caller cannot reach its context."),
  unknown("vta/webvh/dids/realign-keys", "1.0", "did", "vta/webvh/dids/realign-keys:notFound", "No such DID is held by this recipient, or the caller cannot reach its context."),
  unknown("vta/webvh/dids/update", "1.1", "did", "vta/webvh/dids/update:notFound", "The agent holds no update key for this DID."),
  ...(["1.0", "1.1", "1.2"] as const).map((v) => value("vta/webvh/dids/create", v, "template", "conformance-unknown-template", "vta/webvh/dids/create:templateNotFound", "The named DID template does not exist in the selected scope.")),
  {
    key: "vta/services/report/0.2:invalidWindow", family: F, slug: "vta/services/report", version: "0.2",
    title: "vta/services/report 0.2: a since later than until is refused with vta/services/report:invalidWindow",
    quote: [sp("vta/services/report", "0.2", "since is after until")], codes: ["vta/services/report:invalidWindow"],
    trigger: () => ({ since: "2026-01-02T00:00:00Z", until: "2026-01-01T00:00:00Z" }),
    refuses: (p: J) => typeof p["since"] === "string" && typeof p["until"] === "string" && Date.parse(p["since"]) > Date.parse(p["until"]),
  },
];
