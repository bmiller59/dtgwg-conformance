// SPDX-License-Identifier: Apache-2.0
// Negative payloads derived from a task's payload schema, each checked with the suite's own validator before it is returned: a
// candidate the schema still accepts is dropped, never guessed at. Used by the gap generator (scripts/generate-gap.ts).
import { resolveRef, validate } from "./schema.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

export interface Negative { label: string; payload: J }

const deref = (root: J, s: unknown): J => {
  let cur = s;
  for (let i = 0; i < 20 && isObj(cur) && typeof cur["$ref"] === "string"; i++) {
    const rest = { ...cur };
    delete rest["$ref"];
    cur = { ...(resolveRef(root, (cur as J)["$ref"] as string) as J), ...rest };
  }
  return isObj(cur) ? cur : {};
};

/** The payload with the top-level member `key` removed, for every required member of the schema: each must be refused (JSON Schema `required`). */
export function missingRequired(root: J, valid: J): Negative[] {
  const req = Array.isArray(root["required"]) ? (root["required"] as string[]) : [];
  const out: Negative[] = [];
  for (const k of req) {
    if (!(k in valid)) continue;
    const { [k]: _gone, ...rest } = valid;
    if (validate(root, rest).length > 0) out.push({ label: `missing required member ${k}`, payload: rest });
  }
  return out;
}

/** One violation per constraint the top-level members state (enum, const, minLength, maxLength, pattern, minimum, maximum, minItems, maxItems, type). At most `cap` in all. */
export function constraintViolations(root: J, valid: J, cap = 16): Negative[] {
  const props = isObj(root["properties"]) ? root["properties"] : {};
  const out: Negative[] = [];
  const add = (k: string, label: string, value: unknown): void => {
    if (out.length >= cap) return;
    const p = { ...valid, [k]: value };
    if (validate(root, p).length > 0 && !out.some((o) => o.label === label)) out.push({ label, payload: p });
  };
  for (const [k, raw] of Object.entries(props)) {
    const s = deref(root, raw);
    const t = Array.isArray(s["type"]) ? (s["type"] as string[]).find((x) => x !== "null") : (s["type"] as string | undefined);
    if (Array.isArray(s["enum"]) && s["enum"].length > 0) add(k, `${k}: a value outside its enum`, typeof s["enum"][0] === "number" ? -987654 : "conformance-not-in-enum");
    if (s["const"] !== undefined) add(k, `${k}: a value other than its const`, typeof s["const"] === "string" ? `${s["const"]}-x` : "conformance-not-const");
    if (t === "string") {
      if (typeof s["maxLength"] === "number" && s["maxLength"] < 5000) add(k, `${k}: longer than maxLength ${s["maxLength"]}`, "a".repeat(s["maxLength"] + 1));
      if (typeof s["minLength"] === "number" && s["minLength"] >= 1) add(k, `${k}: shorter than minLength ${s["minLength"]}`, "a".repeat(s["minLength"] - 1));
      if (typeof s["pattern"] === "string") for (const c of ["", "!", " not a match # ", "0"]) { const before = out.length; add(k, `${k}: does not match its pattern`, c); if (out.length > before) break; }
    }
    if (t === "integer" || t === "number") {
      if (typeof s["minimum"] === "number") add(k, `${k}: below minimum ${s["minimum"]}`, s["minimum"] - 1);
      if (typeof s["maximum"] === "number") add(k, `${k}: above maximum ${s["maximum"]}`, s["maximum"] + 1);
    }
    if (t === "array") {
      if (typeof s["minItems"] === "number" && s["minItems"] >= 1) add(k, `${k}: fewer than minItems ${s["minItems"]}`, []);
      if (typeof s["maxItems"] === "number" && s["maxItems"] < 500) add(k, `${k}: more than maxItems ${s["maxItems"]}`, Array.from({ length: s["maxItems"] + 1 }, () => "x"));
    }
    // a wrong type for a member the payload carries
    if (k in valid && (t === "string" || t === "object" || t === "array" || t === "boolean" || t === "integer" || t === "number")) add(k, `${k}: wrong type (not ${t})`, t === "string" ? 5 : "x");
  }
  return out;
}

const ROLE_KEY = /"(role|fromRole|toRole|roles)"\s*:/;
/** Whether a payload carries a role-valued member (the governance rule keeps role values out of vectors). */
export const hasRoleMember = (p: unknown): boolean => ROLE_KEY.test(JSON.stringify(p));
