// SPDX-License-Identifier: Apache-2.0
// witness-server adapter launcher: the command behind `--adapter stdio:...`. It starts the host (the witness server code under its own ts-node toolchain)
// (witness-host.ts), waits for the host's HTTP adapter server, and serves the suite's stdio JSON-RPC contract by forwarding to it.
//
// The host's own console output (the server logs to stdout) is sent to stderr, so stdout stays the RPC channel.
//   npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/witness-server/launcher.ts' --out results/runs/2026-11-19-witness
//
// Environment: KW_ROOT (default ../keyring-wallet, a sibling checkout; read only, never written), WIT_HOST_TIMEOUT_MS (start-up bound,
// default 240000), WIT_LOCALITY_POLICY (off | offered | required; default offered, the server's default), WIT_CREDENTIAL_SHAPE (vsc | wd02;
// default vsc, the server's default), WIT_ROW=latest (a build that serves the 0.2 pair: its own row name). Nothing in the wallet checkout is changed.
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

/** The command that runs the host as a child process (pure, so it can be tested without starting anything). */
export function launchPlan(kwRoot: string, portFile: string, hereDir = here): LaunchPlan {
  const ws = join(kwRoot, "bifold/packages/witness-server");
  return {
    command: "nice",
    args: ["-n", "10", process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(hereDir, "witness-host.ts")],
    env: { ...(process.env.WIT_ROW === undefined ? {} : { WIT_ROW: process.env.WIT_ROW }), KW_ROOT: kwRoot, WIT_HOST_PORT_FILE: portFile, TMPDIR: process.env.TMPDIR ?? join(tmpdir(), "wit-adapter") },
    cwd: ws,
  };
}

async function waitForPort(portFile: string, timeoutMs: number, alive: () => boolean): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!alive()) throw new Error("the witness host exited before it was listening (see its output above)");
    if (existsSync(portFile)) {
      const t = readFileSync(portFile, "utf8").trim();
      if (/^\d+$/.test(t)) return Number(t);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the witness host did not start within ${timeoutMs} ms`);
}

async function main(): Promise<void> {
  process.umask(0o002);
  const kwRoot = resolve(process.env.KW_ROOT ?? "../keyring-wallet");
  mkdirSync(process.env.TMPDIR ?? join(tmpdir(), "wit-adapter"), { recursive: true });
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "wit-host-"));
  const portFile = join(dir, "port");
  const plan = launchPlan(kwRoot, portFile);
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, stdio: ["ignore", 2, 2] });
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
    const port = await waitForPort(portFile, Number(process.env.WIT_HOST_TIMEOUT_MS ?? 240000), () => !exited);
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
