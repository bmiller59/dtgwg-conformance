// SPDX-License-Identifier: Apache-2.0
// What VTI pins (trust-tasks.lock files) and what its dispatchers serve (resolved from the Rust constants they name).
import { isTestPath, rel, text, urisIn, walk } from "./walk.ts";

export interface VtiUsage {
  pinned: Set<string>;
  served: Map<string, Set<string>>;
  unresolved: string[];
  files: number;
  consts: Map<string, string>;
}

const CONST_RE = /const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*(?:\r?\n\s*)?"(https:\/\/trusttasks\.org\/spec\/[^"]+)"/g;

/** `pub const X: &str = <vti_specs::auth::revoke_session::v0_2::Payload as ...>::TYPE_URI;` names the type by its module path. */
const PAYLOAD_CONST_RE = /const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*<\s*(?:crate|vti_specs[a-z_]*|trust_tasks_rs::specs)::((?:r#)?[a-z0-9_]+(?:::(?:r#)?[a-z0-9_]+)*)::v(\d+)_(\d+)::(?:\w+)\s+as/g;


/** Split `a, b::{c, d}, e` at the commas that are not inside braces. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** Every item a `use` tree names: its full path and the local name it is bound to (`x::y as z` binds z; `x::y` binds y). */
export function expandUse(tree: string, prefix: string[] = []): { path: string[]; name: string }[] {
  const out: { path: string[]; name: string }[] = [];
  for (const raw of splitTop(tree)) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t === "") continue;
    const brace = /^(.*?)(?:::)?\{(.*)\}$/s.exec(t);
    if (brace !== null) {
      const head = (brace[1] as string).split("::").map((x) => x.trim()).filter(Boolean);
      out.push(...expandUse(brace[2] as string, [...prefix, ...head]));
      continue;
    }
    const m = /^(.*?)(?:\s+as\s+(\w+))?$/.exec(t) as RegExpExecArray;
    const path = [...prefix, ...(m[1] as string).split("::").map((x) => x.trim()).filter(Boolean)];
    const last = (path[path.length - 1] ?? "").replace(/^r#/, "");
    if (path.length > 0 && last !== "self") out.push({ path, name: m[2] ?? last });
  }
  return out;
}

const SPEC_ROOT = /^(?:vti_specs(?:_[a-z]+)*|trust_tasks_rs)$/;

/** The Type URI of a spec-crate module path `vti_specs::a::b::v0_1` (or `...::v0_1::Payload`); null when the path is not one. */
export function uriOfSpecPath(path: string[]): string | null {
  const clean = path.map((x) => x.replace(/^r#/, ""));
  if (clean[0] === "trust_tasks_rs" && clean[1] === "specs") clean.splice(0, 2);
  else if (clean[0] !== undefined && SPEC_ROOT.test(clean[0])) clean.shift();
  else return null;
  const i = clean.findIndex((x) => /^v\d+_\d+$/.test(x));
  if (i < 1) return null;
  const v = /^v(\d+)_(\d+)$/.exec(clean[i] as string) as RegExpExecArray;
  return `https://trusttasks.org/spec/${clean.slice(0, i).map((x) => x.replace(/_/g, "-")).join("/")}/${v[1]}.${v[2]}`;
}

/**
 * Constants of one file whose value is `<alias::Payload as Payload>::TYPE_URI`, where `alias` is a module of the spec crates this file
 * brings in with a `use` (the dispatchers do: `use vti_specs::vtc::elections::{create::v0_5 as create, ...}`). The name `create` means
 * different tasks in different files, so the alias is resolved against this file's own `use` items, never globally.
 */
export function fileConsts(src: string): Map<string, string> {
  const bound = new Map<string, string[]>();
  for (const u of src.matchAll(/(?:^|\n)\s*(?:pub(?:\([a-z]+\))?\s+)?use\s+([^;]+);/g)) for (const it of expandUse(u[1] as string)) bound.set(it.name, it.path);
  const out = new Map<string, string>();
  for (const c of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*<\s*([\w:#]+?)(?:::Payload)?\s+as\s+(?:trust_tasks_rs::)?Payload\s*>::TYPE_URI/g)) {
    const segs = (c[2] as string).split("::");
    const head = bound.get((segs[0] as string).replace(/^r#/, ""));
    const full = head !== undefined ? [...head, ...segs.slice(1)] : segs;
    const uri = uriOfSpecPath(full);
    if (uri !== null) out.set(c[1] as string, uri);
  }
  return out;
}

export function constMap(rsFiles: string[]): Map<string, string> {
  const m = new Map<string, string>();
  const aliases = new Map<string, string>();
  const scoped = new Map<string, string>(); // a name defined by file-scoped aliases: kept globally only when every file agrees on its value
  for (const f of rsFiles) {
    const src = text(f);
    for (const c of src.matchAll(CONST_RE)) m.set(c[1] as string, (c[2] as string).replace(/#response$/, ""));
    const stem = (f.split("/").pop() as string).replace(/\.rs$/, "") === "mod" ? (f.split("/").slice(-2)[0] as string) : (f.split("/").pop() as string).replace(/\.rs$/, "");
    for (const [k, uri] of fileConsts(src)) {
      m.set(`${stem}::${k}`, uri);
      const prev = scoped.get(k);
      scoped.set(k, prev === undefined || prev === uri ? uri : "");
    }
    for (const c of src.matchAll(PAYLOAD_CONST_RE)) {
      const slug = (c[2] as string).split("::").map((x) => x.replace(/^r#/, "").replace(/_/g, "-")).join("/");
      m.set(c[1] as string, `https://trusttasks.org/spec/${slug}/${c[3]}.${c[4]}`);
    }
    // `pub use vti_specs::vtc::join_requests::submit;` (or a braced list) names a module a short const path then uses
    const mods = new Map<string, string>();
    for (const u of src.matchAll(/\buse\s+vti_specs::((?:[a-z0-9_]+::)+)(?:\{([^}]*)\}|([a-z0-9_]+))\s*;/g)) {
      const base = (u[1] as string).split("::").filter(Boolean).map((x) => x.replace(/_/g, "-")).join("/");
      for (const name of ((u[2] ?? u[3]) as string).split(",").map((x) => x.trim().split(/\s+as\s+/)[0] as string).filter(Boolean)) mods.set(name, `${base}/${name.replace(/_/g, "-")}`);
    }
    for (const c of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*<\s*([a-z0-9_]+)::v(\d+)_(\d+)::\w+\s+as/g)) {
      const slug = mods.get(c[2] as string);
      if (slug && !m.has(c[1] as string)) m.set(c[1] as string, `https://trusttasks.org/spec/${slug}/${c[3]}.${c[4]}`);
    }
    for (const c of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*(?:crate|vta_sdk)::[a-z_:]*?([A-Z][A-Z0-9_]+)\s*;/g)) aliases.set(c[1] as string, c[2] as string);
  }
  for (const [k, uri] of scoped) if (uri !== "" && !m.has(k)) m.set(k, uri);
  for (const [k, v] of aliases) {
    const u = m.get(v);
    if (u && !m.has(k)) m.set(k, u);
  }
  return m;
}

/** Text of the brace/bracket block that opens after `marker` (first opener after the marker). */
export function blockAfter(src: string, marker: RegExp): string | null {
  const m = marker.exec(src);
  if (!m) return null;
  const i = m.index + m[0].length - 1; // the marker ends with its opening `{` or `[`
  const open = src[i] as string;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === open) depth++;
    else if (c === close && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

export function resolveBlock(block: string, consts: Map<string, string>): { uris: string[]; unresolved: string[] } {
  const noComments = block.replace(/(^|\s)\/\/[^\n]*/g, "$1");
  const uris = new Set<string>(urisIn(noComments));
  const unresolved = new Set<string>();
  for (const t of noComments.matchAll(/\b((?:[a-z_][a-z0-9_]*::)*)(?:[A-Z][A-Z0-9_]{3,})\b/g)) {
    const parts = (t[0] as string).split("::");
    const name = parts.pop() as string;
    const u = (parts.length > 0 ? consts.get(`${parts[parts.length - 1]}::${name}`) : undefined) ?? consts.get(name);
    if (u) uris.add(u);
    else if (/^(TASK|[A-Z]+)_/.test(name) && /(_TYPE|^TASK_|_URI|_0_\d|_\d_\d)/.test(name)) unresolved.add(name);
  }
  return { uris: [...uris], unresolved: [...unresolved] };
}

/**
 * The Type URIs a VTC `register(routes)` function registers with `on!(routes, <payload path> => handler)` (VTI main, #2579; the
 * `DISPATCHED_URIS` table is gone there). The payload path is either the full spec-crate path
 * (`vti_specs::acl::grant::v0_2::Payload`) or an alias the file's own `use` items bind (`badge_create::Payload`), resolved
 * against that file only. `unresolved` lists the payload paths that did not resolve to a Type URI.
 */
export function onRegistrations(src: string): { uris: string[]; unresolved: string[] } {
  const code = src.replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const bound = new Map<string, string[]>();
  for (const u of code.matchAll(/(?:^|\n)\s*(?:pub(?:\([a-z]+\))?\s+)?use\s+([^;]+);/g)) for (const it of expandUse(u[1] as string)) {
    // a later `use super::{.., name}` (a test module re-importing the alias) must not displace the spec-crate binding
    if (uriOfSpecPath([...it.path, "v0_0"]) !== null || !bound.has(it.name)) bound.set(it.name, it.path);
  }
  const uris = new Set<string>();
  const unresolved = new Set<string>();
  for (const m of code.matchAll(/\bon!\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*([A-Za-z0-9_:#]+?)(?:::Payload)?\s*=>/g)) {
    const segs = (m[1] as string).split("::");
    const head = bound.get((segs[0] as string).replace(/^r#/, ""));
    const uri = uriOfSpecPath(head !== undefined ? [...head, ...segs.slice(1)] : segs);
    if (uri !== null) uris.add(uri);
    else unresolved.add(m[1] as string);
  }
  return { uris: [...uris], unresolved: [...unresolved] };
}


/**
 * The Type URIs a typed dispatcher serves: `AsyncDispatcher::new().on_async(handle_x)...` where `handle_x` is a function whose first argument is
 * `TrustTask<alias::Payload>` (R-03; VTC `git_ns/tasks.rs`, wired in `trust_tasks/mod.rs` through `serves()`). The alias is resolved against the
 * file's own `use` items, then against `pub(crate) use ... as alias` re-exports of the sibling files of its directory (`use super::admin_reads::{account_list}`).
 * `siblings` is the source of the other `.rs` files of the same directory. `unresolved` lists the handlers whose payload did not resolve.
 */
export function typedDispatch(src: string, siblings: string[] = []): { uris: string[]; unresolved: string[] } {
  const strip = (s: string): string => s.replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const code = strip(src);
  const bindings = (s: string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const u of s.matchAll(/(?:^|\n)\s*(?:pub(?:\([a-z]+\))?\s+)?use\s+([^;]+);/g)) for (const it of expandUse(u[1] as string)) if (uriOfSpecPath([...it.path, "v0_0"]) !== null || !m.has(it.name)) m.set(it.name, it.path);
    return m;
  };
  const own = bindings(code);
  const sib = new Map<string, string[]>();
  for (const s of siblings) for (const [k, v] of bindings(strip(s))) if (uriOfSpecPath([...v, "v0_0"]) !== null && !sib.has(k)) sib.set(k, v);
  const handlers = new Set<string>();
  for (const c of code.matchAll(/\.on_async\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) handlers.add(c[1] as string);
  const uris = new Set<string>();
  const unresolved = new Set<string>();
  for (const h of handlers) {
    // the payload is named by the handler's own signature, or by the macro that defines it (`signed_handler!(handle_x, alias::Payload, ...)`)
    const sig = new RegExp(`fn\\s+${h}\\s*(?:<[^>]*>)?\\(\\s*\\w+\\s*:\\s*(?:\\w+::)*TrustTask<\\s*([A-Za-z0-9_:#]+?)::Payload\\s*>`).exec(code)
      ?? new RegExp(`\\b[a-z_]+!\\s*\\(\\s*${h}\\s*,\\s*([A-Za-z0-9_:#]+?)::Payload\\b`).exec(code);
    if (sig === null) { unresolved.add(h); continue; }
    const segs = (sig[1] as string).split("::");
    const head = own.get((segs[0] as string).replace(/^r#/, ""));
    let uri = uriOfSpecPath(head !== undefined ? [...head, ...segs.slice(1)] : segs);
    if (uri === null) { const sh = sib.get((segs[0] as string).replace(/^r#/, "")); if (sh !== undefined) uri = uriOfSpecPath([...sh, ...segs.slice(1)]); }
    if (uri !== null) uris.add(uri);
    else unresolved.add(h);
  }
  return { uris: [...uris], unresolved: [...unresolved] };
}

/**
 * The Type URIs a routing table of `uri!(<path>)` entries serves (S-02; `vti-voting-service/src/dispatch.rs`): a `macro_rules! uri` whose body is
 * `<vti_specs::voting::$($path)::+::Payload as Payload>::TYPE_URI` and a `const SERVED: &[(&str, Task, ..)] = &[ (uri!(election::register::v0_4), Task::Register, ..), .. ]`.
 * The family prefix comes from the macro body, so a macro that names another family reads the same way. `unresolved` lists entries that did not resolve.
 */
export function uriMacroTable(src: string): { uris: string[]; unresolved: string[] } {
  const code = src.replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const prefix = /macro_rules!\s+uri\s*\{[^}]*?<\s*((?:[A-Za-z_][A-Za-z0-9_]*::)+)\$\(/.exec(code);
  const block = blockAfter(code, /\bconst\s+SERVED\b[^=]*=\s*&\[/);
  if (prefix === null || block === null) return { uris: [], unresolved: [] };
  const base = (prefix[1] as string).split("::").filter((x) => x !== "");
  const uris = new Set<string>();
  const unresolved = new Set<string>();
  for (const m of block.matchAll(/\buri!\s*\(\s*([A-Za-z0-9_:]+)\s*\)/g)) {
    const u = uriOfSpecPath([...base, ...(m[1] as string).split("::")]);
    if (u !== null) uris.add(u);
    else unresolved.add(m[1] as string);
  }
  return { uris: [...uris], unresolved: [...unresolved] };
}

/** The Type URIs a route is mounted under with a literal: `tt(routes!(auth::passkey_login_start), "https://trusttasks.org/spec/auth/passkey/login/start/0.2")` (an HTTPS route, not a signed document; R-03). */
export function ttRoutes(src: string): string[] {
  const code = src.replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
  const out = new Set<string>();
  for (const m of code.matchAll(/\btt\(\s*routes!\([^)]*\)\s*,\s*"(https:\/\/trusttasks\.org\/spec\/[a-z0-9][a-z0-9/_-]*?\/\d+\.\d+)"\s*,?\s*\)/g)) out.add(m[1] as string);
  return [...out];
}

export function scanVti(root: string): VtiUsage {
  const out: VtiUsage = { pinned: new Set(), served: new Map(), unresolved: [], files: 0, consts: new Map() };
  for (const f of walk(root, ["trust-tasks.lock"])) {
    if (!f.endsWith("trust-tasks.lock")) continue;
    out.files++;
    for (const m of text(f).matchAll(/type_uri\s*=\s*"([^"]+)"/g)) out.pinned.add((m[1] as string).replace(/#response$/, ""));
  }
  const rs = walk(root, [".rs"]);
  const consts = constMap(rs);
  out.consts = consts;
  const serve = (surface: string, file: string, marker: RegExp) => {
    const path = rs.find((p) => rel(root, p) === file);
    if (!path) return;
    const block = blockAfter(text(path), marker);
    if (!block) return;
    const r = resolveBlock(block, consts);
    for (const u of r.uris) {
      if (!out.served.has(u)) out.served.set(u, new Set());
      out.served.get(u)?.add(surface);
    }
    out.unresolved.push(...r.unresolved.map((n) => `${surface}:${n}`));
  };
  serve("vta", "vta-service/src/trust_tasks/mod.rs", /\bdispatch_table!\s*\{/);
  serve("vtc", "vtc-service/src/trust_tasks/mod.rs", /const DISPATCHED_URIS: &\[&str\] = &\[/);
  serve("vtc", "vti-rooms/src/wire.rs", /const ROOMS_DISPATCHED_URIS: &\[&str\] = &\[/);
  // upstream main: the community routes through `on!(routes, ...)` registrations in vtc-service/src/trust_tasks/*.rs
  for (const path of rs) {
    const r = rel(root, path);
    if (!/^vtc-service\/src\/trust_tasks\/[a-z0-9_]+\.rs$/.test(r)) continue;
    const src = text(path);
    if (!/\bon!\s*\(/.test(src)) continue;
    const reg = onRegistrations(src);
    for (const u of reg.uris) {
      if (!out.served.has(u)) out.served.set(u, new Set());
      out.served.get(u)?.add("vtc");
    }
    out.unresolved.push(...reg.unresolved.map((n) => `vtc:${n}`));
  }
  // typed dispatchers (`AsyncDispatcher ... .on_async(handle_x)`, for example VTC's git-ns) and HTTPS routes mounted with `tt(routes!(..), "<uri>")` (R-03)
  for (const path of rs) {
    const r = rel(root, path);
    const m = /^(vtc|vta)-service\/src\//.exec(r);
    if (m === null || isTestPath(r)) continue;
    const surface = m[1] as string;
    const src = text(path);
    const add = (u: string): void => { if (!out.served.has(u)) out.served.set(u, new Set()); out.served.get(u)?.add(surface); };
    if (/\.on_async\(/.test(src)) {
      const dir = path.slice(0, path.lastIndexOf("/"));
      const sibs = rs.filter((p) => p !== path && p.slice(0, p.lastIndexOf("/")) === dir).map((p) => text(p));
      const d = typedDispatch(src, sibs);
      for (const u of d.uris) add(u);
      out.unresolved.push(...d.unresolved.map((n) => `${surface}:${n}`));
    }
    for (const u of ttRoutes(src)) add(u);
  }
  // the voting service's routing table (`uri!(..)` entries of `const SERVED`; S-02)
  for (const path of rs) {
    const r = rel(root, path);
    if (!/^vti-voting-service\/src\/[a-z0-9_]+\.rs$/.test(r) || isTestPath(r)) continue;
    const t = uriMacroTable(text(path));
    for (const u of t.uris) { if (!out.served.has(u)) out.served.set(u, new Set()); out.served.get(u)?.add("voting"); }
    out.unresolved.push(...t.unresolved.map((n) => `voting:${n}`));
  }
  // the witness service's table of served types
  serve("witness", "vti-witness/src/dispatch.rs", /pub const SERVED: &\[&str\] = &\[/);
  return out;
}
