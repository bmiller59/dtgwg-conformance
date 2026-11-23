// SPDX-License-Identifier: Apache-2.0
// Serve the VTI adapter over the wire contract (docs/04 section 4), for runners in another process:
//   node --experimental-strip-types src/adapters/vti/server.ts stdio
//   node --experimental-strip-types src/adapters/vti/server.ts http --port 8081
// Configuration comes from the VTI_* environment variables (see adapter.ts `configFromEnv`).
import { serveHttp, serveStdio } from "../../adapter/server.ts";
import { createAdapter } from "./adapter.ts";

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== "stdio" && mode !== "http") throw new Error("usage: server.ts stdio | http [--port N] [--host H]");
  const adapter = createAdapter();
  if (mode === "stdio") {
    await serveStdio(adapter, process.stdin, process.stdout);
    return;
  }
  let port = 0;
  let host = "127.0.0.1";
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--port") port = Number(rest[++i]);
    else if (rest[i] === "--host") host = String(rest[++i]);
    else throw new Error(`unknown option ${String(rest[i])}`);
  }
  const server = await serveHttp(adapter, port, host);
  const addr = server.address();
  console.log(`listening http://${host}:${typeof addr === "object" && addr !== null ? addr.port : port}/`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(2);
});
