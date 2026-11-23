// SPDX-License-Identifier: Apache-2.0
// Command line: node --experimental-strip-types src/runner/cli.ts [options]
//   --adapter <spec>   reference | reference-attested | reference-cosign (a begin is not the proposer's approval) | reference-status (offers a status task) | reference-peer (a second reference party with its own key; mutant-peer:<id>[,<id>] with mutants) | reference-e:<k>:<actors> (essential governance configured by the harness: k of the named actors, e.g. reference-e:3:B,C,D,F) | reference-witness (the witness oracle, docs/13 section 6; run with --vectors vectors/witness) | mutant:<id>[,<id>] (attested with mutants: mutant-attested:<id>; witness oracle with mutants: mutant-witness:<id>)
//                      | module:<path> (in-process module exporting createAdapter())
//                      | stdio:<command> (out-of-process: the command is run through the shell and speaks newline-delimited JSON-RPC on stdin/stdout)
//                      | http:<url> (out-of-process: JSON-RPC over HTTP POST, e.g. http:http://127.0.0.1:8080/). Repeatable.
//   --tier 1|2         run exactly this tier (default: both; Tier 2 runs the `attested` sub-group only where the adapter claims it, and the named profile sub-groups for every adapter)
//   --vectors <dir>    default ./vectors
//   --quarantine <file> default ./exceptions/quarantine.json when it exists: flaky vectors recorded as QUARANTINED (advisory) until expiry, then FAIL
//   --exceptions <file> default ./exceptions/exceptions.json when it exists (one file holds every platform's entries, keyed by impl); a named file must exist
//   --out <dir>        write conformance-matrix.json / .md and results.json here
//   --run <name>       the same as --out <results dir>/runs/<name>: a run folder (YYYY-MM-DD-<platform>-<ref or label>) in the results
//                      directory, which is kept outside this repository (src/results-dir.ts, docs/04 section 21)
//   --results-dir <dir> the results directory for --run (default $SUITE_RESULTS_DIR, else results-local/, which is git-ignored)
//   --salt <s>         run salt mixed into every deterministic document id (default: random per run; `--salt ""` leaves ids unsalted). Give the same value to reproduce a run.
//   --window maxAge=600,skew=60,horizon=2592000   measure against this acceptance window (any subset of the members, whole seconds), overriding the adapter's declared window
//   --rebase           treat the clock as not settable even if the adapter can set it (rebase mode: real time is each vector's clock start)
//   --channels registry,pr,proposed,candidate   spec-maturity channels to run (default registry; docs/04 section 18). Vectors of other channels are excluded (not run, not counted, not SKIP). `pr` and `proposed` results are always advisory: never in the gating counts, headline totals or exit code; with --out they go to the sibling folder <out>-advisory.
//   --kit <dir>        task-force checkout used to check spec-drift (default $TT_KIT, else ../dtgwg-trust-tasks-tf); a source that is not available is flagged spec-drift (advisory)
//   --timeout <ms>     per-call timeout for out-of-process adapters (default 30000)
//   --today YYYY-MM-DD the date exception expiry is judged against (default: today's date from the clock). Pin it to reproduce a recorded run.
//   --min-quiet-ms <n> minimum quiet period (ms) a silence / any-refusal / duplicate-without-reply verdict needs, for every adapter
//                      (default: 0 over in-process or https, 1500 otherwise; docs/04 section 3.3)
//   --allow-effects <name>  name of a disposable deployment (default $CONFORMANCE_DISPOSABLE_DEPLOYMENT): without it a vector that changes state is not run (its `effect` tag, or for an untagged vector the effect of the tasks it sends to, from vectors-src/task-effects.json: a destructive task is never sent to; a mutating task is not sent a request that may succeed) and is reported SKIPPED-SAFETY (neither pass nor fail)
//   --strict           fail (exit 2) when an adapter declares an optional capability name outside OPTIONAL_CAPABILITIES (default: warn)
// With --out, run.json records the run's provenance (suite commit, vector and exceptions digests, each adapter's capabilities, the date used).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR_ENV, resultsDir, runName, runsDir } from "../results-dir.ts";
import type { AcceptanceWindow } from "../adapter/contract.ts";
import { CONTRACT_VERSION, unknownOptionalNames } from "../adapter/contract.ts";
import { parseWindowArg } from "./window.ts";
import { resolveEssential } from "./essential.ts";
import { makeActors } from "./engine.ts";
import { closeAdapter, makeAdapter } from "./adapters.ts";
import { loadExceptions, loadSuite } from "../vectors/load.ts";
import type { Tier } from "../vectors/types.ts";
import { DEFAULT_CHANNELS, defaultKitRoot, parseChannels, SUITE_ROOT } from "../vectors/source.ts";
import type { Channel } from "../vectors/source.ts";
import { ADVISORY_BANNER, advisoryChannelsOf, buildMatrix, matrixMarkdown } from "./matrix.ts";
import { buildProvenance, parseToday } from "./provenance.ts";
import { loadQuarantine } from "./quarantine.ts";
import { loadSpecFlags } from "../vectors/spec-flags.ts";
import type { RunProvenance } from "./provenance.ts";
import { exitCode, runSuite } from "./suite.ts";
import type { SuiteRun } from "./suite.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

async function main(argv: string[]): Promise<number> {
  const adapters: string[] = [];
  let tier: Tier | undefined;
  let vectors = join(root, "vectors");
  let exceptions = join(root, "exceptions", "exceptions.json");
  let quarantine = join(root, "exceptions", "quarantine.json");
  let quarantineGiven = false;
  let out: string | undefined;
  let runArg: string | undefined;
  let timeoutMs: number | undefined;
  let salt: string | undefined;
  let window: Partial<AcceptanceWindow> | undefined;
  let rebase = false;
  let channels: Channel[] = [...DEFAULT_CHANNELS];
  let kit: string | undefined;
  let pinnedToday: string | undefined;
  let strict = false;
  let exceptionsGiven = false;
  let minQuietMs: number | undefined;
  let allowEffects: string | undefined = process.env["CONFORMANCE_DISPOSABLE_DEPLOYMENT"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--adapter") adapters.push(next());
    else if (a === "--allow-effects") allowEffects = next();
    else if (a === "--tier") tier = Number(next()) === 2 ? 2 : 1;
    else if (a === "--vectors") vectors = resolve(next());
    else if (a === "--exceptions") { exceptions = resolve(next()); exceptionsGiven = true; }
    else if (a === "--quarantine") { quarantine = resolve(next()); quarantineGiven = true; }
    else if (a === "--out") out = resolve(next());
    else if (a === "--run") runArg = runName(next());
    else if (a === "--results-dir") process.env[RESULTS_DIR_ENV] = resolve(next());
    else if (a === "--salt") salt = next();
    else if (a === "--window") window = parseWindowArg(next());
    else if (a === "--rebase") rebase = true;
    else if (a === "--channels") channels = parseChannels(next());
    else if (a === "--kit") kit = resolve(next());
    else if (a === "--timeout") timeoutMs = Number(next());
    else if (a === "--today") pinnedToday = parseToday(next());
    else if (a === "--strict") strict = true;
    else if (a === "--min-quiet-ms") minQuietMs = Number(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (runArg !== undefined) out = join(runsDir(resultsDir()), runArg);
  if (adapters.length === 0) adapters.push("reference", "reference-attested");
  const suite = loadSuite(vectors);
  if (exceptionsGiven && !existsSync(exceptions)) throw new Error(`--exceptions: no such file ${exceptions}`);
  const excs = existsSync(exceptions) ? loadExceptions(exceptions).exceptions : [];
  if (quarantineGiven && !existsSync(quarantine)) throw new Error(`--quarantine: no such file ${quarantine}`);
  const quar = existsSync(quarantine) ? loadQuarantine(quarantine).quarantine : [];
  const today = pinnedToday ?? new Date().toISOString().slice(0, 10);
  const runs: SuiteRun[] = [];
  const implementations: RunProvenance["implementations"] = [];
  for (const spec of adapters) {
    const probe = await makeAdapter(spec, timeoutMs);
    try {
      const caps = await probe.capabilities();
      // Essential governance (decision 39): recorded for every run, also when the adapter states none (unreadable, GOV-NOT-PROBED).
      implementations.push({ spec, capabilities: caps, essentialGovernance: resolveEssential(caps, makeActors()).record });
      const unknown = unknownOptionalNames(caps.optional);
      if (unknown.length > 0) {
        const msg = `${caps.name}: declares unknown optional capability name(s) ${unknown.join(", ")} (not in OPTIONAL_CAPABILITIES; vectors needing a misspelt name SKIP)`;
        if (strict) throw new Error(`--strict: ${msg}`);
        console.error(`warning: ${msg}`);
      }
      console.log(`${caps.name}: adapter contract ${caps.contractVersion ?? "not stated"} (suite ${CONTRACT_VERSION})`);
    } finally {
      await closeAdapter(probe);
    }
    // Tier 2 also runs for an implementation that does not claim `attested`: it executes only the named profile sub-groups (docs/04 section 3.1).
    const tiers: Tier[] = tier !== undefined ? [tier] : [1, 2];
    const rec = implementations[implementations.length - 1]!;
    for (const t of tiers) {
      const adapter = await makeAdapter(spec, timeoutMs);
      try {
        runs.push(await runSuite({ adapter, suite, tier: t, exceptions: excs, quarantine: quar, specFlags: loadSpecFlags(), today, fixtureRoot: join(vectors, "imported"), ...(salt === undefined ? {} : { salt }), ...(window === undefined ? {} : { window }), rebase, channels, drift: { kit: defaultKitRoot(kit), suite: SUITE_ROOT }, ...(minQuietMs === undefined ? {} : { minQuietMs }), ...(allowEffects === undefined ? {} : { allowEffects }), deriveEffects: true }));
      } finally {
        await closeAdapter(adapter);
      }
      // The adapter honesty check runs in each tier run; run.json records the first one's outcome.
      const probe = runs[runs.length - 1]!.essentialProbe;
      if (rec.essentialProbe === undefined && probe !== undefined) rec.essentialProbe = probe;
      const quiet = runs[runs.length - 1]!.quietPeriod;
      if (rec.quietPeriod === undefined && quiet !== undefined) rec.quietPeriod = quiet;
    }
  }
  for (const r of runs) {
    // headline counts: gating (registry) vectors only; advisory channels are printed apart below
    const c: Record<string, number> = {};
    for (const x of r.results.filter((y) => (y.channel ?? "registry") === "registry")) c[x.status] = (c[x.status] ?? 0) + 1;
    console.log(`${r.impl} tier ${r.tier}: ${JSON.stringify(c)} (clock ${r.clockMode ?? "set"}, minimum quiet ${r.quietPeriod === undefined ? "not recorded" : `${r.quietPeriod.minimumMs} ms (${r.quietPeriod.basis})`}, salt ${r.salt === "" ? "none" : r.salt ?? "none"}${(r.windowDifference ?? []).length > 0 ? `, window difference: ${r.windowDifference!.join(", ")}` : ""})`);
    const adv = r.results.reduce((n, y) => n + (y.advisories ?? []).length, 0);
    console.log(`  advisories: ${adv}${adv === 0 ? "" : ` (${r.results.filter((y) => (y.advisories ?? []).length > 0).map((y) => y.id).join(", ")})`}`);
    const excl = Object.entries(r.excludedByChannel ?? {}).filter(([, ids]) => ids.length > 0);
    if (r.excludedFromRun !== undefined) console.log(`  excluded from every run: ${Object.keys(r.excludedFromRun).length} (${[...new Set(Object.values(r.excludedFromRun))].join("; ")})`);
    if (r.retired !== undefined) console.log(`  retired ids (tombstones, never run): ${Object.keys(r.retired).join(", ")}`);
    if (excl.length > 0) console.log(`  excluded by channel: ${excl.map(([ch, ids]) => `${ch} ${ids.length}`).join(", ")}`);
    if ((r.excludedByTier ?? []).length > 0) console.log(`  excluded by tier (not SKIP): ${r.excludedByTier!.length} (${[...new Set(r.excludedByTier!.map((e) => e.reason))].join("; ")})`);
    for (const ch of advisoryChannelsOf([r])) {
      const ac: Record<string, number> = {};
      for (const x of r.results.filter((y) => y.channel === ch)) ac[x.status] = (ac[x.status] ?? 0) + 1;
      console.log(`  ADVISORY ${ch} (not an endorsement of any specification; not in the totals above): ${JSON.stringify(ac)}`);
    }
    for (const x of r.results.filter((y) => y.status === "SPEC-CHANGED")) console.log(`  SPEC-CHANGED (advisory, not counted, not in the exit code) ${x.id}: ${x.reason ?? ""}`);
    for (const x of r.results.filter((y) => y.status === "SKIPPED-SAFETY")) console.log(`  SKIPPED-SAFETY (not run, not a pass or a fail) ${x.id}`);
    for (const x of r.results.filter((y) => y.status === "QUARANTINED")) console.log(`  QUARANTINED (advisory, not counted, not in the exit code) ${x.id}: ${x.reason ?? ""}`);
    for (const x of r.results.filter((y) => y.status === "FAIL")) {
      console.log(`  ${(x.channel ?? "registry") === "registry" ? "" : "ADVISORY "}FAIL ${x.id}: ${x.reason ?? ""} ${(x.failures ?? []).join("; ")}`);
    }
    const p = r.essentialProbe;
    if (p !== undefined) console.log(`  essential governance honesty check: ${p.result}${p.declared === undefined ? "" : ` (declared ${p.declared})`}${p.reason === undefined ? "" : `: ${p.reason}`}${p.result === "mismatch" ? `\n  GOV-DECLARATION-MISMATCH (counts as FAIL): ${p.finding!.text}` : ""}`);
    for (const d of r.drift ?? []) console.log(`  spec-drift (advisory, needs human review) ${d.ref}: ${d.reason}, ${d.vectors.length} vector(s)`);
  }
  const matrix = buildMatrix(runs);
  const advisory = advisoryChannelsOf(runs);
  if (out !== undefined) {
    mkdirSync(out, { recursive: true });
    const gating = runs.map((r) => ({ ...r, results: r.results.filter((x) => (x.channel ?? "registry") === "registry") }));
    writeFileSync(join(out, "conformance-matrix.json"), JSON.stringify(matrix, null, 2) + "\n");
    writeFileSync(join(out, "conformance-matrix.md"), matrixMarkdown(matrix));
    writeFileSync(join(out, "results.json"), JSON.stringify(advisory.length === 0 ? runs : gating, null, 2) + "\n");
    const provenance = buildProvenance({ root, today, pinned: pinnedToday !== undefined, suite, vectorsDir: vectors, exceptionsFile: exceptions, quarantineFile: quarantine, implementations, argv });
    writeFileSync(join(out, "run.json"), JSON.stringify(provenance, null, 2) + "\n");
    if (advisory.length > 0) {
      const adir = `${out}-advisory`;
      mkdirSync(adir, { recursive: true });
      for (const ch of advisory) {
        const am = buildMatrix(runs, ch);
        writeFileSync(join(adir, `conformance-matrix-${ch}.json`), JSON.stringify(am, null, 2) + "\n");
        writeFileSync(join(adir, `conformance-matrix-${ch}.md`), matrixMarkdown(am));
      }
      writeFileSync(join(adir, "results-advisory.json"), JSON.stringify(runs.map((r) => ({ ...r, results: r.results.filter((x) => (x.channel ?? "registry") !== "registry") })), null, 2) + "\n");
      writeFileSync(join(adir, "README.md"), `# Advisory results (channels ${advisory.join(", ")})\n\n${advisory.map((c) => ADVISORY_BANNER(c)).join("\n\n")}\n`);
    }
  } else {
    console.log("\n" + matrixMarkdown(matrix));
    for (const ch of advisory) console.log("\n" + matrixMarkdown(buildMatrix(runs, ch)));
  }
  return exitCode(runs);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error((err as Error).message);
    process.exit(2);
  },
);
