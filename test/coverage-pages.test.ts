// SPDX-License-Identifier: Apache-2.0
// The version-grain coverage page (docs/22, decision CV-13): generated from the census and the vectors, optional run records, advisory.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EXCLUDED_RUN_FOLDERS, PD_CAVEAT, SNAPSHOT_FILE, buildCoveragePage, buildSnapshotPage, readCoverageRuns } from "../src/coverage/pages.ts";
import { loadCensus } from "../src/coverage/families.ts";
import { outputs } from "../scripts/coverage-pages.ts";
import { ROOT, tempDir } from "./helpers.ts";

describe("coverage page", () => {
  const page = buildCoveragePage(ROOT);
  it("is the committed results/coverage.md and the committed docs/22 block (no run records: the tracked page needs none)", () => {
    for (const [p, c] of outputs(ROOT)) if (existsSync(p)) assert.equal(readFileSync(p, "utf8"), c, p);
  });
  it("prints both grains, the census size, and says no coverage run is recorded when no folder is given", () => {
    assert.match(page, /Task grain/);
    assert.match(page, new RegExp(`Version grain.*${loadCensus().length} rows`));
    assert.match(page, /No coverage run is recorded in this results set/);
    assert.doesNotMatch(page, /types ran/);
  });
  it("has the draft banner, the how-to-read box, the independence label and the wording rule", () => {
    assert.match(page, /\*\*Status: draft proposal\.\*\*/);
    assert.match(page, /How to read this page/);
    assert.match(page, /not independent evidence of that schema/);
    assert.match(page, /ran against both with the same vectors/);
  });
  it("lists truststackers with no invented rows, and says when the witness server was re-run", () => {
    assert.match(page, /truststackers:\*\* no coverage run is recorded/);
    assert.match(page, /Witness server:\*\* re-run on 2026-11-18/);
    assert.match(page, /run label `witness-upstream`/);
    assert.match(page, /run records are held outside this repository/);
    assert.doesNotMatch(page, /run folders `witness/);
    assert.doesNotMatch(page, /results\/runs/);
    assert.doesNotMatch(page, /the owner/i);
  });
  it("prints the earlier task-grain figure beside the current one, with the reason", () => {
    assert.match(page, /\*\*Earlier task-grain figure:\*\* 103 of 104 \(the list before 2026-11-18 added 21 tasks the wallet sends\); both are printed so the change is explained, not hidden/);
    assert.match(page, /The task list now holds 125 tasks and 103 of them have a check in the headline vectors at Tier 1 \(82%\); the 21 added tasks are held by the advisory coverage vectors/);
    assert.match(page, /124 of 125 have a check in the suite \(99%\)/);
  });
  it("totals equal the census: the All row is the census, and every family row sums to it", () => {
    const rows = page.split("\n").filter((l) => /^\| (RM|VP|MB|CS|SD|AA|CA|PW|FW) /.test(l));
    assert.equal(rows.length, 9);
    const used = rows.reduce((n, l) => n + Number(l.split("|")[2]), 0);
    assert.equal(used, loadCensus().length);
    assert.match(page, new RegExp(`\\| \\*\\*All\\*\\* \\| ${used} \\|`));
  });
  it("prints the permissionDenied caveat at the top of the page and in docs/22 (one sentence, the same text)", () => {
    assert.ok(page.indexOf(PD_CAVEAT) > 0 && page.indexOf(PD_CAVEAT) < page.indexOf("## Two ways to count"));
    assert.ok(readFileSync(join(ROOT, "docs", "22-coverage-families.md"), "utf8").includes(PD_CAVEAT));
  });
  it("prints no local path", () => {
    assert.doesNotMatch(page, /\/(srv|home|var|tmp)\//);
  });
});

describe("coverage page with run records", () => {
  const mk = (): { dir: string; cleanup: () => void } => {
    const t = tempDir();
    const vec = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", "cv-rm.json"), "utf8")).vectors as { id: string; source: { slug: string; version: string } }[];
    const [a, b] = [vec[0]!, vec.find((v) => v.source.slug !== vec[0]!.source.slug)!];
    mkdirSync(join(t.dir, "kw-upstream-shim-advisory"), { recursive: true });
    mkdirSync(join(t.dir, "vti-upstream-community-b"), { recursive: true });
    const res = [{ id: a.id, status: "PASS" }, { id: b.id, status: "SKIP", reason: `type not declared: https://trusttasks.org/spec/${b.source.slug}/${b.source.version}` }];
    writeFileSync(join(t.dir, "kw-upstream-shim-advisory", "results-advisory.json"), JSON.stringify([{ impl: "keyring-wallet", results: res }, { impl: "keyring-wallet", results: res }]));
    return t;
  };
  it("adds a row per run folder with the types that ran, never counts a SKIP, names empty folders, and stays public-safe", () => {
    const t = mk();
    try {
      const runs = readCoverageRuns(t.dir);
      assert.deepEqual(runs.used.map((u) => u.folder), ["kw-upstream-shim-advisory"]);
      assert.deepEqual(runs.empty, ["vti-upstream-community-b"]);
      const page = buildCoveragePage(ROOT, t.dir);
      const row = page.split("\n").find((l) => l.startsWith("| `kw-upstream-shim-advisory`"))!;
      const c = row.split("|").map((x) => x.trim());
      assert.equal(c[2], "keyring-wallet");
      assert.equal(c[3], "2"); assert.equal(c[4], "1"); assert.equal(c[5], "1");
      assert.equal(c[c.length - 2], "1");
      assert.match(page, /Folders present with no recorded result yet: `vti-upstream-community-b`/);
      assert.match(page, /1 not served by this surface \(not-applicable\)/);
      assert.doesNotMatch(page, new RegExp(t.dir));
    } finally { t.cleanup(); }
  });
  it("splits PASS into the task's own code and permissionDenied only, per surface and per group; a folder that predates the field says not recorded", () => {
    const t = tempDir();
    try {
      const vec = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", "cb-cs.json"), "utf8")).vectors as { id: string }[];
      const [a, b, c, d] = vec.slice(0, 4).map((v) => v.id) as [string, string, string, string];
      mkdirSync(join(t.dir, "vti-upstream-agent"), { recursive: true });
      mkdirSync(join(t.dir, "vti-upstream-agent-b"), { recursive: true });
      const rows = [
        { id: a, status: "PASS", observedCodes: ["taskCode"] },
        { id: b, status: "PASS", observedCodes: ["permissionDenied"], acceptedOnlyGate: true },
        { id: c, status: "PASS", observedCodes: ["permissionDenied"], acceptedOnlyGate: true },
        { id: d, status: "SKIP", reason: "not offered" },
      ];
      writeFileSync(join(t.dir, "vti-upstream-agent", "results-advisory.json"), JSON.stringify([{ impl: "x", results: rows }]));
      writeFileSync(join(t.dir, "vti-upstream-agent-b", "results-advisory.json"), JSON.stringify([{ impl: "x", results: rows.map(({ id, status }) => ({ id, status })) }]));
      const page = buildCoveragePage(ROOT, t.dir);
      assert.match(page, /\*\*A PASS that is only `permissionDenied` shows an authorisation gate answered first, not that the stated rule held: only a PASS with the task.s own code carries the evidence for the rule\.\*\*/);
      const up = page.split("\n").find((l) => l.startsWith("| `vti-upstream-agent` | all groups |"))!;
      assert.ok(up !== undefined, "a surface row");
      const cells = up.split("|").map((x) => x.trim());
      assert.deepEqual(cells.slice(3, 7), ["3", "1", "2", "0"]);
      const grp = page.split("\n").find((l) => l.startsWith("| `vti-upstream-agent` | CB-CS |"))!;
      assert.deepEqual(grp.split("|").map((x) => x.trim()).slice(3, 7), ["3", "1", "2", "0"]);
      const old = page.split("\n").find((l) => l.startsWith("| `vti-upstream-agent-b` | all groups |"))!;
      assert.deepEqual(old.split("|").map((x) => x.trim()).slice(3, 7), ["3", "not recorded", "not recorded", "not recorded"]);
      assert.match(page, /Run folders with no observed code recorded \(they predate the field; nothing is guessed\): `vti-upstream-agent-b`\./);
    } finally { t.cleanup(); }
  });
  it("an absent folder is the same page as none", () => {
    assert.equal(buildCoveragePage(ROOT, "/nonexistent-coverage-runs"), buildCoveragePage(ROOT));
  });
});

describe("measured snapshot page", () => {
  const COMMIT = "04c38a90db98e12d10ecdf91ca47fb26eee7526e";
  const mk = (): { dir: string; cleanup: () => void } => {
    const t = tempDir();
    const vec = JSON.parse(readFileSync(join(ROOT, "vectors", "coverage", "cb-cs.json"), "utf8")).vectors as { id: string }[];
    for (const label of ["vti-upstream-agent", "vti-upstream-agent-b"]) {
      mkdirSync(join(t.dir, label, "run"), { recursive: true });
      mkdirSync(join(t.dir, label, "run-advisory"), { recursive: true });
      writeFileSync(join(t.dir, label, "run", "run.json"), JSON.stringify({ today: "2026-11-18", suite: { commit: COMMIT, dirty: false } }));
      writeFileSync(join(t.dir, label, "run-advisory", "results-advisory.json"), JSON.stringify([{ impl: "x", tier: 1, results: [{ id: vec[0]!.id, status: "PASS", observedCodes: ["taskCode"] }] }, ...(label === "vti-upstream-agent-b" ? [{ impl: "x", tier: 2, results: [{ id: vec[0]!.id, status: "PASS", observedCodes: ["taskCode"] }] }] : [])]));
    }
    return t;
  };
  it("does not link the withdrawn measured snapshot, and the published tree does not carry it (D955)", () => {
    assert.equal(SNAPSHOT_FILE, "coverage-measured.md");
    assert.doesNotMatch(buildCoveragePage(ROOT), /coverage-measured/);
    assert.doesNotMatch(readFileSync(join(ROOT, "docs", "22-coverage-families.md"), "utf8"), /coverage-measured/);
    for (const f of ["STATUS.md", join("results", "README.md")].filter((x) => existsSync(join(ROOT, x)))) assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /coverage-measured/);
    assert.equal(existsSync(join(ROOT, "results", SNAPSHOT_FILE)), false);
  });
  it("says what it is, from which suite commit and date (read from the run records), how to regenerate, and lists the superseded folders by name", () => {
    const t = mk();
    try {
      const page = buildSnapshotPage(ROOT, t.dir, ["cbcc-vti-upstream-agent-b", "kw-upstream-shim"]);
      assert.match(page, /^# Coverage by task version: measured snapshot/);
      assert.match(page, /snapshot of run records held outside the repository/);
      assert.ok(page.includes(COMMIT.slice(0, 7)) && page.includes("2026-11-18"));
      assert.match(page, /clean tree/);
      assert.match(page, /COVERAGE_RUNS_DIR=<runs folder> npm run coverage-pages -- --snapshot/);
      assert.match(page, /superseded by this set[^\n]*\n[\s\S]*`cbcc-vti-upstream-agent-b`[\s\S]*`kw-upstream-shim`/);
      assert.match(page, /\| `vti-upstream-agent\/run-advisory` \|/);
      assert.match(page, /Status: draft proposal/);
      assert.doesNotMatch(page, /\/(srv|home|var|tmp)\//);
      assert.doesNotMatch(page, new RegExp(t.dir));
    } finally { t.cleanup(); }
  });
  it("shows the seeded-state probe apart from the coverage counts, and the ceremony scenarios as a separate reference-only list", () => {
    const t = mk();
    try {
      const probe = JSON.parse(readFileSync(join(ROOT, "vectors", "probe", "cp-rm.json"), "utf8")).vectors as { id: string }[];
      mkdirSync(join(t.dir, "vti-upstream-community-probe", "run-advisory"), { recursive: true });
      writeFileSync(join(t.dir, "vti-upstream-community-probe", "run-advisory", "results-advisory.json"), JSON.stringify([{ impl: "x", tier: 1, results: [{ id: probe[0]!.id, status: "PASS", observedCodes: ["taskCode"] }, { id: probe[1]!.id, status: "FAIL" }, { id: probe[2]!.id, status: "SKIP", reason: "not served" }] }]));
      const page = buildSnapshotPage(ROOT, t.dir, []);
      assert.match(page, /## Seeded-state probe, subset of surfaces/);
      assert.match(page, /\| `vti-upstream-community-probe\/run-advisory` \|[^\n]*\| CP-RM \| 3 \| 1 \| 1 \| 1 \|/);
      // never in the coverage table or its left-out list
      const cov = page.slice(page.indexOf("## Recorded coverage runs"), page.indexOf("## Seeded-state probe"));
      assert.doesNotMatch(cov, /community-probe/);
      assert.match(page, /## Reference-only ceremony scenarios, never conformance/);
      const files = JSON.parse(readFileSync(join(ROOT, "vectors", "ceremony-scenarios", "scenarios-manifest.json"), "utf8")).files as string[];
      let n = 0;
      for (const f of files) n += (JSON.parse(readFileSync(join(ROOT, "vectors", "ceremony-scenarios", f), "utf8")).scenarios as unknown[]).length;
      assert.match(page, new RegExp(`${n} scenarios in ${files.length} files`));
      assert.match(page, /not counted in any figure above/);
    } finally { t.cleanup(); }
  });
  it("names the run folders that ran tier 1 only, from the records", () => {
    const t = mk();
    try {
      const page = buildSnapshotPage(ROOT, t.dir, []);
      assert.match(page, /Tier 1 only: `vti-upstream-agent\/run-advisory`; the other folders ran tiers 1 and 2\./);
    } finally { t.cleanup(); }
  });
  it("says so when the run records name more than one suite commit or a dirty tree", () => {
    const t = mk();
    try {
      writeFileSync(join(t.dir, "vti-upstream-agent-b", "run", "run.json"), JSON.stringify({ today: "2026-11-18", suite: { commit: "a".repeat(40), dirty: true } }));
      const page = buildSnapshotPage(ROOT, t.dir, []);
      assert.match(page, /more than one suite commit/);
      assert.match(page, /dirty tree/);
    } finally { t.cleanup(); }
  });
});

describe("excluded run folders", () => {
  const w = ["f", "ork"].join("");
  it("excludes the same run folders under either name pattern", () => {
    for (const f of [`kw-${w}-a`, `kw-emit-${w}-b`, `vti-${w}-c`, `cbcc-kw-${w}-x`, `cbfix-vti-${w}-x`, `set1/kw-${w}-a`]) assert.ok(EXCLUDED_RUN_FOLDERS.test(f), f);
    for (const f of ["kw-upstream-a", "vti-a", "reference", `xkw-${w}-a`, `my-${w}`]) assert.ok(!EXCLUDED_RUN_FOLDERS.test(f), f);
  });
});
