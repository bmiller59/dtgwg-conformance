// SPDX-License-Identifier: Apache-2.0
// Independent passing implementations per vector group (docs/14 section 8): a W3C-style implementation report generated from the
// recorded runs of the at-a-glance model. Independent means independent of the suite: the reference adapter (the suite's oracle) is never counted and is shown apart.
// Counts are per platform (a platform counts once whatever number of its surfaces pass); only recorded runs count.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runsDir } from "../results-dir.ts";
import { loadCatalog, ordered, runRef, type Model, type Result, type Subject, type SurfaceModel } from "./model.ts";

const BANNER = "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.";
const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");

/** The suite version a run folder's run.json records (the folder itself or its first-level parts), or null when none does. */
export function runSuiteVersion(results: string, run: string): string | null {
  const dir = join(runsDir(results), run);
  const cands = [join(dir, "run.json"), ...(existsSync(dir) ? readdirSync(dir).sort().filter((d) => statSync(join(dir, d)).isDirectory()).map((d) => join(dir, d, "run.json")) : [])];
  for (const p of cands) {
    if (!existsSync(p)) continue;
    const v = (JSON.parse(readFileSync(p, "utf8")) as { suite?: { version?: unknown } }).suite?.version;
    if (typeof v === "string" && v !== "") return v;
  }
  return null;
}

export interface SurfaceSource { platform: string; subject: string; surface: string; label: string; runs: string[]; suiteVersion: string; recordedEarlier: boolean; counted: boolean; why?: string }
export interface GroupCell { surface: string; ran: number; pass: number; clarify: number; differ: number; full: boolean; earlier: boolean }
export interface GroupRow {
  group: string; channel: string; vectors: number;
  /** Independent platforms whose best surface passed everything it ran in the group (at least one PASS, no FAIL or KNOWN-FAIL). */
  passing: { platform: string; cell: GroupCell }[];
  /** Independent platforms that ran the group and recorded a difference (FAIL or KNOWN-FAIL) on every surface that ran it. */
  differing: { platform: string; cell: GroupCell }[];
  excluded: { platform: string; cell: GroupCell }[];
}
export interface IndependentReport { sources: SurfaceSource[]; notReachable: { platform: string; run: string }[]; groups: GroupRow[] }

const counted = (s: Subject): boolean => s.cfg.role === "platform";
const whyExcluded = (s: Subject): string => s.cfg.role === "self-check" ? "the suite's own oracle" : s.cfg.role;

function cellOf(sf: SurfaceModel, rs: Result[], vectors: number): GroupCell {
  const ran = rs.filter((r) => r.status === "PASS" || r.status === "CLARIFY" || r.status === "FAIL" || r.status === "KNOWN-FAIL");
  const pass = ran.filter((r) => r.status === "PASS").length;
  const differ = ran.filter((r) => r.status === "FAIL" || r.status === "KNOWN-FAIL").length;
  return { surface: sf.cfg.id, ran: ran.length, pass, clarify: ran.length - pass - differ, differ, full: ran.length === vectors, earlier: sf.recordedEarlier };
}
const passes = (c: GroupCell): boolean => c.pass > 0 && c.differ === 0;
/** The surface that shows most for the platform: passing first, then the whole group run, then the most PASS. */
const better = (a: GroupCell, b: GroupCell): boolean => (passes(a) !== passes(b) ? passes(a) : a.full !== b.full ? a.full : a.pass > b.pass);

export function buildIndependent(root: string, model: Model): IndependentReport {
  const catalog = loadCatalog(root);
  const size = new Map<string, { n: number; channels: Set<string> }>();
  for (const v of catalog.values()) {
    if (v.excludedFromRun) continue;
    const g = size.get(v.group) ?? { n: 0, channels: new Set<string>() };
    g.n++; g.channels.add(v.channel);
    size.set(v.group, g);
  }
  const sources: SurfaceSource[] = [];
  const notReachable: IndependentReport["notReachable"] = [];
  const best = new Map<string, Map<string, { cell: GroupCell; counted: boolean }>>();
  for (const s of ordered(model)) {
    if (s.surfaces.length === 0 && s.cfg.notReachable !== undefined) notReachable.push({ platform: s.cfg.name, run: s.cfg.notReachable.run });
    for (const sf of s.surfaces) {
      const versions = [...new Set(sf.runs.map((r) => runSuiteVersion(model.results, r) ?? "not recorded"))];
      sources.push({ platform: s.cfg.name, subject: s.cfg.id, surface: sf.cfg.id, label: sf.cfg.label, runs: sf.runs, suiteVersion: versions.join(", "), recordedEarlier: sf.recordedEarlier, counted: counted(s), ...(counted(s) ? {} : { why: whyExcluded(s) }) });
      const byGroup = new Map<string, Result[]>();
      for (const r of sf.results) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
      for (const [g, rs] of byGroup) {
        if (!size.has(g)) continue;
        const cell = cellOf(sf, rs, size.get(g)!.n);
        if (cell.ran === 0) continue;
        const m = best.get(g) ?? new Map<string, { cell: GroupCell; counted: boolean }>();
        const cur = m.get(s.cfg.name);
        if (cur === undefined || better(cell, cur.cell)) m.set(s.cfg.name, { cell, counted: counted(s) });
        best.set(g, m);
      }
    }
  }
  const groups: GroupRow[] = [...size.keys()].sort().map((g) => {
    const m = [...(best.get(g) ?? new Map<string, { cell: GroupCell; counted: boolean }>()).entries()];
    return {
      group: g, channel: [...size.get(g)!.channels].sort().join(", "), vectors: size.get(g)!.n,
      passing: m.filter(([, x]) => x.counted && passes(x.cell)).map(([platform, x]) => ({ platform, cell: x.cell })),
      differing: m.filter(([, x]) => x.counted && !passes(x.cell)).map(([platform, x]) => ({ platform, cell: x.cell })),
      excluded: m.filter(([, x]) => !x.counted).map(([platform, x]) => ({ platform, cell: x.cell })),
    };
  });
  return { sources, notReachable, groups };
}

const cellText = (p: { platform: string; cell: GroupCell }): string =>
  `${p.platform} (${p.cell.surface}: ${p.cell.pass} PASS${p.cell.clarify > 0 ? `, ${p.cell.clarify} CLARIFY` : ""}${p.cell.differ > 0 ? `, ${p.cell.differ} FAIL or KNOWN-FAIL` : ""} of ${p.cell.ran} run${p.cell.full ? ", whole group" : ""}${p.cell.earlier ? "; earlier recording" : ""})`;

const DEFINITIONS = [
  "**Independent** means independent of the suite. Not counted, shown apart: the reference adapter (the suite's own oracle). truststackers is not reachable by the suite (no run); VTI and keyring-wallet are the counted rows. Independent of the suite is not independent of each other: implementations may share libraries or specification readings, and this report does not check that.",
  "**Passes a group**: on at least one of the platform's surfaces, at least one vector of the group was PASS and none was FAIL or KNOWN-FAIL (CLARIFY is neither, as everywhere in the suite). A platform counts once, through its surface that shows most. \"Whole group\" means every vector of the group ran on that surface (none SKIP).",
  "Only recorded runs count (the run folders below, with the suite version their `run.json` records, or \"not recorded\" for folders before run.json). A surface whose runs predate the newest recorded run or the current vector set is marked \"earlier recording\". Not a ranking, not a status award, and not interoperation of any kind (docs/14).",
];

export function independentPage(r: IndependentReport): string {
  const n = (k: number, ch?: string): number => r.groups.filter((g) => (ch === undefined || g.channel === ch) && g.passing.length === k).length;
  const lines = [
    "# Independent passing implementations per vector group",
    "",
    BANNER,
    "",
    "Generated by `npm run regen` (src/glance/independent.ts) from the recorded runs in [at-a-glance.config.json](at-a-glance.config.json); do not edit. Design: [docs/14 section 8](../docs/14-interoperability-tracking.md#8-independent-passing-implementations-per-vector-group).",
    "",
    ...DEFINITIONS.flatMap((d) => [d, ""]),
    "## Sources",
    "",
    table(["Platform", "Surface", "Run folders", "Suite version", "Earlier recording", "Counted"], r.sources.map((s) => [s.platform, `${s.surface}: ${s.label}`, s.runs.map((x) => runRef(x)).join(", "), s.suiteVersion, s.recordedEarlier ? "yes" : "no", s.counted ? "yes" : `no: ${s.why}`])),
    "",
    ...r.notReachable.map((x) => `${x.platform}: not reachable by the suite, no run counted (${runRef(x.run)} in the results directory).`),
    "",
    "## Summary",
    "",
    table(["Independent platforms passing", "Groups", "of which registry"], [0, 1, 2, 3].filter((k) => k < 2 || n(k) > 0).map((k) => [String(k), String(n(k)), String(n(k, "registry"))])),
    "",
    "## By group",
    "",
    table(["Group", "Channel", "Vectors", "Independent passing", "Passing (platform, surface, counts)", "Ran with a difference", "Excluded, shown apart"],
      r.groups.map((g) => [g.group, g.channel, String(g.vectors), String(g.passing.length), g.passing.map(cellText).join("; "), g.differing.map(cellText).join("; "), g.excluded.map(cellText).join("; ")])),
    "",
  ];
  return lines.join("\n");
}

/** The short block for results/README.md. */
export function independentBlock(r: IndependentReport, base: string): string {
  const row = (ch: string): string[] => {
    const gs = r.groups.filter((g) => g.channel === ch);
    return [ch, String(gs.length), ...[0, 1, 2].map((k) => String(gs.filter((g) => (k === 2 ? g.passing.length >= 2 : g.passing.length === k)).length))];
  };
  const chans = [...new Set(r.groups.map((g) => g.channel))].sort();
  return [
    `Independent passing implementations per vector group (full table: [independent-implementations.md](${base}results/independent-implementations.md)). Counted: ${[...new Set(r.sources.filter((s) => s.counted).map((s) => s.platform))].join(", ")}. Not counted, shown apart: ${[...new Set(r.sources.filter((s) => !s.counted).map((s) => s.platform))].join(", ")}. Passing = some PASS and no FAIL or KNOWN-FAIL in the group on one of the platform's surfaces; recorded runs only. Not a ranking and not interoperation.`,
    "",
    table(["Channel", "Groups", "0 passing", "1 passing", "2 or more passing"], chans.map(row)),
  ].join("\n");
}
