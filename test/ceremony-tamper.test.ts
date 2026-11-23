// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../src/crypto/proof.ts";
import { TAMPER_MODES, tamperDecision } from "../src/ceremony/tamper.ts";

const me = ed25519Signer(seedOf(0x31));
const other = ed25519Signer(seedOf(0x32));
const base = signDocument({ id: "urn:uuid:1", type: "https://trusttasks.org/spec/task-consent/decision/0.2", issuer: me.did, recipient: other.did, issuedAt: "2026-11-19T10:00:00Z", payload: { challenge: "c".repeat(20), payloadDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA", decision: "approve" } }, me, { created: Date.now(), purpose: "assertionMethod" });
const ok = (t: string): boolean => verifyDocumentProof(JSON.parse(t), { nowMs: Date.now() }).valid === true;

describe("tamperDecision: each mode changes one thing", () => {
  const t = (m: (typeof TAMPER_MODES)[number]) => JSON.parse(tamperDecision(JSON.stringify(base), m, me, Date.now(), other));
  it("wrongPurpose signs for authentication", () => assert.equal(t("wrongPurpose").proof.proofPurpose, "authentication"));
  it("noProof removes the proof", () => assert.equal(t("noProof").proof, undefined));
  it("badSignature changes the proof value and nothing else", () => {
    const d = t("badSignature");
    assert.notEqual(d.proof.proofValue, (base.proof as { proofValue: string }).proofValue);
    assert.equal(d.payload.decision, "approve");
  });
  it("wrongRecipient, staleIssuedAt, wrongDigest, wrongChallenge each change their member and keep the purpose", () => {
    assert.notEqual(t("wrongRecipient").recipient, other.did);
    assert.equal(t("staleIssuedAt").issuedAt, "2020-01-01T00:00:00Z");
    assert.notEqual(t("wrongDigest").payload.payloadDigest, base.payload.payloadDigest);
    assert.notEqual(t("wrongChallenge").payload.challenge, base.payload.challenge);
    for (const m of ["wrongRecipient", "staleIssuedAt", "wrongDigest", "wrongChallenge"] as const) assert.equal(t(m).proof.proofPurpose, "assertionMethod");
  });
  it("foreignSigner makes the outsider the issuer and the signer", () => {
    const d = t("foreignSigner");
    assert.equal(d.issuer, other.did);
    assert.ok(String(d.proof.verificationMethod).startsWith(other.did));
  });
  it("version01 retypes the document", () => assert.match(t("version01").type, /decision\/0\.1$/));
  it("foreignSigner without a foreign signer is an error, not a silent pass", () => assert.throws(() => tamperDecision(JSON.stringify(base), "foreignSigner", me, Date.now()), /outsider/));
  it("the helper's own re-signing is sound: a re-signed document verifies, a bad signature and a missing proof do not", () => {
    assert.ok(ok(JSON.stringify(base)));
    assert.ok(ok(tamperDecision(JSON.stringify(base), "wrongRecipient", me, Date.now())));
    assert.ok(ok(tamperDecision(JSON.stringify(base), "foreignSigner", me, Date.now(), other)));
    assert.ok(!ok(tamperDecision(JSON.stringify(base), "badSignature", me, Date.now())));
    assert.ok(!ok(tamperDecision(JSON.stringify(base), "noProof", me, Date.now())));
  });
});
