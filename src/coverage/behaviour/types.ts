// SPDX-License-Identifier: Apache-2.0
// Behavioural coverage rules (phase 4, docs/22): one rule is one refusal a Trust Tasks specification states in its own text (an error
// code with the condition that raises it) that can be reached from a single document, with no prior state. A rule produces one vector
// (CB-<family>-nnn, channel proposed, advisory) and one reference-oracle behaviour with its own mutant. A SHOULD stays CLARIFY.
// Governance is never decided: every vector also accepts `permissionDenied`, because an authorisation gate may answer before the rule is reached and the
// framework fixes no order between that gate and a task's own checks (SPEC 7.2 item 10). A permissionDenied answer therefore shows only that a gate
// answered first, not that the stated rule held: a PASS means the request was refused, and a PASS with the task's own code carries the evidence.
import type { PlainTask } from "../../plain/catalog.ts";
import { unknownIdPayload } from "../../adapters/reference/2l-catalog.ts";
import { resolveRef, validate } from "../../plain/schema.ts";

export type J = Record<string, unknown>;

export interface BehaviourRule {
  /** Stable key, unique across all rules: `<slug>/<version>:<code>` plus a suffix when one code has several triggers. Also names the mutant (`bx:<key>`). */
  key: string;
  family: string;
  slug: string;
  version: string;
  /** One line: what the document asks and which refusal the text states. */
  title: string;
  /** Quotes of the specification text that state the rule, each as `specs/<slug>/<version>/spec.md: "<quoted words>"`. At least one; the quoted words must occur in the spec text. */
  quote: string[];
  /** Error codes accepted (the task's own code first); `permissionDenied` is always added by the generator (no rule is authority-free, see the header). */
  codes: string[];
  /**
   * Further codes the Trust Tasks text itself lists for this task and that a platform may answer first when the text fixes no order (each with
   * the quoted words that say so, same form as `quote`). Accepted by the vector, never by the oracle. Use only where the other code does not
   * make the vector vacuous in a way the text rules out; the vector's spec text says the accepted code shows only that the request was refused.
   */
  alsoAccept?: { code: string; quote: string }[];
  /**
   * Document members besides the payload that the rule's precondition needs (for example `parentThreadId` equal to `payload.requestId`), merged
   * into the request document by the generator. The oracle's `refuses` sees the payload only.
   */
  envelope?: (task: PlainTask, payload: J) => J;
  /**
   * The rule is withdrawn (docs/04 section 20.3): the vector keeps its id and its steps as a tombstone, is never run or counted, and the rule has no
   * oracle behaviour or mutant. `reason` says why (for example that the stated code can only appear after a lookup that needs prior state).
   */
  retired?: { reason: string; since: string };
  /**
   * The trigger names something that exists on no platform (an identifier that points at nothing): the answer depends on the platform's state,
   * so the vector says so (see `stateFreeNote`). Set by `unknownIdRule`; `memberValueRule` takes it as an option for a well-formed identifier.
   */
  stateFree?: true;
  /** SHOULD/MAY text only: the vector is CLARIFY with this explanation. */
  clarify?: string;
  /** The request payload that raises the refusal, built from the task's valid payload; undefined when none can be built (the rule is then not generated). */
  trigger(task: PlainTask): J | undefined;
  /** Whether the oracle refuses this payload (must be true for `trigger`'s output and false for the task's valid payload). */
  refuses(payload: J, task: PlainTask): boolean;
}

/** The sentence a state-free rule adds to its vector's spec text. */
export const stateFreeNote = (): string =>
  "State-free: the identifier names nothing on a platform with no such object; a platform with seeded state may answer differently, so the vector accepts only the task's code, permissionDenied and the further codes it names (the task's own standing codes, and a code the text runs earlier).";

/** The sentence every CB vector carries once: what a permissionDenied answer does and does not show. */
export const PERMISSION_DENIED_NOTE =
  "A permissionDenied answer shows only that an authorisation gate answered first, not that the stated rule held: the vector passes on it because the request was refused, and only a pass with the task's own code carries the evidence for the rule";

/** The sentence a vector adds for each further accepted code. */
export const alsoAcceptNote = (a: { code: string; quote: string }): string =>
  `Also accepted: ${a.code}, a code the text lists for this task and may be answered first where it fixes no order (${a.quote.replace(/^specs\/[^:]+: /, "")}); such a pass shows only that the request was refused`;

/** The suite version a retirement is stamped with (docs/04 section 20.3). */
export const RETIRED_SINCE = "0.1.0-draft";

/** A rule withdrawn: kept in place (its position is its vector id) as a tombstone. */
export const retire = (r: BehaviourRule, reason: string): BehaviourRule => ({ ...r, retired: { reason, since: RETIRED_SINCE } });

/** The request actor's DID in a trigger payload: the generator's document is issued by `$A`, and the harness replaces the token in the whole document. */
export const ACTOR = "$A";
const ACTOR_STAND_IN = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
/** The payload with the actor token replaced by a well-formed DID, for schema validation (the token is not a DID until the harness substitutes it). */
export const withActorStandIn = (v: unknown): unknown => JSON.parse(JSON.stringify(v).split(JSON.stringify(ACTOR)).join(JSON.stringify(ACTOR_STAND_IN)));

/** Canonical unpadded base64url: the alphabet only, no dangling character, and the unused trailing bits zero (RFC 4648 section 5 as the Trust Tasks text uses it). */
export const base64urlCanonical = (s: string): boolean => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return false;
  const last = A.indexOf(s[s.length - 1]!);
  return s.length % 4 === 2 ? (last & 0xf) === 0 : s.length % 4 === 3 ? (last & 0x3) === 0 : true;
};

/**
 * String members of a payload whose schema (or the definition it points at) says in its description that the value is base64url, with the
 * value found there. The schema marks these by a `pattern` over the alphabet only, which a placeholder satisfies without being decodable.
 */
export function base64urlMembers(task: Pick<PlainTask, "payloadSchema">, payload: unknown): { path: string; value: string }[] {
  const root = task.payloadSchema as J;
  const out: { path: string; value: string }[] = [];
  const walk = (node: unknown, v: unknown, path: string): void => {
    if (!isObj(node)) return;
    const own = typeof node["description"] === "string" ? node["description"] : "";
    const target = typeof node["$ref"] === "string" ? (resolveRef(root, node["$ref"]) as J) : node;
    if (typeof v === "string") {
      // the first sentence of the member's own description or of the definition it points at says what the value is (a digest's later text only mentions base64url as an alternative); an identifier with its own pattern (a prefix, a length) is opaque, not an encoding
      const first = (d: unknown): string => (typeof d === "string" ? d.split(/\.\s|\.$/)[0]! : "");
      if (/base64url/i.test(`${first(own)} ${first(target["description"])}`) && target["type"] === "string" && (target["pattern"] === undefined || target["pattern"] === "^[A-Za-z0-9_-]+$")) out.push({ path, value: v });
      return;
    }
    if (Array.isArray(v) && isObj(target["items"])) v.forEach((x, i) => walk(target["items"], x, `${path}/${i}`));
    else if (isObj(v) && isObj(target["properties"])) for (const [k, sub] of Object.entries(target["properties"])) if (v[k] !== undefined) walk(sub, v[k], `${path}/${k}`);
  };
  walk({ ...root, $defs: undefined }, payload, "");
  return out;
}

/** The payload with every base64url member that is not canonical replaced by a canonical value, where the result still satisfies the schema. */
export function canonicalBase64(task: Pick<PlainTask, "payloadSchema">, payload: J): J {
  const out = JSON.parse(JSON.stringify(payload)) as J;
  for (const m of base64urlMembers(task, payload)) {
    if (base64urlCanonical(m.value)) continue;
    const keys = m.path.split("/").slice(1);
    let cur: unknown = out;
    for (const k of keys.slice(0, -1)) cur = Array.isArray(cur) ? cur[Number(k)] : (cur as J)[k];
    const last = keys[keys.length - 1]!;
    const prev = (cur as J)[last];
    (cur as J)[last] = "AAAA";
    if (validate(task.payloadSchema as J, withActorStandIn(out)).length > 0) (cur as J)[last] = prev;
  }
  return out;
}

/** The task with a valid payload whose base64url members decode: the value rules start from (the registry builder's placeholders do not decode). */
export const withCanonicalValid = <T extends PlainTask>(t: T): T => (isObj(t.validPayload) ? { ...t, validPayload: canonicalBase64(t, t.validPayload) } : t);

/** A well-formed DID that names nothing: an identifier the platform parses as a DID (the schema only says string) before it looks it up. */
export const UNKNOWN_DID = "did:web:conformance-unknown.example";

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

/** An identifier member that names nothing is refused with the task's not-found code. */
export function unknownIdRule(o: { family: string; slug: string; version: string; member: string; code: string; quote: string[]; suffix?: string; did?: boolean; value?: string; extra?: J }): BehaviourRule {
  return {
    key: `${o.slug}/${o.version}:${o.code}${o.suffix ?? ""}`, family: o.family, slug: o.slug, version: o.version,
    title: `${o.slug} ${o.version}: an identifier (${o.member}) that names nothing is refused with ${o.code}`, quote: o.quote, codes: [o.code], stateFree: true,
    trigger: (t) => {
      const p = o.value !== undefined && isObj(t.validPayload) ? { ...t.validPayload, [o.member]: o.value } : (o.did ?? (o.member === "did" || /Did$/.test(o.member))) && isObj(t.validPayload) ? { ...t.validPayload, [o.member]: UNKNOWN_DID } : unknownIdPayload(t, o.member)?.payload;
      return p === undefined || o.extra === undefined ? p : { ...p, ...o.extra };
    },
    refuses: (p, t) => isObj(p) && p[o.member] !== undefined && isObj(t.validPayload) && p[o.member] !== t.validPayload[o.member],
  };
}

/** A member whose value the text says is refused (for example a cursor the maintainer never issued). */
export function memberValueRule(o: { family: string; slug: string; version: string; member: string; value: unknown; code: string; quote: string[]; suffix?: string; stateFree?: true; alsoAccept?: BehaviourRule["alsoAccept"]; envelope?: BehaviourRule["envelope"]; extra?: J }): BehaviourRule {
  return {
    key: `${o.slug}/${o.version}:${o.code}${o.suffix ?? ""}`, family: o.family, slug: o.slug, version: o.version,
    title: `${o.slug} ${o.version}: ${o.member} = ${JSON.stringify(o.value)} is refused with ${o.code}`, quote: o.quote, codes: [o.code], ...(o.stateFree === true ? { stateFree: true as const } : {}), ...(o.alsoAccept === undefined ? {} : { alsoAccept: o.alsoAccept }), ...(o.envelope === undefined ? {} : { envelope: o.envelope }),
    trigger: (t) => (isObj(t.validPayload) ? { ...t.validPayload, ...(o.extra ?? {}), [o.member]: o.value } : undefined),
    refuses: (p) => isObj(p) && JSON.stringify(p[o.member]) === JSON.stringify(o.value),
  };
}
