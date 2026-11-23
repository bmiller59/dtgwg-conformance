// SPDX-License-Identifier: Apache-2.0
// The credential the keyring-wallet host's `holdCredential` helper gives the wallet (a class D harness stand-in): a W3C credential of a given type IRI, signed eddsa-jcs-2022 by a did:key issuer.
// Its @context is string URLs only, as VTI-issued credentials use: the Data Integrity proof copies the document's @context, and the VTC's verifier reads that copy as a list of strings
// (a context entry that is an object, such as an inline {"@vocab": ...}, is refused: "DI VC proof is not a Data-Integrity proof: invalid type: map, expected a string"). The type's own
// name is not defined by an inline vocabulary; the wallet's credential store tag (`expandedTypes`) carries the IRI the wallet matches on.
import { signDocument } from "../../crypto/proof.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";

export function heldCredential(typeIri: string, subject: string, issuer: Ed25519Signer): { vc: ReturnType<typeof signDocument>; cut: number } {
  const cut = Math.max(typeIri.lastIndexOf("#"), typeIri.lastIndexOf("/")) + 1;
  const vc = signDocument(
    {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", typeIri.slice(cut)],
      issuer: issuer.did,
      issuanceDate: "2026-01-01T00:00:00Z",
      credentialSubject: { id: subject },
    },
    issuer,
    { purpose: "assertionMethod", created: Date.parse("2026-01-01T00:00:00Z") },
  );
  return { vc, cut };
}
