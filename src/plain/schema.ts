// SPDX-License-Identifier: Apache-2.0
// A small JSON Schema (draft 2020-12 subset) validator and a minimal-instance generator, for the payload schemas the pinned
// @openvtc/trust-tasks package ships as values (PAYLOAD_SCHEMA, RESPONSE_PAYLOAD_SCHEMA). The runtime bundles no validator by design
// (docs/04), so the plain-task probe carries its own, limited to the keywords those schemas use: type, properties, required,
// additionalProperties, items, minItems/maxItems/uniqueItems, minLength/maxLength, pattern, enum, const, minimum/maximum, oneOf,
// anyOf, not, propertyNames, minProperties, dependentRequired, dependentSchemas, $ref ("#/..." pointers and "#anchor"), $defs.
// `format` is an annotation here (not asserted), as it is by default in draft 2020-12, unless the caller passes `{ formats: true }`
// (see "format assertion" below): the task-force invalid examples are classified with both settings (src/plain/invalid-examples.ts).

import { stringForPattern } from "./pattern.ts";

type Json = unknown;
type Schema = Record<string, Json> | boolean;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function findAnchor(node: unknown, name: string): Schema | undefined {
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findAnchor(x, name);
      if (r !== undefined) return r;
    }
  } else if (isObj(node)) {
    if (node["$anchor"] === name) return node;
    for (const v of Object.values(node)) {
      const r = findAnchor(v, name);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

export function resolveRef(root: Schema, ref: string): Schema {
  if (!ref.startsWith("#")) throw new Error(`unsupported $ref ${ref}`);
  const frag = ref.slice(1);
  if (frag === "") return root;
  if (frag.startsWith("/")) {
    let cur: unknown = root;
    for (const raw of frag.slice(1).split("/")) {
      const k = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
      if (Array.isArray(cur)) cur = cur[Number(k)];
      else if (isObj(cur)) cur = cur[k];
      else throw new Error(`unresolvable $ref ${ref}`);
    }
    if (cur === undefined) throw new Error(`unresolvable $ref ${ref}`);
    return cur as Schema;
  }
  const a = findAnchor(root, frag);
  if (a === undefined) throw new Error(`unresolvable $ref ${ref}`);
  return a;
}

const typeOk = (t: string, v: unknown): boolean => {
  switch (t) {
    case "object": return isObj(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    default: return true;
  }
};

const deepEq = (a: unknown, b: unknown): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

// ---------------------------------------------------------------- `format` assertion (opt-in)
// The task force's own build asserts `format` (Ajv with ajv-formats, "full" mode) when it checks a task's invalid examples. With
// `{ formats: true }` this validator asserts the three formats the task schemas use, by the same rules: `date` (RFC 3339 full-date, with
// the days of the month), `date-time` (full-date, `T` or a space, full-time with a time zone; a leap second only at 23:59:60 UTC) and `uri`
// (an absolute RFC 3986 URI). Any other format stays an annotation. Off by default: a consumer is not told by the framework to assert it.
export interface ValidateOptions { /** Assert `date`, `date-time` and `uri` as the task force's build does. Default false. */ formats?: boolean }
export const ASSERTED_FORMATS = ["date", "date-time", "uri"] as const;

const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const leap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
function isDate(s: string): boolean {
  const m = /^(\d\d\d\d)-(\d\d)-(\d\d)$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= (mo === 2 && leap(y) ? 29 : DAYS[mo]!);
}
function isTime(s: string): boolean {
  const m = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)$/i.exec(s);
  if (m === null) return false;
  const hr = Number(m[1]), min = Number(m[2]), sec = Number(m[3]);
  const tzSign = m[5] === "-" ? -1 : 1, tzH = Number(m[6] ?? 0), tzM = Number(m[7] ?? 0);
  if (tzH > 23 || tzM > 59) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  // a leap second: 23:59:60 in UTC once the offset is taken off
  const utcMin = min - tzM * tzSign, utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}
function isDateTime(s: string): boolean {
  const parts = s.split(/t|\s/i);
  return parts.length === 2 && isDate(parts[0]!) && isTime(parts[1]!);
}
const UNRES = "a-z0-9\\-._~", SUB = "!$&'()*+,;=", PCT = "%[0-9a-f]{2}";
const PCHAR = `(?:[${UNRES}${SUB}:@]|${PCT})`;
const HOST = `(?:\\[[0-9a-f:.]+\\]|\\[v[0-9a-f]+\\.[${UNRES}${SUB}:]+\\]|(?:[${UNRES}${SUB}]|${PCT})*)`;
const URI_RE = new RegExp(`^[a-z][a-z0-9+\\-.]*:(?:\\/?\\/(?:(?:[${UNRES}${SUB}:]|${PCT})*@)?${HOST}(?::\\d*)?(?:\\/${PCHAR}*)*|\\/(?:${PCHAR}+(?:\\/${PCHAR}*)*)?|${PCHAR}+(?:\\/${PCHAR}*)*)(?:\\?(?:${PCHAR}|[/?])*)?(?:#(?:${PCHAR}|[/?])*)?$`, "i");
const isUri = (s: string): boolean => /\/|:/.test(s) && URI_RE.test(s);
const FORMAT_CHECKS: Record<(typeof ASSERTED_FORMATS)[number], (s: string) => boolean> = { date: isDate, "date-time": isDateTime, uri: isUri };
/** Whether a string satisfies an asserted format (true for a format this validator does not assert). */
export function formatOk(format: string, value: string): boolean {
  const f = (FORMAT_CHECKS as Record<string, (s: string) => boolean>)[format];
  return f === undefined || f(value);
}

let assertFormats = false;

/** Errors (JSON pointer + message); empty when the value satisfies the schema. `format` is asserted only with `{ formats: true }`. */
export function validate(root: Schema, value: unknown, opts: ValidateOptions = {}): string[] {
  const out: string[] = [];
  const before = assertFormats;
  assertFormats = opts.formats === true;
  try { check(root, root, value, "", out, 0); } finally { assertFormats = before; }
  return out;
}

function check(root: Schema, s: Schema, v: unknown, at: string, out: string[], depth: number): void {
  if (depth > 60) { out.push(`${at}: schema nesting too deep`); return; }
  if (s === true) return;
  if (s === false) { out.push(`${at}: not allowed`); return; }
  const here = at === "" ? "/" : at;
  if (typeof s["$ref"] === "string") check(root, resolveRef(root, s["$ref"]), v, at, out, depth + 1);
  if (s["const"] !== undefined && !deepEq(s["const"], v)) out.push(`${here}: must equal ${JSON.stringify(s["const"])}`);
  if (Array.isArray(s["enum"]) && !s["enum"].some((e) => deepEq(e, v))) out.push(`${here}: not one of the enumerated values`);
  const t = s["type"];
  if (typeof t === "string" && !typeOk(t, v)) { out.push(`${here}: must be ${t}`); return; }
  if (Array.isArray(t) && !t.some((x) => typeof x === "string" && typeOk(x, v))) { out.push(`${here}: must be one of ${t.join("|")}`); return; }
  if (typeof v === "string") {
    if (typeof s["minLength"] === "number" && [...v].length < s["minLength"]) out.push(`${here}: shorter than ${s["minLength"]}`);
    if (typeof s["maxLength"] === "number" && [...v].length > s["maxLength"]) out.push(`${here}: longer than ${s["maxLength"]}`);
    if (typeof s["pattern"] === "string" && !new RegExp(s["pattern"], "u").test(v)) out.push(`${here}: does not match ${s["pattern"]}`);
    if (assertFormats && typeof s["format"] === "string" && !formatOk(s["format"], v)) out.push(`${here}: not a valid ${s["format"]}`);
  }
  if (typeof v === "number") {
    if (typeof s["minimum"] === "number" && v < s["minimum"]) out.push(`${here}: below ${s["minimum"]}`);
    if (typeof s["maximum"] === "number" && v > s["maximum"]) out.push(`${here}: above ${s["maximum"]}`);
    if (typeof s["exclusiveMinimum"] === "number" && v <= s["exclusiveMinimum"]) out.push(`${here}: not above ${s["exclusiveMinimum"]}`);
    if (typeof s["exclusiveMaximum"] === "number" && v >= s["exclusiveMaximum"]) out.push(`${here}: not below ${s["exclusiveMaximum"]}`);
  }
  if (Array.isArray(v)) {
    if (typeof s["minItems"] === "number" && v.length < s["minItems"]) out.push(`${here}: fewer than ${s["minItems"]} items`);
    if (typeof s["maxItems"] === "number" && v.length > s["maxItems"]) out.push(`${here}: more than ${s["maxItems"]} items`);
    if (s["uniqueItems"] === true && new Set(v.map((x) => JSON.stringify(sortKeys(x)))).size !== v.length) out.push(`${here}: items are not unique`);
    if (s["items"] !== undefined) v.forEach((x, i) => check(root, s["items"] as Schema, x, `${at}/${i}`, out, depth + 1));
  }
  if (isObj(v)) {
    const props = isObj(s["properties"]) ? (s["properties"] as Record<string, Schema>) : {};
    if (Array.isArray(s["required"])) for (const k of s["required"]) if (typeof k === "string" && !(k in v)) out.push(`${at}/${k}: required`);
    if (typeof s["minProperties"] === "number" && Object.keys(v).length < s["minProperties"]) out.push(`${here}: fewer than ${s["minProperties"]} members`);
    if (typeof s["maxProperties"] === "number" && Object.keys(v).length > s["maxProperties"]) out.push(`${here}: more than ${s["maxProperties"]} members`);
    for (const [k, x] of Object.entries(v)) {
      if (k in props) check(root, props[k]!, x, `${at}/${k}`, out, depth + 1);
      else if (s["additionalProperties"] === false) out.push(`${at}/${k}: unknown member`);
      else if (s["additionalProperties"] !== undefined && s["additionalProperties"] !== true) check(root, s["additionalProperties"] as Schema, x, `${at}/${k}`, out, depth + 1);
      if (s["propertyNames"] !== undefined) check(root, s["propertyNames"] as Schema, k, `${at}/${k}`, out, depth + 1);
    }
    if (isObj(s["dependentRequired"])) for (const [k, reqs] of Object.entries(s["dependentRequired"])) if (k in v && Array.isArray(reqs)) for (const r of reqs) if (!(r in v)) out.push(`${at}/${String(r)}: required when ${k} is present`);
    if (isObj(s["dependentSchemas"])) for (const [k, sub] of Object.entries(s["dependentSchemas"])) if (k in v) check(root, sub as Schema, v, at, out, depth + 1);
  }
  if (Array.isArray(s["allOf"])) for (const sub of s["allOf"]) check(root, sub as Schema, v, at, out, depth + 1);
  if (Array.isArray(s["anyOf"])) {
    if (!s["anyOf"].some((sub) => { const e: string[] = []; check(root, sub as Schema, v, at, e, depth + 1); return e.length === 0; })) out.push(`${here}: matches none of anyOf`);
  }
  if (Array.isArray(s["oneOf"])) {
    const n = s["oneOf"].filter((sub) => { const e: string[] = []; check(root, sub as Schema, v, at, e, depth + 1); return e.length === 0; }).length;
    if (n !== 1) out.push(`${here}: matches ${n} of oneOf (must be exactly 1)`);
  }
  if (s["not"] !== undefined) {
    const e: string[] = [];
    check(root, s["not"] as Schema, v, at, e, depth + 1);
    if (e.length === 0) out.push(`${here}: matches a schema it must not match`);
  }
}

// ---------------------------------------------------------------- minimal instance generation

const FORMAT_SAMPLES: Record<string, string> = {
  "date-time": "2026-11-12T10:00:00Z",
  date: "2026-11-12",
  uri: "https://example.org/x",
  "uri-reference": "https://example.org/x",
  uuid: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  email: "alice@example.org",
};
/** Strings tried, in order, for a `pattern` the generator cannot construct. */
const PATTERN_CANDIDATES = [
  "did:web:alice.example", "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "urn:uuid:6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "https://example.org/x", "zQmb1XVvHqbCe5nUPFxpJcRz3RtP4pQyKgTsWJgNBzVhE7d", "z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  "a", "abc", "abc123", "device-1", "0123456789abcdef0123456789abcdef", "9c1f4b7a2e6d80f35a4c9b1e7d2f6083", "/", "a/b", "vault", "A", "1.0.0", "0.1",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "https://trusttasks.org/spec/acl/grant/0.3",
  "sha256:0000000000000000000000000000000000000000000000000000000000000000",
];

/** A description whose opening phrase names a DID or VID ("DID the invitation admits.", "Recipient DID - ..."), not one that only mentions it later. */
const DID_DESCRIPTION = /^(?:(?:the|an?) )?(?:[\w'-]+ ){0,3}(?:DID|VID)\b/i;

function makeString(s: Record<string, unknown>): string | undefined {
  const min = typeof s["minLength"] === "number" ? s["minLength"] : 0;
  const max = typeof s["maxLength"] === "number" ? s["maxLength"] : Infinity;
  const fits = (x: string): boolean => [...x].length >= min && [...x].length <= max && (typeof s["pattern"] !== "string" || new RegExp(s["pattern"], "u").test(x));
  const first = Array.isArray(s["examples"]) && typeof s["examples"][0] === "string" ? [s["examples"][0]] : [];
  const fmt = typeof s["format"] === "string" && FORMAT_SAMPLES[s["format"]] !== undefined ? [FORMAT_SAMPLES[s["format"]]!] : [];
  const base = typeof s["default"] === "string" ? [s["default"]] : [];
  // A member whose description names a DID takes one (a VID-typed member that is not a VID may be refused, SPEC.md 388)
  const did = typeof s["description"] === "string" && DID_DESCRIPTION.test(s["description"]) && s["pattern"] === undefined && fmt.length === 0 ? ["did:web:alice.example"] : [];
  for (const c of [...first, ...base, ...did, ...fmt, ...(s["pattern"] === undefined && fmt.length === 0 ? ["example", "x"] : []), ...PATTERN_CANDIDATES]) {
    if (fits(c)) return c;
    if (typeof s["pattern"] === "undefined" && [...c].length < min) { const p = c.padEnd(min, "x"); if (fits(p)) return p; }
  }
  if (EXTENDED && typeof s["pattern"] === "string") { const p = stringForPattern(s["pattern"], min, max); if (p !== undefined && fits(p)) return p; }
  return undefined;
}

/** True only inside `exampleExtended`: the generator then also uses the constructive builders that `example` does not (see there). */
let EXTENDED = false;

/**
 * A minimal value satisfying the schema (required members only, the first alternative of a oneOf/anyOf that validates), or
 * `undefined` when the generator cannot build one (an unconstructible `pattern`, a contradiction). The result is always checked
 * with `validate` before it is returned.
 */
export function example(root: Schema): unknown {
  const v = gen(root, root, 0);
  if (v === undefined) return undefined;
  return validate(root, v).length === 0 ? v : undefined;
}

/**
 * `example`, and where that finds nothing a second pass with the extended builders (a string built from its `pattern`, ...). The
 * first pass is `example` itself, so every payload `example` builds is returned unchanged; the extended pass runs only for a schema
 * `example` could not build, because the generated vectors of the versions that already build must not change.
 */
export function exampleExtended(root: Schema): unknown {
  const v = example(root);
  if (v !== undefined) return v;
  EXTENDED = true;
  try { return example(root); } finally { EXTENDED = false; }
}

/**
 * An alternative of a oneOf/anyOf together with the members its schema states beside the alternative (`properties`, `required`,
 * `additionalProperties`, ...): an alternative such as `{required: ["a"], not: {required: ["b"]}}` names members that only the
 * enclosing schema describes. `required` is united; an alternative's own member wins otherwise.
 */
function withSiblings(parent: Record<string, unknown>, key: string, sub: Schema): Schema {
  if (typeof sub !== "object") return sub;
  const rest = { ...parent };
  delete rest[key];
  const req = [...new Set([...(Array.isArray(rest["required"]) ? (rest["required"] as string[]) : []), ...(Array.isArray(sub["required"]) ? (sub["required"] as string[]) : [])])];
  const props = isObj(rest["properties"]) || isObj(sub["properties"]) ? { properties: { ...(isObj(rest["properties"]) ? rest["properties"] : {}), ...(isObj(sub["properties"]) ? sub["properties"] : {}) } } : {};
  return { ...rest, ...sub, ...(req.length > 0 ? { required: req } : {}), ...props };
}

function gen(root: Schema, s: Schema, depth: number): unknown {
  if (depth > (EXTENDED ? 40 : 12)) return undefined;
  if (s === true) return {};
  if (s === false) return undefined;
  if (typeof s["$ref"] === "string") {
    const target = resolveRef(root, s["$ref"]);
    const rest = { ...s };
    delete rest["$ref"];
    return gen(root, Object.keys(rest).length === 0 ? target : { allOf: [target, rest] }, depth + 1);
  }
  if (s["const"] !== undefined) return s["const"];
  if (Array.isArray(s["enum"]) && s["enum"].length > 0) return s["enum"][0];
  if (Array.isArray(s["allOf"])) {
    const merged: Record<string, unknown> = {};
    for (const sub of s["allOf"]) {
      const r = typeof (sub as Record<string, unknown>)["$ref"] === "string" ? resolveRef(root, (sub as Record<string, string>)["$ref"]!) : sub;
      Object.assign(merged, r);
    }
    const rest = { ...s };
    delete rest["allOf"];
    return gen(root, { ...merged, ...rest }, depth + 1);
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    if (Array.isArray(s[key])) {
      for (const sub of s[key] as Schema[]) {
        const v = gen(root, EXTENDED ? withSiblings(s, key, sub) : sub, depth + 1);
        if (v !== undefined && validate(root, v).length === 0) return v;
        if (v !== undefined) {
          const e: string[] = [];
          check(root, EXTENDED ? withSiblings(s, key, sub) : sub, v, "", e, 0);
          if (e.length === 0) return v;
        }
      }
      return undefined;
    }
  }
  let t = s["type"];
  if (Array.isArray(t)) t = t.find((x) => x !== "null") ?? t[0];
  if (t === undefined) t = isObj(s["properties"]) ? "object" : "string";
  switch (t) {
    case "object": {
      const props = isObj(s["properties"]) ? (s["properties"] as Record<string, Schema>) : {};
      const req = Array.isArray(s["required"]) ? (s["required"] as string[]) : [];
      const o: Record<string, unknown> = {};
      for (const k of req) {
        const v = k in props ? gen(root, props[k]!, depth + 1) : "x";
        if (v === undefined) return undefined;
        o[k] = v;
      }
      if (typeof s["minProperties"] === "number" && Object.keys(o).length < s["minProperties"]) {
        for (const [k, sub] of Object.entries(props)) {
          if (Object.keys(o).length >= s["minProperties"]) break;
          if (k in o) continue;
          const v = gen(root, sub, depth + 1);
          if (v !== undefined) o[k] = v;
        }
      }
      if (EXTENDED && typeof s["minProperties"] === "number" && Object.keys(o).length < s["minProperties"] && s["additionalProperties"] !== false) {
        // an open object ("opaque to the framework", non-empty): members the schema does not name, named by its propertyNames
        for (let n = 1; Object.keys(o).length < s["minProperties"] && n < 50; n++) {
          const key = s["propertyNames"] === undefined ? `member${n}` : gen(root, s["propertyNames"] as Schema, depth + 1);
          if (typeof key !== "string") return undefined;
          const ap = s["additionalProperties"];
          const v = ap === undefined || ap === true ? "x" : gen(root, ap as Schema, depth + 1);
          if (v === undefined) return undefined;
          if (!(key in o)) o[key] = v; else return undefined;
        }
      }
      if (isObj(s["dependentRequired"])) {
        for (const [k, reqs] of Object.entries(s["dependentRequired"])) {
          if (k in o && Array.isArray(reqs)) for (const r of reqs as string[]) if (!(r in o) && r in props) { const v = gen(root, props[r]!, depth + 1); if (v !== undefined) o[r] = v; }
        }
      }
      return o;
    }
    case "array": {
      const min = typeof s["minItems"] === "number" ? s["minItems"] : 0;
      const a: unknown[] = [];
      for (let i = 0; i < min; i++) {
        const v = s["items"] === undefined ? "x" : gen(root, s["items"] as Schema, depth + 1);
        if (v === undefined) return undefined;
        a.push(v);
      }
      return a;
    }
    case "string": return makeString(s);
    case "integer":
    case "number": {
      const lo = typeof s["minimum"] === "number" ? s["minimum"] : undefined;
      const hi = typeof s["maximum"] === "number" ? s["maximum"] : undefined;
      return lo ?? (hi !== undefined ? Math.min(0, hi) : 1);
    }
    case "boolean": return false;
    case "null": return null;
    default: return undefined;
  }
}
