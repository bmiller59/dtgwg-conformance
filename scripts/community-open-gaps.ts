// SPDX-License-Identifier: Apache-2.0
// Generates docs/community/open-gaps.md: the "good first contributions" page. The open ceremony scenarios come from the recorded
// completion snapshot (docs/community/data/ceremony-completion.json) joined to the scenario files in vectors/ceremony-scenarios/;
// the blockers and the open vector items are curated in docs/community/data/open-gaps.json; the per-family vector table comes from
// docs/community/data/vector-completeness.json. Nothing about a platform is typed into the page by hand: change the data, run this.
// Usage: node --experimental-strip-types scripts/community-open-gaps.ts [--check]
//   (no flag)  write docs/community/open-gaps.md
//   --check    exit 1 when the file on disk differs from what would be generated
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Blocker {
  id: string;
  title: string;
  class: "A" | "B" | "C" | "D" | null;
  scenarios: string[];
  blocked: string;
  needs: string;
  start: string[];
}
export interface VectorItem {
  id: string;
  title: string;
  class: "A" | "B" | "C" | "D" | null;
  count?: number;
  tasks?: string[];
  blocked: string;
  needs: string;
}
export interface OpenGapsData {
  asOf: string;
  maturity: string;
  ceremonyBlockers: Blocker[];
  specOpenItems: string[];
  vectorOpenItems: VectorItem[];
}
export interface CompletionData {
  asOf: string;
  completion: Record<string, boolean>;
  denominators: { allScenarios: number; bothAttempted: number; vtiAttempted: number; keyringWalletAttempted: number };
  caveats: {
    cannotBePairedWithTodaysDeclarations: { total: number; groups: Record<string, number> };
    referenceInThirdSeatAmongOriginal: number;
    originalByCarrier: { liveContainers: number; didcommWire: number; inProcess: number };
  };
}
export interface FamilyRow { family: string; tasks: number; weakOnly: number; noNegative: number; noPositive: number }
export interface VectorCompleteness {
  asOf: string;
  scope: number;
  totals: {
    covered: number; positive: number; negative: number; positiveAndNegative: number; assertsSuccess: number; weakOnly: number;
    gating: number; positivesSkippedByDefault: number; negativesSkippedByDefault: number;
  };
  families: FamilyRow[];
}
export interface Scenario { id: string; title: string; group: string }

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = "docs/community/data";
export const PAGE = "docs/community/open-gaps.md";

export const BANNER =
  "**Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.";

const readJson = <T>(root: string, rel: string): T => JSON.parse(readFileSync(join(root, rel), "utf8")) as T;

/** Every scenario of every vectors/ceremony-scenarios/fc-*.json file, in id order. */
export function loadScenarios(root: string): Scenario[] {
  const dir = join(root, "vectors", "ceremony-scenarios");
  const out: Scenario[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!/^fc-.*\.json$/.test(f)) continue;
    const file = readJson<{ group: string; scenarios: { id: string; title: string }[] }>(root, `vectors/ceremony-scenarios/${f}`);
    for (const s of file.scenarios) out.push({ id: s.id, title: s.title, group: file.group });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function pct(n: number, d: number): string {
  return `${((100 * n) / d).toFixed(1)}% [${n}/${d}]`;
}

function short(title: string, max = 110): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))} ...`;
}

/** Problems that make the data unusable: an open scenario with no blocker, a blocker for a scenario that is not open, and so on. */
export function dataProblems(root: string, scenarios: Scenario[], completion: CompletionData, data: OpenGapsData, vc: VectorCompleteness): string[] {
  const bad: string[] = [];
  const ids = new Set(scenarios.map((s) => s.id));
  for (const id of ids) if (completion.completion[id] === undefined) bad.push(`no completion entry for ${id}`);
  for (const id of Object.keys(completion.completion)) if (!ids.has(id)) bad.push(`completion entry for unknown scenario ${id}`);
  const open = new Set(Object.entries(completion.completion).filter(([, v]) => !v).map(([k]) => k));
  const seen = new Map<string, string>();
  for (const b of data.ceremonyBlockers) {
    for (const id of b.scenarios) {
      if (!ids.has(id)) bad.push(`blocker ${b.id} names unknown scenario ${id}`);
      else if (!open.has(id)) bad.push(`blocker ${b.id} names ${id}, which has a completed run`);
      if (seen.has(id)) bad.push(`${id} is named by both ${seen.get(id)} and ${b.id}`);
      seen.set(id, b.id);
    }
    for (const p of b.start) if (!existsSync(join(root, p))) bad.push(`blocker ${b.id}: start path ${p} does not exist`);
  }
  for (const id of open) if (!seen.has(id)) bad.push(`open scenario ${id} has no blocker`);
  for (const [i, f] of vc.families.entries()) if (f.weakOnly > f.tasks || f.noNegative > f.tasks || f.noPositive > f.tasks) bad.push(`family row ${i} (${f.family}) exceeds its task count`);
  const sum = (k: keyof FamilyRow): number => vc.families.reduce((a, f) => a + (f[k] as number), 0);
  if (sum("tasks") !== vc.scope) bad.push(`family tasks sum to ${sum("tasks")}, scope is ${vc.scope}`);
  if (sum("weakOnly") !== vc.totals.weakOnly) bad.push(`family weak-only sums to ${sum("weakOnly")}, total says ${vc.totals.weakOnly}`);
  if (vc.scope - sum("noNegative") !== vc.totals.negative) bad.push("negative total disagrees with the families");
  if (vc.scope - sum("noPositive") !== vc.totals.positive) bad.push("positive total disagrees with the families");
  if (vc.totals.assertsSuccess + vc.totals.weakOnly !== vc.totals.positive) bad.push("asserted plus weak-only is not the positive total");
  return bad;
}

const classLabel = (c: Blocker["class"]): string =>
  c === null ? "not classified A to D in the source" : c;

/** The page text. Throws when the data is inconsistent. */
export function buildOpenGaps(root: string = DEFAULT_ROOT): string {
  const scenarios = loadScenarios(root);
  const completion = readJson<CompletionData>(root, `${DATA}/ceremony-completion.json`);
  const data = readJson<OpenGapsData>(root, `${DATA}/open-gaps.json`);
  const vc = readJson<VectorCompleteness>(root, `${DATA}/vector-completeness.json`);
  const problems = dataProblems(root, scenarios, completion, data, vc);
  if (problems.length > 0) throw new Error(`open-gaps data is inconsistent:\n  ${problems.join("\n  ")}`);

  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const total = scenarios.length;
  const entries = Object.entries(completion.completion);
  const done = entries.filter(([, v]) => v).length;
  const open = entries.filter(([, v]) => !v).map(([k]) => k);

  const groups = [...new Set(scenarios.map((s) => s.group))].sort();
  const L: string[] = [];
  L.push("# Open gaps: good first contributions", "");
  L.push(`> ${BANNER}`, "");
  L.push(
    `This page lists what is not done yet, with what each item needs, so you can pick one. It is generated by \`scripts/community-open-gaps.ts\` from the data in \`${DATA}/\` and the scenario files; to change it, change the data and run \`node --experimental-strip-types scripts/community-open-gaps.ts\`. A test fails when the page is stale or the data disagrees with the scenario files.`,
    "",
    `Snapshot of ${[completion.asOf, data.asOf].sort().at(-1)}. Every task specification involved is draft. Ceremony figures are completion of scenarios run together, never conformance. Before you start, read [how to contribute](contributing.md): in particular, a point where the specification text is open is discussed with the task force and is not asserted in a vector.`,
    "",
  );

  L.push("## Ceremony scenarios", "");
  L.push(
    `${total} scenarios in ${groups.length} groups. Completed on the original platforms: ${pct(done, total)}. No completed run: ${pct(open.length, total)}. A scenario counts as completed only when one recorded result has VTI and the keyring-wallet both taking part (reference or stand-in parties do not count as either). Completion is not a pass rate: it says a ceremony ran to its specified end, not that either side agrees with the specifications.`,
    "",
    "| Group | Scenarios | Completed | No completed run |",
    "|---|---|---|---|",
  );
  for (const g of groups) {
    const ids = scenarios.filter((s) => s.group === g).map((s) => s.id);
    const u = ids.filter((i) => completion.completion[i]).length;
    L.push(`| ${g} | ${ids.length} | ${pct(u, ids.length)} | ${ids.length - u} |`);
  }
  L.push("");

  L.push("### What blocks the open scenarios", "");
  L.push(`${open.length} scenarios have no completed run. Each is named by exactly one blocker below, with its class (A the implementation differs from the specification, B the vector reads more than the text says, C the specification is open, D the harness or a stand-in).`, "");
  for (const b of data.ceremonyBlockers) {
    L.push(`#### ${b.title}`, "");
    L.push(`- **Blocking class:** ${classLabel(b.class)}.`);
    L.push(`- **Scenarios (${b.scenarios.length} of ${total}):**`);
    for (const id of b.scenarios) L.push(`  - \`${id}\`: ${short(byId.get(id)!.title)}`);
    L.push(`- **Blocked because:** ${b.blocked}`);
    L.push(`- **Needed:** ${b.needs}`);
    L.push(`- **Where to start:** ${b.start.map((p) => (p.endsWith(".md") || p.endsWith(".json") || p.endsWith(".ts") ? `[\`${p}\`](../../${p})` : `\`${p}\``)).join(", ")}.`);
    L.push("");
  }

  L.push("## Vector completion", "");
  const t = vc.totals;
  L.push(
    `Scope: ${vc.scope} tasks, the latest version of each task that VTI serves or whose role the keyring-wallet source shows with code. All the vectors of this set are advisory (channel \`proposed\`); none is promoted. How the set is built and measured is in [vector completeness](../37-vector-completeness.md). Covered means a vector exists. It does not say any platform passes it: per-surface agreement is reported per run in the dated results pages, never added across surfaces.`,
    "",
    "| Measure | Share of the scope |",
    "|---|---|",
    `| Any vector | ${pct(t.covered, vc.scope)} |`,
    `| A positive vector | ${pct(t.positive, vc.scope)} |`,
    `| A negative vector | ${pct(t.negative, vc.scope)} |`,
    `| Both a positive and a negative | ${pct(t.positiveAndNegative, vc.scope)} |`,
    `| A positive that asserts the task's own success response | ${pct(t.assertsSuccess, vc.scope)} |`,
    `| Positives that are weak only (any non-envelope answer passes) | ${pct(t.weakOnly, vc.scope)} |`,
    `| A gating (registry) vector | ${pct(t.gating, vc.scope)} |`,
    `| Positives all skipped by default (need a disposable deployment) | ${pct(t.positivesSkippedByDefault, vc.scope)} |`,
    `| Negatives all skipped by default | ${pct(t.negativesSkippedByDefault, vc.scope)} |`,
    "",
    "The two positive rows add up to the positive row: asserted plus weak-only is every task that has a positive.",
    "",
    "### Open vector items",
    "",
  );
  for (const v of data.vectorOpenItems) {
    const n = v.count !== undefined ? ` (${v.count})` : "";
    L.push(`#### ${v.title}${n}`, "");
    L.push(`- **Blocking class:** ${classLabel(v.class)}.`);
    if (v.tasks !== undefined) L.push(`- **Tasks:** ${v.tasks.map((x) => `\`${x}\``).join(", ")}.`);
    L.push(`- **Blocked because:** ${v.blocked}`);
    L.push(`- **Needed:** ${v.needs}`, "");
  }

  L.push("### Weak-only positives by family", "");
  L.push("Tasks in the scope whose positives are all weak, with the family's task count as the denominator. The families with a zero are fully asserted.", "");
  L.push("| Family | Tasks | Weak-only | Share | No negative |", "|---|---|---|---|---|");
  for (const f of vc.families) L.push(`| ${f.family} | ${f.tasks} | ${f.weakOnly} | ${pct(f.weakOnly, f.tasks)} | ${f.noNegative} |`);
  L.push("");

  L.push("## Questions for the task force (not to be asserted)", "");
  L.push("These rest on specification text that is open or inconsistent. They are discussed with the task force and recorded as a question with the quotations; they are not asserted in a vector or an exception, and none has been filed anywhere. This page lists only the questions that block ceremony scenarios or vectors; a fuller list of questions for the specification editors accompanies the dated results, which are published separately.", "");
  for (const s of data.specOpenItems) L.push(`- ${s}`);
  L.push("");
  return `${L.join("\n")}`;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = buildOpenGaps();
  const file = join(DEFAULT_ROOT, PAGE);
  if (process.argv.includes("--check")) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== want) {
      console.error(`stale: ${PAGE} (run node --experimental-strip-types scripts/community-open-gaps.ts)`);
      process.exit(1);
    }
    console.log(`${PAGE} is current`);
  } else {
    writeFileSync(file, want);
    console.log(`wrote ${PAGE}`);
  }
}
