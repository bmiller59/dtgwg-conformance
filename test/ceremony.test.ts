// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { holdErrors } from "../src/runner/engine.ts";
import { runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const SERVER = `${ROOT}/src/adapters/example-server/server.ts`;
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const all = suite.files.flatMap((f) => f.file.vectors);
const CER_IDS = all.filter((v) => /^(CER-|2PC-00[345]$|TIME-103$)/.test(v.id)).map((v) => v.id);
const STATUS_ONLY = ["CER-015", "CER-016"];
// The family spans the registry rules, the per-declared-E vectors (candidate) and the suite-design rules (proposed, docs/04 section 11.4).
const ALL_CHANNELS = ["registry", "proposed", "candidate"] as const;
const observedPass = async (adapter: Adapter, id: string): Promise<boolean> => {
  // Tier 2 runs every Tier 1 vector, and the named profile sub-groups (docs/04 section 3.1), whether or not the adapter claims attested
  const run = await runSuite({ adapter, suite, tier: 2, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS });
  const r = run.results.find((x) => x.id === id)!;
  return r.status === "PASS" || (r.status === "CLARIFY" && (r.reason ?? "").endsWith("(observed: pass)"));
};
const statuses = async (adapter: Adapter, tier: 1 | 2 = 2): Promise<Map<string, string>> =>
  new Map((await runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS })).results.map((r) => [r.id, r.status]));

const extraChildren: ReturnType<typeof spawn>[] = [];
/** Start a second HTTP server process serving the cosigning, status-offering variant, and return its URL. */
async function variantUrl(node: string[], server: string): Promise<string> {
  const child = spawn(node[0]!, [...node.slice(1), server, "http", "--port", "0", "--cosign", "--status=resubmit"], { stdio: ["ignore", "pipe", "inherit"] });
  extraChildren.push(child);
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString("utf8");
      const m = /listening (http:\/\/\S+)/.exec(buf);
      if (m !== null) resolve(m[1]!);
    });
    child.on("exit", () => reject(new Error("server exited")));
  });
}

describe("ceremony-document vectors", () => {
  it("the group has the expected vectors and the open and profile ones are CLARIFY", () => {
    assert.equal(CER_IDS.length, 23);
    for (const id of ["CER-004", "CER-007", "CER-010", "CER-011", "CER-012", "CER-013", "CER-016"]) assert.notEqual(all.find((v) => v.id === id)!.clarify, null, id);
    for (const id of ["CER-001", "CER-003", "CER-005", "CER-006", "CER-008", "CER-009", "CER-014", "CER-015", "2PC-003", "2PC-004", "2PC-005", "TIME-103"]) assert.equal(all.find((v) => v.id === id)!.clarify, null, id);
  });
  it("every one passes the reference at both tiers; CLARIFY ones are observed, not gating", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 2], [new ReferenceAdapter({ attested: true }), 2]] as const) {
      const res = await statuses(adapter, tier);
      for (const id of CER_IDS) assert.ok(["PASS", "CLARIFY", "SKIP"].includes(res.get(id)!), `${id} ${res.get(id)}`);
      for (const id of CER_IDS.filter((x) => all.find((v) => v.id === x)!.clarify === null && !STATUS_ONLY.includes(x) && x !== "CER-002")) assert.equal(res.get(id), "PASS", id);
      for (const id of STATUS_ONLY) assert.equal(res.get(id), "SKIP", id);
      assert.equal(res.get("CER-002"), "PASS");
    }
  });
  it("the reference supports both values of ceremony.proposerApproves, with and without a status task, whatever the status hold's continuation: no failure, and the declared property is measured", async () => {
    for (const proposerApproves of [true, false]) {
      for (const status of [false, true]) {
        for (const statusContinuation of status ? (["proceed", "resubmit", "omit"] as const) : (["proceed"] as const)) {
          const adapter = new ReferenceAdapter({ proposerApproves, ceremonyStatus: status, statusContinuation });
          const caps = await adapter.capabilities();
          assert.equal(caps.ceremony!.proposerApproves, proposerApproves);
          assert.equal(caps.optional.includes("ceremony.status"), status);
          const res = await statuses(adapter);
          const tag = `${proposerApproves}/${status}/${statusContinuation}`;
          for (const id of CER_IDS) {
            const clarify = all.find((v) => v.id === id)!.clarify !== null;
            const skipped = id === "CER-002" ? status : STATUS_ONLY.includes(id) ? !status : false;
            assert.equal(res.get(id), skipped ? "SKIP" : clarify ? "CLARIFY" : "PASS", `${tag} ${id}`);
            // the CLARIFY vectors are not gating; the reference nevertheless passes them in every configuration
            if (clarify && !skipped) assert.equal(await observedPass(adapter, id), true, `${tag} ${id}`);
          }
        }
      }
    }
  });
  it("the proposer's own approval is sent only where the begin does not count as one", async () => {
    const sent = async (proposerApproves: boolean): Promise<number> => {
      const adapter = new ReferenceAdapter({ proposerApproves });
      const run = await runSuite({ adapter, suite, tier: 2, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS });
      return run.results.filter((r) => r.id === "CER-003" && r.status === "PASS").length;
    };
    assert.equal(await sent(true), 1);
    assert.equal(await sent(false), 1);
    const steps = all.find((v) => v.id === "CER-003")!.steps;
    assert.deepEqual(steps.map((st) => st.when?.proposerApproves), [undefined, false, undefined]);
    const nonQuorum = ["CER-001", "CER-007", "CER-008", "CER-013"];
    for (const id of nonQuorum) assert.ok(all.find((v) => v.id === id)!.steps.every((st) => st.when === undefined), id);
  });
  it("a declaration without ceremony.proposerApproves, or a half-declared status task, is refused by the runner", async () => {
    const base = new ReferenceAdapter();
    const mk = (edit: (c: Awaited<ReturnType<Adapter["capabilities"]>>) => void): Adapter => {
      const a = Object.create(base) as ReferenceAdapter;
      a.capabilities = async () => {
        const c = structuredClone(await base.capabilities());
        edit(c);
        return c;
      };
      return a;
    };
    await assert.rejects(runSuite({ adapter: mk((c) => delete (c.ceremony as { proposerApproves?: boolean }).proposerApproves), suite, tier: 1, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS }), /proposerApproves must be declared/);
    await assert.rejects(runSuite({ adapter: mk((c) => c.optional.push("ceremony.status")), suite, tier: 1, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS }), /declared together/);
    await assert.rejects(runSuite({ adapter: mk((c) => { c.optional.push("ceremony.status"); c.ceremony!.statusType = "https://x.example/status/0.1"; }), suite, tier: 1, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS }), /statusPayload/);
  });
  it("an implementation that hosts no ceremony family gets SKIP", async () => {
    const none = await statuses(new ReferenceAdapter({ ceremony: false }));
    for (const id of CER_IDS) assert.equal(none.get(id), "SKIP", id);
  });
  it("CER-002 and the status vectors are reciprocal: a status task skips the resubmission rule and exercises the status hold, and without one the opposite", async () => {
    const without = await statuses(new ReferenceAdapter());
    assert.equal(without.get("CER-002"), "PASS");
    for (const id of STATUS_ONLY) assert.equal(without.get(id), "SKIP", id);
    const withStatus = await statuses(new ReferenceAdapter({ ceremonyStatus: true }));
    assert.equal(withStatus.get("CER-002"), "SKIP");
    assert.equal(withStatus.get("CER-001"), "PASS");
    assert.equal(withStatus.get("CER-015"), "PASS");
    assert.equal(withStatus.get("CER-016"), "CLARIFY");
    assert.equal(await observedPass(new ReferenceAdapter({ ceremonyStatus: true }), "CER-016"), true);
  });
  it("the status mutants and the proposerApproves mutant fail the vectors that name them, in the configurations they run in", async () => {
    // a hold that does not name the declared status task breaks a SHOULD: an advisory at Tier 1 (docs/04 section 3.2), a failure on the attested profile
    for (const proposerApproves of [true, false]) {
      const mk = (attested: boolean): ReferenceAdapter => new ReferenceAdapter({ ceremonyStatus: true, proposerApproves, attested, mutants: ["cerHoldStatusNotNamed"] });
      const t1 = (await runSuite({ adapter: mk(false), suite, tier: 1, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS })).results.find((x) => x.id === "CER-015")!;
      assert.equal(t1.status, "PASS");
      assert.match((t1.advisories ?? []).join(" "), /should name it/);
      const t2 = (await runSuite({ adapter: mk(true), suite, tier: 2, today, fixtureRoot: FIXTURES, channels: ALL_CHANNELS })).results.find((x) => x.id === "CER-015")!;
      assert.equal(t2.status, "FAIL");
    }
    for (const [mutant, id] of [["cerStatusSilent", "CER-016"], ["cerStatusApproves", "CER-016"], ["cerStatusSecondEffect", "CER-016"]] as const) {
      for (const proposerApproves of [true, false]) assert.equal(await observedPass(new ReferenceAdapter({ ceremonyStatus: true, proposerApproves, mutants: [mutant] }), id), false, `${mutant} ${proposerApproves}`);
    }
    for (const proposerApproves of [true, false]) assert.equal((await statuses(new ReferenceAdapter({ proposerApproves, mutants: ["cerProposerApprovalFlip"] }))).get("CER-014"), "FAIL", String(proposerApproves));
  });
  it("an implementation without the deadline, effect or retention hooks gets SKIP only for the vectors that need them", async () => {
    const base = new ReferenceAdapter();
    const bare = Object.create(base) as ReferenceAdapter;
    bare.capabilities = async () => {
      const c = await base.capabilities();
      return { ...c, optional: c.optional.filter((o) => !["trigger.ceremonyDeadline", "trigger.ceremonyEffect", "observe.retained"].includes(o)) };
    };
    const res = await statuses(bare);
    for (const id of ["CER-008", "CER-010", "CER-011", "CER-013", "2PC-004", "2PC-005", "TIME-103"]) assert.equal(res.get(id), "SKIP", id);
    for (const id of ["CER-001", "CER-003", "CER-005", "CER-006", "CER-009", "2PC-003"]) assert.equal(res.get(id), "PASS", id);
  });
  it("the trigger names and arguments are validated", async () => {
    const a = new ReferenceAdapter();
    const caps = await a.capabilities();
    for (const o of ["ceremony", "trigger.ceremonyDeadline", "trigger.ceremonyEffect", "observe.retained"]) assert.ok(caps.optional.includes(o), o);
    await a.trigger("ceremonyDeadline", { seconds: 60 });
    await assert.rejects(a.trigger("ceremonyDeadline", { seconds: 0 }), /positive whole number/);
    for (const outcome of ["commit", "fail", "unknown"]) await a.trigger("ceremonyEffect", { outcome });
    await assert.rejects(a.trigger("ceremonyEffect", { outcome: "abort" }), /commit, fail or unknown/);
    await assert.rejects(a.trigger("settle", { outcome: "commit" }), /no transaction is in flight/);
    assert.equal(caps.ceremony?.statusType, undefined);
  });
  it("the hold rule asserts resubmit only where expects names the request's own type", () => {
    const request = { id: "urn:uuid:1", type: "https://x.example/spec/c/begin/0.1", threadId: "urn:uuid:1" };
    const step = (expects: string, continuation?: string): Record<string, unknown> => ({
      payload: { expects: [{ typeUri: expects }], ...(continuation === undefined ? {} : { continuation }), inResponseTo: { typeUri: request.type, id: request.id } },
    });
    assert.deepEqual(holdErrors(step(request.type, "resubmit"), request), []);
    assert.deepEqual(holdErrors(step(request.type), request), []);
    assert.match(holdErrors(step(request.type, "proceed"), request)[0]!, /must be resubmit/);
    // a status task is named: the specification states no value, so neither is asserted
    assert.deepEqual(holdErrors(step("https://x.example/spec/c/status/0.1", "proceed"), request), []);
    assert.deepEqual(holdErrors(step("https://x.example/spec/c/status/0.1", "resubmit"), request), []);
    assert.match(holdErrors({ payload: { expects: [{ typeUri: request.type }] } }, request)[0]!, /inResponseTo/);
    // a declared status task must be named; the continuation is still not asserted, and a fragment on the type is tolerated
    const status = "https://x.example/spec/c/status/0.1";
    assert.deepEqual(holdErrors(step(status, "proceed"), request, status), []);
    assert.deepEqual(holdErrors(step(`${status}#request`), request, status), []);
    assert.match(holdErrors(step(request.type, "resubmit"), request, status)[0]!, /should name it/);
  });
  it("served over stdio and over HTTP by separate processes, the ceremony vectors give the in-process results (and a mutant fails the same ones)", async () => {
    const inProcess = await statuses(new ReferenceAdapter());
    const variantInProcess = await statuses(new ReferenceAdapter({ proposerApproves: false, ceremonyStatus: true, statusContinuation: "resubmit" }));
    assert.equal(variantInProcess.get("CER-015"), "PASS");
    const variantStdio = rpcAdapterFromSpec(`stdio:${NODE.map(q).join(" ")} ${q(SERVER)} stdio --cosign --status=resubmit`);
    const mutantInProcess = await statuses(new ReferenceAdapter({ mutants: ["cerHoldContinuationProceed"] }));
    assert.equal(mutantInProcess.get("CER-001"), "FAIL");
    const stdio = rpcAdapterFromSpec(`stdio:${NODE.map(q).join(" ")} ${q(SERVER)} stdio`);
    const stdioMutant = rpcAdapterFromSpec(`stdio:${NODE.map(q).join(" ")} ${q(SERVER)} stdio --mutant cerHoldContinuationProceed`);
    const child = spawn(NODE[0]!, [...NODE.slice(1), SERVER, "http", "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let buf = "";
        child.stdout.on("data", (d: Buffer) => {
          buf += d.toString("utf8");
          const m = /listening (http:\/\/\S+)/.exec(buf);
          if (m !== null) resolve(m[1]!);
        });
        child.on("exit", () => reject(new Error("server exited")));
      });
      const http = rpcAdapterFromSpec(`http:${url}`);
      const variantHttp = rpcAdapterFromSpec(`http:${await variantUrl(NODE, SERVER)}`);
      for (const [remote, want] of [[stdio, inProcess], [http, inProcess], [stdioMutant, mutantInProcess], [variantStdio, variantInProcess], [variantHttp, variantInProcess]] as const) {
        const got = await statuses(remote);
        for (const id of CER_IDS) assert.equal(got.get(id), want.get(id), id);
      }
      await stdio.close();
      await stdioMutant.close();
      await variantStdio.close();
    } finally {
      child.kill();
      for (const c of extraChildren) c.kill();
    }
  });
});
