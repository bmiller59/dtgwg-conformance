// SPDX-License-Identifier: Apache-2.0
// The seeded-state probe (docs/22, decision CV-16): vectors that first CREATE the object a held finding's request names, through the
// task the platform serves for it (`rooms/create` 0.2, `git-ns/namespace/bind` 0.2), then send the same schema-invalid payloads naming
// the REAL object. A platform that looks the object up before it validates answered `taskFailed` (a not-found) to the unseeded form;
// with the object present it either refuses the payload (malformedRequest: lookup first, an order the text does not fix) or still does
// not (it never validates: a platform that differs from SPEC.md 7.2 item 2). No host change is needed: the create is a signed Trust Task
// on the same path as every other step. Advisory, channel `proposed`, outside every headline count.
import { fileURLToPath } from "node:url";
import { loadTaskFacts, stateCodes } from "./reachable.ts";
import { loadTask, TYPE_BASE } from "../plain/catalog.ts";
import { validate } from "../plain/schema.ts";
import type { Vector, VectorFile } from "../vectors/types.ts";
import { BEHAVIOUR_RULES } from "./behaviour/index.ts";

/** The behavioural rule a CB vector id was generated from (the generator numbers a family's rules in list order). */
export function ruleOf(cbId: string): (typeof BEHAVIOUR_RULES)[number] {
  const m = /^CB-([A-Z]+)-(\d+)$/.exec(cbId);
  const r = m === null ? undefined : BEHAVIOUR_RULES.filter((x) => x.family === m[1])[Number(m[2]) - 1];
  if (r === undefined) throw new Error(`no behaviour rule for ${cbId}`);
  return r;
}

export const ROOM_CREATE = `${TYPE_BASE}rooms/create/0.2`;
export const NS_BIND = `${TYPE_BASE}git-ns/namespace/bind/0.2`;
/**
 * O-05: the version of rooms/create a probed task links to, where it is not 0.2 (rooms/records/prune 0.2 links `rooms/create` 0.3: its spec.md names retentionDays
 * "([`rooms/create`](../../../create/0.3/spec.md))" at lines 84 and 150). The seed creates the room with the version the probed task is written against.
 */
export const ROOM_CREATE_LINKED: Record<string, string> = { [`${TYPE_BASE}rooms/records/prune/0.2`]: `${TYPE_BASE}rooms/create/0.3` };
const createTypeFor = (probed: string): string => ROOM_CREATE_LINKED[probed] ?? ROOM_CREATE;
/** O-05: every seed step needs authority (rooms/create item 2, git-ns/namespace/bind item 1, keys/create item 2: permissionDenied for a producer without it), so a probe requires the harness actors to hold it. */
const AUTHORISED = "optional:authorised";

/** The held findings the seeded probe re-asks, by the vector that recorded them (docs/22 "Seeded-state probe"). */
export const HELD_ROOMS = ["CV-RM-107", "CV-RM-110", "CV-RM-113", "CX-RM-004", "CX-RM-005", "CX-RM-009", "CX-RM-010", "CX-RM-034", "CX-RM-035", "CX-RM-036", "CX-RM-037", "CX-RM-038", "CX-RM-039"] as const;
export const HELD_GITNS = ["CX-CA-022", "CX-CA-031", "CX-CA-033"] as const;

export const SEED_NOTE = "Seeded-state probe: the first step(s) create the object the later steps name, through the task the platform serves for it, so the later answers are not an object lookup failing. The probe asks only one thing: with the object present, is a schema-invalid payload refused with malformedRequest (or permissionDenied)? An answer of malformedRequest shows the platform looks the object up first and validates afterwards (an order SPEC.md 7.2 does not fix); an answer from the task itself or a success shows it does not validate that payload (7.2 item 2 is a MUST). Advisory.";

type Doc = { id: string; type: string; payload: Record<string, unknown>; [k: string]: unknown };
const docOf = (s: Vector["steps"][number]): Doc => (s.send as { document: Doc }).document;
const typeOf = (v: Vector): string => docOf(v.steps[0]!).type;

/** A step keeps its meaning under a seeded object only if the invalidity is not in the identifier itself. */
function idIsValid(typeUri: string, member: string, value: unknown): boolean {
  const t = loadTask(typeUri);
  if (t === undefined || typeof value !== "string" || value === "") return false;
  return !validate(t.payloadSchema as Record<string, unknown>, { [member]: value }).some((e) => e.startsWith(`/${member}`));
}

const unique = (id: string, n: number): string => {
  // keep the identifier's shape: a minted suffix on its last character run, never a new path or fragment. The token is minted per run (S-01), so a second run
  // does not meet `alreadyExists` from the room the first run created.
  return `${id}$mint(r${n})`;
};

const createStep = (k: number, roomId: string, visibility: string, type: string = ROOM_CREATE) => ({
  send: { document: { id: `$id(seed${k})`, type, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: { roomId, visibility, ownerDid: "$A" } } },
  expect: seedExpect(type, { roomId, visibility, ownerDid: "$A" }),
});

/**
 * R-01 for a seeding step: it expects the task's own response, so the task's other front-matter codes that the request can draw (the community's policy
 * refusing a bind, a custodian refusing a key it cannot make) are accepted beside it; a refused seed leaves the later, advisory steps to answer for a
 * missing object, which says nothing about the rule probed.
 */
function seedExpect(typeUri: string, payload: Record<string, unknown>): Record<string, unknown> {
  const fact = loadTaskFacts(fileURLToPath(new URL("../..", import.meta.url))).get(typeUri);
  const drawn = fact === undefined ? [] : stateCodes(fact, loadTask(typeUri)?.payloadSchema, payload).filter((c) => c.reachable).map((c) => c.code);
  return { disposition: "response", type: `${typeUri}#response`, ...(drawn.length === 0 ? {} : { orRefusal: drawn }) };
}

const bindStep = (k: number, forge: string, owner: string, capture?: string) => ({
  send: { document: { id: `$id(seed${k})`, type: NS_BIND, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: { forge, owner, mode: "manual" } } },
  expect: seedExpect(NS_BIND, { forge, owner, mode: "manual" }),
  ...(capture === undefined ? {} : { capture: { [capture]: "/payload/namespace/id" } }),
});

function derived(orig: Vector, id: string, steps: unknown[], reissues: string | undefined, extraRequires: string[], what: string): Vector {
  const own = typeOf(orig);
  return {
    id,
    title: `${orig.title.replace(/: the (payload|payloads) .*$/, "")}: the ${what} the request names exists, and a schema-invalid payload is still refused (seeded probe of ${orig.id})`,
    tier: 1,
    spec: [SEED_NOTE, `Re-asks ${orig.id}: the same payloads, kept only where the identifier they carry is itself valid, against an object the first step(s) created`, ...(orig.spec as string[])],
    clarify: null,
    requires: [...new Set([own, ...extraRequires, "optional:seed.defaults", AUTHORISED])],
    mutants: ["noPayloadValidation"],
    source: { ...(orig.source as object), note: `${(orig.source as { note?: string }).note ?? ""} Seeded-state probe of ${orig.id}${reissues === undefined ? "" : ` (${reissues})`}: advisory; a probe vector is derived from the held vector and adds no independent evidence of the schema.` } as never,
    steps: steps as never,
  } as Vector;
}

/** CP-RM: rooms vectors. One room per distinct valid roomId of the retained steps, created `open` where the example names an open room and `attributed` otherwise (the shipped rooms policy denies `private` by default, and that is the deployment's governance, not the probe's question). */
export function roomProbes(held: Vector[]): { vector: Vector; of: string; kept: number; dropped: number }[] {
  const out: { vector: Vector; of: string; kept: number; dropped: number }[] = [];
  let n = 0;
  for (const orig of held) {
    n++;
    const uri = typeOf(orig);
    const kept: Vector["steps"] = [];
    const ids: string[] = [];
    for (const s of orig.steps) {
      const d = docOf(s);
      const r = d.payload["roomId"];
      if (!idIsValid(uri, "roomId", r)) continue;
      if (!ids.includes(r as string)) ids.push(r as string);
      kept.push(s);
    }
    if (kept.length === 0) continue;
    const map = new Map(ids.map((i) => [i, unique(i, n)]));
    const createType = createTypeFor(uri);
    const steps: unknown[] = ids.map((i, k) => createStep(k + 1, map.get(i)!, /open/i.test(i) ? "open" : "attributed", createType));
    for (const s of kept) {
      const d = docOf(s);
      steps.push({ ...s, send: { ...(s.send as object), document: { ...d, id: d.id.replace(/\$id\((\w+)\)/, "$$id(p$1)"), payload: { ...d.payload, roomId: map.get(d.payload["roomId"] as string)! } } } });
    }
    out.push({ vector: derived(orig, `CP-RM-${String(out.length + 1).padStart(3, "0")}`, steps, undefined, [createType], "room"), of: orig.id, kept: kept.length, dropped: orig.steps.length - kept.length });
  }
  return out;
}

const NS_ID = /^ns_/;
const resourceNs = (r: string): { forge: string; owner: string } | undefined => {
  const m = /^([^/]+)\/([^/]+)\/.+$/.exec(r);
  return m === null ? undefined : { forge: m[1]!, owner: m[2]! };
};

/** CP-CA: git-ns vectors. A payload that names a namespace by id gets the id of one bound at the first step ($cap(ns)); one that names a resource gets its forge and owner bound. */
export function namespaceProbes(held: Vector[]): { vector: Vector; of: string; kept: number; dropped: number }[] {
  const out: { vector: Vector; of: string; kept: number; dropped: number }[] = [];
  const bound = new Set<string>();
  let n = 0;
  for (const orig of held) {
    n++;
    const uri = typeOf(orig);
    const kept: Vector["steps"] = [];
    const resources = new Set<string>();
    let byId = false;
    for (const s of orig.steps) {
      const p = docOf(s).payload;
      if (typeof p["namespace"] === "string" && NS_ID.test(p["namespace"] as string) && idIsValid(uri, "namespace", p["namespace"])) { kept.push(s); byId = true; continue; }
      if (typeof p["resource"] === "string" && idIsValid(uri, "resource", p["resource"]) && resourceNs(p["resource"] as string) !== undefined) { kept.push(s); const r = resourceNs(p["resource"] as string)!; resources.add(`${r.forge}/${r.owner}`); }
    }
    if (kept.length === 0) continue;
    const steps: unknown[] = [];
    if (byId) steps.push(bindStep(1, "github.com", "$mint(nsowner)", "ns"));
    for (const r of resources) {
      if (bound.has(r)) throw new Error(`${r} would be bound by two probe vectors`);
      bound.add(r);
      const [forge, owner] = r.split("/") as [string, string];
      steps.push(bindStep(steps.length + 1, forge, `$mint(own_${owner})`));
    }
    for (const s of kept) {
      const d = docOf(s);
      let payload: Record<string, unknown> = byId && typeof d.payload["namespace"] === "string" ? { ...d.payload, namespace: "$cap(ns)" } : d.payload;
      // S-01: the owner a probe binds is minted per run (a fixed owner is `alreadyBound` on the second run), so the resource names the minted owner
      const rs = typeof payload["resource"] === "string" ? resourceNs(payload["resource"]) : undefined;
      if (rs !== undefined) payload = { ...payload, resource: (payload["resource"] as string).replace(`${rs.forge}/${rs.owner}/`, `${rs.forge}/$mint(own_${rs.owner})/`) };
      steps.push({ ...s, send: { ...(s.send as object), document: { ...d, id: d.id.replace(/\$id\((\w+)\)/, "$$id(p$1)"), payload } } });
    }
    out.push({ vector: derived(orig, `CP-CA-${String(out.length + 1).padStart(3, "0")}`, steps, undefined, [NS_BIND], "namespace"), of: orig.id, kept: kept.length, dropped: orig.steps.length - kept.length });
  }
  return out;
}

/** The reference oracle's mutant that stops enforcing the re-issued refusal (seeded-state.ts). */
export const reissueMutantId = (cbId: string): string => `bs:${ruleOf(cbId).key}`;
export const KEY_CREATE = `${TYPE_BASE}keys/create/0.1`;
/** The retired behavioural rules the seeded probe can reach, with the member that names the object the first step creates (docs/22 "Seeded-state probe"). Every other tombstone stays retired, each for the reason in its `retired.reason`. */
export const REISSUES: { of: string; member: string; kind: "room" | "key" }[] = [
  { of: "CB-RM-028", member: "roomId", kind: "room" },
  { of: "CB-SD-021", member: "keyId", kind: "key" },
  { of: "CB-SD-023", member: "keyId", kind: "key" },
  { of: "CB-SD-024", member: "keyId", kind: "key" },
  { of: "CB-SD-025", member: "keyId", kind: "key" },
];

/**
 * Re-issue a retired behavioural vector under a new id (never the old one; the tombstone stays): the request is the tombstone's, its
 * identifier member now names an object the first step creates, so the stated refusal is reachable. `keyPayload` is the valid
 * keys/create payload. The expected codes are the tombstone's.
 */
export function reissueProbes(tombstones: Vector[], keyPayload: Record<string, unknown>, start: { room: number; key: number }): { vector: Vector; of: string; group: "CP-RM" | "CP-SD" }[] {
  const out: { vector: Vector; of: string; group: "CP-RM" | "CP-SD" }[] = [];
  const next = { ...start };
  for (const r of REISSUES) {
    const orig = tombstones.find((v) => v.id === r.of);
    if (orig === undefined || (orig as { retired?: unknown }).retired === undefined || ruleOf(r.of).retired === undefined || ruleOf(r.of).title !== orig.title) throw new Error(`${r.of} is not a retired vector of a retired rule`);
    const d = docOf(orig.steps[0]!);
    const room = r.kind === "room";
    const n = room ? ++next.room : ++next.key;
    const id = `CP-${room ? "RM" : "SD"}-${String(n).padStart(3, "0")}`;
    // S-01: a key is named by a minted token (a fixed keyId is `alreadyExists` on the second run); the room id carries a minted suffix (rooms/create declares `alreadyExists`)
    const objId = room ? `cpreissue$mint(room${r.of.slice(-3)})` : "$mint(key)";
    // O-05: keys/create returns the assigned keyId (spec.md item 4: "the assigned `keyId`"), which need not be the one asked for, so the later step names the captured one
    const named = room ? objId : "$cap(keyid)";
    const seed = room ? createStep(1, objId, "open") : {
      send: { document: { id: "$id(seed1)", type: KEY_CREATE, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: { ...keyPayload, keyId: objId, internal: true } } },
      expect: seedExpect(KEY_CREATE, { ...keyPayload, keyId: objId, internal: true }),
      capture: { keyid: "/payload/keyId" },
    };
    const own = docOf(orig.steps[0]!).type;
    const v = {
      id,
      title: `${orig.title} (re-issued from the retired ${orig.id} with the ${room ? "room" : "key"} created first)`,
      tier: 1,
      spec: [SEED_NOTE.replace(/The probe asks only one thing:.*$/, "The retired vector could not be reached from one document because the stated code needs this object (its tombstone says why); the object now exists, so the stated refusal is reachable."), ...(orig.spec as string[])],
      clarify: null,
      requires: [...new Set([own, room ? ROOM_CREATE : KEY_CREATE, AUTHORISED, ...(room ? ["optional:seed.defaults"] : [])])],
      mutants: [reissueMutantId(r.of)],
      source: { ...(orig.source as object), note: `${(orig.source as { note?: string }).note ?? ""} Re-issue of the retired ${orig.id} (the tombstone is kept; this id is new): the object the retired vector needed is created by its first step. Advisory.` } as never,
      steps: [seed, { send: { document: { ...d, id: "$id(p1)", payload: { ...d.payload, [r.member]: named } } }, expect: orig.steps[0]!.expect }],
    } as unknown as Vector;
    out.push({ vector: v, of: r.of, group: room ? "CP-RM" : "CP-SD" });
  }
  return out;
}

export function probeFiles(byId: Map<string, Vector>): { files: VectorFile[]; map: { probe: string; of: string; kept: number; dropped: number }[] } {
  const pick = (ids: readonly string[]): Vector[] => ids.map((i) => { const v = byId.get(i); if (v === undefined) throw new Error(`held vector ${i} not found`); return v; });
  const rm = roomProbes(pick(HELD_ROOMS));
  const ca = namespaceProbes(pick(HELD_GITNS));
  const keyTask = loadTask(KEY_CREATE);
  if (keyTask === undefined || typeof keyTask.validPayload !== "object" || keyTask.validPayload === null) throw new Error("keys/create has no valid payload");
  const re = reissueProbes(pick(REISSUES.map((r) => r.of)), keyTask.validPayload as Record<string, unknown>, { room: rm.length, key: 0 });
  const file = (group: string, list: { vector: Vector }[]): VectorFile => ({ format: "tt-conformance-vectors/0.1", group, family: "coverage", clock: { start: "2026-11-12T10:00:00Z" }, vectors: list.map((x) => x.vector) } as VectorFile);
  return {
    files: [file("CP-RM", [...rm, ...re.filter((x) => x.group === "CP-RM")]), file("CP-CA", ca), file("CP-SD", re.filter((x) => x.group === "CP-SD"))],
    map: [...rm.map((x) => ({ probe: x.vector.id, of: x.of, kept: x.kept, dropped: x.dropped })), ...ca.map((x) => ({ probe: x.vector.id, of: x.of, kept: x.kept, dropped: x.dropped })), ...re.map((x) => ({ probe: x.vector.id, of: x.of, kept: 1, dropped: 0 }))],
  };
}
