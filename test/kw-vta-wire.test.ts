// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { jweSummary, summariseTrace, webvhLogUrl } from "../src/adapters/keyring-wallet-vta-wire/wire-util.ts";

test("webvhLogUrl: a loopback host is read over http, a public host over https", () => {
  assert.equal(webvhLogUrl("did:webvh:QmScid:localhost%3A18730"), "http://localhost:18730/.well-known/did.jsonl");
  assert.equal(webvhLogUrl("did:webvh:QmScid:example.com"), "https://example.com/.well-known/did.jsonl");
  assert.equal(webvhLogUrl("did:webvh:QmScid:example.com:dids:vta"), "https://example.com/dids/vta/did.jsonl");
});

test("jweSummary: reads algorithms from the protected header and never the ciphertext", () => {
  const protectedHeader = Buffer.from(JSON.stringify({ alg: "ECDH-1PU+A256KW", enc: "A256CBC-HS512", typ: "application/didcomm-encrypted+json", skid: "did:key:z6Mk#k", apu: "x" })).toString("base64url");
  const s = jweSummary({ protected: protectedHeader, recipients: [{}], ciphertext: "SECRET" });
  assert.equal(s.alg, "ECDH-1PU+A256KW");
  assert.equal(s.enc, "A256CBC-HS512");
  assert.equal(s.apu, "present");
  assert.equal(s.recipients, 1);
  assert.ok(!JSON.stringify(s).includes("SECRET"));
  assert.deepEqual(jweSummary("not json"), { unparsed: true });
});

test("summariseTrace: counts frames and lists the DIDComm types in order", () => {
  const t = summariseTrace([
    { dir: "pack", plaintext: { type: "https://affinidi.com/atm/1.0/authenticate" }, jwe: { alg: "ECDH-1PU+A256KW", enc: "A256CBC-HS512" } },
    { dir: "ws->", jwe: { alg: "ECDH-1PU+A256KW", enc: "A256CBC-HS512" } },
    { dir: "ws<-", jwe: { alg: "ECDH-1PU+A256KW", enc: "A256CBC-HS512" } },
    { dir: "unpack", plaintext: { type: "https://trusttasks.org/binding/didcomm/0.1/envelope" } },
  ]);
  assert.deepEqual(t.frames, { out: 1, in: 1 });
  assert.deepEqual(t.packed, ["1.0/authenticate"]);
  assert.deepEqual(t.unpacked, ["0.1/envelope"]);
  assert.deepEqual(t.algs, ["ECDH-1PU+A256KW/A256CBC-HS512"]);
});
