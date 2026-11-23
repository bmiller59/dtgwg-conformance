// SPDX-License-Identifier: Apache-2.0
// Cross-check cases taken from the Verifiable Trust Infrastructure's (VTI) own tests and fixtures, pinned at one VTI commit.
// Every case names the VTI file and test it comes from and what VTI asserts. The expectation is VTI's, never the suite's.
// What a case measures is stated in `kind`: `proof` asks an implementation's proof verifier about bytes as received;
// `freshness` sends a document to the implementation and reads the error code it answers with.
import { ed25519Signer } from "../crypto/didkey.ts";
import { toMultibase } from "../crypto/base58.ts";
import { jcsBytes } from "../util/json.ts";
import { createHash } from "node:crypto";

export const VTI_REF = "26d0da81a1ae2df800ee6b9c1806bb3c3c7a9d2f";

/** The document the VTI admin console signs (VTI-OPS-020), byte for byte as VTI keeps it. Produced by VTI's own console signer, not by this suite. */
export const CONSOLE_FIXTURE_FILE = "vtc-service/tests/fixtures/console-signed-document.json";
export const CONSOLE_FIXTURE_SHA256 = "41c5346d8b82aad5df7e88b94f93c681d8ef6d30fcbcb98ccdfd38993e63bcf9";
export const CONSOLE_FIXTURE: Record<string, unknown> = {
  id: "urn:uuid:3c0c80e7-a128-441e-b1e9-5bac25a4f276",
  type: "https://trusttasks.org/spec/vtc/members/purge/0.1",
  issuer: "did:key:z6Mked52HzhTh2Y46FrcLQEHKmosTvH3cTRVBaTM8VqaCH1M",
  recipient: "did:webvh:QmFixtureScid:community.example:vtc",
  issuedAt: "2026-09-23T10:15:00Z",
  payload: { did: "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG" },
  proof: {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    verificationMethod: "did:key:z6Mked52HzhTh2Y46FrcLQEHKmosTvH3cTRVBaTM8VqaCH1M#z6Mked52HzhTh2Y46FrcLQEHKmosTvH3cTRVBaTM8VqaCH1M",
    created: "2026-09-23T10:14:00Z",
    proofPurpose: "assertionMethod",
    proofValue: "z5ZXbjex4upiDqY7k2fjNgf62mS7QPJzu21nMABTnPqb7hWQqqxGThkvn5aYU6PeFuxguXWZoL3umMytXkYhwmP2s",
  },
};

export type CaseOrigin = "vti-bytes" | "vti-recipe";

export interface ProofCase {
  kind: "proof";
  id: string;
  title: string;
  /** VTI file and test the expectation comes from. */
  source: string;
  /** `vti-bytes`: the bytes are VTI's own. `vti-recipe`: the bytes are built here the way the VTI test builds them (this suite's signer, VTI's spellings), because the VTI signer needs a Rust build. */
  origin: CaseOrigin;
  document: unknown;
  /** What VTI asserts the verifier answers. */
  vtiExpects: "valid" | "invalid";
}

export interface FreshnessCase {
  kind: "freshness";
  id: string;
  title: string;
  source: string;
  origin: "vti-recipe";
  /** Offsets from now in seconds; `null` leaves the member out. */
  issuedAtOffset: number | null;
  expiresAtOffset?: number | null;
  /** What VTI asserts: an error code, or `accepted`. */
  vtiExpects: "malformedRequest" | "accepted";
  /** Spelling note for the report. */
  note?: string;
}

export type CrossCase = ProofCase | FreshnessCase;

const SEED = 0x45;
const CREATED = "2026-09-25T12:37:33.000Z";

/** Sign `doc` as it stands with an eddsa-jcs-2022 proof whose `created` is the given string verbatim (the recipe of received_proof_verify.rs `sign_received`). */
export function signVerbatim(doc: Record<string, unknown>, opts: { created: string; purpose?: string; nonce?: string; seed?: number }): Record<string, unknown> {
  const signer = ed25519Signer(new Uint8Array(32).fill(opts.seed ?? SEED));
  const { proof: _drop, ...body } = doc;
  const config: Record<string, unknown> = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: opts.created,
    verificationMethod: signer.verificationMethod,
    proofPurpose: opts.purpose ?? "assertionMethod",
  };
  if (opts.nonce !== undefined) config.nonce = opts.nonce;
  if (Object.prototype.hasOwnProperty.call(body, "@context")) config["@context"] = body["@context"];
  const sha = (b: Uint8Array): Uint8Array => new Uint8Array(createHash("sha256").update(b).digest());
  const input = new Uint8Array([...sha(jcsBytes(config)), ...sha(jcsBytes(body))]);
  return { ...body, proof: { ...config, proofValue: toMultibase(signer.sign(input)) } };
}

export function holderDid(): string {
  return ed25519Signer(new Uint8Array(32).fill(SEED)).did;
}

/** The document a JavaScript producer sends on a whole second (received_proof_verify.rs `javascript_document`). */
export function javascriptDocument(issuer: string): Record<string, unknown> {
  return {
    id: "urn:uuid:45454545-4545-4545-8545-454545454545",
    type: "https://trusttasks.org/spec/rooms/create/0.2",
    issuer,
    recipient: "did:key:z6MkVta",
    issuedAt: "2026-09-25T12:37:33.000Z",
    threadId: null,
    payload: { roomId: "room-1" },
  };
}

const RECEIVED = "vta-sdk/tests/received_proof_verify.rs";

export function proofCases(): ProofCase[] {
  const did = holderDid();
  const base = (): Record<string, unknown> => javascriptDocument(did);
  const signed = (members: Record<string, unknown> = {}, o: { nonce?: string } = {}): Record<string, unknown> =>
    signVerbatim({ ...base(), ...members }, { created: CREATED, ...o });
  const out: ProofCase[] = [];
  const add = (c: Omit<ProofCase, "kind">): void => void out.push({ kind: "proof", ...c });

  add({ id: "XC-P-001", title: "a document signed by the VTI admin console verifies", source: "vtc-service/tests/it/console_signed_document.rs a_document_signed_by_the_admin_console_verifies (VTI-OPS-020)", origin: "vti-bytes", document: CONSOLE_FIXTURE, vtiExpects: "valid" });
  const tampered = structuredClone(CONSOLE_FIXTURE) as { payload: { did: string } };
  tampered.payload.did = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJH";
  add({ id: "XC-P-002", title: "the console document with its payload edited is refused", source: "vtc-service/tests/it/console_signed_document.rs (tamper check)", origin: "vti-bytes", document: tampered, vtiExpects: "invalid" });
  add({ id: "XC-P-003", title: "a JavaScript producer's whole-second timestamps (.000Z) verify as received", source: `${RECEIVED} vti_45_a_javascript_whole_second_document_verifies_as_received`, origin: "vti-recipe", document: signed(), vtiExpects: "valid" });
  const variants: [string, Record<string, unknown>][] = [
    ["issuedAt written with a +00:00 offset", { issuedAt: "2026-09-25T12:37:33+00:00" }],
    ["issuedAt with a one-digit fraction", { issuedAt: "2026-09-25T12:37:33.5Z" }],
    ["issuedAt with a lowercase z", { issuedAt: "2026-09-25T12:37:33z" }],
    ["expiresAt written .000Z", { expiresAt: "2026-09-25T13:37:33.000Z" }],
    ["optional members present as null", { threadId: null, parentThreadId: null, expiresAt: null, "@context": null, ceremony: null }],
  ];
  variants.forEach(([title, members], i) =>
    add({ id: `XC-P-${String(4 + i).padStart(3, "0")}`, title: `${title} verify as received`, source: `${RECEIVED} vti_45_every_measured_rewrite_verifies_as_received`, origin: "vti-recipe", document: signed(members), vtiExpects: "valid" }),
  );
  add({ id: "XC-P-009", title: "a proof carrying a signed nonce verifies", source: `${RECEIVED} vti_45_a_signed_proof_nonce_verifies_as_received`, origin: "vti-recipe", document: signed({}, { nonce: "n-0451" }), vtiExpects: "valid" });
  const good = signed();
  const edits: [string, (d: Record<string, any>) => void][] = [
    ["the payload edited", (d) => void (d.payload.roomId = "room-2")],
    ["the issuedAt spelling changed (.000Z to Z)", (d) => void (d.issuedAt = "2026-09-25T12:37:33Z")],
    ["a null member removed", (d) => void delete d.threadId],
    ["the proof's created spelling changed", (d) => void (d.proof.created = "2026-09-25T12:37:33Z")],
  ];
  edits.forEach(([title, edit], i) => {
    const d = structuredClone(good) as Record<string, any>;
    edit(d);
    add({ id: `XC-P-${String(10 + i).padStart(3, "0")}`, title: `a correctly signed document with ${title} is refused`, source: `${RECEIVED} vti_45_tampering_is_still_refused`, origin: "vti-recipe", document: d, vtiExpects: "invalid" });
  });
  add({ id: "XC-P-014", title: "a document with no proof is not a verified document", source: `${RECEIVED} vti_45_a_missing_proof_is_no_proof`, origin: "vti-recipe", document: base(), vtiExpects: "invalid" });
  const nullProof = { ...base(), proof: null };
  add({ id: "XC-P-015", title: "a document with proof: null is not a verified document", source: `${RECEIVED} vti_45_a_missing_proof_is_no_proof`, origin: "vti-recipe", document: nullProof, vtiExpects: "invalid" });
  return out;
}

const FRESH = "vta-service/src/trust_tasks/mod.rs mod freshness_bounds";

export function freshnessCases(): FreshnessCase[] {
  return [
    { kind: "freshness", id: "XC-F-001", title: "a document dated a little ahead (30 seconds) is accepted", source: `${FRESH} a_document_inside_the_skew_window_is_accepted`, origin: "vti-recipe", issuedAtOffset: 30, vtiExpects: "accepted" },
    { kind: "freshness", id: "XC-F-002", title: "a document dated 600 seconds ahead is malformedRequest, never expired", source: `${FRESH} a_future_dated_document_is_malformed_not_expired`, origin: "vti-recipe", issuedAtOffset: 600, vtiExpects: "malformedRequest" },
    { kind: "freshness", id: "XC-F-003", title: "an expiry equal to the issue time is malformedRequest", source: `${FRESH} an_expiry_at_or_before_issuance_is_malformed`, origin: "vti-recipe", issuedAtOffset: 0, expiresAtOffset: 0, vtiExpects: "malformedRequest" },
    { kind: "freshness", id: "XC-F-004", title: "an expiry one second before the issue time is malformedRequest", source: `${FRESH} an_expiry_at_or_before_issuance_is_malformed`, origin: "vti-recipe", issuedAtOffset: 0, expiresAtOffset: -1, vtiExpects: "malformedRequest" },
    { kind: "freshness", id: "XC-F-005", title: "a document with no timestamp at all is malformedRequest, never expired", source: `${FRESH} a_document_with_no_timestamps_is_malformed_not_expired`, origin: "vti-recipe", issuedAtOffset: null, vtiExpects: "malformedRequest" },
  ];
}

export function allCases(): CrossCase[] {
  return [...proofCases(), ...freshnessCases()];
}
