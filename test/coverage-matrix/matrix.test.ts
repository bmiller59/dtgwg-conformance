// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { build } from "../../src/coverage/matrix/build.ts";
import { classifyFocus, kwSlugState, slugOfSuperseded, vectorFocus, vtiSlugState } from "../../src/coverage/matrix/focus.ts";
import type { TaskVersion } from "../../src/coverage/matrix/types.ts";
import { compareVersions, maturityOf, parseFrontMatter } from "../../src/coverage/matrix/frontmatter.ts";
import { scanKw } from "../../src/coverage/matrix/kw.ts";
import { parseRunMap } from "../../src/coverage/matrix/runmap.ts";
import { readRunResults, statusesByPlatform, taskStatus } from "../../src/coverage/matrix/platforms.ts";
import { renderReadme } from "../../src/coverage/matrix/render.ts";
import { gather } from "../../src/coverage/matrix/sources.ts";
import { loadVectors, tasksReferencedBy } from "../../src/coverage/matrix/vectors.ts";
import { blockAfter, constMap, expandUse, fileConsts, onRegistrations, resolveBlock, scanVti, uriOfSpecPath } from "../../src/coverage/matrix/vti.ts";
import { walk } from "../../src/coverage/matrix/walk.ts";
import { gitIn, put, spec, tmp } from "./helpers.ts";

describe("front matter and versions", () => {
  it("reads the status field and never guesses when it is absent", () => {
    assert.equal(maturityOf(parseFrontMatter(spec("a/b", "0.1", "candidate"))), "candidate");
    assert.equal(maturityOf(parseFrontMatter(spec("a/b", "0.1"))), "unspecified");
    assert.equal(maturityOf(parseFrontMatter("no front matter")), "unspecified");
  });
  it("orders versions numerically", () => {
    assert.ok(compareVersions("0.10", "0.9") > 0);
    assert.ok(compareVersions("1.0", "0.12") > 0);
    assert.equal(compareVersions("0.3", "0.3"), 0);
  });
});

describe("sources: main, PR, branch", () => {
  it("tags each task version with every source, drops branch files identical to main, and flags a draft PR", () => {
    const r = tmp();
    gitIn(r, "init", "-q", "-b", "main");
    put(r, "specs/acl/grant/0.1/spec.md", spec("acl/grant", "0.1", "draft"));
    put(r, "specs/acl/grant/0.2/spec.md", spec("acl/grant", "0.2", "candidate"));
    put(r, "ceremonies/x/y/0.1/ceremony.json", JSON.stringify({ slug: "x/y", version: "0.1", title: "Y", steps: { a: { type: "https://trusttasks.org/spec/acl/grant/0.1#response" } } }));
    gitIn(r, "add", "-A");
    gitIn(r, "commit", "-q", "-m", "base");
    gitIn(r, "update-ref", "refs/remotes/origin/main", "HEAD");
    gitIn(r, "checkout", "-q", "-b", "feat");
    put(r, "specs/new/task/0.1/spec.md", spec("new/task", "0.1", "draft"));
    put(r, "specs/acl/grant/0.2/spec.md", spec("acl/grant", "0.2", "candidate")); // unchanged: must drop out
    gitIn(r, "add", "-A");
    gitIn(r, "commit", "-q", "-m", "feat");
    const head = gitIn(r, "rev-parse", "HEAD").trim();
    gitIn(r, "update-ref", "refs/remotes/origin/feat", "HEAD");
    gitIn(r, "checkout", "-q", "main");
    const g = gather({
      repo: r, ghRepo: "x/y", baseRev: "origin/main",
      prs: [{ number: 7, title: "t", isDraft: true, headRefOid: head, files: ["specs/new/task/0.1/spec.md", "README.md"] }],
    });
    const refs = g.tasks.map((t) => `${t.rec.slug}@${t.rec.version}:${t.source.ref}:${t.source.status}`).sort();
    assert.deepEqual(refs, [
      "acl/grant@0.1:main:draft", "acl/grant@0.2:main:candidate", "new/task@0.1:branch:origin/feat:draft", "new/task@0.1:pr#7:draft",
    ]);
    assert.equal(g.tasks.find((t) => t.source.ref === "pr#7")?.source.draft, true);
    assert.equal(g.ceremonies.length, 1);
    assert.equal(g.ceremonies[0]?.rec.steps[0]?.type, "https://trusttasks.org/spec/acl/grant/0.1");
  });
});

describe("VTI usage", () => {
  it("resolves literal, payload-path and alias constants in a dispatcher table, and reads lock files", () => {
    const r = tmp();
    put(r, "vta-sdk/src/trust_tasks.rs", [
      'pub const TASK_A_0_1: &str = "https://trusttasks.org/spec/acl/list/0.1";',
      "pub const TASK_B_0_2: &str =\n    <vti_specs::auth::revoke_session::v0_2::Payload as trust_tasks_rs::Payload>::TYPE_URI;",
      "pub const TASK_C_0_1: &str = crate::protocols::x::TASK_A_0_1;",
      "pub const TASK_D_0_1: &str = crate::protocols::x::UNKNOWN_THING;",
    ].join("\n"));
    put(r, "vta-service/src/trust_tasks/mod.rs", "// TASK_D_0_1 in a comment\ndispatch_table! {\n  vta_sdk::trust_tasks::TASK_A_0_1 => a::h [ None ],\n  vta_sdk::trust_tasks::TASK_B_0_2 => b::h [ None ],\n  vta_sdk::trust_tasks::TASK_C_0_1 => c::h [ None ],\n  vta_sdk::trust_tasks::TASK_D_0_1 => d::h [ None ],\n}\nfn other() {}");
    put(r, "vtc-service/src/trust_tasks/mod.rs", 'pub(crate) const DISPATCHED_URIS: &[&str] = &[\n  "https://trusttasks.org/spec/vtc/members/list/0.1",\n  vta_sdk::trust_tasks::TASK_A_0_1,\n];\n');
    put(r, "vti-specs-vta/trust-tasks.lock", '[[task]]\ntype_uri = "https://trusttasks.org/spec/vta/app-state/get/1.0"\n');
    const u = scanVti(r);
    assert.deepEqual([...u.pinned], ["https://trusttasks.org/spec/vta/app-state/get/1.0"]);
    const served = Object.fromEntries([...u.served].map(([k, v]) => [k.replace("https://trusttasks.org/spec/", ""), [...v].sort()]));
    assert.deepEqual(served, { "acl/list/0.1": ["vta", "vtc"], "auth/revoke-session/0.2": ["vta"], "vtc/members/list/0.1": ["vtc"] });
    assert.ok(u.unresolved.some((x) => x.endsWith("TASK_D_0_1")), "an unresolvable constant is reported, not dropped silently");
    assert.equal(blockAfter("x { a { b } c } y", /x \{/), "{ a { b } c }");
    assert.deepEqual(resolveBlock('["https://trusttasks.org/spec/a/b/0.1"]', constMap([])).uris, ["https://trusttasks.org/spec/a/b/0.1"]);
  });
});

describe("VTI usage: constants named through a file's own `use` items", () => {
  it("expands a nested use tree with aliases", () => {
    assert.deepEqual(expandUse("vti_specs::vtc::elections::{create::v0_5 as create, tickets::issue::v0_3 as issue, certify::v0_1}"), [
      { path: ["vti_specs", "vtc", "elections", "create", "v0_5"], name: "create" },
      { path: ["vti_specs", "vtc", "elections", "tickets", "issue", "v0_3"], name: "issue" },
      { path: ["vti_specs", "vtc", "elections", "certify", "v0_1"], name: "v0_1" },
    ]);
  });
  it("reads a spec-crate module path as a Type URI, and nothing else", () => {
    assert.equal(uriOfSpecPath(["vti_specs", "did_management", "did", "check_name", "v0_1", "Payload"]), "https://trusttasks.org/spec/did-management/did/check-name/0.1");
    assert.equal(uriOfSpecPath(["trust_tasks_rs", "specs", "trust_task_discovery", "v0_3"]), "https://trusttasks.org/spec/trust-task-discovery/0.3");
    assert.equal(uriOfSpecPath(["crate", "protocols", "x", "v0_1"]), null);
  });
  it("resolves the same alias name to different tasks in different files, and never globally when the files disagree", () => {
    const a = fileConsts("use vti_specs::vtc::elections::{create::v0_5 as create};\npub(crate) const CREATE_TYPE: &str = <create::Payload as Payload>::TYPE_URI;\n");
    const b = fileConsts("use vti_specs::vtc::rooms::create::v0_2 as create;\nconst CREATE_TYPE: &str = <create::Payload as trust_tasks_rs::Payload>::TYPE_URI;\n");
    assert.equal(a.get("CREATE_TYPE"), "https://trusttasks.org/spec/vtc/elections/create/0.5");
    assert.equal(b.get("CREATE_TYPE"), "https://trusttasks.org/spec/vtc/rooms/create/0.2");
    const r = tmp();
    put(r, "vtc-service/src/elections.rs", "use vti_specs::vtc::elections::create::v0_5 as create;\nconst CREATE_TYPE: &str = <create::Payload as Payload>::TYPE_URI;\n");
    put(r, "vtc-service/src/rooms.rs", "use vti_specs::vtc::rooms::create::v0_2 as create;\nconst CREATE_TYPE: &str = <create::Payload as Payload>::TYPE_URI;\n");
    const m = constMap([`${r}/vtc-service/src/elections.rs`, `${r}/vtc-service/src/rooms.rs`]);
    assert.equal(m.has("CREATE_TYPE"), false, "an ambiguous plain name is left unresolved, not guessed");
    assert.deepEqual(resolveBlock("[elections::CREATE_TYPE, rooms::CREATE_TYPE, CREATE_TYPE]", m).uris.sort(), ["https://trusttasks.org/spec/vtc/elections/create/0.5", "https://trusttasks.org/spec/vtc/rooms/create/0.2"]);
  });
});

describe("keyring-wallet usage", () => {
  it("names versions from literals and payload imports in non-test files, and finds registry serves", () => {
    const r = tmp();
    const m = "bifold/packages/core/src/modules/trust-tasks";
    put(r, `${m}/module/vtaDevices.ts`, "export const a = 'https://trusttasks.org/spec/device/list/0.2'");
    put(r, `${m}/__tests__/x.test.ts`, "'https://trusttasks.org/spec/only/in-test/0.1'");
    put(r, `${m}/ceremony.ts`, "import * as propose from '@openvtc/trust-tasks/vrc/relationships/propose/0.1/payload'\nimport * as w from './witnessShareSpec'\nfunction f(){ trustTaskRegistry.register({\n typeUri: propose.TYPE_URI,\n})\n trustTaskRegistry.register({\n typeUri: w.TYPE_URI,\n})}");
    put(r, `${m}/witnessShareSpec.ts`, "export const TYPE_URI = 'https://trusttasks.org/spec/vrc/relationships/witness-share/0.1'");
    const u = scanKw(r);
    const refs = [...u.referenced.keys()].map((k) => k.replace("https://trusttasks.org/spec/", "")).sort();
    assert.deepEqual(refs, ["device/list/0.2", "vrc/relationships/propose/0.1", "vrc/relationships/witness-share/0.1"]);
    assert.deepEqual([...u.serves].map((k) => k.replace("https://trusttasks.org/spec/", "")).sort(), ["vrc/relationships/propose/0.1", "vrc/relationships/witness-share/0.1"]);
  });
});

describe("vectors and platform statuses", () => {
  it("reads every vector set and the ceremony scenarios, and counts references by Type URI and spec path", () => {
    const r = tmp();
    put(r, "vectors/emit/a.json", JSON.stringify({ group: "EM", vectors: [{ id: "EM-001", source: { channel: "registry" }, steps: [{ emit: { type: "https://trusttasks.org/spec/acl/grant/0.2" } }] }] }));
    put(r, "vectors/coverage/b.json", JSON.stringify({ group: "CB-AA", vectors: [{ id: "CB-AA-001", source: { channel: "proposed" }, spec: ["specs/acl/list/0.1/spec.md: text"] }] }));
    put(r, "vectors/imported/c.json", JSON.stringify({ vectors: [{ id: "IMP-1" }] }));
    put(r, "vectors/ceremony-scenarios/fc.json", JSON.stringify({ group: "FC-X", ceremony: { name: "X", channel: "proposed" }, scenarios: [{ id: "FC-X-001", ref: "ceremonies/x/y/0.1/ceremony.json" }] }));
    put(r, "vectors/manifest.json", "{}");
    const l = loadVectors(r);
    assert.deepEqual(l.vectors.map((v) => [v.id, v.set, v.channel, v.tasks.map((t) => t.replace("https://trusttasks.org/spec/", ""))]), [
      ["CB-AA-001", "coverage", "proposed", ["acl/list/0.1"]], ["EM-001", "emit", "registry", ["acl/grant/0.2"]],
    ]);
    assert.deepEqual([l.scenarios[0]?.ids, l.scenarios[0]?.ceremonyPaths], [["FC-X-001"], ["x/y"]]);
    assert.deepEqual(tasksReferencedBy("trusttasks.org/spec/a/b/0.1#response"), []);
  });
  it("merges run records per platform: an executed result beats a skip, and statuses are covered, skip, none or not-run", () => {
    const r = tmp();
    put(r, "vti-upstream-agent/run/results.json", JSON.stringify({ 0: { results: [{ id: "V1", status: "SKIP" }, { id: "V2", status: "SKIP" }] } }));
    put(r, "vti-upstream-community/run-advisory/results-advisory.json", JSON.stringify([{ results: [{ id: "V1", status: "PASS" }] }]));
    put(r, "reference/run/results.json", JSON.stringify({ 0: { results: [{ id: "V9", status: "PASS" }] } }));
    const map = parseRunMap(JSON.stringify({ format: "tt-platform-run-map/0.1", about: "", runs: [{ folder: "vti-upstream-agent", platform: "vti", surface: "agent", checkout: "x", date: "2026-11-19" }, { folder: "vti-upstream-community", platform: "vti", surface: "community", checkout: "x", date: "2026-11-19" }], ceremonyRows: [], notPlatform: ["reference"] }));
    const st = statusesByPlatform(readRunResults(r), map);
    const vti = st.get("vti") as Map<string, string>;
    assert.equal(vti.get("V1"), "PASS");
    assert.equal(st.get("keyring-wallet")?.size, 0, "the reference adapter is not a platform");
    assert.equal(taskStatus(["V1"], vti), "covered");
    assert.equal(taskStatus(["V2"], vti), "skip");
    assert.equal(taskStatus([], vti), "none");
    assert.equal(taskStatus(["V7"], vti), "not-run");
  });
});

describe("matrix and README", () => {
  it("marks the latest version, carries maturity and source on every row, and contains no local paths", () => {
    const r = tmp();
    gitIn(r, "init", "-q", "-b", "main");
    put(r, "specs/acl/grant/0.1/spec.md", spec("acl/grant", "0.1", "draft"));
    put(r, "specs/acl/grant/0.2/spec.md", spec("acl/grant", "0.2"));
    put(r, "specs/chat/send/0.1/spec.md", spec("chat/send", "0.1", "retired"));
    gitIn(r, "add", "-A");
    gitIn(r, "commit", "-q", "-m", "b");
    gitIn(r, "update-ref", "refs/remotes/origin/main", "HEAD");
    const g = gather({ repo: r, ghRepo: "x/y", baseRev: "origin/main", prs: [] });
    const m = build({
      gathered: g, kw: null, vti: null, scenarios: [], runsDirs: [], runMap: null, suiteRoot: r, kwRoot: null, vtiRoot: null, inputs: { tf: "abc" }, generated: "2026-11-19",
      vectors: [{ id: "V-1", group: "V", set: "emit", channel: "registry", tasks: ["https://trusttasks.org/spec/acl/grant/0.1", "https://trusttasks.org/spec/nope/x/0.1"], text: "" }],
    });
    const grant = m.tasks.filter((t) => t.slug === "acl/grant");
    assert.deepEqual(grant.map((t) => [t.version, t.latest, t.status]), [["0.1", false, "draft"], ["0.2", true, "unspecified"]]);
    assert.deepEqual(grant[0]?.vectors, ["V-1"]);
    assert.deepEqual(m.vectors[0]?.maturities, ["draft"]);
    assert.equal(m.referencedButUnknown.length, 1);
    const md = renderReadme(m);
    assert.match(md, /Latest version of each task/);
    assert.match(md, /\| `acl\/grant` \| 0\.2 \| unspecified \| main \|/);
    assert.doesNotMatch(md, /\/srv\/|\/home\/|\/var\/tmp|\/tmp\//);
    assert.deepEqual(walk(r, [".nothing"]), []);
  });
});

const B = "https://trusttasks.org/spec/";

describe("VTI main layout: on!(routes, ...) registrations", () => {
  it("reads a full spec-crate path and a file-local alias, ignores a comment, and reports what it cannot resolve", () => {
    const src = [
      "use vti_specs::badge::create::v0_2 as badge_create;",
      "use vti_specs::auth::passkey::admin_list::v0_1 as admin_list;",
      "pub(super) fn register(routes: Routes) -> Routes {",
      "    let routes = on!(routes, vti_specs::acl::grant::v0_2::Payload => handle_grant);",
      "    let routes =",
      "        on!(routes, badge_create::Payload => |state, ctx, doc| handle_create(state, ctx, doc));",
      "    // let routes = on!(routes, vti_specs::commented::out::v0_1::Payload => nope);",
      "    let routes = on!(routes, mystery::Payload => |s, c, d| h(s, c, d));",
      "    on!(routes, admin_list::Payload => handle_admin_list)",
      "}",
      "mod tests { use super::{admin_list}; }",
    ].join("\n");
    const r = onRegistrations(src);
    assert.deepEqual(r.uris.sort(), [`${B}acl/grant/0.2`, `${B}auth/passkey/admin-list/0.1`, `${B}badge/create/0.2`]);
    assert.deepEqual(r.unresolved, ["mystery"]);
  });
  it("serves the community from the registrations when no DISPATCHED_URIS table exists, and still reads the older table", () => {
    const main = tmp();
    put(main, "vtc-service/src/trust_tasks/mod.rs", "pub mod routing;\n// no DISPATCHED_URIS here (VTI main, #2579)\n");
    put(main, "vtc-service/src/trust_tasks/acl_tasks.rs", "use vti_specs::acl::list::v0_3 as acl_list;\npub(super) fn register(routes: Routes) -> Routes {\n    let routes = on!(routes, acl_list::Payload => handle_list);\n    on!(routes, vti_specs::acl::grant::v0_2::Payload => handle_grant)\n}\n");
    put(main, "vtc-service/src/trust_tasks/routing.rs", "macro_rules! on { ($routes:expr, $payload:ty => $handler:path) => { x }; }\n");
    put(main, "vti-witness/src/dispatch.rs", 'pub const WITNESS_SESSION_V0_2: &str = "' + B + 'witness/session/0.2";\npub const SERVED: &[&str] = &[\n    WITNESS_SESSION_V0_2,\n];\n');
    const u = scanVti(main);
    const served = Object.fromEntries([...u.served].map(([k, v]) => [k.replace(B, ""), [...v].sort()]));
    assert.deepEqual(served, { "acl/list/0.3": ["vtc"], "acl/grant/0.2": ["vtc"], "witness/session/0.2": ["witness"] });
    // the older layout (a DISPATCHED_URIS table) is unchanged
    const older = tmp();
    put(older, "vtc-service/src/trust_tasks/mod.rs", 'pub(crate) const DISPATCHED_URIS: &[&str] = &[\n  "' + B + 'vtc/members/list/0.1",\n];\n');
    assert.deepEqual([...scanVti(older).served.keys()], [`${B}vtc/members/list/0.1`]);
  });
});

const tv = (slug: string, version: string, o: Partial<TaskVersion> = {}): TaskVersion => ({
  typeUri: `${B}${slug}/${version}`, slug, version, family: slug.split("/")[0] as string, title: "t", status: "draft", sources: [], latest: false, focus: "older", supersededBy: null, successors: [],
  vti: { pinned: false, served: [] }, kw: { referenced: false, serves: false, files: [] }, vectors: [], platforms: {}, ...o,
});

describe("latest-version focus (D245)", () => {
  it("labels the latest non-retired version focus, lower versions older, a retired latest retired, and follows supersededBy to the successor's latest", () => {
    const ts = [
      tv("a/x", "0.1"), tv("a/x", "0.2", { latest: true }),
      tv("b/old", "0.1", { latest: true, status: "retired", supersededBy: "b/new" }),
      tv("b/new", "0.1"), tv("b/new", "0.3", { latest: true }),
      tv("c/old", "1.0", { latest: true, status: "retired", supersededBy: "c/mid/2.0" }),
      tv("c/mid", "2.0", { latest: true, status: "retired", supersededBy: "c/end" }),
      tv("c/end", "0.1", { latest: true }),
      tv("trust-task-ok", "0.1", { latest: true, status: "retired" }),
      tv("d/loop", "0.1", { latest: true, status: "retired", supersededBy: "d/loop2" }),
      tv("d/loop2", "0.1", { latest: true, status: "retired", supersededBy: "d/loop" }),
      tv("e/gone", "0.1", { latest: true, status: "retired", supersededBy: "nowhere/at/all" }),
    ];
    classifyFocus(ts);
    const f = (slug: string, v: string) => ts.find((t) => t.slug === slug && t.version === v) as TaskVersion;
    assert.deepEqual([f("a/x", "0.1").focus, f("a/x", "0.2").focus, f("b/old", "0.1").focus, f("b/new", "0.1").focus, f("b/new", "0.3").focus], ["older", "focus", "retired", "older", "focus"]);
    assert.deepEqual(f("b/old", "0.1").successors, [`${B}b/new/0.3`], "the successor's latest, not the version a slug-only supersededBy cannot name");
    assert.deepEqual(f("c/old", "1.0").successors, [`${B}c/end/0.1`], "a version in supersededBy names the slug; a retired successor is followed");
    assert.deepEqual(f("trust-task-ok", "0.1").successors, [], "no supersededBy: reported, not guessed");
    assert.deepEqual(f("d/loop", "0.1").successors, [], "a cycle ends with no successor");
    assert.deepEqual(f("e/gone", "0.1").successors, [], "a successor slug that is not in the repository is not invented");
    assert.equal(slugOfSuperseded("vta/dids/update/1.0"), "vta/dids/update");
    assert.equal(slugOfSuperseded("vta/dids/update"), "vta/dids/update");
  });
  it("calls a vector focus when it names any focus version, older when it names only older ones, and counts VTI and keyring-wallet states by slug", () => {
    const a = tv("a/x", "0.1", { focus: "older" });
    const b = tv("a/x", "0.2", { focus: "focus", latest: true });
    const r = tv("r/x", "0.1", { focus: "retired", latest: true });
    assert.equal(vectorFocus([a, b]), "focus");
    assert.equal(vectorFocus([a]), "older");
    assert.equal(vectorFocus([r]), "retired");
    assert.equal(vectorFocus([]), "none");
    assert.equal(vtiSlugState([a, b]), "not-named");
    a.vti.served = ["vta"];
    assert.equal(vtiSlugState([a, b]), "behind");
    b.vti.pinned = true;
    assert.equal(vtiSlugState([a, b]), "behind", "an older version served beats the latest merely pinned");
    a.vti.served = [];
    assert.equal(vtiSlugState([a, b]), "pinned-latest");
    b.vti.served = ["vtc"];
    assert.equal(vtiSlugState([a, b]), "latest");
    a.kw.referenced = true;
    assert.equal(kwSlugState([a, b]), "behind");
    b.kw.referenced = true;
    assert.equal(kwSlugState([a, b]), "latest");
  });
  it("puts focus, older and retired into the matrix and the README, with headline counts for the focus versions only", () => {
    const r = tmp();
    gitIn(r, "init", "-q", "-b", "main");
    put(r, "specs/acl/grant/0.1/spec.md", spec("acl/grant", "0.1", "draft"));
    put(r, "specs/acl/grant/0.2/spec.md", spec("acl/grant", "0.2", "draft"));
    put(r, "specs/old/task/0.1/spec.md", "---\nslug: old/task\nversion: \"0.1\"\ntitle: T\nstatus: retired\nsupersededBy: acl/grant/0.1\n---\nbody\n");
    gitIn(r, "add", "-A");
    gitIn(r, "commit", "-q", "-m", "b");
    gitIn(r, "update-ref", "refs/remotes/origin/main", "HEAD");
    const g = gather({ repo: r, ghRepo: "x/y", baseRev: "origin/main", prs: [] });
    const m = build({
      gathered: g, kw: null, vti: null, scenarios: [], runsDirs: [], runMap: null, suiteRoot: r, kwRoot: null, vtiRoot: null, inputs: { tf: "abc" }, generated: "2026-11-20",
      vectors: [
        { id: "V-1", group: "V", set: "emit", channel: "registry", tasks: [`${B}acl/grant/0.1`], text: "" },
        { id: "V-2", group: "V", set: "emit", channel: "registry", tasks: [`${B}acl/grant/0.2`], text: "" },
        { id: "V-3", group: "V", set: "emit", channel: "registry", tasks: [`${B}old/task/0.1`], text: "" },
      ],
    });
    assert.deepEqual(m.tasks.map((t) => [t.slug, t.version, t.focus]), [["acl/grant", "0.1", "older"], ["acl/grant", "0.2", "focus"], ["old/task", "0.1", "retired"]]);
    assert.deepEqual(m.vectors.map((v) => v.focus), ["older", "focus", "retired"]);
    assert.equal(m.focus.focusVersions, 1);
    assert.equal(m.focus.olderVersions, 1);
    assert.deepEqual(m.focus.retiredLatest[0], { slug: "old/task", version: "0.1", supersededBy: "acl/grant/0.1", successors: [`${B}acl/grant/0.2`], state: "successor" });
    const md = renderReadme(m);
    assert.match(md, /Headline numbers: latest versions only/);
    assert.match(md, /\| Target slugs \(latest version not retired\) \| 1 \|/);
    assert.match(md, /older \(non-focus\)/);
    assert.match(md, /\| `old\/task` 0\.1 \| acl\/grant\/0\.1 \| `acl\/grant\/0\.2` \|/);
  });
});
