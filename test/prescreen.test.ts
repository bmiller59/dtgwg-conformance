// SPDX-License-Identifier: Apache-2.0
// Tests of the promotion pre-screen (src/promotion/prescreen.ts, evidence.ts, scripts/prescreen.ts). Synthetic inputs in a temp directory only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadEvidence, loadVectors } from "../src/promotion/evidence.ts";
import { evidenceFails, hasLineCite, screen, staticFails, summarise, tally, type PrescreenVector, type RunEvidence } from "../src/promotion/prescreen.ts";

const base: PrescreenVector = { id: "V-1", channel: "proposed", tfStatus: "draft", clarify: null, clarifyClass: null, excluded: false, synthetic: false, retired: false, mutants: 1, specLines: true, clockDependent: false, family: "coverage", set: "CV-X" };
const ev = (ref: string[], runs: Record<string, string[]>): RunEvidence => ({
  reference: new Map([["V-1", new Set(ref)]]),
  surfaces: new Map([["agent", new Map([["V-1", new Map(Object.entries(runs).map(([k, v]) => [k, new Set(v)]))]])]]),
});

describe("static checks", () => {
  it("accepts a clean proposed vector", () => assert.deepEqual(staticFails(base), []));
  it("refuses registry, pr and retired sources", () => {
    assert.deepEqual(staticFails({ ...base, channel: "registry" }), ["channel-registry"]);
    assert.deepEqual(staticFails({ ...base, channel: "pr", tfStatus: "pr" }), ["channel-pr", "tfref-pr"]);
    assert.ok(staticFails({ ...base, tfStatus: "retired", retired: true }).includes("tfref-retired"));
  });
  it("refuses CLARIFY, excluded, synthetic, no mutants, no line cite, clock dependence", () => {
    assert.ok(staticFails({ ...base, clarify: "text" }).includes("clarify"));
    assert.ok(staticFails({ ...base, clarifyClass: "spec-silent" }).includes("clarify"));
    assert.ok(staticFails({ ...base, excluded: true }).includes("excluded/synthetic/retired"));
    assert.ok(staticFails({ ...base, synthetic: true }).includes("excluded/synthetic/retired"));
    assert.ok(staticFails({ ...base, mutants: 0 }).includes("no-mutants"));
    assert.ok(staticFails({ ...base, specLines: false }).includes("no-line-cite"));
    assert.ok(staticFails({ ...base, clockDependent: true }).includes("clock-dependent"));
  });
  it("summarise reads a raw vector", () => {
    const v = summarise({ id: "A", spec: ["SPEC.md:12 x"], mutants: ["m"], clarify: null, clockStart: "t", source: { channel: "candidate", tfRef: { status: "main" } } }, "G", "gap");
    assert.deepEqual([v.channel, v.tfStatus, v.mutants, v.specLines, v.clockDependent, v.family], ["candidate", "main", 1, true, true, "gap"]);
    assert.equal(hasLineCite(["no cite here"]), false);
  });
});

describe("evidence checks", () => {
  it("passes when the oracle passes and every VTI run is PASS", () => assert.deepEqual(evidenceFails("V-1", ["agent"], ev(["PASS"], { r1: ["PASS"], r2: ["PASS", "SKIP"] })), { fails: [], runs: 2 }));
  it("fails when the oracle did not pass or has a non-PASS verdict", () => {
    assert.ok(evidenceFails("V-1", ["agent"], ev([], { r1: ["PASS"] })).fails.includes("oracle-not-pass"));
    assert.ok(evidenceFails("V-1", ["agent"], ev(["PASS", "CLARIFY"], { r1: ["PASS"] })).fails.includes("oracle-not-pass"));
    assert.ok(evidenceFails("V-1", ["agent"], ev(["SKIP"], { r1: ["PASS"] })).fails.includes("oracle-not-pass"));
  });
  it("fails a vector that never ran, or that was SKIP everywhere", () => {
    assert.ok(evidenceFails("V-1", ["agent"], ev(["PASS"], {})).fails.includes("never-ran"));
    assert.ok(evidenceFails("V-1", ["agent"], ev(["PASS"], { r1: ["SKIP"] })).fails.includes("never-ran"));
    assert.ok(evidenceFails("V-1", ["community"], ev(["PASS"], { r1: ["PASS"] })).fails.includes("never-ran"));
  });
  it("fails an unstable or non-PASS verdict", () => {
    assert.ok(evidenceFails("V-1", ["agent"], ev(["PASS"], { r1: ["PASS"], r2: ["FAIL"] })).fails.includes("verdict-unstable"));
    assert.deepEqual(evidenceFails("V-1", ["agent"], ev(["PASS"], { r1: ["KNOWN-FAIL"] })).fails, ["non-pass:KNOWN-FAIL"]);
  });
  it("judges several surfaces jointly: ran on one is enough, a differing verdict on another is unstable", () => {
    const e = ev(["PASS"], { r1: ["PASS"] });
    assert.deepEqual(evidenceFails("V-1", ["agent", "community"], e).fails, []);
    e.surfaces.set("community", new Map([["V-1", new Map([["r1", new Set(["FAIL"])]])]]));
    assert.ok(evidenceFails("V-1", ["agent", "community"], e).fails.includes("verdict-unstable"));
  });
});

describe("screen and tally", () => {
  it("excludes probes from promotion but keeps them clean", () => {
    const e = ev(["PASS"], { r1: ["PASS"] });
    const r = screen({ ...base, family: "probe" }, ["agent"], e, { excludeProbes: true });
    assert.deepEqual([r.clean, r.probe, r.promotable], [true, true, false]);
    assert.equal(screen({ ...base, family: "probe" }, ["agent"], e, { excludeProbes: false }).promotable, true);
  });
  it("tally keys by the code before a colon", () => {
    const rows = [{ fails: ["non-pass:FAIL", "clarify"] }, { fails: ["non-pass:CLARIFY"] }] as never;
    assert.deepEqual(tally(rows), { "non-pass": 2, clarify: 1 });
  });
});

describe("loading and the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "prescreen-test-"));
  const put = (p: string, o: unknown): void => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), JSON.stringify(o)); };
  const vec = (id: string, extra: Record<string, unknown> = {}) => ({ id, spec: ["SPEC.md:1 x"], mutants: ["m"], clarify: null, source: { channel: "proposed", tfRef: { status: "draft" } }, ...extra });
  const block = (impl: string, results: [string, string][]) => ({ tier: 1, impl, results: results.map(([id, status]) => ({ id, status })) });
  put("vectors/coverage/cv-x.json", { group: "CV-X", vectors: [vec("V-OK"), vec("V-CLARIFY", { clarify: "x" }), vec("V-FAIL")] });
  put("vectors/coverage/manifest.json", { files: ["cv-x.json"] });
  put("runs/a/vti-upstream-agent/run/results.json", [block("verifiable-trust-infrastructure-inprocess", [["V-OK", "PASS"], ["V-CLARIFY", "CLARIFY"], ["V-FAIL", "FAIL"]])]);
  put("runs/a/vti-superseded-agent/run/results.json", [block("verifiable-trust-infrastructure-inprocess", [["V-OK", "FAIL"]])]); // excluded by name: not counted
  put("runs/a/reference/run/results.json", [block("reference", [["V-OK", "PASS"], ["V-FAIL", "PASS"], ["V-CLARIFY", "CLARIFY"]]), block("keyring-wallet", [["V-OK", "FAIL"]])]);
  put("runs/b/vti-upstream-agent/run/results.json", [block("verifiable-trust-infrastructure-inprocess", [["V-OK", "PASS"]])]);
  it("reads the surface from the adapter name and skips excluded folders", () => {
    const { ev: e } = loadEvidence({ roots: [join(dir, "runs", "a"), join(dir, "runs", "b")] });
    assert.deepEqual([...e.surfaces.get("agent")!.get("V-OK")!.keys()].length, 2);
    assert.deepEqual([...e.surfaces.get("agent")!.get("V-OK")!.get(join(dir, "runs", "a"))!], ["PASS"]);
    assert.deepEqual([...e.reference.get("V-OK")!], ["PASS"]);
  });
  it("loads vectors and ignores manifests", () => assert.equal(loadVectors(join(dir, "vectors")).size, 3));
  it("the CLI writes a machine-readable result", () => {
    const out = join(dir, "out.json");
    execFileSync("node", ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", fileURLToPath(new URL("../scripts/prescreen.ts", import.meta.url)), "--vectors", join(dir, "vectors"), "--run-root", join(dir, "runs", "a"), "--run-root", join(dir, "runs", "b"), "--out", out]);
    const r = JSON.parse(readFileSync(out, "utf8")) as { format: string; summary: { clean: number; distinctVectors: number }; vectors: { id: string; clean: boolean; fails: string[] }[] };
    assert.equal(r.format, "tt-conformance-prescreen/0.1");
    assert.equal(r.summary.distinctVectors, 3);
    assert.equal(r.summary.clean, 1);
    assert.deepEqual(r.vectors.find((v) => v.id === "V-OK")!.fails, []);
    assert.ok(r.vectors.find((v) => v.id === "V-CLARIFY")!.fails.includes("clarify"));
    assert.ok(r.vectors.find((v) => v.id === "V-FAIL")!.fails.includes("non-pass:FAIL"));
    rmSync(dir, { recursive: true, force: true });
  });
});
