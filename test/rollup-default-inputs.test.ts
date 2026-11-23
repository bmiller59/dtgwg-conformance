// SPDX-License-Identifier: Apache-2.0
// Roll-up default inputs: promoted gating runs are read from the run map and promotions.json by default (no symlinks, no flags).
// Temp directories and the repository's own run map only; no real run records.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { COMPONENTS, ceremonyFor, combineScenarios, gatingRunFolders, headline, advisoryLine, loadPromotedIds, outcomesFromFiles, itemState, rollup, statesFor } from "../src/glance/rollup.ts";
import type { CeremonyRow, ScopeItem } from "../src/glance/rollup.ts";
import { loadRunMap } from "../src/coverage/matrix/runmap.ts";

const tmp = mkdtempSync(join(tmpdir(), "rollup-default-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const comp = (id: string) => COMPONENTS.find((c) => c.id === id)!;
const map = loadRunMap(join(import.meta.dirname, "..", "results", "platform-run-map.json"));

const writeResults = (name: string, results: { id: string; status: string; channel?: string; group?: string }[]): string => {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  const p = join(d, "results.json");
  writeFileSync(p, JSON.stringify([{ tier: 1, results }]));
  return p;
};
const ctx = (promoted: string[], keys: Record<string, string[]> = {}, projected = false) => ({
  promoted: new Set(promoted), projected, have: new Set<string>(),
  skipClass: () => "not-reached" as const, keysOf: (id: string) => keys[id] ?? [], diffClassOf: () => ({}),
});

describe("run map feeds gating", () => {
  it("each component reads only its own platform's gating folders from the run map (promote b1 and b2)", () => {
    const f = gatingRunFolders(map, comp("vti-agent"));
    assert.deepEqual(f.filter((x) => /promote-b[12]-gating-vti-upstream-agent$/.test(x)).length, 2);
    assert.ok(f.every((x) => x.startsWith("runs/")));
    assert.ok(gatingRunFolders(map, comp("vti-community")).some((x) => /promote-b2-gating-vti-upstream-community$/.test(x)));
    assert.ok(gatingRunFolders(map, comp("kw")).some((x) => /promote-b1-gating-kw-upstream-shim$/.test(x)));
    assert.ok(gatingRunFolders(map, comp("reference")).some((x) => /promote-b1-gating-reference$/.test(x)));
  });
  it("no run map entry belongs to a platform other than the measured platforms", () => {
    const byFolder = new Map(map.runs.map((r) => [r.folder, r.platform]));
    for (const c of COMPONENTS) for (const f of gatingRunFolders(map, c)) {
      const p = byFolder.get(f);
      if (p === undefined) continue; // reference (notPlatform) only
      assert.ok(["vti", "keyring-wallet"].includes(p), `${c.id} reads ${f} (${p})`);
    }
  });
  it("a component with no run map entries reads nothing (the witness server)", () => {
    for (const id of ["kw-witness"]) assert.deepEqual(gatingRunFolders(map, comp(id)), []);
  });
});

describe("promotions load by default", () => {
  it("loadPromotedIds reads vectors-src/promotions.json of the repository", () => {
    const ids = loadPromotedIds(join(import.meta.dirname, ".."));
    assert.ok(ids.size > 1000);
    assert.ok(ids.has("CV-AA-015"));
  });
  it("a missing promotions file gives an empty set (nothing promoted), not a crash", () => {
    assert.equal(loadPromotedIds(tmp).size, 0);
  });
});

describe("promoted runs gate; unpromoted advisory stays advisory", () => {
  it("a promoted vector's registry-channel record is gating; an unpromoted one is advisory even from the same run", () => {
    const p = writeResults("run-a", [{ id: "P-1", status: "PASS", channel: "registry" }, { id: "U-1", status: "PASS", channel: "proposed" }]);
    const out = outcomesFromFiles([p], ctx(["P-1"], { "P-1": ["receive:a/b@0.1"], "U-1": ["receive:a/c@0.1"] }));
    assert.equal(out.find((o) => o.id === "P-1")!.evidence, "gating");
    assert.equal(out.find((o) => o.id === "U-1")!.evidence, "advisory");
  });
  it("a promoted run lifts the gating item state and the measured share; the advisory record does not", () => {
    const items: ScopeItem[] = ["a/b", "a/c"].map((s) => ({ key: `receive:${s}@0.1`, role: "receive", slug: s, focusVersion: "0.1", declaredVersions: ["0.1"], atLatest: true, maturity: "draft", sourceKind: "main", why: [] }));
    const p = writeResults("run-b", [{ id: "P-1", status: "PASS", channel: "registry" }, { id: "U-1", status: "PASS", channel: "proposed" }]);
    const out = outcomesFromFiles([p], ctx(["P-1"], { "P-1": [items[0]!.key], "U-1": [items[1]!.key] }));
    const keys = new Set(items.map((i) => i.key));
    const g = statesFor(items, out, keys, "gating");
    assert.equal(g.get(items[0]!.key), "agrees");
    assert.notEqual(g.get(items[1]!.key), "agrees");
    assert.equal(rollup(items, g, out.filter((o) => o.evidence === "gating")).measured, 1);
    assert.equal(statesFor(items, out, keys, "both").get(items[1]!.key), "agrees");
  });
  it("first record of a vector wins and nothing is read twice", () => {
    const a = writeResults("run-c1", [{ id: "P-1", status: "PASS", channel: "registry" }]);
    const b = writeResults("run-c2", [{ id: "P-1", status: "FAIL", channel: "registry" }]);
    const out = outcomesFromFiles([a, b], ctx(["P-1"]));
    assert.equal(out.length, 1);
    assert.equal(out[0]!.status, "PASS");
  });
  it("out-of-tier SKIPs are dropped", () => {
    const p = writeResults("run-d", [{ id: "S-1", status: "SKIP" }]);
    const c = { ...ctx([]), skipClass: () => "out-of-tier" as const };
    assert.equal(outcomesFromFiles([p], c).length, 0);
  });
  it("item state of a measured item is unchanged by evidence kind labels (sanity)", () => {
    const it0: ScopeItem = { key: "receive:a/b@0.1", role: "receive", slug: "a/b", focusVersion: "0.1", declaredVersions: ["0.1"], atLatest: true, maturity: "draft", sourceKind: "main", why: [] };
    assert.equal(itemState(it0, [], true), "not-run");
  });
});

describe("guardrails the default path must keep", () => {
  const mk = (agrees: number, declared: number, measured: number) => {
    const items: ScopeItem[] = Array.from({ length: declared }, (_, i) => ({ key: `receive:t/${i}@0.1`, role: "receive", slug: `t/${i}`, focusVersion: "0.1", declaredVersions: ["0.1"], atLatest: true, maturity: "draft", sourceKind: "main", why: [] }));
    const st = new Map(items.map((i, n) => [i.key, n < agrees ? "agrees" : n < measured ? "differs" : "not-run"] as const));
    return rollup(items, st, []);
  };
  it("P is withheld below 50% measured and shown at or above it, always with M and the scope size", () => {
    const low = mk(20, 100, 49);
    assert.equal(low.agreement, null);
    assert.match(headline("x", low, null), /insufficient evidence.*Declared scope 100 items; measured 49 \(49%\)/);
    const ok = mk(45, 100, 50);
    assert.ok(ok.agreement !== null);
    assert.match(headline("x", ok, null), /measured 50 of 100 declared items, 50%/);
  });
  it("cards are in platform order: VTI, keyring-wallet, truststackers; then the reference", () => {
    const rank = (id: string): number => (id.startsWith("vti") ? 0 : id.startsWith("kw") ? 1 : id.startsWith("ts") ? 2 : 3);
    const ranks = COMPONENTS.map((c) => rank(c.id));
    const sorted = [...ranks].sort((a, b) => a - b);
    assert.deepEqual(ranks, sorted, COMPONENTS.map((c) => c.id).join(","));
  });
  it("no generated line uses the bare word interoperable", () => {
    const r = mk(45, 100, 60);
    const rows: CeremonyRow[] = [{ row: "a", parties: ["kw", "vti-agent"], scenarios: new Map([["FC-1", "completed"]]), groups: new Map(), root: "" }];
    const v = ceremonyFor("kw", rows);
    for (const s of [headline("x", r, v), headline("x", mk(1, 100, 5), v, "stand-in"), advisoryLine(r)]) assert.doesNotMatch(s, /interoperab|conformant|compliant|certified/i);
    assert.equal(combineScenarios(rows).size, 1);
  });
});
