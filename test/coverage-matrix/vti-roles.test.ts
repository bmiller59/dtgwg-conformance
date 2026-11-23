// SPDX-License-Identifier: Apache-2.0
// VTI roles and the sending-side scan (decisions D420 to D423): Rust comment and test stripping, constant and alias resolution, direction by
// call role, role derivation by surface, the participation table and the committed data. Synthetic inputs only.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildConstTable, constDefs, extractRefs, flatTable, inTableInitialiser, rustCode, stripRustComments, stripTestItems, useOf } from "../../src/coverage/matrix/rust-source.ts";
import { detailsByVtiSurface, vtiSurfaceOfRun } from "../../src/coverage/matrix/platforms.ts";
import { parseRunMap } from "../../src/coverage/matrix/runmap.ts";
import type { TaskVersion } from "../../src/coverage/matrix/types.ts";
import { buildVtiParticipation, renderVtiParticipation, vtiSurfaceCounts } from "../../src/coverage/matrix/vti-participation.ts";
import { deriveVtiRoles, familyRule, scanVtiRoles, type VtiRoleRules, type VtiUsage } from "../../src/coverage/matrix/vti-roles.ts";
import { put, tmp } from "./helpers.ts";

const B = "https://trusttasks.org/spec/";
const tv = (slug: string, version: string, o: Partial<TaskVersion> = {}): TaskVersion => ({
  typeUri: `${B}${slug}/${version}`, slug, version, family: slug.split("/")[0] as string, title: "t", status: "draft", sources: [], latest: true, focus: "focus", supersededBy: null, successors: [],
  vti: { pinned: false, served: [] }, kw: { referenced: false, serves: false, files: [] }, vectors: [], platforms: {}, ...o,
});
const table = (files: Record<string, string>): ReturnType<typeof buildConstTable> => {
  let known = new Map<string, string>();
  let t = buildConstTable([]);
  for (let i = 0; i < 2; i++) { t = buildConstTable(Object.entries(files).flatMap(([f, c]) => constDefs(rustCode(c), f, known))); known = flatTable(t); }
  return t;
};
const allRefs = (src: string, file = "x.rs", files: Record<string, string> = { [file]: src }) => extractRefs(rustCode(src), file, table(files));
const refsOf = (src: string, file = "x.rs", files: Record<string, string> = { [file]: src }) => allRefs(src, file, files).filter((x) => x.use !== "definition");

describe("Rust comment and test stripping (D420)", () => {
  it("blanks line, block (nested) and doc comments but keeps strings, raw strings, char literals and line numbers", () => {
    const src = `a // c1\nb /* x /* y */ z */ c\nlet u = "https://trusttasks.org/spec/acl/list/0.4"; // tail\nlet r = r#"// not a comment "quoted""#;\nlet q = '"'; let l: &'static str = "//x";\n/// doc\nend`;
    const out = stripRustComments(src);
    assert.equal(out.split("\n").length, src.split("\n").length);
    assert.doesNotMatch(out, /c1|tail|doc| x | y | z /);
    assert.match(out, /"https:\/\/trusttasks\.org\/spec\/acl\/list\/0\.4"/);
    assert.match(out, /r#"\/\/ not a comment "quoted""#/);
    assert.match(out, /let l: &'static str = "\/\/x";/);
    assert.match(out, /end$/);
  });
  it("removes #[cfg(test)] modules and #[test] functions with their bodies, and nothing else", () => {
    const src = `fn keep() { let x = 1; }\n#[cfg(test)]\nmod tests {\n  use super::*;\n  #[test]\n  fn t() { let s = "}"; assert!(true); }\n}\n#[tokio::test]\nasync fn u() { let a = {1}; }\nfn also_keep() {}\n`;
    const out = stripTestItems(stripRustComments(src));
    assert.match(out, /fn keep\(\)/);
    assert.match(out, /fn also_keep\(\)/);
    assert.doesNotMatch(out, /mod tests|fn t\(|fn u\(|assert/);
    assert.equal(out.split("\n").length, src.split("\n").length);
  });
  it("a task named only in a comment or a test is not a reference", () => {
    const src = `// https://trusttasks.org/spec/acl/list/0.4\nfn f() {}\n#[cfg(test)]\nmod tests { const X: &str = "https://trusttasks.org/spec/acl/grant/0.3"; fn t() { send(X); } }\n`;
    assert.deepEqual(refsOf(src), []);
  });
});

describe("references: constants, module aliases and direction by call role (D420)", () => {
  it("resolves a literal constant, a payload constant through a use alias, and super:: paths; the definition is not a reference", () => {
    const src = `use vti_specs::vtc::elections::{cancel::v0_1 as cancel, create::v0_5 as create};\nmod task {\n  pub const CANCEL: &str = <super::cancel::Payload as Payload>::TYPE_URI;\n  pub const OTHER: &str = "${B}vtc/elections/list/0.5";\n}\nfn send1(c: &C) { c.acl_task(task::CANCEL, p); c.rpc_tt(task::OTHER, q); let _ = checked::<create::Payload>(v); }\n`;
    const r = allRefs(src);
    assert.deepEqual(r.filter((x) => x.use !== "definition").map((x) => `${x.uri.slice(B.length)}:${x.use}`).sort(), ["vtc/elections/cancel/0.1:send", "vtc/elections/create/0.5:send", "vtc/elections/list/0.5:send"]);
    assert.equal(r.filter((x) => x.use === "definition").length, 2, "the two definitions are marked so the scanners can leave them out");
  });
  it("a name two files define differently is read per file, never borrowed from the other file", () => {
    const a = `mod task { pub const CANCEL: &str = "${B}auth/oob/cancel/0.1"; }\nfn f() { go(task::CANCEL); }\n`;
    const b = `use vti_specs::vtc::elections::cancel::v0_1 as cancel;\nmod task { pub const CANCEL: &str = <super::nope::Payload as Payload>::TYPE_URI; }\nfn g() { go(task::CANCEL); }\n`;
    const files = { "a.rs": a, "b.rs": b };
    assert.deepEqual(refsOf(a, "a.rs", files).map((x) => x.uri.slice(B.length)), ["auth/oob/cancel/0.1"]);
    assert.deepEqual(refsOf(b, "b.rs", files), [], "b.rs defines CANCEL itself, unresolved: it must not read a.rs's constant");
  });
  it("classifies by call role: send, build, compare, dispatch, and re-exports, lists and tables as named", () => {
    const U = `"${B}vtc/members/admit/0.1"`;
    const kinds = (body: string): string[] => refsOf(`const ADMIT: &str = ${U};\nfn f() {\n${body}\n}\n`).map((x) => x.use);
    assert.deepEqual(kinds("client.rpc_tt(ADMIT, p).await;"), ["send"]);
    assert.deepEqual(kinds("let doc = json!({ \"type\": ADMIT });"), ["build"]);
    assert.deepEqual(kinds("if msg.typ == ADMIT { handle(msg); }"), ["compare"]);
    assert.deepEqual(kinds("match t { ADMIT => 1, _ => 2 };"), ["compare"]);
    assert.deepEqual(kinds("if t.starts_with(ADMIT) {}"), ["compare"]);
    assert.deepEqual(refsOf(`pub use vti_specs::vtc::members::{admit::v0_1 as admit, role::set::v0_1 as role_set};\n`).map((x) => x.use), []);
    const listed = refsOf(`const TASKS: &[&str] = &[\n  ${U},\n];\nstatic T: &[(&str, u8)] = &[(${U}, 1)];\n`);
    assert.deepEqual(listed.map((x) => x.use), ["reexport", "reexport"]);
    const src = `const ADMIT: &str = ${U};\nconst L: &[&str] = &[ADMIT];\nfn f() { send(ADMIT); }`;
    assert.equal(inTableInitialiser(src, src.indexOf("&[ADMIT]") + 3), true);
    assert.equal(inTableInitialiser(src, src.indexOf("send(ADMIT)") + 5), false);
    assert.equal(useOf("on!(routes, vti_specs::a::b::v0_1::Payload => h)", "on!(routes, ".length, 10, false), "dispatch");
  });
});

describe("roles by surface (D420)", () => {
  const rules: VtiRoleRules = {
    format: "tt-vti-role-rules/0.1", about: "",
    surfaces: [
      { id: "svc", label: "service", kind: "service", crates: ["svc"], serve: [] },
      { id: "cli", label: "client", kind: "client", crates: ["cli"] },
    ],
    catalogueFiles: ["cli/src/catalogue.rs"],
    families: [
      { match: "alpha/", owners: ["svc"], callers: ["cli"], why: "alpha is served by svc and called by the client" },
      { match: "beta/", owners: [], callers: [], why: "beta belongs to nobody here" },
      { match: "alpha/deep/", owners: [], callers: ["cli"], why: "longer prefix wins" },
      { match: "solo", owners: ["svc"], callers: [], why: "exact slug" },
    ],
  };
  const t = [tv("alpha/serve", "0.2"), tv("alpha/send", "0.1"), tv("alpha/send", "0.0", { latest: false, focus: "older" }), tv("alpha/older", "0.1", { latest: false, focus: "older" }), tv("alpha/older", "0.2"), tv("alpha/list", "0.1"), tv("alpha/pin", "0.1"), tv("alpha/deep/x", "0.1"), tv("beta/z", "0.1"), tv("solo", "0.1"), tv("nowhere/q", "0.1")];
  const usage: VtiUsage = {
    surfaces: {
      svc: new Map([[`${B}alpha/serve/0.2`, [{ file: "svc/src/mod.rs", line: 9, use: "dispatch", token: "T" }]]]),
      cli: new Map([
        [`${B}alpha/serve/0.2`, [{ file: "cli/src/a.rs", line: 4, use: "compare", token: "T" }, { file: "cli/src/a.rs", line: 8, use: "send", token: "T" }]],
        [`${B}alpha/send/0.1`, [{ file: "cli/src/b.rs", line: 2, use: "send", token: "T" }]],
        [`${B}alpha/older/0.1`, [{ file: "cli/src/c.rs", line: 3, use: "build", token: "T" }]],
        [`${B}alpha/list/0.1`, [{ file: "cli/src/catalogue.rs", line: 5, use: "reexport", token: "T" }]],
      ]),
    },
    pinned: new Map([[`${B}alpha/pin/0.1`, { file: "specs/trust-tasks.lock", line: 12 }]]), filesScanned: {}, unresolved: [], notes: [],
  };
  const rows = deriveVtiRoles({ tasks: t, usage, rules });
  const role = (slug: string, s: string) => rows.find((r) => r.slug === slug)?.surfaces[s];
  it("takes serves from a handler registration, and a client's emit or read from its call role", () => {
    assert.deepEqual([role("alpha/serve", "svc")?.role, role("alpha/serve", "svc")?.basis], ["serves", "dispatch"]);
    assert.deepEqual([role("alpha/serve", "cli")?.role, role("alpha/serve", "cli")?.also], ["emits", ["serves"]], "a client that both sends and reads a task is an emitter that also reads it");
    assert.equal(role("alpha/serve", "cli")?.evidence[0]?.use, "send");
  });
  it("older-version, named-only (list, pin) and the rule roles", () => {
    assert.equal(role("alpha/send", "cli")?.role, "emits");
    assert.equal(role("alpha/older", "cli")?.role, "older-version");
    assert.deepEqual([role("alpha/list", "cli")?.role, role("alpha/list", "cli")?.basis], ["named-only", "code"]);
    assert.deepEqual([role("alpha/pin", "svc")?.role, role("alpha/pin", "svc")?.basis, role("alpha/pin", "svc")?.evidence[0]?.file], ["named-only", "pin", "specs/trust-tasks.lock"]);
    assert.equal(role("alpha/pin", "cli")?.role, "not-built");
    assert.equal(role("alpha/deep/x", "svc")?.role, "not-involved", "the longest prefix rule wins");
    assert.equal(role("beta/z", "svc")?.role, "not-involved");
    assert.equal(role("beta/z", "cli")?.role, "not-involved");
    assert.equal(role("solo", "svc")?.role, "not-built", "an exact-slug rule");
    assert.equal(role("nowhere/q", "svc")?.role, "unclassified");
    assert.match(role("alpha/pin", "cli")?.why ?? "", /alpha is served/);
  });
  it("matches a slug equal to a prefix rule without its slash, and the longest prefix first", () => {
    assert.equal(familyRule(rules.families, "alpha")?.match, "alpha/");
    assert.equal(familyRule(rules.families, "alpha/deep/x")?.match, "alpha/deep/");
    assert.equal(familyRule(rules.families, "solo-x"), undefined);
  });
});

describe("scan of a synthetic checkout (D420)", () => {
  const root = tmp();
  put(root, "vta-service/src/trust_tasks/mod.rs", `// dispatch_table! { "${B}fake/commented/0.1" }\ndispatch_table! {\n  vta_sdk::trust_tasks::TASK_ACL_LIST_0_4 => acl::list [ Read ],\n  "${B}keys/create/0.1" => keys::create [ Mutating ],\n}\n#[cfg(test)]\nmod tests { fn t() { let _ = "${B}fake/intest/0.1"; } }\n`);
  put(root, "vta-sdk/src/trust_tasks.rs", `pub const TASK_ACL_LIST_0_4: &str = "${B}acl/list/0.4";\npub const TASK_ACL_GRANT_0_3: &str = "${B}acl/grant/0.3";\npub const ALL: &[&str] = &[TASK_ACL_LIST_0_4, TASK_ACL_GRANT_0_3];\n`);
  put(root, "vta-sdk/src/client/acl.rs", `use crate::trust_tasks;\nimpl C { async fn grant(&self) { self.rpc_tt(crate::trust_tasks::TASK_ACL_GRANT_0_3, p, 30).await; } }\n`);
  put(root, "vtc-service/src/trust_tasks/members.rs", `use vti_specs::vtc::members::admit::v0_1 as admit;\nfn register(routes: &mut R) { on!(routes, admit::Payload => handle_admit); on!(routes, vti_specs::acl::grant::v0_2::Payload => g); }\n`);
  put(root, "vtc-service/tests/it/x.rs", `fn t() { on!(routes, vti_specs::fake::it::v0_1::Payload => g); }\n`);
  put(root, "specs/trust-tasks.lock", `[[task]]\ntype_uri = "${B}keys/create/0.1"\n[[task]]\ntype_uri = "${B}acl/grant/0.3#response"\n`);
  const rules: VtiRoleRules = {
    format: "tt-vti-role-rules/0.1", about: "",
    surfaces: [
      { id: "vta", label: "agent", kind: "service", crates: ["vta-service"], serve: [{ file: "vta-service/src/trust_tasks/mod.rs", kind: "dispatch_table", marker: "\\bdispatch_table!\\s*\\{" }] },
      { id: "vtc", label: "community", kind: "service", crates: ["vtc-service"], serve: [{ pattern: "^vtc-service/src/trust_tasks/[a-z0-9_]+\\.rs$", kind: "on" }] },
      { id: "client", label: "client", kind: "client", crates: ["vta-sdk"] },
    ],
    catalogueFiles: ["vta-sdk/src/trust_tasks.rs"], families: [],
  };
  const u = scanVtiRoles(root, rules);
  it("reads handler tables and on! registrations (constants resolved across crates, comments and tests ignored) with file and line", () => {
    const at = (s: string, slug: string) => u.surfaces[s]?.get(`${B}${slug}`);
    assert.deepEqual(at("vta", "acl/list/0.4")?.map((r) => [r.file, r.line, r.use]), [["vta-service/src/trust_tasks/mod.rs", 3, "dispatch"]]);
    assert.equal(at("vta", "keys/create/0.1")?.[0]?.line, 4);
    assert.equal(at("vta", "fake/commented/0.1"), undefined);
    assert.equal(at("vta", "fake/intest/0.1"), undefined);
    assert.deepEqual([...u.surfaces["vtc"]!.keys()].map((k) => k.slice(B.length)).sort(), ["acl/grant/0.2", "vtc/members/admit/0.1"]);
    assert.equal(at("vtc", "fake/it/0.1"), undefined, "tests/ is not source");
    assert.deepEqual(u.unresolved, []);
  });
  it("reads the sending side by call role: a call is emits, the constant catalogue is named only; pins carry file and line", () => {
    const grant = u.surfaces["client"]?.get(`${B}acl/grant/0.3`) ?? [];
    assert.deepEqual(grant.map((r) => [r.file, r.use]).sort(), [["vta-sdk/src/client/acl.rs", "send"], ["vta-sdk/src/trust_tasks.rs", "reexport"]]);
    assert.deepEqual((u.surfaces["client"]?.get(`${B}acl/list/0.4`) ?? []).map((r) => r.use), ["reexport"]);
    assert.deepEqual(u.pinned.get(`${B}acl/grant/0.3`), { file: "specs/trust-tasks.lock", line: 4 });
  });
});

describe("participation by surface (D421)", () => {
  const rules = { surfaces: [{ id: "vta", label: "agent service" }, { id: "vtc", label: "community service" }, { id: "client", label: "client builders" }, { id: "witness", label: "witness" }] } as unknown as VtiRoleRules;
  const t = tv("a/x", "0.2", { vectors: ["CB-1", "EM-1"] });
  const role = (r: string, extra = {}) => ({ role: r, basis: "code", also: [], evidence: [{ file: "f.rs", line: 3, use: "send" }], versionsNamed: [], ...extra });
  const roles = [{ slug: "a/x", version: "0.2", family: "a", surfaces: { vta: role("serves"), vtc: role("not-involved", { evidence: [] }), client: role("emits"), witness: role("named-only") } }] as never;
  const m = parseRunMap(JSON.stringify({ format: "tt-platform-run-map/0.1", about: "", ceremonyRows: [], notPlatform: [], runs: [
    { folder: "r/agent", platform: "vti", surface: "agent", checkout: "x", date: "d" }, { folder: "r/community", platform: "vti", surface: "community", checkout: "x", date: "d" }, { folder: "r/emit", platform: "vti", surface: "emit", checkout: "x", date: "d" }, { folder: "r/shim", platform: "keyring-wallet", surface: "shim", checkout: "x", date: "d" },
  ] }));
  const records = [{ folder: "r/agent", id: "CB-1", status: "PASS" }, { folder: "r/community", id: "CB-1", status: "FAIL" }, { folder: "r/emit", id: "EM-1", status: "KNOWN-FAIL" }, { folder: "r/shim", id: "CB-1", status: "PASS" }];
  const details = detailsByVtiSurface(records, m);
  const rows = buildVtiParticipation({ tasks: [t], roles, surfaces: ["vta", "vtc", "client", "witness"], vectors: [{ id: "CB-1", group: "CB", set: "plain", channel: "registry", tasks: [t.typeUri], maturities: [], sourceKinds: [], focus: "focus" }, { id: "EM-1", group: "EM", set: "emit", channel: "registry", tasks: [t.typeUri], maturities: [], sourceKinds: [], focus: "focus" }], details, scenarioTasks: new Map([["FC-1", [t.typeUri]]]) });
  it("keeps each surface's runs apart: agent and community read their own consumer vectors, the client its emit vectors; other surfaces have no runs", () => {
    assert.equal(vtiSurfaceOfRun("gap-agent-e"), "vta");
    assert.equal(vtiSurfaceOfRun("community-probe"), "vtc");
    assert.equal(vtiSurfaceOfRun("2l"), "client");
    assert.equal(vtiSurfaceOfRun("shim"), null);
    const r = rows[0]!;
    assert.deepEqual([r.result["vti"]?.["vta"], r.result["vti"]?.["vtc"], r.result["vti"]?.["client"], r.result["vti"]?.["witness"]], ["ran-agree", "ran-differs", "ran-differs", "n/a"], "a result is read even where the role is not-involved (it ran); a surface without runs and without a role is n/a");
  });
  it("counts with the role-based denominator: serves, emits and older-version only", () => {
    const c = vtiSurfaceCounts(rows, "vti", "vta");
    assert.deepEqual([c.withRole, c.ran, c.byRole["serves"]], [1, 1, 1]);
    assert.deepEqual([vtiSurfaceCounts(rows, "vti", "witness").withRole, vtiSurfaceCounts(rows, "vti", "witness").byRole["named-only"]], [0, 1]);
    const md = renderVtiParticipation(rows, rules, { inputs: { VTI: "71d5" }, generated: "2026-11-20", runInfo: { x: "1 run folders read" } });
    assert.match(md, /\| `a\/x` \| 0\.2 \| serves \| - \| emits \| named only \|/);
    assert.doesNotMatch(md, /\/srv\/|\/home\/|\/var\/tmp|\/tmp\//);
    assert.match(md, /named-only` is shown as not yet built with a `named only` flag/);
  });
});

describe("committed data (decisions D420 to D423)", () => {
  const rd = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
  const have = (p: string): boolean => existsSync(new URL(`../../${p}`, import.meta.url));
  it("the rules name known surfaces, each family states its reason, and surfaces and families are unique", () => {
    const rules = rd("results/coverage/vti-role-rules.json") as VtiRoleRules;
    const ids = rules.surfaces.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, ["vta", "vtc", "witness", "voting", "client", "mobile", "mcp"]);
    assert.equal(new Set(rules.families.map((f) => f.match)).size, rules.families.length);
    for (const f of rules.families) {
      assert.ok(f.why.length > 20, `${f.match} states its reason`);
      for (const s of [...f.owners, ...f.callers]) assert.ok(ids.includes(s), `${f.match}: unknown surface ${s}`);
      for (const o of f.owners) assert.equal(rules.surfaces.find((s) => s.id === o)?.kind, "service", `${f.match}: owner ${o} is a service`);
      for (const c of f.callers) assert.equal(rules.surfaces.find((s) => s.id === c)?.kind, "client", `${f.match}: caller ${c} is a client`);
    }
  });
  it("every focus slug has a role on every surface (none unclassified), the participation rows are the roles, and the served roles cover the dispatcher tables", () => {
    if (!have("results/coverage/vti-roles.json")) return;
    const roles = rd("results/coverage/vti-roles.json") as { surfaces: { id: string }[]; rows: { slug: string; surfaces: Record<string, { role: string; evidence: { file: string; line: number }[]; basis: string }> }[] };
    const part = rd("results/coverage/vti-participation.json") as { rows: { slug: string }[] };
    const matrix = rd("results/coverage/matrix.json") as { focus: { focusVersions: number }; tasks: { slug: string; latest: boolean; focus: string; vti: { served: string[] } }[] };
    assert.equal(roles.rows.length, matrix.focus.focusVersions);
    assert.deepEqual(part.rows.map((r) => r.slug), roles.rows.map((r) => r.slug));
    for (const r of roles.rows) for (const s of roles.surfaces) assert.notEqual(r.surfaces[s.id]?.role, "unclassified", `${r.slug} on ${s.id}`);
    for (const [surface, key] of [["vta", "vta"], ["vtc", "vtc"], ["witness", "witness"]] as const) {
      const mine = new Set(roles.rows.filter((r) => r.surfaces[surface]?.role === "serves").map((r) => r.slug));
      for (const x of matrix.tasks.filter((t) => t.latest && t.focus === "focus" && t.vti.served.includes(key))) assert.ok(mine.has(x.slug), `${x.slug} is in the dispatcher table scanner's served list for ${surface} but not served in the role file`);
    }
    for (const r of roles.rows) for (const s of roles.surfaces) { const x = r.surfaces[s.id]!; if (["serves", "emits", "named-only"].includes(x.role) && x.basis !== "rule") assert.ok((x.evidence[0]?.file ?? "").length > 0, `${r.slug} on ${s.id} has no evidence file`); }
  });
});
