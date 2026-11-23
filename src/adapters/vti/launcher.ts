// SPDX-License-Identifier: Apache-2.0
// Launcher of the VTI community service (VTC) in process: the command behind `--adapter stdio:...` for the "VTC handlers in process" row.
//
//   VTI_ROOT=<VTI checkout at the pinned ref> npm run suite -- --adapter 'stdio:node --experimental-strip-types src/adapters/vti/launcher.ts' --out <dir>
//
// It builds the Rust host (vtc-host/) once with cargo in a build directory outside both repositories, starts it, and serves the suite's stdio
// JSON-RPC contract through the HTTPS adapter (adapter.ts) pointed at the host's loopback door. The VTI checkout is read only and never
// written; the lock file is copied from it. Environment: VTI_ROOT (required unless VTI_VTC_BIN), VTI_VTC_BUILD (build directory, default
// <tmpdir>/vtc-inprocess-build), VTI_VTC_BIN (a prebuilt host binary; skips the build), VTI_INPROCESS_JOBS (cargo jobs, default 4),
// VTI_HOST_TIMEOUT_MS (start-up bound), VTI_ACTOR_ROLE (ACL role of the harness actors, default member), VTI_VTC_CEREMONY=1 (the ceremony track, docs/26: also VTC_HOST_PUBLIC_URL, default https://vtc.test, for a host built from this source; an older host ignores it), VTI_PACE_MS (minimum ms between sends; changes little, D481), VTI_TRACE=<file> (one line per send and reply: time, status, duration, Retry-After), VTI_VTC_SEED_DEFAULTS=1 (run the platform's own default-policy installation before the first request and declare `seed.defaults`; off by default). The build sets VTC_SKIP_ADMIN_UI_BUILD=1: vtc-service's build script would otherwise run `npm install` inside the VTI checkout (the admin console is not needed here). The same adapter, without the host, measures a running `vtc` (the live row).
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "../../adapter/server.ts";
import { ed25519Signer } from "../../crypto/didkey.ts";
import { hostFeaturesFromEnv, renderManifest, versionOf } from "../vti-inprocess/launcher.ts";
import { configFromEnv, VtiAdapter } from "./adapter.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The seed the VTC's test-support signers derive their key from (vtc-service/src/test_support.rs SIGNER_SEED); the host's DID is the did:key of that key. */
export const VTC_SIGNER_SEED = Buffer.alloc(32, 0xc5);
export const vtcDid = (): string => ed25519Signer(new Uint8Array(VTC_SIGNER_SEED)).did;

function build(vtiRoot: string): string {
  const dir = resolve(process.env.VTI_VTC_BUILD ?? join(tmpdir(), "vtc-inprocess-build"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "Cargo.toml"), renderManifest(readFileSync(join(here, "vtc-host/Cargo.toml.in"), "utf8"), vtiRoot, hostFeaturesFromEnv()));
  if (!existsSync(join(dir, "Cargo.lock"))) copyFileSync(join(vtiRoot, "Cargo.lock"), join(dir, "Cargo.lock"));
  copyFileSync(join(here, "vtc-host/src/main.rs"), join(dir, "src/main.rs"));
  console.error(`building the VTC in-process host in ${dir} (the first build compiles VTI's dependency graph and takes a long time)`);
  execFileSync("nice", ["-n", "10", "cargo", "build", "-j", process.env.VTI_INPROCESS_JOBS ?? "4"], { cwd: dir, stdio: ["ignore", 2, 2], env: { ...process.env, TMPDIR: process.env.TMPDIR ?? tmpdir(), VTC_SKIP_ADMIN_UI_BUILD: "1" } });
  return join(process.env.CARGO_TARGET_DIR ?? join(dir, "target"), "debug/vtc-inprocess-host");
}

async function main(): Promise<void> {
  process.umask(0o002);
  const bin = process.env.VTI_VTC_BIN ?? (() => {
    const root = process.env.VTI_ROOT;
    if (root === undefined || root === "") throw new Error("VTI_ROOT must name a checkout of VTI at the pinned ref (read only), or VTI_VTC_BIN a prebuilt host");
    return build(resolve(root));
  })();
  const child = spawn(bin, [], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, VTC_DID: vtcDid(), ...(process.env.VTI_VTC_CEREMONY === "1" ? { VTC_HOST_PUBLIC_URL: process.env.VTC_HOST_PUBLIC_URL ?? "https://vtc.test", VTC_HOST_BOOT: process.env.VTC_HOST_BOOT ?? "1" } : {}) } });
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
  const version = process.env.VTI_ROOT === undefined ? "vtc-service (in process)" : `${versionOf(resolve(process.env.VTI_ROOT)).replace(/^vta-service/, "vtc-service")}, VTC handlers in process (loopback HTTP door)`;
  const adapter = new VtiAdapter({ config: { controlUrl: control, version, baseUrl: "http://127.0.0.1:0", apiPrefix: "/v1", ...(process.env.VTI_ACTOR_ROLE ? { actorRole: process.env.VTI_ACTOR_ROLE } : {}), ...(process.env.VTI_VTC_SEED_DEFAULTS === "1" ? { seedDefaults: true } : {}), ...(process.env.VTI_VTC_CEREMONY === "1" ? { ceremony: true } : {}), ...(configFromEnv(process.env).paceMs === undefined ? {} : { paceMs: configFromEnv(process.env).paceMs }) } });
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
