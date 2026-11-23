// SPDX-License-Identifier: Apache-2.0
// The oracle's abstraction of the cast's attestation (docs/32): a PCS attestation is a zero-knowledge proof of a blind ticket; the oracle models it as a keyed digest over the election's class, the ballot's canonical
// bytes and the tag, which only a holder of the election's voting key (the registrar's, shared with the oracle box) can make. This is class D: the cryptography is not modelled, the checks and their order are.
import { createHash, randomBytes } from "node:crypto";
import { ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import { jcsBytes } from "../../util/json.ts";

type Doc = Record<string, unknown>;
export const S = "https://trusttasks.org/spec/";
export const CAST_TYPE = `${S}voting/ballot/cast/0.1`;
export const CAST_VARIANTS = ["ok", "second", "wrongDigest", "badAnswers", "wrongClass", "tamperedBallot", "forgedTicket", "unknownElection", "wrongRecipient"] as const;
export const COMMUNITY = "did:key:z6MkoracleBallotCommunity";
export const manifestOf = (electionId: string) => ({ electionId, questions: [{ key: "chair", type: "choice", options: [{ key: "ana" }, { key: "bo" }], minSelections: 1, maxSelections: 1, optional: false }] });
const h = (...parts: string[]): string => createHash("sha256").update(parts.join("|")).digest("hex");
export const digestOf = (electionId: string): string => `z${h("manifest", electionId).slice(0, 40)}`;
export const votingKey = (electionId: string): string => h("voting-key", electionId);
export const classOf = (electionId: string): string => `voter/${electionId}`;
export const tagOf = (electionId: string, ticket: string): string => `z${h("tag", electionId, ticket).slice(0, 34)}`;
export const attest = (key: string, cls: string, ballot: unknown, tag: string): string => `z${cls}:${h("att", key, cls, Buffer.from(jcsBytes(ballot)).toString("utf8"), tag)}`;
export const stamp = (ms: number): string => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

/** The voter's agent (stand-in for the vta/pcs voter chain): the cast it builds for `variant`, signed by a one-time key, addressed to `box`. */
export function buildCast(box: string, electionId: string, variant: string, thread: string, version = "0.1", ticket = "ticket-1"): Doc {
  const id = variant === "unknownElection" ? "no-such-election" : electionId;
  const answer = variant === "second" ? "bo" : "ana";
  let ballot: Doc = { electionId: id, manifestDigest: variant === "wrongDigest" ? digestOf(`${id}#another-manifest`) : digestOf(id), answers: [{ question: "chair", choice: [answer] }] };
  if (variant === "badAnswers") ballot = { ...ballot, answers: [{ question: "no-such-question", choice: ["ana"] }] };
  const forged = variant === "forgedTicket";
  const cls = variant === "wrongClass" ? classOf("another-election") : classOf(id);
  const tag = tagOf(id, forged ? "forged-ticket" : ticket);
  const att = attest(forged ? h("not-the-key") : votingKey(id), cls, ballot, tag);
  if (variant === "tamperedBallot") ballot = { ...ballot, answers: [{ question: "chair", choice: ["bo"] }] };
  const key = ed25519Signer(new Uint8Array(randomBytes(32)));
  const now = Date.now();
  return signDocument({ id: `urn:uuid:${crypto.randomUUID()}`, type: `${S}voting/ballot/cast/${version}`, threadId: thread, issuer: key.did, recipient: variant === "wrongRecipient" ? "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" : box, issuedAt: stamp(now), payload: { community: COMMUNITY, electionId: id, cast: { ballot, tag, attestation: att } } }, key, { created: now, purpose: "assertionMethod" }) as unknown as Doc;
}
