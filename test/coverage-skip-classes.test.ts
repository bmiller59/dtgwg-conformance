// SPDX-License-Identifier: Apache-2.0
// Skip-class rules for the coverage vectors (docs/22, decision CV-13): the three coverage labels, the surface-scoped rule for the keyring-wallet
// emit flows the suite adapter does not drive (a suite limit, never not applicable), and that every distinct SKIP reason of recorded
// coverage runs gets a class. Set COVERAGE_RUNS_DIR to a folder of coverage run records to run the last test against them.
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { classify, type SkipRule } from "../src/glance/model.ts";
import { ROOT } from "./helpers.ts";

const rules = (JSON.parse(readFileSync(join(ROOT, "results", "skip-classes.json"), "utf8")) as { rules: (SkipRule & { label?: string })[] }).rules;
const cfg = JSON.parse(readFileSync(join(ROOT, "results", "at-a-glance.config.json"), "utf8")) as { subjects: { surfaces: { id: string; impl: string }[] }[] };
const surfaces = cfg.subjects.flatMap((s) => s.surfaces);
const T = (s: string): string => `https://trusttasks.org/spec/${s}`;
const KW = ["keyring-wallet-shim", "keyring-wallet-didcomm", "keyring-wallet-didcomm-v2"];
const NOT_DRIVEN = ["rooms/blobs/chunk/0.1", "rooms/blobs/get/0.2", "rooms/blobs/upload/abort/0.2", "rooms/blobs/upload/begin/0.2", "rooms/blobs/upload/chunk/0.2", "rooms/blobs/upload/commit/0.2", "rooms/keys/file-key/0.2", "rooms/keys/present/0.2", "rooms/records/curate/0.1", "rooms/records/put/0.1", "rooms/records/put/0.3", "rooms/records/put/0.4", "vtc/rooms/offers/accept/0.1", "voting/ballot/cast/0.1", "vtc/join-requests/decide/0.1", "vta/contexts/get/1.0", "vta/webvh/dids/delete/1.0", "vrc/relationships/issue/0.1", "vrc/relationships/propose/0.1", "witness/session/0.1", "witness/session/submit/0.1"];
const ruleOf = (reason: string, surface: string): (SkipRule & { label?: string }) | undefined => rules.find((r) => (r.surfaces === undefined || r.surfaces.includes(surface)) && new RegExp(r.match, "i").test(reason));

describe("coverage skip classes", () => {
  it("a keyring-wallet type the wallet builds but the adapter's emit flows do not drive is not reached on every wallet surface, never not applicable", () => {
    assert.equal(NOT_DRIVEN.length, 21);
    for (const s of KW) for (const t of NOT_DRIVEN) {
      assert.equal(classify(`type not emitted: ${T(t)}`, s, rules, new Set()), "not-reached", `${s} ${t}`);
      assert.equal(ruleOf(`type not emitted: ${T(t)}`, s)!.id, "coverage-kw-not-driven");
    }
  });
  it("the same reason on another surface, or for another type, keeps the generic class (the platform's builders do not produce it)", () => {
    assert.equal(classify(`type not emitted: ${T("rooms/blobs/get/0.2")}`, "reference", rules, new Set()), "not-applicable");
    assert.equal(classify(`type not emitted: ${T("acl/swap-key/0.1")}`, "keyring-wallet-shim", rules, new Set()), "not-applicable");
  });
  it("the rule's note names the checked reason (sweep rule) and the suite limit", () => {
    const r = ruleOf(`type not emitted: ${T("rooms/blobs/get/0.2")}`, "keyring-wallet-shim")!;
    assert.match(r.note, /suite limit/i);
    assert.match(r.note, /builds/);
  });
  it("the four act-mediated types VTI builds only through the VTA's room action call are not reached on the VTI emit surfaces, ahead of the generic rule (CE-RM-001, 003, 006, 023)", () => {
    const ACT = ["rooms/blobs/chunk/0.1", "rooms/blobs/upload/abort/0.2", "rooms/blobs/upload/commit/0.2", "vtc/rooms/offers/accept/0.1"];
    for (const s of ["vti-emit"]) for (const t of ACT) {
      const reason = `type not emitted: ${T(t)}`;
      assert.equal(classify(reason, s, rules, new Set()), "not-reached", `${s} ${t}`);
      const r = ruleOf(reason, s)!;
      assert.equal(r.id, "coverage-vti-act-mediated");
      assert.equal(r.label, "not reached by the suite");
      assert.match(r.note, /suite limit/i);
      assert.match(r.note, /room_act/);
      assert.match(r.note, /not-built\.json/);
    }
    // every other type not emitted on the VTI emit surfaces, and these four anywhere else, keep the generic class
    for (const s of ["vti-emit"]) assert.equal(classify(`type not emitted: ${T("rooms/blobs/get/0.2")}`, s, rules, new Set()), "not-applicable");
    assert.equal(classify(`type not emitted: ${T("rooms/blobs/chunk/0.1")}`, "reference", rules, new Set()), "not-applicable");
    assert.equal(classify(`type not emitted: ${T("rooms/blobs/chunk/0.12")}`, "vti-emit", rules, new Set()), "not-applicable");
    assert.ok(rules.findIndex((x) => x.id === "coverage-vti-act-mediated") < rules.findIndex((x) => x.id === "type-not-emitted"));
  });
  it("the three coverage labels exist: not served by this surface, send-only, no counterpart", () => {
    const labels = new Set(rules.map((r) => r.label).filter((x) => x !== undefined));
    for (const l of ["not served by this surface", "send-only", "no counterpart"]) assert.ok(labels.has(l), l);
  });
  it("a type not declared is not served by this surface; on an emit-only surface it is send-only; both are not applicable only where nothing else of the task ran", () => {
    const r = `type not declared: ${T("rooms/blobs/get/0.2")}`;
    assert.equal(ruleOf(r, "keyring-wallet-shim")!.label, "not served by this surface");
    assert.equal(classify(r, "keyring-wallet-shim", rules, new Set()), "not-applicable");
    assert.equal(classify(r, "keyring-wallet-shim", rules, new Set(["rooms/blobs/get"])), "version-mismatch");
    for (const s of ["vti-emit"]) {
      assert.equal(ruleOf(r, s)!.label, "send-only");
      assert.equal(classify(r, s, rules, new Set()), "not-applicable");
      assert.equal(classify(r, s, rules, new Set(["rooms/blobs/get"])), "version-mismatch");
    }
  });
  it("no counterpart is not applicable", () => {
    const r = "no counterpart: no implementation answers this task";
    assert.equal(ruleOf(r, "reference")!.label, "no counterpart");
    assert.equal(classify(r, "reference", rules, new Set()), "not-applicable");
  });
  it("every label is on a rule of the four existing classes", () => {
    for (const r of rules.filter((x) => x.label !== undefined)) assert.ok(["not-applicable", "not-reached", "version-mismatch", "by-served-slug"].includes(r.class), r.id);
  });
});

/** Every coverage run record under a folder: a results-advisory.json holding a block per implementation. */
function advisoryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...advisoryFiles(p));
    else if (f === "results-advisory.json") out.push(p);
  }
  return out;
}
const RUNS = process.env.COVERAGE_RUNS_DIR;
describe("recorded coverage runs", { skip: RUNS === undefined || !existsSync(RUNS) ? "set COVERAGE_RUNS_DIR to a folder of coverage run records" : false }, () => {
  it("every distinct SKIP reason gets a class on every surface of its implementation (no unclassified reason)", () => {
    const bad = new Set<string>();
    for (const f of advisoryFiles(RUNS!)) {
      for (const b of JSON.parse(readFileSync(f, "utf8")) as { impl: string; results: { status: string; reason?: string }[] }[]) {
        const ids = surfaces.filter((s) => s.impl === b.impl || `${s.impl}-attested` === b.impl).map((s) => s.id);
        for (const r of b.results) if (r.status === "SKIP") for (const id of ids.length > 0 ? ids : [b.impl]) {
          const reason = r.reason ?? "";
          // a served-slug set is not known here: both outcomes of by-served-slug are classes
          if (classify(reason, id, rules, new Set()) === "unclassified") bad.add(`${id}: ${reason.replace(/https:\/\/\S+/, "<type>").slice(0, 120)}`);
        }
      }
    }
    assert.deepEqual([...bad], []);
  });
});
