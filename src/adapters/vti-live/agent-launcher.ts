// SPDX-License-Identifier: Apache-2.0
// Launcher of the LIVE agent service (a vta container from the openvti-starter kit) for the ceremony rows: the command behind
// `--adapter stdio:... src/adapters/vti-live/agent-launcher.ts`. The in-process agent adapter is used unchanged apart from two live hooks, with its control interface served
// by agent-ctl.ts over the container. Environment (required): LIVE_KIT_DIR, LIVE_PROJECT, LIVE_COMPOSE_ENV (JSON, VTA_IMAGE as the ref tag), LIVE_BASE_URL,
// LIVE_SNAPSHOT_DIR, LIVE_VERSION. VTI_ACTOR_ROLE as for the in-process host.
import { serveStdio } from "../../adapter/server.ts";
import { VtiInprocessAdapter } from "../vti-inprocess/adapter.ts";
import { AgentCtl } from "./agent-ctl.ts";
import { Dock } from "./docker.ts";
import { serveCtl } from "./server.ts";

const need = (k: string): string => {
  const v = process.env[k];
  if (v === undefined || v === "") throw new Error(`${k} is required`);
  return v;
};

async function main(): Promise<void> {
  const dock = new Dock({ kitDir: need("LIVE_KIT_DIR"), project: need("LIVE_PROJECT"), env: JSON.parse(need("LIVE_COMPOSE_ENV")) as Record<string, string>, service: "vta", snapshotDir: need("LIVE_SNAPSHOT_DIR") });
  const ctl = new AgentCtl({ dock, baseUrl: need("LIVE_BASE_URL"), adminFile: `${need("LIVE_KIT_DIR")}/.vta/admin.json`, ...(process.env.VTI_ACTOR_ROLE ? { defaultRole: process.env.VTI_ACTOR_ROLE } : {}) });
  const { url, server } = await serveCtl(ctl);
  const adapter = new VtiInprocessAdapter({ controlUrl: url, version: need("LIVE_VERSION"), ceremony: true });
  try {
    await serveStdio(adapter, process.stdin, process.stdout);
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0), (err: unknown) => { console.error((err as Error).message); process.exit(2); });
