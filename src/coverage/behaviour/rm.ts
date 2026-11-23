// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family RM (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import type { BehaviourRule, J } from "./types.ts";
import { memberValueRule, retire, unknownIdRule } from "./types.ts";

const F = "RM";
const q = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): J => (isObj(v) ? v : {});

/** [slug, version, member, code, quoted words]: an identifier the text says names nothing is refused with the task's own code. */
const UNKNOWN: [string, string, string, string, string][] = [
  ["rooms/blobs/chunk", "0.1", "downloadId", "notFound", "No open download with this id exists that the caller may read from"],
  ["rooms/blobs/get", "0.2", "blobRef", "notFound", "No blob with this BlobRef is committed in this room"],
  ["rooms/blobs/upload/abort", "0.2", "uploadId", "notFound", "No upload with this id exists that the caller may abort"],
  ["rooms/blobs/upload/chunk", "0.2", "uploadId", "notFound", "No open upload with this id exists that the caller may write to"],
  ["rooms/blobs/upload/commit", "0.2", "uploadId", "notFound", "No upload with this id exists that the caller may commit"],
  ["rooms/epoch/chain", "0.2", "roomId", "notFound", "No room with this identifier is served here"],
  ["rooms/records/get", "0.2", "key", "notFound", "No record with that key in this room"],
  ["rooms/keys/chain", "0.2", "roomId", "notAMember", "The recipient holds no group state for this room, so there is nothing for the rungs to extend"],
  ["rooms/keys/commit", "0.1", "roomId", "notAMember", "The recipient holds no group state for this room"],
  ["rooms/keys/seal", "0.2", "roomId", "notAMember", "so there is no key to seal with"],
  ["rooms/keys/read", "0.1", "roomId", "notAMember", "so it has nothing to present and nothing to open with"],
  ["rooms/keys/browse", "0.3", "roomId", "notAMember", "so it has nothing to present"],
  ["rooms/keys/backfill", "0.2", "roomId", "notAMember", "so there is nothing for the rungs to extend and no credentials to present"],
  ["rooms/keys/file-key", "0.2", "roomId", "noGroup", "The oracle holds no group for this room"],
  ["rooms/owner/group/add", "0.3", "roomId", "noGroup", "The recipient holds no group state for this room"],
  ["rooms/owner/group/renew", "0.2", "roomId", "noGroup", "The recipient holds no group state for this room"],
  ["rooms/keys/label", "0.1", "roomId", "notHeld", "The recipient holds no group state for"],
  ["vtc/rooms/community/archive", "0.1", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/get", "0.4", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/members/add", "0.2", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/members/list", "0.2", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/removal/cancel", "0.1", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/unarchive", "0.1", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/community/update", "0.3", "roomId", "notFound", "The community owns no room with this identifier"],
  ["vtc/rooms/get", "0.3", "roomId", "notFound", "The community hosts no room with this identifier"],
  ["vtc/rooms/limits/set", "0.1", "roomId", "notFound", "The community hosts no room with this identifier"],
  ["vtc/rooms/storage/assign", "0.2", "roomId", "roomNotFound", "The community hosts no room with this identifier"],
  ["vtc/rooms/storage/assign", "0.2", "configId", "configNotFound", "The community has no storage config with this identifier"],
  ["vtc/rooms/storage/migrate", "0.3", "roomId", "roomNotFound", "The community hosts no room with this identifier"],
  ["rooms/owner/group/create", "0.1", "signingKeyId", "noSigningKey", "The recipient holds no key by that identifier"],
  ["rooms/owner/invite", "0.1", "signingKeyId", "noSigningKey", "The recipient holds no key by that identifier"],
  ["rooms/owner/issue-authority", "0.2", "signingKeyId", "noSigningKey", "The recipient holds no key by that identifier"],
  ["rooms/owner/issue-membership", "0.1", "signingKeyId", "noSigningKey", "The recipient holds no key by that identifier"],
  ["vtc/rooms/community/create", "0.4", "storageConfig", "unknownStorageConfig", "names no config, or one that is not"],
];

/** Identifiers whose schema fixes a format: a well-formed value that names nothing. */
const UUID_UNKNOWN = "00000000-0000-4000-8000-00000000c0de";
const WELL_FORMED: Record<string, string> = { downloadId: UUID_UNKNOWN, uploadId: UUID_UNKNOWN, blobRef: "zQmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnS" };

/** Members a request needs besides the unknown identifier so that the identifier is the only thing wrong (the valid payload the builder makes names no change at all). */
const EXTRA: Record<string, J> = { "vtc/rooms/limits/set": { limits: { maxFileBytes: 1 } } };

const unknownRules: BehaviourRule[] = UNKNOWN.map(([slug, version, member, code, words]) => WELL_FORMED[member] !== undefined
  ? memberValueRule({ family: F, slug, version, member, value: WELL_FORMED[member], code: `${slug}:${code}`, quote: [q(slug, version, words)], stateFree: true })
  : unknownIdRule({ family: F, slug, version, member, code: `${slug}:${code}`, quote: [q(slug, version, words)], ...(EXTRA[slug] === undefined ? {} : { extra: EXTRA[slug] }) }));

/** Rules withdrawn because the stated code is reached only after the host has authorised the presentation against a room it holds (or after a lookup that needs prior state). */
const PRESENTATION = "the host authorises from the presentation alone against a room it holds before it answers anything else (consumer item 1), so the stated code is reached only for an existing room and a presentation that verifies: prior state";
const BEGIN_REASON = "the host authorises the presentation (item 1) and checks filesDisabled (item 2) before it checks the manifest (item 3), so invalidManifest and invalidParts are reached only for an existing room and a presentation that verifies: prior state";
const RETIRED: Record<string, string> = {
  "rooms/blobs/get/0.2:rooms/blobs/get:notFound": PRESENTATION,
  "rooms/records/get/0.2:rooms/records/get:notFound": PRESENTATION,
  "rooms/records/list/0.5:rooms/records/list:invalidCursor": PRESENTATION,
  "rooms/blobs/upload/begin/0.2:rooms/blobs/upload/begin:invalidManifest": BEGIN_REASON,
  "rooms/blobs/upload/begin/0.2:rooms/blobs/upload/begin:invalidManifestDigests": BEGIN_REASON,
  "rooms/blobs/upload/begin/0.2:rooms/blobs/upload/begin:invalidParts": BEGIN_REASON,
  "rooms/blobs/upload/begin/0.2:rooms/blobs/upload/begin:invalidPartsDigests": BEGIN_REASON,
  "vtc/rooms/storage/assign/0.2:vtc/rooms/storage/assign:configNotFound": "the text lists roomNotFound and configNotFound in one sentence with no order, and an unknown config can only be isolated against a room the community hosts: prior state",
};

const cursor = (slug: string, version: string, words: string): BehaviourRule =>
  memberValueRule({ family: F, slug, version, member: "cursor", value: "conformance-unissued-cursor", code: `${slug}:invalidCursor`, quote: [q(slug, version, words)] });

/** A rule built from a closure over the valid payload; `refuses` states the condition the text gives. */
function custom(o: { slug: string; version: string; code: string; suffix?: string; title: string; words: string; build: (valid: J) => J | undefined; refuses: (p: J) => boolean }): BehaviourRule {
  return {
    key: `${o.slug}/${o.version}:${o.slug}:${o.code}${o.suffix ?? ""}`, family: F, slug: o.slug, version: o.version,
    title: `${o.slug} ${o.version}: ${o.title}, refused with ${o.code}`, quote: [q(o.slug, o.version, o.words)], codes: [`${o.slug}:${o.code}`],
    trigger: (t) => (isObj(t.validPayload) ? o.build(t.validPayload) : undefined),
    refuses: (p) => isObj(p) && o.refuses(p),
  };
}

const DIGEST = "zQmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";
const manifestOf = (p: J): J => obj(p["manifest"]);
const chunksOf = (p: J): J => obj(manifestOf(p)["chunks"]);
const ceilDiv = (a: unknown, b: unknown): number => (typeof a === "number" && typeof b === "number" && b > 0 ? Math.ceil(a / b) : NaN);
const withChunks = (p: J, chunks: J): J => ({ ...p, manifest: { ...manifestOf(p), chunks: { ...chunksOf(p), ...chunks } } });
const BEGIN = "rooms/blobs/upload/begin";

const customRules: BehaviourRule[] = [
  custom({ slug: BEGIN, version: "0.2", code: "invalidManifest", title: "chunks.chunkCount is not ceil(size / chunkSize)", words: "is not ceil(size / chunks.chunkSize)",
    build: (v) => withChunks(v, { chunkCount: 2, chunkDigests: [DIGEST, DIGEST] }),
    refuses: (p) => { const c = chunksOf(p); return c["chunkCount"] !== ceilDiv(manifestOf(p)["size"], c["chunkSize"]); } }),
  custom({ slug: BEGIN, version: "0.2", code: "invalidManifest", suffix: "Digests", title: "chunks.chunkDigests does not have exactly chunkCount items", words: "does not have exactly",
    build: (v) => withChunks(v, { chunkDigests: [DIGEST, DIGEST] }),
    refuses: (p) => { const c = chunksOf(p); return Array.isArray(c["chunkDigests"]) && c["chunkDigests"].length !== c["chunkCount"]; } }),
  custom({ slug: BEGIN, version: "0.2", code: "invalidParts", title: "directParts.partCount is not ceil(size / partSize)", words: "is not ceil(size / partSize)",
    build: (v) => ({ ...v, directParts: { partSize: 16384, partCount: 2, partDigests: [DIGEST, DIGEST] } }),
    refuses: (p) => { const d = obj(p["directParts"]); return p["directParts"] !== undefined && d["partCount"] !== ceilDiv(manifestOf(p)["size"], d["partSize"]); } }),
  custom({ slug: BEGIN, version: "0.2", code: "invalidParts", suffix: "Digests", title: "directParts.partDigests does not have partCount items", words: "does not have `partCount` items",
    build: (v) => ({ ...v, directParts: { partSize: 16384, partCount: 1, partDigests: [DIGEST, DIGEST] } }),
    refuses: (p) => { const d = obj(p["directParts"]); return Array.isArray(d["partDigests"]) && d["partDigests"].length !== d["partCount"]; } }),
  custom({ slug: "vtc/rooms/limits/set", version: "0.1", code: "invalidCombination", suffix: "Clear", title: "limits is named with clear: true", words: "names `limits` with `clear: true`",
    build: (v) => ({ ...v, limits: { maxFileBytes: 1 }, clear: true }),
    refuses: (p) => p["limits"] !== undefined && p["clear"] === true }),
  custom({ slug: "vtc/rooms/limits/set", version: "0.1", code: "invalidCombination", suffix: "FilesEnabled", title: "filesEnabled is named with a target other than room", words: "names `filesEnabled` with a target other than `room`",
    build: (v) => ({ ...v, target: { kind: "memberDefault" }, filesEnabled: true }),
    refuses: (p) => p["filesEnabled"] !== undefined && obj(p["target"])["kind"] !== undefined && obj(p["target"])["kind"] !== "room" }),
];

const UNLISTED = "https://trusttasks.org/spec/rooms/conformance-unlisted/0.1";
const docType = (p: J): unknown => obj(p["document"])["type"];
const ACT = "rooms/keys/act";
const actRules: BehaviourRule[] = ["0.8", "0.9", "0.10"].map((version) => custom({ slug: ACT, version, code: "typeNotActable", title: "the document's type is not in the task's table of host-bound room requests",
  words: "is not in this task's table of host-bound room requests", build: (v) => ({ ...v, document: { ...obj(v["document"]), type: UNLISTED } }), refuses: (p) => docType(p) === UNLISTED }));

const SEAL = "rooms/keys/seal";
const decodes = (plaintext: unknown): boolean => {
  if (typeof plaintext !== "string") return true;
  try { return isObj(JSON.parse(Buffer.from(plaintext, "base64url").toString("utf8"))); } catch { return false; }
};
const USAGE = "vtc/rooms/usage";
const dayOf = (v: unknown): number => (typeof v === "string" ? Date.parse(`${v}T00:00:00Z`) : NaN);
const withFilter = (v: J, f: J): J => ({ ...v, filter: { ...obj(v["filter"]), ...f } });

const moreRules: BehaviourRule[] = [
  ...actRules,
  custom({ slug: SEAL, version: "0.2", code: "bodyInvalid", title: "under signAsPrincipal, plaintext does not decode to a sealed record body", words: "refuse with `bodyInvalid` unless it is a `SealedRecordBody` with no `proof` and no unknown member",
    build: (v) => ({ ...v, signAsPrincipal: true, plaintext: "bm90LWpzb24" }), refuses: (p) => p["signAsPrincipal"] === true && !decodes(p["plaintext"]) }),
  custom({ slug: USAGE, version: "0.1", code: "invalidRange", title: "from is after to", words: "is after `to`, the range is longer than 400 days",
    build: (v) => withFilter(v, { from: "2026-02-01", to: "2026-01-01" }),
    refuses: (p) => { const f = obj(p["filter"]); return dayOf(f["from"]) > dayOf(f["to"]); } }),
  custom({ slug: USAGE, version: "0.1", code: "invalidRange", suffix: "TooLong", title: "the range is longer than 400 days", words: "the range is longer than 400 days",
    build: (v) => withFilter(v, { from: "2024-01-01", to: "2026-01-01" }),
    refuses: (p) => { const f = obj(p["filter"]); return (dayOf(f["to"]) - dayOf(f["from"])) / 86_400_000 > 400; } }),
];

const ALL: BehaviourRule[] = [
  ...unknownRules,
  cursor("rooms/records/list", "0.5", "The cursor was not issued by this host, or has expired"),
  cursor("vtc/rooms/usage", "0.1", "was not issued by this community for this filter, grouping and sort"),
  ...customRules,
  ...moreRules,
];

export const RULES: BehaviourRule[] = ALL.map((r) => (RETIRED[r.key] === undefined ? r : retire(r, RETIRED[r.key]!)));
for (const k of Object.keys(RETIRED)) if (!ALL.some((r) => r.key === k)) throw new Error(`rm.ts: retired key ${k} matches no rule`);
