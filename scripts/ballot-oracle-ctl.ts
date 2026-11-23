// SPDX-License-Identifier: Apache-2.0
// The cast source for a wallet row against the reference ballot box (docs/32): the same control route the platform's ballot host offers (`POST /ctl/cast`), serving the oracle's modelled casts, addressed to the reference box's DID.
// Usage: node --experimental-strip-types scripts/ballot-oracle-ctl.ts <port>
import { createServer } from "node:http";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { buildCast } from "../src/adapters/reference/ballot-model.ts";

const box = ed25519Signer(seedOf(0xb7)).did;
createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const a = JSON.parse(body || "{}") as Record<string, string>;
    const document = buildCast(box, a.electionId ?? "e1", a.variant ?? "ok", a.threadId as string, a.version ?? "0.1");
    if (a.threadId === undefined) delete (document as Record<string, unknown>).threadId;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ document }));
  });
}).listen(Number(process.argv[2] ?? 0), "127.0.0.1");
