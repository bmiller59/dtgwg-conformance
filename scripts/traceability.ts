// SPDX-License-Identifier: Apache-2.0
// Reverse traceability report (docs/04 section 18.11): the normative statements (BCP 14 keywords) of the task-force texts the vectors
// cite, read at the pinned commit of vectors/tf-manifest.json from a local task-force clone (read-only git, no fetch), and the vectors
// that cite each statement's lines. Writes results/traceability.md.
// Usage: node --experimental-strip-types scripts/traceability.ts [--kit <clone>] [--check]
//   clone: --kit, $TT_KIT, or ../dtgwg-trust-tasks-tf. The clone is not tracked, so this command is not part of `npm run check:docs`;
//   --check compares the page with what the clone gives and fails when it is stale.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultKitRoot } from "../src/vectors/source.ts";
import { loadTfManifest } from "../src/vectors/tfref.ts";
import { coverage, extractStatements, KEYWORDS, parseCitations, stringsOf } from "../src/traceability/extract.ts";
import type { Citation, Statement } from "../src/traceability/extract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "results", "traceability.md");
const esc = (s: string): string => s.replace(/\|/g, "\\|");
const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
/** Quoted task-force text with its links reduced to their text (their anchors belong to the task-force page, not this one). */
const quote = (s: string): string => esc(clip(s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[<>]/g, "")));

/** Every vector of every generated vector file (not the imported fixtures), as id and the strings it holds. */
function vectorStrings(): { id: string; strings: string[]; tfPath?: string }[] {
  const out: { id: string; strings: string[]; tfPath?: string }[] = [];
  const walk = (d: string): void => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== "imported") walk(p); continue; }
      if (!f.endsWith(".json")) continue;
      const j = JSON.parse(readFileSync(p, "utf8")) as { vectors?: { id: string; retired?: unknown; source?: { tfRef?: { repoPath?: string } } }[] };
      for (const v of j.vectors ?? []) if (v.retired === undefined) out.push({ id: v.id, strings: stringsOf(v), ...(v.source?.tfRef?.repoPath === undefined ? {} : { tfPath: v.source.tfRef.repoPath }) });
    }
  };
  walk(join(root, "vectors"));
  return out;
}

function pinKey(path: string): string {
  return `kit:${path.replace(/\/spec\.md$/, "")}`;
}

export function build(clone: string): string {
  const m = loadTfManifest();
  const commit = m.main.commit;
  const pins = (JSON.parse(readFileSync(join(root, "vectors", "pins.json"), "utf8")) as { pins: Record<string, string> }).pins;
  const vs = vectorStrings();
  const cites: Citation[] = vs.flatMap((v) => v.strings.flatMap((s) => parseCitations(v.id, s)));
  const lineCited = new Set(cites.filter((c) => c.lines.length > 0 || c.sections.length > 0).map((c) => c.path));
  const refOnly = new Set(vs.map((v) => v.tfPath).filter((p): p is string => p !== undefined && p.endsWith(".md") && !lineCited.has(p)));
  const paths = [...lineCited].sort();
  const git = (...a: string[]): string => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  const blob = (p: string): Buffer => execFileSync("git", ["-C", clone, "show", `${commit}:${p}`], { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
  /** The digest refresh-pins computes for a pin (src/vectors/source.ts digestPath): the file, or every file of the spec's directory. */
  const pinDigest = (p: string): string => {
    if (p === "SPEC.md") return `sha256:${sha(blob(p))}`;
    const dir = p.replace(/\/spec\.md$/, "");
    const segCmp = (a: string, b: string): number => { const x = a.split("/"), y = b.split("/"); for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1; return x.length - y.length; };
    const rel = git("ls-tree", "-r", "--name-only", commit, `${dir}/`).split("\n").filter((f) => f !== "").map((f) => f.slice(dir.length + 1)).sort(segCmp);
    return `sha256:${sha(rel.map((f) => `${f}\0${sha(blob(`${dir}/${f}`))}\n`).join(""))}`;
  };
  git("cat-file", "-e", `${commit}^{commit}`);
  const files: { path: string; digest: string; pin: string; stmts: { st: Statement; by: string; vectors: string[] }[] }[] = [];
  const missing: string[] = [];
  for (const p of paths) {
    let text: string;
    try { text = git("show", `${commit}:${p}`); } catch { missing.push(p); continue; }
    const pin = pins[pinKey(p)];
    const digest = pin === undefined ? "" : pinDigest(p);
    const stmts = extractStatements(p, text).map((st) => ({ st, ...coverage(st, cites) }));
    files.push({ path: p, digest, pin: pin === undefined ? "no pin" : pin === digest ? "matches pin" : "DIFFERS from pin", stmts });
  }
  const all = files.flatMap((f) => f.stmts);
  const n = (by: string): number => all.filter((s) => s.by === by).length;
  const L: string[] = [
    "# Reverse traceability: normative statements and the vectors that cite them",
    "",
    "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.",
    "",
    `Generated by \`npm run traceability -- --kit <clone>\` (scripts/traceability.ts) from the task-force texts at commit \`${commit.slice(0, 9)}\` (vectors/tf-manifest.json) and the citations in the vector files; do not edit. The clone is not tracked, so this page is not checked by \`npm run check:docs\`: re-run the command after a vector or pin change (\`--check\` tells whether the page is stale). Design: [docs/04 section 18.11](../docs/04-suite-design.md#1811-reverse-traceability).`,
    "",
    `Statements found: ${all.length} in ${files.length} texts. Cited by line: ${n("line")}. Cited by section only: ${n("section")}. Not cited: ${n("none")}. Not cited does not mean untested by any means; it means no vector names a line of the statement (see the limits).`,
    "",
    "## Stated limits",
    "",
    `- **Keyword detection.** A statement is a block (paragraph, list item, table row or heading) holding one of ${KEYWORDS.map((k) => `\`${k}\``).join(", ")} in upper case. \`MAY\` and \`OPTIONAL\` are left out. A keyword quoted rather than used ("the SHOULD of ...") is still counted, and a requirement written without a keyword is missed. Front matter, fenced code and the BCP 14 boilerplate are skipped.`,
    "- **Line-based matching.** A statement counts as cited when a vector cites any line from its first to its last line (`SPEC.md:<line>`, `specs/...:<line>`, a list such as `1015, 1017 and 1118`, or a range `1011-1023`). A range citation therefore covers every statement it overlaps, even when the vector tests only one of them; a statement spanning lines counts as cited when any of its lines is.",
    "- **Section citations** (`SPEC.md 7.2 item 8`) cover the statements of that numbered section and its subsections, and are listed apart as \"section only\": weaker evidence. Item numbers are not resolved. Spec files without numbered headings have no section citations.",
    "- **Citations are read from every string of a vector** (its spec basis, notes and source), not only from its spec basis; a mention in a note counts the same.",
    "- **Texts** are the ones the vectors cite by line or section. Each is read at the manifest commit and its digest (the file for SPEC.md, the spec's directory otherwise, as `npm run pins` computes it) is compared with `vectors/pins.json` where a pin exists; \"DIFFERS from pin\" means the vectors were pinned to another revision of the text and its line citations may point elsewhere. Texts the vectors reference only through `tfRef` (no line or section) are listed below and not extracted.",
    "- No statement id is assigned beyond `<path>:<first line>`: ids move when the pinned text changes, as the citations do.",
    "",
    "## Texts",
    "",
    "| Text | Digest at the pinned commit | Statements | By line | Section only | Not cited |",
    "|---|---|---|---|---|---|",
    ...files.map((f) => `| ${f.path} | ${f.pin} | ${f.stmts.length} | ${f.stmts.filter((s) => s.by === "line").length} | ${f.stmts.filter((s) => s.by === "section").length} | ${f.stmts.filter((s) => s.by === "none").length} |`),
    "",
    ...(missing.length > 0 ? [`Cited but not found at the pinned commit: ${missing.join(", ")}.`, ""] : []),
    `Texts referenced only through \`tfRef\` (not extracted): ${refOnly.size}.`,
    "",
    "The tables below quote the task-force text (links reduced to their text, cut at 160 characters); the claims lint does not apply to the quotations.",
    "",
    "<!-- lint:skip -->",
    "",
  ];
  for (const f of files) {
    const none = f.stmts.filter((s) => s.by !== "line");
    if (none.length === 0) continue;
    L.push(`## ${f.path}`, "", "| Statement | Section | Keywords | Cited | Text |", "|---|---|---|---|---|");
    for (const s of none) L.push(`| ${f.path}:${s.st.start}${s.st.end > s.st.start ? `-${s.st.end}` : ""} | ${esc(s.st.section)} | ${s.st.keywords.join(", ")} | ${s.by === "section" ? `section only (${s.vectors.slice(0, 3).join(", ")}${s.vectors.length > 3 ? ", ..." : ""})` : "no"} | ${quote(s.st.text)} |`);
    L.push("");
  }
  L.push("<!-- /lint:skip -->", "");
  return L.join("\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ki = args.indexOf("--kit");
  const clone = defaultKitRoot(ki >= 0 ? args[ki + 1] : undefined);
  if (clone === undefined) {
    console.error("no task-force clone (pass --kit <dir> or set TT_KIT): the report needs the pinned texts and is not written");
    process.exit(2);
  }
  const page = build(clone);
  if (args.includes("--check")) {
    const same = existsSync(OUT) && readFileSync(OUT, "utf8") === page;
    if (!same) { console.error(`${relative(root, OUT)} is stale: run npm run traceability -- --kit <clone>`); process.exit(1); }
    console.log("traceability: current");
  } else {
    writeFileSync(OUT, page);
    console.log(`traceability: wrote ${relative(root, OUT)}`);
  }
}
