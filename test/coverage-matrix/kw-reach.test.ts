// SPDX-License-Identifier: Apache-2.0
// The keyring-wallet reach batch (decisions D300 to D303): the explicit run map, ceremony overlay, comment-stripped evidence, roles, role-based
// denominators and the participation table.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ceremonyRecordsFixture } from "./kw-reach-fixtures.ts";
import { readCeremonyRecords } from "../../src/coverage/matrix/ceremony-records.ts";
import { kwCommentUriLines, kwUriLines, scanKw, stripComments } from "../../src/coverage/matrix/kw.ts";
import { kwReachSummary } from "../../src/coverage/matrix/focus.ts";
import { buildParticipation, participationCounts, renderParticipation, resultOf, summarise } from "../../src/coverage/matrix/participation.ts";
import { detailsByPlatform, readRunResults, statusesByPlatform, unmappedFolders } from "../../src/coverage/matrix/platforms.ts";
import { countRoles, deriveRoles, ruleFor, type RoleRules } from "../../src/coverage/matrix/roles.ts";
import { entryOf, keyOf, parseRunMap, type RunMap } from "../../src/coverage/matrix/runmap.ts";
import type { TaskVersion } from "../../src/coverage/matrix/types.ts";
import { put, tmp } from "./helpers.ts";

const B = "https://trusttasks.org/spec/";
const mapOf = (runs: Partial<RunMap["runs"][number]>[], notPlatform: string[] = [], ceremonyRows: RunMap["ceremonyRows"] = []): RunMap =>
  parseRunMap(JSON.stringify({ format: "tt-platform-run-map/0.1", about: "", ceremonyRows, notPlatform, runs: runs.map((r) => ({ surface: "shim", checkout: "x", date: "2026-11-19", ...r })) }));
const tv = (slug: string, version: string, o: Partial<TaskVersion> = {}): TaskVersion => ({
  typeUri: `${B}${slug}/${version}`, slug, version, family: slug.split("/")[0] as string, title: "t", status: "draft", sources: [], latest: true, focus: "focus", supersededBy: null, successors: [],
  vti: { pinned: false, served: [] }, kw: { referenced: false, serves: false, files: [] }, vectors: [], platforms: {}, ...o,
});

describe("run map (D300)", () => {
  it("rejects an unknown platform, a duplicate folder and a wrong format", () => {
    assert.throws(() => mapOf([{ folder: "a", platform: "nope" as never }]), /unknown platform/);
    assert.throws(() => mapOf([{ folder: "a", platform: "vti" }, { folder: "a", platform: "vti" }]), /twice/);
    assert.throws(() => parseRunMap(JSON.stringify({ format: "x", runs: [], ceremonyRows: [], notPlatform: [] })), /unknown format/);
  });
  it("assigns by explicit folder, longest key first, and never by name", () => {
    const m = mapOf([{ folder: "runs/2026-11-19-final-upstream-keyring-wallet", platform: "keyring-wallet" }, { folder: "runs/2026-11-19-final-upstream-keyring-wallet/2l", platform: "vti", surface: "2l" }]);
    assert.equal(entryOf(m, "runs/2026-11-19-final-upstream-keyring-wallet/emit")?.platform, "keyring-wallet");
    assert.equal(entryOf(m, "runs/2026-11-19-final-upstream-keyring-wallet/2l")?.platform, "vti");
    assert.equal(entryOf(m, "kw-upstream-shim/run"), undefined, "a name that looks like a wallet run is not enough");
    assert.equal(entryOf(m, "runs/2026-11-19-final-upstream-keyring-wallet-x"), undefined, "a prefix of the name is not a path prefix");
    assert.equal(keyOf("runs/2026-11-19-x/emit"), "runs/2026-11-19-x");
    assert.equal(keyOf("kw-upstream-shim/run"), "kw-upstream-shim");
  });
  it("reads the run folder the old name pattern missed, and reports folders the map does not know", () => {
    const r = tmp();
    put(r, "runs/2026-11-19-final-upstream-keyring-wallet/emit/results.json", JSON.stringify([{ results: [{ id: "EM-1", status: "PASS" }, { id: "EM-2", status: "SKIP", reason: "type not emitted: x" }] }]));
    put(r, "runs/2026-11-19-final-reference/emit/results.json", JSON.stringify([{ results: [{ id: "EM-9", status: "PASS" }] }]));
    put(r, "runs/2026-11-19-mystery/results.json", JSON.stringify([{ results: [{ id: "EM-8", status: "PASS" }] }]));
    const m = mapOf([{ folder: "runs/2026-11-19-final-upstream-keyring-wallet", platform: "keyring-wallet" }], ["runs/2026-11-19-final-reference"]);
    const recs = readRunResults(r);
    const st = statusesByPlatform(recs, m);
    assert.equal(st.get("keyring-wallet")?.get("EM-1"), "PASS");
    assert.equal(st.get("keyring-wallet")?.has("EM-9"), false);
    assert.equal(st.get("keyring-wallet")?.has("EM-8"), false);
    assert.deepEqual(unmappedFolders(recs, m), ["runs/2026-11-19-mystery"]);
  });
  it("keeps the worst executed result and the first skip reason per platform and vector", () => {
    const m = mapOf([{ folder: "a", platform: "keyring-wallet" }, { folder: "b", platform: "keyring-wallet", surface: "emit" }]);
    const recs = [
      { folder: "a/x", id: "V1", status: "SKIP", reason: "type not emitted: u" }, { folder: "b/x", id: "V1", status: "PASS" }, { folder: "a/y", id: "V1", status: "KNOWN-FAIL" },
      { folder: "a/x", id: "V2", status: "SKIP", reason: "type not declared: u" }, { folder: "b/x", id: "V2", status: "SKIP" },
    ];
    const d = detailsByPlatform(recs, m).get("keyring-wallet") as Map<string, { status: string; skipReason?: string; surfaces: string[] }>;
    assert.equal(d.get("V1")?.status, "KNOWN-FAIL");
    assert.equal(d.get("V1")?.skipReason, undefined);
    assert.deepEqual(d.get("V2"), { status: "SKIP", skipReason: "type not declared: u", surfaces: ["shim", "emit"] });
  });
});

describe("ceremony records overlay (never conformance)", () => {
  it("reads every scenario result below a row with its participants' adapters and the counted-as-conformance flag", () => {
    const r = tmp();
    ceremonyRecordsFixture(r);
    const recs = readCeremonyRecords(r);
    assert.deepEqual(recs.map((x) => [x.row, x.scenario, x.status, x.adapters, x.countedAsConformance]), [
      ["kvc.a", "FC-KVC-001", "completed", ["keyring-wallet", "verifiable-trust-infrastructure-inprocess"], false],
      ["rms.up", "FC-RMS-001", "ended-as-specified", ["reference-party"], false],
    ]);
  });
});

describe("comment-stripped evidence", () => {
  it("blanks comments, keeps line numbers and does not treat https:// inside a string as a comment", () => {
    const src = "const a = 'https://trusttasks.org/spec/x/y/0.1' // note\n/* c\n d */ const b = 2\n";
    const out = stripComments(src);
    assert.equal(out.split("\n").length, src.split("\n").length);
    assert.match(out, /spec\/x\/y\/0\.1/);
    assert.doesNotMatch(out, /note|\bd\b/);
  });
  it("finds literal URIs, payload imports, constant-based templates and the version-only template, and reports comment-only mentions", () => {
    const src = [
      "import * as P from '@openvtc/trust-tasks/vtc/join-requests/submit/0.3/payload'",
      "const SPEC = 'https://trusttasks.org/spec/vtc/badges/'",
      "const ERR = 'https://trusttasks.org/spec/trust-task-error/'",
      "const POLL = 'https://trusttasks.org/spec'",
      "export const T = { a: `${SPEC}mine/list/0.1`, e: `${ERR}0.5`, v: `${POLL}/vta/pcs/vote/0.4`, l: 'https://trusttasks.org/spec/acl/grant/0.3' }",
      "// see https://trusttasks.org/spec/only/in/comment/0.1 and https://trusttasks.org/spec/acl/grant/0.3",
    ].join("\n");
    const code = [...kwUriLines(src).keys()].map((u) => u.replace(B, "")).sort();
    assert.deepEqual(code, ["acl/grant/0.3", "trust-task-error/0.5", "vta/pcs/vote/0.4", "vtc/badges/mine/list/0.1", "vtc/join-requests/submit/0.3"]);
    assert.equal(kwUriLines(src).get(`${B}vtc/badges/mine/list/0.1`), 5);
    assert.deepEqual([...kwCommentUriLines(src)].map(([u, l]) => [u.replace(B, ""), l]), [["only/in/comment/0.1", 6]]);
  });
  it("scans a checkout: tests, docs and build output are not evidence, a comment-only version is commentOnly", () => {
    const r = tmp();
    put(r, "bifold/packages/core/src/a/wire.ts", "const S = 'https://trusttasks.org/spec/acl/'\nexport const X = `${S}grant/0.3`\n// https://trusttasks.org/spec/only/comment/0.1\n");
    put(r, "bifold/packages/core/src/a/__tests__/w.test.ts", "const u = 'https://trusttasks.org/spec/test/only/0.1'\n");
    put(r, "bifold/packages/core/lib/typescript/src/a/wire.d.ts", "readonly x: 'https://trusttasks.org/spec/built/only/0.1'\n");
    const u = scanKw(r);
    assert.deepEqual([...u.referenced.keys()], [`${B}acl/grant/0.3`]);
    assert.deepEqual([...u.commentOnly], [`${B}only/comment/0.1`]);
    assert.deepEqual(u.evidence.get(`${B}acl/grant/0.3`), [{ file: "bifold/packages/core/src/a/wire.ts", line: 2, kind: "code" }]);
  });
});

const rules: RoleRules = {
  format: "tt-kw-role-rules/0.1", about: "t",
  serves: [{ slug: "vetting/request", file: "v.ts", symbol: "isVettingRequest" }, { slug: "ghost/handler", file: "v.ts", symbol: "missingSymbol" }],
  namesOnlyFiles: ["approvalRules.ts"],
  unnamed: [
    { match: "vtc/", role: "not-involved", why: "community admin" }, { match: "vtc/rooms/", role: "wallet-relevant-not-named", why: "member rooms" },
    { match: "persona/", role: "client-capable-not-built", why: "persona" }, { match: "process-attestation", role: "not-involved", why: "exact" },
  ],
};
const ev = (file: string, kind: "code" | "comment" = "code", line = 3) => [{ file, line, kind }];

describe("wallet roles from evidence (D301)", () => {
  const tasks = [
    tv("a/serves", "0.1"), tv("a/emits", "0.2"), tv("a/emits", "0.1", { latest: false, focus: "older" }), tv("a/old", "0.4"), tv("a/old", "0.2", { latest: false, focus: "older" }),
    tv("a/list", "1.0"), tv("a/comment", "0.1"), tv("vetting/request", "0.1"), tv("ghost/handler", "0.1"), tv("vtc/rooms/x", "0.1"), tv("vtc/y", "0.1"), tv("persona/z", "0.1"),
    tv("process-attestation", "0.1"), tv("nowhere/q", "0.1"), tv("a/retired", "0.1", { focus: "retired" }),
  ];
  const usage = {
    referenced: new Map([[`${B}a/serves/0.1`, new Set(["c.ts"])], [`${B}a/emits/0.2`, new Set(["w.ts"])], [`${B}a/old/0.2`, new Set(["w.ts"])], [`${B}a/list/1.0`, new Set(["approvalRules.ts"])], [`${B}vetting/request/0.1`, new Set(["v.ts"])]]),
    evidence: new Map([[`${B}a/serves/0.1`, [...ev("ceremony.ts", "code", 9)]], [`${B}a/emits/0.2`, ev("w.ts")], [`${B}a/old/0.2`, ev("w.ts", "code", 8)], [`${B}a/list/1.0`, ev("approvalRules.ts")], [`${B}a/comment/0.1`, ev("n.ts", "comment", 4)]]),
    commentOnly: new Set([`${B}a/comment/0.1`]),
    serves: new Set([`${B}a/serves/0.1`]),
    notes: [],
  };
  const rows = deriveRoles({ tasks, usage, rules, fileHas: (f, s) => f === "v.ts" && s === "isVettingRequest" });
  const role = (slug: string) => rows.find((r) => r.slug === slug);
  it("serves through the registry (with the registry line) or through a handler rule whose symbol is found", () => {
    assert.deepEqual([role("a/serves")?.role, role("a/serves")?.basis, role("a/serves")?.evidence[0]], ["serves", "registry", { file: "ceremony.ts", line: 9, kind: "registry", note: "trustTaskRegistry.register" }]);
    assert.deepEqual([role("vetting/request")?.role, role("vetting/request")?.basis], ["serves", "handler"]);
    assert.equal(role("ghost/handler")?.role, "unclassified", "a handler rule whose symbol is missing is ignored, so it falls through");
  });
  it("emits for code naming the latest, older-version for a lower one, names-only for a list file or a comment", () => {
    assert.equal(role("a/emits")?.role, "emits");
    assert.deepEqual([role("a/old")?.role, role("a/old")?.version, role("a/old")?.versionsNamed], ["older-version", "0.4", ["0.2"]]);
    assert.equal(role("a/list")?.role, "names-only");
    assert.deepEqual([role("a/comment")?.role, role("a/comment")?.basis], ["names-only", "comment"]);
  });
  it("takes an unnamed slug's role from the longest prefix rule and reports a slug with no rule as unclassified; retired slugs are out", () => {
    assert.equal(role("vtc/rooms/x")?.role, "wallet-relevant-not-named");
    assert.equal(role("vtc/y")?.role, "not-involved");
    assert.equal(role("persona/z")?.role, "client-capable-not-built");
    assert.equal(role("process-attestation")?.role, "not-involved");
    assert.equal(role("nowhere/q")?.role, "unclassified");
    assert.equal(role("a/retired"), undefined);
    assert.equal(ruleFor(rules.unnamed, "vtc/rooms/x")?.match, "vtc/rooms/");
    assert.equal(ruleFor(rules.unnamed, "process-attestation-x"), undefined);
    const c = countRoles(rows);
    assert.equal(c.withRole, 6);
    assert.equal(c.total, rows.length);
  });
  it("counts role-based denominators and the reach classes per wallet platform", () => {
    const ts = tasks.map((t) => ({ ...t, platforms: { "keyring-wallet": t.slug === "a/serves" || t.slug === "persona/z" ? "covered" : t.slug === "a/emits" ? "skip" : "none" } as TaskVersion["platforms"] }));
    ts.find((t) => t.slug === "a/serves")!.ceremony = { "keyring-wallet": { scenarios: ["S"], rows: ["r"], outcomes: { completed: 1 } } };
    const k = kwReachSummary(ts as TaskVersion[], rows.filter((r) => r.role !== "unclassified"), ["keyring-wallet"]);
    assert.equal(k.withRole, 6);
    const p = k.platforms["keyring-wallet"] as NonNullable<typeof k.platforms[string]>;
    assert.deepEqual(p.reach, { covered: 1, platform: 1, "not-run": 0, "no-vector": 4, "not-built": 2, "not-involved": 2 });
    assert.equal(p.ranOutsideRole, 1, "persona/z ran although the wallet has no role in it: it stays not-built and is counted apart");
    assert.equal(p.ceremonySlugs, 1);
  });
});

describe("participation table", () => {
  it("summarises vectors per platform and gives the result by role", () => {
    const seen = new Map([["V1", { status: "PASS", surfaces: ["s"] }], ["V2", { status: "KNOWN-FAIL", surfaces: ["s"] }], ["V3", { status: "SKIP", skipReason: "type not declared: u", surfaces: ["s"] }]]);
    assert.deepEqual(summarise(["V1", "V2"], seen), { n: 2, ran: 2, pass: 1, differs: 1, skipped: 0, notRun: 0 });
    assert.deepEqual(summarise(["V3", "V4"], seen), { n: 2, ran: 0, pass: 0, differs: 0, skipped: 1, notRun: 1, skipReason: "type not declared" });
    const none = summarise([], seen);
    const skip = summarise(["V3"], seen);
    assert.equal(resultOf("emits", none, none), "role-no-vector");
    assert.equal(resultOf("emits", skip, none), "role-skipped");
    assert.equal(resultOf("emits", summarise(["V9"], seen), none), "role-not-run");
    assert.equal(resultOf("not-involved", skip, none), "n/a");
    assert.equal(resultOf("serves", summarise(["V1"], seen), none), "ran-agree");
    assert.equal(resultOf("serves", summarise(["V2"], seen), none), "ran-differs");
  });
  it("builds rows with emit and consumer vectors split by set, the ceremony overlay and role-level counts; the page has no local paths", () => {
    const t = tv("a/emits", "0.2", { vectors: ["EM-1", "CB-1"], ceremony: { "keyring-wallet": { scenarios: ["FC-X-001"], rows: ["kvc.a"], outcomes: { completed: 1 } } } });
    const roles = deriveRoles({ tasks: [t], usage: { referenced: new Map([[t.typeUri, new Set(["w.ts"])]]), evidence: new Map([[t.typeUri, ev("w.ts")]]), commentOnly: new Set(), serves: new Set(), notes: [] }, rules, fileHas: () => false });
    const details = new Map([["keyring-wallet", new Map([["EM-1", { status: "PASS", surfaces: ["emit"] }], ["CB-1", { status: "SKIP", skipReason: "type not declared: u", surfaces: ["shim"] }]])]]);
    const rows = buildParticipation({ tasks: [t], roles, vectors: [{ id: "EM-1", group: "EM", set: "emit", channel: "registry", tasks: [t.typeUri], maturities: [], sourceKinds: [], focus: "focus" }, { id: "CB-1", group: "CB", set: "coverage", channel: "proposed", tasks: [t.typeUri], maturities: [], sourceKinds: [], focus: "focus" }], details, scenarioTasks: new Map([["FC-X-001", [t.typeUri]], ["FC-X-002", [t.typeUri]]]) });
    const r = rows[0];
    assert.deepEqual([r?.emit["keyring-wallet"]?.ran, r?.consumer["keyring-wallet"]?.skipped, r?.result["keyring-wallet"]], [1, 1, "ran-agree"]);
    assert.deepEqual(r?.ceremonyNamed, ["FC-X-001", "FC-X-002"]);
    assert.deepEqual(participationCounts(rows, "keyring-wallet"), { withRole: 1, ran: 1, byResult: { "ran-agree": 1 }, byRole: { emits: { n: 1, ran: 1 } } });
    const md = renderParticipation(rows, { inputs: { "keyring-wallet": "969963df" }, generated: "2026-11-20", runInfo: { x: "1 run folders read" } });
    assert.match(md, /\| `a\/emits` \| 0\.2 \| emits \| w\.ts:3 \| 1 of 1 ran, all pass \| 1: skipped \(type not declared\) \| 1 scenario\(s\) in kvc\.a \| ran-agree \|/);
    assert.doesNotMatch(md, /\/srv\/|\/home\/|\/var\/tmp|\/tmp\//);
  });
});

describe("committed data (decisions D300 to D303)", () => {
  const rd = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const have = (p: string): boolean => existsSync(new URL(`../../${p}`, import.meta.url));
  it("the run map parses and names each folder once", () => {
    const m = parseRunMap(JSON.stringify(rd("results/platform-run-map.json")));
    assert.ok(m.runs.length > 50);
    assert.ok(m.runs.some((r) => r.platform === "keyring-wallet" && r.folder === "runs/2026-11-19-final-upstream-keyring-wallet"), "the folder the old name pattern missed is mapped");
    for (const r of m.runs) assert.ok(!m.notPlatform.includes(r.folder), `${r.folder} is both a platform run and not a platform`);
  });
  it("every focus slug has a role (none unclassified), the counts add up, and the participation rows are the roles", () => {
    if (!have("results/coverage/kw-roles.json")) return;
    const roles = rd("results/coverage/kw-roles.json") as { rows: { slug: string; role: string }[] };
    const part = rd("results/coverage/kw-participation.json") as { rows: { slug: string }[] };
    const matrix = rd("results/coverage/matrix.json") as { focus: { focusVersions: number; kwReach: { withRole: number; roles: Record<string, number> } } };
    assert.equal(roles.rows.filter((r) => r.role === "unclassified").length, 0);
    assert.equal(roles.rows.length, matrix.focus.focusVersions);
    assert.deepEqual(part.rows.map((r) => r.slug), roles.rows.map((r) => r.slug));
    assert.equal(Object.values(matrix.focus.kwReach.roles).reduce((a, b) => a + b, 0), roles.rows.length);
    const withRole = roles.rows.filter((r) => ["serves", "emits", "older-version", "names-only"].includes(r.role)).length;
    assert.equal(matrix.focus.kwReach.withRole, withRole);
  });
});
