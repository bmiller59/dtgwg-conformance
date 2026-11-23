// SPDX-License-Identifier: Apache-2.0
// A small constructive generator for the `pattern` keyword: a string matching a regular expression written in the subset the payload
// schemas use (literals, escapes, classes, groups, alternation, the quantifiers * + ? {n} {n,m} {n,}). It returns `undefined` for anything
// else (lookahead, backreference, named groups), never a guess. The caller checks the result against the real RegExp.

type Node =
  | { k: "lit"; c: string }
  | { k: "set"; pick: string[]; test: (c: string) => boolean }
  | { k: "seq"; items: Node[] }
  | { k: "alt"; alts: Node[] }
  | { k: "rep"; n: Node; min: number; max: number };

class Unsupported extends Error {}

const ESC_CLASS: Record<string, { pick: string[]; test: (c: string) => boolean }> = {
  d: { pick: ["0"], test: (c) => /\d/.test(c) },
  D: { pick: ["a"], test: (c) => /\D/.test(c) },
  w: { pick: ["a"], test: (c) => /\w/.test(c) },
  W: { pick: ["-"], test: (c) => /\W/.test(c) },
  s: { pick: [" "], test: (c) => /\s/.test(c) },
  S: { pick: ["x"], test: (c) => /\S/.test(c) },
};
const ESC_LIT: Record<string, string> = { n: "\n", r: "\r", t: "\t", f: "\f", v: "\v", "0": "\0" };
const FALLBACK_PICK = ["a", "A", "0", "x", "-", "_", ".", "z", "~"];

function parse(src: string): Node {
  let i = 0;
  const peek = (): string | undefined => src[i];
  const escChar = (): string => {
    // after the backslash
    const c = src[i++];
    if (c === undefined) throw new Unsupported();
    if (c === "u") { const h = src.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) throw new Unsupported(); i += 4; return String.fromCharCode(parseInt(h, 16)); }
    if (c === "x") { const h = src.slice(i, i + 2); if (!/^[0-9a-fA-F]{2}$/.test(h)) throw new Unsupported(); i += 2; return String.fromCharCode(parseInt(h, 16)); }
    if (/[1-9]/.test(c) || c === "k" || c === "p" || c === "P" || c === "b" || c === "B") throw new Unsupported();
    return ESC_LIT[c] ?? c;
  };
  const parseClass = (): Node => {
    // after "["
    let neg = false;
    if (peek() === "^") { neg = true; i++; }
    const tests: ((c: string) => boolean)[] = [];
    const picks: string[] = [];
    while (i < src.length && peek() !== "]") {
      let lo: string;
      if (peek() === "\\") {
        i++;
        const e = src[i];
        if (e !== undefined && ESC_CLASS[e] !== undefined) { i++; tests.push(ESC_CLASS[e]!.test); picks.push(...ESC_CLASS[e]!.pick); continue; }
        lo = escChar();
      } else lo = src[i++]!;
      if (peek() === "-" && src[i + 1] !== "]" && src[i + 1] !== undefined) {
        i++;
        let hi: string;
        if (peek() === "\\") { i++; if (src[i] !== undefined && ESC_CLASS[src[i]!] !== undefined) throw new Unsupported(); hi = escChar(); } else hi = src[i++]!;
        if (hi < lo) throw new Unsupported();
        tests.push((c) => c >= lo && c <= hi);
        picks.push(lo);
      } else { tests.push((c) => c === lo); picks.push(lo); }
    }
    if (peek() !== "]") throw new Unsupported();
    i++;
    const inSet = (c: string): boolean => tests.some((t) => t(c));
    if (neg) return { k: "set", pick: FALLBACK_PICK.filter((c) => !inSet(c)), test: (c) => !inSet(c) };
    return { k: "set", pick: picks, test: inSet };
  };
  const parseAtom = (): Node | undefined => {
    const c = peek();
    if (c === undefined || c === "|" || c === ")") return undefined;
    i++;
    if (c === "^" || c === "$") return { k: "seq", items: [] };
    if (c === "(") {
      if (src[i] === "?") { if (src.slice(i, i + 2) === "?:") i += 2; else throw new Unsupported(); }
      const inner = parseAlt();
      if (peek() !== ")") throw new Unsupported();
      i++;
      return inner;
    }
    if (c === "[") return parseClass();
    if (c === ".") return { k: "set", pick: ["x"], test: (ch) => ch !== "\n" };
    if (c === "\\") {
      const e = src[i];
      if (e !== undefined && ESC_CLASS[e] !== undefined) { i++; return { k: "set", ...ESC_CLASS[e]! }; }
      return { k: "lit", c: escChar() };
    }
    if (c === "*" || c === "+" || c === "?" || c === "{") throw new Unsupported();
    return { k: "lit", c };
  };
  const parseSeq = (): Node => {
    const items: Node[] = [];
    for (;;) {
      const a = parseAtom();
      if (a === undefined) break;
      let n = a;
      const q = peek();
      if (q === "*") { i++; n = { k: "rep", n: a, min: 0, max: Infinity }; }
      else if (q === "+") { i++; n = { k: "rep", n: a, min: 1, max: Infinity }; }
      else if (q === "?") { i++; n = { k: "rep", n: a, min: 0, max: 1 }; }
      else if (q === "{") {
        const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
        if (m === null) throw new Unsupported();
        i += m[0].length;
        const lo = Number(m[1]);
        n = { k: "rep", n: a, min: lo, max: m[2] === undefined ? lo : m[3] === "" ? Infinity : Number(m[3]) };
      }
      if (peek() === "?" && n !== a) i++; // lazy quantifier: same language
      items.push(n);
    }
    return { k: "seq", items };
  };
  const parseAlt = (): Node => {
    const alts = [parseSeq()];
    while (peek() === "|") { i++; alts.push(parseSeq()); }
    return alts.length === 1 ? alts[0]! : { k: "alt", alts };
  };
  const n = parseAlt();
  if (i !== src.length) throw new Unsupported();
  return n;
}

function emit(n: Node, extra: number, alt: "first" | "last"): string {
  switch (n.k) {
    case "lit": return n.c;
    case "set": { const c = n.pick.find((p) => n.test(p)); if (c === undefined) throw new Unsupported(); return c; }
    case "seq": return n.items.map((x) => emit(x, extra, alt)).join("");
    case "alt": return emit(alt === "first" ? n.alts[0]! : n.alts[n.alts.length - 1]!, extra, alt);
    case "rep": { const times = Math.min(n.max, n.min + extra); return emit(n.n, extra, alt).repeat(times); }
  }
}

/** A string matching `pattern` (unanchored `test` semantics, as JSON Schema defines it) whose length is within [min, max], or undefined. */
export function stringForPattern(pattern: string, min = 0, max = Infinity): string | undefined {
  let ast: Node;
  let re: RegExp;
  try { ast = parse(pattern); re = new RegExp(pattern, "u"); } catch { return undefined; }
  for (const alt of ["first", "last"] as const) {
    for (let extra = 0; extra <= 80; extra++) {
      let s: string;
      try { s = emit(ast, extra, alt); } catch { return undefined; }
      const len = [...s].length;
      if (len > max) break;
      if (len >= min && re.test(s)) return s;
      // a pattern not anchored at its end ("^-----BEGIN ...") admits a longer string: pad to the minimum length
      if (len < min && !pattern.endsWith("$")) { const padded = s.padEnd(s.length + (min - len), "x"); if (re.test(padded)) return padded; }
    }
  }
  return undefined;
}
