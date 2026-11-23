// SPDX-License-Identifier: Apache-2.0
// Checks on the terminal `witness/session/submit#response` of a witnessed session (docs/10 section 4 and the submit specification): the
// response is the outcome evidence a Verifiable Witness Credential cites, so its credential must pair with the session document that
// opened the session. Each check is named so a vector can assert one rule and a failing platform gets one finding per rule.
import { digestMultibase } from "../crypto/digest.ts";
import { isObject } from "../util/json.ts";

export const EVIDENCE_CHECKS = ["taskContext", "taskDigest", "vwcDigest", "issuerIsResponder", "subjectIsOpener", "statementType", "responseSigned", "challengeFresh"] as const;
export type EvidenceCheck = (typeof EVIDENCE_CHECKS)[number];

export const WITNESSED_PREDICATE = "https://registry.trustoverip.org/dtg/vsc/witnessed/1";

/** The task digest of a document (framework 4.9.3): its RFC 8785 digest with any top-level proof removed. */
export function taskDigest(doc: Record<string, unknown>): string {
  const { proof: _proof, ...unsigned } = doc;
  return digestMultibase(unsigned);
}

/**
 * The errors, one per failed check, of `response` (the submit response) against `session` (the request that opened the session, as sent).
 * `peerChallenges` are the challenges of earlier sessions of the same exchange, for `challengeFresh`.
 */
export function evidenceErrors(checks: readonly EvidenceCheck[], response: Record<string, unknown>, session: Record<string, unknown>): string[] {
  const errs: string[] = [];
  const payload = isObject(response.payload) ? response.payload : {};
  const vwc = isObject(payload.vwc) ? payload.vwc : undefined;
  const subject = vwc !== undefined && isObject(vwc.credentialSubject) ? vwc.credentialSubject : {};
  for (const c of checks) {
    switch (c) {
      case "taskContext":
        if (vwc === undefined || vwc.taskContext !== session.id) errs.push(`evidence taskContext: the credential's top-level taskContext is ${JSON.stringify(vwc?.taskContext)}, expected the session document's id ${String(session.id)} (the nested placement ${JSON.stringify((subject as Record<string, unknown>).taskContext)} does not count)`);
        break;
      case "taskDigest":
        if (vwc === undefined || vwc.taskDigestMultibase !== taskDigest(session)) errs.push(`evidence taskDigest: the credential's top-level taskDigestMultibase is ${JSON.stringify(vwc?.taskDigestMultibase)}, expected ${taskDigest(session)} (the task digest of the session document)`);
        break;
      case "vwcDigest":
        if (vwc === undefined || payload.vwcDigestMultibase !== digestMultibase(vwc)) errs.push(`evidence vwcDigest: vwcDigestMultibase ${JSON.stringify(payload.vwcDigestMultibase)} is not the RFC 8785 digest of the delivered credential`);
        break;
      case "issuerIsResponder": {
        const issuer = vwc === undefined ? undefined : isObject(vwc.issuer) ? vwc.issuer.id : vwc.issuer;
        if (issuer !== session.recipient || issuer !== response.issuer) errs.push(`evidence issuerIsResponder: the credential's issuer is ${JSON.stringify(issuer)}, the session's recipient is ${JSON.stringify(session.recipient)} and the response's issuer is ${JSON.stringify(response.issuer)}; they must be the same witness`);
        break;
      }
      case "subjectIsOpener":
        if ((subject as Record<string, unknown>).id !== session.issuer) errs.push(`evidence subjectIsOpener: the credential subject is ${JSON.stringify((subject as Record<string, unknown>).id)}, expected the party that opened the session ${String(session.issuer)}`);
        break;
      case "statementType": {
        const types = vwc !== undefined && Array.isArray(vwc.type) ? vwc.type : [];
        if (!types.includes("StatementCredential") || (subject as Record<string, unknown>).predicate !== WITNESSED_PREDICATE) errs.push(`evidence statementType: the credential must be a StatementCredential under ${WITNESSED_PREDICATE} (type ${JSON.stringify(vwc?.type)}, predicate ${JSON.stringify((subject as Record<string, unknown>).predicate)})`);
        break;
      }
      case "responseSigned":
        if (!isObject(response.proof)) errs.push("evidence responseSigned: the submit response carries no proof (REQUIRED)");
        break;
      case "challengeFresh":
        // asserted by the vector through `notEqual` on the challenge pointers; kept in the list so a vector can name it
        break;
    }
  }
  return errs;
}
