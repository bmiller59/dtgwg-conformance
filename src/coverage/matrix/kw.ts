// SPDX-License-Identifier: Apache-2.0
// Which task versions keyring-wallet's source names (non-test files), with the file and line of each mention (code or comment), and which it
// registers an inbound handler for. Comments are stripped before a mention counts as code, so a version named only in a comment is `commentOnly`.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveBlock } from "./vti.ts";
import { isTestPath, rel, text, URI_RE, walk } from "./walk.ts";

const PKG_RE = /@openvtc\/trust-tasks\/([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)\/payload/g;
const BASE = "https://trusttasks.org/spec/";

/** `src` with every comment blanked (newlines kept, so line numbers hold). Strings and template literals are left alone, so `https://` is not a comment. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      if (i < n) { out += "  "; i += 2; }
    } else if (c === "'" || c === '"' || c === "`") {
      out += c;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < n) { out += src[i] as string; i++; }
        if (c !== "`" && src[i] === "\n") break;
        out += src[i] as string;
        i++;
      }
      if (i < n && src[i] === c) { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Type URIs a source names as code, each with its first line: literal URIs, imports of the generated payload package
 * (`@openvtc/trust-tasks/<slug>/<ver>/payload`), and template literals that start from a string constant holding the spec base or a path of it
 * (`const SPEC = 'https://trusttasks.org/spec/vtc/badges/'` then `${SPEC}mine/list/0.1`). Comments are ignored.
 */
export function kwUriLines(src: string): Map<string, number> {
  const code = stripComments(src);
  const out = new Map<string, number>();
  const lineAt = (idx: number): number => code.slice(0, idx).split("\n").length;
  const add = (u: string, idx: number): void => { if (!out.has(u)) out.set(u, lineAt(idx)); };
  for (const m of code.matchAll(URI_RE)) add(`${BASE}${m[1]}/${m[2]}`, m.index ?? 0);
  for (const m of code.matchAll(PKG_RE)) add(`${BASE}${m[1]}/${m[2]}`, m.index ?? 0);
  const consts = new Map<string, string>();
  for (const m of code.matchAll(/\bconst\s+(\w+)\s*(?::\s*string\s*)?=\s*(['"`])(https:\/\/trusttasks\.org\/spec\/?[a-z0-9/_-]*)\2/g)) consts.set(m[1] as string, m[3] as string);
  if (consts.size > 0) {
    for (const m of code.matchAll(/`\$\{(\w+)\}\/?([a-z0-9][a-z0-9/_-]*?)\/(\d+\.\d+)`/g)) {
      const base = consts.get(m[1] as string);
      if (base !== undefined) add(`${base.endsWith("/") ? base : `${base}/`}${m[2]}/${m[3]}`, m.index ?? 0);
    }
    // the constant holds the whole slug and the template adds only the version: `${TASK_ERROR}0.5`
    for (const m of code.matchAll(/`\$\{(\w+)\}(\d+\.\d+)`/g)) {
      const base = consts.get(m[1] as string);
      if (base !== undefined && base.endsWith("/")) add(`${base}${m[2]}`, m.index ?? 0);
    }
  }
  return out;
}

/** Type URIs a KW source file names as code (comments ignored). */
export function kwUris(src: string): string[] {
  return [...kwUriLines(src).keys()];
}

/** Type URIs a source names in comments only (not in any code position), with the first line. */
export function kwCommentUriLines(src: string): Map<string, number> {
  const code = kwUriLines(src);
  const out = new Map<string, number>();
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(URI_RE)) {
      const u = `${BASE}${m[1]}/${m[2]}`;
      if (!code.has(u) && !out.has(u)) out.set(u, i + 1);
    }
  });
  return out;
}

export interface KwEvidence {
  /** Path relative to the checkout root. */
  file: string;
  line: number;
  kind: "code" | "comment";
}

export interface KwUsage {
  /** Versions named in non-test code (comments ignored), with the files. */
  referenced: Map<string, Set<string>>;
  /** Every mention (code first, at most 6 per version): file, line and whether it is code or a comment. */
  evidence: Map<string, KwEvidence[]>;
  /** Versions named only in comments (never in code). */
  commentOnly: Set<string>;
  serves: Set<string>;
  notes: string[];
}

const SRC_DIRS = ["bifold/packages", "app/src", "packages"];

export function scanKw(root: string): KwUsage {
  const out: KwUsage = { referenced: new Map(), evidence: new Map(), commentOnly: new Set(), serves: new Set(), notes: [] };
  for (const d of SRC_DIRS) {
    for (const f of walk(join(root, d), [".ts", ".tsx"])) {
      const r = rel(root, f);
      if (isTestPath(r) || r.includes("/docs/") || /(^|\/)lib\/(typescript|commonjs|module)\//.test(r) || r.endsWith(".d.ts")) continue; // bob build output (lib/typescript ...) and declaration files
      const src = text(f);
      const note = (u: string, line: number, kind: "code" | "comment"): void => {
        const ev = out.evidence.get(u) ?? [];
        if (ev.length < 6) ev.push({ file: r, line, kind });
        out.evidence.set(u, ev);
      };
      for (const [u, line] of kwUriLines(src)) {
        if (!out.referenced.has(u)) out.referenced.set(u, new Set());
        out.referenced.get(u)?.add(r);
        note(u, line, "code");
      }
      for (const [u, line] of kwCommentUriLines(src)) note(u, line, "comment");
    }
  }
  for (const [u, ev] of out.evidence) if (!out.referenced.has(u) && ev.length > 0) out.commentOnly.add(u);
  const cer = walk(join(root, "bifold/packages/core/src/modules/trust-tasks"), ["ceremony.ts"]).find((p) => p.endsWith("/trust-tasks/ceremony.ts"));
  if (!cer) {
    out.notes.push("ceremony.ts (inbound registry) not found");
    return out;
  }
  const src = text(cer);
  const imports = new Map<string, string>();
  const direct = new Map<string, string>();
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)) {
    const pkg = /^@openvtc\/trust-tasks\/(.+)\/(\d+\.\d+)\/payload$/.exec(m[2] as string);
    if (pkg) direct.set(m[1] as string, `https://trusttasks.org/spec/${pkg[1]}/${pkg[2]}`);
    else if ((m[2] as string).startsWith(".")) imports.set(m[1] as string, m[2] as string);
  }
  for (const m of src.matchAll(/trustTaskRegistry\.register\(\{\s*typeUri:\s*(\w+)\.TYPE_URI/g)) {
    const d = direct.get(m[1] as string);
    if (d) {
      out.serves.add(d);
      continue;
    }
    const spec = imports.get(m[1] as string);
    const file = spec && [join(dirname(cer), `${spec}.ts`), join(dirname(cer), spec, "index.ts")].find(existsSync);
    const hit = file && /TYPE_URI\s*=\s*'([^']+)'/.exec(text(file));
    if (hit) out.serves.add((hit[1] as string).replace(/#response$/, ""));
    else out.notes.push(`registry entry ${m[1]}.TYPE_URI could not be resolved`);
  }
  return out;
}

/** URIs named in the given files (relative to the checkout root); missing files are reported. */
export function urisInFiles(root: string, files: string[], consts?: Map<string, string>): { uris: string[]; missing: string[] } {
  const uris = new Set<string>();
  const missing: string[] = [];
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p)) {
      missing.push(f);
      continue;
    }
    const src = text(p);
    for (const u of kwUris(src)) uris.add(u);
    if (consts) for (const u of resolveBlock(src, consts).uris) uris.add(u);
  }
  return { uris: [...uris].sort(), missing };
}
