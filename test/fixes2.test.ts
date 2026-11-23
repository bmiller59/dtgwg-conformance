// SPDX-License-Identifier: Apache-2.0
// Second re-check fixes (R-01..R-07): success honours accepted codes, effect derived for every set, step-level credit, typed-dispatch scan, narrower accepted codes.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { analyse, loadVecRows, type Scope } from "../src/coverage/completeness.ts";
import { typedDispatch, ttRoutes } from "../src/coverage/matrix/vti.ts";
import { errorCodesOf, mandatedCodes } from "../src/coverage/task-facts.ts";
import { answeredErrors } from "../src/plain/check.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { exitCode, runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { loadTaskEffects, vectorEffect } from "../src/vectors/effects.ts";
import { FIXTURES, ROOT, VECTORS, tempDir } from "./helpers.ts";

const TT = "https://trusttasks.org/spec/";
const err = (code: string): string => JSON.stringify({ type: `${TT}trust-task-error/0.6`, payload: { code, message: "x" } });

describe("R-01: success honours accepted codes; a stream's follow-on documents are not a second answer", () => {
  const task = loadTask(`${TT}vta/metrics/show/0.1`)!;
  const note: string[] = [];
  const o = { should: (m: string) => note.push(m), note: (m: string) => note.push(m) };
  it("fails an asserted success answered with a code that is not accepted, and accepts one that is (envelope or task code)", () => {
    assert.match(answeredErrors(task, [err("idConflict")], { ...o, success: true })[0]!, /success asserted/);
    assert.deepEqual(answeredErrors(task, [err("idConflict")], { ...o, success: true, acceptCodes: ["idConflict"] }), []);
    assert.deepEqual(answeredErrors(task, [err("notFound")], { ...o, success: true, acceptCodes: ["vta/metrics/show:notFound"] }), []);
    assert.equal(answeredErrors(task, [err("proofInvalid")], { ...o, success: true, acceptCodes: ["idConflict"] }).length, 1);
  });
  it("treats documents of the declared follow-on types after the answer as notes, and any other second document as a failure", () => {
    const ev = JSON.stringify({ type: `${TT}vtc/admin/events/event/0.5`, payload: {} });
    const sub = loadTask(`${TT}vtc/admin/events/subscribe/0.6`)!;
    const ans = JSON.stringify({ type: `${TT}vtc/admin/events/subscribe/0.6#response`, payload: { subscriptionId: "s", topics: ["actions"] } });
    assert.match(answeredErrors(sub, [ans, ev], { ...o })[0] ?? "", /expected one answer/);
    assert.equal(answeredErrors(sub, [err("streamUnavailable"), ev, ev], { ...o, followOn: ["vtc/admin/events/event/0.5"] }).filter((e) => /expected one answer/.test(e)).length, 0);
    assert.match(answeredErrors(sub, [err("streamUnavailable"), ans], { ...o, followOn: [`${TT}vtc/admin/events/event/0.5`] })[0] ?? "", /expected one answer/);
  });
  it("the generated vectors: no asserted vector's task has a front-matter error code reachable for its request; VC-VTC-006 and VC-VTA-040 are weak", () => {
    const suite = loadSuite(join(VECTORS, "complete"));
    const all = suite.files.flatMap((f) => f.file.vectors);
    const by = new Map(all.map((v) => [v.id, v]));
    assert.equal(by.get("VC-VTC-006")!.strength, "weak");
    assert.equal(by.get("VC-VTA-040")!.strength, "weak");
    const facts = new Map((JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "task-facts.json"), "utf8")) as { tasks: { typeUri: string; errorCodes: { code: string }[] }[] }).tasks.map((t) => [t.typeUri, t.errorCodes.map((e) => e.code)]));
    const reachableKnown = /notFound|streamUnavailable|tooManyStreams|noKeyHolder|keyHolderUnavailable|keyHolderRefused|invalidRange/;
    for (const v of all.filter((x) => x.strength === "asserted")) {
      const type = (v.steps[0] as unknown as { send: { document: { type: string } } }).send.document.type;
      for (const c of facts.get(type) ?? []) if (c !== "vtc/groups/requests/list:notFound" /* needs groupId, which the request does not send */) assert.ok(!reachableKnown.test(c.slice(c.lastIndexOf(":") + 1)) || /memberUsageUnavailable/.test(c), `${v.id} asserts success though ${c} may be returned`);
    }
  });
});

describe("R-04: accepted codes come from explicit consumer rules and front-matter errorCodes", () => {
  it("does not accept a code from a missing-proof clause, a producer rule, a reader fallback or a table row", () => {
    const spec = ["---", "slug: a/b", "---", "", "1. Refuses a document with no verified `proof` with `proofRequired` (or `proofInvalid`).", "", "3. **MUST NOT** re-send it under the original's `id`; that is `idConflict`.", "", "A reader whose host answers `unsupportedType` for `0.8` pages back.", "", "| `idConflict` | The id matches. |", "", "A conforming **consumer** **MUST** refuse an id already in use with `idConflict`."].join("\n");
    assert.deepEqual(mandatedCodes(spec).map((c) => c.code), ["idConflict"]);
  });
  it("reads a live-state proof check, but not a proof check the vector controls", () => {
    const live = "---\nslug: a/b\n---\n\n3. **MUST** resolve that DID afresh and verify the proof against the live document. A proof that does not verify → the framework `proofInvalid`.\n";
    assert.deepEqual(mandatedCodes(live).map((c) => c.code), ["proofInvalid"]);
    assert.deepEqual(mandatedCodes("---\nslug: a/b\n---\n\n1. Verify the proof. **MUST** refuse with `proofInvalid` when it fails.\n"), []);
  });
  it("reads the front matter errorCodes with their meaning", () => {
    const s = "---\nslug: a/b\nerrorCodes:\n  - code: a/b:notFound\n    meaning: The agent never held it.\n    retryable: false\n  - code: a/b:late\n    meaning: >-\n      Too late,\n      by `since`.\nrelated:\n  - x\n---\nbody `idConflict`\n";
    const e = errorCodesOf(s);
    assert.deepEqual(e.map((x) => x.code), ["a/b:notFound", "a/b:late"]);
    assert.match(e[1]!.meaning, /`since`/);
  });
  it("the committed vectors accept fewer codes than before: only the explicit consumer rules", () => {
    const all = loadSuite(join(VECTORS, "complete")).files.flatMap((f) => f.file.vectors);
    const accepted = new Set<string>();
    for (const v of all) for (const s of v.steps) for (const c of s.expect?.acceptCodes ?? []) accepted.add(`${v.id}:${c}`);
    for (const a of accepted) assert.ok(!/proofInvalid/.test(a) || /VC-VTC-073/.test(a), `${a}: proofInvalid only for the live-state check`);
    assert.ok(![...accepted].some((a) => /VC-VTC-006|VC-VTA-030/.test(a)), "the subscribe and metrics vectors accept no envelope code");
  });
});

describe("R-02: polarity and strength are credited to the task a step sends", () => {
  const write = (dir: string, vectors: unknown[]): void => {
    mkdirSync(join(dir, "vectors", "s"), { recursive: true });
    writeFileSync(join(dir, "vectors", "s", "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["f.json"] }));
    writeFileSync(join(dir, "vectors", "s", "f.json"), JSON.stringify({ format: "tt-conformance-vectors/0.1", group: "G", family: "x", vectors }));
  };
  const step = (type: string, disposition: string, extra: object = {}): object => ({ send: { document: { id: "$id(a)", type: `${TT}${type}`, issuer: "$A", recipient: "$iut", issuedAt: "$now+0s", payload: {} } }, expect: { disposition, ...extra } });
  it("a seeding step credits the seeded task, not the probed one", () => {
    const { dir, cleanup } = tempDir();
    try {
      write(dir, [{ id: "G-1", title: "probe", steps: [step("rooms/create/0.2", "response"), step("rooms/epoch/mint/0.1", "error")] }]);
      const rows = loadVecRows(dir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.by![`${TT}rooms/create/0.2`]!.pos, true);
      assert.equal(rows[0]!.by![`${TT}rooms/epoch/mint/0.1`]!.pos, false);
      assert.equal(rows[0]!.by![`${TT}rooms/epoch/mint/0.1`]!.neg, true);
      const scope = { format: "tt-vector-completeness-scope/0.1", note: "", inputs: {}, tasks: ["rooms/create/0.2", "rooms/epoch/mint/0.1"].map((s) => ({ typeUri: `${TT}${s}`, slug: s.replace(/\/[^/]*$/, ""), version: s.replace(/^.*\//, ""), family: "rooms", vti: ["vtc"], kw: null })) } as Scope;
      const rep = analyse(scope, rows);
      assert.deepEqual(rep.noPositive, [`${TT}rooms/epoch/mint/0.1`]);
      assert.equal(rep.positive.n, 1);
      assert.equal(rep.anyVector.n, 2);
    } finally { cleanup(); }
  });
  it("the seven tasks the re-check named now have a vector of their own with a positive step", () => {
    const rows = loadVecRows(ROOT);
    for (const t of ["rooms/epoch/mint/0.1", "rooms/epoch/prune/0.2", "rooms/records/prune/0.2", "rooms/records/retention/set/0.1", "rooms/revocations/get/0.1", "rooms/revocations/put/0.1", "vtc/rooms/storage/assign/0.2"]) {
      assert.ok(rows.some((r) => r.by?.[`${TT}${t}`]?.pos === true), `${t} has no positive step of its own`);
    }
  });
});

describe("R-05, R-07: the safety gate covers every set; skipped-by-default is reported", () => {
  const table = loadTaskEffects();
  it("derives the effect from the tasks a vector sends to, and a tag wins", () => {
    const send = (t: string, d: string): { send: object; expect: object } => ({ send: { document: { type: `${TT}${t}` } }, expect: { disposition: d } }) as never;
    assert.equal(vectorEffect({ steps: [send("device/wipe/0.2", "error")] } as never, table) ?? "", table.get(`${TT}device/wipe/0.2`) === "destructive" ? "destructive" : "", "a destructive task is gated even for a negative");
    assert.equal(vectorEffect({ effect: "read-only", steps: [send("device/wipe/0.2", "response")] } as never, table), "read-only");
    assert.equal(vectorEffect({ steps: [{ send: { template: "x" }, expect: { disposition: "response" } }] } as never, table), undefined);
  });
  it("the older sets' destructive vectors (PP-DEV-046, PP-VLT-037, PP-POL-011) report SKIPPED-SAFETY by default and run with an opt-in", async () => {
    const wanted = new Set(["PP-DEV-046", "PP-VLT-037", "PP-POL-011"]);
    const { dir, cleanup } = tempDir();
    try {
      const byGroup = new Map<string, unknown[]>();
      const plain = loadSuite(join(VECTORS, "plain"));
      for (const f of plain.files) for (const v of f.file.vectors) if (wanted.has(v.id)) byGroup.set(f.file.group, [...(byGroup.get(f.file.group) ?? []), v]);
      assert.equal([...byGroup.values()].flat().length, 3);
      mkdirSync(join(dir, "s"));
      const names = [...byGroup.keys()].map((g) => `${g.toLowerCase()}.json`);
      writeFileSync(join(dir, "s", "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: names }));
      for (const [g, vs] of byGroup) writeFileSync(join(dir, "s", `${g.toLowerCase()}.json`), JSON.stringify({ format: "tt-conformance-vectors/0.1", group: g, family: "plain", clock: { start: "2026-11-12T10:00:00Z" }, vectors: vs }));
      const suite = loadSuite(join(dir, "s"));
      for (const f of suite.files) for (const v of f.file.vectors) assert.equal(v.effect, undefined, `${v.id} carries no tag`);
      const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"], deriveEffects: true });
      assert.deepEqual(run.results.map((r) => r.status), ["SKIPPED-SAFETY", "SKIPPED-SAFETY", "SKIPPED-SAFETY"]);
      const dflt = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"] });
      assert.ok(dflt.results.every((r) => r.status !== "SKIPPED-SAFETY"), "a library call that does not ask for derivation sees only the tags");
      assert.equal(exitCode([run]), 0);
      const opt = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, channels: ["registry", "proposed", "candidate"], allowEffects: "reference-oracle", deriveEffects: true });
      assert.ok(opt.results.every((r) => r.status !== "SKIPPED-SAFETY"));
    } finally { cleanup(); }
  });
  it("the default suite sends no request to a destructive task, whatever its tag", async () => {
    const inner = new ReferenceAdapter();
    const sent: string[] = [];
    const adapter = new Proxy(inner, { get: (t, k, r) => (k === "send" ? async (p: { bytes: string }) => { try { sent.push(String((JSON.parse(p.bytes) as { type?: string }).type)); } catch { /* not JSON */ } return (t as never as { send: (x: unknown) => Promise<unknown> }).send(p); } : Reflect.get(t, k, r)) });
    const suite = loadSuite(VECTORS);
    const run = await runSuite({ adapter: adapter as never, suite, tier: 1, today: "2026-11-22", fixtureRoot: FIXTURES, deriveEffects: true });
    assert.ok(sent.length > 0);
    for (const t of sent) assert.notEqual(table.get(t.replace(/#response$/, "")), "destructive", `a destructive task was sent: ${t}`);
    assert.equal(exitCode([run]), 0);
  });
  it("reports the covered-but-skipped-by-default share apart", () => {
    const rep = analyse(JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "scope.json"), "utf8")) as Scope, loadVecRows(ROOT));
    assert.ok(rep.positiveSkippedByDefault.n > 0 && rep.negativeSkippedByDefault.n >= 0);
    assert.ok(rep.positiveSkippedByDefault.n <= rep.positive.n);
  });
});

describe("R-03: the scanner reads typed dispatchers and HTTPS routes", () => {
  const tasks = [
    "use vti_specs::git_ns::repo::{create::v0_4 as create};", "use vti_specs::git_ns::view::v0_6 as view;",
    "use super::admin_reads::{repo_list};", "",
    "pub(crate) fn dispatcher() -> AsyncDispatcher<GitNsCtx, Out> { AsyncDispatcher::new()", "  .on_async(handle_create)", "  .on_async(handle_view)", "  .on_async(handle_repo_list)", "  .on_async(handle_gone) }",
    "signed_handler!(handle_create, create::Payload, ops::repo_create);", "pub(crate) async fn handle_view(doc: TrustTask<view::Payload>, ctx: GitNsCtx) -> Out { todo!() }",
    "signed_handler!(\n    handle_repo_list,\n    repo_list::Payload,\n    super::admin_reads::repo_list\n);",
  ].join("\n");
  const sib = "pub(crate) use vti_specs::git_ns::repo::list::v0_2 as repo_list;";
  it("resolves handlers named by their signature or by the macro that defines them, through the file's own use items and a sibling's re-export", () => {
    const r = typedDispatch(tasks, [sib]);
    assert.deepEqual(r.uris.sort(), [`${TT}git-ns/repo/create/0.4`, `${TT}git-ns/repo/list/0.2`, `${TT}git-ns/view/0.6`]);
    assert.deepEqual(r.unresolved, ["handle_gone"]);
  });
  it("reads a route mounted with tt(routes!(..), \"<uri>\")", () => {
    const src = `.routes(tt(\n  routes!(auth::passkey_login_start),\n  "${TT}auth/passkey/login/start/0.2",\n))\n// .routes(tt(routes!(x), "${TT}commented/out/0.1"))`;
    assert.deepEqual(ttRoutes(src), [`${TT}auth/passkey/login/start/0.2`]);
  });
  it("the scope holds the git-ns tasks and passkey login the scanner now finds, and records each exclusion", () => {
    const scope = JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;
    const uris = new Set(scope.tasks.map((t) => t.typeUri));
    for (const u of ["git-ns/view/0.6", "git-ns/repo/create/0.4", "git-ns/right/grant/0.4", "auth/passkey/login/start/0.2", "auth/passkey/login/finish/0.2"]) assert.ok(uris.has(`${TT}${u}`), u);
    const out = new Map((scope.outOfScope ?? []).map((o) => [o.slug, o.reason]));
    for (const s of ["consent/approve-request", "push/wake", "push/provision", "vtc/admin/events/event", "vtc/members/step-up-passkey-notice", "git-ns/bridge/job", "git-ns/right/break-glass-notice"]) assert.match(out.get(s) ?? "", /D742|KW role/, s);
  });
});
