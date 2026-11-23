// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "../scripts/at-a-glance.ts";
import { buildModel, classify, loadCatalog, loadEssential, loadRuns, recordedPlatform, skipClassOf, type SkipRule } from "../src/glance/model.ts";
import { essentialLabel } from "../src/glance/render.ts";
import { experimentalNote } from "../src/glance/docs.ts";
import { HAVE_RUNS, NEEDS_RUNS, RESULTS, tempDir } from "./helpers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = HAVE_RUNS ? generate(root, RESULTS) : { md: "", html: "" };

test("generation is deterministic", NEEDS_RUNS, () => {
  const again = generate(root, RESULTS);
  assert.equal(again.md, out.md);
  assert.equal(again.html, out.html);
});

test("output has no absolute local paths, personal or tooling mentions, or external assets", NEEDS_RUNS, () => {
  for (const text of [out.md, out.html]) {
    assert.doesNotMatch(text, /(^|[\s("'=])\/(srv|home|var|tmp|usr|Users)\//);
    assert.doesNotMatch(text, /\b(claude|anthropic|chatgpt|openai|copilot|scratch)\b/i);
    assert.doesNotMatch(text, new RegExp("\\b(bren" + "dan|alberto|bam)\\b", "i")); // no mention of the first name
    assert.doesNotMatch(text, /\b(better|worse|winner|best|leaderboard)\b/i);
  }
  assert.doesNotMatch(out.html, /(src|href)="https?:\/\//);
  assert.doesNotMatch(out.html, /<script/i);
  assert.match(out.html, /prefers-color-scheme:dark/);
  assert.match(out.html, /name="viewport"/);
});

test("page states the required framing", NEEDS_RUNS, () => {
  assert.match(out.md, /Not a ranking/);
  assert.match(out.md, /No live cross-platform exchange has been recorded/);
  assert.match(out.md, /Advisory|advisory/);
});

test("counts match the run files", NEEDS_RUNS, () => {
  const m = buildModel(root, RESULTS);
  const blocks = loadRuns(RESULTS).filter((b) => b.tier === 1);
  const vti = m.subjects.find((s) => s.cfg.id === "vti")!.surfaces.find((s) => s.cfg.id === "vti-inprocess")!;
  const c = vti.byMeasure["core"]!;
  const reg = blocks.find((b) => b.run === "2026-11-19-final-upstream-vti-inprocess" && b.file.endsWith("core/results.json"))!;
  // the page measures by the current catalog: a vector since retagged (candidate) or excluded from every run is not in the registry measure, whatever the older run file recorded
  const cat = loadCatalog(root);
  const t1 = reg.results.filter((r) => r.tier === 1 && cat.get(r.id)?.channel === "registry" && cat.get(r.id)?.excludedFromRun !== true);
  const n = (s: string): number => t1.filter((r) => r.status === s).length;
  assert.equal(c.pass, n("PASS"));
  assert.equal(c.clarify, n("CLARIFY"));
  assert.equal(c.knownFail, n("KNOWN-FAIL"));
  assert.equal(c.total, t1.length);
  assert.equal(c.pass + c.clarify + c.knownFail + c.fail + c.notApplicable + c.notReached + c.versionMismatch + c.unclassified, c.total);
  for (const s of m.subjects) for (const sf of s.surfaces) for (const k of Object.values(sf.byMeasure)) assert.equal(k.ran + k.skip, k.total);
});

test("skip classes: rules classify known reasons, unknown reasons stay unclassified", () => {
  const rules = (JSON.parse(readFileSync(join(root, "results", "skip-classes.json"), "utf8")) as { rules: SkipRule[] }).rules;
  const served = new Set(["acl/list"]);
  assert.equal(classify("type not declared: https://trusttasks.org/spec/acl/list/0.1", "x", rules, served), "version-mismatch");
  assert.equal(classify("type not declared: https://trusttasks.org/spec/oob/start/0.1", "x", rules, served), "not-applicable");
  assert.equal(classify("missing capability optional:restart", "x", rules, served), "not-reached");
  assert.equal(classify("something nobody has seen", "x", rules, served), "unclassified");
  // Essential governance (decision 39): a declared set of one or k of one makes a check not applicable; an unreadable or undrivable E is not reached.
  assert.equal(classify("authority set of one", "x", rules, served), "not-applicable");
  assert.equal(classify("declared minApprovals of one: the begin completes the ceremony", "x", rules, served), "not-applicable");
  assert.equal(classify("authority set unreadable: the adapter states no essential governance (capabilities.governance.essential)", "x", rules, served), "not-reached");
  assert.equal(classify("authority set not drivable by the harness: authority set member did:example:1 is not a harness actor", "x", rules, served), "not-reached");
});

test("the three kinds of not tested stay separate in the grid legend", NEEDS_RUNS, () => {
  for (const w of ["Not applicable", "Not reached yet", "Different version"]) assert.ok(out.md.includes(w));
});

test("sweep: every not-reached SKIP on a re-run surface names a specific, checked reason (never only that the adapter lacks a capability)", NEEDS_RUNS, () => {
  const rules = (JSON.parse(readFileSync(join(root, "results", "skip-classes.json"), "utf8")) as { rules: SkipRule[] }).rules;
  // generic rules: their reason says only that a capability is missing; a not-reached SKIP may use one only through a surface-scoped rule
  const generic = new Set(["adapter-capability", "attested-option", "clock", "ceremony-status-missing", "pushed-observation", "receipt", "ceremony", "proof-verify", "no-emit"]);
  const m = buildModel(root, RESULTS);
  const bad: string[] = [];
  for (const sf of m.subjects.flatMap((s) => s.surfaces)) {
    if (sf.recordedEarlier) continue; // older recordings keep their own wording; they are labelled as such
    for (const r of sf.results) {
      if (r.cls !== "not-reached") continue;
      const rule = rules.find((x) => (x.surfaces === undefined || x.surfaces.includes(sf.cfg.id)) && new RegExp(x.match, "i").test(r.reason));
      if (rule === undefined || generic.has(rule.id)) bad.push(`${sf.cfg.id} ${r.id}: ${r.reason}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("vectors excluded from run are not counted as checks a run missed", NEEDS_RUNS, () => {
  const m = buildModel(root, RESULTS);
  const ref = m.subjects.flatMap((s) => s.surfaces).find((s) => s.cfg.id === "reference")!;
  // The seven vectors excluded from run are never counted. The recorded reference run predates the three per-declared-E vectors (CER-017..019,
  // decision 39), so at most those three are reported as added since the run (none once the reference run is re-recorded).
  const note = ref.earlierWhy.map((w) => /^(\d+) checks added to the suite since the run/.exec(w)).find((x) => x !== null);
  assert.ok(note === undefined || note[1] === "3", ref.earlierWhy.join("; "));
});

test("essential governance: a declared set of one is labelled single-party; runs without the record show E not recorded", () => {
  // Re-recorded surfaces carry the record: the VTA in process declares a set of one (single-party). Surfaces recorded before
  // run.json (recorded run folders are not edited) still show "E not recorded".
  if (HAVE_RUNS) {
    assert.match(out.md, /single-party/);
    // Every current surface now carries the record (the live row was re-recorded with run.json on 2026-11-20), so no run shows "E not recorded"; the wording is checked on synthetic runs below.
  }
  const t = tempDir();
  try {
    const rec = (name: string, e: Record<string, unknown>, probe?: Record<string, unknown>) => {
      mkdirSync(join(t.dir, "runs", name, "core"), { recursive: true });
      writeFileSync(join(t.dir, "runs", name, "core", "run.json"), JSON.stringify({ implementations: [{ spec: "x", capabilities: { name: "impl" }, essentialGovernance: e, ...(probe === undefined ? {} : { essentialProbe: probe }) }] }));
    };
    rec("2026-01-01-one", { source: "platform-config", authority: ["$A"], minApprovals: 1, singleParty: true });
    rec("2026-01-02-fixed", { source: "fixed-rule", authority: ["$A", "$X", "$B"], minApprovals: 2, singleParty: false, finding: "GOV-FIXED" });
    rec("2026-01-03-none", { source: "unreadable", authority: [], minApprovals: null, singleParty: false, finding: "GOV-NOT-PROBED", reason: "no setting" });
    const label = (runs: string[]) => essentialLabel({ essential: loadEssential(t.dir, runs, "impl") } as Parameters<typeof essentialLabel>[0]);
    assert.match(label(["2026-01-01-one"]), /single-party/);
    assert.match(label(["2026-01-02-fixed"]), /^2 of an authority set of 3, declared from fixed rule \(GOV-FIXED/);
    assert.match(label(["2026-01-03-none"]), /^E unreadable \(GOV-NOT-PROBED\): no setting/);
    assert.match(label(["2026-01-01-one", "2026-01-02-fixed"]), /^2 of/); // the newest run of the surface wins
    assert.match(label(["2026-01-04-missing"]), /^E not recorded/);
    assert.match(label(["2026-01-01-one"]), /honesty check not recorded$/);
    // the adapter honesty check (run.json implementations[].essentialProbe)
    rec("2026-01-05-honest", { source: "harness-configured", authority: ["$A", "$X"], minApprovals: 2, singleParty: false }, { result: "consistent", checks: [] });
    rec("2026-01-06-lie", { source: "platform-config", authority: ["$A"], minApprovals: 1, singleParty: true }, { result: "mismatch", checks: [{ check: "completion-at-k", result: "mismatch", observed: "the ceremony did not complete at the declared k-th distinct approval (1)" }] });
    rec("2026-01-07-noceremony", { source: "platform-config", authority: ["$A"], minApprovals: 1, singleParty: true }, { result: "not-run", checks: [], reason: "the platform offers no ceremony" });
    assert.match(label(["2026-01-05-honest"]), /found the behaviour consistent/);
    assert.match(label(["2026-01-06-lie"]), /^\*\*GOV-DECLARATION-MISMATCH\*\* \(counts as FAIL.*did not complete at the declared k-th.*single-party/);
    assert.match(label(["2026-01-07-noceremony"]), /honesty check not run: the platform offers no ceremony$/);
  } finally {
    t.cleanup();
  }
});

test("a measurement recorded with a platform gates that platform: it carries the platform's exceptions and cannot stay an experimental note", () => {
  const t = tempDir();
  try {
    const run = (folder: string, caps: Record<string, unknown>) => {
      mkdirSync(join(t.dir, "runs", folder), { recursive: true });
      writeFileSync(join(t.dir, "runs", folder, "run.json"), JSON.stringify({ implementations: [{ spec: "x", capabilities: caps }] }));
      writeFileSync(join(t.dir, "runs", folder, "results.json"), JSON.stringify([{ impl: caps.name, tier: 1, results: [] }]));
    };
    run("2026-01-01-kw/v2-core", { name: "keyring-wallet-didcomm-v2", platform: "keyring-wallet" });
    run("2026-01-01-kw/old-v2", { name: "keyring-wallet-didcomm-v2" });
    assert.equal(recordedPlatform(t.dir, ["2026-01-01-kw"], "keyring-wallet-didcomm-v2"), "keyring-wallet");
    assert.equal(recordedPlatform(t.dir, ["2026-01-01-kw/old-v2"], "keyring-wallet-didcomm-v2"), undefined);
    assert.equal(recordedPlatform(t.dir, ["2026-01-02-absent"], "keyring-wallet-didcomm-v2"), undefined);
    const e = { label: "v2", impl: "keyring-wallet-didcomm-v2", folder: "2026-01-01-kw/v2-core", compareWith: "2026-01-01-kw/old-v2", why: "x." };
    assert.throws(() => experimentalNote(t.dir, "", e), /declares platform keyring-wallet .* list it as a surface/);
    assert.match(experimentalNote(t.dir, "", { ...e, folder: "2026-01-01-kw/old-v2" }), /^\*\*Not gating, experimental: v2\*\*/);
  } finally {
    t.cleanup();
  }
});

test("not applicable only from a cited notOffered entry on runs recorded under the rule; older runs keep their class (R8)", () => {
  const rules = (JSON.parse(readFileSync(join(root, "results", "skip-classes.json"), "utf8")) as { rules: SkipRule[] }).rules;
  const served = new Set<string>();
  const notDeclared = { id: "X-001", tier: 1, status: "SKIP" as const, reason: "type not declared: https://trusttasks.org/spec/oob/start/0.1" };
  const offered = { id: "X-002", tier: 1, status: "SKIP" as const, reason: "not offered by the implementation: no handler (https://trusttasks.org/spec/oob/start/0.1)" };
  const old = {};
  const ruled = { notApplicableRule: "cited-notOffered" };
  assert.equal(skipClassOf(notDeclared, old, "x", rules, served), "not-applicable");
  assert.equal(skipClassOf(offered, old, "x", rules, served), "not-applicable");
  assert.equal(skipClassOf(notDeclared, ruled, "x", rules, served), "not-reached");
  assert.equal(skipClassOf(offered, ruled, "x", rules, served), "not-reached");
  assert.equal(skipClassOf({ ...offered, evidence: "platform 1234: src/handlers.rs:10" }, ruled, "x", rules, served), "not-applicable");
  assert.equal(skipClassOf({ ...offered, evidence: "" }, ruled, "x", rules, served), "not-reached");
  // the other classes are not touched by the rule
  assert.equal(skipClassOf({ ...notDeclared, reason: "missing capability optional:restart" }, ruled, "x", rules, served), "not-reached");
  assert.equal(skipClassOf({ ...notDeclared, reason: "type not declared: https://trusttasks.org/spec/acl/list/0.1" }, ruled, "x", rules, new Set(["acl/list"])), "version-mismatch");
});

test("tier-excluded vectors are shown apart from SKIP, read from older runs (tier SKIP reasons) and newer ones (excludedByTier) alike (R9)", NEEDS_RUNS, () => {
  const m = buildModel(root, RESULTS);
  const ref = m.subjects.flatMap((s) => s.surfaces).find((sf) => sf.cfg.id === "reference")!;
  const fromOld = new Set(loadRuns(RESULTS).filter((b) => b.tier === 1 && ref.runs.includes(b.run) && b.impl === "reference").flatMap((b) => [...(b.excludedByTier ?? []), ...b.results.filter((r) => r.status === "SKIP" && /^(tier [0-9] not selected|only runs at tier [0-9])$/.test(r.reason ?? "")).map((r) => r.id)]));
  assert.ok(fromOld.size > 0);
  assert.equal(ref.excludedByTier, fromOld.size);
  assert.ok(ref.results.every((r) => r.status !== "SKIP" || !/^(tier [0-9] not selected|only runs at tier)/.test(r.reason)), "no Tier 1 result of the surface is a tier SKIP");
  assert.match(readFileSync(join(root, "results", "platforms", "vti.md"), "utf8"), /Excluded by tier: \d+ vectors outside the headline Tier 1/);
});
