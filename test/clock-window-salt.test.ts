// SPDX-License-Identifier: Apache-2.0
// P10 I1: clock-free peers (rebase mode), declared acceptance windows, the run salt and the vacuous-pass rule.
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import type { Adapter, Capabilities, SendParams, SendResult } from "../src/adapter/contract.ts";
import { serveHttp } from "../src/adapter/server.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { deterministicId, parseAt } from "../src/runner/build.ts";
import { clockGate, rebaseVector } from "../src/runner/clock.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { exitCode, gateReason, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { PROFILE_WINDOW, effectiveWindow, parseWindowArg, windowDifferences } from "../src/runner/window.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { Vector } from "../src/vectors/types.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const stdioCommand = (args: string): string => `${NODE.map(q).join(" ")} ${q(`${ROOT}/src/adapters/example-server/server.ts`)} stdio ${args}`;
const run = (adapter: Adapter, tier: 1 | 2 = 1, extra: Partial<Parameters<typeof runSuite>[0]> = {}): Promise<SuiteRun> =>
  runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, sleep: async () => undefined, ...extra });
const status = (r: SuiteRun, id: string): string => r.results.find((x) => x.id === id)!.status;
const reason = (r: SuiteRun, id: string): string => r.results.find((x) => x.id === id)!.reason ?? "";

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});
async function httpUrl(adapter: Adapter): Promise<string> {
  const s = await serveHttp(adapter, 0);
  servers.push(s);
  const addr = s.address();
  return `http:http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/rpc`;
}

const vec = (over: Partial<Vector>): Vector => ({ id: "X-001", title: "t", tier: 1, spec: [], clarify: null, steps: [{ send: { template: "carrier.request" }, expect: { disposition: "response" } }], ...over });

describe("clock gate and rebase", () => {
  it("names the vectors that need exact or multi-offset clock control, with a reason", () => {
    assert.equal(clockGate(vec({})), null);
    assert.match(clockGate(vec({ exactClock: true }))!, /within seconds of a window edge/);
    assert.match(clockGate(vec({ steps: [{ atAbsolute: "2026-01-01T00:00:00Z", send: { template: "carrier.request" } }] }))!, /absolute instant/);
    // several literal forward offsets of at most 10 s are waited out in real time, so they are measurable
    assert.equal(clockGate(vec({ steps: [{ send: { template: "carrier.request" } }, { at: "+5s", send: { same: "previous" } }] })), null);
    assert.match(clockGate(vec({ steps: [{ send: { template: "carrier.request" } }, { at: "+30s", send: { same: "previous" } }] }))!, /several clock offsets/);
    assert.match(clockGate(vec({ steps: [{ send: { template: "carrier.request" } }, { at: "+windowMaxAge+0s", send: { same: "previous" } }] }))!, /several clock offsets/);
    // one offset throughout is fine, however it is spelled
    assert.equal(clockGate(vec({ steps: [{ at: "+10s", send: { template: "carrier.request" } }, { send: { same: "previous" } }] })), null);
    assert.match(clockGate(vec({ steps: [{ send: { raw: '{"issuedAt":"2026-01-01T00:00:00Z"}' } }] }))!, /absolute timestamps/);
  });
  it("rebase keeps every relation to the clock start and leaves a calendar-invalid instant malformed", () => {
    const v = vec({ clockStart: "2026-08-01T12:00:00Z", steps: [{ send: { template: "carrier.request", params: { issuedAt: "2026-08-01T11:55:00Z", expiresAt: "2026-02-30T00:00:00Z" } } }] });
    const start = Date.parse("2030-01-01T00:00:10Z");
    const r = rebaseVector(v, start, "2026-11-12T10:00:00Z");
    assert.equal(r.clockStart, "2030-01-01T00:00:10.000Z");
    assert.deepEqual(r.steps[0]!.send!.params, { issuedAt: new Date(start - 300_000).toISOString().replace(".000Z", "Z"), expiresAt: "2026-02-30T00:00:00Z" });
  });
  it("symbolic offsets read the window", () => {
    assert.equal(parseAt("+windowMaxAge+windowSkew+0s"), 360_000);
    assert.equal(parseAt("+windowMaxAge+windowSkew+0s", { maxAgeSeconds: 600, clockSkewSeconds: 60, expiryHorizonSeconds: 1 }), 660_000);
    assert.equal(parseAt("-5m+250ms"), -299_750);
    assert.throws(() => parseAt("+5x"), /bad offset/);
  });
});

describe("a reference adapter whose clock cannot be set (rebase mode)", () => {
  it("declares clockFree, not clock, and refuses setClock and advance", async () => {
    const a = new ReferenceAdapter({ clockFree: true });
    const caps = await a.capabilities();
    assert.ok(caps.optional.includes("clockFree") && !caps.optional.includes("clock"));
    await assert.rejects(a.setClock("2026-01-01T00:00:00Z"), /cannot be set/);
    await assert.rejects(a.advance(1000), /cannot be set/);
  });
  it("runSuite requires exactly one of clock and clockFree", async () => {
    class Both extends ReferenceAdapter {
      override async capabilities(): Promise<Capabilities> {
        const c = await super.capabilities();
        return { ...c, optional: [...c.optional, "clockFree"] };
      }
    }
    await assert.rejects(run(new Both()), /exactly one of clock/);
  });
  it("measures what it can, SKIPs (never PASSes) what needs clock control, and fails nothing", async () => {
    const mk = (): ReferenceAdapter => new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" });
    const r1 = await run(mk(), 1);
    const r2 = await run(mk(), 2); // Tier 2 also runs the named profile sub-groups, for an adapter that does not claim attested
    assert.equal(r1.clockMode, "rebase");
    assert.deepEqual([...r1.results, ...r2.results].filter((x) => x.status === "FAIL"), []);
    for (const [r, id] of [[r2, "TIME-003"], [r2, "TIME-011"], [r2, "TIME-017"], [r1, "DUP-005"], [r1, "CER-002"]] as const) {
      assert.equal(status(r, id), "SKIP", id);
      assert.match(reason(r, id), /^clock not settable \(rebase mode\): needs (exact )?clock control/, id);
    }
    // literal small offsets are waited out (here by a no-op sleeper), so the duplicate rows at +5s are measured
    for (const id of ["DUP-001", "DUP-002", "DUP-003", "DUP-004"]) assert.equal(status(r1, id), "PASS", id);
    // coarse freshness rows, the declared-window vectors and the single-offset framework vectors are measured
    for (const [r, id] of [[r2, "TIME-001"], [r2, "TIME-009"], [r2, "TIME-010"], [r2, "TIME-018"], [r1, "TIME-023"], [r1, "TIME-101"], [r1, "TIME-102"], [r1, "TIME-104"], [r1, "TIME-105"], [r1, "ENV-014"], [r1, "ID-001"], [r1, "DIS-012"], [r1, "DIS-013"]] as const) assert.equal(status(r, id), "PASS", id);
    const full = await run(new ReferenceAdapter(), 2);
    const skippedForClock = r2.results.filter((x) => /^clock not settable/.test(x.reason ?? ""));
    assert.ok(skippedForClock.length >= 20, String(skippedForClock.length));
    // every vector that passed in rebase mode also passes with the clock set; the clock only ever removes measurements
    for (const x of r2.results.filter((y) => y.status === "PASS")) assert.equal(status(full, x.id), "PASS", x.id);
    assert.equal(r2.results.length, full.results.length);
  });
  it("stays non-vacuous: mutants are still caught by the vectors rebase mode runs", async () => {
    const caught = async (mutant: string, ids: string[]): Promise<void> => {
      const r = await run(new ReferenceAdapter({ clockFree: true, mutants: [mutant] }), 2);
      for (const id of ids) assert.equal(status(r, id), "FAIL", `${mutant} ${id}`);
    };
    await caught("noTimeChecks", ["TIME-101", "TIME-102", "TIME-105", "TIME-010"]);
    await caught("wideWindow10min", ["TIME-101", "TIME-105"]);
    await caught("futureIssuedAtAsExpired", ["TIME-102"]);
    await caught("noRecipientCheck", ["ID-001"]);
  });
  it("gives identical results in process, over stdio and over HTTP", async () => {
    const inProcess = [await run(new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" }), 1), await run(new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" }), 2)];
    const stdio = rpcAdapterFromSpec(`stdio:${stdioCommand("--clock-free")}`);
    const http = rpcAdapterFromSpec(await httpUrl(new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" })));
    try {
      for (const [i, tier] of ([1, 2] as const).entries()) {
        assert.deepEqual((await run(stdio, tier)).results, inProcess[i]!.results);
        assert.deepEqual((await run(http, tier)).results, inProcess[i]!.results);
      }
    } finally {
      await stdio.close();
    }
  });
  it("--rebase forces the mode on an adapter that can set its clock, with the same measured vectors", async () => {
    const forced = await run(new ReferenceAdapter(), 2, { rebase: true });
    assert.equal(forced.clockMode, "rebase");
    assert.deepEqual(forced.results.filter((x) => x.status === "FAIL"), []);
    assert.equal(status(forced, "TIME-003"), "SKIP");
  });
});

describe("declared acceptance windows", () => {
  it("parse and compare", () => {
    assert.deepEqual(parseWindowArg("maxAge=600,horizon=86400"), { maxAgeSeconds: 600, expiryHorizonSeconds: 86400 });
    assert.throws(() => parseWindowArg("maxAge=ten"), /bad --window member/);
    assert.deepEqual(windowDifferences(PROFILE_WINDOW), []);
    assert.deepEqual(windowDifferences({ ...PROFILE_WINDOW, maxAgeSeconds: 600 }), ["maxAgeSeconds 600 (profile 300)"]);
    assert.deepEqual(effectiveWindow({ window: { maxAgeSeconds: 1, clockSkewSeconds: 2, expiryHorizonSeconds: 3 } } as Capabilities, { clockSkewSeconds: 9 }), { maxAgeSeconds: 1, clockSkewSeconds: 9, expiryHorizonSeconds: 3 });
  });
  it("an implementation with a 10 minute window is measured against it: no FAIL, a reported difference, fixture rows SKIP", async () => {
    const r = await run(new ReferenceAdapter({ window: { maxAgeSeconds: 600 }, name: "reference-window10" }), 2);
    assert.deepEqual(r.results.filter((x) => x.status === "FAIL"), []);
    assert.deepEqual(r.windowDifference, ["maxAgeSeconds 600 (profile 300)"]);
    for (const id of ["TIME-101", "TIME-102", "TIME-104", "TIME-105", "DIS-012", "DIS-013", "DUP-005"]) assert.equal(status(r, id), "PASS", id);
    for (const id of ["TIME-001", "TIME-003", "TIME-015", "DUP-110"]) {
      assert.equal(status(r, id), "SKIP", id);
      assert.match(reason(r, id), /^window difference: the row pins the profile window/);
    }
    assert.equal(status(r, "TIME-024"), "PASS"); // a fixture row whose outcome does not depend on the window carries no profileWindow flag and still runs
    assert.equal(status(await run(new ReferenceAdapter({ window: { maxAgeSeconds: 600 }, name: "reference-window10" }), 1), "DUP-101"), "PASS"); // likewise a Tier 1 duplicate row
    const m = buildMatrix([r]);
    assert.deepEqual(m.rows[0]!.windowDifference, ["maxAgeSeconds 600 (profile 300)"]);
    assert.ok(m.rows[0]!.windowSkipped.includes("TIME-001"));
    assert.match(matrixMarkdown(m), /Window difference, reference-window10: measured against its declared window \(maxAgeSeconds 600 \(profile 300\)\)\. This is a measured difference/);
  });
  it("a runner-given window is a claim: an implementation enforcing another one then fails the window vectors", async () => {
    const r = await run(new ReferenceAdapter(), 1, { window: { maxAgeSeconds: 600 } });
    assert.equal(status(r, "TIME-104"), "FAIL");
    assert.deepEqual(r.windowDifference, ["maxAgeSeconds 600 (profile 300)"]);
  });
  it("the window variant gives identical results in process, over stdio and over HTTP", async () => {
    const mk = (): ReferenceAdapter => new ReferenceAdapter({ window: { maxAgeSeconds: 600, clockSkewSeconds: 30 }, name: "reference-window10" });
    const inProcess = await run(mk(), 2);
    const stdio = rpcAdapterFromSpec(`stdio:${stdioCommand("--window 600,30,2592000")}`);
    const http = rpcAdapterFromSpec(await httpUrl(mk()));
    try {
      const a = await run(stdio, 2);
      assert.equal(a.impl, "reference");
      assert.deepEqual(a.results, (await run(new ReferenceAdapter({ window: { maxAgeSeconds: 600, clockSkewSeconds: 30, expiryHorizonSeconds: 2592000 } }), 2)).results);
      assert.deepEqual((await run(http, 2)).results, inProcess.results);
    } finally {
      await stdio.close();
    }
  });
  it("the profile-window rows still catch their mutants at the profile window", async () => {
    const r = await run(new ReferenceAdapter({ mutants: ["windowOffByOne"] }), 2);
    assert.ok(r.results.some((x) => /^TIME-0/.test(x.id) && x.status === "FAIL"));
  });
  it("DIS-015 is CLARIFY: the specification does not oblige a responder to answer an unsigned query", () => {
    const v = suite.files.flatMap((f) => f.file.vectors).find((x) => x.id === "DIS-015")!;
    assert.match(v.clarify!, /does not say a responder must answer/);
    assert.deepEqual(v.mutants, ["discoveryProofRequired"]);
  });
  it("gateReason reports a window difference only for rows that pin the window", () => {
    const caps = { optional: ["clock"], tierMax: 1, carriers: [{ class: "consequential" }], bindings: [], cryptosuites: [], supportedTypes: [] } as unknown as Capabilities;
    const wide = { ...PROFILE_WINDOW, maxAgeSeconds: 600 };
    assert.equal(gateReason(vec({}), caps, 1, { window: wide }), null);
    assert.match(gateReason(vec({ profileWindow: true }), caps, 1, { window: wide })!, /window difference/);
    assert.equal(gateReason(vec({ profileWindow: true }), caps, 1, { window: PROFILE_WINDOW }), null);
  });
});

/** Records every document id of every send, passing the call through. */
class Recorder implements Adapter {
  readonly ids = new Set<string>();
  private readonly inner: ReferenceAdapter;
  constructor(inner: ReferenceAdapter) {
    this.inner = inner;
  }
  capabilities = () => this.inner.capabilities();
  provision = (r: string[]) => this.inner.provision(r);
  trust = (_v: string, _d?: unknown) => this.inner.trust();
  setClock = (i: string) => this.inner.setClock(i);
  advance = (m: number) => this.inner.advance(m);
  async send(p: SendParams): Promise<SendResult> {
    for (const m of p.bytes.matchAll(/"id":"(urn:uuid:[^"]+)"/g)) this.ids.add(m[1]!);
    return this.inner.send(p);
  }
  trigger = (a: string, args: Record<string, unknown>) => this.inner.trigger(a, args);
  observe = (qy: Parameters<Adapter["observe"]>[0]) => this.inner.observe(qy);
  restart = () => this.inner.restart();
  reset = () => this.inner.reset();
  snapshot = () => this.inner.snapshot();
  diff = (s: string) => this.inner.diff(s);
  verifyProof = (p: { bytes: string }) => this.inner.verifyProof(p);
  verifyReceipt = (p: Parameters<ReferenceAdapter["verifyReceipt"]>[0]) => this.inner.verifyReceipt(p);
}

describe("run salt", () => {
  it("deterministic ids are unchanged without a salt and differ with one", () => {
    assert.equal(deterministicId("ENV-001", "req"), deterministicId("ENV-001", "req", ""));
    assert.notEqual(deterministicId("ENV-001", "req"), deterministicId("ENV-001", "req", "a"));
    assert.notEqual(deterministicId("ENV-001", "req", "a"), deterministicId("ENV-001", "req", "b"));
    assert.match(deterministicId("ENV-001", "req", "a"), /^urn:uuid:[0-9a-f-]{36}$/);
  });
  it("two runs with the default salt share no document id, so a durable peer sees no replay; a given salt reproduces a run", async () => {
    const ids = async (extra: Partial<Parameters<typeof runSuite>[0]>): Promise<{ ids: Set<string>; run: SuiteRun }> => {
      const rec = new Recorder(new ReferenceAdapter());
      const r = await run(rec, 1, extra);
      return { ids: rec.ids, run: r };
    };
    const a = await ids({});
    const b = await ids({});
    assert.notEqual(a.run.salt, b.run.salt);
    assert.ok(a.ids.size > 100);
    assert.deepEqual([...a.ids].filter((x) => b.ids.has(x)), []);
    const c = await ids({ salt: "fixed" });
    const d = await ids({ salt: "fixed" });
    assert.deepEqual([...c.ids].sort(), [...d.ids].sort());
    assert.deepEqual(c.run.results, d.run.results);
    // the fixture documents carry their ids as literals; those are salted too (equal ids stay equal, so duplicates still are)
    const none = await ids({ salt: "" });
    assert.ok(none.run.results.every((x) => x.status !== "FAIL"));
    assert.ok(a.run.results.every((x) => x.status !== "FAIL"));
  });
  it("salted and unsalted runs give identical results", async () => {
    const salted = await run(new ReferenceAdapter(), 1, { salt: "s1" });
    const unsalted = await run(new ReferenceAdapter(), 1, { salt: "" });
    assert.deepEqual(salted.results, unsalted.results);
    assert.equal(exitCode([salted]), 0);
  });
});

describe("vacuous-pass rule", () => {
  const row = (id: string, st: string, anchor: boolean) => ({ id, group: "G", family: "f", tier: 1 as const, status: st as "PASS", ...(anchor ? { anchor: true as const } : {}) });
  const cellOf = (results: ReturnType<typeof row>[]) => buildMatrix([{ impl: "i", tier: 1, results }]).rows[0]!.families.f!;
  it("a PASS roll-up is green only when an anchor positive passed and none that ran failed", () => {
    assert.equal(cellOf([row("G-001", "PASS", true), row("G-002", "PASS", false)]).green, true);
    const neg = cellOf([row("G-001", "PASS", false), row("G-002", "PASS", false)]);
    assert.equal(neg.green, false);
    assert.match(neg.annotation!, /no anchor positive vector passed/);
    const skipped = cellOf([row("G-001", "SKIP", true), row("G-002", "PASS", false)]);
    assert.equal(skipped.green, false);
    assert.deepEqual(skipped.anchors, { pass: 0, ran: 0, total: 1 });
    assert.equal(cellOf([row("G-001", "PASS", true), row("G-002", "KNOWN-FAIL", true)]).status, "KNOWN-FAIL");
    assert.equal(cellOf([row("G-001", "PASS", true), row("G-002", "CLARIFY", false), row("G-003", "PASS", false)]).green, true);
  });
  it("the matrix marks the annotated cell and explains it", () => {
    const m = buildMatrix([{ impl: "refuses-all", tier: 1, results: [row("G-001", "PASS", false), row("G-002", "SKIP", true)] }]);
    const md = matrixMarkdown(m);
    assert.match(md, /PASS \(1\/0\/1\/0\/0\) \*/);
    assert.match(md, /\* refuses-all \/ f: no anchor positive vector passed/);
  });
  it("an implementation that refuses everything is not green: its negatives pass, its anchors fail", async () => {
    class RefuseAll extends ReferenceAdapter {
      override async send(p: SendParams): Promise<SendResult> {
        return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
      }
    }
    const r = await run(new RefuseAll());
    const row0 = buildMatrix([r]).rows[0]!;
    assert.ok(r.results.filter((x) => x.status === "PASS").length > 0);
    assert.equal(row0.families.framework!.green, false);
  });
  it("the reference is green everywhere its anchors run, at both tiers", async () => {
    const m = buildMatrix([await run(new ReferenceAdapter()), await run(new ReferenceAdapter({ attested: true, name: "reference-attested" }), 2)]);
    for (const [f, c] of Object.entries(m.rows[0]!.families)) assert.equal(c.green, true, f);
  });
});

describe("rebase mode waits out a literal small offset in real time", () => {
  it("calls the sleeper with the offset still to elapse, and never for a vector with a single offset or a symbolic one", async () => {
    const waits: number[] = [];
    const r = await run(new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" }), 1, { sleep: async (ms) => void waits.push(ms) });
    assert.equal(status(r, "DUP-001"), "PASS");
    assert.ok(waits.length > 0 && waits.every((w) => w > 0 && w <= 11_000), JSON.stringify(waits));
    assert.equal(status(r, "DUP-005"), "SKIP");
  });
});
