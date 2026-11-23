// SPDX-License-Identifier: Apache-2.0
// The proof purpose a task specification fixes for its own document (used by the runner when it signs and by the reference when it verifies).

/**
 * The proof purpose a task's own specification fixes for the document it defines, where the framework default (`authentication`,
 * SPEC.md 4.7.2: producers SHOULD) is not what the task says. `auth/step-up/approve-response`, every version from 0.1 to 0.7: the
 * proof MUST be made for `assertionMethod` by a key listed under the approver's `assertionMethod` relationship, and 0.7 (consumer
 * step 1a) has the consumer refuse `proofInvalid` a proof made for any other purpose. A document the harness signs for such a task
 * with the default would be refused for its proof, whichever platform receives it. A vector that names a purpose still wins.
 */
const SPECIFIED_PROOF_PURPOSE: Record<string, string> = { "auth/step-up/approve-response": "assertionMethod" };

export function specifiedProofPurpose(type: unknown): string | undefined {
  if (typeof type !== "string") return undefined;
  const m = /^https:\/\/trusttasks\.org\/spec\/(.+)\/\d+\.\d+$/.exec(type);
  return m === null ? undefined : SPECIFIED_PROOF_PURPOSE[m[1]!];
}
