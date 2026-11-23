// SPDX-License-Identifier: Apache-2.0
// The advisory FAILs of the community service in process (coverage families, docs/22): every one is either a recorded difference
// (exceptions/exceptions.json) or a recorded finding (results/findings.json), and docs/22 lists them with the one that covers each.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadExceptions } from "../src/vectors/load.ts";
import { loadCatalog, loadFindings } from "../src/glance/model.ts";
import { ROOT } from "./helpers.ts";

const KEY = "verifiable-trust-infrastructure-vtc-inprocess";
const LOOKUP = "spec-silent: lookup before validation";
const exceptions = loadExceptions(join(ROOT, "exceptions", "exceptions.json")).exceptions;
const findings = loadFindings(ROOT);
const catalog = loadCatalog(ROOT, { coverage: true });

/** How the suite covers a community FAIL id: an exception, a finding, or neither. */
const coverOf = (id: string): "exception" | "finding" | "none" =>
  exceptions.some((e) => e.impl === KEY && e.vector === id) ? "exception" : findings.some((f) => f.impl === KEY && f.vector === id) ? "finding" : "none";

describe("the lookup-first findings (results/findings.json)", () => {
  const lookup = findings.filter((f) => f.impl === KEY && f.explanation.startsWith(LOOKUP));
  it("are for coverage vectors of the community surface, not excused, not also exceptions, class C, not yet recorded on a surface (inherited), and name the seeded probe vectors that are the evidence", () => {
    assert.ok(lookup.length > 0);
    for (const f of lookup) {
      assert.equal(catalog.get(f.vector)?.channel, "proposed", `${f.vector}: a proposed-channel coverage vector`);
      assert.equal(f.excused, false);
      assert.equal(f.class, "C", `${f.vector}: the text is open on the order`);
      assert.ok(f.inherited !== undefined && f.inherited.length > 20, `${f.vector}: inherited`);
      assert.ok(!exceptions.some((e) => e.impl === f.impl && e.vector === f.vector), `${f.vector} is also an exception`);
      assert.ok((f.evidence ?? []).length > 0, `${f.vector}: no evidence pointer`);
      for (const p of f.evidence ?? []) assert.ok(/^CP-/.test(p) && catalog.has(p), `${f.vector}: evidence ${p} is not a probe vector`);
    }
  });
  it("every probe-backed finding is the seeded re-ask of that very vector", () => {
    for (const f of lookup) {
      for (const p of f.evidence ?? []) {
        const doc = JSON.parse(readFileSync(join(ROOT, "vectors", "probe", `${p.slice(0, 5).toLowerCase()}.json`), "utf8")) as { vectors: { id: string; spec: string[] }[] };
        assert.ok(doc.vectors.find((v) => v.id === p)!.spec.some((s) => s.startsWith(`Re-asks ${f.vector}:`)), `${p} does not re-ask ${f.vector}`);
      }
    }
  });
  it("leave the headline alone: no finding is for a vector of the registry channel", () => {
    const base = loadCatalog(ROOT);
    for (const f of findings.filter((x) => x.impl === KEY)) assert.ok(!base.has(f.vector), `${f.vector} is in the headline catalog`);
  });
});

describe("the specification text quoted in the findings (needs TT_KIT)", () => {
  it("each quoted passage occurs on the cited line", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set: the quotes were not checked against the text"); return; }
    let n = 0;
    for (const f of findings.filter((x) => x.impl === KEY)) {
      for (const [, file, line, text] of f.explanation.matchAll(/(specs\/\S+?\.md):(\d+) '([^']+)'/g)) {
        n++;
        assert.ok(readFileSync(join(kit, file!), "utf8").split("\n")[Number(line) - 1]!.includes(text!), `${f.vector}: line ${line} of ${file} does not contain "${text}"`);
      }
      assert.ok(!/(^|[^/\w])spec\.md:\d+/.test(f.explanation), `${f.vector}: a quote cites spec.md without its path`);
    }
    assert.ok(n >= 5, "the quoted lines were not found");
  });
});

describe("docs/22: the community FAILs table", () => {
  const text = readFileSync(join(ROOT, "docs", "22-coverage-families.md"), "utf8");
  const section = text.split("\n## ").find((s) => s.startsWith("Advisory FAILs of the community service"));
  const rows = [...(section ?? "").matchAll(/^\| (C[A-Z]-[A-Z]{2}-\d{3}) \| (exception|finding) \|/gm)].map((m) => [m[1]!, m[2]!] as const);
  it("exists and names, for each id, the cover the exceptions and findings files actually give it", () => {
    assert.ok(section !== undefined, "no section 'Advisory FAILs of the community service'");
    assert.ok(rows.length > 0);
    for (const [id, cover] of rows) assert.equal(coverOf(id), cover, `${id}`);
    assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, "an id is listed twice");
  });
  it("lists every community coverage vector that a findings entry covers (so the table cannot drift from the file)", () => {
    const listed = new Set(rows.map((r) => r[0]));
    for (const f of findings.filter((x) => x.impl === KEY)) assert.ok(listed.has(f.vector), `${f.vector} is a finding but not in the table`);
  });
});

/** The FAIL ids of every recorded results file under a directory (any depth), with the implementation key of the block. */
function failsUnder(dir: string): { file: string; impl: string; id: string }[] {
  const out: { file: string; impl: string; id: string }[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^results.*\.json$/.test(n)) for (const b of JSON.parse(readFileSync(p, "utf8")) as { impl: string; results: { id: string; status: string }[] }[]) for (const r of b.results) if (r.status === "FAIL") out.push({ file: p, impl: b.impl, id: r.id });
    }
  };
  walk(dir);
  return out;
}

describe("recorded coverage results (COVERAGE_RUNS_DIR)", () => {
  const dir = process.env["COVERAGE_RUNS_DIR"];
  it("every FAIL id of the community service in a recorded results file is covered by an exception or a finding (skipped when COVERAGE_RUNS_DIR is unset)", (t) => {
    if (dir === undefined || !existsSync(dir)) { t.skip("COVERAGE_RUNS_DIR is not set: the recorded results were not read"); return; }
    const fails = failsUnder(dir).filter((f) => f.impl === KEY && !/^CP-/.test(f.id)); // a probe vector is the suite's own instrument: its FAIL is the evidence, not a difference to explain
    assert.ok(fails.length > 0, `no FAIL of ${KEY} under ${dir}`);
    const uncovered = fails.filter((f) => coverOf(f.id) === "none").map((f) => `${f.file}: ${f.id}`);
    assert.deepEqual(uncovered, [], "FAIL ids with neither an exception nor a finding");
  });
});
