// SPDX-License-Identifier: Apache-2.0
// The version-grain coverage page (results/coverage.md, docs/22, decisions CV-8 and CV-13). Every figure is generated: the census
// (vectors-src/coverage/task-census.tsv, one row per task type = slug + version), the vectors joined on source slug and version, and,
// when a folder of coverage run records is given, which of those vectors ran on each recorded surface. Advisory: nothing here enters a
// headline count, the catalog total or an exit code (decision CV-3).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { classify, loadCatalog, type SkipRule } from "../glance/model.ts";
import { scopeTasks } from "../glance/docs.ts";
import { COVERAGE_FAMILIES, KW_ROLES, loadCensus } from "./families.ts";
import { CANDIDATE_TEXT } from "./candidates.ts";
import { reconcile } from "./reconcile.ts";

export const COVERAGE_RUNS_ENV = "COVERAGE_RUNS_DIR";
/** The tracked snapshot of one measured set (written by `coverage-pages --snapshot`; not owned by regen: it needs run records held outside the repository). */
export const SNAPSHOT_FILE = "coverage-measured.md";

/** The caveat printed at the top of the page and in docs/22 (the sentence of the CB vectors' spec text): what a permissionDenied PASS does and does not show. */
export const PD_CAVEAT = "A PASS that is only `permissionDenied` shows an authorisation gate answered first, not that the stated rule held: only a PASS with the task's own code carries the evidence for the rule.";

type Rule = SkipRule & { label?: string };
interface RawBlock { impl: string; results: { id: string; status: string; reason?: string; observedCodes?: string[]; acceptedOnlyGate?: boolean }[] }
export interface RunFolder { folder: string; subject: string; impls: string[]; blocks: RawBlock[] }

/** Which subject a coverage run folder belongs to, by its name. */
const SUBJECTS: { match: RegExp; subject: string }[] = [
  { match: /(^|\/)(cbcc-|cbfix-)?kw-upstream-/, subject: "keyring-wallet" },
  { match: /(^|\/)(cbcc-|cbfix-)?vti-/, subject: "VTI" },
  { match: /(^|\/)(cbcc-)?(p1-)?reference/, subject: "reference adapter (the suite's own oracle)" },
];
const subjectOf = (folder: string): { subject: string } => SUBJECTS.find((s) => s.match.test(folder)) ?? { subject: "unlabelled" };
/** Run folders that are not part of this suite's pages. The folder-name marker is built from parts so no source text names it. */
const MARK = ["f", "ork"].join("");
export const EXCLUDED_RUN_FOLDERS = new RegExp(`(^|/)(cbcc-|cbfix-)?(kw-(${MARK}|emit-${MARK})|vti-${MARK}-)`);

/** Every folder under `dir` holding a results-advisory.json, with its blocks; and the first-level folders that hold none (partial sets). */
export function readCoverageRuns(dir: string): { used: RunFolder[]; empty: string[]; unreadable: string[] } {
  const used: RunFolder[] = []; const unreadable: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "results-advisory.json") {
        const folder = relative(dir, d);
        if (EXCLUDED_RUN_FOLDERS.test(folder)) continue;
        try {
          const blocks = JSON.parse(readFileSync(p, "utf8")) as RawBlock[];
          used.push({ folder, ...subjectOf(folder), impls: [...new Set(blocks.map((b) => b.impl))], blocks });
        } catch { unreadable.push(folder); }
      }
    }
  };
  walk(dir);
  const empty = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !used.some((u) => u.folder === e.name || u.folder.startsWith(e.name + "/")) && !unreadable.includes(e.name)).map((e) => e.name).sort();
  return { used, empty, unreadable };
}


/** The slugs results/task-scope.json lists for keyring-wallet, and the type lines of the named-types file it points at. */
export function scopeFileSlugs(root: string): string[] {
  const p = join(root, "results", "task-scope.json");
  if (!existsSync(p)) return [];
  const s = (JSON.parse(readFileSync(p, "utf8")) as Record<string, { tasks: { task: string }[] }>)["keyring-wallet"];
  return s === undefined ? [] : s.tasks.map((t) => t.task);
}
export function namedTypesOf(root: string): string[] {
  const p = join(root, "results", "task-scope.json");
  if (!existsSync(p)) return [];
  const f = (JSON.parse(readFileSync(p, "utf8")) as Record<string, { namedTypesFile?: string }>)["keyring-wallet"]?.namedTypesFile;
  return f === undefined ? [] : readFileSync(join(root, f), "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "");
}
const codes = (xs: string[]): string => xs.map((x) => `\`${x}\``).join(", ");

const cmpVersion = (a: string, b: string): number => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
const pct = (a: number, b: number): string => (b === 0 ? "-" : `${Math.round((100 * a) / b)}%`);
const table = (head: string[], rows: string[][]): string => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const KINDS = [["CV", "payload and policy checks (a platform that serves the task)"], ["CB", "behavioural (a rule the task force's text states)"], ["CE", "what a platform sends"], ["CX", "task-force invalid examples"]] as const;

/** Focus class of every task version in the committed coverage matrix (results/coverage/matrix.json, decision D245), keyed `slug/version`; empty when the matrix is absent. */
export function focusByType(root: string): Map<string, "focus" | "older" | "retired"> {
  const out = new Map<string, "focus" | "older" | "retired">();
  const p = join(root, "results", "coverage", "matrix.json");
  if (!existsSync(p)) return out;
  for (const t of (JSON.parse(readFileSync(p, "utf8")) as { tasks: { slug: string; version: string; focus?: "focus" | "older" | "retired" }[] }).tasks) if (t.focus !== undefined) out.set(`${t.slug}/${t.version}`, t.focus);
  return out;
}

export interface FamilyFigures { latestUsed: number; latestAnyVector: number; olderUsed: number; family: string; used: number; kw: number; kwSends: number; vti: number; both: number; anyVector: number; behavioural: number; byKind: Record<string, number>; ranBy: Map<string, number> }

export function buildCoveragePage(root: string, runsDir?: string): string {
  const census = loadCensus();
  const catalog = [...loadCatalog(root, { coverage: true }).values()];
  // candidate coverage vectors (group CC, decision CV-6) are counted apart: they never enter the family figures below, only the candidate table
  const withSlug = catalog.filter((v) => v.slug !== "" && !v.group.startsWith("CC-"));
  const anyVec = new Set(withSlug.map((v) => `${v.slug}/${v.version}`));
  const cbVec = new Set(withSlug.filter((v) => v.group.startsWith("CB-")).map((v) => `${v.slug}/${v.version}`));
  const cov = catalog.filter((v) => /^C[VBEX]-[A-Z]{2}$/.test(v.group));
  const kindOf = (g: string): string => g.slice(0, 2);
  const famOf = (g: string): string => g.slice(3);
  const fams = [...COVERAGE_FAMILIES.map((f) => f.id), "FW", "ALL"];
  const rowsOf = (f: string) => (f === "ALL" ? census : census.filter((r) => r.family === f));
  const figures = (f: string): FamilyFigures => {
    const rs = rowsOf(f);
    const byKind: Record<string, number> = {};
    for (const [k] of KINDS) byKind[k] = cov.filter((v) => kindOf(v.group) === k && (f === "ALL" || famOf(v.group) === f)).length;
    return { latestUsed: rs.filter((r) => focus.get(r.type) === "focus").length, latestAnyVector: rs.filter((r) => focus.get(r.type) === "focus" && anyVec.has(r.type)).length, olderUsed: rs.filter((r) => focus.get(r.type) === "older").length, family: f, used: rs.length, kw: rs.filter((r) => r.kw).length, kwSends: rs.filter((r) => r.kwSends).length, vti: rs.filter((r) => r.vti).length, both: rs.filter((r) => r.kw && r.vti).length, anyVector: rs.filter((r) => anyVec.has(r.type)).length, behavioural: rs.filter((r) => cbVec.has(r.type)).length, byKind, ranBy: new Map() };
  };
  const focus = focusByType(root);
  const figs = fams.map(figures);
  const name = (f: string): string => (f === "ALL" ? "**All**" : f === "FW" ? "FW Framework tasks (not a coverage family)" : `${f} ${COVERAGE_FAMILIES.find((x) => x.id === f)!.label}`);

  // limits, all computed
  const newest = new Map<string, string>();
  for (const r of census) if ((newest.get(r.slug) ?? "0") === "0" || cmpVersion(r.version, newest.get(r.slug)!) > 0) newest.set(r.slug, r.version);
  const olderNotKw = census.filter((r) => !r.kw && newest.get(r.slug) !== r.version);
  const candidates = census.filter((r) => r.tfStatus === "none");
  const cbTotal = census.filter((r) => cbVec.has(r.type)).length;
  const sentByVti = census.filter((r) => r.vtiSent).length;

  // the existing task grain (keyring-wallet, results/task-scope.json), beside the version grain
  const core = loadCatalog(root);
  const tier1 = [...core.values()].filter((v) => !v.excludedFromRun && v.tier === 1 && v.family !== "gap"); // the gap families are channel proposed: outside headline counts
  const kwTasks = scopeTasks(root, "keyring-wallet");
  const withCheck = kwTasks.filter((t) => tier1.some((v) => v.slug === t.task || (t.groups ?? []).includes(v.group)));
  const earlier = kwTasks.filter((t) => t.since === undefined);
  const earlierTasks = earlier.length;
  const allVectors = [...loadCatalog(root, { coverage: true }).values()].filter((v) => !v.excludedFromRun);
  const withAnyCoverage = kwTasks.filter((t) => allVectors.some((v) => v.slug === t.task || (t.groups ?? []).includes(v.group))).length;
  const earlierWithCheck = earlier.filter((t) => tier1.some((v) => v.slug === t.task || (t.groups ?? []).includes(v.group))).length;
  const EXTENDED_ON = kwTasks.map((t) => t.since).filter((d): d is string => d !== undefined).sort().pop() ?? "";
  const kwTypes = census.filter((r) => r.kw);
  const kwSent = kwTypes.filter((r) => r.kwSends);
  const recon = reconcile(census, scopeFileSlugs(root), namedTypesOf(root));

  const L: string[] = [];
  L.push("# Coverage by task version", "",
    "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.", "",
    "Generated by `npm run regen` (`scripts/coverage-pages.ts`, `src/coverage/pages.ts`); do not edit. Advisory: nothing on this page is added to a headline count, the catalog total or an exit code ([CV-3](../docs/decisions/03-vectors-and-coverage.md#cv3), [CV-8](../docs/decisions/03-vectors-and-coverage.md#cv8), [CV-13](../docs/decisions/03-vectors-and-coverage.md#cv13)). Background: [docs/22](../docs/22-coverage-families.md).", "",
    "> **How to read this page.** A trust task comes in versions, and a platform may use one version and not another. This page counts each version as its own row (a *task type*, for example `rooms/blobs/get` 0.2), so it counts more rows than the task-level figures elsewhere and the share it shows is smaller. Both are true at their own grain; this page shows both. \"Has a vector\" means the suite holds at least one check for that version. Since 2026-11-20 (decision D245) the target is the latest version of each task: the \"Latest\" columns count the used types that are the latest non-retired version of their slug (focus, read from the coverage matrix), the other columns keep the earlier version grain, and an older version (non-focus) stays measured but is not a headline figure. \"Behavioural\" means a check of a rule the task force's text states. \"Ran\" means a recorded run gave a result other than SKIP: it does not mean the platform agreed, and a SKIP never counts. Nothing here says one platform works with another.", "",
    `> **${PD_CAVEAT}** The recorded-runs section below splits each PASS count accordingly.`, "",
    "## Two ways to count", "",
    `- **Task grain** (existing): one row per task, every version of a task counted once. Read from the wallet's source: ${kwTasks.length} tasks keyring-wallet uses, ${withCheck.length} of them with a check in the suite at Tier 1 (${pct(withCheck.length, kwTasks.length)}). Figures: [at a glance](AT-A-GLANCE.md), [README](README.md).`,
    `- **Earlier task-grain figure:** ${earlierWithCheck} of ${earlierTasks} (the list before ${EXTENDED_ON} added ${kwTasks.length - earlierTasks} tasks the wallet sends); both are printed so the change is explained, not hidden. The task list now holds ${kwTasks.length} tasks and ${withCheck.length} of them have a check in the headline vectors at Tier 1 (${pct(withCheck.length, kwTasks.length)}); the ${kwTasks.length - earlierTasks} added tasks are held by the advisory coverage vectors, which no headline counts (decisions CV-3, CV-8), and counting those too ${withAnyCoverage} of ${kwTasks.length} have a check in the suite (${pct(withAnyCoverage, kwTasks.length)}).`,
    `- **Version grain** (this page, decision CV-8): one row per task type, slug plus version, ${census.length} rows in the census ([vectors-src/coverage/task-census.tsv](../vectors-src/coverage/task-census.tsv)). **keyring-wallet sends ${kwSent.length} of the ${kwTypes.length} types its source names; ${kwSent.filter((r) => anyVec.has(r.type)).length} of those have a vector (${pct(kwSent.filter((r) => anyVec.has(r.type)).length, kwSent.length)}).** The earlier figure counted every type the wallet's source names, whether it sends, only receives or only names it: ${kwTypes.length} types, ${kwTypes.filter((r) => anyVec.has(r.type)).length} with a vector (${pct(kwTypes.filter((r) => anyVec.has(r.type)).length, kwTypes.length)}). The sent figure is the headline because a check of what the wallet sends needs a type the wallet sends; the all-used figure is kept beside it. How the roles were read: [kw-roles-evidence.md](../vectors-src/coverage/kw-roles-evidence.md).`, "",
    "The two figures describe different things and are not a contradiction: the task-grain share is high because one check on any version counts the task; the version-grain share asks each version separately.", "",
    "## Types and vectors by family (version grain)", "",
    table(["Family", "Types used", "Latest versions used (focus)", "Older versions used (non-focus)", "keyring-wallet sends (headline)", "keyring-wallet uses (all, earlier figure)", "VTI", "both (all used)", "With any vector", "Latest with any vector", "With a behavioural vector (CB)", ...KINDS.map(([k]) => `${k} vectors`)],
      figs.map((x) => [name(x.family), String(x.used), `${x.latestUsed} (${pct(x.latestUsed, x.used)})`, String(x.olderUsed), String(x.kwSends), String(x.kw), String(x.vti), String(x.both), `${x.anyVector} (${pct(x.anyVector, x.used)})`, `${x.latestAnyVector} (${pct(x.latestAnyVector, x.latestUsed)})`, `${x.behavioural} (${pct(x.behavioural, x.used)})`, ...KINDS.map(([k]) => String(x.byKind[k]))])), "",
    `Vector groups: ${KINDS.map(([k, w]) => `**${k}** ${w}`).join("; ")}. "With any vector" joins every vector of the suite (not only these groups) on the source slug and version. "keyring-wallet sends" counts the types the wallet sends (role \`sent\` or \`both\` in the census); "keyring-wallet uses" counts every type its source names (the figure before roles were read). A type used by both platforms is in both columns and counted once in "Types used"; "both (all used)" counts types the wallet names and VTI uses. The FW row is the census's framework tasks: not a coverage family, so it has no coverage vectors; whether a core vector names one is what its \"With any vector\" cell shows.`, "");

  const roleRows = KW_ROLES.map((k) => {
    const rs = kwTypes.filter((r) => r.kwRole === k);
    return [`\`${k}\``, String(rs.length), `${rs.filter((r) => anyVec.has(r.type)).length} (${pct(rs.filter((r) => anyVec.has(r.type)).length, rs.length)})`];
  });
  const receivedOnly = kwTypes.filter((r) => r.kwRole === "received").map((r) => r.type);
  const declaredOnly = kwTypes.filter((r) => r.kwRole === "declared-only").map((r) => r.type);
  const bothRole = kwTypes.filter((r) => r.kwRole === "both").map((r) => r.type);

  L.push("## What keyring-wallet does with the types it uses", "",
    `The census names ${kwTypes.length} types in the wallet's source. Reading the source for each ([kw-roles-evidence.md](../vectors-src/coverage/kw-roles-evidence.md)) gives the \`kw_role\` column of the census: the wallet **sends** ${kwSent.length} of them (role \`sent\` or \`both\`), and the other ${kwTypes.length - kwSent.length} it only receives or only names. The headline keyring-wallet figures on this page count the sent types; the all-used figure is printed beside it.`, "",
    table(["Role", "Types", "With any vector"], roleRows), "",
    `- **Received only** (the wallet reads them inbound and never builds one), ${receivedOnly.length} types: ${codes(receivedOnly)}.`,
    `- **Named only** (a rule list, capability table, phrase table, unused constant, comment or HTTP header; neither sent nor received), ${declaredOnly.length} types: ${codes(declaredOnly)}.`,
    `- **Both** (sent and received), ${bothRole.length} types: ${codes(bothRole)}.`, "",
    "What is generated is unchanged: the suite still writes a CE vector (what a platform sends) for every type the wallet uses, so a received-only or named-only type has a CE vector that the wallet is never expected to satisfy by sending. A SKIP of such a vector on a wallet surface is not a gap in the wallet.", "",
    "## Reconciling the task-grain and version-grain figures", "",
    `The task-grain figure counts ${recon.taskList} tasks keyring-wallet uses; the census names ${recon.censusSlugs} distinct tasks (slugs) among ${recon.censusTypes} wallet types. Both are counts of slugs, so the version step-down lists are not the cause: they raise the type count (${recon.multiVersionSlugs} slugs have more than one wallet version in the census) and leave the slug count alone. The two lists were built separately, the task list from \`results/task-scope.json\` (${recon.inScopeFile} tasks listed there, ${recon.fromNamedFile} more from the named-types file it points at) and the census from the wallet's source, and they differ in exactly these places:`, "",
    `- **In the census, not in the task list: ${recon.censusOnly.length} tasks.** ${recon.censusOnly.filter((x) => x.sends).length} of them the wallet sends at some version; ${recon.censusOnly.filter((x) => !x.sends).length} it only receives or only names.`,
    `- **In the task list, not in the census: ${recon.listOnly.length} tasks.** The census holds no wallet row for them.`,
    `- ${recon.censusSlugs} = ${recon.taskList} - ${recon.listOnly.length} + ${recon.censusOnly.length}${recon.balances ? "" : " (does not balance: check the inputs)"}.`, "",
    "In the census, not in the task list:", "",
    table(["Task", "Family", "Wallet versions", "Wallet role (by version)"], recon.censusOnly.map((x) => [`\`${x.slug}\``, x.family, x.versions.join(", "), x.roles.join(", ")])), "",
    "In the task list, not in the census:", "",
    table(["Task", "Census rows of that task"], recon.listOnly.map((x) => [`\`${x.slug}\``, x.censusRows.length > 0 ? x.censusRows.join("; ") : "none"])), "",
    ...(recon.namedNotKwRow.length > 0 ? [`The named-types file also names ${recon.namedNotKwRow.length === 1 ? "a type" : "types"} that ${recon.namedNotKwRow.length === 1 ? "is" : "are"} not a wallet row in the census: ${recon.namedNotKwRow.map((x) => `\`${x.type}\` (census: ${x.censusUsedBy ?? "no row"})`).join(", ")}.`, ""] : []),
    `Read against the sent figure: the census marks ${recon.censusSentSlugs} tasks as sent by the wallet (${recon.censusSentTypes} types), and ${recon.sentNotInList} of those ${recon.censusSentSlugs} are not in the task list; ${recon.listNotSent} tasks in the task list the wallet does not send at any version (it receives or only names them). The ${kwTasks.length - earlierTasks} tasks the wallet sends that the task list lacked were added to \`results/task-scope.json\` on ${EXTENDED_ON} (decision CV-14); the ones left are tasks the wallet only receives or only names, which the task list does not count.`, "");

  L.push("## Recorded coverage runs", "");
  if (runsDir === undefined || !existsSync(runsDir)) {
    L.push("No coverage run is recorded in this results set, so this page prints the vector counts only and no \"ran\" figure. A run is made with `--vectors vectors/coverage --channels proposed,candidate`; to add recorded runs to this page, point `COVERAGE_RUNS_DIR` (or `--coverage-runs <dir>`) at a folder of run records and run `npm run regen`.", "");
  } else {
    const runs = readCoverageRuns(runsDir);
    const rules = (JSON.parse(readFileSync(join(root, "results", "skip-classes.json"), "utf8")) as { rules: Rule[] }).rules;
    const cfg = JSON.parse(readFileSync(join(root, "results", "at-a-glance.config.json"), "utf8")) as { subjects: { surfaces: { id: string; impl: string }[] }[] };
    const surfaces = cfg.subjects.flatMap((s) => s.surfaces);
    const byId = new Map(cov.map((v) => [v.id, v]));
    const head = ["Run folder", "Subject", "Vectors with a result", "Ran", "SKIP", ...COVERAGE_FAMILIES.map((f) => `${f.id} types ran`), "All types ran"];
    const rows: string[][] = [];
    const noCoverage: string[] = [];
    const probeIds = probeVectorIds(root);
    const skipRows: string[][] = [];
    for (const r of runs.used) {
      const res = r.blocks.flatMap((b) => b.results.map((x) => ({ ...x, impl: b.impl }))).filter((x) => byId.has(x.id));
      if (res.length === 0) { if (!r.blocks.some((b) => b.results.some((x) => probeIds.has(x.id)))) noCoverage.push(r.folder); continue; }
      // a vector counts once per run folder: it ran when it ran at any tier
      const ranIds = new Set(res.filter((x) => x.status !== "SKIP").map((x) => x.id));
      const allIds = new Set(res.map((x) => x.id));
      const ranTypes = new Set([...ranIds].map((id) => `${byId.get(id)!.slug}/${byId.get(id)!.version}`));
      const ranSlugs = new Set([...ranTypes].map((t) => t.slice(0, t.lastIndexOf("/"))));
      const ranIn = (f: string): number => census.filter((c) => (f === "ALL" || c.family === f) && ranTypes.has(c.type)).length;
      rows.push([`\`${r.folder}\``, r.subject, String(allIds.size), String(ranIds.size), String([...allIds].filter((i) => !ranIds.has(i)).length), ...COVERAGE_FAMILIES.map((f) => String(ranIn(f.id))), String(ranIn("ALL"))]);
      const counts = new Map<string, number>();
      const seen = new Set<string>();
      for (const x of res) if (x.status === "SKIP" && !ranIds.has(x.id) && !seen.has(x.id)) {
        seen.add(x.id);
        const surf = surfaces.filter((s) => s.impl === (x.impl.replace(/-attested$/, "")) ).map((s) => s.id);
        const sid = surf[0] ?? x.impl;
        const reason = x.reason ?? "";
        const rule = rules.find((q) => (q.surfaces === undefined || q.surfaces.includes(sid)) && new RegExp(q.match, "i").test(reason));
        const cls = classify(reason, sid, rules, ranSlugs);
        const k = `${rule?.label ?? rule?.id ?? "unclassified"} (${cls})`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      skipRows.push([`\`${r.folder}\``, [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join("; ") || "none"]);
    }
    L.push(`Read from ${rows.length} run record(s) of a coverage runs folder; a vector counts once per folder (it ran when it ran at any tier), and a type ran when any of its coverage vectors ran. Types ran are at version grain, to be read against the "Types used" column above. Advisory, by run folder; folders are never added together.`, "",
      table(head, rows), "",
      "**SKIPs by class** (rules in [skip-classes.json](skip-classes.json); each count is vectors that did not run at any tier):", "", table(["Run folder", "SKIPs, by the rule's name and class"], skipRows), "");
    // PASS split by the code the run observed (a field the runner records since it was added; earlier run records have none: never guessed)
    const NR = "not recorded";
    const splitRows: string[][] = []; const noCodes: string[] = [];
    for (const r of runs.used) {
      const res = r.blocks.flatMap((b) => b.results).filter((x) => byId.has(x.id));
      if (res.length === 0) continue;
      const recorded = res.some((x) => x.observedCodes !== undefined);
      if (!recorded) noCodes.push(r.folder);
      // a vector counts once per folder: its PASS rows at every tier decide its class (gate only when every one of them is)
      const kind = new Map<string, "own" | "gate" | "other">();
      for (const id of new Set(res.filter((x) => x.status === "PASS").map((x) => x.id))) {
        const ps = res.filter((x) => x.id === id && x.status === "PASS");
        kind.set(id, ps.every((x) => x.acceptedOnlyGate === true) ? "gate" : ps.some((x) => x.observedCodes !== undefined) ? "own" : "other");
      }
      const line = (label: string, ids: string[]): string[] => {
        const n = (k: string): number => ids.filter((i) => kind.get(i) === k).length;
        return [`\`${r.folder}\``, label, String(ids.length), recorded ? String(n("own")) : NR, recorded ? String(n("gate")) : NR, recorded ? String(n("other")) : NR];
      };
      const passIds = [...kind.keys()];
      if (passIds.length === 0) continue;
      splitRows.push(line("all groups", passIds));
      for (const g of [...new Set(passIds.map((i) => byId.get(i)!.group))].sort()) splitRows.push(line(g, passIds.filter((i) => byId.get(i)!.group === g)));
    }
    // The five candidate vectors (CC-*, the "Candidate types" section) are in the run's own advisory results but are not coverage-family vectors, so they are not in the figures above:
    // a run's advisory PASS total in its own matrix is the figure above plus these (the 654 against 659 of the VTI agent, the 1,549 against 1,554 of the reference).
    const candidatePass = runs.used.flatMap((r) => { const n = new Set(r.blocks.flatMap((b) => b.results).filter((x) => x.status === "PASS" && x.id.startsWith("CC-")).map((x) => x.id)).size; return n > 0 ? [`\`${r.folder}\` ${n}`] : []; });
    const candidateNote = candidatePass.length === 0 ? "" : `The groups above are the coverage families (CB, CE, CV, CX). The candidate vectors (CC-*, below) are in a run's own advisory results but not in these figures, so a run's advisory PASS total in its own matrix is the figure here plus its candidate PASS: ${candidatePass.join(", ")}.`;
    L.push("**PASS by the code observed** (a vector counts once per run folder). " + PD_CAVEAT + " \"Own code\" is a PASS that returned the task's own code, \"permissionDenied only\" a PASS where every error step returned `permissionDenied` while the vector also accepted a task code, and \"no permissionDenied alternative\" a PASS of a vector that accepts no such pair (nothing to tell apart). A cell reads \"" + NR + "\" for a run recorded before the runner kept the observed code: it is never guessed from the PASS count.", "",
      table(["Run folder", "Group", "PASS", "PASS with the task's own code", "PASS as permissionDenied only", "PASS with no permissionDenied alternative"], splitRows), "",
      noCodes.length === 0 ? "Every run folder above records the observed code." : `Run folders with no observed code recorded (they predate the field; nothing is guessed): ${noCodes.map((e) => `\`${e}\``).join(", ")}.`, "", candidateNote, "");
    const named = rows.map((r) => r[0]).join(", ");
    L.push(`Run folders read: ${named || "none"}.${noCoverage.length > 0 ? ` Run records with no coverage vector in them (left out): ${noCoverage.map((e) => `\`${e}\``).join(", ")}.` : ""}${runs.empty.length > 0 ? ` Folders present with no recorded result yet: ${runs.empty.map((e) => `\`${e}\``).join(", ")}.` : ""}${runs.unreadable.length > 0 ? ` Unreadable: ${runs.unreadable.map((e) => `\`${e}\``).join(", ")}.` : ""}`, "");
  }
  L.push("## Candidate types (no Trust Tasks specification)", "", candidateBlock(root, "../docs/"), "");
  L.push("### Subjects with no coverage run", "",
    "- **truststackers:** no coverage run is recorded.",
    "- **Witness server:** re-run on 2026-11-18 on this suite, with the witness vectors (not the coverage vectors), against the keyring-wallet build (run label `witness-upstream`). The run records are held outside this repository, as for every run (standing rule: run records stay outside the repository for now), so this page does not link them. Every entry has the same result as in the earlier run of 2026-11-16 ([CV-9](../docs/decisions/03-vectors-and-coverage.md#cv9)). This says nothing about mediated deployments or other witness implementations.", "",
    "## Limits", "",
    `- Behavioural vectors exist only for the newest census version of a task and for versions keyring-wallet uses ([CV-2](../docs/decisions/03-vectors-and-coverage.md#cv2)). Census versions that are neither: ${olderNotKw.length}; of those, with a behavioural vector: ${olderNotKw.filter((r) => cbVec.has(r.type)).length}. Types with a behavioural vector in all: ${cbTotal} of ${census.length}.`,
    `- Candidate types (no Trust Tasks specification): ${candidates.length}; with a behavioural vector: ${candidates.filter((r) => cbVec.has(r.type)).length}. No rule is invented for them ([CV-6](../docs/decisions/03-vectors-and-coverage.md#cv6)).`,
    `- The census mixes types a platform receives with types it only sends: ${sentByVti} census types are marked as sent by VTI. For keyring-wallet the census records the role of each type (\`kw_role\`: ${kwTypes.length - kwSent.length} of its ${kwTypes.length} types are received only or only named), so the keyring-wallet figures above count the ${kwSent.length} it sends. A SKIP of "not served by this surface" is not a gap in the platform.`,
    `- Types with no vector at all: ${census.length - census.filter((r) => anyVec.has(r.type)).length} of ${census.length}; the reasons are listed in [vectors/coverage/not-generated.json](../vectors/coverage/not-generated.json). A destructive task gets schema-invalid payloads only ([CV-5](../docs/decisions/03-vectors-and-coverage.md#cv5)).`, "",
    "## What this page is not", "",
    "- Vectors generated from the registry schema (groups CV and CE) are not independent evidence of that schema: the platforms build against the same schema ([CV-10](../docs/decisions/03-vectors-and-coverage.md#cv10)). CX vectors rest on the task force's own invalid examples and CB vectors on the specification text, and each vector says which.",
    "- Not a statement that any platform works with another. Where both platforms have a recorded run, the strongest claim is that the suite ran against both with the same vectors.",
    "- Not a ranking, and not a count of agreement: a result other than SKIP may be a pass, a clarification or a difference.", "");
  return L.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The short generated block placed in docs/22: counts by family, no run data. */
export function coverageBlock(root: string, name = "coverage-counts"): string {
  if (name === "coverage-candidates") return candidateBlock(root, "");
  const page = buildCoveragePage(root);
  const m = /## Types and vectors by family \(version grain\)\n\n([\s\S]*?)\n\nVector groups/.exec(page);
  if (m === null) throw new Error("coverage page: family table not found");
  return m[1]!;
}

interface NotGenerated { types: { type: string; family: string; reason: string; candidate?: string; blockedOn?: string; linkedTo?: string }[] }

/**
 * The candidate types (census tf_status none, decision CV-6): which have a candidate vector (group CC), which are linked to vectors the suite
 * already holds, and which are blocked on text, with the reason. Counted apart from every total: no figure here is added to the family table.
 */
export function candidateBlock(root: string, docs: string): string {
  const census = loadCensus().filter((r) => r.tfStatus === "none");
  const ng = (JSON.parse(readFileSync(join(root, "vectors", "coverage", "not-generated.json"), "utf8")) as NotGenerated).types;
  const cc = [...loadCatalog(root, { coverage: true }).values()].filter((v) => v.group.startsWith("CC-"));
  const rows = census.map((r) => {
    const n = ng.find((x) => x.type === r.type);
    const own = cc.filter((v) => `${v.slug}/${v.version}` === r.type).length;
    const state = own > 0 ? `${own} candidate vector${own === 1 ? "" : "s"} (${n?.candidate ?? "CC"})` : n?.linkedTo !== undefined ? `vectors already held: ${n.linkedTo}` : "none: blocked on text";
    const why = own > 0 ? `local text ${CANDIDATE_TEXT}` : n?.linkedTo !== undefined ? "local text docs/10-witness-share-profile.md" : n?.blockedOn?.replace(/^blocked on text: /, "") ?? "no reason recorded";
    return [`\`${r.type}\``, r.family, r.usedBy.join("+"), state, why];
  });
  const withVec = rows.filter((r) => r[3]!.includes("candidate vector")).length;
  return [
    `The ${census.length} used types with no Trust Tasks specification ([CV-6](${docs}decisions/03-vectors-and-coverage.md#cv6)). A candidate vector is written only where a local text exists ([${CANDIDATE_TEXT.replace("docs/", "")}](${docs}24-candidate-task-notes.md) quotes the platform's own source); a type with no usable text gets no vector and is listed as blocked. ${withVec} types have a new candidate vector (${cc.length} vectors in all, group CC); one type is covered by vectors the suite already held. Candidate figures are counted apart from the family table and from every total, and no candidate vector enters a headline count.`,
    "",
    table(["Type", "Family", "Used by", "Candidate vectors", "Text, or why none"], rows),
  ].join("\n");
}
/** The role table and lists of the keyring-wallet section of the page, for docs/22 (no heading). */
export function kwRolesBlock(root: string): string {
  const page = buildCoveragePage(root);
  const m = /## What keyring-wallet does with the types it uses\n\n([\s\S]*?)\n\n## Reconciling/.exec(page);
  if (m === null) throw new Error("coverage page: keyring-wallet roles section not found");
  return m[1]!;
}

/** The reconciliation summary (the counts and the balance, without the per-task tables) for docs/22. */
export function reconcileBlock(root: string): string {
  const page = buildCoveragePage(root);
  const m = /## Reconciling the task-grain and version-grain figures\n\n([\s\S]*?)\n\nIn the census, not in the task list:/.exec(page);
  const tail = /\n\n(Read against the sent figure:[^\n]*)/.exec(page);
  if (m === null || tail === null) throw new Error("coverage page: reconciliation section not found");
  return `${m[1]!}\n\n${tail[1]!}\n\nThe tasks themselves are listed in the task-grain reconciliation in the generated coverage page.`;
}


/** The ids of the seeded-state probe vectors (vectors/probe, group CP-*; decision CV-16): advisory, outside every coverage count. */
function probeVectorIds(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(root, "vectors", "probe");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json") && n !== "manifest.json").sort()) {
    for (const v of (JSON.parse(readFileSync(join(dir, f), "utf8")) as { vectors: { id: string }[] }).vectors) out.set(v.id, v.id.split("-").slice(0, 2).join("-"));
  }
  return out;
}

/** The two sections the snapshot adds after the coverage figures: the seeded-state probe (its own run folders, its own counts) and the ceremony scenario list (counted from the scenario files, never run here). */
function probeAndCeremony(root: string, runs: ReturnType<typeof readCoverageRuns>): string[] {
  const ids = probeVectorIds(root);
  const L: string[] = [];
  const rows: string[][] = [];
  for (const r of runs.used) {
    const res = r.blocks.flatMap((b) => b.results).filter((x) => ids.has(x.id));
    if (res.length === 0) continue;
    const latest = new Map(res.map((x) => [x.id, x.status] as const));
    for (const g of ["ALL", ...[...new Set(ids.values())].sort()]) {
      const sel = [...latest].filter(([id]) => g === "ALL" || ids.get(id) === g).map(([, st]) => st);
      if (sel.length === 0) continue;
      const n = (st: string): number => sel.filter((x) => x === st).length;
      rows.push([`\`${r.folder}\``, r.subject, g === "ALL" ? "all" : g, String(sel.length), String(n("PASS")), String(sel.filter((x) => x !== "PASS" && x !== "SKIP").length), String(n("SKIP"))]);
    }
  }
  L.push("## Seeded-state probe, subset of surfaces", "");
  if (rows.length === 0) L.push("No seeded-state probe run is recorded in this set.", "");
  else L.push(`The ${ids.size} seeded-state probe vectors (\`vectors/probe\`, groups ${[...new Set(ids.values())].sort().map((g) => `\`${g}\``).join(", ")}; [decision CV-16](../docs/decisions/03-vectors-and-coverage.md#cv16), [docs/22](../docs/22-coverage-families.md)) were run on a **subset of surfaces** only: the reference adapter and the two VTI services (community and agent),. The keyring-wallet surfaces and the VTI emit side do not serve rooms, git namespaces or keys, so no probe was run there. These runs are separate run folders; they are not part of the coverage table above and enter no coverage count. A surface that does not serve a probe group reports its vectors as SKIP.`, "",
    table(["Run folder", "Subject", "Group", "Vectors", "PASS", "Other than PASS or SKIP", "SKIP"], rows), "");
  const dir = join(root, "vectors", "ceremony-scenarios");
  const mf = join(dir, "scenarios-manifest.json");
  L.push("## Reference-only ceremony scenarios, never conformance", "");
  if (!existsSync(mf)) L.push("No ceremony scenario files are present.", "");
  else {
    const files = (JSON.parse(readFileSync(mf, "utf8")) as { files: string[] }).files;
    const per = files.map((f) => { const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as { group?: string; scenarios: unknown[] }; return { f, group: j.group ?? f, n: j.scenarios.length }; });
    const total = per.reduce((a, x) => a + x.n, 0);
    L.push(`The suite also holds ${total} scenarios in ${files.length} files (\`vectors/ceremony-scenarios\`: ${per.map((x) => `${x.group} ${x.n}`).join(", ")}). They are multi-party ceremonies played on the reference adapter only; they are never conformance, say nothing about any platform, are not counted in any figure above and have no row in the tables on this page. The scenario counts are read from the scenario files by the generator.`, "");
  }
  return L;
}

/**
 * The measured snapshot (results/coverage-measured.md): the coverage page built from a folder of run records, under a header that says what it is.
 * The suite commit, the date and the tree state are read from each record's run.json (never typed in); `superseded` names the older folders this set replaces.
 */
export function buildSnapshotPage(root: string, runsDir: string, superseded: string[]): string {
  const body = buildCoveragePage(root, runsDir);
  const runs = readCoverageRuns(runsDir);
  const commits = new Set<string>(); const dates = new Set<string>(); let dirty = false; let missing = 0;
  for (const r of runs.used) {
    try {
      const j = JSON.parse(readFileSync(join(runsDir, r.folder.replace(/-advisory$/, ""), "run.json"), "utf8")) as { today?: string; suite?: { commit?: string; dirty?: boolean } };
      if (j.suite?.commit !== undefined) commits.add(j.suite.commit.slice(0, 7)); else missing++;
      if (j.today !== undefined) dates.add(j.today);
      if (j.suite?.dirty === true) dirty = true;
    } catch { missing++; }
  }
  const tier1Only = runs.used.filter((r) => !r.blocks.some((b) => (b as { tier?: number }).tier === 2)).map((r) => `\`${r.folder}\``);
  const tiers = tier1Only.length === 0 ? "Every run folder ran tiers 1 and 2." : `Tier 1 only: ${tier1Only.join(", ")}; the other folders ran tiers 1 and 2.`;
  const list = (xs: Set<string>): string => [...xs].sort().map((x) => `\`${x}\``).join(", ") || "not recorded";
  const start = body.indexOf("> **How to read this page");
  if (start < 0) throw new Error("coverage page: how-to-read box not found");
  const H: string[] = ["# Coverage by task version: measured snapshot", "",
    "> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.", "",
    `This page is a snapshot of run records held outside the repository (standing rule: run records stay outside the repository for now). It is the coverage page ([coverage.md](coverage.md)) built from one complete measured set: every coverage vector, both tiers where the surface finishes them (the tiers that ran are named below), with \`--channels proposed,candidate\`, one run folder per surface. Suite commit: ${list(commits)}; run date: ${list(dates)}; ${dirty ? "at least one run was made from a dirty tree" : "every run was made from a clean tree (the run record says dirty false)"}.${commits.size > 1 ? " The run records name more than one suite commit: read each row against its own commit." : ""}${missing > 0 ? ` ${missing} run record(s) carry no readable run.json.` : ""} Advisory: nothing here enters a headline count ([CV-3](../docs/decisions/03-vectors-and-coverage.md#cv3), [CV-13](../docs/decisions/03-vectors-and-coverage.md#cv13)). ${tiers} The strongest claim is that the suite ran against both with the same vectors.`, "",
    "To regenerate, with the run records of the set in a folder (one subfolder per surface, each holding the run and its advisory results):", "",
    "```", `COVERAGE_RUNS_DIR=<runs folder> npm run coverage-pages -- --snapshot --out results/${SNAPSHOT_FILE}${superseded.length > 0 ? " --superseded <comma-separated folder names>" : ""}`, "```", "",
    "The figures below are read from those records by the generator, never typed in. This file is not rewritten by `npm run regen` (it needs records the repository does not hold); the tracked coverage page and the docs/22 block are unchanged by it.", ""];
  if (superseded.length > 0) H.push("Older subset and stitched run folders, **superseded by this set** (names only; held outside the repository, not read here):", "", ...superseded.map((n) => `- \`${n}\``), "");
  const extra = probeAndCeremony(root, runs).join("\n");
  const cand = body.indexOf("## Candidate types");
  if (cand < start) throw new Error("coverage page: candidate section not found");
  return (H.join("\n") + "\n" + body.slice(start, cand) + extra + "\n\n" + body.slice(cand)).replace(/\n{3,}/g, "\n\n");
}
