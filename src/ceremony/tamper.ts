// SPDX-License-Identifier: Apache-2.0
// Deliberate breakage of a decision document a participant built, for the negative scenarios of the KW-to-VTI ceremony set (FC-KVC).
// The participant builds the document with its own real code (the wallet's own builder, the reference's own builder); this helper then
// changes ONE thing and, where the change would otherwise break the proof, signs again with the participant's own signer. That is a
// harness stand-in (class D): a real approver never sends these. Each mode names the single rule it is meant to trip.
import { signDocument } from "../crypto/proof.ts";
import type { Ed25519Signer } from "../crypto/didkey.ts";

export const TAMPER_MODES = [
  "wrongPurpose", // proof made for `authentication`, not `assertionMethod` (a decision is an attestation)
  "noProof", // the proof member removed
  "badSignature", // one character of the proof value changed
  "wrongRecipient", // addressed to some other party
  "staleIssuedAt", // issued far outside the acceptance window
  "wrongDigest", // payloadDigest of some other task
  "wrongChallenge", // challenge of some other request
  "foreignSigner", // issuer and proof by a key that is not the approver's (an outsider)
  "version01", // the same decision, typed as decision/0.1 (an older version)
] as const;
export type TamperMode = (typeof TAMPER_MODES)[number];
export const isTamperMode = (m: unknown): m is TamperMode => typeof m === "string" && (TAMPER_MODES as readonly string[]).includes(m);

type Doc = Record<string, unknown> & { payload?: Record<string, unknown> };

/** Change one thing in the decision `text` (JSON) and, where needed, sign it again with `signer`. `foreign` is the outsider's signer for `foreignSigner`. */
export function tamperDecision(text: string, mode: TamperMode, signer: Ed25519Signer, now: number, foreign?: Ed25519Signer): string {
  const doc = JSON.parse(text) as Doc;
  const { proof: _p, ...body } = doc;
  const keepPurpose = ((doc.proof as { proofPurpose?: string } | undefined)?.proofPurpose) ?? "assertionMethod";
  const resign = (b: Doc, purpose: string, who: Ed25519Signer = signer): string => JSON.stringify(signDocument(b as Record<string, unknown>, who, { created: now, purpose }));
  switch (mode) {
    case "wrongPurpose":
      return resign(body, "authentication");
    case "noProof":
      return JSON.stringify(body);
    case "badSignature": {
      const proof = { ...(doc.proof as Record<string, unknown>) };
      const v = String(proof.proofValue);
      proof.proofValue = v.slice(0, -1) + (v.endsWith("A") ? "B" : "A");
      return JSON.stringify({ ...body, proof });
    }
    case "wrongRecipient":
      return resign({ ...body, recipient: "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" }, keepPurpose);
    case "staleIssuedAt":
      return resign({ ...body, issuedAt: "2020-01-01T00:00:00Z" }, keepPurpose);
    case "wrongDigest":
      return resign({ ...body, payload: { ...body.payload, payloadDigest: "uEiAQ2Zk0vA1n7r5mJqXWp9sT4cYbHhNdLxUeGo3fKiRtMw" } }, keepPurpose);
    case "wrongChallenge":
      return resign({ ...body, payload: { ...body.payload, challenge: "tampered-challenge-0123456789" } }, keepPurpose);
    case "foreignSigner":
      if (foreign === undefined) throw new Error("tamper foreignSigner needs the outsider's signer");
      return resign({ ...body, issuer: foreign.did }, keepPurpose, foreign);
    case "version01":
      return resign({ ...body, type: String(body.type).replace("/0.2", "/0.1") }, keepPurpose);
  }
}
