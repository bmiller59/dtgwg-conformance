// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { Server } from "node:http";
import { PassThrough } from "node:stream";
import { after, describe, it } from "node:test";
import { AdapterRpcError, HttpTransport, RpcAdapter, StdioTransport, TransportError, rpcAdapterFromSpec } from "../src/adapter/client.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { handleText, serveHttp, serveStdio } from "../src/adapter/server.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { exitCode, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-13";
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const SERVER = `${ROOT}/src/adapters/example-server/server.ts`;
const CLI = `${ROOT}/src/runner/cli.ts`;
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const stdioCommand = (args = ""): string => `${NODE.map(q).join(" ")} ${q(SERVER)} stdio ${args}`.trim();

const run = (adapter: Adapter, tier: 1 | 2): Promise<SuiteRun> => runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES });

const servers: Server[] = [];
async function httpServer(adapter: Adapter): Promise<string> {
  const s = await serveHttp(adapter, 0);
  servers.push(s);
  const addr = s.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/rpc`;
}
after(() => {
  for (const s of servers) s.close();
});

describe("wire contract, server side", () => {
  it("answers every malformed input with one JSON-RPC error", async () => {
    const a = new ReferenceAdapter();
    assert.deepEqual(await handleText(a, "{not json"), { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    assert.deepEqual(await handleText(a, "[1]"), { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
    const unknown = await handleText(a, JSON.stringify({ jsonrpc: "2.0", id: 5, method: "nope" }));
    assert.ok("error" in unknown && unknown.error.code === -32601 && unknown.id === 5);
    const bad = await handleText(a, JSON.stringify({ jsonrpc: "2.0", id: 6, method: "trigger", params: { action: "explode", args: {} } }));
    assert.ok("error" in bad && bad.error.code === -32000 && /unknown trigger/.test(bad.error.message));
  });
  it("stdio: one response line per request line, in order, blank lines ignored", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = serveStdio(new ReferenceAdapter(), input, output);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "capabilities" })}\n\n${JSON.stringify({ jsonrpc: "2.0", id: "b", method: "reset" })}\n`);
    input.end();
    await done;
    output.end();
    const lines = (output.read() as Buffer).toString("utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as { id: number | string; result: unknown });
    assert.deepEqual(lines.map((l) => l.id), [1, "b"]);
    assert.equal((lines[0]!.result as { name: string }).name, "reference");
    assert.equal(lines[1]!.result, null);
  });
  it("http: POST only, one JSON-RPC response per call", async () => {
    const url = await httpServer(new ReferenceAdapter());
    assert.equal((await fetch(url)).status, 405);
    const r = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "capabilities" }) });
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { result: { name: string } }).result.name, "reference");
    const bad = await fetch(url, { method: "POST", body: "nope" });
    assert.equal(((await bad.json()) as { error: { code: number } }).error.code, -32700);
  });
});

describe("wire contract, client side", () => {
  it("rpcAdapterFromSpec accepts stdio and http specs and refuses others", async () => {
    assert.ok(rpcAdapterFromSpec("http:http://127.0.0.1:1/x").transport instanceof HttpTransport);
    assert.ok(rpcAdapterFromSpec("http://127.0.0.1:1/x").transport instanceof HttpTransport);
    assert.ok(rpcAdapterFromSpec("http:127.0.0.1:1/x").transport instanceof HttpTransport);
    const s = rpcAdapterFromSpec("stdio:cat");
    assert.ok(s.transport instanceof StdioTransport);
    await s.close();
    assert.throws(() => rpcAdapterFromSpec("stdio:"), /needs a command/);
    assert.throws(() => rpcAdapterFromSpec("http:"), /needs a URL/);
    assert.throws(() => rpcAdapterFromSpec("ftp:x"), /not an out-of-process/);
  });
  it("adapter errors arrive with the adapter's own message; transport failures are TransportError", async () => {
    const a = rpcAdapterFromSpec(`stdio:${stdioCommand()}`);
    try {
      await assert.rejects(a.trigger("explode", {}), (e: unknown) => e instanceof AdapterRpcError && e.code === -32000 && e.message === "unknown trigger explode");
      await a.restart();
    } finally {
      await a.close();
    }
    const dead = rpcAdapterFromSpec("stdio:exit 3");
    await assert.rejects(dead.capabilities(), (e: unknown) => e instanceof TransportError && /exited/.test(e.message));
    await dead.close();
    const refused = rpcAdapterFromSpec("http:http://127.0.0.1:9/", { timeoutMs: 2000 });
    await assert.rejects(refused.capabilities(), TransportError);
  });
  it("a silent adapter times out instead of hanging", async () => {
    const silent = new RpcAdapter(new StdioTransport("cat >/dev/null", { timeoutMs: 200 }));
    await assert.rejects(silent.capabilities(), /timed out/);
    await silent.close();
  });
  it("a reply with the wrong id or a non-JSON line is a transport failure", async () => {
    const wrong = new RpcAdapter(new StdioTransport(`${q(process.execPath)} -e 'process.stdin.on("data",()=>console.log(JSON.stringify({jsonrpc:"2.0",id:99,result:1})))'`, { timeoutMs: 300 }));
    await assert.rejects(wrong.capabilities(), /timed out/);
    await wrong.close();
    const junk = new RpcAdapter(new StdioTransport(`${q(process.execPath)} -e 'process.stdin.on("data",()=>console.log("hello"))'`, { timeoutMs: 2000 }));
    await assert.rejects(junk.capabilities(), /not JSON/);
    await junk.close();
  });
});

describe("the whole suite through the out-of-process example server gives the in-process results", () => {
  const same = (a: SuiteRun, b: SuiteRun): void => {
    assert.equal(b.impl, a.impl);
    assert.equal(b.tier, a.tier);
    assert.deepEqual(b.results, a.results);
  };
  it("stdio, tier 1", async () => {
    const remote = rpcAdapterFromSpec(`stdio:${stdioCommand()}`);
    try {
      const got = await run(remote, 1);
      same(await run(new ReferenceAdapter(), 1), got);
      assert.ok(got.results.filter((r) => r.status === "PASS").length >= 100);
      assert.deepEqual(got.results.filter((r) => r.status === "FAIL"), []);
    } finally {
      await remote.close();
    }
  });
  it("stdio, tier 2 on the attested server", async () => {
    const remote = rpcAdapterFromSpec(`stdio:${stdioCommand("--attested")}`);
    try {
      same(await run(new ReferenceAdapter({ attested: true, name: "reference-attested" }), 2), await run(remote, 2));
    } finally {
      await remote.close();
    }
  });
  it("http, tier 1 and tier 2", async () => {
    const t1 = rpcAdapterFromSpec(await httpServer(new ReferenceAdapter()));
    same(await run(new ReferenceAdapter(), 1), await run(t1, 1));
    const t2 = rpcAdapterFromSpec(`http:${await httpServer(new ReferenceAdapter({ attested: true, name: "reference-attested" }))}`);
    same(await run(new ReferenceAdapter({ attested: true, name: "reference-attested" }), 2), await run(t2, 2));
  });
  it("a mutant served over the wire fails the same vectors as in process", async () => {
    const remote = rpcAdapterFromSpec(`stdio:${stdioCommand("--mutant noRecipientCheck")}`);
    try {
      const got = await run(remote, 1);
      same(await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1), got);
      assert.equal(got.results.find((r) => r.id === "ID-001")?.status, "FAIL");
      assert.equal(exitCode([got]), 1);
    } finally {
      await remote.close();
    }
  });
});

describe("command line: --adapter stdio: and http:", () => {
  it("stdio: runs both tiers of the attested server and exits 0", () => {
    const r = spawnSync(NODE[0]!, [...NODE.slice(1), CLI, "--adapter", `stdio:${stdioCommand("--attested")}`], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /reference-attested tier 1: /);
    assert.match(r.stdout, /reference-attested tier 2: /);
  });
  it("stdio: a mutant served over the wire gates the run (exit 1)", () => {
    const r = spawnSync(NODE[0]!, [...NODE.slice(1), CLI, "--tier", "1", "--adapter", `stdio:${stdioCommand("--mutant noRecipientCheck")}`], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL ID-001/);
  });
  it("http: drives a server process started separately", async () => {
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
      const r = await new Promise<{ status: number | null; out: string }>((resolve) => {
        const c = spawn(NODE[0]!, [...NODE.slice(1), CLI, "--adapter", `http:${url}`], { cwd: ROOT });
        let out = "";
        c.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
        c.on("exit", (status) => resolve({ status, out }));
      });
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, /reference tier 1: /);
    } finally {
      child.kill();
    }
  });
});
