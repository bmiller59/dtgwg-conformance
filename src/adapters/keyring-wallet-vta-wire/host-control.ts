// SPDX-License-Identifier: Apache-2.0
// Starting and talking to the wallet's wire host (wire-host.jest.ts in serve mode), from plain node. The host runs under keyring-wallet's own jest.
//
// Environment (read by startHost; the same names are passed on to the host):
//   KW_ROOT                 keyring-wallet checkout (read only)         KW_JEST_CACHE   jest cache directory (default <tmp>/kw-vta-wire/jest-cache)
//   KW_WIRE_VTA_DID         the live VTA's DID                          KW_WIRE_MEDIATOR_DID   the mediator's DID
//   KW_WIRE_VTA_URL         the VTA's REST base (operator)              KW_WIRE_ADMIN_FILE     admin.json of the VTA's admin (privateKeyMultibase)
//   KW_WIRE_RESOLVER        shim (default) or real                      KW_WIRE_TRACE          wire trace file (JSON lines)
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Operator, seedFromMultibase } from "./operator.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function operatorFromEnv(env: NodeJS.ProcessEnv = process.env): Operator {
  const need = (k: string): string => { const v = env[k]; if (v === undefined || v === "") throw new Error(`${k} is not set`); return v; };
  const admin = JSON.parse(readFileSync(need("KW_WIRE_ADMIN_FILE"), "utf8")) as { privateKeyMultibase: string };
  return new Operator(need("KW_WIRE_VTA_URL"), need("KW_WIRE_VTA_DID"), seedFromMultibase(admin.privateKeyMultibase));
}

/** An operator for the live VTC (its trust-task door is `<url>/v1`; the deployment's admin key is the one of the VTA's starter). */
export function vtcOperatorFromEnv(env: NodeJS.ProcessEnv = process.env): Operator {
  const need = (k: string): string => { const v = env[k]; if (v === undefined || v === "") throw new Error(`${k} is not set`); return v; };
  const admin = JSON.parse(readFileSync(need("KW_WIRE_ADMIN_FILE"), "utf8")) as { privateKeyMultibase: string };
  return new Operator(`${need("KW_WIRE_VTC_URL").replace(/\/+$/, "")}/v1`, need("KW_WIRE_VTC_DID"), seedFromMultibase(admin.privateKeyMultibase));
}

/** The jest command (pure, so a test can check it without starting anything). */
export function hostPlan(kwRoot: string, jestCache: string): { command: string; args: string[]; cwd: string } {
  return {
    command: "nice",
    args: ["-n", "10", join(kwRoot, "bifold/node_modules/.bin/jest"), "--config", join(here, "jest.config.cjs"), "--runInBand", "--watchman=false", "--forceExit", "--silent", "--testPathPattern", "wire-host", "--cacheDirectory", jestCache],
    cwd: join(kwRoot, "bifold/packages/core"),
  };
}

export interface Host { url: string; walletDid: string; child: ChildProcess; stop: () => Promise<void> }

export async function startHost(env: NodeJS.ProcessEnv = process.env, timeoutMs = Number(process.env.KW_HOST_TIMEOUT_MS ?? 300000)): Promise<Host> {
  process.umask(0o002);
  const kwRoot = env.KW_ROOT ?? "../keyring-wallet";
  const jestCache = env.KW_JEST_CACHE ?? join(tmpdir(), "kw-vta-wire", "jest-cache");
  mkdirSync(jestCache, { recursive: true });
  const dir = mkdtempSync(join(env.TMPDIR ?? tmpdir(), "kw-wire-host-"));
  const didFile = join(dir, "did"), grantedFile = join(dir, "granted"), portFile = join(dir, "port");
  const plan = hostPlan(kwRoot, jestCache);
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: { ...process.env, ...env, KW_WIRE_SERVE: "1", KW_WIRE_DID_FILE: didFile, KW_WIRE_GRANTED_FILE: grantedFile, KW_WIRE_PORT_FILE: portFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  const until = async (file: string, what: string): Promise<string> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (exited) throw new Error(`the jest host exited before ${what}`);
      if (existsSync(file) && readFileSync(file, "utf8").trim() !== "") return readFileSync(file, "utf8").trim();
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`the jest host did not ${what} within ${timeoutMs} ms`);
  };
  const stop = async (): Promise<void> => {
    if (!exited) {
      const port = existsSync(portFile) ? readFileSync(portFile, "utf8").trim() : "";
      if (port !== "") await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", body: "{}" }).catch(() => undefined);
      setTimeout(() => child.kill("SIGTERM"), 5000).unref();
    }
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const walletDid = await until(didFile, "mint the wallet's DID");
    // the harness stand-in for the enrolment ceremony: the operator makes the wallet's DID an admin of the VTA
    const op = operatorFromEnv(env);
    await op.dropPolicy("ceremony-step-up"); // a gate left by an earlier run would gate this grant too
    await op.dropPolicy("fc-kvc"); // so would a consent rule left by an interrupted FC-KVC run
    await op.grant(walletDid, "admin", "keyring-wallet-vta-wire");
    writeFileSync(grantedFile, "1");
    const port = await until(portFile, "start serving");
    return { url: `http://127.0.0.1:${port}/`, walletDid, child, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}

/** Minimal JSON-RPC 2.0 client for the host. */
export function hostRpc(url: string, timeoutMs = 180000): (method: string, params?: unknown) => Promise<any> {
  let n = 0;
  return async (method, params) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params: params ?? {} }), signal: AbortSignal.timeout(timeoutMs) });
    const j = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (j.error !== undefined) throw new Error(j.error.message);
    return j.result;
  };
}
