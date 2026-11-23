// SPDX-License-Identifier: Apache-2.0
// Launcher of the VTI emit adapter: the command behind `--adapter stdio:...`.
//
//   VTI_ROOT=<VTI checkout at the pinned ref> npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/vti-emit/launcher.ts' --vectors vectors/emit ...
//
// Builds the Rust host (rust/) once with cargo in a build directory outside both repositories (the VTI checkout is read only and never
// written; the lock file is copied from it), starts it and serves the suite's stdio JSON-RPC contract through the adapter.
// Environment: VTI_ROOT (required), VTI_EMIT_BUILD (build directory), VTI_EMIT_BIN (a prebuilt host binary), VTI_EMIT_JOBS (cargo jobs,
// default 4), CARGO_TARGET_DIR (honoured by cargo), VTI_HOST_TIMEOUT_MS (start-up bound), VTI_EMIT_REPORT (write the per-type builder
// report, JSON, on exit).
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../adapter/server.ts";
import { VtiEmitAdapter } from "./adapter.ts";
import { NOT_BUILT } from "./not-built.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function versionOf(vtiRoot: string): string {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", vtiRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* an export without git history */
  }
  let crate = "unknown";
  try {
    const m = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(vtiRoot, "vta-sdk/Cargo.toml"), "utf8"));
    if (m?.[1] !== undefined) crate = m[1];
  } catch {
    /* ignore */
  }
  return `vta-sdk ${crate} @ VTI ${commit}`;
}

function build(vtiRoot: string): string {
  const dir = resolve(process.env.VTI_EMIT_BUILD ?? join(tmpdir(), "vti-emit-build"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), readFileSync(join(here, "rust/Cargo.toml.in"), "utf8").replaceAll("@VTI_ROOT@", vtiRoot.replace(/\\/g, "/")));
  if (!existsSync(join(dir, "Cargo.lock"))) copyFileSync(join(vtiRoot, "Cargo.lock"), join(dir, "Cargo.lock"));
  for (const f of ["main.rs", "flows.rs"]) copyFileSync(join(here, "rust/src", f), join(dir, "src", f));
  console.error(`building the emit host in ${dir}`);
  execFileSync("nice", ["-n", "10", "cargo", "build", "-j", process.env.VTI_EMIT_JOBS ?? "4"], { cwd: dir, stdio: ["ignore", 2, 2], env: { ...process.env, TMPDIR: process.env.TMPDIR ?? tmpdir() } });
  return join(process.env.CARGO_TARGET_DIR ?? join(dir, "target"), "debug/vti-emit-host");
}

async function main(): Promise<void> {
  process.umask(0o002);
  const vtiRoot = process.env.VTI_ROOT;
  if (vtiRoot === undefined || vtiRoot === "") throw new Error("VTI_ROOT must name a checkout of VTI at the pinned ref (read only)");
  const bin = process.env.VTI_EMIT_BIN ?? build(resolve(vtiRoot));
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"] });
  let exited = false;
  child.on("exit", () => (exited = true));
  const control = await new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("the host did not report its control address in time")), Number(process.env.VTI_HOST_TIMEOUT_MS ?? 60000));
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const line = buf.split("\n").find((l) => l.startsWith("{"));
      if (line !== undefined) {
        clearTimeout(timer);
        ok(String((JSON.parse(line) as { control: string }).control));
      }
    });
    child.on("exit", () => fail(new Error("the host exited before it was ready")));
  });
  const adapter = new VtiEmitAdapter({ controlUrl: control, version: versionOf(resolve(vtiRoot)), notOffered: NOT_BUILT });
  try {
    await serveStdio(adapter, process.stdin, process.stdout);
  } finally {
    if (process.env.VTI_EMIT_REPORT !== undefined) writeFileSync(process.env.VTI_EMIT_REPORT, JSON.stringify({ builders: Object.fromEntries(adapter.builders), governance: Object.fromEntries(adapter.governance) }, null, 2) + "\n");
    if (!exited) {
      await adapter.shutdown();
      setTimeout(() => child.kill(), 2000).unref();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
