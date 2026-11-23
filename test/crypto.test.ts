// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { base58Decode, base58Encode } from "../src/crypto/base58.ts";
import { ed25519FromDidKey, ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { parseDateTimeStamp, signDocument, verifyDocumentProof } from "../src/crypto/proof.ts";
import { FIXTURES } from "./helpers.ts";

const NOW = Date.parse("2026-11-12T10:00:00Z");

describe("base58 and did:key", () => {
  it("round-trips including leading zeros", () => {
    for (const b of [[0, 0, 1, 2, 255], [1], [255, 255, 255], []]) {
      assert.deepEqual([...base58Decode(base58Encode(new Uint8Array(b)))], b);
    }
  });
  it("seed [7;32] gives the task force's fixture identity", () => {
    assert.equal(ed25519Signer(seedOf(7)).did, "did:key:z6MkvDqGT54cXesYGvABpF1UapVNwjCqRcafi4Px6Thv5T3Z");
    assert.equal(ed25519FromDidKey("did:key:z6MkvDqGT54cXesYGvABpF1UapVNwjCqRcafi4Px6Thv5T3Z#x")?.length, 32);
    assert.equal(ed25519FromDidKey("did:web:example.com"), null);
  });
  it("reproduces the baseline fixture's proofValue byte for byte", () => {
    const baseline = JSON.parse(readFileSync(join(FIXTURES, "proof", "eddsa-jcs-2022-baseline.json"), "utf8"));
    const { proof, ...body } = baseline;
    const signed = signDocument(body, ed25519Signer(seedOf(7)), { purpose: proof.proofPurpose, created: Date.parse(proof.created) });
    assert.equal(signed.proof.proofValue, proof.proofValue);
  });
});

describe("proof verification", () => {
  const signer = ed25519Signer(seedOf(9));
  const doc = { id: "urn:uuid:1", type: "https://example.org/x/1.0", issuer: signer.did, payload: { a: 1 } };
  it("round-trips and detects tampering", () => {
    const signed = signDocument(doc, signer, { created: NOW });
    assert.equal(verifyDocumentProof(signed, { nowMs: NOW }).valid, true);
    assert.equal(verifyDocumentProof({ ...signed, payload: { a: 2 } }, { nowMs: NOW }).valid, false);
  });
  it("binds the proof to the issuer", () => {
    const other = ed25519Signer(seedOf(10));
    const signed = signDocument(doc, other, { created: NOW, allowIssuerMismatch: true });
    assert.equal(verifyDocumentProof(signed, { nowMs: NOW }).failure, "issuerMismatch");
    assert.throws(() => signDocument(doc, other, { created: NOW }));
  });
  it("refuses a created time beyond the skew", () => {
    const signed = signDocument(doc, signer, { created: NOW + 120_000 });
    assert.equal(verifyDocumentProof(signed, { nowMs: NOW }).valid, false);
  });
  it("range-checks timestamps", () => {
    assert.equal(parseDateTimeStamp("2026-02-30T00:00:00Z"), undefined);
    assert.equal(parseDateTimeStamp("2026-01-01T24:00:00Z"), undefined);
    assert.equal(parseDateTimeStamp("2026-01-01T00:00:60Z"), undefined);
    assert.equal(parseDateTimeStamp("2026-01-01T00:00:00+24:00"), undefined);
    assert.equal(parseDateTimeStamp("2026-01-01T00:00:00Z"), 1767225600000);
  });
});

describe("task force proof fixtures (Ed25519 entries)", () => {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, "proof", "manifest.json"), "utf8")) as {
    entries: { file: string; cryptosuite: string; expect: string }[];
  };
  const entries = manifest.entries.filter((e) => e.cryptosuite === "eddsa-jcs-2022");
  it("covers every Ed25519 fixture", () => assert.ok(entries.length >= 29));
  for (const e of entries) {
    it(`${e.file} is ${e.expect}`, () => {
      const doc = JSON.parse(readFileSync(join(FIXTURES, "proof", e.file), "utf8"));
      assert.equal(verifyDocumentProof(doc, { nowMs: NOW }).valid ? "valid" : "invalid", e.expect);
    });
  }
});
