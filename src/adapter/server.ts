// SPDX-License-Identifier: Apache-2.0
// Server side of the out-of-process wire contract (docs/04-suite-design.md section 4): serves any
// in-process `Adapter` over stdio (newline-delimited JSON-RPC 2.0) or HTTP (one POST per call).
// An implementation under test would do the same in its own language; this is the TypeScript form.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { dispatch } from "./contract.ts";
import type { Adapter, RpcResponse } from "./contract.ts";
import { isObject } from "../util/json.ts";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

const PARSE_ERROR: RpcResponse = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
const INVALID: RpcResponse = { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };

/** Handle one JSON text; always returns exactly one JSON-RPC response (batches are not part of the contract). */
export async function handleText(adapter: Adapter, text: string): Promise<RpcResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return PARSE_ERROR;
  }
  if (!isObject(parsed)) return INVALID;
  return dispatch(adapter, parsed as never);
}

/** Read requests from `input` one per line and write one response line per request to `output`. Resolves when input ends. */
export async function serveStdio(adapter: Adapter, input: Readable, output: Writable): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  // Requests are served strictly in arrival order: the contract is a conversation, not a pipeline.
  let chain: Promise<void> = Promise.resolve();
  for await (const line of rl) {
    if (line.trim() === "") continue;
    chain = chain.then(async () => {
      const res = await handleText(adapter, line);
      output.write(JSON.stringify(res) + "\n");
    });
  }
  await chain;
}

function readBody(req: IncomingMessage): Promise<string | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve("too-large");
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** Serve `adapter` on `port` (0 picks a free one). POST with a JSON-RPC body on any path; the reply is always HTTP 200 with a JSON-RPC response, except 405 and 413. */
export function serveHttp(adapter: Adapter, port: number, host = "127.0.0.1"): Promise<Server> {
  let chain: Promise<void> = Promise.resolve();
  const server = createServer((req, res) => {
    if (req.method !== "POST") return reply(res, 405, { error: "POST a JSON-RPC request" });
    // Serialise calls: the adapter holds one conversation's state.
    chain = chain.then(async () => {
      try {
        const body = await readBody(req);
        if (body === "too-large") return reply(res, 413, { error: "request body too large" });
        reply(res, 200, await handleText(adapter, body));
      } catch {
        if (!res.headersSent) reply(res, 400, { error: "bad request" });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
