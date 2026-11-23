// SPDX-License-Identifier: Apache-2.0
// keyring-wallet adapter launcher: the command behind `--adapter stdio:...`. It starts keyring-wallet's jest with the host
// (kw-host.jest.ts), waits for the host's HTTP adapter server, and serves the suite's stdio JSON-RPC contract by forwarding to it.
//
//   npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/keyring-wallet/launcher.ts' --run 2026-11-14-kw-shim
//
// Environment: KW_ROOT (default ../keyring-wallet, a sibling checkout; read only, never written), KW_JEST_CACHE (default
// <os tmpdir>/kw-adapter/jest-cache), KW_HOST_TIMEOUT_MS (start-up bound, default 240000). Nothing in the wallet checkout is changed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpcAdapterFromSpec } from "../../adapter/client.ts";
import { serveStdio } from "../../adapter/server.ts";

const here = dirname(fileURLToPath(import.meta.url));

export interface LaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

/** The command that runs the host under keyring-wallet's jest (pure, so it can be tested without starting anything). */
export function launchPlan(kwRoot: string, portFile: string, jestCache: string, hereDir = here): LaunchPlan {
  const core = join(kwRoot, "bifold/packages/core");
  return {
    command: "nice",
    args: ["-n", "10", join(kwRoot, "bifold/node_modules/.bin/jest"), "--config", join(hereDir, "jest.config.cjs"), "--runInBand", "--watchman=false", "--forceExit", "--silent"],
    env: { KW_ROOT: kwRoot, KW_HOST_PORT_FILE: portFile, KW_JEST_CACHE: jestCache, TMPDIR: process.env.TMPDIR ?? join(tmpdir(), "kw-adapter"), ...Object.fromEntries(["KW_EMIT", "KW_EMIT_DEBUG", "KW_EMIT_EVIDENCE", "KW_CEREMONY", "KW_CEREMONY_PROGRESS_MS", "KW_CEREMONY_TRACE", "KW_IDENTITY_SEED"].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k] as string])) },
    cwd: core,
  };
}

async function waitForPort(portFile: string, timeoutMs: number, alive: () => boolean): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!alive()) throw new Error("the jest host exited before it was listening (see its output above)");
    if (existsSync(portFile)) {
      const t = readFileSync(portFile, "utf8").trim();
      if (/^\d+$/.test(t)) return Number(t);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the jest host did not start within ${timeoutMs} ms`);
}

async function main(): Promise<void> {
  process.umask(0o002);
  const kwRoot = resolve(process.env.KW_ROOT ?? "../keyring-wallet");
  const jestCache = process.env.KW_JEST_CACHE ?? join(tmpdir(), "kw-adapter", "jest-cache");
  mkdirSync(jestCache, { recursive: true });
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kw-host-"));
  const portFile = join(dir, "port");
  const plan = launchPlan(kwRoot, portFile, jestCache);
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, stdio: ["ignore", "inherit", "inherit"] });
  let exited = false;
  child.on("exit", () => (exited = true));
  const stop = async (): Promise<void> => {
    if (!exited) {
      try {
        const port = existsSync(portFile) ? readFileSync(portFile, "utf8").trim() : "";
        if (port !== "") await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", body: "{}" }).catch(() => undefined);
      } finally {
        setTimeout(() => child.kill("SIGTERM"), 3000).unref();
      }
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const port = await waitForPort(portFile, Number(process.env.KW_HOST_TIMEOUT_MS ?? 240000), () => !exited);
    const upstream = rpcAdapterFromSpec(`http:http://127.0.0.1:${port}/`, { timeoutMs: 120000 });
    await serveStdio(upstream, process.stdin, process.stdout);
  } finally {
    await stop();
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
