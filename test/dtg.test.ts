// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { ReferenceAdapter, CONSENT_DECISION_TYPE, CONSENT_DECISION_01_TYPE, CONSENT_GRANTED_TYPE, CONSENT_REQUEST_TYPE, CEX_ISSUE_TYPE, CEX_OFFER_TYPE, CEX_PRESENT_TYPE, CEX_QUERY_TYPE, CEX_REQUEST_TYPE } from "../src/adapters/reference/reference.ts";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import { serveHttp } from "../src/adapter/server.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { buildMatrix } from "../src/runner/matrix.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";
import { gapTasks } from "../src/plain/gap.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const DTG = (id: string): boolean => /^(TC|CEX)-/.test(id);
const dtgVectors = suite.files.filter((f) => f.file.group === "TC" || f.file.group === "CEX").flatMap((f) => f.file.vectors);
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const SERVER = `${ROOT}/src/adapters/example-server/server.ts`;
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const stdio = (args = ""): string => `stdio:${NODE.map(q).join(" ")} ${q(SERVER)} stdio ${args}`.trim();
const run = (adapter: Adapter, tier: 1 | 2 = 1, salt = "dtg"): Promise<SuiteRun> => runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, salt });
const dtgResults = (r: SuiteRun) => r.results.filter((x) => DTG(x.id)).map((x) => ({ id: x.id, status: x.status, reason: x.reason, failures: x.failures }));

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

describe("3b-DTG groups TC and CEX", () => {
  it("the groups have the planned vectors; the ones that depend on an unsettled point are CLARIFY", () => {
    assert.equal(dtgVectors.filter((v) => v.id.startsWith("TC-")).length, 24);
    // CEX-040..046 (credential-exchange/present 0.2, re-pin to 98dda36f8) are 7 new vectors: 39 + 7; CEX-041 (a SHOULD) is CLARIFY
    assert.equal(dtgVectors.filter((v) => v.id.startsWith("CEX-")).length, 46);
    const clarify = dtgVectors.filter((v) => v.clarify !== null).map((v) => v.id).sort();
    assert.deepEqual(clarify, ["CEX-008", "CEX-009", "CEX-011", "CEX-012", "CEX-013", "CEX-014", "CEX-023", "CEX-024", "CEX-025", "CEX-026", "CEX-029", "CEX-033", "CEX-034", "CEX-035", "CEX-037", "CEX-039", "CEX-041", "TC-011", "TC-012", "TC-015", "TC-018"]);
    // the vectors that assert a task specification's MUST are Tier 1 and gating; the ones the specification does not state are Tier 2
    assert.deepEqual(dtgVectors.filter((v) => v.tier === 2).map((v) => v.id), ["CEX-010", "CEX-017", "CEX-018"]);
    for (const v of dtgVectors) assert.ok(v.spec.some((s) => /^specs\/(task-consent|credential-exchange)\//.test(s)), `${v.id} cites no task specification`);
  });

  it("the reference passes every applicable vector at both tiers, with every CLARIFY and Tier 2 vector observed to pass", async () => {
    const t1 = await run(new ReferenceAdapter());
    const t2 = await run(new ReferenceAdapter({ attested: true }), 2);
    for (const r of [t1, t2]) {
      assert.deepEqual(dtgResults(r).filter((x) => x.status === "FAIL"), []);
      // CEX-024 asks for two things the text cannot both give (consentRequired and indistinguishable refusals): the default reference observes fail, see the test below
      for (const x of r.results.filter((y) => DTG(y.id) && y.status === "CLARIFY" && y.id !== "CEX-024")) assert.match(x.reason ?? "", /observed: pass/, x.id);
    }
    // + 6 PASS for the gating present 0.2 vectors CEX-040, 042..046 (CEX-041 is CLARIFY, observed pass)
    assert.equal(dtgResults(t1).filter((x) => x.status === "PASS").length, 46);
    assert.equal(dtgResults(t2).filter((x) => x.status === "PASS").length, 49);
    assert.deepEqual(dtgResults(t1).filter((x) => x.status === "SKIP").map((x) => x.id), []);
    // the Tier 2 rows are left out of the Tier 1 run by tier, recorded apart and never SKIP
    assert.deepEqual((t1.excludedByTier ?? []).filter((e) => DTG(e.id)).map((e) => e.id), ["CEX-010", "CEX-017", "CEX-018"]);
  });

  it("the decision vectors hold under both values of ceremony.proposerApproves", async () => {
    const r = await run(new ReferenceAdapter({ proposerApproves: false }));
    assert.deepEqual(dtgResults(r).filter((x) => x.status === "FAIL"), []);
    assert.equal(dtgResults(r).filter((x) => x.status === "PASS").length, 46);
  });

  it("CEX-024 (refusals indistinguishable) is observed fail under the code table's reading and pass under the uniform-refusal reading; CEX-022 holds only under the first", async () => {
    const byCode = await run(new ReferenceAdapter());
    assert.match(byCode.results.find((x) => x.id === "CEX-024")?.reason ?? "", /observed: fail/);
    assert.equal(byCode.results.find((x) => x.id === "CEX-022")?.status, "PASS");
    const uniform = await run(new ReferenceAdapter({ queryUniformRefusal: true }));
    assert.match(uniform.results.find((x) => x.id === "CEX-024")?.reason ?? "", /observed: pass/);
    assert.equal(uniform.results.find((x) => x.id === "CEX-022")?.status, "FAIL");
    const leaky = await run(new ReferenceAdapter({ queryUniformRefusal: true, mutants: ["qryRefusalDiscriminates"] }));
    assert.match(leaky.results.find((x) => x.id === "CEX-024")?.reason ?? "", /observed: fail/);
  });

  it("TC-018 accepts a next-step hold for a decision short of the quorum, and still catches a double approval", async () => {
    const held = await run(new ReferenceAdapter({ decisionHold: true }));
    const tc018 = held.results.find((x) => x.id === "TC-018");
    assert.equal(tc018?.status, "CLARIFY");
    assert.match(tc018?.reason ?? "", /observed: pass/);
    assert.deepEqual(dtgResults(held).filter((x) => x.status === "FAIL"), []);
    const doubled = await run(new ReferenceAdapter({ decisionHold: true, mutants: ["consentDoubleApproveCounts"] }));
    assert.match(doubled.results.find((x) => x.id === "TC-018")?.reason ?? "", /observed: fail/);
  });

  it("the matrix shows the two families green", async () => {
    const r = await run(new ReferenceAdapter({ attested: true }), 2);
    const m = buildMatrix([r]);
    const row = m.rows[0]!;
    for (const fam of ["dtg-task-consent", "dtg-credential-exchange"]) {
      const cell = row.families[fam]!;
      assert.equal(cell.status, "PASS", fam);
      assert.equal(cell.green, true, fam);
      assert.ok(cell.anchors.total > 0 && cell.anchors.pass === cell.anchors.ran, fam);
    }
  });

  it("an implementation that does not declare the types gets SKIP, never PASS", async () => {
    const a = new ReferenceAdapter({ dtg: false });
    const caps = await a.capabilities();
    for (const t of [CONSENT_REQUEST_TYPE, CONSENT_DECISION_TYPE, CONSENT_DECISION_01_TYPE, CONSENT_GRANTED_TYPE, CEX_ISSUE_TYPE, CEX_PRESENT_TYPE, CEX_QUERY_TYPE, CEX_OFFER_TYPE, CEX_REQUEST_TYPE]) assert.ok(!caps.supportedTypes.includes(t));
    assert.ok(!caps.optional.some((o) => /consentEnrol|consentBinding|presentationNonce|holdCredential|verifierTrust|queryDecision|observe\.deferred/.test(o)));
    const r = await run(a);
    assert.ok(dtgResults(r).every((x) => x.status === "SKIP"));
    assert.match(dtgResults(r)[0]!.reason ?? "", /not declared|missing capability/);
  });

  it("the decision vectors are SKIP without the ceremony family or without the binding helper, and the request vectors without the enrolment helper", async () => {
    const noCeremony = await run(new ReferenceAdapter({ ceremony: false }));
    const skipped = dtgResults(noCeremony).filter((x) => x.status === "SKIP").map((x) => x.id);
    for (const id of ["TC-001", "TC-009", "TC-018"]) assert.ok(skipped.includes(id), id);
    assert.ok(!skipped.includes("TC-013"));
    const caps = await new ReferenceAdapter().capabilities();
    assert.deepEqual(caps.optional.filter((o) => /^trigger\.(consent[EB]|presentation|holdCred|verifierTrust|queryDec)/.test(o)).sort(), ["trigger.consentBinding", "trigger.consentEnrol", "trigger.holdCredential", "trigger.presentationNonce", "trigger.queryDecision", "trigger.verifierTrust"]);
  });

  it("the observe kinds and helper actions behave as docs/04 section 4.4 says", async () => {
    const a = new ReferenceAdapter();
    await a.provision(["iut"]);
    assert.equal((await a.observe({ query: "stored", kind: "credential" })).value, 0);
    assert.equal((await a.observe({ query: "stored", kind: "presentation" })).value, 0);
    assert.equal((await a.observe({ query: "stored", kind: "deferral" })).value, 0);
    await a.trigger("holdCredential", {});
    await assert.rejects(a.trigger("queryDecision", { thread: "urn:uuid:none", decision: "approve" }), /no deferred query/);
    await assert.rejects(a.trigger("verifierTrust", {}), /vid/);
    const n1 = JSON.parse((await a.trigger("presentationNonce", {})).documents[0]!) as { nonce: string; threadId: string };
    const n2 = JSON.parse((await a.trigger("presentationNonce", {})).documents[0]!) as { nonce: string; threadId: string };
    assert.notEqual(n1.nonce, n2.nonce);
    assert.notEqual(n1.threadId, n2.threadId);
    await assert.rejects(a.trigger("consentBinding", { thread: "urn:uuid:none" }), /no pending ceremony/);
    await assert.rejects(a.trigger("enrolExecutor", {}), /vid/);
  });

  it("an adapter that refuses everything is not green in the credential-exchange family", async () => {
    // refuses every document: the negative vectors pass, the anchors (accepted delivery and presentation) fail
    const real = new ReferenceAdapter({ mutants: ["proofOptional"] });
    const caps = await real.capabilities();
    assert.ok(caps.supportedTypes.includes(CEX_ISSUE_TYPE));
    const refuser: Adapter = Object.create(real) as Adapter;
    refuser.send = async () => ({ replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 });
    const r = await run(refuser);
    const cell = buildMatrix([r]).rows[0]!.families["dtg-credential-exchange"]!;
    assert.equal(cell.green, false);
  });

  it("results are identical in process, over stdio and over HTTP", async () => {
    const inProcess = dtgResults(await run(new ReferenceAdapter({ attested: true }), 2));
    const viaStdio = await rpcAdapterFromSpec(stdio("--attested"));
    let overStdio;
    try {
      overStdio = dtgResults(await run(viaStdio, 2));
    } finally {
      await (viaStdio as unknown as { close(): Promise<void> }).close();
    }
    const server = await serveHttp(new ReferenceAdapter({ attested: true }), 0);
    servers.push(server);
    const addr = server.address();
    const viaHttp = await rpcAdapterFromSpec(`http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/rpc`);
    const overHttp = dtgResults(await run(viaHttp, 2));
    assert.deepEqual(overStdio, inProcess);
    assert.deepEqual(overHttp, inProcess);
    // re-pin 98dda36f8: + 7, CEX-040..046 (credential-exchange/present 0.2)
    assert.equal(inProcess.length, 70);
  });

  it("the example server serves no 3b-DTG task with --no-dtg", async () => {
    const a = await rpcAdapterFromSpec(stdio("--no-dtg"));
    try {
      const caps = await a.capabilities();
      // the gap vectors give the reference plain versions of a few of these families (consent, credential-exchange) that no 3b-DTG vector names: only the DTG ones are checked
      const gap = new Set(gapTasks().map((g) => g.snap.typeUri));
      assert.ok(!caps.supportedTypes.some((t) => /task-consent|credential-exchange/.test(t) && !gap.has(t)));
    } finally {
      await (a as unknown as { close(): Promise<void> }).close();
    }
  });
});
