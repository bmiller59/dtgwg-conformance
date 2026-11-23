// SPDX-License-Identifier: Apache-2.0
// Reading Rust source for task references (decision D420): comments stripped, test code removed, constants and module aliases resolved.
// Pure functions: nothing here reads a checkout (callers pass the text).
import { expandUse, uriOfSpecPath } from "./vti.ts";

const BASE = "https://trusttasks.org/spec/";

/**
 * `src` with every comment blanked (newlines kept, so line numbers hold). Strings (plain and raw `r#"..."#`) and char literals are left
 * alone, so `"https://..."` is not a comment and a `'"'` does not open a string. Block comments nest, as in Rust. A lifetime (`'a`) is not a char literal.
 */
export function stripRustComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      let depth = 1;
      out += "  ";
      i += 2;
      while (i < n && depth > 0) {
        if (src[i] === "/" && src[i + 1] === "*") { depth++; out += "  "; i += 2; }
        else if (src[i] === "*" && src[i + 1] === "/") { depth--; out += "  "; i += 2; }
        else { out += src[i] === "\n" ? "\n" : " "; i++; }
      }
    } else if ((c === "r" || (c === "b" && d === "r")) && /^b?r#*"/.test(src.slice(i, i + 12)) && !/[A-Za-z0-9_]/.test(src[i - 1] ?? " ")) {
      const m = /^b?r(#*)"/.exec(src.slice(i, i + 12)) as RegExpExecArray;
      const close = `"${m[1]}`;
      const end = src.indexOf(close, i + m[0].length);
      const stop = end < 0 ? n : end + close.length;
      out += src.slice(i, stop);
      i = stop;
    } else if (c === '"') {
      out += c;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) { out += src[i] as string; i++; }
        out += src[i] as string;
        i++;
      }
      if (i < n) { out += '"'; i++; }
    } else if (c === "'") {
      // a char literal ('x', '\n', '\u{..}', '"') versus a lifetime ('a, 'static)
      const m = /^'(?:\\(?:u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(src.slice(i, i + 14));
      if (m) { out += m[0]; i += m[0].length; } else { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index just after the brace-balanced item that starts at or after `from` (a `{ ... }` block or a `;`-terminated item); strings are skipped. */
function itemEnd(code: string, from: number): number {
  let depth = 0;
  let i = from;
  const n = code.length;
  while (i < n) {
    const c = code[i] as string;
    if (c === '"') {
      i++;
      while (i < n && code[i] !== '"') { if (code[i] === "\\") i++; i++; }
    } else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
    else if (c === ";" && depth === 0) return i + 1;
    i++;
  }
  return n;
}

/** `code` (comments already stripped) with every `#[cfg(test)]` item and every `#[test]` function blanked (newlines kept). */
export function stripTestItems(code: string): string {
  let out = code;
  const re = /#\[(?:cfg\(test\)|test|tokio::test(?:\([^)]*\))?|rstest)\]/g;
  let m: RegExpExecArray | null;
  const spans: [number, number][] = [];
  while ((m = re.exec(code)) !== null) {
    const last = spans[spans.length - 1];
    if (last !== undefined && m.index < last[1]) continue;
    const end = itemEnd(code, m.index + m[0].length);
    spans.push([m.index, end]);
  }
  for (const [a, b] of spans.reverse()) out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, " ") + out.slice(b);
  return out;
}

export const rustCode = (src: string): string => stripTestItems(stripRustComments(src));

const lineOf = (code: string, idx: number): number => {
  let n = 1;
  for (let i = 0; i < idx; i++) if (code.charCodeAt(i) === 10) n++;
  return n;
};
export { lineOf };

/** Where an occurrence stands in a statement: what the code does with the name. */
export type RefUse = "definition" | "reexport" | "dispatch" | "compare" | "send" | "build";

export interface RustRef {
  uri: string;
  line: number;
  /** The token that named it (`TASK_ACL_LIST_0_4`, `list::Payload`, the literal). */
  token: string;
  use: RefUse;
}

export interface FileConsts {
  /** Constants this file defines (`NAME` to Type URI), whatever they are defined from. */
  local: Map<string, string>;
  /** Module aliases the file's `use` items bind to a spec-crate module path (`list` to the URI of `...::list::v0_5`). */
  modules: Map<string, string>;
  /** `use` items by bound name, full path. */
  uses: Map<string, string[]>;
}

const CONST_DEF = /\b(?:pub(?:\([a-z:]+\))?\s+)?(?:const|static)\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*/g;

/** Resolves the right-hand side that starts at `code[i]`: a literal, `<path::Payload as Payload>::TYPE_URI`, `path::Payload::TYPE_URI`, or a name. */
function rhs(code: string, i: number, uses: Map<string, string[]>, known: Map<string, string>): { uri: string | null; end: number } {
  const lit = /^"(https:\/\/trusttasks\.org\/spec\/[a-z0-9/_-]+?\/\d+\.\d+)(?:#response)?"/.exec(code.slice(i, i + 200));
  if (lit) return { uri: lit[1] as string, end: i + lit[0].length };
  const pay = /^<\s*([\w:#]+?)(?:::Payload)?\s+as\s+(?:trust_tasks_rs::)?Payload\s*>::TYPE_URI/.exec(code.slice(i, i + 300));
  if (pay) return { uri: uriOfPath(pay[1] as string, uses), end: i + pay[0].length };
  const direct = /^([\w:#]+?)::(?:Payload|Response)::TYPE_URI/.exec(code.slice(i, i + 300));
  if (direct) return { uri: uriOfPath(direct[1] as string, uses), end: i + direct[0].length };
  const name = /^((?:[A-Za-z_][A-Za-z0-9_]*::)*)([A-Z][A-Z0-9_]+)\s*(?=[;,)])/.exec(code.slice(i, i + 200));
  if (name) {
    const segs = ((name[1] as string).split("::").filter(Boolean));
    return { uri: known.get(`${segs[segs.length - 1] ?? ""}::${name[2]}`) ?? known.get(name[2] as string) ?? null, end: i + name[0].length };
  }
  return { uri: null, end: i };
}

/** The Type URI of a payload module path, resolving its first segment through the file's `use` items (`list::v0_5` bound by `use vti_specs::...::{list::v0_5 as list}`). */
export function uriOfPath(path: string, uses: Map<string, string[]>): string | null {
  const segs = path.split("::").map((s) => s.replace(/^r#/, ""));
  while (segs.length > 1 && (segs[0] === "super" || segs[0] === "self" || segs[0] === "crate")) segs.shift();
  const head = uses.get(segs[0] as string);
  return uriOfSpecPath(head !== undefined ? [...head, ...segs.slice(1)] : segs);
}

export function useBindings(code: string): Map<string, string[]> {
  const bound = new Map<string, string[]>();
  for (const u of code.matchAll(/(?:^|\n)[ \t]*(?:pub(?:\([a-z:]+\))?\s+)?use\s+([^;]+);/g)) {
    for (const it of expandUse(u[1] as string)) {
      if (uriOfSpecPath([...it.path, "v0_0"]) !== null || !bound.has(it.name)) bound.set(it.name, it.path);
    }
  }
  return bound;
}

/** Constants a file defines, resolved against `known` (constants other files or crates already defined) and the file's `use` items. Definitions that depend on each other resolve in up to three passes. */
export function fileConstants(code: string, known: Map<string, string> = new Map()): FileConsts {
  const uses = useBindings(code);
  const local = new Map<string, string>();
  for (let pass = 0; pass < 3; pass++) {
    for (const m of code.matchAll(CONST_DEF)) {
      const name = m[1] as string;
      if (local.has(name)) continue;
      const r = rhs(code, (m.index ?? 0) + m[0].length, uses, new Map([...known, ...local]));
      if (r.uri !== null) local.set(name, r.uri);
    }
  }
  const modules = new Map<string, string>();
  for (const [name, path] of uses) { const u = uriOfSpecPath([...path, "v0_0"]); if (u !== null) modules.set(name, u.replace(/\/0\.0$/, "")); }
  return { local, modules, uses };
}

const SEND_CALL = /\b(?:rpc_tt|rpc_tt_void|acl_task|send_task|send_signed_document|send_trust_task|send_trust_task_one_way|act_and_send_offer|build_document|sign_document|send_request|post_task|trust_task_request|build_request)\s*(?:::<[^>]*>)?\s*\(/;

/**
 * Classifies one occurrence by the text around it. Direction is by call role, not by presence:
 * a reference on the left of `=>`, on either side of `==`/`!=`, inside `matches!`, `starts_with(` or an `if let Some(...)` pattern is read from a received document (compare);
 * one in a `pub use` is a re-export; one in `on!(`, `dispatch_table!`, or a `SERVED` table is a handler registration (dispatch);
 * one handed to a sender, a builder or `checked::<X::Payload>` is a send; anything else that reaches code (an argument, a field, a return value) is a build.
 */
/** True when `idx` lies inside a `use ...;` statement (`pub use a::{b::v0_1 as b, ...};`). */
export function inUseStatement(code: string, idx: number): boolean {
  const head = code.slice(Math.max(0, idx - 2000), idx);
  const m = [...head.matchAll(/(?:^|\n)[ \t]*(?:pub(?:\([a-z:]+\))?\s+)?use\s/g)].pop();
  return m !== undefined && !head.slice((m.index ?? 0) + m[0].length).includes(";");
}

/** True when `idx` lies in the initialiser of a `const`/`static` list or table (`const X: &[&str] = &[...]`, `static T: &[(&str, Kind)] = &[...]`): the task is named in a list, not used. */
export function inTableInitialiser(code: string, idx: number): boolean {
  const head = code.slice(Math.max(0, idx - 20000), idx);
  const stmt = head.slice(head.lastIndexOf(";") + 1);
  const m = /\b(?:const|static)\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([^=;]*?)\s*=\s*[^;]*$/.exec(stmt);
  return m !== null && /[\[(]/.test(m[1] as string) && !/^&(?:'static\s+)?str$/.test((m[1] as string).trim());
}

export function useOf(code: string, idx: number, len: number, regCtx: boolean): RefUse {
  const ls = code.lastIndexOf("\n", idx - 1) + 1;
  const le = code.indexOf("\n", idx + len);
  const line = code.slice(ls, le < 0 ? code.length : le);
  const before = code.slice(Math.max(0, idx - 160), idx);
  const after = code.slice(idx + len, idx + len + 80);
  if (inUseStatement(code, idx) || inTableInitialiser(code, idx)) return "reexport";
  if (/\bon!\s*\(\s*[A-Za-z_]\w*\s*,\s*[^=>]*$/.test(before) || regCtx) return "dispatch";
  if (/(?:==|!=)\s*(?:Some\()?\s*(?:&\s*)?$/.test(before) || /^\s*\)?\s*(?:==|!=)/.test(after) || /\bmatches!\s*\([^)]*$/.test(before) || /(?:starts_with|ends_with|contains|eq|ne)\(\s*&?\s*$/.test(before) || /^\s*(?:\|[^=]*)?=>/.test(after)) return "compare";
  if (SEND_CALL.test(before.slice(before.lastIndexOf(";") + 1)) || /checked::<\s*$/.test(before) || /::<\s*$/.test(before)) return "send";
  return "build";
}

/** `code` with the content of every string that is not a Type URI blanked, so prose in a message never reads as a constant name. */
export function maskStrings(code: string): string {
  return code.replace(/"(?:[^"\\\n]|\\.)*"/g, (s) => (/^"https:\/\/trusttasks\.org\/spec\/[a-z0-9/_-]+?\/\d+\.\d+(?:#(?:response|request))?"$/.test(s) ? s : `"${" ".repeat(s.length - 2)}"`));
}

/** The innermost `mod name { ... }` that holds `idx`, or null. */
export function enclosingMod(code: string, idx: number): string | null {
  let best: { name: string; at: number } | null = null;
  for (const m of code.matchAll(/\bmod\s+([a-z_][a-z0-9_]*)\s*\{/g)) {
    const at = m.index ?? 0;
    if (at > idx) break;
    if (itemEnd(code, at + m[0].length - 1) > idx && (best === null || at > best.at)) best = { name: m[1] as string, at };
  }
  return best?.name ?? null;
}

/** A constant a crate defines, with the module and file that scope its name. */
export interface ConstDef { name: string; uri: string; file: string; mod: string | null }

/** Every constant of one file that resolves to a Type URI (module-scoped by the enclosing `mod` and the file stem). */
export function constDefs(code: string, file: string, known: Map<string, string>): ConstDef[] {
  const fc = fileConstants(code, known);
  const out: ConstDef[] = [];
  for (const m of code.matchAll(CONST_DEF)) {
    const name = m[1] as string;
    const uri = fc.local.get(name);
    if (uri !== undefined) out.push({ name, uri, file, mod: enclosingMod(code, m.index ?? 0) });
  }
  return out;
}

/** Name tables for resolving a use: by `mod::NAME` and `file-stem::NAME` (scoped), and by bare `NAME` when every definition agrees. */
export interface ConstTable { scoped: Map<string, string>; bare: Map<string, string>; byFile: Map<string, Map<string, string>> }

export function buildConstTable(defs: ConstDef[]): ConstTable {
  const scoped = new Map<string, Set<string>>();
  const bare = new Map<string, Set<string>>();
  const byFile = new Map<string, Map<string, string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string): void => { (m.get(k) ?? m.set(k, new Set()).get(k) as Set<string>).add(v); };
  for (const d of defs) {
    const stem = d.file.replace(/\.rs$/, "").split("/").slice(-1)[0] === "mod" ? (d.file.split("/").slice(-2)[0] as string) : (d.file.split("/").pop() as string).replace(/\.rs$/, "");
    add(bare, d.name, d.uri);
    add(scoped, `${stem}::${d.name}`, d.uri);
    if (d.mod !== null) add(scoped, `${d.mod}::${d.name}`, d.uri);
    (byFile.get(d.file) ?? byFile.set(d.file, new Map()).get(d.file) as Map<string, string>).set(d.name, d.uri);
  }
  const one = (m: Map<string, Set<string>>): Map<string, string> => new Map([...m].filter(([, v]) => v.size === 1).map(([k, v]) => [k, [...v][0] as string]));
  return { scoped: one(scoped), bare: one(bare), byFile };
}

/** The table as a flat map for `fileConstants` (bare names that agree, plus `scope::NAME`). */
export const flatTable = (t: ConstTable): Map<string, string> => new Map([...t.bare, ...t.scoped]);

const TOKEN_RE = /"(https:\/\/trusttasks\.org\/spec\/[a-z0-9/_-]+?\/\d+\.\d+)(?:#(?:response|request))?"|\b((?:[A-Za-z_][A-Za-z0-9_]*::)*)([A-Z][A-Z0-9_]{2,})\b|\b((?:[A-Za-z_][A-Za-z0-9_]*::)+)(?:Payload|Response)\b/g;

export interface ExtractOptions {
  /** The text is a handler registration (a dispatch table body): every reference in it is `dispatch`. */
  registration?: boolean;
  /** The file only lists tasks (a catalogue, a policy table): every reference in it is `reexport` (named). */
  catalogue?: boolean;
}

/**
 * Every task reference in one file's code (comments and tests already stripped by `rustCode`): literal Type URIs, constants resolved
 * in the file first, then by `module::NAME`, then by a bare name every definition agrees on, and payload or response types of a
 * spec module (`list::Payload`, `vti_specs::a::b::v0_1::Response`) resolved through the file's `use` items. The definition of a constant is not a reference.
 */
export function extractRefs(code0: string, file: string, table: ConstTable, opt: ExtractOptions = {}): RustRef[] {
  const code = maskStrings(code0);
  const fc = fileConstants(code, flatTable(table));
  const local = table.byFile.get(file) ?? new Map<string, string>();
  const definedHere = new Set([...code.matchAll(CONST_DEF)].map((d) => d[1] as string));
  const modsHere = new Set([...code.matchAll(/\bmod\s+([a-z_][a-z0-9_]*)\s*\{/g)].map((d) => d[1] as string));
  const out: RustRef[] = [];
  const seen = new Set<string>();
  for (const m of code.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    let uri: string | null = null;
    let token = m[0];
    if (m[1] !== undefined) {
      uri = m[1];
    } else if (m[3] !== undefined) {
      const prefix = ((m[2] as string) ?? "").split("::").filter(Boolean);
      const before = code.slice(Math.max(0, idx - 30), idx);
      if (/\b(?:const|static)\s+$/.test(before)) continue; // the name being defined
      const last = prefix[prefix.length - 1];
      if (definedHere.has(m[3]) && (last === undefined || modsHere.has(last))) {
        uri = fc.local.get(m[3]) ?? local.get(m[3]) ?? null; // this file defines the name: another file's constant of that name is not it
      } else {
        uri = (last !== undefined ? table.scoped.get(`${last}::${m[3]}`) : undefined) ?? table.bare.get(m[3]) ?? null;
      }
    } else if (m[4] !== undefined) {
      const segs = (m[4] as string).split("::").filter(Boolean).join("::");
      uri = uriOfPath(segs, fc.uses);
      token = m[0];
    }
    if (uri === null) continue;
    const before = code.slice(Math.max(0, idx - 120), idx);
    const isDef = m[3] === undefined && /\b(?:const|static)\s+[A-Z][A-Z0-9_]*\s*:\s*&(?:'static\s+)?str\s*=\s*<?\s*$/.test(before);
    const use: RefUse = isDef ? "definition" : opt.catalogue === true ? "reexport" : useOf(code, idx, m[0].length, opt.registration === true);
    const line = lineOf(code, idx);
    const key = `${uri}|${line}|${use}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ uri, line, token, use });
  }
  return out;
}
