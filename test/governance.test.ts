// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { GOV_MUTANTS } from "../src/adapters/reference/governance.ts";
import { bannedWordsIn, BANNED_WORDS, GOV_KINDS } from "../src/governance/findings.ts";
import type { GovKind } from "../src/governance/findings.ts";
import { loadProbes, runGovernance } from "../src/governance/probes.ts";
import { governanceJson, governanceMarkdown, GOV_BANNER } from "../src/governance/report.ts";
import type { EvidenceFile } from "../src/governance/report.ts";
import { currentDigest, SUITE_ROOT } from "../src/vectors/source.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { NEEDS_RUNS, RESULTS, ROOT, tempDir } from "./helpers.ts";
import { runsDir } from "../src/results-dir.ts";

const probes = loadProbes(join(SUITE_ROOT, "vectors", "governance"));
const evidence = JSON.parse(readFileSync(join(SUITE_ROOT, "results", "governance-evidence.json"), "utf8")) as EvidenceFile;

async function kinds(adapter: Adapter): Promise<Record<string, GovKind>> {
  const run = await runGovernance({ adapter, probes, salt: "test" });
  return Object.fromEntries(run.findings.map((f) => [f.probe, f.kind]));
}

describe("governance probes: data", () => {
  test("vectors/governance is exactly what scripts/generate-governance.ts produces (R15)", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-governance.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const committed = readdirSync(join(ROOT, "vectors", "governance")).sort();
      assert.deepEqual(readdirSync(join(dir, "o")).sort(), committed);
      for (const f of committed) assert.equal(readFileSync(join(dir, "o", f), "utf8"), readFileSync(join(ROOT, "vectors", "governance", f), "utf8"), f);
    } finally {
      cleanup();
    }
  });
  test("five probes, each a candidate (decision 79 by the project owner), cited, pinned, with no governance value of its own", () => {
    assert.equal(probes.length, 5);
    for (const p of probes) {
      assert.match(p.id, /^GOV-D-\d{3}$/);
      assert.equal(p.source.channel, "candidate", p.id);
      // the candidate rests on the suite-local declaration text (docs/17: drift tracks that document); tfRef names the draft TF task the probe drives
      assert.ok(p.spec.length >= 2 && p.source.ref === "suite:docs/17-governance-probes.md" && p.source.tfRef?.status === "draft", p.id);
      assert.match(p.source.pinnedDigest ?? "", /^sha256:[0-9a-f]{64}$/, p.id);
      assert.ok(p.spec.some((s) => /choice, never the suite's/.test(s)), `${p.id} states the principle`);
    }
    const text = readFileSync(join(SUITE_ROOT, "vectors", "governance", "gov.json"), "utf8") + readFileSync(join(SUITE_ROOT, "src", "governance", "probes.ts"), "utf8");
    // no built-in role name, authority role or quorum word appears as a value the probes use
    for (const word of ["admin", "moderator", "owner", "initiator", "reader", "monitor", "vetter", "member"]) assert.ok(!new RegExp(`["'\`]${word}["'\`]`, "i").test(text), `built-in role name ${word}`);
  });
  test("the pinned digests are current", () => {
    for (const p of probes) assert.equal(currentDigest(p.source.ref, { suite: SUITE_ROOT }), p.source.pinnedDigest, p.id);
  });
  test("evidence rows: verified, located, neutral, and every probe's evidence id exists", () => {
    assert.equal(evidence.notATestResult, true);
    assert.ok(evidence.rows.length >= 5);
    const ids = new Set(evidence.rows.map((r) => r.id));
    assert.equal(ids.size, evidence.rows.length);
    for (const r of evidence.rows) {
      assert.equal(r.verified, "V");
      assert.match(r.line, /^\d+(-\d+)?(, \d+(-\d+)?)*$/, r.id);
      assert.ok(r.file !== "" && r.commit !== "", r.id);
    }
    for (const p of probes) for (const e of p.evidence) assert.ok(ids.has(e), `${p.id} -> ${e}`);
    assert.deepEqual(bannedWordsIn(JSON.stringify(evidence)), []);
  });
  test("evidence file:line exists in a local checkout where one is present", () => {
    // Checkouts come from the environment (VTI_ROOT, KW_ROOT, TS_ROOT); a platform whose variable is unset is not checked.
    const roots: Record<string, string | undefined> = { VTI: process.env.VTI_ROOT, "keyring-wallet": process.env.KW_ROOT, truststackers: process.env.TS_ROOT };
    for (const r of evidence.rows) {
      const base = roots[r.platform];
      if (base === undefined || base === "" || r.id === "T6") continue;
      const path = join(base, r.file);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, "utf8").split("\n").length;
      for (const part of r.line.split(", ")) assert.ok(Number(part.split("-").pop()) <= lines, `${r.id} ${r.file}:${part}`);
    }
  });
});

describe("governance probes: behaviour against the reference", () => {
  test("a platform that takes and honours declarations: all honoured", async () => {
    const k = await kinds(new ReferenceAdapter({ governance: true }));
    assert.deepEqual(Object.values(k), Array(5).fill("GOV-HONOURED"));
  });
  test("an adapter that declares no governance path: not probed, never a negative finding", async () => {
    const k = await kinds(new ReferenceAdapter());
    assert.ok(Object.values(k).every((x) => x === "GOV-NOT-PROBED"));
    const run = await runGovernance({ adapter: new ReferenceAdapter(), probes, salt: "t" });
    assert.ok(run.findings.every((f) => /^governance-undeclared/.test(f.reason ?? "")));
  });
  test("declaration none and an adapter that reports unsupported are not probed", async () => {
    const base = new ReferenceAdapter({ governance: true });
    const none = Object.create(base) as ReferenceAdapter;
    none.capabilities = async () => {
      const c = await base.capabilities();
      return { ...c, governance: { ...c.governance, declaration: "none", reason: "no declaration surface" } };
    };
    const a = await runGovernance({ adapter: none, probes, salt: "t" });
    assert.ok(a.findings.every((f) => f.kind === "GOV-NOT-PROBED" && /no declaration surface/.test(f.reason ?? "")));
    const unsup = Object.create(base) as ReferenceAdapter;
    unsup.declareGovernance = async () => ({ status: "unsupported", reason: "no path" });
    const b = await runGovernance({ adapter: unsup, probes, salt: "t" });
    assert.ok(b.findings.every((f) => f.kind === "GOV-NOT-PROBED" && /no path/.test(f.reason ?? "")));
  });
  test("an adapter that lacks an item is not probed for the probes that need it", async () => {
    const base = new ReferenceAdapter({ governance: true });
    const noConsent = Object.create(base) as ReferenceAdapter;
    noConsent.capabilities = async () => {
      const c = await base.capabilities();
      return { ...c, governance: { ...c.governance, items: ["roles", "authority"] as ("roles" | "authority")[] } };
    };
    const k = await kinds(noConsent);
    assert.equal(k["GOV-D-004"], "GOV-NOT-PROBED");
    assert.equal(k["GOV-D-001"], "GOV-HONOURED");
  });
  test("a platform that rejects a declaration is reported as not applied", async () => {
    const base = new ReferenceAdapter({ governance: true });
    const rej = Object.create(base) as ReferenceAdapter;
    rej.declareGovernance = async () => ({ status: "rejected", reason: "role set is read only" });
    const k = await kinds(rej);
    assert.equal(k["GOV-D-001"], "GOV-FIXED");
    assert.equal(k["GOV-D-003"], "GOV-FIXED");
  });
  test("the reference's default state is unchanged: governance is off and the plain family answers as before", async () => {
    const a = new ReferenceAdapter();
    const c = await a.capabilities();
    assert.equal(c.governance?.declaration, undefined);
    assert.ok(!c.optional.includes("governance.declare"));
  });
});

describe("governance probes: mutants prove the probes are not vacuous", () => {
  const expected: Record<keyof typeof GOV_MUTANTS, Partial<Record<string, GovKind>>> = {
    govIgnoreDeclaration: { "GOV-D-001": "GOV-FIXED", "GOV-D-003": "GOV-FIXED", "GOV-D-004": "GOV-FIXED" },
    govAssertDefault: { "GOV-D-002": "GOV-DEFAULT" },
    govFixedAuthority: { "GOV-D-001": "GOV-FIXED", "GOV-D-003": "GOV-FIXED" },
    govImpliedPrincipal: { "GOV-D-005": "GOV-DEFAULT" },
    govConsentOmitted: { "GOV-D-004": "GOV-DEFAULT" },
    govConsentFixedOne: { "GOV-D-004": "GOV-FIXED" },
    govListsOtherRole: { "GOV-D-001": "GOV-FIXED" },
  };
  for (const [m, want] of Object.entries(expected)) {
    test(m, async () => {
      const k = await kinds(new ReferenceAdapter({ governanceMutants: [m] }));
      for (const [probe, kind] of Object.entries(want)) assert.equal(k[probe], kind, `${m} on ${probe}`);
      // a mutant changes only the probes it should: the rest stay honoured
      for (const [probe, kind] of Object.entries(k)) if (!(probe in want)) assert.equal(kind, "GOV-HONOURED", `${m} should leave ${probe} honoured`);
    });
  }
  test("every governance mutant is exercised here", () => assert.deepEqual(Object.keys(expected).sort(), Object.keys(GOV_MUTANTS).sort()));
});

describe("governance wording", () => {
  test("the lint bites", () => {
    for (const w of ["wrong", "bad", "violates governance", "non-compliant", "fails governance", "weak", "ranking", "best platform"]) assert.notDeepEqual(bannedWordsIn(`the platform is ${w}`), [], w);
    assert.deepEqual(bannedWordsIn("a role was refused with code permissionDenied"), []);
    assert.deepEqual(bannedWordsIn("<!-- lint:skip -->wrong bad<!-- /lint:skip --> neutral"), []);
    assert.ok(BANNED_WORDS.length >= 20);
  });
  test("every generated finding, the banner and the report are free of banned words, whatever the outcome", async () => {
    const runs = [];
    for (const a of [new ReferenceAdapter(), new ReferenceAdapter({ governance: true }), ...Object.keys(GOV_MUTANTS).map((m) => new ReferenceAdapter({ governanceMutants: [m] }))]) runs.push(await runGovernance({ adapter: a, probes, salt: "w" }));
    const kindsSeen = new Set(runs.flatMap((r) => r.findings.map((f) => f.kind)));
    // GOV-DECLARATION-MISMATCH comes from the adapter honesty check, not from these probes (test/honesty.test.ts lints its text).
    for (const k of GOV_KINDS.filter((x) => x !== "GOV-DECLARATION-MISMATCH")) assert.ok(kindsSeen.has(k), `${k} seen`);
    const text = governanceMarkdown(runs, evidence) + JSON.stringify(governanceJson(runs)) + GOV_BANNER;
    assert.deepEqual(bannedWordsIn(text), []);
    for (const f of runs.flatMap((r) => r.findings)) assert.match(f.text, /makes? no statement|reports nothing/, f.probe);
  });
  test("probe text and the governance documents are free of banned words", () => {
    assert.deepEqual(bannedWordsIn(readFileSync(join(SUITE_ROOT, "vectors", "governance", "gov.json"), "utf8")), []);
    const doc = join(SUITE_ROOT, "docs", "17-governance-probes.md");
    assert.ok(existsSync(doc));
    assert.deepEqual(bannedWordsIn(readFileSync(doc, "utf8")), []);
  });
  test("the recorded governance run folders are free of banned words", NEEDS_RUNS, () => {
    const runs = runsDir(RESULTS);
    const dirs = readdirSync(runs).filter((d) => d.includes("governance-probe"));
    assert.ok(dirs.length >= 4);
    for (const d of dirs) for (const f of readdirSync(join(runs, d))) assert.deepEqual(bannedWordsIn(readFileSync(join(runs, d, f), "utf8")), [], `${d}/${f}`);
  });
  test("the advisory output keeps platforms in alphabetical order and carries no totals of the gating kind", async () => {
    const runs = [await runGovernance({ adapter: new ReferenceAdapter({ governance: true }), probes, salt: "o" }), await runGovernance({ adapter: new ReferenceAdapter(), probes, salt: "o" })];
    const md = governanceMarkdown(runs);
    assert.ok(md.indexOf("| reference |") < md.indexOf("| reference-governance |"));
    assert.ok(!/PASS|KNOWN-FAIL|CLARIFY/.test(md));
  });
  test("no file in vectors/governance is picked up by the registry-only default suite", () => {
    const manifest = JSON.parse(readFileSync(join(SUITE_ROOT, "vectors", "manifest.json"), "utf8")) as { files: string[] };
    assert.ok(!manifest.files.some((f) => f.includes("governance")));
    assert.ok(readdirSync(join(SUITE_ROOT, "vectors", "governance")).includes("gov.json"));
  });
});
