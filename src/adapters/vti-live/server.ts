// SPDX-License-Identifier: Apache-2.0
// A loopback HTTP server for the control routes (`POST /ctl/<route>`, JSON in and out): what the adapters' `controlUrl` talks to.
import { createServer } from "node:http";
import type { Server } from "node:http";

export interface Ctl { handle(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> }

export function serveCtl(ctl: Ctl): Promise<{ url: string; server: Server }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const path = (req.url ?? "").replace(/^\/ctl\//, "");
        let body: Record<string, unknown> = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>; } catch { /* empty */ }
        ctl.handle(path, body).then((out) => out, (e: unknown) => ({ error: (e as Error).message })).then((out) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(out));
        });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      ok({ url: `http://127.0.0.1:${typeof a === "object" && a !== null ? a.port : 0}`, server });
    });
  });
}
