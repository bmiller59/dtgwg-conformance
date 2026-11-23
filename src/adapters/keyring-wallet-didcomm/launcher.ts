// SPDX-License-Identifier: Apache-2.0
// keyring-wallet-didcomm launcher: the command behind `--adapter stdio:...`. It starts keyring-wallet's jest with the real-agent host
// (kw-didcomm-host.jest.ts), waits until the wallet's DIDComm endpoint and control server are up, then serves the suite's stdio JSON-RPC
// contract with KeyringWalletDidCommAdapter (suite-side carrier over DIDComm, control plane over loopback).
//
//   npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/keyring-wallet-didcomm/launcher.ts' --run <YYYY-MM-DD-label>
//
// Environment: KW_ROOT (default ../keyring-wallet, read only), KW_JEST_CACHE, KW_HOST_TIMEOUT_MS (start-up bound, default 300000),
// KW_HOST_MAX_MS (the host ends itself after this long, default 90 min), DIDCOMM_ROOT (a directory whose node_modules hold Credo for the
// suite-side carrier; default <KW_ROOT>/bifold/packages/witness-server), KW_DIDCOMM_PORT (wallet endpoint, default a free port),
// CARRIER_PORT (first suite-side port, default random 39000-47990), a stop file in the launch directory (touching it ends the host),
// KW_DIDCOMM_TRACE (JSON-lines wire trace), KW_DIDCOMM_VERSION (v1 default | v2: host agent built with both, v2 OOB invitation, carrier v2).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../adapter/server.ts";
import { KeyringWalletDidCommAdapter } from "./adapter.ts";

// Credo logs to stdout; stdout carries the JSON-RPC conversation.
console.log = console.error;
console.info = console.error;

const here = dirname(fileURLToPath(import.meta.url));

export interface LaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** The command that runs the host under keyring-wallet's jest (pure, so it can be tested without starting anything). */
export function launchPlan(kwRoot: string, o: { portFile: string; invitationFile: string; stopFile: string; jestCache: string; walletPort: number }, hereDir = here): LaunchPlan {
  return {
    command: "nice",
    args: ["-n", "10", join(kwRoot, "bifold/node_modules/.bin/jest"), "--config", join(hereDir, "jest.config.cjs"), "--runInBand", "--watchman=false", "--forceExit", "--silent"],
    env: {
      KW_ROOT: kwRoot,
      KW_HOST_PORT_FILE: o.portFile,
      KW_INVITATION_FILE: o.invitationFile,
      KW_STOP_FILE: o.stopFile,
      KW_JEST_CACHE: o.jestCache,
      KW_DIDCOMM_PORT: String(o.walletPort),
      KW_DIDCOMM_VERSIONS: process.env.KW_DIDCOMM_VERSION === "v2" ? "v1,v2" : "v1",
      KW_STORE_DIR: dirname(o.portFile),
      TMPDIR: process.env.TMPDIR ?? join(tmpdir(), "kw-didcomm-adapter"),
    },
    cwd: join(kwRoot, "bifold/packages/core"),
  };
}

/** A free loopback port: the runner starts one adapter to read capabilities and a fresh one per tier, so ports and the stop file must be per launch. */
async function freePort(): Promise<number> {
  return await new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => res(port));
    });
  });
}

async function waitFor(path: string, timeoutMs: number, alive: () => boolean, ok: (t: string) => boolean): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!alive()) throw new Error("the jest host exited before it was ready (see its output above)");
    if (existsSync(path)) {
      const t = readFileSync(path, "utf8").trim();
      if (ok(t)) return t;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the jest host was not ready within ${timeoutMs} ms (${path})`);
}

async function main(): Promise<void> {
  process.umask(0o002);
  const kwRoot = resolve(process.env.KW_ROOT ?? "../keyring-wallet");
  const jestCache = process.env.KW_JEST_CACHE ?? join(tmpdir(), "kw-didcomm-adapter", "jest-cache");
  mkdirSync(jestCache, { recursive: true });
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kw-didcomm-"));
  const portFile = join(dir, "port");
  const invitationFile = join(dir, "invitation.json");
  const stopFile = join(dir, "stop");
  const walletPort = process.env.KW_DIDCOMM_PORT === undefined ? await freePort() : Number(process.env.KW_DIDCOMM_PORT);
  // The suite-side carriers need one inbound port per actor, consecutive from a base.
  const carrierBase = process.env.CARRIER_PORT === undefined ? 39000 + Math.floor(Math.random() * 900) * 10 : Number(process.env.CARRIER_PORT);
  const plan = launchPlan(kwRoot, { portFile, invitationFile, stopFile, jestCache, walletPort });
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, stdio: ["ignore", "inherit", "inherit"] });
  let exited = false;
  const gone = new Promise<void>((r) => child.on("exit", () => ((exited = true), r())));
  const stop = async (): Promise<void> => {
    writeFileSync(stopFile, "stop");
    if (!exited) {
      const port = existsSync(portFile) ? readFileSync(portFile, "utf8").trim() : "";
      if (port !== "") await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", body: "{}" }).catch(() => undefined);
      // Grace period for the host's own shutdown, then end it (this process owns the child; nothing else is touched).
      const hard = setTimeout(() => child.kill("SIGKILL"), 12000);
      hard.unref();
      // The next adapter of the run starts right after this one: leave nothing listening.
      await Promise.race([gone, new Promise((r) => setTimeout(r, 20000))]);
    }
  };
  process.once("SIGTERM", () => void stop().then(() => process.exit(143)));
  process.once("SIGINT", () => void stop().then(() => process.exit(130)));
  let adapter: KeyringWalletDidCommAdapter | undefined;
  try {
    const timeout = Number(process.env.KW_HOST_TIMEOUT_MS ?? 300000);
    const port = await waitFor(portFile, timeout, () => !exited, (t) => /^\d+$/.test(t));
    const invitationUrl = (JSON.parse(readFileSync(invitationFile, "utf8")) as { invitationUrl: string }).invitationUrl;
    adapter = new KeyringWalletDidCommAdapter({
      root: process.env.DIDCOMM_ROOT ?? join(kwRoot, "bifold/packages/witness-server"),
      invitationUrl,
      controlUrl: `http://127.0.0.1:${port}/`,
      inboundPort: carrierBase,
      version: process.env.KW_DIDCOMM_VERSION === "v2" ? "v2" : "v1",
      ...(process.env.KW_DIDCOMM_TRACE === undefined ? {} : { tracePath: process.env.KW_DIDCOMM_TRACE }),
      ...(process.env.KW_REPLY_WAIT_MS === undefined ? {} : { replyWaitMs: Number(process.env.KW_REPLY_WAIT_MS) }),
    });
    await serveStdio(adapter, process.stdin, process.stdout);
    await adapter.close();
  } finally {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      console.error((err as Error).message);
      process.exit(2);
    },
  );
}
