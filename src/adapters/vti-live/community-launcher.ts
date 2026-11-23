// SPDX-License-Identifier: Apache-2.0
// Launcher of the LIVE community service (a vtc container from the openvti-starter kit) for the ceremony rows: the command behind
// `--adapter stdio:... src/adapters/vti-live/community-launcher.ts`. The community adapter (src/adapters/vti/) is used unchanged, with its control
// interface served by community-ctl.ts over the container. Environment (all required): LIVE_KIT_DIR (a copy of the kit), LIVE_PROJECT (compose
// project), LIVE_COMPOSE_ENV (JSON of the compose environment, with VTC_IMAGE as the ref tag), LIVE_BASE_URL (the door, http://127.0.0.1:<port>),
// LIVE_SNAPSHOT_DIR, LIVE_VERSION (label). VTI_ACTOR_ROLE as for the in-process host.
import { serveStdio } from "../../adapter/server.ts";
import { VtiAdapter } from "../vti/adapter.ts";
import { CommunityCtl } from "./community-ctl.ts";
import { Dock } from "./docker.ts";
import { serveCtl } from "./server.ts";

/** The identities made members before the snapshot: the six harness actors, the adapter's administrator, (the others a scenario needs are made on demand and are gone after the next reset). */
export const PRESEED: readonly (readonly [number, string])[] = [
  [0x0a, "member"], [0x0b, "member"], [0x0c, "member"], [0x0d, "member"], [0x0e, "member"], [0x0f, "member"],
  [0x1c, "admin"],
];

const need = (k: string): string => {
  const v = process.env[k];
  if (v === undefined || v === "") throw new Error(`${k} is required`);
  return v;
};

async function main(): Promise<void> {
  const env = JSON.parse(need("LIVE_COMPOSE_ENV")) as Record<string, string>;
  const dock = new Dock({ kitDir: need("LIVE_KIT_DIR"), project: need("LIVE_PROJECT"), env, service: "vtc", snapshotDir: need("LIVE_SNAPSHOT_DIR") });
  const baseUrl = need("LIVE_BASE_URL");
  const ctl = new CommunityCtl({ dock, baseUrl, adminFile: `${need("LIVE_KIT_DIR")}/.vta/admin.json`, preseed: PRESEED.map(([n, r]) => [n, process.env.VTI_ACTOR_ROLE !== undefined && n <= 0x0f ? process.env.VTI_ACTOR_ROLE : r] as const) });
  const { url, server } = await serveCtl(ctl);
  const adapter = new VtiAdapter({ config: { controlUrl: url, version: need("LIVE_VERSION"), baseUrl, apiPrefix: "/v1", ceremony: true, ...(process.env.VTI_ACTOR_ROLE ? { actorRole: process.env.VTI_ACTOR_ROLE } : {}) } });
  try {
    await serveStdio(adapter, process.stdin, process.stdout);
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0), (err: unknown) => { console.error((err as Error).message); process.exit(2); });
