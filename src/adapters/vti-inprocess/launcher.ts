// SPDX-License-Identifier: Apache-2.0
// Launcher of the VTI in-process adapter: the command behind `--adapter stdio:...`.
//
//   VTI_ROOT=<VTI checkout at the pinned ref> npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/vti-inprocess/launcher.ts' --out <dir>
//
// It builds the Rust host (rust/) once with cargo in a build directory outside both repositories, starts it, and serves the
// suite's stdio JSON-RPC contract through the adapter. The VTI checkout is read only and never written; the lock file is copied
// from it so every dependency is the version VTI itself builds with.
// Environment: VTI_ROOT (required), VTI_INPROCESS_BUILD (build directory, default <tmpdir>/vti-inprocess-build), VTI_INPROCESS_BIN
// (a prebuilt host binary; skips the build), VTI_INPROCESS_TRANSPORTS=1 (push-capable host: embedded mediator, observe.pushed; no restart), VTI_INPROCESS_JOBS (cargo jobs, default 6), VTI_HOST_TIMEOUT_MS (start-up bound), VTI_INPROCESS_NO_ATTESTED=1 (the non-attested run: do not declare `attested`).
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../adapter/server.ts";
import { VtiInprocessAdapter } from "./adapter.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The manifest of the host crate for a given VTI checkout (pure, so it is testable without cargo). */
export function renderManifest(template: string, vtiRoot: string, extraFeatures: string[] = []): string {
  const out = template.replaceAll("@VTI_ROOT@", vtiRoot.replace(/\\/g, "/"));
  if (extraFeatures.length === 0) return out;
  // Extra cargo features for the service crate the host embeds (`vta-service`, `vtc-service`), for a host that must serve what a feature
  // gates (VTI_HOST_FEATURES, comma separated). The line is rewritten, not the template, so the default build is unchanged.
  const list = extraFeatures.map((f) => `"${f}"`).join(", ");
  return out.replace(/^((?:vta|vtc)-service\s*=\s*\{[^}]*features\s*=\s*\[)([^\]]*)\]/m, (_m, head: string, cur: string) => `${head}${cur.trim() === "" ? "" : `${cur.trim()}, `}${list}]`);
}

/** Feature list from the environment (VTI_HOST_FEATURES), empty when unset. */
export function hostFeaturesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.VTI_HOST_FEATURES ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
}

/** Version text recorded in the matrix: the VTI commit and the vta-service crate version. */
export function versionOf(vtiRoot: string): string {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["-C", vtiRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    /* an export without git history */
  }
  let crate = "unknown";
  try {
    const m = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(vtiRoot, "vta-service/Cargo.toml"), "utf8"));
    if (m?.[1] !== undefined) crate = m[1];
  } catch {
    /* ignore */
  }
  return `vta-service ${crate} @ VTI ${commit}`;
}

function build(vtiRoot: string): string {
  const dir = resolve(process.env.VTI_INPROCESS_BUILD ?? join(tmpdir(), "vti-inprocess-build"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), renderManifest(readFileSync(join(here, "rust/Cargo.toml.in"), "utf8"), vtiRoot, hostFeaturesFromEnv()));
  if (!existsSync(join(dir, "Cargo.lock"))) copyFileSync(join(vtiRoot, "Cargo.lock"), join(dir, "Cargo.lock"));
  copyFileSync(join(here, "rust/src/main.rs"), join(dir, "src/main.rs"));
  console.error(`building the in-process host in ${dir} (the first build compiles VTI's dependency graph and takes a long time)`);
  execFileSync("nice", ["-n", "10", "cargo", "build", "-j", process.env.VTI_INPROCESS_JOBS ?? "6"], { cwd: dir, stdio: ["ignore", 2, 2], env: { ...process.env, TMPDIR: process.env.TMPDIR ?? tmpdir() } });
  return join(dir, "target/debug/vti-inprocess-host");
}

async function main(): Promise<void> {
  process.umask(0o002);
  const vtiRoot = process.env.VTI_ROOT;
  if (vtiRoot === undefined || vtiRoot === "") throw new Error("VTI_ROOT must name a checkout of VTI at the pinned ref (read only)");
  const bin = process.env.VTI_INPROCESS_BIN ?? build(resolve(vtiRoot));
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"] });
  let exited = false;
  child.on("exit", () => (exited = true));
  const control = await new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error("the host did not report its control address in time")), Number(process.env.VTI_HOST_TIMEOUT_MS ?? 120000));
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
  const adapter = new VtiInprocessAdapter({ controlUrl: control, version: versionOf(resolve(vtiRoot)), ...(process.env.VTI_INPROCESS_NO_ATTESTED === "1" ? { attested: false } : {}), ...(process.env.VTI_INPROCESS_TRANSPORTS === "1" ? { transports: true } : {}), ...(process.env.VTI_INPROCESS_CEREMONY === "1" ? { ceremony: true } : {}) });
  try {
    await serveStdio(adapter, process.stdin, process.stdout);
  } finally {
    if (!exited) {
      await fetch(`${control}/ctl/shutdown`, { method: "POST", body: "{}" }).catch(() => undefined);
      setTimeout(() => child.kill("SIGTERM"), 3000).unref();
    }
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
