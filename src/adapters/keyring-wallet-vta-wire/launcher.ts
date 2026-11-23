// SPDX-License-Identifier: Apache-2.0
// The stdio adapter of the keyring-wallet-vta-wire row (the command behind `--adapter 'stdio:...'` and a scenario runner's `--participant K=stdio:...`).
//
//   --role K   the wallet (member-phone): serves the suite's JSON-RPC by forwarding to the wallet's wire host.
//   --role C   the live VTC (the community of FC-MBR and FC-IDV): the VTC adapter (vtc-adapter.ts); sends travel over the wallet's wire.
//   --role V   the live VTA (agent): the V adapter (v-adapter.ts); sends travel over the wallet's wire.
//
// Without KW_WIRE_HOST_URL the launcher starts the host itself (jest under keyring-wallet's configuration, then the operator makes the wallet's DID an
// admin of the VTA) and stops it on exit. With KW_WIRE_HOST_URL (a host started once by wire-host-up.ts) both roles of one run share the same wallet session.
// Environment: see host-control.ts; KW_WIRE_INFO (JSON: walletCommit, vtaImage, mediatorImage) is recorded in the capabilities' version.
import { rpcAdapterFromSpec } from "../../adapter/client.ts";
import { serveStdio } from "../../adapter/server.ts";
import type { Adapter } from "../../adapter/contract.ts";
import { hostRpc, operatorFromEnv, startHost, vtcOperatorFromEnv } from "./host-control.ts";
import { VtcWireAdapter } from "./vtc-adapter.ts";
import type { Host } from "./host-control.ts";
import { VWireAdapter } from "./v-adapter.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const role = argv[argv.indexOf("--role") + 1];
  if (role !== "K" && role !== "V" && role !== "C") { console.error("usage: launcher.ts --role K|V|C"); process.exit(2); }
  let host: Host | undefined;
  let url = process.env.KW_WIRE_HOST_URL;
  if (url === undefined || url === "") { host = await startHost(); url = host.url; }
  const info = { walletCommit: "unknown", vtaImage: "vta", mediatorImage: "mediator", resolver: (process.env.KW_WIRE_RESOLVER === "real" ? "real" : "shim") as "real" | "shim", ...(JSON.parse(process.env.KW_WIRE_INFO || "{}") as object) };
  const adapter: Adapter = role === "C" ? new VtcWireAdapter(hostRpc(url), vtcOperatorFromEnv(), operatorFromEnv(), process.env.KW_WIRE_VTC_DID!, info) : role === "K" ? rpcAdapterFromSpec(`http:${url}`, { timeoutMs: 240000 }) : new VWireAdapter(hostRpc(url), operatorFromEnv(), process.env.KW_WIRE_VTA_DID!, info);
  try {
    await serveStdio(adapter, process.stdin, process.stdout);
  } finally {
    if (host !== undefined) await host.stop();
  }
}
await main();
