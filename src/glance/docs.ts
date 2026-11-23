// SPDX-License-Identifier: Apache-2.0
// Renders the figure blocks that other pages carry (README.md, STATUS.md, results/README.md, platforms.md,
// results/platforms/*.md) and the run index (runs/INDEX.md in the results directory, src/results-dir.ts), all from the at-a-glance model. Every number
// in those pages comes from here; hand-written text around the blocks states no count.
// A block sits between `<!-- generated:NAME -->` and `<!-- /generated:NAME -->`; scripts/docs-blocks.ts fills it.
import { specPinLine } from "./spec-pin.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runsDir } from "../results-dir.ts";
import { MEASURES, classOf, headlineMeasure, loadCatalog, type ExperimentalCfg, loadRuns, ordered, recordedPlatform, refMd, runRef, pct, type Counts, type Model, type Subject, type SurfaceModel } from "./model.ts";
export { PLATFORM_ORDER, headlineMeasure, ordered } from "./model.ts";
import { nextItems } from "./render.ts";
import { CLARIFY_CLASSES, loadClarifyMeta } from "../vectors/clarify.ts";
import { loadProbes } from "../governance/probes.ts";
import { countedClassOf } from "../vectors/source.ts";

const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
const runLink = (_base: string, r: string): string => runRef(r);
const subjectName = (s: Subject): string => s.cfg.role === "self-check" ? `${s.cfg.name} (the suite checking itself, not a platform)` : s.cfg.name;
const MEASURE_LABEL: Record<string, string> = {
  core: "core, registry", "core-candidate": "core, candidate (advisory)", "core-proposed": "core, suite design, proposed (advisory)", plain: "single tasks (plain), registry",
  emit: "what it sends (emit and emit-more), registry", twol: "2L profiles, proposed (advisory)", witness: "witness server, registry",
};
const GATING = new Set(["core", "plain", "emit", "witness"]);
const reach = (c: Counts): string => `**${c.ran} of ${c.applicable}** (${pct(c.ran, c.applicable)}; ${c.total} recorded)`;
const verdicts = (c: Counts): string => `${c.pass} / ${c.clarify} / ${c.knownFail} / ${c.fail}`;
const skips = (c: Counts): string => `${c.notApplicable} / ${c.notReached} / ${c.versionMismatch}${c.unclassified > 0 ? ` (+${c.unclassified} unclassified)` : ""}`;
const surfaceRuns = (base: string, sf: SurfaceModel): string => sf.runs.map((r) => runLink(base, r)).join(", ") + (sf.recordedEarlier ? " (recorded earlier)" : "");

const READ_LINE = "Reach = checks run / checks that apply (the number recorded is beside it). Verdicts are PASS / CLARIFY / KNOWN-FAIL / FAIL (agree / unsettled in the specifications / recorded difference / unexplained). Tier 1. Each row is one surface measured alone: rows are never added together and are not a ranking.";

/** One row per measured surface, platform order: the short status table (README, STATUS). */
export function statusTable(model: Model, base: string): string {
  const rows: string[][] = [];
  for (const s of ordered(model)) {
    if (s.surfaces.length === 0 && s.cfg.notReachable !== undefined) {
      rows.push([subjectName(s), "-", "not reachable", "-", "**0**", "-", runLink(base, s.cfg.notReachable.run)]);
      continue;
    }
    for (const sf of s.surfaces) {
      const m = headlineMeasure(sf);
      if (m === undefined) continue;
      const c = sf.byMeasure[m]!;
      rows.push([subjectName(s), sf.cfg.label, model.config.how[sf.cfg.how]?.name ?? sf.cfg.how, MEASURE_LABEL[m]!, reach(c), verdicts(c), surfaceRuns(base, sf)]);
    }
  }
  return [READ_LINE, "", table(["Platform", "Surface", "How measured", "Part", "Reach", "Verdicts", "Run"], rows)].join("\n");
}

/** Full coverage: every surface and part, gating then advisory (results/README.md). */
export function coverageTables(model: Model, base: string): string {
  const head = ["Platform", "Surface", "Part", "Reach", "Verdicts", "Not applicable / not reached / version mismatch", "Run"];
  const part = (gating: boolean): string[][] => {
    const rows: string[][] = [];
    for (const s of ordered(model)) {
      if (s.surfaces.length === 0 && s.cfg.notReachable !== undefined) {
        if (gating) rows.push([subjectName(s), "-", "all families", "**0**", "not reachable", "-", runLink(base, s.cfg.notReachable.run)]);
        continue;
      }
      for (const sf of s.surfaces) for (const m of MEASURES) {
        if (GATING.has(m.id) !== gating) continue;
        const c = sf.byMeasure[m.id];
        if (c === undefined || c.total === 0) continue;
        rows.push([subjectName(s), sf.cfg.label, MEASURE_LABEL[m.id]!, reach(c), verdicts(c), skips(c), surfaceRuns(base, sf)]);
      }
    }
    return rows;
  };
  return [
    READ_LINE,
    "",
    "**Gating (registry): every check cites a Trust Tasks repository artifact.**",
    "",
    table(head, part(true)),
    "",
    "**Advisory, never gating and never in a headline total: `candidate` (behaviour with no Trust Tasks home yet; not an endorsement) and `proposed` (the 2L profiles, the suite's own proposal).**",
    "",
    table(head, part(false)),
  ].join("\n");
}

interface ScopeTask { task: string; groups?: string[]; since?: string }
interface TaskScope { source: string; namedTypesFile?: string; tasks: ScopeTask[] }

/** The trust tasks a platform uses, at task level (results/task-scope.json plus the named-types file it points at). */
export function scopeTasks(root: string, platform: string): ScopeTask[] {
  const p = join(root, "results", "task-scope.json");
  if (!existsSync(p)) return [];
  const s = (JSON.parse(readFileSync(p, "utf8")) as Record<string, TaskScope>)[platform];
  if (s === undefined) return [];
  const out = new Map<string, ScopeTask>(s.tasks.map((t) => [t.task, t]));
  if (s.namedTypesFile !== undefined) {
    for (const l of readFileSync(join(root, s.namedTypesFile), "utf8").split("\n")) {
      const slug = l.trim().replace(/\/\d+(\.\d+)*$/, "");
      if (slug !== "" && !out.has(slug)) out.set(slug, { task: slug });
    }
  }
  return [...out.values()].sort((a, b) => (a.task < b.task ? -1 : 1));
}

/**
 * Estimated coverage, two definitions (README.md, STATUS.md): (1) the share of the trust tasks keyring-wallet uses that the suite
 * has a check for, and that ran against each wallet surface; (2) the share of the suite's core and 2L checks that ran against each
 * surface measured on the core, at check level and at task level. Each row is one surface; rows are never added together.
 */
export function estimatedCoverage(root: string, model: Model, base: string): string {
  const catalog = [...loadCatalog(root).values()].filter((v) => !v.excludedFromRun && v.tier === 1);
  const matches = (t: ScopeTask, v: { slug: string; group: string }): boolean => v.slug === t.task || (t.groups ?? []).includes(v.group);
  const kwTasks = scopeTasks(root, "keyring-wallet");
  const withCheck = kwTasks.filter((t) => catalog.some((v) => matches(t, v)));
  // Core is the gating registry set; 2L the advisory proposed profile set, both sides (kinds 2l and 2l-emit, as the twol measure).
  const isCore = (v: { kind: string; channel: string }): boolean => v.kind === "core" && v.channel === "registry";
  const is2l = (v: { kind: string; channel: string }): boolean => (v.kind === "2l" || v.kind === "2l-emit") && v.channel === "proposed";
  const coreAll = catalog.filter(isCore).length;
  const twolAll = catalog.filter(is2l).length;
  const slugs = new Set(catalog.filter((v) => (isCore(v) || is2l(v)) && v.slug !== "").map((v) => v.slug));
  const kwRows: string[][] = [];
  const coreRows: string[][] = [];
  for (const s of ordered(model)) {
    if (s.surfaces.length === 0 && s.cfg.notReachable !== undefined) {
      coreRows.push([subjectName(s), "**0** (not reachable)", "-", "-", "-", runLink(base, s.cfg.notReachable.run)]);
      continue;
    }
    for (const sf of s.surfaces) {
      const ran = sf.results.filter((r) => r.status !== "SKIP");
      if (s.cfg.id === "keyring-wallet" && kwTasks.length > 0) {
        const hit = kwTasks.filter((t) => ran.some((r) => matches(t, r)));
        kwRows.push([sf.cfg.label, `${withCheck.length} of ${kwTasks.length} (**${pct(withCheck.length, kwTasks.length)}**)`, `${hit.length} of ${kwTasks.length} (**${pct(hit.length, kwTasks.length)}**)`, surfaceRuns(base, sf)]);
      }
      if (headlineMeasure(sf) !== "core") continue;
      const coreRan = ran.filter(isCore).length;
      const twolRan = ran.filter(is2l).length;
      const ranSlugs = new Set(ran.filter((r) => (isCore(r) || is2l(r)) && slugs.has(r.slug)).map((r) => r.slug));
      coreRows.push([
        `${subjectName(s)}: ${sf.cfg.label}`,
        `${coreRan} of ${coreAll} (${pct(coreRan, coreAll)})`,
        `${twolRan} of ${twolAll} (${pct(twolRan, twolAll)})`,
        `${coreRan + twolRan} of ${coreAll + twolAll} (**${pct(coreRan + twolRan, coreAll + twolAll)}**)`,
        `${ranSlugs.size} of ${slugs.size} (**${pct(ranSlugs.size, slugs.size)}**)`,
        surfaceRuns(base, sf),
      ]);
    }
  }
  return [
    "Estimates, Tier 1, from the same runs as the status table. Two definitions, side by side. A SKIP never counts as covered; each row is one surface measured alone, never added to another, and not a ranking.",
    "",
    `**(1) Share of the trust tasks keyring-wallet uses.** ${kwTasks.length} tasks (every version of a task counts once), read from the wallet's source ([results/task-scope.json](${base}results/task-scope.json); background in [results/kw-task-coverage.md](${base}results/kw-task-coverage.md)). "With a check in the suite" means the suite holds at least one vector for the task, in any family or channel; "checked on this surface" means at least one of those vectors ran against the surface (not SKIP).`,
    "",
    table(["keyring-wallet surface", "Tasks with a check in the suite", "Tasks checked on this surface", "Run"], kwRows),
    "",
    "**(2) Share of the suite's core and 2L checks**, for every surface measured on the core. Core is the gating registry set; 2L is the advisory `proposed` profile set (both what a platform answers and what it sends), so the combined columns estimate breadth and are not a gating figure. The task column counts the distinct tasks among the core and 2L checks with at least one check run on the surface. Every denominator is everything the suite holds, including checks that do not apply to the platform; reach against what applies is in the status table.",
    "",
    table(["Platform and surface", "Core checks run", "2L checks run", "Core + 2L checks run", "Core + 2L tasks checked", "Run"], coreRows),
  ].join("\n");
}

/** Vector families: what the catalog holds, by family and channel, from the manifests. */
export function familyTable(root: string): string {
  const cat = [...loadCatalog(root).values()];
  const fams: { label: string; dir: string; kinds: string[] }[] = [
    { label: "core", dir: "vectors", kinds: ["core"] },
    { label: "single tasks (plain)", dir: "vectors/plain", kinds: ["plain"] },
    { label: "what a platform sends (emit, emit-more)", dir: "vectors/emit, vectors/emit-more", kinds: ["emit"] },
    { label: "witness server", dir: "vectors/witness", kinds: ["witness"] },
    { label: "2L profiles", dir: "vectors/2l", kinds: ["2l", "2l-emit"] },
  ];
  const rows = fams.map((f) => {
    const vs = cat.filter((v) => f.kinds.includes(v.kind));
    const run = vs.filter((v) => !v.excludedFromRun);
    const ch = (c: string, t?: number): number => run.filter((v) => v.channel === c && (t === undefined || v.tier === t)).length;
    const chans = ["registry", "candidate", "proposed"].filter((c) => ch(c) > 0).map((c) => `${c} ${ch(c)} (Tier 1: ${ch(c, 1)})`).join("; ");
    return [f.label, f.dir.split(", ").map((d) => `\`${d}\``).join(", "), String(vs.length), String(vs.length - run.length), String(run.length), chans];
  });
  // Governance probes (docs/17): suite instruments run by `npm run governance`, counted as `probe`, never in a candidate figure.
  const probes = loadProbes(join(root, "vectors", "governance"));
  const probeCount = probes.filter((p) => countedClassOf(p) === "probe").length;
  if (probes.length > 0) rows.push(["governance probes (`npm run governance`)", "`vectors/governance`", String(probes.length), "0", String(probes.length), `probe ${probeCount} (channel candidate, counted apart)`]);
  return [
    "Excluded from run: vectors that cite a retired Trust Tasks specification, and retired vector ids (tombstones); they are loaded but never run. Only `registry` gates; `candidate` and `proposed` are advisory. `probe` marks a suite instrument (the governance probes): advisory, in channel `candidate`, and never counted in a `candidate` figure. Families are measured separately and never added together.",
    "",
    table(["Family", "Directory", "Loaded", "Excluded from run", "Run", "By channel"], rows),
  ].join("\n");
}

/** FAIL results (unexplained differences) in the current run folders, every channel and tier, per results file. */
export function failTable(root: string, model: Model, base: string): string {
  const current = new Set(model.subjects.flatMap((s) => s.surfaces.flatMap((sf) => sf.runs)));
  const counts = new Map<string, { n: number; ids: string[] }>();
  for (const b of loadRuns(model.results)) {
    if (!current.has(b.run)) continue;
    const f = b.results.filter((r) => r.status === "FAIL");
    if (f.length === 0) continue;
    const key = `${b.file}|${b.impl}|${b.tier}`;
    const e = counts.get(key) ?? { n: 0, ids: [] };
    e.n += f.length; e.ids.push(...f.map((r) => r.id)); counts.set(key, e);
  }
  if (counts.size === 0) return "No FAIL is recorded in the current run folders.";
  const rows = [...counts.entries()].sort().map(([k, e]) => {
    const [file, impl, tier] = k.split("|") as [string, string, string];
    const ids = [...new Set(e.ids)].sort();
    return [`\`${file}\``, impl, tier, String(e.n), ids.slice(0, 4).join(", ") + (ids.length > 4 ? ", ..." : "")];
  });
  return ["FAIL results recorded in the current run folders (any channel, either tier, every results file, including advisory and supplementary legs; paths are in the results directory):", "", table(["Results file", "Implementation", "Tier", "FAIL", "Vectors"], rows)].join("\n");
}

/** The ids of the coverage-family vectors (docs/22): advisory, kept out of every headline count, so an exception for one is not a headline recorded difference. */
function coverageVectorIds(root: string): Set<string> {
  const base = loadCatalog(root);
  return new Set([...loadCatalog(root, { coverage: true }).keys()].filter((id) => !base.has(id)));
}

/** Recorded differences (KNOWN-FAIL entries) per exceptions file. */
export function exceptionsLine(root: string, base: string): string {
  const dir = join(root, "exceptions");
  const parts: string[] = [];
  let total = 0;
  const coverage = coverageVectorIds(root);
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "quarantine.json" && x !== "expiry-policy.json").sort()) {
    // entries for advisory-channel vectors (the coverage families, docs/22) are in no headline count; the class table on results/vector-review.md counts every entry
    const n = ((JSON.parse(readFileSync(join(dir, f), "utf8")) as { exceptions?: { vector: string }[] }).exceptions ?? []).filter((e) => !coverage.has(e.vector)).length;
    total += n;
    parts.push(`[exceptions/${f}](${base}exceptions/${f}): ${n}`);
  }
  if (parts.length === 1) return `Recorded differences (KNOWN-FAIL entries, each with a reason, an owner and an expiry date): ${total} in all, in ${parts[0]!.replace(/: \d+$/, "")}.`;
  return `Recorded differences (KNOWN-FAIL entries, each with a reason, an owner and an expiry date): ${total} in all (${parts.join("; ")}).`;
}

/** One generated line for a not-gating experimental measurement of a surface (config `experimental`): its Tier 1 registry verdicts and where it differs from the surface's own folder. */
export function experimentalNote(results: string, base: string, e: ExperimentalCfg): string {
  // A measurement whose run.json records a platform for the implementation carries that platform's exceptions and gates it like any
  // other surface of the platform (src/runner/suite.ts): it must be a surface in the config, never a not-gating note.
  const platform = recordedPlatform(results, [e.folder], e.impl);
  if (platform !== undefined) throw new Error(`experimental ${e.folder}: implementation ${e.impl} declares platform ${platform} in its run.json, so it gates that platform; list it as a surface of the subject (results/at-a-glance.config.json), not as experimental`);
  type R = { id: string; status: string; channel?: string };
  const t1 = (folder: string): Map<string, string> => {
    const runs = JSON.parse(readFileSync(join(runsDir(results), folder, "results.json"), "utf8")) as { tier: number; results: R[] }[];
    return new Map(runs.filter((r) => r.tier === 1).flatMap((r) => r.results).filter((r) => (r.channel ?? "registry") === "registry").map((r) => [r.id, r.status]));
  };
  const exp = t1(e.folder);
  const ref = t1(e.compareWith);
  const n = (st: string): number => [...exp.values()].filter((x) => x === st).length;
  const kfAsFail = [...exp].filter(([id, st]) => st === "FAIL" && ref.get(id) === "KNOWN-FAIL").length;
  const other = [...exp].filter(([id, st]) => ref.get(id) !== st && !(st === "FAIL" && ref.get(id) === "KNOWN-FAIL")).map(([id, st]) => `${id} (${ref.get(id) ?? "not run"} there, ${st} here)`).sort();
  return `**Not gating, experimental: ${e.label}** (implementation \`${e.impl}\`, run folder ${runRef(e.folder)}). In no headline total and not comparable with the rows above: ${e.why} Tier 1 registry, PASS / CLARIFY / KNOWN-FAIL / FAIL: ${n("PASS")} / ${n("CLARIFY")} / ${n("KNOWN-FAIL")} / ${n("FAIL")}; ${kfAsFail} of the FAILs are KNOWN-FAIL in [${e.compareWith}](${base}results/runs/${e.compareWith}/). Other vectors whose verdict differs from that folder: ${other.length === 0 ? "none" : other.join(", ")}.`;
}

/** results/vector-review.md totals: entries per implementation key and review class, from exceptions/exceptions.json. */
export function exceptionClasses(root: string, base: string): string {
  const es = (JSON.parse(readFileSync(join(root, "exceptions", "exceptions.json"), "utf8")) as { exceptions: { impl: string; vector: string; reason: string; class?: string; acknowledged?: unknown }[] }).exceptions;
  const coverage = coverageVectorIds(root);
  const advisoryN = es.filter((e) => coverage.has(e.vector)).length;
  const classes = ["A", "B", "C", "D"];
  const per = new Map<string, Record<string, number>>();
  for (const e of es) {
    const c = classOf(e) || "none";
    const r = per.get(e.impl) ?? {};
    r[c] = (r[c] ?? 0) + 1;
    if (e.acknowledged == null) r.unack = (r.unack ?? 0) + 1;
    per.set(e.impl, r);
  }
  const row = (name: string, r: Record<string, number>): string[] => [name, String([...classes, "none"].reduce((a, c) => a + (r[c] ?? 0), 0)), ...classes.map((c) => String(r[c] ?? 0)), String(r.none ?? 0), String(r.unack ?? 0)];
  const total: Record<string, number> = {};
  for (const r of per.values()) for (const [k, n] of Object.entries(r)) total[k] = (total[k] ?? 0) + n;
  const rows = [...per.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, r]) => row(`\`${k}\``, r));
  return [
    `Entries in [exceptions/exceptions.json](${base}exceptions/exceptions.json) by implementation key and class. The class is the entry's \`class\` field (or, for an entry without one, the "class X" in its reason); "Not classed" entries state no class yet and are not guessed here. Different keys are different measured surfaces (the two VTI keys are two surfaces of one VTI) and are never added together as one platform's figure; the "All entries" row counts lines in the file. "Unacknowledged" counts entries whose \`acknowledged\` field is null: the implementer has not yet agreed that the entry describes their platform ([docs/challenges.md section 7](${base}docs/challenges.md#7-owner-acknowledgement-of-an-exception)).`,
    ...(advisoryN === 0 ? [] : ["", `${advisoryN} of them ${advisoryN === 1 ? "is" : "are"} for advisory (proposed-channel coverage) vectors; the headline count of recorded differences on the status pages leaves them out.`]),
    "",
    table(["Implementation key", "Entries", "A", "B", "C", "D", "Not classed", "Unacknowledged"], [...rows, row("All entries", total)]),
  ].join("\n");
}

/** results/README.md: emit and emit-more vectors the reference oracle SKIPs in its current run, so no oracle has validated them. */
export function oracleGaps(root: string, model: Model, base: string): string {
  const sf = model.subjects.find((s) => s.cfg.role === "self-check")?.surfaces[0];
  if (sf === undefined) return "No reference run is configured.";
  const rows: string[][] = [];
  const totals: string[] = [];
  for (const run of sf.runs) {
    for (const folder of ["emit", "emit-more"]) {
      const file = join(runsDir(model.results), run, folder, "results.json");
      if (!existsSync(file)) continue;
      const blocks = JSON.parse(readFileSync(file, "utf8")) as { impl: string; tier: number; results: { id: string; group: string; status: string }[] }[];
      const b = blocks.find((x) => (x.impl === sf.cfg.impl || (sf.cfg.aliases ?? []).includes(x.impl)) && x.tier === 1);
      if (b === undefined) continue;
      const skipped = b.results.filter((r) => r.status === "SKIP");
      totals.push(`${folder}: ${skipped.length} of ${b.results.length} vectors run`);
      const groups = new Map<string, string[]>();
      for (const r of skipped) groups.set(r.group, [...(groups.get(r.group) ?? []), r.id]);
      const link = runRef(run, `${folder}/results.json`);
      for (const [g, ids] of groups) rows.push([`\`vectors/${folder}\``, g, String(ids.length), ids.join(", "), link]);
    }
  }
  return [
    `Not validated by the oracle: the vectors below are SKIPped by the reference adapter (type not emitted), so no oracle has checked that the vector itself is right; only platform runs have exercised them. Tier 1, reference adapter, ${totals.join("; ")}. Their platform results stand as recorded; this list changes no count.`,
    "",
    table(["Folder", "Group", "Vectors", "Ids", "Reference results"], rows),
  ].join("\n");
}

/** As-of line for STATUS.md. */
export function asOf(model: Model): string {
  const pin = specPinLine(model.specPin);
  return `As of ${model.newestDate} (newest recorded run); generated from run set \`${model.runSet}\` (run records are kept outside this repository; [docs/04 section 21](docs/04-suite-design.md#21-where-run-records-live-built)). Tier 1. Advisory channels (\`candidate\`, \`proposed\`) are never in these rows' headline part; see [results/AT-A-GLANCE.md](results/AT-A-GLANCE.md) and [results/README.md](results/README.md).` + (pin === "" ? "" : `\n\n${pin}`);
}

/** platforms.md: current run folders per surface (links only, no figures). */
export function latestRuns(model: Model): string {
  const rows: string[][] = [];
  for (const s of ordered(model)) {
    const page = s.cfg.role === "self-check" ? "-" : `[results/platforms/${s.cfg.id}.md](results/platforms/${s.cfg.id}.md)`;
    if (s.surfaces.length === 0) rows.push([subjectName(s), "-", s.cfg.notReachable ? runLink("", s.cfg.notReachable.run) : "-", page]);
    for (const sf of s.surfaces) rows.push([subjectName(s), sf.cfg.label, surfaceRuns("", sf), page]);
  }
  return table(["Platform", "Surface", "Current run", "Platform page"], rows);
}

// ---------- per-platform page ----------

interface DraftIssue { run: string; file: string; title: string }
function draftIssues(results: string, runs: string[]): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const run of runs) {
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const n of readdirSync(dir).sort()) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!n.endsWith(".md") || n === "README.md") continue;
        const title = /^#\s+(.*)$/m.exec(readFileSync(p, "utf8"))?.[1]?.trim() ?? n;
        out.push({ run, file: p.slice(results.length + 1).split("\\").join("/"), title });
      }
    };
    walk(join(runsDir(results), run, "draft-issues"));
  }
  return out;
}

/**
 * Latest versions only (decision D245): the registry checks of a surface split by the version they name. A check that ran at the latest version of its task
 * is the target; one at an older version is non-focus (kept and runnable, outside the latest-version figures); a SKIP of an older version is reach class `scope`
 * (outside the target), a SKIP at the latest version is `platform` reach (or a suite limit), as the reasons above say.
 */
export function latestLine(sf: SurfaceModel, focus: Model["focus"]): string {
  const reg = sf.results.filter((r) => r.channel === "registry" && r.slug !== "");
  const cls = (r: { slug: string; version: string }): string => focus[`${r.slug}/${r.version}`] ?? "none";
  const ranOf = (r: { status: string }): boolean => r.status === "PASS" || r.status === "CLARIFY" || r.status === "KNOWN-FAIL" || r.status === "FAIL";
  const n = (f: (r: (typeof reg)[number]) => boolean): number => reg.filter(f).length;
  const ranFocus = n((r) => ranOf(r) && cls(r) === "focus"), ranOlder = n((r) => ranOf(r) && cls(r) === "older");
  const skipFocus = n((r) => r.status === "SKIP" && cls(r) === "focus"), skipOlder = n((r) => r.status === "SKIP" && cls(r) === "older"), skipRetired = n((r) => r.status === "SKIP" && cls(r) === "retired");
  return `Latest versions only (decision D245, the target is the latest version of each task): among the registry checks that name a task version, ${ranFocus} ran at the latest version and ${skipFocus} were skipped at it (reach class platform, or a suite limit); ${ranOlder} ran at an older version (non-focus, outside the latest-version figures) and ${skipOlder} were skipped at one (reach class scope); ${skipRetired} were skipped at a task whose latest version is retired (out of the target, scope).`;
}

export function platformBlock(root: string, model: Model, id: string): string {
  const s = model.subjects.find((x) => x.cfg.id === id);
  if (s === undefined) throw new Error(`unknown subject ${id}`);
  const base = "../../";
  const out: string[] = [];
  out.push("## What we could test", "");
  if (s.surfaces.length === 0) {
    out.push(`Nothing could be run. ${s.cfg.notReachable?.text ?? ""} Run: ${s.cfg.notReachable ? runLink(base, s.cfg.notReachable.run) : "none"}.`, "");
  }
  for (const sf of s.surfaces) {
    const how = model.config.how[sf.cfg.how]!;
    out.push(`**${sf.cfg.label}.** How measured: ${how.name}. ${how.plain} Run folders: ${sf.runs.map((r) => runLink(base, r)).join(", ")}.${sf.recordedEarlier ? ` Recorded earlier: ${sf.earlierWhy.join("; ")}.` : ""}`, "");
    const rows: string[][] = [];
    for (const m of MEASURES) {
      const c = sf.byMeasure[m.id];
      if (c === undefined || c.total === 0) continue;
      rows.push([MEASURE_LABEL[m.id]!, GATING.has(m.id) ? "gating" : "advisory", reach(c), verdicts(c), skips(c)]);
    }
    out.push(table(["Part", "Channel", "Reach", "Verdicts", "Not applicable / not reached / version mismatch"], rows), "");
    out.push(`Task types among the recorded checks: ${sf.types.total}; ${sf.types.ran} had at least one check run, ${sf.types.notApplicable} do not apply, ${sf.types.other} are not yet tested.`, "");
    out.push(latestLine(sf, model.focus), "");
    if (sf.excludedByTier > 0) out.push(`Excluded by tier: ${sf.excludedByTier} vectors outside the headline Tier 1 (Tier 2 vectors, measured by the Tier 2 runs) are not run there; they are not a SKIP and are in none of the figures above.`, "");
    for (const e of sf.cfg.experimental ?? []) out.push(experimentalNote(model.results, base, e), "");
  }
  const vr = model.vtiRoles;
  if (vr !== null && id === "vti") {
    const pl = id;
    const by = (sid: string) => vr.surfaces.find((x) => x.id === sid);
    const part = (sid: string): string => { const x = by(sid); return x === undefined ? "" : x.ran[pl] === null || x.ran[pl] === undefined ? `${x.id}: ${x.withRole} slugs with a role, no runs` : `${x.id}: ${x.ran[pl]} of ${x.withRole} slugs with a role had a vector executed`; };
    out.push(`**Reach by VTI role (decisions D420 and D421).** VTI is several surfaces, so each is read against the slugs where its own source gives it a role, not against all ${vr.focusSlugs} target slugs: ${vr.surfaces.map((x) => `${x.label}: ${x.roles["serves"] ?? 0} serves, ${x.roles["emits"] ?? 0} emits, ${x.roles["older-version"] ?? 0} only at a lower version, ${x.roles["named-only"] ?? 0} named in code only (shown as not yet built), ${x.roles["not-built"] ?? 0} not built, ${x.roles["not-involved"] ?? 0} not involved`).join("; ")}. In the recorded runs: ${["vta", "vtc", "client"].map(part).join("; ")}. The role comes from VTI main ${vr.inputs.vti}: handler registrations for the services, and the sending side of the SDK, CLI, community client, mobile core and mcp servers for the clients (comments stripped, test code removed, constants resolved; direction by call role). A role where the source has no code is a prefix rule with a stated reason, so it is judgement. The per-slug table with the code evidence is [coverage/vti-participation.md](../coverage/vti-participation.md).`, "");
  }
  const kr = model.kwReach;
  const krp = kr?.platforms.find((x) => x.id === id);
  if (kr && krp) {
    out.push(`**Reach by wallet role (decision D301).** A wallet is a client, so its reach is read against the ${kr.withRole} of the ${kr.focusSlugs} target slugs where its source gives it a role (${kr.roles["serves"] ?? 0} serves, ${kr.roles["emits"] ?? 0} emits, ${kr.roles["older-version"] ?? 0} only at a lower version, ${kr.roles["names-only"] ?? 0} names only): in the recorded runs ${krp.covered} of them had a vector executed and ${krp.platform} were skipped (reach class platform); ${kr.notBuilt} slugs are reach class not-built and ${kr.notInvolved} are not-involved, neither counted as a skip. ${krp.ceremonySlugs} slugs appear in a ceremony row run with the wallet (overlay, never a conformance count). The per-slug table with the code evidence is [coverage/kw-participation.md](../coverage/kw-participation.md).`, "");
  }
  out.push("## Top findings", "");
  out.push("Each finding is a recorded difference (KNOWN-FAIL) with a reason in `exceptions/`, a recorded finding (a FAIL whose cause is written down in `results/findings.json` but which is not excused, so it stays FAIL), or an unexplained FAIL. Class (from [results/vector-review.md](../vector-review.md)): A differs from the specification text; B the check reads more than the text says; C the text is open; D a limit of the test setup, not of the platform.", "");
  let any = false;
  for (const sf of s.surfaces) {
    if (sf.findings.length === 0 && sf.unexplained.length === 0 && sf.recorded.length === 0) continue;
    any = true;
    const rows: string[][] = sf.unexplained.map((v) => ["Unexplained difference (FAIL); not yet classified", "-", v, runLink(base, sf.newestRun)]);
    for (const f of sf.recorded) rows.push([`Recorded finding, not excused (still FAIL): ${f.explanation}`, f.cls === "" ? "not classed" : f.cls, f.vector, refMd(f.link, f.linkLabel, "../")]);
    for (const f of sf.findings) {
      rows.push([f.title, f.cls === "" ? f.category : f.cls, `${f.vectors.length}: ${f.vectors.slice(0, 6).join(", ")}${f.vectors.length > 6 ? ", ..." : ""}`, refMd(f.link, f.linkLabel, "../")]);
    }
    out.push(`**${sf.cfg.label}**`, "", table(["Finding", "Class", "Checks", "Detail"], rows), "");
  }
  if (!any) out.push("None recorded.", "");
  const issues = draftIssues(model.results, s.cfg.draftIssueRuns ?? []);
  out.push("## Draft issues (DRAFT, NOT FILED)", "");
  if (issues.length === 0) out.push("None drafted.", "");
  else out.push(...issues.map((i) => `- ${i.title}: \`${i.file}\` in the results directory (run ${i.run}; DRAFT, NOT FILED)`), "");
  out.push("## What is next", "");
  out.push(...nextItems(s).map((x) => `- ${x}`));
  return out.join("\n");
}

// ---------- run index ----------

export interface RunIndex { current: { subject: string; surface: string; run: string }[]; milestones: { label: string; runs: string[] }[]; superseded: { run: string; by: string[] }[]; other: string[] }

export function runIndex(root: string, model: Model): RunIndex {
  const named = new Set<string>([...(model.config.supportingRuns ?? []), ...Object.keys(model.config.supersededBy ?? {}), ...model.subjects.flatMap((s) => [...(s.cfg.notReachable === undefined ? [] : [s.cfg.notReachable.run]), ...(s.cfg.draftIssueRuns ?? []), ...s.surfaces.flatMap((sf) => sf.runs)])]);
  const dirs = readdirSync(runsDir(model.results)).filter((d) => statSync(join(runsDir(model.results), d)).isDirectory() && /^\d{4}-/.test(d) && named.has(d)).sort();
  const impls = new Map<string, Set<string>>();
  for (const b of loadRuns(model.results)) { const s = impls.get(b.run) ?? new Set(); s.add(b.impl); impls.set(b.run, s); }
  const current: RunIndex["current"] = [];
  const currentSet = new Set<string>();
  const byImpl = new Map<string, string[]>();
  for (const s of ordered(model)) {
    if (s.cfg.notReachable !== undefined) { current.push({ subject: s.cfg.name, surface: "-", run: s.cfg.notReachable.run }); currentSet.add(s.cfg.notReachable.run); }
    for (const sf of s.surfaces) for (const r of sf.runs) {
      current.push({ subject: s.cfg.name, surface: sf.cfg.label, run: r }); currentSet.add(r);
      for (const i of [sf.cfg.impl, ...(sf.cfg.aliases ?? [])]) byImpl.set(i, [...(byImpl.get(i) ?? []), r]);
    }
  }
  const milestones = (model.config.milestones ?? []).map((m) => ({ label: m.label, runs: dirs.filter((d) => d.startsWith(m.prefix)) }));
  const superseded: RunIndex["superseded"] = [];
  const other: string[] = [];
  for (const d of dirs) {
    if (currentSet.has(d)) continue;
    const o = model.config.supersededBy?.[d];
    const by = Array.isArray(o) ? o : [...new Set([...(impls.get(d) ?? [])].flatMap((i) => byImpl.get(i) ?? []))].sort();
    if (by.length > 0) superseded.push({ run: d, by }); else other.push(d);
  }
  return { current, milestones, superseded, other };
}

export function renderRunIndex(idx: RunIndex): string {
  const l = (r: string): string => `\`${r}\``;
  return [
    "# Run index",
    "",
    "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.",
    "",
    "Generated by `npm run regen` (scripts/docs-blocks.ts) from `results/at-a-glance.config.json` and the run folders; do not edit by hand. A run folder is current when the at-a-glance configuration reads it for a surface; a folder with results for an implementation that has a current folder is superseded by it; the rest are supporting records (probes, oracles, cross-checks).",
    "",
    "Run records are not published in this repository: each run below is named, not linked (run record not published).",
    "",
    "## Current run per surface",
    "",
    table(["Platform", "Surface", "Run"], idx.current.map((c) => [c.subject, c.surface, l(c.run)])),
    "",
    "## Milestones",
    "",
    ...idx.milestones.flatMap((m) => [`- **${m.label}**: ${m.runs.map(l).join(", ")}`]),
    "",
    "## Superseded",
    "",
    "Kept as dated records; each carries a banner naming the run that supersedes it.",
    "",
    table(["Run", "Superseded by"], idx.superseded.map((s) => [l(s.run), s.by.map(l).join(", ")])),
    "",
    "## Supporting records",
    "",
    "No results for a measured surface's implementation (probes, oracles, cross-checks, experiments); not superseded, not a headline.",
    "",
    ...idx.other.map((o) => `- ${l(o)}`),
    "",
  ].join("\n");
}

export const supersededBanner = (by: string[]): string =>
  `> **Superseded** by ${by.map((r) => `[${r}](../${r}/)`).join(", ")}. Kept as a dated record.`;

/** results/README.md: CLARIFY by class (docs/04 section 18.10), for the vectors and for each surface's current Tier 1 results. */
export function clarifyClasses(root: string, model: Model, base: string): string {
  const meta = loadClarifyMeta(root).vectors;
  const cls = (id: string): string => meta[id]?.class ?? "none";
  const cols = [...CLARIFY_CLASSES, "none"];
  const count = (ids: string[]): string[] => { const n: Record<string, number> = {}; for (const id of ids) n[cls(id)] = (n[cls(id)] ?? 0) + 1; return [String(ids.length), ...cols.map((c) => String(n[c] ?? 0))]; };
  const ages = Object.values(meta).map((m) => m.since);
  const rows: string[][] = [["Vectors (current files)", "", ...count(Object.keys(meta))]];
  for (const s of model.subjects) for (const sf of s.surfaces) rows.push([subjectName(s), sf.cfg.label, ...count(sf.results.filter((r) => r.status === "CLARIFY").map((r) => r.id))]);
  return [
    `CLARIFY by class ([docs/04 section 18.10](${base}docs/04-suite-design.md#1810-clarify-classes-age-and-task-force-questions); classes from [vectors-src/clarify-classes.json](${base}vectors-src/clarify-classes.json)): spec-silent, the text does not decide; spec-inconsistent, two texts disagree; vector-overreads, the vector expects more than the text says (a candidate for rewriting or retiring); unclassified, the reason does not support a class. "Not CLARIFY now" counts recorded CLARIFY results whose vector is no longer CLARIFY. CLARIFY never gates. Oldest CLARIFY age: ${ages.filter((a) => /^\d+\./.test(a)).length} vectors since ${[...new Set(ages.filter((a) => /^\d+\./.test(a)))].join(", ") || "none"} (CLARIFY when the suite was first committed), the rest since ${[...new Set(ages.filter((a) => /^\d{4}-/.test(a)))].sort().join(", ") || "none"}. Linked task-force questions: ${Object.values(meta).filter((m) => m.questions.length > 0).length}.`,
    "",
    table(["Platform", "Surface", "CLARIFY", ...CLARIFY_CLASSES, "Not CLARIFY now"], rows),
  ].join("\n");
}
