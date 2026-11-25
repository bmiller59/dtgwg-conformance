// SPDX-License-Identifier: Apache-2.0
// The minimal SD-JWT-VC presentation used by the credential-exchange/present 0.2 vectors: it verifies when intact, and fails on a
// changed disclosure, a key-binding JWT by another key, or an sd_hash that does not bind the presentation.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { buildSdJwtPresentation, verifySdJwtPresentation } from "../src/crypto/sdjwt.ts";

const issuer = ed25519Signer(seedOf(31));
const holder = ed25519Signer(seedOf(32));
const other = ed25519Signer(seedOf(33));
const spec = { issuer, holder, claims: { memberOf: "https://example.org/c", given_name: "Erika" }, vct: "https://example.org/v", nonce: "n-1", audience: "did:example:verifier", iatSec: 1_790_000_000 };

describe("SD-JWT-VC presentation (present 0.2 vectors)", () => {
  it("verifies, and returns the issuer, holder, nonce, audience and the disclosed claims", () => {
    const v = verifySdJwtPresentation(buildSdJwtPresentation(spec));
    assert.equal(v.valid, true, v.reason);
    assert.equal(v.issuer, issuer.did);
    assert.equal(v.holder, holder.did);
    assert.equal(v.nonce, "n-1");
    assert.equal(v.audience, "did:example:verifier");
    assert.deepEqual(v.claims, { memberOf: "https://example.org/c", given_name: "Erika" });
  });

  it("fails on a disclosure that is not in _sd, a key-binding JWT by another key, and a key-binding JWT from another presentation", () => {
    const token = buildSdJwtPresentation(spec);
    const parts = token.split("~");
    parts[1] = Buffer.from(JSON.stringify(["salt", "given_name", "Mallory"])).toString("base64url");
    assert.equal(verifySdJwtPresentation(parts.join("~")).valid, false);
    const byOther = buildSdJwtPresentation({ ...spec, holder: other });
    const swappedKb = `${token.slice(0, token.lastIndexOf("~") + 1)}${byOther.slice(byOther.lastIndexOf("~") + 1)}`;
    assert.equal(verifySdJwtPresentation(swappedKb).valid, false);
    const fewer = buildSdJwtPresentation({ ...spec, claims: { memberOf: "https://example.org/c" } });
    const mixed = `${token.slice(0, token.lastIndexOf("~") + 1)}${fewer.slice(fewer.lastIndexOf("~") + 1)}`;
    assert.equal(verifySdJwtPresentation(mixed).valid, false);
    assert.equal(verifySdJwtPresentation("not-a-token").valid, false);
  });
});
