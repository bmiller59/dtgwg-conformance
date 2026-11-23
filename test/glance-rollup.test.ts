// SPDX-License-Identifier: Apache-2.0
// Tests of the roll-up prototype (src/glance/rollup.ts). Synthetic inputs only: no run records, no results directory.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addTally, ceremonyFor, combineScenarios, completion, effective, emptyTally, focusIndex, frameworkItems, headline, itemState, mergeItems,
  roleOfVector, rollup, scopeFromDeclared, statesFor, vectorItemKeys, promoteInMatrix, evidenceOfAdvisoryRecord,
} from "../src/glance/rollup.ts";
import type { CeremonyRow, Matrix, Outcome, ScopeItem } from "../src/glance/rollup.ts";

const U = (s: string, v: string): string => `https://trusttasks.org/spec/${s}/${v}`;
const task = (slug: string, version: string, focus: "focus" | "older" | "retired", successors: string[] = []) => ({
  typeUri: U(slug, version), slug, version, focus, status: focus === "retired" ? "retired" : "draft", sources: [{ kind: "main" }], successors, vti: { pinned: false, served: [] }, kw: { referenced: false, serves: false },
});
const matrix: Matrix = {
  inputs: {},
  tasks: [
    task("acl/grant", "0.2", "older"), task("acl/grant", "0.3", "focus"),
    task("acl/list", "0.4", "focus"),
    task("confirm/request", "0.1", "retired", [U("task-consent/request", "0.1")]), task("task-consent/request", "0.1", "focus"),
  ],
  vectors: [
    { id: "PP-ACL-1", group: "PP-ACL", set: "plain", channel: "registry", tasks: [U("acl/grant", "0.3")] },
    { id: "PP-ACL-2", group: "PP-ACL", set: "plain", channel: "registry", tasks: [U("acl/grant", "0.2")] },
    { id: "EM-ACL-1", group: "EM-ACL", set: "emit", channel: "registry", tasks: [U("acl/grant", "0.3")] },
    { id: "GP-ACL-1", group: "GP-ACL", set: "gap", channel: "proposed", tasks: [U("acl/list", "0.4")] },
    { id: "PRF-001", group: "PRF", set: "framework", channel: "registry", tasks: [] },
  ],
};
const item = (key: string, atLatest = true): ScopeItem => {
  const [role, rest] = key.split(":") as ["receive" | "send", string];
  const [slug, v] = rest.split("@") as [string, string];
  return { key, role, slug, focusVersion: v ?? "", declaredVersions: [v ?? ""], atLatest, maturity: "draft", sourceKind: "main", why: ["test"] };
};
const o = (id: string, status: Outcome["status"], keys: string[], extra: Partial<Outcome> = {}): Outcome => ({ id, status, cls: null, evidence: "gating", itemKeys: keys, ...extra });

describe("declared scope", () => {
  it("normalises declared versions to the focus version and marks an older-only declaration as behind", () => {
    const { items } = scopeFromDeclared(matrix, "receive", [U("acl/grant", "0.2")], "declared");
    assert.equal(items.length, 1);
    assert.equal(items[0]!.key, "receive:acl/grant@0.3");
    assert.equal(items[0]!.atLatest, false);
    assert.deepEqual(items[0]!.declaredVersions, ["0.2"]);
  });
  it("follows a retired latest to its successor, and keeps non-registry types apart", () => {
    const { items, outside } = scopeFromDeclared(matrix, "send", [U("confirm/request", "0.1"), "urn:p2pts:tasks:spec:ceremony:propose:0.1"], "declared");
    assert.equal(items[0]!.key, "send:task-consent/request@0.1");
    assert.deepEqual(outside, ["urn:p2pts:tasks:spec:ceremony:propose:0.1"]);
  });
  it("a role is part of the key: serving and sending the same task are two items", () => {
    const a = scopeFromDeclared(matrix, "receive", [U("acl/grant", "0.3")], "r").items;
    const b = scopeFromDeclared(matrix, "send", [U("acl/grant", "0.3")], "s").items;
    assert.equal(mergeItems(a, b, frameworkItems(["PRF"])).length, 3);
  });
  it("merging keeps the union of versions and reasons, and at-latest wins", () => {
    const a = scopeFromDeclared(matrix, "receive", [U("acl/grant", "0.2")], "adapter").items;
    const b = scopeFromDeclared(matrix, "receive", [U("acl/grant", "0.3")], "source").items;
    const [m] = mergeItems(a, b);
    assert.equal(m!.atLatest, true);
    assert.deepEqual(m!.why, ["adapter", "source"]);
  });
  it("focus index resolves slugs", () => {
    assert.equal(focusIndex(matrix).focusOf("acl/grant")?.version, "0.3");
  });
});

describe("vectors to items", () => {
  it("roles come from the vector group (emit, emit-more, gap emit, coverage emit, 2L emit send)", () => {
    for (const id of ["EM-ACL-1", "EX-ROM-1", "GE-VTA-1", "CE-X-1", "TE-AUD-1"]) assert.equal(roleOfVector(id), "send", id);
    for (const id of ["PP-ACL-1", "GP-VTA-1", "CV-RM-1", "PRF-001"]) assert.equal(roleOfVector(id), "receive", id);
  });
  it("an older-version vector never measures the focus item", () => {
    assert.deepEqual(vectorItemKeys(matrix, matrix.vectors[1], "PP-ACL-2", "PP-ACL"), ["receive:acl/grant@0.2#older"]);
    assert.deepEqual(vectorItemKeys(matrix, matrix.vectors[0], "PP-ACL-1", "PP-ACL"), ["receive:acl/grant@0.3"]);
  });
  it("framework vectors map to their rule group", () => {
    assert.deepEqual(vectorItemKeys(matrix, matrix.vectors[4], "PRF-001", "PRF"), ["receive:framework/PRF"]);
  });
});

describe("how each result class counts", () => {
  const it1 = item("receive:acl/grant@0.3");
  it("PASS agrees; CLARIFY beside PASS still agrees; CLARIFY alone is unsettled", () => {
    assert.equal(itemState(it1, [o("a", "PASS", [it1.key])], true), "agrees");
    assert.equal(itemState(it1, [o("a", "PASS", [it1.key]), o("b", "CLARIFY", [it1.key])], true), "agrees");
    assert.equal(itemState(it1, [o("b", "CLARIFY", [it1.key])], true), "unsettled");
  });
  it("one recorded difference makes the item differ; a FAIL with no recorded finding is unexplained and wins", () => {
    assert.equal(itemState(it1, [o("a", "PASS", [it1.key]), o("b", "KNOWN-FAIL", [it1.key], { diffClass: "A" })], true), "differs");
    assert.equal(itemState(it1, [o("a", "KNOWN-FAIL", [it1.key], { diffClass: "A" }), o("b", "FAIL", [it1.key])], true), "unexplained");
    assert.equal(itemState(it1, [o("b", "FAIL", [it1.key], { finding: true, diffClass: "A" })], true), "differs");
  });
  it("class B counts against (under review), class C as CLARIFY, class D as a suite limit", () => {
    assert.equal(effective(o("x", "KNOWN-FAIL", [], { diffClass: "B" })), "differs");
    assert.equal(effective(o("x", "KNOWN-FAIL", [], { diffClass: "C" })), "clarify");
    assert.equal(effective(o("x", "KNOWN-FAIL", [], { diffClass: "D" })), "suite-limit");
    assert.equal(effective(o("x", "KNOWN-FAIL", [])), "differs"); // unclassed: conservative
    assert.equal(itemState(it1, [o("x", "KNOWN-FAIL", [it1.key], { diffClass: "D" })], true), "not-reached");
  });
  it("not attempted is never attempted and failed: behind, no-check, not-run, not-reached, declared-not-offered", () => {
    assert.equal(itemState(item("receive:acl/grant@0.3", false), [], true), "behind");
    assert.equal(itemState(it1, [], false), "no-check");
    assert.equal(itemState(it1, [], true), "not-run");
    assert.equal(itemState(it1, [o("s", "SKIP", [it1.key], { cls: "not-reached" })], true), "not-reached");
    assert.equal(itemState(it1, [o("s", "SKIP", [it1.key], { cls: "version-mismatch" })], true), "behind");
    assert.equal(itemState(it1, [o("s", "SKIP", [it1.key], { cls: "not-applicable" })], true), "declared-not-offered");
  });
  it("advisory outcomes stay out of the gating states", () => {
    const st = statesFor([it1], [o("g", "PASS", [it1.key], { evidence: "advisory" })], new Set([it1.key]), "gating");
    assert.equal(st.get(it1.key), "not-run");
    assert.equal(statesFor([it1], [o("g", "PASS", [it1.key], { evidence: "advisory" })], new Set([it1.key]), "both").get(it1.key), "agrees");
  });
});

describe("roll-up and guardrails", () => {
  const items = Array.from({ length: 20 }, (_, i) => item(`receive:t${i}/x@0.1`));
  const states = (n: { agrees: number; differs: number; unsettled?: number }): Map<string, ReturnType<typeof itemState>> =>
    new Map(items.map((it, i) => [it.key, i < n.agrees ? "agrees" : i < n.agrees + n.differs ? "differs" : i < n.agrees + n.differs + (n.unsettled ?? 0) ? "unsettled" : "no-check"]));
  it("P is agreeing over decided items; unsettled items are measured but outside P", () => {
    const r = rollup(items, states({ agrees: 9, differs: 1, unsettled: 2 }), []);
    assert.equal(r.measured, 12);
    assert.equal(r.decided, 10);
    assert.equal(r.agreement, 0.9);
    assert.equal(r.floor, 9 / 20);
  });
  it("P is withheld below the measured-share threshold or below the minimum item count", () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`receive:m${i}/x@0.1`));
    const r = rollup(many, new Map(many.map((it, i) => [it.key, i < 19 ? ("agrees" as const) : ("no-check" as const)])), []); // 19 of 40 measured
    assert.equal(r.agreement, null);
    assert.match(r.withheld ?? "", /measured share below 50%/);
    assert.equal(r.byState.agrees, 19); // the counts are still reported
    const few = items.slice(0, 8);
    assert.match(rollup(few, new Map(few.map((i) => [i.key, "agrees" as const])), []).withheld ?? "", /fewer than 10/);
  });
  it("shrinking the declared scope raises P only visibly: the scope size moves with it", () => {
    const full = rollup(items, states({ agrees: 10, differs: 2 }), []);
    const shrunk = items.filter((_, i) => i !== 10 && i !== 11); // drop the two differing items from the declaration
    const r2 = rollup(shrunk, states({ agrees: 10, differs: 2 }), []);
    assert.ok((r2.agreement ?? 0) > (full.agreement ?? 0));
    assert.equal(r2.declared, full.declared - 2);
    assert.match(headline("X", r2, null), /of 18 declared/);
  });
  it("check-level agreement counts C as clarify and D as outside", () => {
    const k = items[0]!.key;
    const r = rollup([items[0]!], new Map([[k, "agrees"]]), [o("1", "PASS", [k]), o("2", "KNOWN-FAIL", [k], { diffClass: "D" }), o("3", "KNOWN-FAIL", [k], { diffClass: "C" }), o("4", "KNOWN-FAIL", [k], { diffClass: "A" })]);
    assert.equal(r.checkAgreement, 0.5);
    assert.deepEqual(r.vectors.knownFailByClass, { D: 1, C: 1, A: 1 });
  });
  it("the headline never uses the bare word interoperable and always shows measured and declared", () => {
    const r = rollup(items, states({ agrees: 15, differs: 1 }), []);
    const h = headline("keyring-wallet", r, null);
    assert.doesNotMatch(h, /\binteroperab/i);
    assert.match(h, /conformance-implied/);
    assert.match(h, /measured 16 of 20 declared/);
    assert.match(headline("w", rollup(items.slice(0, 3), new Map(), []), null), /insufficient evidence/);
  });
});

describe("ceremony completion (never added to conformance)", () => {
  const row = (name: string, parties: string[], sc: Record<string, string>): CeremonyRow => {
    const scenarios = new Map(Object.entries(sc));
    return { row: name, parties, scenarios, groups: new Map(), root: "" };
  };
  it("completion is completed plus ended as specified over the scenarios that ran; skipped are apart", () => {
    const t = emptyTally();
    for (const s of ["completed", "ended-as-specified", "failed", "skipped"]) addTally(t, s);
    assert.equal(completion(t), 2 / 3);
    assert.throws(() => addTally(t, "passed"));
  });
  it("a scenario run with several partners counts once, and only completes if it completed with every partner", () => {
    const c = combineScenarios([row("a", ["kw", "vti-agent"], { "FC-ACL-001": "completed", "FC-ACL-002": "completed" }), row("b", ["kw", "vti-community"], { "FC-ACL-001": "failed", "FC-ACL-002": "skipped" })]);
    assert.equal(c.get("FC-ACL-001"), "failed");
    assert.equal(c.get("FC-ACL-002"), "completed");
    assert.equal(c.size, 2);
  });
  it("partner kinds are kept apart: platform partner, oracle", () => {
    const rows = [
      row("avl.up.vti-up", ["kw", "vti-agent"], { "FC-ACL-001": "completed" }),
      row("kvh.up", ["kw", "reference"], { "FC-KVX-001": "completed" }),
    ];
    const v = ceremonyFor("kw", rows);
    assert.equal(v.originalPartner.scenarios, 1);
    assert.equal(v.referencePartner.scenarios, 1);
    assert.match(headline("kw", rollup([], new Map(), []), v), /with a platform partner: 100%/);
  });
});

describe("promotions in the prototype (docs/33)", () => {
  it("promoteInMatrix sets registry on the listed vectors only and counts the changes", () => {
    const m: Matrix = { ...matrix, vectors: [{ id: "A-1", group: "A", set: "coverage", channel: "proposed", tasks: [] }, { id: "A-2", group: "A", set: "coverage", channel: "proposed", tasks: [] }, { id: "A-3", group: "A", set: "plain", channel: "registry", tasks: [] }] };
    assert.equal(promoteInMatrix(m, new Set(["A-1", "A-3", "Z"])), 1);
    assert.deepEqual(m.vectors.map((v) => v.channel), ["registry", "proposed", "registry"]);
  });
  it("a record from an advisory root is gating only when the vector is promoted and the record post-dates the promotion, or a projection is asked for", () => {
    const p = new Set(["A-1"]);
    assert.equal(evidenceOfAdvisoryRecord("A-1", "registry", p, false), "gating");
    assert.equal(evidenceOfAdvisoryRecord("A-1", "proposed", p, false), "advisory");
    assert.equal(evidenceOfAdvisoryRecord("A-1", "proposed", p, true), "gating");
    assert.equal(evidenceOfAdvisoryRecord("A-2", "registry", p, true), "advisory");
  });
});
