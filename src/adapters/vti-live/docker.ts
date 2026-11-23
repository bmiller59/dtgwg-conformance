// SPDX-License-Identifier: Apache-2.0
// Docker plumbing for the live-container rows (docs/35): one compose project of the openvti-starter kit, driven from outside.
// Nothing here is VTI code. The only things done to a container are what an operator does with the images' own commands: stop, start,
// restart, `vtc acl add` / `vta acl add` on a stopped daemon, and copying the data volume (a snapshot of a freshly set-up community or agent).
import { execFile } from "node:child_process";

/** Runs a command and returns its output; replaceable so the tests need no docker. */
export type Run = (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => Promise<string>;

export const realRun: Run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, (err, out, stderr) =>
      err ? reject(new Error(`${cmd} ${args.join(" ")}: ${err.message} ${stderr}`.trim())) : resolve(out));
  });

export interface DockConfig {
  /** The kit copy whose docker-compose.yml defines the project (never the shared kit). */
  kitDir: string;
  /** Compose project name, for example bamvtilive2. */
  project: string;
  /** The compose environment of the project (ports, images), as `npm run up` exported it. */
  env: Record<string, string>;
  /** The compose service the adapter restarts, snapshots and runs offline commands in: `vtc` or `vta`. */
  service: "vtc" | "vta";
  /** A directory to keep the data snapshot in. */
  snapshotDir: string;
}

export class Dock {
  readonly cfg: DockConfig;
  private readonly run: Run;
  constructor(cfg: DockConfig, run: Run = realRun) {
    this.cfg = cfg;
    this.run = run;
  }
  private compose(args: string[]): Promise<string> {
    const profile = this.cfg.service === "vtc" ? ["--profile", "vtc"] : [];
    return this.run("docker", ["compose", ...profile, ...args], { cwd: this.cfg.kitDir, env: { COMPOSE_PROJECT_NAME: this.cfg.project, ...this.cfg.env } });
  }
  volume(): string {
    return `${this.cfg.project}_${this.cfg.service}-data`;
  }
  stop(): Promise<string> { return this.compose(["stop", this.cfg.service]); }
  start(): Promise<string> { return this.compose(["start", this.cfg.service]); }
  /** One container restart, state left in place (no stop, no volume restore, no network or project change). */
  restart(): Promise<string> { return this.compose(["restart", this.cfg.service]); }
  /** The image the service runs (from the kit's compose file as the environment resolves it). */
  image(): string {
    const v = this.cfg.service === "vtc" ? this.cfg.env.VTC_IMAGE : this.cfg.env.VTA_IMAGE;
    if (v === undefined) throw new Error(`${this.cfg.service === "vtc" ? "VTC_IMAGE" : "VTA_IMAGE"} is not in the compose environment (use the ref tag, never :local)`);
    return v;
  }
  /** One-off container over the data volume, daemon stopped (the offline commands need the store lock). */
  offline(args: string[]): Promise<string> {
    const cfgPath = `/var/lib/${this.cfg.service}/config.toml`;
    return this.run("docker", ["compose", ...(this.cfg.service === "vtc" ? ["--profile", "vtc"] : []), "run", "--rm", "--no-deps", "--entrypoint", this.cfg.service, this.cfg.service, "--config", cfgPath, ...args], { cwd: this.cfg.kitDir, env: { COMPOSE_PROJECT_NAME: this.cfg.project, ...this.cfg.env } });
  }
  /** A shell snippet in a throwaway container as root over the data volume (/d) and the snapshot directory (/s). */
  private volShell(script: string): Promise<string> {
    return this.run("docker", ["run", "--rm", "--network", "none", "--user", "0", "-v", `${this.volume()}:/d`, "-v", `${this.cfg.snapshotDir}:/s`, "--entrypoint", "sh", this.image(), "-c", script]);
  }
  /** Daemon stopped: copy the data volume to the snapshot. */
  snapshot(): Promise<string> { return this.volShell("tar czf /s/data.tgz -C /d . && chown $(stat -c %u:%g /s) /s/data.tgz"); }
  /** Daemon stopped: replace the data volume's contents with the snapshot. */
  restore(): Promise<string> { return this.volShell("find /d -mindepth 1 -delete && tar xzf /s/data.tgz -C /d"); }
  /** Also the compose file's config, which a policy change edits (agent): the whole /var/lib/<service> volume is the data volume here. */
  edit(script: string): Promise<string> { return this.volShell(script); }
  async waitHealthy(baseUrl: string, seconds = 90): Promise<void> {
    const end = Date.now() + seconds * 1000;
    for (;;) {
      try {
        const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) return;
      } catch { /* not up yet */ }
      if (Date.now() > end) throw new Error(`${baseUrl}/health did not answer within ${seconds} s`);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
}
