// SPDX-License-Identifier: Apache-2.0
// Launcher of VTI's ballot box in process (docs/32): the command behind `--participant B=stdio:...`. It builds the host (host/) once with cargo in a build directory outside both repositories (or uses VTI_BALLOT_BIN, a prebuilt host), starts it,
// and serves the suite's stdio contract through the adapter. The VTI checkout is read only. Environment: VTI_ROOT (unless VTI_BALLOT_BIN), VTI_BALLOT_BUILD (build directory), VTI_BALLOT_BIN, BALLOT_HOST_PORT (control port, default any; the voter side reads
// the same port through BALLOT_CTL), VTI_INPROCESS_JOBS (cargo jobs, default 4), VTI_HOST_TIMEOUT_MS.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../adapter/server.ts";
import { renderManifest, versionOf } from "../vti-inprocess/launcher.ts";
import { VtiBallotAdapter } from "./adapter.ts";

const here = dirname(fileURLToPath(import.meta.url));

function build(vtiRoot: string): string {
  const dir = resolve(process.env.VTI_BALLOT_BUILD ?? join(tmpdir(), "vti-ballot-build"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), renderManifest(readFileSync(join(here, "host/Cargo.toml.in"), "utf8"), vtiRoot));
  if (!existsSync(join(dir, "Cargo.lock"))) copyFileSync(join(vtiRoot, "Cargo.lock"), join(dir, "Cargo.lock"));
  copyFileSync(join(here, "host/src/main.rs"), join(dir, "src/main.rs"));
  execFileSync("nice", ["-n", "10", "cargo", "build", "-j", process.env.VTI_INPROCESS_JOBS ?? "4"], { cwd: dir, stdio: ["ignore", 2, 2], env: { ...process.env, TMPDIR: process.env.TMPDIR ?? tmpdir(), VTC_SKIP_ADMIN_UI_BUILD: "1" } });
  return join(process.env.CARGO_TARGET_DIR ?? join(dir, "target"), "debug/vti-ballot-host");
}

async function main(): Promise<void> {
  process.umask(0o002);
  const bin = process.env.VTI_BALLOT_BIN ?? (() => {
    const root = process.env.VTI_ROOT;
    if (root === undefined || root === "") throw new Error("VTI_ROOT must name a checkout of VTI (read only), or VTI_BALLOT_BIN a prebuilt host");
    return build(resolve(root));
  })();
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env } });
  let exited = false;
  child.on("exit", () => (exited = true));
  const control = await new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("the host did not report its control address in time")), Number(process.env.VTI_HOST_TIMEOUT_MS ?? 120000));
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.startsWith("{"));
      if (line !== undefined) { clearTimeout(timer); ok(String((JSON.parse(line) as { control: string }).control)); }
    });
    child.on("exit", () => fail(new Error("the host exited before it was ready")));
  });
  const version = process.env.VTI_ROOT === undefined ? "vti-voting-service (in process)" : `${versionOf(resolve(process.env.VTI_ROOT)).replace(/^vta-service/, "vti-voting-service")}, ballot box in process (loopback HTTP door)`;
  const adapter = new VtiBallotAdapter({ controlUrl: control, version });
  try { await serveStdio(adapter, process.stdin, process.stdout); } finally {
    if (!exited) { await fetch(`${control}/ctl/shutdown`, { method: "POST", body: "{}" }).catch(() => undefined); setTimeout(() => child.kill("SIGTERM"), 3000).unref(); }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), (err: unknown) => { console.error((err as Error).message); process.exit(2); });
}
