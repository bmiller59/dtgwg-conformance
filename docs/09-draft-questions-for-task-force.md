# Draft questions and scope note (NOT SENT)

> **Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.

**Status: NOT SENT.** These are unsent drafts. Nothing here has been posted or sent to anyone. Sending needs a named contact and a named channel, which have not been chosen. The text is neutral and may be edited before use.

## Draft 1: should the `vrc/relationships/issue` receipt be outcome evidence?

**To:** Trust Tasks task force (contact and channel to be named).

**Background.** The `vrc/relationships/issue` 0.1 specification defines a receipt, the `#response`, whose `vrcDigestMultibase` is computed by the receiving party over the credential as stored. Its `proofRequirement` marks the response proof OPTIONAL, and the specification does not declare outcome evidence under framework SPEC.md section 7.3 item 20. Under sections 4.9.3 and 4.9.4, an exchange whose specification declares nothing cannot be cited as evidence that it completed. A conformance suite that checks this ceremony can currently assert only the receipt's digest and the receiving party's observable stored state.

**Question.** Should the issue receipt be declared the exchange's outcome evidence, that is, a signed response with `issuedAt` and `proof` required, bound to the initiating document by its `id` and task digest, with the initiating document carrying `recipient`? Or is the receipt intended to remain an unsigned-by-default acknowledgement consumed inside the exchange?

**Why it matters.** If it is outcome evidence, a relying party can show that the credential was received and stored without access to the receiving party's storage, and conformance vectors can assert it as a framework rule. If it is not, vectors will keep treating the receipt as a digest plus observable state.

**What we would do with the answer.** Update the issue vectors accordingly, and, if the answer is yes, propose the declaration as a change to the specification.

## Draft 2: should the reference proof verifier accept a key resolver?

**To:** Trust Tasks task force (contact and channel to be named).

**Background.** The registry's reference proof verifier supports `did:key` and rejects a document whose `issuer` is not the signer's `did:key`. Implementations in the ecosystem identify parties with other DID methods (for example `did:peer:4`, resolvable from the identifier itself, and log-based methods that need a resolver). A conformance suite and implementations that adopt the registry runtime each have to wrap or replace the verifier to check proofs under those methods.

**Question.** Would the task force accept a change to the reference proof verifier that takes a key resolver (a function from verification-method identifier and verification relationship to a public key), so that other DID methods can be verified by the same code path while `did:key` remains the default? If not, is the intended approach for implementations to supply their own verifier behind the consumer pipeline's existing interface?

**Why it matters.** It decides whether the shared proof fixtures can be exercised unchanged against non-`did:key` identifiers, and whether implementations share verification code or each re-implement it.

**What we would do with the answer.** Either contribute the change or keep a documented local wrapper in the conformance suite's reference adapter.

## Draft 3: scope note for the credential-specification editors (3b-DTG)

**To:** Editors of the DTG credential specification (contact and channel to be named).

**Background.** The credential specification refers to a planned "DTG Core Trust Task Protocols" document. It does not yet exist. Meanwhile, a conformance effort that organises trust tasks in layers needs to know which tasks belong to a DTG-level core. The framework's reserved slugs (`trust-task-*`, `trust-ceremony-*`) are neutral and framework-level; the tasks below are credential- or approver-specific, so they cannot be framework-reserved, yet are shared by several ceremonies and implementations.

**Proposed scope (a proposal, not a published list).** A tier above the framework core, referencing registry slugs by `slug@version` and carrying its own versioning, using no reserved namespace:

| Slug | Version in the registry snapshot read |
|---|---|
| `credential-exchange/offer` | 0.1 |
| `credential-exchange/request` | 0.1 |
| `credential-exchange/issue` | 0.1 |
| `credential-exchange/present` | 0.1 |
| `task-consent/request` | 0.1 |
| `task-consent/decision` | 0.1 and 0.2 |

Left at family level: `auth/step-up/*`, `credential-exchange/query` and `credential-exchange/pending/*`. `confirm/*` is retired in favour of `task-consent/*`. The credential specification lists a revocation verb for which no registry slug exists; it is a gap rather than a member.

**Questions.**
1. Is this the intended scope for the planned protocols document, or should the list differ?
2. Should `task-consent/*` be in the list, or remain at family level with a DTG tag?
3. Is a revocation verb planned, and under which slug?
4. Should a breaking change to a listed slug require a MAJOR version of the protocols document?

**Offer.** Conformance vectors for the listed slugs would be informative (non-gating) until the protocols document exists.
