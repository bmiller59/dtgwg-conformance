// SPDX-License-Identifier: Apache-2.0
// Behavioural rules of coverage family CS (docs/22, phase 4). Only refusals the Trust Tasks text states, reachable from one document.
import { ACTOR, memberValueRule, retire, unknownIdRule, type BehaviourRule, type J } from "./types.ts";

const F = "CS";
const q = (slug: string, version: string, words: string): string => `specs/${slug}/${version}/spec.md: "${words}"`;
const unknown = (slug: string, version: string, member: string, code: string, words: string): BehaviourRule =>
  unknownIdRule({ family: F, slug, version, member, code: `${slug}:${code}`, quote: [q(slug, version, words)] });

const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

/** A consent subject whose agent names nothing the VTA recognises (the rest of the subject is the valid one). */
const unknownAgent = (slug: string, code: string, words: string): BehaviourRule => {
  const agent = "did:web:conformance-unknown.example";
  const withAgent = (p: J): J | undefined => (isObj(p["subject"]) ? { ...p, subject: { ...p["subject"], agent } } : undefined);
  return {
    key: `${slug}/1.0:${slug}:${code}`, family: F, slug, version: "1.0",
    title: `${slug} 1.0: a subject naming an agent that is not recognised is refused with ${code}`, quote: [q(slug, "1.0", words)], codes: [`${slug}:${code}`],
    trigger: (t) => (isObj(t.validPayload) ? withAgent(t.validPayload) : undefined),
    refuses: (p, t) => isObj(p) && isObj(p["subject"]) && isObj(t.validPayload) && isObj(t.validPayload["subject"]) && p["subject"]["agent"] !== t.validPayload["subject"]["agent"],
  };
};

const CHALLENGE = "The relying party has no pending step-up matching the echoed challenge.";

export const RULES: BehaviourRule[] = [
  // 0.7 item 1a: the proof's signer must be the subject, checked before the pending step-up is looked up, so the document is issued by the subject
  ...["0.2", "0.5", "0.6", "0.7"].map((v) => unknownIdRule({ family: F, slug: "auth/step-up/approve-response", version: v, member: "challenge", code: "auth/step-up/approve-response:challengeUnknown", quote: [q("auth/step-up/approve-response", v, CHALLENGE)], extra: { subject: ACTOR } })),
  unknown("auth/step-up/approver/redeem/finish", "0.1", "enrollmentId", "enrollmentNotFound", "`enrollmentId` names no open ceremony"),
  unknown("auth/step-up/approver/redeem/start", "0.1", "token", "inviteNotFound", "The token names no invite this relying party holds"),
  retire(memberValueRule({
    family: F, slug: "auth/step-up/approver/enroll", version: "0.1", member: "replaces", value: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doL", code: "auth/step-up/approver/enroll:replaceNotFound",
    quote: [q("auth/step-up/approver/enroll", "0.1", "`replaces` names no live approver of this subject.")],
  }), "the text refuses noFactorHeld when the subject holds no step-up factor and decides replaceNotFound only after accepting authority evidence over the enrolment terms (consumer items 2, 3 and 6), so the code needs a subject that holds a factor: prior state"),
  unknown("auth/step-up/approver/invite", "0.2", "subject", "subjectUnknown", "The relying party does not recognise the subject"),
  retire(memberValueRule({
    family: F, slug: "auth/step-up/approver/invite", version: "0.2", member: "ttlSeconds", value: 86401, code: "auth/step-up/approver/invite:ttlTooLong",
    quote: [q("auth/step-up/approver/invite", "0.2", "Refuse with `ttlTooLong` a `ttlSeconds` above 86 400 seconds (24 hours)")],
  }), "the consumer list puts subjectUnknown (item 2) and the authorisation of the administrator for the subject (item 3) before ttlTooLong (item 4), so the code needs a subject the relying party holds standing for: prior state"),
  unknown("consent/decision", "1.0", "challenge", "challengeMismatch", "The echoed challenge does not match any pending consent request for the subject."),
  unknownAgent("consent/decision", "subjectInvalid", "The subject is malformed or unknown."),
  unknownAgent("consent/request", "subjectInvalid", "names an agent the VTA does not recognise"),
];
