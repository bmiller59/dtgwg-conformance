// SPDX-License-Identifier: Apache-2.0
// Tests of the suite-attempt prototype (scripts/suite-attempt-prototype.ts). Synthetic inputs only: no run records, no results directory.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildCatalogue, classifySuite, derivedStatus, evidenceFor, headline, headlineReading, overrideFor, reading, renderMd, rulesFor, strip, suiteOf, validateOverride, weakestSurface, COMPONENTS, PLATFORMS,
} from "../scripts/suite-attempt-prototype.ts";
import type { ComponentCfg, ItemState, OverrideEntry, RuleClass, Suite, TaskEvidence, VtiRoleJson } from "../scripts/suite-attempt-prototype.ts";

const fam = (f: string, n: number, sub = "x"): string[] => Array.from({ length: n }, (_, i) => `${f}/${sub}${Math.floor(i / 4)}/t${i}`);
const ev = (slug: string, kind: TaskEvidence["kind"], role: TaskEvidence["role"] = "send", atLatest = true): TaskEvidence => ({ slug, role, atLatest, kind, source: "test" });
const suite = (id: string, tasks: string[]): Suite => ({ id, family: id.split("/")[0] ?? id, tasks, ceremonies: [] });
const none = new Map<string, RuleClass>();

describe("catalogue: what a suite is", () => {
  it("keeps a family of up to 30 tasks whole and splits a larger one by sub-prefix, pooling small sub-prefixes as (other)", () => {
    const big = [...fam("vtc", 28, "a"), ...fam("vtc", 8, "b"), "vtc/tiny/one", "vtc/tiny/two"];
    const { suites, split } = buildCatalogue(["acl/grant", "acl/list", ...big], new Map(), []);
    assert.ok(suites.has("acl"));
    assert.ok(split.has("vtc"));
    assert.equal(suiteOf("vtc/tiny/one", split), "vtc (other)");
    assert.equal(suites.get("vtc (other)")?.tasks.length, 2);
    const total = [...suites.values()].reduce((n, s) => n + s.tasks.length, 0);
    assert.equal(total, 2 + big.length, "every slug lands in exactly one suite");
  });
  it("puts the framework rule groups and the five framework tasks in suite core", () => {
    const { suites } = buildCatalogue(["trust-task-error", "trust-task-next-step", "acl/grant"], new Map(), ["PRF", "ENV"]);
    assert.deepEqual(suites.get("core")?.tasks, ["framework/ENV", "framework/PRF", "trust-task-error", "trust-task-next-step"]);
  });
  it("attaches each ceremony group to every suite whose tasks it names", () => {
    const { suites } = buildCatalogue(["acl/grant", "device/register"], new Map([["FC-ACL", ["acl/grant"]], ["FC-DEV", ["device/register", "acl/grant"]]]), []);
    assert.deepEqual(suites.get("acl")?.ceremonies, ["FC-ACL", "FC-DEV"]);
    assert.deepEqual(suites.get("device")?.ceremonies, ["FC-DEV"]);
  });
});

describe("classification: code evidence first", () => {
  const s = suite("acl", ["acl/a", "acl/b", "acl/c", "acl/d"]);
  it("one task served or sent in code makes the suite attempted; completeness counts implemented tasks at the latest version", () => {
    const r = classifySuite(s, [ev("acl/a", "sent-code"), ev("acl/b", "older-code", "send", false)], new Map(), none, undefined, undefined);
    assert.equal(r.band, "attempts");
    assert.equal(r.implemented, 1);
    assert.equal(r.olderOnly, 1);
    assert.equal(r.completeness, 0.25);
  });
  it("names without a builder or handler never make a suite attempted", () => {
    const r = classifySuite(s, [ev("acl/a", "named")], new Map(), none, undefined, undefined);
    assert.equal(r.band, "not-yet-built");
    assert.equal(r.implemented, 0);
  });
  it("a partial implementer is scored only on what it implements, never on the rest of the suite", () => {
    const states = new Map<string, ItemState>([["send:acl/a", "agrees"], ["send:acl/b", "agrees"], ["send:acl/c", "agrees"]]);
    const r = classifySuite(s, ["acl/a", "acl/b", "acl/c"].map((t) => ev(t, "sent-code")), states, none, undefined, undefined);
    assert.equal(r.completeness, 0.75);
    assert.equal(r.conformance?.agreement, 1);
    assert.equal(r.conformance?.items, 3);
  });
  it("code evidence the measured build did not declare is in scope but not measured (lowers the measured share, never P)", () => {
    const states = new Map<string, ItemState>([["send:acl/a", "agrees"], ["send:acl/b", "agrees"], ["send:acl/c", "differs"]]);
    const r = classifySuite(s, ["acl/a", "acl/b", "acl/c", "acl/d"].map((t) => ev(t, "sent-code")), states, none, undefined, undefined);
    assert.equal(r.conformance?.byState["not-measured-build"], 1);
    assert.equal(r.conformance?.measuredShare, 0.75);
    assert.equal(r.conformance?.agreement, 2 / 3);
    assert.ok(r.flags.some((f) => f.includes("code evidence only")));
  });
  it("confidence is high when code and the adapter declaration agree, medium with one of them", () => {
    assert.equal(classifySuite(s, [ev("acl/a", "sent-code"), ev("acl/a", "declared-run")], new Map(), none, undefined, undefined).confidence, "high");
    assert.equal(classifySuite(s, [ev("acl/a", "declared-run")], new Map(), none, undefined, undefined).confidence, "medium");
  });
  it("an override can never remove an attempted suite; the disagreement is shown", () => {
    const o: OverrideEntry = { suite: "acl", band: "not-attempted", note: "compiled out", basis: "unconfirmed" };
    const r = classifySuite(s, [ev("acl/a", "sent-code")], new Map(), none, o, undefined);
    assert.equal(r.band, "attempts");
    assert.ok(r.flags.some((f) => f.includes("override says not-attempted")));
  });
  it("without evidence: the override, then the role rule, then a sibling surface, else not classified", () => {
    const rules = new Map<string, RuleClass>([["acl/a", "not-involved"], ["acl/b", "not-built"]]);
    assert.equal(classifySuite(s, [], new Map(), rules, undefined, undefined).band, "not-yet-built");
    assert.equal(classifySuite(s, [], new Map(), new Map([["acl/a", "not-involved"]]), undefined, undefined).band, "not-attempted");
    assert.equal(classifySuite(s, [], new Map(), none, { suite: "acl", band: "not-yet-built", note: "planned", basis: "unconfirmed" }, undefined).band, "not-yet-built");
    assert.equal(classifySuite(s, [], new Map(), none, undefined, "vti-community").band, "not-attempted");
    const nc = classifySuite(s, [], new Map(), none, undefined, undefined);
    assert.equal(nc.band, "not-classified");
    assert.ok(nc.flags.some((f) => f.startsWith("missing")));
  });
  it("not attempted and not yet built carry no completeness and no conformance (shown, not scored)", () => {
    const r = classifySuite(s, [], new Map(), new Map([["acl/a", "not-built"]]), undefined, undefined);
    assert.equal(r.completeness, null);
    assert.equal(r.conformance, null);
  });
});

describe("readings and headline", () => {
  it("a suite reading needs half its items measured and 3 decided; otherwise insufficient or none", () => {
    assert.equal(reading(["agrees", "agrees", "agrees", "not-run"]).mark, "clear");
    assert.equal(reading(["agrees", "agrees"]).mark, "insufficient");
    assert.equal(reading(["agrees", "not-run", "not-run", "behind"]).mark, "insufficient");
    assert.equal(reading(["not-run", "behind"]).mark, "none");
    assert.equal(reading(["agrees", "agrees", "agrees", "differs"]).agreement, 0.75);
  });
  it("the headline pools the attempted suites' items with the roll-up thresholds (50% measured, 10 decided), so per-suite figures add up", () => {
    const s1 = classifySuite(suite("a", ["a/1"]), [ev("a/1", "sent-code")], new Map([["send:a/1", "agrees"]]), none, undefined, undefined);
    const many = Array.from({ length: 12 }, (_, i) => `b/${i}`);
    const s2 = classifySuite(suite("b", many), many.map((t) => ev(t, "sent-code")), new Map(many.map((t, i) => [`send:${t}`, i < 9 ? "agrees" : "differs"] as [string, ItemState])), none, undefined, undefined);
    const r = headlineReading([s1, s2]);
    assert.equal(r.agrees, 10);
    assert.equal(r.decided, 13);
    assert.equal(r.agreement, 10 / 13);
  });
  it("prints the attempt counts, the pooled figure with its measured share, what it could build, and overrides; never banned words", () => {
    const att = classifySuite(suite("a", ["a/1", "a/2"]), [ev("a/1", "sent-code")], new Map([["send:a/1", "agrees"]]), none, undefined, undefined);
    const nyb = classifySuite(suite("b", ["b/1"]), [], new Map(), new Map([["b/1", "not-built"]]), undefined, undefined);
    const na = classifySuite(suite("c", ["c/1"]), [], new Map(), none, { suite: "c", band: "not-attempted", note: "n", basis: "unconfirmed" }, undefined);
    const h = headline("P", [att, nyb, na]);
    assert.match(h, /attempts 1 of 2 suites it could take part in \(0 in full\)/);
    assert.match(h, /withheld \(measured 1 of 1 tasks, 100%; 1 agree\)/);
    assert.match(h, /1 more it could build; 1 not its role \(1 by an override\)/);
    assert.doesNotMatch(h + renderMd([strip("p", "P", [att, nyb, na])]), /\bconformant\b|\bcompliant\b|\bcertified\b|\binteroperable\b/i);
  });
  it("shrinking scope is visible: dropping a suite moves it to a counted band, never out of the headline", () => {
    const a = classifySuite(suite("a", ["a/1"]), [ev("a/1", "sent-code")], new Map(), none, undefined, undefined);
    const dropped = classifySuite(suite("a", ["a/1"]), [], new Map(), none, { suite: "a", band: "not-attempted", note: "n", basis: "unconfirmed" }, undefined);
    assert.match(headline("P", [a]), /attempts 1 of 1/);
    assert.match(headline("P", [dropped]), /attempts 0 of 0 .* 1 not its role \(1 by an override\)/);
  });
});

describe("derived platform line (D332)", () => {
  it("attempted if any surface attempts; pools the surfaces' items and names the weakest surface", () => {
    const s = suite("acl", ["acl/a", "acl/b", "acl/c"]);
    const agent = classifySuite(s, ["acl/a", "acl/b", "acl/c"].map((t) => ev(t, "served-code", "receive")), new Map(["acl/a", "acl/b", "acl/c"].map((t) => [`receive:${t}`, "agrees"] as [string, ItemState])), none, undefined, undefined);
    const comm = classifySuite(s, ["acl/a", "acl/b", "acl/c"].map((t) => ev(t, "served-code", "receive")), new Map(["acl/a", "acl/b", "acl/c"].map((t, i) => [`receive:${t}`, i === 0 ? "differs" : "agrees"] as [string, ItemState])), none, undefined, undefined);
    const client = classifySuite(s, [], new Map(), none, undefined, undefined);
    const d = derivedStatus(s, [{ surface: "agent", s: agent }, { surface: "community", s: comm }, { surface: "client", s: client }]);
    assert.equal(d.band, "attempts");
    assert.equal(d.conformance?.items, 6);
    assert.equal(d.weakest, "community");
  });
  it("with no attempt anywhere: not yet built beats not attempted beats not classified; a sibling note alone does not decide", () => {
    const s = suite("x", ["x/1"]);
    const sib = classifySuite(s, [], new Map(), none, undefined, "other");
    const nc = classifySuite(s, [], new Map(), none, undefined, undefined);
    assert.equal(derivedStatus(s, [{ surface: "a", s: sib }, { surface: "b", s: nc }]).band, "not-classified");
    const nyb = classifySuite(s, [], new Map(), new Map([["x/1", "not-built"]]), undefined, undefined);
    assert.equal(derivedStatus(s, [{ surface: "a", s: nc }, { surface: "b", s: nyb }]).band, "not-yet-built");
  });
});

describe("evidence readers", () => {
  const focus = new Map([["acl/grant", { slug: "acl/grant", version: "0.3", typeUri: "u:acl/grant/0.3", focus: "focus", vti: { pinned: true, served: ["vta"] } }]]);
  const tasks = [...focus.values(), { slug: "acl/grant", version: "0.2", typeUri: "u:acl/grant/0.2", focus: "older", vti: { pinned: true, served: ["vta"] } }];
  it("VTI: a dispatcher table entry at the latest is served-code; an older one is not counted when the latest is served", () => {
    const c: ComponentCfg = { id: "vti-agent", name: "a", platform: "vti", vtiServed: "vta" };
    const e = evidenceFor(c, focus, tasks, [], []);
    assert.deepEqual(e.map((x) => x.kind), ["served-code"]);
  });
  it("the adapter declaration marks an item older when it does not declare the focus version", () => {
    const c: ComponentCfg = { id: "kw", name: "k", platform: "kw" };
    const e = evidenceFor(c, focus, tasks, [{ key: "send:acl/grant@0.3", declared: ["0.2"], gating: "behind" }, { key: "receive:framework/PRF", declared: [], gating: "agrees" }], []);
    assert.deepEqual(e.map((x) => [x.slug, x.kind]), [["acl/grant", "older-run"], ["framework/PRF", "declared-run"]]);
  });
  it("wallet roles: serves and emits are code evidence, names-only is named, rule roles only split the unattempted bands", () => {
    const c: ComponentCfg = { id: "kw", name: "k", platform: "kw", kwCode: true };
    const roles = [{ slug: "a/1", role: "serves", basis: "handler", versionsNamed: [] }, { slug: "a/2", role: "emits", basis: "code", versionsNamed: [] }, { slug: "a/3", role: "names-only", basis: "code", versionsNamed: [] }, { slug: "a/4", role: "client-capable-not-built", basis: "rule", versionsNamed: [] }, { slug: "a/5", role: "not-involved", basis: "rule", versionsNamed: [] }];
    assert.deepEqual(evidenceFor(c, new Map(), [], [], roles).map((x) => x.kind), ["served-code", "sent-code", "named"]);
    assert.deepEqual([...rulesFor(c, roles)], [["a/4", "not-built"], ["a/5", "not-involved"]]);
  });
});

describe("override files", () => {
  const ids = new Set(["acl", "vtn/listings", "vtn (other)"]);
  it("validates the format, the reason, the basis and its proof, and refuses an override that adds an attempt", () => {
    assert.deepEqual(validateOverride({ format: "tt-scope-override/0.1", component: "c", review: { status: "unreviewed" }, entries: [{ suite: "acl", band: "not-attempted", note: "n", basis: "unconfirmed" }] }, ids), []);
    const bad = validateOverride({ format: "x", component: "", review: { status: "confirmed" }, entries: [{ suite: "nope", band: "attempts", note: "", basis: "declared" }, { suite: "acl", note: "n", basis: "inferred" }] }, ids);
    for (const m of ["format", "component", "confirmed file", "unknown suite", "band may only", "note", "confirmedBy", "evidence link"]) assert.ok(bad.some((e) => e.includes(m)), m);
  });
  it("an exact entry beats a family pattern, and family/* also covers the family's (other) suite", () => {
    const e: OverrideEntry[] = [{ suite: "vtn/*", band: "not-attempted", note: "p", basis: "unconfirmed" }, { suite: "vtn/listings", band: "not-yet-built", note: "x", basis: "unconfirmed" }];
    assert.equal(overrideFor(e, "vtn/listings")?.band, "not-yet-built");
    assert.equal(overrideFor(e, "vtn (other)")?.band, "not-attempted");
    assert.equal(overrideFor(e, "acl"), undefined);
  });
  it("the committed example files in results/scope are valid", () => {
    const dir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "results", "scope");
    for (const n of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const f = JSON.parse(readFileSync(join(dir, n), "utf8")) as { entries: { suite: string }[] };
      const known = new Set(f.entries.map((x) => x.suite).filter((x) => !x.endsWith("*")));
      assert.deepEqual(validateOverride(f, known), [], n);
    }
  });
});

describe("VTI role file as the code scan (D420 to D423)", () => {
  const row = (slug: string, surfaces: VtiRoleJson["surfaces"]): VtiRoleJson => ({ slug, surfaces });
  const R = (role: string, basis = "code", extra: Partial<VtiRoleJson["surfaces"][string]> = {}) => ({ role, basis, evidence: [{ file: "f.rs", line: 7 }], ...extra });
  const roles: VtiRoleJson[] = [
    row("a/serves", { vta: R("serves", "dispatch"), client: R("emits") }),
    row("a/emits", { vta: R("not-involved", "rule", { evidence: [] }), client: R("emits", "code", { also: ["serves"] }), mobile: R("emits") }),
    row("a/old", { vta: R("older-version"), client: R("not-built", "rule") }),
    row("a/named", { vta: R("named-only", "pin"), client: R("named-only") }),
    row("a/none", { vta: R("not-involved", "rule"), client: R("not-involved", "rule"), mobile: R("not-built", "rule") }),
  ];
  const agent: ComponentCfg = { id: "vti-agent", name: "agent", platform: "vti", vtiServed: "vta", vtiSurfaces: ["vta"] };
  const client: ComponentCfg = { id: "vti-client", name: "client", platform: "vti", vtiSurfaces: ["client", "mobile", "mcp"] };
  const e = (c: ComponentCfg) => evidenceFor(c, new Map(), [], [], [], roles).map((x) => `${x.slug}:${x.role}:${x.kind}:${x.atLatest}`).sort();
  it("a service reads served-code from the role file (instead of the dispatcher tables); older and named roles are older-code and named, with file and line in the source", () => {
    assert.deepEqual(e(agent), ["a/named:receive:named:true", "a/old:receive:older-code:false", "a/serves:receive:served-code:true"]);
    assert.match(evidenceFor(agent, new Map(), [], [], [], roles)[0]?.source ?? "", /VTI vta: .* f\.rs:7/);
  });
  it("the client card unions client, mobile core and mcp, and counts a task both sent and read in both directions", () => {
    assert.deepEqual(e(client), ["a/emits:receive:served-code:true", "a/emits:send:sent-code:true", "a/emits:send:sent-code:true", "a/named:send:named:true", "a/serves:send:sent-code:true"]);
  });
  it("without the role file the dispatcher-table fallback still works", () => {
    const f = new Map([["a/serves", { slug: "a/serves", version: "0.1", typeUri: "u", focus: "focus", vti: { pinned: true, served: ["vta"] } }]]);
    const out = evidenceFor(agent, f, [...f.values()], [], [], null);
    assert.deepEqual(out.map((x) => x.kind), ["served-code"]);
  });
  it("rule classes: a surface that could build or names a task reads not-built, one with no role not-involved; several surfaces take the more open reading", () => {
    assert.deepEqual([...rulesFor(agent, [], roles)].sort(), [["a/named", "not-built"], ["a/none", "not-involved"], ["a/emits", "not-involved"]].sort());
    assert.equal(rulesFor(client, [], roles).get("a/none"), "not-built");
    assert.equal(rulesFor(client, [], roles).get("a/old"), "not-built");
  });
  it("a named-only suite is not yet built, flagged, and the headline says how many are named in code only", () => {
    const s = suite("a", ["a/named"]);
    const st = classifySuite(s, evidenceFor(agent, new Map(), [], [], [], roles), new Map(), rulesFor(agent, [], roles), undefined, undefined);
    assert.equal(st.band, "not-yet-built");
    assert.equal(st.namedOnly, 1);
    assert.ok(st.flags.some((f) => /named in code only/.test(f)));
    assert.match(headline("agent", [st]), /1 more it could build \(1 named in code only\)/);
  });
  it("the weakest surface is the attempting one with the least conformance evidence, and none when nothing attempts", () => {
    const att = (agreesOf: number, decided: number, items: number) => strip("x", "x", [{ suite: "s", band: "attempts", confidence: "high", evidenceKinds: [], basis: "", implemented: 1, total: 1, olderOnly: 0, namedOnly: 0, couldBuild: 0, completeness: 1, conformance: reading([...Array(agreesOf).fill("agrees"), ...Array(decided - agreesOf).fill("differs"), ...Array(items - decided).fill("not-measured-build")] as ItemState[]), flags: [] }]);
    const a = att(9, 10, 10); const b = att(3, 4, 40); const none2 = strip("n", "n", []);
    const w = weakestSurface([{ id: "a", name: "A", strip: a }, { id: "b", name: "B", strip: b }, { id: "n", name: "N", strip: none2 }]);
    assert.equal(w?.id, "b");
    assert.match(w?.text ?? "", /measured 4 of 40/);
    assert.equal(weakestSurface([{ id: "n", name: "N", strip: none2 }]), null);
  });
  it("the components cover the agent, community, client builders, witness and voting surfaces for VTI; every surface is in a platform", () => {
    for (const p of ["vti"]) {
      const ids = COMPONENTS.filter((c) => c.platform === p).map((c) => c.vtiSurfaces?.join("+"));
      assert.deepEqual(ids, ["vta", "vtc", "client+mobile+mcp", "witness", "voting"]);
      assert.deepEqual(PLATFORMS.find((x) => x.id === p)?.surfaces.length, 5);
    }
    for (const p of PLATFORMS) for (const s of p.surfaces) assert.ok(COMPONENTS.some((c) => c.id === s), s);
  });
  it("surface ids and platform ids are unique and never shared (a platform and its surface once both read kw)", () => {
    const sids = COMPONENTS.map((c) => c.id), pids = PLATFORMS.map((p) => p.id);
    assert.equal(new Set(sids).size, sids.length);
    assert.equal(new Set(pids).size, pids.length);
    assert.deepEqual(sids.filter((s) => pids.includes(s)), []);
  });
});
