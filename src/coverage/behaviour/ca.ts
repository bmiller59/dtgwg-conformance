// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family CA (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import type { BehaviourRule, J } from "./types.ts";
import { memberValueRule, unknownIdRule } from "./types.ts";

const F = "CA";
const sp = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;
/** A free-form string identifier that names nothing. */
const unknown = (slug: string, version: string, member: string, code: string, words: string): BehaviourRule =>
  unknownIdRule({ family: F, slug, version, member, code, quote: [sp(slug, version, words)] });
const value = (slug: string, version: string, member: string, v: unknown, code: string, words: string): BehaviourRule =>
  memberValueRule({ family: F, slug, version, member, value: v, code, quote: [sp(slug, version, words)] });

const CURSOR = "conformance-unissued-cursor";
/** The task's own lack-of-authority code (the text puts the administrator check first, as the authorisation gate): accepted beside permissionDenied. */
const notAdmin = (r: BehaviourRule, words: string): BehaviourRule => ({ ...r, alsoAccept: [{ code: `${r.slug}:notAdministrator`, quote: sp(r.slug, r.version, words) }] });
const SHOW_ADMIN = "a caller holding no administrative role is `notAdministrator`";
const LIST_ADMIN = "refuse a caller holding no administrative role with `notAdministrator`";
const ACCOUNT = "No account with this id exists in the named context that the caller may see.";
const ACTION = "No action with this actionId exists that the caller may see.";

export const RULES: BehaviourRule[] = [
  // external accounts (VTA): an account identifier that names nothing in the named context
  unknown("external/accounts/archive", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/bindings/grant", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/get", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/probe", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/resume", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/secret/set", "0.1", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/setup", "0.1", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/suspend", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/accounts/update", "0.2", "id", "external:notFound", ACCOUNT),
  unknown("external/credentials/issue", "0.3", "account", "external:notFound", ACCOUNT),
  // git-ns (VTC)
  unknown("git-ns/account/link-status", "0.1", "linkId", "git-ns/account/link-status:unknownLink", "No link with this identifier was begun by the caller"),
  unknown("git-ns/bridge/result", "0.2", "jobId", "git-ns/bridge/result:unknownJob", "The VTC sent no job with this"),
  unknown("git-ns/repo/create", "0.4", "namespace", "git-ns:unknownNamespace", "No namespace bound to this VTC has this identifier"),
  value("git-ns/repo/archive", "0.3", "resource", "b.b/b/b", "git-ns:unknownRepo", "The resource names no repository this VTC records."),
  value("git-ns/repo/transfer", "0.3", "resource", "b.b/b/b", "git-ns:unknownRepo", "The resource names no repository this VTC records."),
  {
    key: "git-ns/right/grant/0.4:expiryInPast", family: F, slug: "git-ns/right/grant", version: "0.4",
    title: "git-ns/right/grant 0.4: an expiresAt that is not in the future is refused with git-ns/right/grant:expiryInPast",
    quote: [sp("git-ns/right/grant", "0.4", "expiresAt is not in the future.")], codes: ["git-ns/right/grant:expiryInPast"],
    trigger: (t) => (typeof t.validPayload === "object" && t.validPayload !== null ? { ...(t.validPayload as J), expiresAt: "2001-01-01T00:00:00Z" } : undefined),
    refuses: (p) => typeof p["expiresAt"] === "string" && Date.parse(p["expiresAt"]) <= Date.now(),
  },
  // vtc admin actions, schemas, storage, networks
  unknown("vtc/admin/actions/acknowledge", "0.3", "actionId", "vtc/admin/actions/acknowledge:notFound", ACTION),
  unknown("vtc/admin/actions/cancel", "0.3", "actionId", "vtc/admin/actions/cancel:notFound", ACTION),
  notAdmin(unknown("vtc/admin/actions/show", "0.3", "actionId", "vtc/admin/actions/show:notFound", ACTION), SHOW_ADMIN),
  notAdmin(value("vtc/admin/actions/list", "0.3", "cursor", CURSOR, "vtc/admin/actions/list:invalidCursor", "is not one this community issued"), LIST_ADMIN),
  notAdmin({
    key: "vtc/admin/actions/list/0.3:invalidFilter", family: F, slug: "vtc/admin/actions/list", version: "0.3",
    title: "vtc/admin/actions/list 0.3: a since supplied with a view other than history is refused with vtc/admin/actions/list:invalidFilter",
    quote: [sp("vtc/admin/actions/list", "0.3", "since was supplied with a view other than history")], codes: ["vtc/admin/actions/list:invalidFilter"],
    trigger: (t) => (typeof t.validPayload === "object" && t.validPayload !== null ? { ...(t.validPayload as J), view: "waitingForMe", since: "2026-01-01T00:00:00Z" } : undefined),
    refuses: (p) => p["since"] !== undefined && p["view"] !== "history",
  }, LIST_ADMIN),
  unknown("vtc/schemas/accepts/show", "0.2", "id", "vtc/schemas/accepts/show:notFound", "No criterion is registered under this id."),
  unknown("vtc/schemas/show", "0.1", "typeUri", "vtc/schemas/show:notFound", "No entry is registered for this type URI."),
  value("vtc/storage/configs/get", "0.2", "configId", "b", "vtc/storage/configs/get:notFound", "The community has no storage config with this identifier."),
  value("vtc/storage/configs/probe", "0.1", "configId", "b", "vtc/storage/configs/probe:notFound", "The community has no storage config with this identifier."),
  value("vtc/storage/configs/retire", "0.3", "configId", "b", "vtc/storage/configs/retire:notFound", "The community has no storage config with this identifier."),
  value("vtc/storage/configs/update", "0.3", "configId", "b", "vtc/storage/configs/update:notFound", "The community has no storage config with this identifier."),
  value("vtc/storage/configs/list", "0.2", "cursor", CURSOR, "vtc/storage/configs/list:invalidCursor", "was not issued by this community for this filter"),
];
