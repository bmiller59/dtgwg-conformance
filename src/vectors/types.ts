// SPDX-License-Identifier: Apache-2.0
// Vector format `tt-conformance-vectors/0.1` (proposed; see docs/04-suite-design.md section 3).

import type { VectorSource } from "./source.ts";

export const FORMAT = "tt-conformance-vectors/0.1";

export const DISPOSITIONS = ["response", "error", "next-step", "silence", "duplicate", "any-refusal", "answered", "emitted"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const MUTATION_OPS = ["set", "remove", "reorder", "bom", "truncate"] as const;
export type MutationOp = (typeof MUTATION_OPS)[number];

export type Tier = 1 | 2;

/**
 * Sub-groups of Tier 2 (docs/04 section 3.1). Tier 1 is the framework MUSTs and nothing stricter; everything else is named here so that
 * Tier 2 does not blur:
 * - `attested`: stricter-than-specification behaviour of the attested profile (proof on everything, closed payloads, signed replies, the
 *   HTTP status table, ...). Needs an implementation that claims Tier 2.
 * - `profile-window`: fixture rows that pin the 5 minute / 60 second / 30 day window, which the framework text does not state.
 * - `profile-ceremony`: the suite's own ceremony and two-phase design (docs/04 sections 11.4 and 12), not specification text.
 * - `profile-witness-share`: the suite-local witness-share profile specification (docs/10).
 * - `profile-p384`: P-384 proofs, behind a separate cryptosuite capability.
 * A `profile-*` sub-group is selected by running Tier 2 and is measured against every implementation that has the capabilities it
 * needs, whether or not that implementation claims `attested`.
 */
export const SUBGROUPS = ["attested", "profile-window", "profile-ceremony", "profile-witness-share", "profile-p384"] as const;
export type Subgroup = (typeof SUBGROUPS)[number];

export interface Mutation {
  op: MutationOp;
  /** JSON pointer, for set / remove. */
  path?: string;
  value?: unknown;
  /** Truncate: number of trailing bytes to cut. */
  bytes?: number;
  /** Apply after signing (tampering) instead of before. Default false. */
  afterSign?: boolean;
}

export interface SignSpec {
  /** Harness actor holding the key. Default: the actor named by `issuer` of the document, else A. */
  as?: string;
  purpose?: string;
  /** Offset from the step's clock, e.g. "+0s", "-30s". Default "+0s". */
  created?: string;
  /** Sign even though the issuer member names another party (controller-mismatch vectors). */
  allowIssuerMismatch?: boolean;
}

/** Builds the signed VRC carried in an `issue` request's payload (and its digest). */
export interface VrcSpec {
  /** Name under which the digest is kept for `$digest(name)`. Default "vrc". */
  name?: string;
  /** Actor or token naming the credential issuer. Default `$R`. */
  issuer?: string;
  /** Credential subject. Default `$cap(ibr)` (the relationship DID the IUT returned). */
  subject?: string;
  /** Actor whose key signs the inner proof. Default: the actor whose DID is the issuer. */
  signer?: string;
  /** Inner proof purpose. Default assertionMethod. */
  purpose?: string;
  /** Content discriminator, so two credentials of one exchange differ. */
  nonce?: string;
  /** Flip a bit of the inner proof value after signing. */
  corrupt?: boolean;
  /** Sign although the signer's DID is not the credential issuer. */
  allowIssuerMismatch?: boolean;
  /** `none`: leave vrcDigestMultibase out; `wrong`: a digest of something else. Default: the true digest. */
  digest?: "none" | "wrong";
}

/**
 * Builds the witness-share bundle of a `vrc/relationships/witness-share` request payload: a presentation (VP) wrapping the
 * sender's witnessed credential (VWC) and the outcome-evidence pair (initiating `witness/session`, terminal
 * `witness/session/submit#response`). Every member is a deviation from the conforming default.
 */
export interface WitnessSpec {
  /** Harness actor that is the sender's relationship identity (holder, initiating issuer, VWC subject). Default `R`. */
  sender?: string;
  /** Name of the captured value holding the receiver's relationship DID for this exchange. Default `ibr`. */
  mineCapture?: string;
  /** Name under which the VWC digest is kept for `$digest(name)`. Default "vwc". */
  name?: string;
  /** VP proof `challenge`. Default: the share's thread id. */
  challenge?: string;
  /** VP proof `domain`. Default `vrc:witness-share`. */
  domain?: string;
  /** Actor whose key signs the VP. Default `R` (the sender's relationship DID). */
  vpSigner?: string;
  /** VWC credential subject. Default `$R`. */
  subject?: string;
  /** `subject`: parties inside the credential subject instead of the session document; an array replaces the list. */
  parties?: "subject" | string[];
  /** Actor whose key signs the VWC (the witness). Default `W`. */
  vwcSigner?: string;
  /** Flip a bit of the VWC proof value after signing. */
  corruptVwc?: boolean;
  /** VWC `taskContext`. Default: the initiating document's id. */
  taskContext?: string;
  /** Citation digest: `wrong`, `u` (base64url spelling), `sha512` (a multihash the verifier does not implement), `none`. */
  digest?: "wrong" | "u" | "sha512" | "none";
  /** Change the initiating document after the citation was computed. */
  alterInitiating?: boolean;
  /** Initiating document carries a proof (default true); `resigned`: signed again after the citation (different proof, same content). */
  initiating?: "signed" | "unsigned" | "resigned";
  /** Put a proof inside the initiating payload (embedded artifact), which the task digest must keep. */
  nestedProof?: boolean;
  /** Terminal thread id (default: the initiating document's thread). */
  terminalThread?: string;
  /** `error`: a trust-task-error; `session`: the session's own type as a response; or a Type URI. */
  terminalType?: "error" | "session" | string;
  /** Actor that issues and signs the terminal. Default `W`. */
  terminalSigner?: string;
  /** `none`: the terminal carries no proof. */
  terminalProof?: "none";
}

/**
 * Builds the credential of a `credential-exchange/issue` request (`/payload/credential_response/credential`, a W3C Data-Integrity VC) and
 * of a presentation's carried credential. Every member is a deviation from the conforming default.
 */
export interface CredentialSpec {
  /** Credential issuer: actor or token. Default `$A` (the sender of the delivery). */
  issuer?: string;
  /** Credential subject (the holder). Default `$iut`. */
  subject?: string;
  /** Actor whose key signs the credential. Default: the actor whose DID is the issuer. */
  signer?: string;
  /** Inner proof purpose. Default assertionMethod. */
  purpose?: string;
  /** Content discriminator, so two credentials differ. */
  nonce?: string;
  /** Flip a bit of the proof value after signing. */
  corrupt?: boolean;
}

/**
 * Builds the `vp_token` of a `credential-exchange/present` request: a W3C Data-Integrity presentation (VP) wrapping one credential. The
 * proof carries the verifier's nonce as `challenge` and the audience as `domain` (docs/04 section 11.5).
 */
export interface PresentationSpec {
  /** Presenting holder: actor. Default `A` (the sender, the credential's subject). */
  holder?: string;
  /** Proof `challenge`: a token, normally `$cap(presNonce)`. Default `$cap(presNonce)`. */
  nonce?: string;
  /** Proof `domain`. Default `$iut` (the verifier). */
  audience?: string;
  /** Actor whose key signs the VP. Default: the holder. */
  signer?: string;
  /** VP proof purpose. Default authentication. */
  purpose?: string;
  /** The carried credential. Default: issued by `X`, about the holder. */
  credential?: CredentialSpec;
  /**
   * present 0.2 (keyed, OpenID4VP 1.0 section 8.1): wrap the presentation as `{ <key>: [presentation] }`; the key is a token, normally
   * `$cap(presQuery)`. Absent: the bare presentation (the 0.1 shape, and the 0.2 compatibility string).
   */
  keyed?: string;
  /** `sd-jwt`: an SD-JWT-VC presentation string (key-binding JWT `nonce` and `aud`) instead of a Data Integrity VP. Default `di`. */
  format?: "di" | "sd-jwt";
  /**
   * Data Integrity placement of the nonce and of the audience (present 0.2): the proof's `challenge` /
   * `domain` (`proof`, the default), the presentation's own signed `nonce` / `domain` (`presentation`), both, or neither.
   */
  nonceAt?: "proof" | "presentation" | "both" | "neither";
  audienceAt?: "proof" | "presentation" | "both" | "neither";
  /** The presentation's own `nonce` / `domain` where it differs from the proof's (a disagreement). Default: the same value. */
  presentationNonce?: string;
  presentationAudience?: string;
}

/** The HTTP request line of a send on the HTTPS binding (see `HttpRequestLine`); `{}` is the default `POST /trust-tasks`. */
export interface HttpSpec {
  method?: string;
  path?: string;
  contentType?: string;
}

/** The ceremony definitions the receipt vectors enact (src/runner/receipt.ts): `linear` (apply, optional review, terminal decide), `approve` (perRole approvals with a threshold), `prefix` (a terminal step the completion rule does not need). */
export type ReceiptFixture = "linear" | "approve" | "prefix";

/** Builds the receipt document of a `verifyReceipt` step. Every member is a deviation from the conforming default. */
export interface ReceiptDocSpec {
  /** Harness actor named as `issuer` (the recorder). Default `W`. */
  issuer?: string;
  /** Actor whose key signs although it is not the issuer. */
  signer?: string;
  /** `null`: the receipt carries no proof. */
  sign?: null;
  /** Flip a bit of the proof value after signing. */
  corrupt?: boolean;
  /** The recorder's `complete` determination. Default true. */
  complete?: boolean;
  /** `omit`: leave `salt` out of the payload; `wrong`: carry a salt other than the one the digests used. */
  salt?: "omit" | "wrong";
  /** `declared`: echo `terminal: true` on every step the definition declares terminal; default: echo what the step document carries. */
  echo?: "declared";
  /** Type URI of the receipt document. Default `https://trusttasks.org/spec/trust-ceremony-receipt/0.1`. */
  type?: string;
  /** Use a payload from an imported file instead of the built one: `{file, index}` of a list of `{note, payload}` rows under the fixture root. */
  payloadFrom?: { file: string; index: number };
  /** Edits to the receipt document (JSON pointers), before signing unless `afterSign`. `$`-tokens are substituted. */
  mutate?: Mutation[];
  /** Offset of the receipt proof's `created` from the step's clock, e.g. "+1s": same content, a different proof. */
  created?: string;
}

/**
 * A `verifyReceipt` scenario: an enactment of a fixture ceremony, the receipt a recorder issued for it, and what the verifier holds
 * (the definition, the role bindings, some of the step documents). Instances are named `step`, `step@Actor`, `step#round` or
 * `step@Actor#round`.
 */
export interface ReceiptSpec {
  /** Fixture ceremony. Default `linear`. */
  ceremony?: ReceiptFixture;
  /** Step instances that happened, in causal order. Default: every step of the fixture (`linear`: apply, review, decide; `approve`: propose, approve@X, approve@S; `prefix`: open, middle, end). */
  instances?: string[];
  /** Instances the receipt enumerates, in the receipt's order. Default: all instances. */
  enumerate?: string[];
  /** Instances whose documents the verifier holds. Default `all`. */
  hold?: "all" | "none" | string[];
  /** Role bindings the verifier has: `full` (default), `none` (not available), or role name to actors, laid over the full set. */
  bindings?: "full" | "none" | Record<string, string[]>;
  /** The definition the verifier resolves: the pinned one (default), none (`unresolvable`) or one with another completion rule (`altered`). */
  definition?: "resolved" | "unresolvable" | "altered";
  /** Digest computation used for every digest of the enactment (the receipt's and the step documents' `prev`); default the specified one. */
  digest?: { hash?: "sha2-256" | "sha2-512"; saltAt?: "suffix" | "prefix"; withoutProof?: boolean };
  /** Edits to a step document as issued (JSON pointers into the document), before it is signed and digested. */
  docMutate?: Record<string, Mutation[]>;
  /** An instance issued without a proof, or with a corrupted one. */
  docProof?: Record<string, "none" | "corrupt">;
  /** Edits to the held copy of a step document only, after the receipt digested the original. */
  heldMutate?: Record<string, Mutation[]>;
  /** Held copies signed again by their issuer after `heldMutate`, with a proof that differs from the original's (same content when nothing was mutated). */
  heldResign?: string[];
  /** `other`: the documents the verifier holds are those of a second enactment of the same ceremony, not the one the receipt reports on. */
  heldEnactment?: "other";
  receipt?: ReceiptDocSpec;
}

export type ReceiptOutcomeName = "complete" | "incomplete" | "unverifiable" | "invalid";

export type FromSpec = string | { spoof: string };

/** Ceremony steps relative to the declared essential governance (Step.quorum; `src/runner/essential.ts`). */
export const QUORUM_PATTERNS = ["begin", "rest", "complete", "pending", "exact", "outsider", "repeat"] as const;
export type QuorumPattern = (typeof QUORUM_PATTERNS)[number];

export interface SendSpec {
  from?: FromSpec;
  /** Built-in template name: carrier.request | error.inbound | control.cancel. */
  template?: string;
  /** Shallow overrides of the template's top-level members. `$`-tokens are substituted. */
  params?: Record<string, unknown>;
  /** A literal document (object). */
  document?: unknown;
  /** Literal JSON text sent byte for byte (after `substitute`). */
  raw?: string;
  /** Text replacements applied to `raw`; values may be `$`-tokens. */
  substitute?: Record<string, string>;
  /** Re-send the previous step's bytes, then apply `mutate`. */
  same?: "previous";
  mutate?: Mutation[];
  /** Fill `/payload/vrc` and `/payload/vrcDigestMultibase` with a built credential. */
  vrc?: VrcSpec;
  /** Fill `/payload/presentation` and `/payload/outcomeEvidence` with a built witness-share bundle. */
  witness?: WitnessSpec;
  /** Fill `/payload/credential_response` with `{credential}` (a built W3C credential). */
  credential?: CredentialSpec;
  /** Fill `/payload/vp_token` with a built presentation. */
  presentation?: PresentationSpec;
  /** `null` sends unsigned. Default: sign as the issuer actor with purpose authentication. */
  sign?: SignSpec | null;
  /** Send on the HTTPS binding (only passed to adapters that declare it; vectors that need it `require` `binding:https`). */
  http?: HttpSpec;
}

export interface Expect {
  /**
   * `answered` (plain-task family, docs/04 section 11.7): the request was valid, so it is not refused for an envelope, policy or
   * payload reason and any answer conforms to the task's own specification. Needs `plainType`.
   */
  disposition: Disposition;
  /**
   * `emitted` (producer class, docs/04 section 11.8): the step's `emit` produced a document of `plainType` that conforms to the task's
   * payload schema and declared policy.
   */
  /** With disposition `answered` or `emitted`: the Type URI (request, or `#response`) whose payload schema, response schema and policy (from the pinned `@openvtc/trust-tasks`) the document is checked against. */
  plainType?: string;
  /** With disposition `answered`: assert success. The one reply is the task's own `#response` and validates against the pinned response schema (see `answeredErrors`). Absent or false: the weak form (any non-envelope answer). */
  success?: boolean;
  /** With disposition `answered`: envelope codes the task's own specification requires or permits at the payload level (idConflict, proofInvalid, unsupportedType); each is accepted and noted rather than failed. */
  acceptCodes?: string[];
  /** With disposition `answered`: Type URIs (`slug/version`, or the full URI) of documents the task's specification has follow the answer on the same delivery (an event stream); they are noted, not counted as a second answer. */
  followOn?: string[];
  /** Reply type; `$carrierResponse` is the carrier's response type. */
  type?: string;
  code?: string | string[];
  retryable?: boolean;
  /** JSON pointer assertions on the reply (or on the reply of the previous response for duplicates). */
  pointer?: Record<string, unknown>;
  noSideEffect?: boolean;
  /**
   * With disposition `next-step`, the hold rule of framework 8.6: the reply is in the request's thread, `inResponseTo` names the
   * request, and where `expects` names the request's own Type URI the continuation is `resubmit`. Where `expects` names only other
   * types (a status task) the continuation is not asserted: neither SPEC.md 8.6 nor the next-step specification states a value.
   */
  hold?: boolean;
  /**
   * With disposition `response`, also accept a held answer: a `trust-task-next-step` that meets the hold rule above (the framework's own
   * form for a held task) in place of the response. The reply `type` and `pointer` assertions then do not apply, since they describe the response.
   */
  orHold?: boolean;
  /** Pointer -> regular expression the reply value must match. */
  match?: Record<string, string>;
  /** Pointer -> values the reply value must not equal. */
  notEqual?: Record<string, unknown[]>;
  state?: {
    handled?: number;
    stored?: number;
    /** Witnessed credentials stored (observe stored, kind vwc). */
    storedVwc?: number;
    /** Credentials stored by `credential-exchange/issue` (observe stored, kind credential). */
    storedCredential?: number;
    /** Queries deferred for the holder's decision (observe stored, kind deferral; optional `observe.deferred`). */
    deferred?: number;
    /** Presentations stored by `credential-exchange/present` (observe stored, kind presentation). */
    storedPresentation?: number;
    /** Count of stored witnessed credentials whose digest is this value (read back from the store). */
    storedVwcDigest?: { digest: string; count: number };
    documentState?: Record<string, string>;
    /** Effects of committed ceremonies (observe stored, kind ceremony-effect). */
    effects?: number;
    /** Verbatim retention (optional `observe.retained`): the request with this id equals the bytes sent at `request` (1-based step), the reply equals the first reply of step `reply`. */
    retained?: { id: string; request?: number; reply?: number };
  };
  /**
   * With disposition `response`, also accept a task-specific refusal (an error with one of these codes) in place of the response: the
   * framework only says a duplicate creation SHOULD be refused (SPEC.md 7.2 item 1 / "creating something"). The reply `type` and
   * `pointer` assertions then do not apply; `state` still does.
   */
  orRefusal?: string[];
  /** HTTP status of the answer; asserted only for adapters that declare the `https` binding (bindings/https/0.3 section 4). */
  httpStatus?: number | number[];
  /** Same check for a status the HTTPS binding only SHOULD map (bindings/https/0.3 section 4, spec.md:137): a mismatch is an advisory at Tier 1 and a failure under `attested`. */
  httpStatusShould?: number | number[];
  /** `json`: a reply document is carried with `Content-Type: application/json`; `none`: the answer carries no body and no Content-Type. HTTPS binding only. */
  httpBody?: "json" | "none";
  /** Discovery response check: the supported types equal the declared types whose slug matches these patterns (the harness's own matcher; `[]` means `*`). */
  discovery?: { matches: string[]; sorted?: boolean };
  /**
   * Witness outcome evidence (src/runner/witness-evidence.ts): the first reply is a `witness/session/submit` response; each named check
   * is made against the request of step `session` (1-based) that opened the session.
   */
  evidence?: { session: number; checks: string[] };
  /** Strings that must not appear anywhere in the reply (an internal fact that must not leak). */
  forbidInReply?: string[];
  /** The first reply was never delivered to the harness: a duplicate may be silent or carry the retained response, but never an error. */
  priorReplyLost?: boolean;
  /** `error` only: `"should"` when the specification makes returning an error reply only a SHOULD or MAY (SPEC.md 7.2 closing paragraph, section 8). A missing reply is then an advisory; a reply that is sent is still checked for type and code. */
  errorReply?: "should";
  /** `silence` only: `"allowed"` also accepts the courtesy acknowledgement of a fire-and-forget task, the originating type with `#response` and exactly `{}` as payload (SPEC.md 4.4.2); anything else fails. */
  acknowledgement?: "allowed";
  /** The error reply must equal the error reply of this earlier step (1-based) in code, retryable, message and details. */
  sameErrorAs?: number;
}

/**
 * Pushed-document observation (optional capability `observe.pushed`, docs/20). The step asks the adapter which documents the implementation
 * sent on its own initiative and checks that one of type `type` went to `to` on thread `threadId`. `$`-tokens are substituted. The pushed
 * document must also be issued by the implementation. With `none` the expectation is negative: no pushed document matches the filter.
 */
export interface ObservePushedSpec {
  /** Recipient: an actor token such as `$A`. */
  to?: string;
  /** Exact Type URI of the pushed document. */
  type?: string;
  /** Thread the pushed document must be on, for example `$id(off)`. */
  threadId?: string;
  /** Negative form: no document matches the filter (after waiting `withinMs`, so a late push is still caught). */
  none?: boolean;
  /** Exactly this many matching documents (default: at least one). Not with `none`. */
  count?: number;
  /** JSON pointer -> expected value on the matching document (at least one matching document must satisfy all of them). */
  pointer?: Record<string, unknown>;
  /** JSON pointer -> regular expression the value must match, same rule as `pointer`. */
  match?: Record<string, string>;
  /** Bounded wait: poll for up to this many real milliseconds until the expectation holds (positive) or has stayed true for the whole period (`none`). Default 0: one observation. At most 60000. */
  withinMs?: number;
}

export interface Step {
  /** Clock offset from `clock.start`, e.g. "+0s". Default: the previous step's offset. */
  at?: string;
  /** Absolute clock instant (overrides `at`). */
  atAbsolute?: string;
  send?: SendSpec;
  /** Producer class (optional capability `emit`): ask the implementation to emit the document of `type` through its own builders; `args` may carry `recipient` (a `$`-token). Needs an `expect` with disposition `emitted`. */
  emit?: { type: string; args?: Record<string, unknown> };
  /** Pushed-document observation (optional capability `observe.pushed`): no send; observes what the implementation pushed earlier or is pushing now. */
  observePushed?: ObservePushedSpec;
  /** Harness-driven action of the IUT's human or operator (`policy`, `consent`); needs optional `trigger.consent`. */
  trigger?: { action: string; args?: Record<string, unknown> };
  /** Name -> JSON pointer into the first reply; the value is available later as `$cap(name)`. */
  capture?: Record<string, string>;
  /**
   * Run this step only when the implementation's declared `ceremony.proposerApproves` has this value; otherwise the step is skipped
   * (its position is kept, so `sameErrorAs` and `capture` numbering do not shift). Used to send the proposer's approval where a
   * begin does not count as one.
   */
  when?: { proposerApproves: boolean };
  /**
   * Ceremony steps relative to the declared essential governance E (docs/04 section 11.4, decision 39), expanded by the runner into
   * concrete sends from the authority set: `begin` (a begin that must be held), `rest` (the remaining distinct approvals up to the
   * k-th), `complete` (begin then rest), `pending` (the begin and every approval before the k-th, each held; member `EK` decides next), and the per-declared-E patterns `exact`, `outsider`, `repeat`. A step with `quorum` has no
   * other member. See `src/runner/essential.ts`.
   */
  quorum?: QuorumPattern;
  /** Helper-layer step: verify a proof fixture file through `verifyProof`. */
  verifyProof?: { file: string; expect: "valid" | "invalid" };
  /** Helper-layer step (optional capability `receiptVerify`): build the scenario and ask `verifyReceipt` for its verdict; `expect.outcome` names the accepted verdicts. */
  verifyReceipt?: { scenario: ReceiptSpec; expect: { outcome: ReceiptOutcomeName | ReceiptOutcomeName[] } };
  /** Restart the IUT (optional capability `restart`); durable records must survive. */
  restart?: boolean;
  expect?: Expect;
}

export interface Provenance {
  source: string;
  fixture: string;
  row?: string;
}

export interface Vector {
  id: string;
  title: string;
  tier: Tier;
  /** Required for every Tier 2 vector, absent on Tier 1 vectors (see `SUBGROUPS`). */
  subgroup?: Subgroup;
  /** Run only when the selected tier equals `tier` (the vector is incompatible with stricter profiles). */
  exactTier?: boolean;
  spec: string[];
  /** Required in every vector file (the validator enforces it; generators attach it at write time). Where the rule comes from, how mature, and the digest it was derived from (docs/04 section 18). */
  source?: VectorSource;
  /** Excluded from every run (never run, counted or reported as SKIP): `reason` says why, for example that the cited TF spec is retired. */
  excludedFromRun?: { reason: string; note?: string };
  /**
   * The id is retired (docs/04 section 20.3): the vector stays in its file as a tombstone, is never run, counted or reported as SKIP,
   * and its id is never reused. `since` is the suite version that retired it; `replacedBy` names a successor id, if any.
   */
  retired?: { reason: string; since: string; replacedBy?: string };
  /** The vector's carrier task type is a suite stand-in (`conformance/*`, not a Trust Tasks task): the vector is kept, but reports do not count it as a tested task. */
  synthetic?: true;
  /**
   * A suite instrument, not platform behaviour (docs/04 section 18.1): counted as `probe`, apart from the candidates, wherever channel
   * counts are shown. Only `true`, and only on a `candidate` vector. The governance probes (vectors/governance, docs/17) carry it.
   */
  probe?: true;
  /** Non-null: depends on an unsettled specification point; reported as CLARIFY, never gating. */
  clarify: string | null;
  /** CLARIFY vectors only (docs/04 section 18.10): why it is CLARIFY. Copied from vectors-src/clarify-classes.json by the generators. */
  clarifyClass?: "spec-silent" | "spec-inconsistent" | "vector-overreads" | "unclassified";
  /** CLARIFY vectors only: when it became CLARIFY (YYYY-MM-DD of the first commit, or a suite version). */
  clarifySince?: string;
  /** CLARIFY vectors only: drafted task-force question ids (tfq:Q<n>, d09:<n>); empty until one is drafted. */
  clarifyQuestions?: string[];
  requires?: string[];
  /**
   * What the task the vector exercises does to a deployment, derived from the task's `sideEffects.level` (`none` is `read-only`). The
   * runner skips a `mutating` or `destructive` vector unless the run names a disposable deployment (`--allow-effects <name>` or
   * CONFORMANCE_DISPOSABLE_DEPLOYMENT); the outcome is SKIPPED-SAFETY, neither pass nor fail.
   */
  effect?: "destructive" | "mutating" | "read-only";
  /**
   * What a positive `answered` vector asserts: `asserted` (the task's own `#response`, validated against the response schema) or `weak`
   * (a non-envelope answer of any kind: the task defines no checkable success response, or authorisation or state decides it). The
   * completeness measure reports the two apart and never counts a weak vector as asserted success.
   */
  strength?: "asserted" | "weak";
  /** Optional capabilities whose presence makes the vector not applicable (SKIP). */
  skipIfOptional?: string[];
  /** Mutants (src/adapters/reference/mutants.ts) that violate the rule; each must fail this vector. */
  mutants?: string[];
  /**
   * Mutants that violate a SHOULD the vector observes: the vector must record an advisory for each (docs/04 section 3.2), and need not
   * fail. At Tier 2 on an attested implementation the same mismatch is a failure.
   */
  advisoryMutants?: string[];
  /** The vector's clock starts here instead of the file's `clock.start`. */
  clockStart?: string;
  /**
   * The vector's assertions need exact or millisecond-boundary clock control (a timestamp within seconds of a window edge). An
   * implementation whose clock the harness cannot set reports it SKIP, never PASS (docs/04 section 7).
   */
  exactClock?: boolean;
  /**
   * The vector is a fixture row with absolute timestamps that pin the profile window (5 minutes maximum age, 60 s skew, 30 day
   * horizon). It runs only where the effective window equals the profile window; otherwise it is SKIP and the matrix reports the
   * window difference (docs/04 section 6).
   */
  profileWindow?: boolean;
  origin?: Provenance;
  steps: Step[];
}

export interface VectorFile {
  format: typeof FORMAT;
  group: string;
  family: string;
  clock: { start: string };
  vectors: Vector[];
}

export interface Manifest {
  format: "tt-conformance-manifest/0.1";
  files: string[];
}

export interface ExceptionEntry {
  impl: string;
  vector: string;
  reason: string;
  owner: string;
  /** YYYY-MM-DD; after this date the exception itself fails the run. */
  expires: string;
  ref?: string;
  /** Applies only to the run at this tier (a profile row that tightens a Tier 1 SHOULD); absent: both tiers. */
  tier?: 1 | 2;
  /**
   * The review class (results/vector-review.md#classes): A differs from the specification text, B the suite may expect more than the
   * text says, C the text is open (a question for the task force), D other. Optional: set only where the review has classed the entry;
   * when `reason` also says "class X" the two must agree (test/exceptions-file.test.ts).
   */
  class?: ExceptionClass;
  /**
   * Owner acknowledgement (docs/challenges.md section 7): `null` until the implementer who owns the platform has agreed that the entry
   * describes their platform; then who, when (YYYY-MM-DD) and where it was recorded. Shown as "unacknowledged" while null.
   */
  acknowledged: ExceptionAcknowledgement | null;
  /**
   * The failure the entry excuses (docs/04 section 8): regular expressions, each of which must match at least one failure line the
   * engine reports for the vector (the lines carry the step, the observed status, code or reply count and the assertion). A failing
   * result that misses one is FAIL ("does not match the observed failure"), so a vector that starts failing for another reason is not
   * hidden. Absent: any failure is excused (entries whose failure was never recorded).
   */
  expectFailure?: ExpectFailure;
  /**
   * Set when the entry was copied to this implementation key from another surface's key and no recorded result of this surface shows the
   * difference yet: names where it was copied from. The next recorded run decides it (a pass makes it stale and FAIL); then drop the field.
   */
  inherited?: string;
  /**
   * Surfaces of the entry's platform the entry does not apply to: implementation name -> why (docs/04 section 8). Only for an entry keyed on a
   * platform, which otherwise applies to every row declaring that platform; use it when the difference sits in a path that surface does not
   * take, so a result there is judged without the entry (a pass is PASS, a failure is FAIL) instead of reading as stale.
   */
  notOn?: Record<string, string>;
}
export interface ExpectFailure { failures: string[] }
export interface ExceptionAcknowledgement { by: string; on: string; ref: string }
/** The text shown for an entry's acknowledgement wherever exceptions are rendered. */
export function acknowledgementText(a: ExceptionAcknowledgement | null | undefined): string {
  return a == null ? "unacknowledged" : `acknowledged by ${a.by} on ${a.on}`;
}
export const EXCEPTION_CLASSES = ["A", "B", "C", "D"] as const;
export type ExceptionClass = (typeof EXCEPTION_CLASSES)[number];

export interface ExceptionsFile {
  format: "tt-conformance-exceptions/0.1";
  exceptions: ExceptionEntry[];
}
