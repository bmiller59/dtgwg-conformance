// SPDX-License-Identifier: Apache-2.0
// Stdio entry: `--adapter 'stdio:node --experimental-strip-types src/adapters/witness-server/index.ts'`.
// Environment: WITNESS_INVITATION_FILE (JSON with invitationUrl / invitationV2Url, as a witness writes it) or WITNESS_INVITATION_URL;
// DIDCOMM_ROOT (a directory whose node_modules hold Credo-TS); DIDCOMM_VERSION v1 (default) | v2; CARRIER_PORT (default 19102);
// WITNESS_REPLY_WAIT_MS (default 4000); WITNESS_ROW (the row name, default "witness-server"; "witness-server-latest" for a build that serves the 0.2 pair); WITNESS_VERSIONS (the witness pair versions the server serves, newest first, default "0.2"; for example "0.2,0.1").
import { serveStdio } from "../../adapter/server.ts";
import { invitationFromFile, WitnessServerAdapter } from "./adapter.ts";
import type { DidCommVersion } from "../../carriers/didcomm/carrier.ts";

// Credo logs to stdout; stdout carries the JSON-RPC conversation.
console.log = console.error;
console.info = console.error;

const version = (process.env.DIDCOMM_VERSION === "v2" ? "v2" : "v1") as DidCommVersion;
const root = process.env.DIDCOMM_ROOT;
if (root === undefined) throw new Error("DIDCOMM_ROOT is required");
const invitationUrl = process.env.WITNESS_INVITATION_URL ?? (process.env.WITNESS_INVITATION_FILE === undefined ? undefined : invitationFromFile(process.env.WITNESS_INVITATION_FILE, version));
if (invitationUrl === undefined) throw new Error("WITNESS_INVITATION_URL or WITNESS_INVITATION_FILE is required");
const adapter = new WitnessServerAdapter({
  root,
  version,
  invitationUrl,
  inboundPort: Number(process.env.CARRIER_PORT ?? 19102),
  ...(process.env.WITNESS_ROW === undefined ? {} : { name: process.env.WITNESS_ROW }),
  ...(process.env.WITNESS_VERSIONS === undefined ? {} : { versions: process.env.WITNESS_VERSIONS.split(",").map((x) => x.trim()).filter((x) => x !== "") }),
  ...(process.env.WITNESS_REPLY_WAIT_MS === undefined ? {} : { replyWaitMs: Number(process.env.WITNESS_REPLY_WAIT_MS) }),
});
await serveStdio(adapter, process.stdin, process.stdout);
await adapter.close();
process.exit(0);
