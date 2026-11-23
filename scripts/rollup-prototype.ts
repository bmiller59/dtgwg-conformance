// SPDX-License-Identifier: Apache-2.0
// Generator CLI for the scope-relative roll-up (pure logic and input readers: src/glance/rollup.ts).
//
// Usage (read-only on its inputs; writes only --out / --md):
//   node --experimental-strip-types scripts/rollup-prototype.ts --results <results dir> [--advisory <advisory run root>]...
//        [--ceremony-extra <dir>] [--promotions <file>] [--no-promotions] [--no-run-map] [--project-promotions] [--out <file.json>] [--md <file.md>]
// Defaults: gating results come from the run map (results/platform-run-map.json) read under <results dir>, and the promotions come from
// vectors-src/promotions.json, so a promoted gating run feeds the roll-up with no flag and no symlink.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRunMap } from "../src/coverage/matrix/runmap.ts";
import { activePromotions } from "../src/vectors/promotion.ts";
import { gatingRunFolders, loadPromotedIds, outcomesFromFiles, COMPONENTS, CEREMONY_PARTIES, DEFAULT_THRESHOLDS, ORIGINAL, addTally, advisoryLine, ceremonyFor, completion, declaredCaps, emptyTally, evidenceOfAdvisoryRecord, focusIndex, frameworkItems, headline, mergeItems, promoteInMatrix, rd, readCeremonyRows, rollup, scopeFromDeclared, statesFor, vectorItemKeys, walkFiles } from "../src/glance/rollup.ts";
import type { Matrix, Outcome, RunJsonCaps, SkipClass, Status } from "../src/glance/rollup.ts";

async function main(argv: string[]): Promise<void> {
  const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const args = (k: string): string[] => argv.flatMap((a, i) => (a === k && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
  const results = arg("--results");
  if (results === undefined) throw new Error("--results <results dir> is required (the assembled set: scripts/assemble-results-set.ts)");
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const { buildModel } = await import("../src/glance/model.ts");
  const { classify } = await import("../src/glance/model.ts");
  const model = buildModel(root, results);
  const matrix = rd(join(root, "results", "coverage", "matrix.json")) as Matrix;
  // promotions (docs/33): vectors-src/promotions.json by default; --promotions <file> overrides, --no-promotions turns them off
  const promoFile = args("--promotions")[0];
  const promoted: Set<string> = argv.includes("--no-promotions")
    ? new Set()
    : promoFile !== undefined ? new Set(activePromotions(rd(promoFile) as never).keys()) : loadPromotedIds(root);
  promoteInMatrix(matrix, promoted);
  const useRunMap = !argv.includes("--no-run-map");
  const runMap = useRunMap ? loadRunMap(join(root, "results", "platform-run-map.json")) : null;
  const projected = process.argv.includes("--project-promotions");
  const mvec = new Map(matrix.vectors.map((v) => [v.id, v]));
  const exc = (rd(join(root, "exceptions", "exceptions.json")) as { exceptions: { impl: string; vector: string; class?: string }[] }).exceptions;
  const findings = (rd(join(root, "results", "findings.json")) as { findings: { impl: string; vector: string; class: string | null }[] }).findings;
  // the class of a recorded difference: the exception (or finding) for this implementation, else any recorded for the vector
  const diffClassOf = (vector: string, impl: string, status: Status): { diffClass?: string; finding?: boolean } => {
    if (status === "FAIL") {
      const f = findings.find((x) => x.vector === vector && x.impl === impl) ?? findings.find((x) => x.vector === vector);
      return f === undefined ? {} : { finding: true, ...(f.class === null ? {} : { diffClass: f.class }) };
    }
    if (status !== "KNOWN-FAIL") return {};
    const e = exc.find((x) => x.vector === vector && x.impl === impl) ?? exc.find((x) => x.vector === vector);
    return e?.class === undefined ? {} : { diffClass: e.class };
  };
  const skipRules = (rd(join(root, "results", "skip-classes.json")) as { rules: { id: string; match: string; surfaces?: string[]; class: string; note: string }[] }).rules;
  const runsRoot = join(results, "runs");
  // advisory run roots, newest first; a vector id is read from the first root and folder that holds it
  const advisoryRoots = args("--advisory");
  // framework rule groups: framework vectors that name no task (discovery vectors name their task and count there)
  const frameworkGroups = [...new Set(matrix.vectors.filter((v) => v.set === "framework" && v.tasks.length === 0).map((v) => v.group))].sort();
  // every key some vector measures, per role: an item without one is `no-check`
  // (gating: registry-channel vectors only, so a task whose only checks at the latest version are advisory reads `no-check` on the gating line)
  const checkKeys = new Set<string>();
  const gatingCheckKeys = new Set<string>();
  for (const v of matrix.vectors) for (const k of vectorItemKeys(matrix, v, v.id, v.group)) { checkKeys.add(k); if (v.channel === "registry") gatingCheckKeys.add(k); }

  const cer = readCeremonyRows([join(results, "ceremonies"), ...args("--ceremony-extra")]);
  const report: Record<string, unknown>[] = [];
  const md: string[] = [];
  const { focusOf, byUri } = focusIndex(matrix);

  for (const c of COMPONENTS) {
    if (c.kind === "not-reachable") {
      report.push({ id: c.id, name: c.name, kind: c.kind, note: c.note });
      md.push(`### ${c.name}`, "", `Not reachable by the suite: no percentage. ${c.note ?? ""}`, "");
      continue;
    }
    const sfs = c.surfaces.map((s) => model.subjects.find((x) => x.cfg.id === s.subject)?.surfaces.find((y) => y.cfg.id === s.surface));
    if (sfs.some((s) => s === undefined)) throw new Error(`surface missing for ${c.id}`);
    const outcomes: Outcome[] = [];
    let caps: RunJsonCaps = {};
    const runs: string[] = [];
    for (const sf of sfs) {
      runs.push(...sf!.runs);
      const cap = declaredCaps(runsRoot, sf!.runs, sf!.cfg.impl);
      caps = { supportedTypes: [...(caps.supportedTypes ?? []), ...(cap.supportedTypes ?? []), ...(cap.unlistedTypes ?? [])], emits: [...(caps.emits ?? []), ...(cap.emits ?? [])], ceremonyRoles: [...(caps.ceremonyRoles ?? []), ...(cap.ceremonyRoles ?? [])] };
      for (const r of sf!.results) {
        if (r.cls === "out-of-tier" || r.status === "QUARANTINED" || r.status === "SPEC-CHANGED") continue;
        outcomes.push({ id: r.id, status: r.status, cls: r.cls, evidence: r.channel === "registry" ? "gating" : "advisory", itemKeys: vectorItemKeys(matrix, mvec.get(r.id), r.id, r.group), ...diffClassOf(r.id, sf!.cfg.impl, r.status) });
      }
    }
    // gating runs the run map names for this component (promote folders and the like), then the explicit advisory roots; first record of a vector wins
    const have = new Set(outcomes.map((o) => o.id));
    const rctx = { promoted, projected, have, skipClass: (reason: string) => classify(reason, c.surfaces[0]?.surface ?? "", skipRules, new Set()) as SkipClass, keysOf: (id: string, group: string) => vectorItemKeys(matrix, mvec.get(id), id, group), diffClassOf: (id: string, status: Status) => diffClassOf(id, sfs[0]!.cfg.impl, status) };
    const files = [
      ...(useRunMap ? gatingRunFolders(runMap!, c).flatMap((f) => [...walkFiles(join(results, f), "results-advisory.json"), ...walkFiles(join(results, f), "results.json")]) : []),
      ...advisoryRoots.flatMap((ar) => c.advisory.flatMap((f) => [...walkFiles(join(ar, f), "results-advisory.json"), ...walkFiles(join(ar, f), "results.json")])),
    ];
    outcomes.push(...outcomesFromFiles(files, rctx));
    const recv = scopeFromDeclared(matrix, "receive", caps.supportedTypes ?? [], "adapter declares it served (run.json supportedTypes)");
    const send = scopeFromDeclared(matrix, "send", caps.emits ?? [], "adapter declares it sent (run.json emits)");
    const receives = recv.items.length > 0 || c.id === "reference";
    let items = mergeItems(recv.items, send.items, receives ? frameworkItems(frameworkGroups) : []);
    if (c.id === "reference") {
      // the oracle's scope is every focus item the suite holds a check for, in either role (it serves and emits every version a vector names)
      const all = matrix.tasks.filter((t) => t.focus === "focus").map((t) => t.typeUri);
      items = mergeItems(scopeFromDeclared(matrix, "receive", all, "oracle: every focus version with a check").items, scopeFromDeclared(matrix, "send", all, "oracle: every focus version with a check").items, frameworkItems(frameworkGroups)).filter((i) => checkKeys.has(i.key));
    }
    const roles = [...new Map((caps.ceremonyRoles ?? []).map((r) => [`${r.ceremony}:${r.roles.join(",")}`, r])).values()];
    // source scan comparison (newer commits than measured; never enters the denominator)
    let sourceOnly: string[] = [];
    if (c.sourceScan !== undefined) {
      const declaredSlugs = new Set(items.map((i) => i.slug));
      const src = matrix.tasks.filter((t) => (c.sourceScan!.vtiServed !== undefined && t.vti.served.includes(c.sourceScan!.vtiServed)) || (c.sourceScan!.kw === true && t.kw.referenced));
      sourceOnly = [...new Set(src.map((t) => focusOf(t.slug)?.slug ?? t.slug).filter((s) => !declaredSlugs.has(s)))].sort();
    }
    const gStates = statesFor(items, outcomes, gatingCheckKeys, "gating");
    const bStates = statesFor(items, outcomes, checkKeys, "both");
    const gating = rollup(items, gStates, outcomes.filter((o) => o.evidence === "gating"));
    const withAdvisory = rollup(items, bStates, outcomes);
    // older versions (non-focus): one line, never headline
    const olderKeys = new Set(outcomes.flatMap((o) => o.itemKeys).filter((k) => k.endsWith("#older")));
    const olderRan = new Set(outcomes.filter((o) => o.status !== "SKIP").flatMap((o) => o.itemKeys).filter((k) => k.endsWith("#older")));
    const cr = ceremonyFor(c.id, cer.rows);
    // per family (detail): gating states
    const fam = new Map<string, Record<string, number>>();
    for (const it of items) {
      const f = it.slug.split("/")[0]!;
      const e = fam.get(f) ?? {};
      const s = gStates.get(it.key)!;
      e[s] = (e[s] ?? 0) + 1; e.total = (e.total ?? 0) + 1;
      fam.set(f, e);
    }
    const maturity: Record<string, number> = {};
    for (const it of items) maturity[`${it.maturity}/${it.sourceKind}`] = (maturity[`${it.maturity}/${it.sourceKind}`] ?? 0) + 1;
    const differing = items.filter((i) => gStates.get(i.key) === "differs" || gStates.get(i.key) === "unexplained").map((i) => i.key);
    const contradictions = items.filter((i) => gStates.get(i.key) === "declared-not-offered").map((i) => i.key);
    report.push({
      id: c.id, name: c.name, kind: c.kind, runs: [...new Set(runs)].sort(),
      scope: { items: items.length, receive: items.filter((i) => i.role === "receive" && !i.slug.startsWith("framework/")).length, send: items.filter((i) => i.role === "send").length, framework: items.filter((i) => i.slug.startsWith("framework/")).length, atLatest: items.filter((i) => i.atLatest).length, behind: items.filter((i) => !i.atLatest).length, outsideRegistry: [...recv.outside, ...send.outside].length, maturity, sourceOnlySlugs: sourceOnly.length, ceremonyRoles: roles },
      gating, withAdvisory,
      older: { itemsWithChecksRun: olderRan.size, itemsTouched: olderKeys.size },
      ceremony: { ...cr, completionOriginal: completion(cr.originalPartner), completionReference: completion(cr.referencePartner) },
      families: Object.fromEntries([...fam.entries()].sort()), differing, contradictions,
      // the detail view: every scope item with its gating and advisory-inclusive state and the declared versions
      items: items.map((i) => ({ key: i.key, declared: i.declaredVersions, gating: gStates.get(i.key), withAdvisory: bStates.get(i.key) })),
      headline: headline(c.name, gating, c.kind === "self-check" ? null : cr, c.kind),
      advisoryLine: advisoryLine(withAdvisory),
    });
    md.push(`### ${c.name}`, "", headline(c.name, gating, c.kind === "self-check" ? null : cr, c.kind), "", advisoryLine(withAdvisory), "");
  }
  // pair view: keyring-wallet x VTI, by group
  const pairs = cer.rows.filter((r) => r.parties.length === 2 && r.parties.some((p) => p.startsWith("kw")) && r.parties.some((p) => p.startsWith("vti")));
  const pairOut = pairs.map((r) => ({ row: r.row, parties: r.parties, originalPair: r.parties.every((p) => ORIGINAL.has(p)), groups: Object.fromEntries([...r.groups].map(([g, t]) => [g, { ...t, completion: completion(t) }])) }));
  const out = { format: "tt-rollup-prototype/0.1", generated: new Date().toISOString().slice(0, 10), inputs: { results, runMap: useRunMap ? "results/platform-run-map.json" : null, promotions: argv.includes("--no-promotions") ? null : promoFile ?? "vectors-src/promotions.json", promotedVectors: promoted.size, advisory: advisoryRoots, ceremonyExtra: args("--ceremony-extra"), matrix: matrix.inputs, ceremonyUnmapped: cer.unmapped }, thresholds: DEFAULT_THRESHOLDS, components: report, pairs: pairOut };
  void byUri;
  const o = arg("--out");
  if (o !== undefined) writeFileSync(o, JSON.stringify(out, null, 1) + "\n");
  const m = arg("--md");
  if (m !== undefined) writeFileSync(m, md.join("\n") + "\n");
  if (o === undefined && m === undefined) process.stdout.write(md.join("\n") + "\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
