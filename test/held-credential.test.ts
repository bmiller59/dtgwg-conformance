// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { verifyDocumentProof } from "../src/crypto/proof.ts";
import { heldCredential } from "../src/adapters/keyring-wallet/held-credential.ts";

describe("the wallet host's held-credential stand-in", () => {
  const issuer = ed25519Signer(seedOf(0x5c));
  const { vc } = heldCredential("https://example.org/conformance#ConformanceCredential", "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", issuer);
  const proof = (vc as unknown as { proof: { "@context"?: unknown } }).proof;
  it("carries string @context entries only, in the credential and in the proof copy (the VTC reads the proof context as a list of strings)", () => {
    const ctx = (vc as unknown as { "@context": unknown[] })["@context"];
    assert.ok(Array.isArray(ctx) && ctx.every((c) => typeof c === "string"));
    if (proof["@context"] !== undefined) assert.ok(Array.isArray(proof["@context"]) && (proof["@context"] as unknown[]).every((c) => typeof c === "string"));
  });
  it("names the type by its local name and the signature verifies", () => {
    assert.deepEqual((vc as unknown as { type: string[] }).type, ["VerifiableCredential", "ConformanceCredential"]);
    assert.equal(verifyDocumentProof(vc as never, { nowMs: Date.now() }).valid, true);
  });
});
