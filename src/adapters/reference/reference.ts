// SPDX-License-Identifier: Apache-2.0
// In-process reference adapter built on the adopted @openvtc/trust-tasks 0.29.0 runtime
// (consumeInbound, replay guard, freshness, error routing) and the suite's own did:key
// eddsa-jcs-2022 signer/verifier. It serves a single "carrier" task and implements:
//   Tier 1: the framework consumer pipeline (envelope, errors, lifecycle, freshness, duplicates, proofs when present).
//   Tier 2 (`attested`): proof required on every request, purpose pinned to authentication,
//     recipient and issuedAt required, closed payload, every response and error signed by the IUT,
//     whole-second timestamps.
// It is the non-vacuity oracle: every vector must pass here, and negative vectors must fail the mutants.
import { candidatePlainTasks } from "../../coverage/candidates.ts";
import { badResponsePayload, EMIT_FAMILIES, loadPlainTasks, type PlainTask } from "../../plain/catalog.ts";
import { gapTasks } from "../../plain/gap.ts";
import { exampleExtended, validate as validateSchema } from "../../plain/schema.ts";
import { SeededState, type SEEDED_STATE_MUTANTS } from "./seeded-state.ts";
import { createHash } from "node:crypto";
import {
  InMemoryReplayGuard,
  StaticTransport,
  UnauthenticatedTransport,
  consequentialChecks,
  consumeInbound,
  notConsequentialChecks,
  rejectWith,
  toErrorPayload,
  CONSEQUENTIAL_FRESHNESS,
  canonicalJson,
  DEFAULT_FRESHNESS,
} from "@openvtc/trust-tasks/runtime";
import type {
  ConsumeChecks,
  ErrorResponse,
  PayloadValidator,
  ProofVerifier,
  ReplayGuard,
  SpecPolicy,
  TrustTaskDocument,
} from "@openvtc/trust-tasks/runtime";
import type {
  AcceptanceWindow,
  Adapter,
  Capabilities,
  CeremonyDecl,
  ObserveQuery,
  ObserveResult,
  ProofVerifyResult,
  ProvisionedRole,
  VerifyReceiptParams,
  VerifyReceiptResult,
  SendParams,
  SendResult,
} from "../../adapter/contract.ts";
import { CONTRACT_VERSION } from "../../adapter/contract.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument, verifyDocumentProof } from "../../crypto/proof.ts";
import { specifiedProofPurpose } from "../../crypto/proof-purpose.ts";
import { isTamperMode, tamperDecision } from "../../ceremony/tamper.ts";
import { digestMultibase } from "../../crypto/digest.ts";
import { CeremonyParty, CEX_KINDS, CEX_ROLES, CONSENT_KINDS, CONSENT_ROLES, PARTY_KINDS, PARTY_ROLES } from "./ceremony-party.ts";
import type { CeremonyMutantId, ExchangeView } from "./ceremony-party.ts";
import { fromMultibase } from "../../crypto/base58.ts";
import { jcsBytes } from "../../util/json.ts";
import { isObject, isoSeconds } from "../../util/json.ts";
import { isDeclarationLieId, isMutantId } from "./mutants.ts";
import { GOV_TYPES, GovernanceModel, isGovMutantId } from "./governance.ts";
import type { GovMutantId } from "./governance.ts";
import type { ConnectParams, ConnectResult, InitiateParams, InitiateResult, DeclareGovernanceResult, EssentialGovernance, GovernanceDeclaration } from "../../adapter/contract.ts";
import { ReferencePush } from "./pushed.ts";
import type { PushHost } from "./pushed.ts";
import { twoLTasks } from "./2l-catalog.ts";
import { behaviourRefusal } from "../../coverage/behaviour/index.ts";
import { coverageTasks } from "../../coverage/catalog.ts";
import { twoLRefusal } from "./2l-oracle.ts";
import { ReferenceWitness, WIT_TYPES, WIT_SESSION_01, WIT_SUBMIT_01 } from "./witness.ts";
import { verifyReceipt } from "./receipt-verifier.ts";
import { PROFILE_WINDOW } from "../../runner/window.ts";
import type { DeclarationLieId, MutantId } from "./mutants.ts";
import { WitnessOracle } from "./witness-oracle.ts";
import { VettingParty } from "./vetting-party.ts";
import { OnboardingParty } from "./onboarding-party.ts";
import type { Doc as FlowDoc, FlowHost, FlowPart } from "./flow-part.ts";

export const CARRIER_TYPE = "https://trusttasks.org/spec/conformance/widget/0.1";
export const CARRIER_RESPONSE_TYPE = `${CARRIER_TYPE}#response`;
export const ERROR_TYPE_PREFIX = "https://trusttasks.org/spec/trust-task-error/";

export const PROPOSE_TYPE = "https://trusttasks.org/spec/vrc/relationships/propose/0.1";
export const ISSUE_TYPE = "https://trusttasks.org/spec/vrc/relationships/issue/0.1";
export const NEXT_STEP_TYPE = "https://trusttasks.org/spec/trust-task-next-step/0.1";
export const PROPOSE_DECLINED = "vrc/relationships/propose:declined";
export const ISSUE_NOT_ACCEPTED = "vrc/relationships/issue:notAccepted";
export const WSH_TYPE = "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1";
export const WSH_NOT_ACCEPTED = "vrc/relationships/witness-share:notAccepted";
const WSH_DOMAIN = "vrc:witness-share";
export const DISCOVERY_TYPE = "https://trusttasks.org/spec/trust-task-discovery/0.4";
export const CER_BEGIN_TYPE = "https://trusttasks.org/spec/conformance/ceremony/begin/0.1";
export const CER_APPROVE_TYPE = "https://trusttasks.org/spec/conformance/ceremony/approve/0.1";
export const CER_RESET_TYPE = "https://trusttasks.org/spec/conformance/ceremony/reset/0.1";
export const CER_STATUS_TYPE = "https://trusttasks.org/spec/conformance/ceremony/status/0.1";
const CER_TYPES_BASE = [CER_BEGIN_TYPE, CER_APPROVE_TYPE, CER_RESET_TYPE];
/** The default approval window of a ceremony: seven days from the begin document (`trigger ceremonyDeadline` changes it). */
const CER_WINDOW_MS = 7 * 24 * 3_600_000;
export const CONSENT_REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
export const CONSENT_DECISION_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.2";
export const CEX_ISSUE_TYPE = "https://trusttasks.org/spec/credential-exchange/issue/0.1";
export const CEX_PRESENT_TYPE = "https://trusttasks.org/spec/credential-exchange/present/0.1";
export const CEX_QUERY_TYPE = "https://trusttasks.org/spec/credential-exchange/query/0.1";
export const CEX_OFFER_TYPE = "https://trusttasks.org/spec/credential-exchange/offer/0.1";
export const CEX_REQUEST_TYPE = "https://trusttasks.org/spec/credential-exchange/request/0.1";
export const CONSENT_GRANTED_TYPE = "https://trusttasks.org/spec/task-consent/granted/0.1";
export const CONSENT_DECISION_01_TYPE = "https://trusttasks.org/spec/task-consent/decision/0.1";
/** The one credential configuration the reference holder supports (an offer naming only others gets `unsupportedCredential`) and the type `holdCredential` makes it hold. */
const QUERY_CRED = "https://example.org/conformance#ConformanceCredential";
const CEX_ISSUE_UNSUPPORTED = "credential-exchange/issue:unsupportedFormat";
const CEX_STALE_NONCE = "credential-exchange/present:staleNonce";
const CEX_AUDIENCE = "credential-exchange/present:audienceMismatch";
export const ISSUE_ALREADY_ISSUED = "vrc/relationships/issue:alreadyIssued";

export interface ReferenceOptions {
  /**
   * The task-consent/decision versions this implementation serves (default both, 0.1 and 0.2). `["0.1"]` models an older executor (the version skew the
   * wallet's own ladder steps down from: vta-service v0.60.0 to v0.66.0 served only 0.1): a decision typed 0.2 is refused `unsupportedVersion` with the
   * served type URIs in `details.servedVersions`, as a VTA's `method_not_found` does. A suite stand-in for an older platform (class D), never a platform.
   */
  consentDecisionVersions?: ("0.1" | "0.2")[];
  /** Seed byte of the reference's own Ed25519 key (default 0x42). A second instance with another seed is a distinct party, used as the producer in the artifact-crossed replay (src/crossed/). */
  signerSeed?: number;
  /** Serve vrc/relationships/propose and issue. Default true; false models an implementation that hosts neither. */
  vrc?: boolean;
  /** Serve vrc/relationships/witness-share (needs vrc). Default true; false models an implementation without it. */
  witnessShare?: boolean;
  /** Declare the HTTPS binding (bindings/https/0.3) and model it for sends that carry an `http` request line. Default true; false models an in-process-only adapter. */
  https?: boolean;
  /** Serve the ceremony-document family (begin, approve, reset; group CER). Default true; false models an implementation that hosts none. */
  ceremony?: boolean;
  /**
   * Whether a begin document counts as the proposer's own approval (declared as `ceremony.proposerApproves`). Default true: one
   * approval by the other administrator completes the quorum. False: every named administrator, the proposer included, approves by an
   * approve document.
   */
  proposerApproves?: boolean;
  /**
   * The essential governance the harness configures for the run (docs/04 section 19): the authority set as harness actor names and
   * minApprovals (k). The begin names the set as its administrators and the ceremony completes at the k-th distinct approval from it.
   * Default: the reference's own configuration, administrators A and X with k = 2 (declared with source `platform-config`).
   */
  essential?: { approvers: string[]; minApprovals: number };
  /**
   * A deliberately lying variant (`DECLARATION_LIES`): the capabilities still declare `essential`, but the ceremony behaves otherwise.
   * Only for the non-vacuity of the adapter honesty check (src/runner/honesty.ts).
   */
  declarationLie?: string;
  /** Answer a decision that leaves the quorum short with a trust-task-next-step hold instead of the `pending` response. Default false. */
  decisionHold?: boolean;
  /** Offer a status task (declares `ceremony.status`): a held ceremony is answered with a next-step that names it, and it answers a query with the ceremony's state. Default false. */
  ceremonyStatus?: boolean;
  /** The `continuation` of a hold that names the status task: the reference's own choice, which no vector asserts (docs/04 section 11.4). Default `proceed`; `omit` leaves the member out. */
  statusContinuation?: "proceed" | "resubmit" | "omit";
  /**
   * Model an implementation whose clock the harness cannot set (declares `clockFree`, not `clock`): it reads real time and refuses
   * `setClock` and `advance`. Default false.
   */
  clockFree?: boolean;
  /** The acceptance window enforced and advertised. Default: the profile pins (300 s / 60 s / 30 days). */
  window?: Partial<AcceptanceWindow>;
  /**
   * Serve the 3b-DTG tasks (task-consent request and decision, credential-exchange issue and present; groups TC and CEX). The decision
   * needs the ceremony family (its pending request is a ceremony). Default true; false models an implementation that serves none.
   */
  dtg?: boolean;
  /**
   * Serve the plain tasks of the plain-task family (vectors/plain, docs/04 section 11.7: acl, policy, vault, device, auth) from the
   * pinned @openvtc/trust-tasks: the payload schema and policy of each, answered with a schema-valid response. Default true; false
   * models an implementation that serves none.
   */
  plain?: boolean;
  /**
   * Answer a query the holder defers (a matching credential, a verifier that is not pre-trusted) with noMatch instead of consentRequired,
   * the reading of "noMatch and held but not consented MUST be indistinguishable" under which the two refusals are the same. Default false
   * (the code table's reading: consentRequired). CEX-024 is CLARIFY because the text asks for both.
   */
  queryUniformRefusal?: boolean;
  /**
   * Governance model (docs/17): accept `declareGovernance` and honour the declaration for acl/grant 0.3, acl/list 0.4 and
   * policy/evaluate 0.4. Default false: the reference declares no governance path and its plain-task answers are unchanged.
   */
  governance?: boolean;
  /** Governance mutants (`GOV_MUTANTS`); each implies `governance`. */
  governanceMutants?: string[];
  /**
   * Mode `reference-witness` (docs/13 section 6): serve trust-task-discovery 0.1, witness/session 0.1 and witness/session/submit 0.1 through
   * the specification-driven witness oracle (witness-oracle.ts) and declare the DIDComm carriage the vectors gate on (the oracle models the
   * documents, not the carriage). Those three are then the only types served. Default false.
   */
  witness?: boolean;
  /**
   * With `witness`: the labelled mode `mint-on-verified` of the witness oracle (docs/25 section 6.4): a presentation that verifies and is held by the submitter is
   * answered with a minted Verifiable Witness Credential instead of `taskFailed`. Only for the ceremony scenario FC-WSH; the unmutated `reference-witness` that the
   * witness vectors run against never sets it. Declared in the capabilities as `mode`.
   */
  witnessMode?: "mint-on-verified";
  /** The identity-vetting party (group FC-VET, docs/25 section 6.6): serves vetting/request, session and decline and offers the kinds and roles of that group. Default false: the default reference is unchanged. */
  vetting?: boolean;
  /** The community-member-onboarding party (group FC-ONB, docs/25 section 6.5): serves the vtc join-requests and members tasks of that ceremony and offers its kinds and roles. Default false: the default reference is unchanged. */
  onboarding?: boolean;
  /** Serve witness/session and witness/session/submit, 0.1 and 0.2 (group WIT; src/adapters/reference/witness.ts). Default true (and off in the `reference-witness` mode, which serves its own three types); false models a platform that is not a witness. */
  witnessTasks?: boolean;
  /** Tier 2 behaviour. Default false (Tier 1 only). */
  attested?: boolean;
  mutants?: string[];
  name?: string;
}

interface MiniSchema {
  type: "object";
  required: string[];
  properties: Record<string, { type: "string" | "boolean" | "object" | "array" | "number" | "any"; pattern?: string; maxItems?: number; itemType?: "string" }>;
  additionalProperties: boolean;
}

/** The only JSON Schema subset the carrier needs; the runtime bundles no validator by design. */
const miniValidator: PayloadValidator = {
  validate(schema, payload) {
    // a registry payload schema (plain-task family) carries `$schema`; the carrier and the 3b-DTG schemas are the mini subset
    if (typeof (schema as Record<string, unknown>)["$schema"] === "string") {
      const errors = validateSchema(schema as Record<string, unknown>, payload);
      return { ok: errors.length === 0, errors };
    }
    const s = schema as MiniSchema;
    if (!isObject(payload)) return { ok: false, errors: ["payload must be an object"] };
    const errors: string[] = [];
    for (const k of s.required) if (!(k in payload)) errors.push(`missing ${k}`);
    for (const [k, spec] of Object.entries(s.properties)) {
      if (k in payload && spec.type === "array") {
        const v = payload[k];
        if (!Array.isArray(v)) errors.push(`${k} must be array`);
        else {
          if (spec.maxItems !== undefined && v.length > spec.maxItems) errors.push(`${k} has more than ${spec.maxItems} items`);
          if (spec.itemType === "string" && !v.every((x) => typeof x === "string" && x.length >= 1)) errors.push(`${k} items must be non-empty strings`);
        }
      } else if (k in payload && spec.type !== "any" && (typeof payload[k] !== spec.type || (spec.type === "object" && (payload[k] === null || Array.isArray(payload[k]))))) errors.push(`${k} must be ${spec.type}`);
      else if (k in payload && spec.pattern !== undefined && !new RegExp(spec.pattern).test(String(payload[k]))) errors.push(`${k} does not match ${spec.pattern}`);
    }
    if (!s.additionalProperties) {
      for (const k of Object.keys(payload)) if (!(k in s.properties)) errors.push(`unknown member ${k}`);
    }
    return { ok: errors.length === 0, errors };
  },
};

let plainServed: PlainTask[] | undefined;
/** The plain tasks the reference serves: those the package ships with a payload the generator could build. Where the generator cannot build a response payload the reference answers `{}` (the family has no answered vector for such a task). */
function servedPlainTasks(): PlainTask[] {
  if (plainServed === undefined) {
    const base = [...loadPlainTasks(EMIT_FAMILIES), ...twoLTasks()].filter((t) => t.validPayload !== undefined);
    const have = new Set(base.map((t) => t.typeUri));
    // the coverage families' tasks (docs/22), including versions whose valid payload cannot be built: those are served for the refusal checks only
    const earlier = [...base, ...coverageTasks().tasks.filter((c) => (c.probe || c.emit) && c.oracle).map((c) => c.task).filter((t) => !have.has(t.typeUri)), ...candidatePlainTasks()];
    // the gap families (vta, vtc, rooms, did-management, git-ns, messaging; vectors/gap): the oracle serves every version the specification snapshot holds that nothing above already serves
    const haveEarlier = new Set(earlier.map((t) => t.typeUri));
    plainServed = [...earlier, ...gapTasks().map((g) => g.task).filter((t) => !haveEarlier.has(t.typeUri))];
  }
  return plainServed;
}

const uuid = (seed: string): string => {
  const h = createHash("sha256").update(seed).digest("hex");
  return `urn:uuid:${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type ProposePolicy = "accept" | "decline" | "hold";
interface Exchange {
  id: string;
  peer: string;
  theirRel: string;
  myRel: string;
  state: "held" | "accepted" | "declined";
  witnessedAsked: boolean;
  proposal: TrustTaskDocument<unknown>;
  stored: string[];
  /** Digests of witnessed credentials stored for this exchange. */
  shared: string[];
}

interface Ceremony {
  id: string;
  beginId: string;
  proposer: string;
  admins: string[];
  /** Administrators whose approval is recorded, in order; the proposer's begin is the first. */
  approvals: string[];
  status: "pending" | "committed" | "failed" | "expired" | "aborted";
  deadlineMs: number;
  /** Closed-vocabulary reason of a failed or expired ceremony. */
  reason?: string;
  content: string;
  lapseAnswered: boolean;
}

interface TxPlan {
  outcome: "commit" | "abort" | "inflight" | "voteNo" | "unknown";
  /** Closed-vocabulary token of an abort whose reason the adapter knows. */
  reason?: string;
  /** An internal fact about the abort that must never reach the wire. */
  internal?: string;
  /** False: the transaction commits but the reply is lost before delivery. */
  deliver: boolean;
}

/** The closed set of abort reasons the boundary may put on the wire (docs/04 section 12). */
const TX_REASONS = ["policyDenied", "notAdmin", "nameTaken", "deadlineLapsed", "alreadyCommitted", "notAccepted", "vcInvalid", "outcomeEvidenceInvalid", "notFound", "storeFailed", "notFoundOrNotPermitted"];

/** HTTPS binding 0.3 section 4: framework error code to HTTP status. */
const HTTP_STATUS: Record<string, number> = {
  malformedRequest: 400, permissionDenied: 403, unsupportedType: 422, unsupportedVersion: 422, expired: 422, proofRequired: 422, proofInvalid: 422,
  identityMismatch: 422, wrongRecipient: 422, cancelled: 422, taskFailed: 422, unsupportedExtension: 422, idConflict: 409, unavailable: 503,
  indeterminate: 503, internalError: 500,
};

/** Whether a flow part's reply is an error document (its type names the error). */
const errorKindOf = (r: Record<string, unknown>): boolean => String(r.type ?? "").includes("/trust-task-error/");

const DIGEST_PATTERN = "^z[1-9A-HJ-NP-Za-km-z]+$";

export class ReferenceAdapter implements Adapter {
  readonly attested: boolean;
  readonly vrc: boolean;
  readonly witnessShare: boolean;
  /** The witness side of witness/session and submit (options.witness). */
  readonly witnessServed: boolean;
  private readonly witnessOracle: ReferenceWitness;
  readonly https: boolean;
  readonly ceremony: boolean;
  readonly dtg: boolean;
  private readonly consentDecisionVersions: ("0.1" | "0.2")[];
  private readonly plainTasks: Map<string, PlainTask>;
  /** The rooms and git namespaces a valid create or bind made (seeded-state probe, seeded-state.ts). */
  private readonly seeded = new SeededState();
  private readonly wit: WitnessOracle | undefined;
  /** The small ceremony parties that model one flow each (vetting-party.ts); empty in every default reference. */
  private readonly flows: FlowPart[] = [];
  readonly proposerApproves: boolean;
  private readonly essential: { approvers: string[]; minApprovals: number; source: "platform-config" | "harness-configured" };
  private readonly lie: DeclarationLieId | undefined;
  readonly decisionHold: boolean;
  readonly ceremonyStatus: boolean;
  readonly clockFree: boolean;
  private readonly windowOverridden: boolean;
  readonly window: AcceptanceWindow;
  private readonly statusContinuation: "proceed" | "resubmit" | "omit";
  readonly mutants: ReadonlySet<MutantId>;
  private readonly gov: GovernanceModel | undefined;
  readonly name: string;
  private readonly signer: ReturnType<typeof ed25519Signer>;
  private nowMs: number | undefined;
  private guard: ReplayGuard;
  private handled = 0;
  /** Pushed documents (observe.pushed, docs/20). */
  private readonly push: ReferencePush = new ReferencePush(this.pushHost());
  private counter = 0;
  private states = new Map<string, string>();
  private burned = new Set<string>();
  private snapshots = new Map<string, string>();
  private policy: { propose: ProposePolicy; witnessed: boolean } = { propose: "hold", witnessed: false };
  private exchanges = new Map<string, Exchange>();
  private claimedRel = new Map<string, string>();
  private relSigners = new Map<string, ReturnType<typeof ed25519Signer>>();
  private partyRelCounter = 0;
  /** The ceremony-scenario members (docs/25): initiate, connect, observe received and ceremony. */
  private readonly party: CeremonyParty = new CeremonyParty(this.partyHost());
  private readonly signerSeed: number;
  private relCounter = 0;
  private claimFault = false;
  private ceremonies = new Map<string, Ceremony>();
  /** Executors this device is enrolled with (`trigger enrolExecutor`), credentials and presentations stored, and the nonces issued to verifiers. */
  private enrolled = new Set<string>();
  private credentials: string[] = [];
  private presentations: string[] = [];
  private nonces = new Map<string, { nonce: string; used: boolean }>();
  private nonceCounter = 0;
  /** credential-exchange/query: credentials the holder holds (lists of type IRIs), verifiers it pre-trusts, queries deferred for consent. */
  private held: string[][] = [];
  private trusted = new Set<string>();
  private deferrals: TrustTaskDocument<unknown>[] = [];
  /** Threads of queries this holder has built a presentation for (ceremony party: the holder's reading of a query thread). */
  private readonly presented = new Set<string>();
  /** Queries the person declined (the holder's reading of the thread is then `declined`). */
  private readonly declined = new Set<string>();
  private readonly queryUniform: boolean;
  private effects = 0;
  private cerWindowMs = CER_WINDOW_MS;
  /** The outcome of the establishing effect when the next ceremony reaches quorum (`trigger ceremonyEffect`); one-shot. */
  private cerPlan: { outcome: "commit" | "fail" | "unknown"; reason?: string } = { outcome: "commit" };
  private cerPending: { c: Ceremony; doc: TrustTaskDocument<unknown> } | undefined;
  private retained = new Map<string, { request: string; reply?: string }>();
  private lastBytes = "";
  /** The outcome the next issue transaction will have (`trigger twoPhase`); one-shot. */
  private tx: TxPlan = { outcome: "commit", deliver: true };
  private pending: { doc: TrustTaskDocument<unknown>; ex: Exchange | undefined; actual: string; digest: string } | undefined;
  private lastMeta: "none" | "dupReply" | "dupInflight" | "dupDone" | "undecodable" | "inboundError" = "none";

  constructor(options: ReferenceOptions = {}) {
    this.signerSeed = options.signerSeed ?? 0x42;
    this.signer = ed25519Signer(seedOf(this.signerSeed));
    this.attested = options.attested ?? false;
    this.vrc = options.vrc ?? true;
    this.witnessShare = this.vrc && (options.witnessShare ?? true);
    this.witnessServed = (options.witnessTasks ?? true) && options.witness !== true;
    this.witnessOracle = new ReferenceWitness({
      signer: this.signer, now: () => this.now(), newId: () => this.newId(), stamp: () => this.stamp(), m: (id) => this.m(id),
      refuse: (d, code, message) => this.refuse(d as unknown as TrustTaskDocument<unknown>, code, message) as unknown as Record<string, unknown>,
    });
    this.https = options.https ?? true;
    this.ceremony = options.ceremony ?? true;
    this.dtg = options.dtg ?? true;
    this.consentDecisionVersions = options.consentDecisionVersions ?? ["0.1", "0.2"];
    this.plainTasks = new Map((options.plain ?? true) ? servedPlainTasks().map((t) => [t.typeUri, t] as const) : []);
    this.queryUniform = options.queryUniformRefusal ?? false;
    this.proposerApproves = options.proposerApproves ?? true;
    const e = options.essential ?? { approvers: ["A", "X"], minApprovals: 2 };
    if (e.approvers.length === 0 || !Number.isInteger(e.minApprovals) || e.minApprovals < 1 || e.minApprovals > e.approvers.length) throw new Error("essential: 1 <= minApprovals <= approvers");
    this.essential = { ...e, source: options.essential === undefined ? "platform-config" : "harness-configured" };
    if (options.declarationLie !== undefined && !isDeclarationLieId(options.declarationLie)) throw new Error(`unknown declaration lie: ${options.declarationLie}`);
    this.lie = options.declarationLie;
    this.decisionHold = options.decisionHold ?? false;
    this.ceremonyStatus = this.ceremony && (options.ceremonyStatus ?? false);
    this.statusContinuation = options.statusContinuation ?? "proceed";
    this.clockFree = options.clockFree ?? false;
    this.window = { ...PROFILE_WINDOW, ...(options.window ?? {}) };
    this.windowOverridden = options.window !== undefined;
    const ms = options.mutants ?? [];
    for (const m of ms) if (!isMutantId(m)) throw new Error(`unknown mutant: ${m}`);
    this.mutants = new Set(ms as MutantId[]);
    const gms = options.governanceMutants ?? [];
    for (const m of gms) if (!isGovMutantId(m)) throw new Error(`unknown governance mutant: ${m}`);
    this.gov = options.governance === true || gms.length > 0 ? new GovernanceModel(new Set(gms as GovMutantId[])) : undefined;
    this.guard = this.makeGuard();
    this.wit = options.witness === true ? new WitnessOracle({ m: (id) => this.m(id), now: () => this.now(), newId: () => this.newId(), signer: this.signer, ...(options.witnessMode === undefined ? {} : { mode: options.witnessMode }), finish: (r, q, e) => this.finish(r, q, e), refuse: (d, c, t) => this.refuse(d, c, t) }) : undefined;
    if (options.vetting === true) this.flows.push(new VettingParty(this.flowHost()));
    if (options.onboarding === true) this.flows.push(new OnboardingParty(this.flowHost()));
    this.name = options.name ?? (this.lie !== undefined ? `reference-lie-${this.lie}` : ms.length + gms.length > 0 ? `reference+${[...ms, ...gms].join("+")}` : this.gov !== undefined ? "reference-governance" : "reference");
  }

  private makeGuard(): ReplayGuard {
    const inner = new InMemoryReplayGuard();
    const idOnly = this.mutants.has("idOnlyDuplicateKey");
    return {
      claim: (id, digest, retainUntil, now) => {
        if (this.claimFault && !this.mutants.has("claimStoreFailOpen")) throw new Error("duplicate record unreadable");
        return inner.claim(id, idOnly ? "constant" : digest, retainUntil, now);
      },
      recordResponse: (id, response) => inner.recordResponse(id, response),
      release: (id, digest) => inner.release(id, digest),
    };
  }

  private m(id: MutantId | keyof typeof SEEDED_STATE_MUTANTS): boolean {
    return (this.mutants as Set<string>).has(id);
  }
  /** What the pushed-document helper (pushed.ts) borrows from this adapter. */
  private pushHost(): PushHost {
    const a = this;
    return { get did() { return a.signer.did; }, get signer() { return a.signer; }, now: () => a.now(), newId: () => a.newId(), m: (id) => a.m(id), finish: (d) => a.finish(d as TrustTaskDocument<unknown>, d as TrustTaskDocument<unknown>, false) as unknown as Record<string, unknown> };
  }
  private now(): number {
    return this.nowMs ?? Date.now();
  }
  private newId(): string {
    return uuid(`${this.signer.did}:${this.counter++}`);
  }
  private stamp(): string {
    return this.m("wholeMillisecondTimestamps") ? new Date(this.now()).toISOString() : isoSeconds(this.now());
  }

  async capabilities(): Promise<Capabilities> {
    return {
      name: this.name,
      implementation: this.mutants.size > 0 || this.clockFree || this.windowOverridden ? this.name : "reference",
      contractVersion: CONTRACT_VERSION,
      version: "0.0.1",
      tierMax: this.attested ? 2 : 1,
      bindings: this.wit !== undefined ? ["in-process", "didcomm", "didcomm-v1", "didcomm-v2"] : this.https ? ["in-process", "https"] : ["in-process"],
      supportedTypes: this.typeList(),
      carriers: [{ typeUri: CARRIER_TYPE, class: "consequential", validPayload: { subject: "did:web:alice.example" } }, ...(this.attested && !this.m("openPayload") ? [] : [{ typeUri: CARRIER_TYPE, class: "openPayload" as const, validPayload: { subject: "did:web:alice.example" } }])],
      cryptosuites: ["eddsa-jcs-2022"],
      ...(this.ceremony ? { ceremony: this.ceremonyDecl() } : {}),
      ...(this.wit?.mode === undefined ? {} : { mode: this.wit.mode, ceremonyRoles: [{ ceremony: "FC-WSH", roles: ["witness"] }] }),
      optional: [...(this.wit?.mode === undefined ? [] : ["peer.connect", "observe.received", "observe.ceremony"]), "transportIdentity", ...(this.vrc ? ["trigger.consent", "trigger.twoPhase"] : []), ...(this.vrc || this.dtg ? ["initiate", "peer.connect", "observe.received", "observe.ceremony"] : []), "restart", "fault.claimStore", ...(this.witnessServed || this.wit !== undefined ? ["witness.presentation"] : []), ...((this.witnessServed || this.wit !== undefined) && this.plainTasks.size === 0 ? ["authorised"] : []), ...(this.ceremony ? ["ceremony", ...(this.ceremonyStatus ? ["ceremony.status"] : []), "trigger.ceremonyDeadline", "trigger.ceremonyEffect", "observe.retained"] : []), "discovery.acceptanceWindow", "discovery.expiryHorizon", ...(this.plainTasks.size > 0 ? ["emit"] : []), ...(this.plainTasks.size > 0 ? ["governance.roles", "seed.defaults", "authorised"] : []), ...(this.gov !== undefined ? ["governance.declare"] : []), ...(this.dtg ? ["trigger.consentEnrol", "trigger.consentSetup", "trigger.presentationNonce", "trigger.holdCredential", "trigger.verifierTrust", "trigger.queryDecision", "observe.deferred", "observe.pushed", "trigger.makeOffer", ...(this.ceremony ? ["trigger.consentBinding"] : [])] : []), ...(this.attested ? [this.clockFree ? "clockFree" : "clock", "proofVerify", "receiptVerify", "attested"] : [this.clockFree ? "clockFree" : "clock", "proofVerify", "receiptVerify"])],
      ...(this.vrc || this.dtg ? { initiates: [...this.flows.flatMap((f) => f.kinds), ...(this.vrc ? PARTY_KINDS : []), ...(this.ceremony && this.dtg ? CONSENT_KINDS : []), ...(this.dtg ? CEX_KINDS : [])], ceremonyRoles: [...this.flows.flatMap((f) => f.roles), ...(this.vrc ? PARTY_ROLES : []), ...(this.ceremony && this.dtg ? CONSENT_ROLES.map((c) => (c.ceremony === "FC-KVC" && this.consentDecisionVersions.length === 1 ? { ceremony: c.ceremony, roles: ["executor-v01"] } : c)) : []), ...(this.dtg ? CEX_ROLES : [])] } : {}),
      window: { ...this.window },
      // Arbitrary stand-in strings with no meaning: the reference has no governance. They exist so the plain-task vectors that carry a role value can run against it.
      ...(this.plainTasks.size > 0 ? { emits: [...this.plainTasks.values()].filter((t) => t.validPayload !== undefined).map((t) => t.typeUri) } : {}),
      ...(this.plainTasks.size > 0 || this.ceremony ? { governance: { ...(this.plainTasks.size > 0 ? { roles: ["conformance-role-a", "conformance-role-b"] } : {}), ...(this.gov !== undefined ? { declaration: "supported" as const, items: ["roles" as const, "authority" as const, "consent" as const] } : {}), ...(this.ceremony ? { essential: this.essentialDecl() } : {}) } } : {}),
      pins: { framework: "0.6.0", error: "0.6", binding: this.https ? "https/0.3" : "none" },
    };
  }

  /** The task types served, which discovery lists (registry-driven: one list for both). */
  private typeList(): string[] {
    if (this.wit !== undefined) return this.wit.types();
    const all = [CARRIER_TYPE, DISCOVERY_TYPE, ...this.flows.flatMap((f) => f.types()), ...(this.ceremony ? this.cerTypes() : []), ...(this.vrc ? [PROPOSE_TYPE, ISSUE_TYPE, ...(this.witnessShare ? [WSH_TYPE] : [])] : []), ...this.dtgTypes(), ...(this.witnessServed ? WIT_TYPES : []), ...this.plainTasks.keys()];
    return this.flows.length === 0 ? all : [...new Set(all)];
  }

  private dtgTypes(): string[] {
    return this.dtg ? [CONSENT_REQUEST_TYPE, ...(this.ceremony ? [...(this.consentDecisionVersions.includes("0.2") ? [CONSENT_DECISION_TYPE] : []), ...(this.consentDecisionVersions.includes("0.1") ? [CONSENT_DECISION_01_TYPE] : [])] : []), CONSENT_GRANTED_TYPE, CEX_ISSUE_TYPE, CEX_PRESENT_TYPE, CEX_QUERY_TYPE, CEX_OFFER_TYPE, CEX_REQUEST_TYPE] : [];
  }

  private cerTypes(): string[] {
    return this.ceremonyStatus ? [...CER_TYPES_BASE, CER_STATUS_TYPE] : CER_TYPES_BASE;
  }

  private ceremonyDecl(): CeremonyDecl {
    return {
      beginType: CER_BEGIN_TYPE, approveType: CER_APPROVE_TYPE, resetType: CER_RESET_TYPE,
      ...(this.ceremonyStatus ? { statusType: CER_STATUS_TYPE, statusPayload: {} } : {}),
      proposerApproves: this.proposerApproves,
      beginPayload: { name: "fixture-community", admins: this.essential.approvers.map((a) => `$${a}`) }, approvePayload: {}, resetPayload: {},
    };
  }

  /** The essential governance the reference declares: its ceremony's authority set and k, from its configuration. */
  private essentialDecl(): EssentialGovernance {
    return {
      source: this.essential.source,
      principals: this.essential.approvers.map((a) => ({ vid: `$${a}`, role: "ceremony-administrator" })),
      consent: { task: CER_BEGIN_TYPE, approverSet: "ceremony-administrator", minApprovals: this.essential.minApprovals, excludeRequester: false },
      evidence: this.essential.source === "platform-config" ? "src/adapters/reference/reference.ts (ReferenceOptions.essential default)" : "ReferenceOptions.essential, set by the harness for the run",
    };
  }

  /** What the reference actually does with a begin: the declaration, or its opposite under the mutant that lies about it. */
  private beginApproves(): boolean {
    return this.m("cerProposerApprovalFlip") ? !this.proposerApproves : this.proposerApproves;
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const r of roles) {
      out[r] = {
        vid: this.signer.did,
        didDocument: { id: this.signer.did, verificationMethod: [{ id: this.signer.verificationMethod, type: "Multikey", controller: this.signer.did, publicKeyMultibase: this.signer.did.slice("did:key:".length) }], authentication: [this.signer.verificationMethod], assertionMethod: [this.signer.verificationMethod] },
        transportAddress: "in-process", keyCustody: "iut",
      };
    }
    return out;
  }

  async trust(): Promise<void> {
    /* did:key peers resolve locally */
  }
  async setClock(iso: string): Promise<void> {
    if (this.clockFree) throw new Error("the clock of this implementation cannot be set");
    this.nowMs = Date.parse(iso);
  }
  async advance(ms: number): Promise<void> {
    if (this.clockFree) throw new Error("the clock of this implementation cannot be set");
    this.nowMs = this.now() + ms;
  }
  /**
   * `policy {propose, witnessed}` presets what the IUT's human will decide; `consent {exchangeId, decision}` is the decision
   * for a held proposal and returns the reply the IUT then emits. The IUT initiates nothing else.
   */
  async trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "consentSetup") {
      // FC-KVC: the deployment's consent policy (approver set, k). This reference declares its k at construction (`k=`); the step checks the scenario asks for the same one.
      if (this.essential.minApprovals !== Number(args.minApprovals ?? this.essential.minApprovals)) throw new Error(`consentSetup: this executor declares k=${this.essential.minApprovals}, not ${String(args.minApprovals)}`);
      return { documents: [] };
    }
    if (action === "policy" && this.flows.some((f) => f.policy?.(args) === true)) return { documents: [] };
    if (action === "policy") {
      const p = args.propose;
      if (p !== "accept" && p !== "decline" && p !== "hold") throw new Error("policy.propose must be accept, decline or hold");
      this.policy = { propose: p, witnessed: args.witnessed === true };
      return { documents: [] };
    }
    if (action === "consent") {
      const ex = this.exchanges.get(String(args.exchangeId));
      if (ex === undefined || ex.state !== "held") throw new Error("no held proposal for that exchange");
      const reply = this.decide(ex, args.decision === "accept" ? "accept" : "decline");
      return { documents: [JSON.stringify(this.finish(reply, ex.proposal, reply.type.includes("/trust-task-error/")))] };
    }
    if (action === "witnessPresentation") return { documents: [JSON.stringify({ vp: this.witnessOracle.presentation(args) })] };
    if (action === "fault") {
      // `fault {claimStore: "unreadable" | "ok"}`: the duplicate record cannot (or can again) be read.
      if (args.claimStore !== "unreadable" && args.claimStore !== "ok") throw new Error("fault.claimStore must be unreadable or ok");
      this.claimFault = args.claimStore === "unreadable";
      return { documents: [] };
    }
    if (action === "twoPhase") {
      // `twoPhase {outcome: commit | abort | inflight, reason?, internal?, deliver?}`: the transaction of the next issue document.
      const o = args.outcome;
      if (o !== "commit" && o !== "abort" && o !== "inflight" && o !== "voteNo" && o !== "unknown") throw new Error("twoPhase.outcome must be commit, abort, inflight, voteNo or unknown");
      this.tx = {
        outcome: o, deliver: args.deliver !== false,
        ...(typeof args.reason === "string" ? { reason: args.reason } : {}),
        ...(typeof args.internal === "string" ? { internal: args.internal } : {}),
      };
      return { documents: [] };
    }
    if (action === "enrolExecutor") {
      // `enrolExecutor {vid}`: this device is enrolled with the executor, so it will prompt for its task-consent requests.
      if (typeof args.vid !== "string") throw new Error("enrolExecutor.vid must be a string");
      this.enrolled.add(args.vid);
      return { documents: [] };
    }
    if (action === "consentBinding") {
      // Helper (docs/04 section 4.4): `consentBinding {thread}` returns `{challenge, payloadDigest}` of the pending consent for the ceremony with this thread id.
      const c = this.ceremonies.get(String(args.thread));
      if (c === undefined) throw new Error("no pending ceremony in that thread");
      return { documents: [JSON.stringify(this.consentBinding(c))] };
    }
    if (action === "holdCredential") {
      // Helper: the IUT comes to hold a credential of this type (the type IRI DCQL `type_values` names).
      this.held.push([typeof args.type === "string" ? args.type : QUERY_CRED]);
      return { documents: [] };
    }
    if (action === "verifierTrust") {
      // Helper: the IUT's consent policy pre-trusts this verifier (its queries are answered at once).
      if (typeof args.vid !== "string") throw new Error("verifierTrust.vid must be a string");
      this.trusted.add(args.vid);
      return { documents: [] };
    }
    if (action === "queryDecision") {
      // Helper: the IUT's human decides a deferred query; approve returns the presentation the IUT then sends on the query's thread.
      const i = this.deferrals.findIndex((d) => String(d.threadId ?? d.id) === String(args.thread));
      if (i < 0) throw new Error("no deferred query in that thread");
      const [doc] = this.deferrals.splice(i, 1);
      const approved = args.decision === "approve";
      if (!approved) this.declined.add(String(doc!.threadId ?? doc!.id));
      if (!approved && !this.m("pushOnDecline")) return { documents: [] };
      const presentation = this.finish(this.queryPresentation(doc!), doc!, false);
      if (approved && args.tamper !== undefined) {
        // a harness stand-in (class D, src/ceremony/tamper.ts): the presentation this reference built is changed in ONE way and re-signed with its own key before it is pushed
        if (!isTamperMode(args.tamper)) throw new Error(`queryDecision: unknown tamper ${String(args.tamper)}`);
        const changed = JSON.parse(tamperDecision(JSON.stringify(presentation), args.tamper, this.signer, this.now())) as Record<string, unknown>;
        this.push.recordRaw(changed, String((presentation as unknown as Record<string, unknown>).recipient));
        return { documents: [JSON.stringify(changed)] };
      }
      this.push.onQueryDecision(presentation as unknown as Record<string, unknown>, approved);
      return approved ? { documents: [JSON.stringify(presentation)] } : { documents: [] };
    }
    if (action === "makeOffer") {
      // Helper (docs/20): the IUT as issuer opens an issuance thread by pushing an offer to `to`; returns the thread id.
      if (typeof args.to !== "string") throw new Error("makeOffer.to must be a string");
      return { documents: [JSON.stringify({ threadId: this.push.makeOffer(args.to, QUERY_CRED) })] };
    }
    if (action === "presentationNonce") {
      // Helper (docs/04 section 4.4): the IUT as verifier opens a presentation thread; returns the nonce it will accept there, once, and the thread id.
      const threadId = this.newId();
      const nonce = digestMultibase({ n: this.nonceCounter++, verifier: this.signer.did });
      this.nonces.set(threadId, { nonce, used: false });
      return { documents: [JSON.stringify({ nonce, threadId })] };
    }
    if (action === "ceremonyDeadline") {
      // `ceremonyDeadline {seconds}`: the approval window of ceremonies begun from now on (until reset); the default is seven days.
      const sec = args.seconds;
      if (typeof sec !== "number" || !Number.isInteger(sec) || sec < 1) throw new Error("ceremonyDeadline.seconds must be a positive whole number");
      this.cerWindowMs = sec * 1000;
      return { documents: [] };
    }
    if (action === "ceremonyEffect") {
      // `ceremonyEffect {outcome: commit | fail | unknown, reason?}`: what the establishing effect does when the next ceremony reaches quorum.
      const o = args.outcome;
      if (o !== "commit" && o !== "fail" && o !== "unknown") throw new Error("ceremonyEffect.outcome must be commit, fail or unknown");
      this.cerPlan = { outcome: o, ...(typeof args.reason === "string" ? { reason: args.reason } : {}) };
      return { documents: [] };
    }
    if (action === "settle" && this.cerPending !== undefined) {
      const { c, doc } = this.cerPending;
      this.cerPending = undefined;
      if (args.outcome === "abort") this.cerFail(c, typeof args.reason === "string" ? args.reason : "storeFailed");
      else this.cerCommit(c);
      return { documents: [JSON.stringify(this.cerFinish(doc, c, this.cerAnswer(c, doc), true))] };
    }
    if (action === "settle") {
      // `settle {outcome: commit | abort, reason?}`: the pending transaction resolves; returns the reply the IUT then emits.
      const p = this.pending;
      if (p === undefined) throw new Error("no transaction is in flight");
      this.pending = undefined;
      if (args.outcome === "abort") {
        this.states.set(String(p.doc.id), "errored");
        const e = this.abortError(p.doc, { outcome: "abort", deliver: true, ...(typeof args.reason === "string" ? { reason: args.reason } : {}) });
        return { documents: [JSON.stringify(this.finish(e, p.doc, true))] };
      }
      const reply = this.commitIssue(p.doc, p.ex, p.actual, p.digest);
      return { documents: [JSON.stringify(this.finish(reply, p.doc, false))] };
    }
    throw new Error(`unknown trigger ${action}`);
  }
  /** Restart: every durable record (duplicate record, exchanges, stored credentials, clock) survives. */
  async restart(): Promise<void> {
    if (this.m("restartForgetsClaims")) this.guard = this.makeGuard();
  }
  /** Optional capability `governance.declare` (docs/17): run under a deployment's declaration. Cleared by `reset`. */
  async declareGovernance(decl: GovernanceDeclaration): Promise<DeclareGovernanceResult> {
    if (this.gov === undefined) return { status: "unsupported", reason: "the reference declares no governance path unless started with governance" };
    return this.gov.declare(decl);
  }

  async reset(): Promise<void> {
    this.gov?.reset();
    this.guard = this.makeGuard();
    this.wit?.reset();
    this.handled = 0;
    this.counter = 0;
    this.states.clear();
    this.burned.clear();
    this.snapshots.clear();
    this.exchanges.clear();
    this.claimedRel.clear();
    this.relSigners.clear();
    this.partyRelCounter = 0;
    this.party.reset();
    for (const f of this.flows) f.reset();
    this.relCounter = 0;
    this.seeded.reset();
    this.claimFault = false;
    this.tx = { outcome: "commit", deliver: true };
    this.pending = undefined;
    this.ceremonies.clear();
    this.enrolled.clear();
    this.credentials = [];
    this.presentations = [];
    this.nonces.clear();
    this.push.clear();
    this.nonceCounter = 0;
    this.held = [];
    this.trusted.clear();
    this.deferrals = [];
    this.presented.clear();
    this.declined.clear();
    this.effects = 0;
    this.cerWindowMs = CER_WINDOW_MS;
    this.cerPlan = { outcome: "commit" };
    this.cerPending = undefined;
    this.retained.clear();
    this.lastMeta = "none";
    this.policy = { propose: "hold", witnessed: false };
    this.nowMs = undefined;
    this.witnessOracle.reset();
  }
  async snapshot(): Promise<string> {
    const id = `snap-${this.snapshots.size}`;
    this.snapshots.set(id, this.stateText());
    return id;
  }
  async diff(snapshotId: string): Promise<{ changed: boolean; detail?: string }> {
    const before = this.snapshots.get(snapshotId);
    const now = this.stateText();
    return before === now ? { changed: false } : { changed: true, detail: `${before} -> ${now}` };
  }
  private stateText(): string {
    return JSON.stringify({ handled: this.handled, states: [...this.states], stored: this.storedCount(), effects: this.effects, witness: this.witnessOracle.stateText(), credentials: this.credentials.length, presentations: this.presentations.length, deferrals: this.deferrals.length, ceremonies: [...this.ceremonies.values()].map((c) => [c.id, c.status, c.approvals.length]) });
  }

  async observe(q: ObserveQuery): Promise<ObserveResult> {
    switch (q.query) {
      case "handled":
        return { value: this.handled };
      case "stored":
        if (q.kind === "vwc") {
          const all = [...this.exchanges.values()].flatMap((e) => e.shared);
          return { value: (q.digest === undefined ? all.length : all.filter((d) => d === q.digest).length) + (q.digest === undefined ? this.witnessOracle.issuedCount() : 0) };
        }
        for (const f of this.flows) { const n = f.stored?.(q.kind); if (n !== undefined) return { value: n }; }
        if (q.kind === "session") return { value: this.witnessOracle.openCount() };
        if (q.kind === "ceremony-effect") return { value: this.effects };
        if (q.kind === "credential") return { value: q.digest === undefined ? this.credentials.length : this.credentials.filter((d) => d === q.digest).length };
        if (q.kind === "presentation") return { value: this.presentations.length };
        if (q.kind === "deferral") return { value: this.deferrals.length };
        return { value: q.kind === "vrc" ? this.storedCount() : this.handled };
      case "pushed":
        return this.push.box.observe(q);
      case "received":
        return this.party.received(q);
      case "ceremony":
        for (const f of this.flows) { const v = f.reading(q.threadId); if (v !== undefined) return { value: v }; }
        return this.party.ceremony(q.threadId);
      case "retained":
        return { value: this.retained.get(q.id)?.[q.side] ?? "" };
      case "documentState":
        return { value: this.states.get(q.id) ?? "unknown" };
    }
  }

  private storedCount(): number {
    return [...this.exchanges.values()].reduce((n, e) => n + e.stored.length, 0);
  }

  async verifyProof(params: { bytes: string }): Promise<ProofVerifyResult> {
    if (this.m("acceptUnverifiedProof")) return { valid: true };
    try {
      return { valid: verifyDocumentProof(JSON.parse(params.bytes), { nowMs: this.now() }).valid };
    } catch {
      return { valid: false };
    }
  }

  /** Helper layer (optional capability `receiptVerify`): the verifier rules of trust-ceremony-receipt 0.1 (receipt-verifier.ts). Stateless: it changes nothing a vector observes. */
  async verifyReceipt(params: VerifyReceiptParams): Promise<VerifyReceiptResult> {
    return verifyReceipt(params, this.now(), this.mutants);
  }

  /** Ceremony track (optional capability `initiate`, docs/25): start a VRC step towards a connected peer; the documents are returned unsent. */
  async initiate(params: InitiateParams): Promise<InitiateResult> {
    const flow = this.flows.find((f) => f.kinds.includes(params.kind));
    if (flow !== undefined) return flow.initiate(params);
    return this.party.initiate(params);
  }
  /** Ceremony track (optional capability `peer.connect`, docs/25). */
  async connect(params: ConnectParams): Promise<ConnectResult> {
    return this.party.connect(params);
  }

  /**
   * Producer class (optional capability `emit`): the document of a plain task's request variant as this implementation's builder
   * makes it (a schema-valid payload, addressed to the hinted recipient, issued now, signed where the specification requires a proof).
   * The mutants `emit*` each break one rule of what it emits.
   */
  async emit(params: { type: string; args?: Record<string, unknown> }): Promise<{ documents: string[] }> {
    const task = this.plainTasks.get(params.type);
    if (task === undefined) throw new Error(`this adapter emits no ${params.type}`);
    let payload = JSON.parse(JSON.stringify(task.validPayload)) as Record<string, unknown>;
    if (this.m("emitBadPayload")) {
      const req0 = Array.isArray(task.payloadSchema["required"]) ? (task.payloadSchema["required"] as string[])[0] : undefined;
      if (req0 !== undefined) delete payload[req0];
      else payload = { ...payload, conformanceUnknownMember: true };
    }
    const doc: Record<string, unknown> = { id: this.newId(), type: params.type, issuer: this.signer.did, issuedAt: this.stamp(), payload };
    if (typeof params.args?.recipient === "string" && !this.m("emitNoRecipient")) doc.recipient = params.args.recipient;
    if (this.m("emitNoIssuedAt")) delete doc.issuedAt;
    const signed = task.requestPolicy.isProofRequired && !this.m("emitNoProof") ? signDocument(doc, this.signer, { created: this.now() }) : doc;
    return { documents: [JSON.stringify(signed)] };
  }

  private spec(type: string): SpecPolicy {
    const witnessSpec = this.wit?.spec(type);
    if (witnessSpec !== undefined) return witnessSpec;
    for (const f of this.flows) {
      const fs = f.schema(type);
      if (fs !== undefined) {
        return { typeUri: type, isBearer: this.m("ignoreAudienceBinding"), isProofRequired: !this.m("proofOptional"), isRecipientRequired: true, isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
          payloadSchema: { type: "object", required: fs.required, properties: fs.properties, additionalProperties: this.m("openPayload") } satisfies MiniSchema };
      }
    }
    const closed = this.attested && !this.m("openPayload");
    const plain = this.plainTasks.get(type);
    if (plain !== undefined) {
      const schema = this.m("openPayload") ? { ...plain.payloadSchema, additionalProperties: true } : plain.payloadSchema;
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding") || this.m("recipientOptional"),
        isProofRequired: plain.requestPolicy.isProofRequired && !this.m("proofOptional"),
        isRecipientRequired: plain.requestPolicy.isRecipientRequired && !this.m("recipientOptional"),
        isIssuedAtRequired: plain.requestPolicy.isIssuedAtRequired && !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: schema,
      };
    }
    if (type === DISCOVERY_TYPE) {
      // Discovery (trust-task-discovery 0.4): proof RECOMMENDED, so required only by the attested profile; payload closed; at most 16 patterns.
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        isProofRequired: (this.attested || this.m("discoveryProofRequired")) && !this.m("proofOptional"),
        isRecipientRequired: true,
        isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: {
          type: "object", required: [],
          properties: { patterns: { type: "array", itemType: "string", ...(this.m("discoveryNoPatternBound") ? {} : { maxItems: this.m("discoveryBoundOffByOne") ? 15 : 16 }) } },
          additionalProperties: this.m("discoveryOpenPayload"),
        } satisfies MiniSchema,
      };
    }
    if (this.ceremony && this.cerTypes().includes(type)) {
      const begin = type === CER_BEGIN_TYPE;
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        isProofRequired: !this.m("proofOptional"),
        isRecipientRequired: true,
        isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: (begin
          ? { type: "object", required: ["name", "admins"], properties: { name: { type: "string" }, admins: { type: "array", itemType: "string" }, ext: { type: "object" } }, additionalProperties: this.m("openPayload") }
          : { type: "object", required: [], properties: { ext: { type: "object" } }, additionalProperties: this.m("openPayload") }) satisfies MiniSchema,
      };
    }
    if (this.dtg && this.dtgTypes().includes(type)) {
      const schemas: Record<string, MiniSchema> = {
        [CONSENT_DECISION_TYPE]: {
          type: "object", required: ["challenge", "payloadDigest", "decision"],
          properties: {
            challenge: { type: "string", pattern: "^.{16,}$" }, payloadDigest: { type: "string", pattern: "^[zuf].+$" }, decision: { type: "string", pattern: "^(approve|deny)$" },
            reason: { type: "string", pattern: "^.{0,500}$" }, actionId: { type: "string", pattern: "^.{1,128}$" }, evidence: { type: "object" }, ext: { type: "object" },
          },
          additionalProperties: this.m("openPayload"),
        },
        [CONSENT_REQUEST_TYPE]: {
          type: "object", required: ["challenge", "taskType", "payloadDigest", "sideEffects", "exposure", "effects", "requester", "approverSet", "minApprovals", "excludeRequester", "expiresAt"],
          properties: {
            challenge: { type: "string", pattern: "^.{16,}$" }, taskType: { type: "string" }, payloadDigest: { type: "string", pattern: "^[zuf].+$" },
            sideEffects: { type: "string", pattern: "^(none|mutating|destructive)$" }, exposure: { type: "object" }, effects: { type: "array" },
            consequences: { type: "array" }, subject: { type: "string" }, requester: { type: "string" }, requesterDeviceId: { type: "string" }, origin: { type: "string" },
            note: { type: "string", pattern: "^.{1,500}$" }, statePin: { type: "object" }, approverSet: { type: "string" }, minApprovals: { type: "number" },
            excludeRequester: { type: "boolean" }, expiresAt: { type: "string" }, ext: { type: "object" },
          },
          additionalProperties: this.m("openPayload"),
        },
        [CEX_ISSUE_TYPE]: {
          type: "object", required: [], properties: { credential_response: { type: "object" }, sealed: { type: "string", pattern: "^[\\s\\S]+$" }, ext: { type: "object" } },
          additionalProperties: this.m("openPayload"),
        },
        [CEX_PRESENT_TYPE]: {
          type: "object", required: ["vp_token"], properties: { vp_token: { type: "any" }, ext: { type: "object" } },
          additionalProperties: this.m("openPayload"),
        },
        [CEX_QUERY_TYPE]: {
          type: "object", required: this.m("qryPurposeOptional") ? ["dcql_query", "nonce"] : ["dcql_query", "nonce", "purpose"],
          properties: {
            dcql_query: { type: "object" }, nonce: { type: "string", pattern: "^[\\s\\S]+$" },
            purpose: { type: "string", pattern: this.m("qryPurposeOptional") ? "^[\\s\\S]*$" : this.m("qryPurposeUnbounded") ? "^[\\s\\S]+$" : "^[\\s\\S]{1,500}$" }, ext: { type: "object" },
          },
          additionalProperties: this.m("openPayload"),
        },
        [CEX_OFFER_TYPE]: { type: "object", required: ["credential_offer"], properties: { credential_offer: { type: "object" }, ext: { type: "object" } }, additionalProperties: this.m("openPayload") },
        [CEX_REQUEST_TYPE]: { type: "object", required: ["credential_request"], properties: { credential_request: { type: "object" }, ext: { type: "object" } }, additionalProperties: this.m("openPayload") },
        [CONSENT_GRANTED_TYPE]: {
          type: "object", required: ["status", "payloadDigest", "taskType"],
          properties: { status: { type: "string", pattern: this.m("grantedAnyStatus") ? "^.+$" : "^granted$" }, payloadDigest: { type: "string", pattern: "^[zuf].+$" }, taskType: { type: "string", pattern: "^[\\s\\S]+$" }, ext: { type: "object" } },
          additionalProperties: this.m("openPayload"),
        },
        [CONSENT_DECISION_01_TYPE]: {
          type: "object", required: ["challenge", "payloadDigest", "decision"],
          properties: {
            challenge: { type: "string", pattern: "^.{16,}$" }, payloadDigest: { type: "string", pattern: "^[zuf].+$" }, decision: { type: "string", pattern: "^(approve|deny)$" },
            reason: { type: "string", pattern: "^.{0,500}$" }, ext: { type: "object" },
            ...(this.m("dec01TakesNewMembers") ? { actionId: { type: "string", pattern: "^.{1,128}$" }, evidence: { type: "object" } } : {}),
          },
          additionalProperties: this.m("openPayload"),
        },
      };
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        // The proof is OPTIONAL for query, offer and granted (their proofRequirement); REQUIRED for the others.
        isProofRequired: [CEX_QUERY_TYPE, CEX_OFFER_TYPE, CONSENT_GRANTED_TYPE].includes(type) ? this.m("qryProofRequired") : !this.m("proofOptional"),
        isRecipientRequired: true,
        isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: schemas[type]!,
      };
    }
    if (this.witnessServed && WIT_TYPES.includes(type)) {
      const session = type === WIT_SESSION_01 || type.endsWith("/witness/session/0.2");
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        // the session request's proof is OPTIONAL (its responses' is REQUIRED); the submit request's is REQUIRED
        isProofRequired: !session && !this.m("proofOptional"),
        isRecipientRequired: true,
        isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: session
          ? ({ type: "object", required: ["parties"], properties: { parties: { type: "array", itemType: "string", maxItems: 2 }, ext: { type: "object" } }, additionalProperties: this.m("openPayload") } satisfies MiniSchema)
          // memberPresentation is new in 0.2 (witness/session/submit 0.2, payload.schema.json); the 0.1 payload does not have the member
          : ({ type: "object", required: ["vp"], properties: { vp: { type: "object" }, ...(type.endsWith("/submit/0.2") ? { memberPresentation: { type: this.m("wsMemberUntyped") ? "any" : "object" } } : {}), ext: { type: "object" } }, additionalProperties: this.m("openPayload") } satisfies MiniSchema),
      };
    }
    if (this.witnessShare && type === WSH_TYPE) {
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        isProofRequired: !this.m("proofOptional"),
        isRecipientRequired: true,
        isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: {
          type: "object", required: ["presentation", "outcomeEvidence"],
          properties: { presentation: { type: "object" }, outcomeEvidence: { type: "object" }, ext: { type: "object" } },
          additionalProperties: this.m("openPayload"),
        } satisfies MiniSchema,
      };
    }
    if (this.vrc && (type === PROPOSE_TYPE || type === ISSUE_TYPE)) {
      const propose = type === PROPOSE_TYPE;
      const schema: MiniSchema = propose
        ? {
            type: "object", required: ["relationshipDid"],
            properties: { relationshipDid: { type: "string", pattern: "^did:" }, witnessed: { type: "boolean" }, reason: { type: "string" }, ext: { type: "object" } },
            additionalProperties: this.m("openPayload"),
          }
        : {
            type: "object", required: ["vrc"],
            properties: { vrc: { type: "object" }, vrcDigestMultibase: { type: "string", pattern: DIGEST_PATTERN }, ext: { type: "object" } },
            additionalProperties: this.m("openPayload"),
          };
      return {
        typeUri: type,
        isBearer: this.m("ignoreAudienceBinding"),
        // propose: proof OPTIONAL (profile: required); issue: request proof REQUIRED by the specification.
        isProofRequired: (propose ? this.attested : true) && !this.m("proofOptional"),
        isRecipientRequired: true,
        // issue declares issuedAt REQUIRED; propose does not (the attested profile requires it everywhere).
        isIssuedAtRequired: (propose ? this.attested : true) && !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
        payloadSchema: schema,
      };
    }
    return {
      typeUri: CARRIER_TYPE,
      isBearer: this.m("ignoreAudienceBinding"),
      isProofRequired: this.attested && !this.m("proofOptional"),
      isRecipientRequired: this.attested,
      isIssuedAtRequired: !this.m("noFreshnessWindow") && !this.m("noTimeChecks"),
      payloadSchema: {
        type: "object",
        required: ["subject"],
        properties: { subject: { type: "string" } },
        additionalProperties: !closed,
      } satisfies MiniSchema,
    };
  }

  private checks(type: string): ConsumeChecks {
    // propose declares sideEffects none: no duplicate-execution record; issue is mutating (consequential).
    if (this.wit?.unguarded(type) === true || type === DISCOVERY_TYPE || (this.vrc && type === PROPOSE_TYPE) || (this.dtg && type === CONSENT_REQUEST_TYPE)) return notConsequentialChecks();
    if (this.plainTasks.get(type)?.requestPolicy.isIssuedAtRequired === false) return notConsequentialChecks();
    // a plain task with no issuedAt requirement and no window: nothing bounds the duplicate record either
    if (this.plainTasks.has(type) && (this.m("noFreshnessWindow") || this.m("noTimeChecks"))) return notConsequentialChecks();
    if (this.m("noReplayRecord")) return notConsequentialChecks();
    if (this.m("noTimeChecks")) return { freshness: DEFAULT_FRESHNESS, replay: { kind: "guard", guard: this.guard } };
    if (this.m("noFreshnessWindow")) return { freshness: DEFAULT_FRESHNESS, replay: { kind: "guard", guard: this.guard } };
    const base = consequentialChecks(this.guard);
    const w = this.window;
    const maxAgeMs = (this.m("wideWindow10min") ? 2 * w.maxAgeSeconds : w.maxAgeSeconds) * 1000;
    return { ...base, freshness: { ...CONSEQUENTIAL_FRESHNESS, maxAgeMs, skewMs: w.clockSkewSeconds * 1000, expiryHorizonMs: w.expiryHorizonSeconds * 1000 } };
  }

  private verifier(): ProofVerifier {
    return {
      verify: (doc) => {
        if (this.m("acceptUnverifiedProof")) return true;
        const v = verifyDocumentProof(doc, { nowMs: this.now() });
        if (!v.valid) return false;
        // task-consent/decision 0.2 (producer 1, consumer 1): the proof purpose is assertionMethod, in every tier.
        if (doc.type === CONSENT_DECISION_TYPE || doc.type === CONSENT_DECISION_01_TYPE) return this.m("consentAnyProofPurpose") || v.purpose === "assertionMethod";
        // auth/step-up/approve-response (every version): the proof is made for assertionMethod, and a proof made for another purpose is refused (0.7 consumer step 1a).
        const fixed = specifiedProofPurpose(doc.type);
        if (fixed !== undefined) return v.purpose === fixed;
        if (this.wit?.refusesPurpose(doc.type, String(v.purpose)) === true) return false;
        // witness/session and submit: the specifications fix no proofPurpose for the envelope, so either signing purpose is accepted in every tier
        if (this.witnessServed && WIT_TYPES.includes(String(doc.type))) return true;
        if (this.attested && !this.m("anyProofPurpose") && v.purpose !== "authentication") return false;
        return true;
      },
    };
  }

  /** Common finishing for every reply the IUT emits: addressing, timestamps, mutants, then signing. */
  private finish<T extends TrustTaskDocument<unknown>>(reply: T, request: TrustTaskDocument<unknown>, errorKind: boolean): T {
    const r = reply as Record<string, unknown>;
    if (!this.m("replyIssuerFromRequest")) r.issuer = this.signer.did;
    if (this.m("swapRecipientInReply")) r.recipient = this.signer.did;
    r.issuedAt = this.stamp();
    if (this.m("wrongReplyThread")) r.threadId = this.newId();
    if (this.m("reuseRequestIdInReply") && typeof request.id === "string") r.id = request.id;
    if (errorKind) {
      const p = r.payload as Record<string, unknown>;
      if (this.m("retryableAlways")) p.retryable = true;
      if (this.m("tooManyDetailMembers")) p.details = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
      if (this.m("leakRecipientInMessage") && p.code === "wrongRecipient") p.message = `${String(p.message)} (recipient ${String(request.recipient)})`;
      if (this.m("leakVerificationMethod") && p.code === "proofInvalid" && isObject(request.proof)) p.message = `${String(p.message)} (tried ${String(request.proof.verificationMethod)})`;
      if (this.m("errorWithoutRetryable")) delete p.retryable;
      if (this.m("oversizedDetails")) p.details = { pad: "x".repeat(5000) };
      if (this.m("leakIdentityInMessage")) p.message = `${String(p.message)} (issuer ${String(request.issuer)})`;
    }
    if (this.attested && !this.m("unsignedReplies") && typeof r.issuer === "string" && r.issuer === this.signer.did) {
      if (this.m("replySignedByOtherKey")) return signDocument(r, ed25519Signer(seedOf(0x43)), { created: this.now(), allowIssuerMismatch: true }) as unknown as T;
      return signDocument(r, this.signer, { created: this.now() }) as unknown as T;
    }
    return reply;
  }

  private refuse(doc: TrustTaskDocument<unknown>, code: string, message: string): ErrorResponse {
    return rejectWith(doc, this.newId(), toErrorPayload({ code: code as never, message, retryable: false }));
  }

  private mintRel(): string {
    const s = ed25519Signer(seedOf(0x80 + this.relCounter++));
    this.relSigners.set(s.did, s);
    return s.did;
  }

  /** What the small ceremony parties (vetting-party.ts) borrow from this adapter. */
  private flowHost(): FlowHost {
    const a = this;
    return {
      get did() { return a.signer.did; }, get signer() { return a.signer; }, now: () => a.now(), newId: () => a.newId(), stamp: () => a.stamp(),
      mutated: (id) => (a.mutants as ReadonlySet<string>).has(id), isConnected: (vid) => a.party.isConnected(vid),
      finish: (r, q, e) => a.finish(r as unknown as TrustTaskDocument<unknown>, q as unknown as TrustTaskDocument<unknown>, e) as unknown as FlowDoc,
      refuse: (q, code, message) => a.refuse(q as unknown as TrustTaskDocument<unknown>, code, message) as unknown as FlowDoc,
      pushDoc: (d) => a.push.pushDoc(d), holdsCredential: (digest) => a.credentials.includes(digest),
    };
  }

  /** What the ceremony-scenario helper (ceremony-party.ts) borrows from this adapter. */
  private partyHost(): ConstructorParameters<typeof CeremonyParty>[0] {
    const a = this;
    return {
      get did() { return a.signer.did; }, get signer() { return a.signer; }, now: () => a.now(), newId: () => a.newId(), stamp: () => a.stamp(),
      mutated: (id: CeremonyMutantId) => (a.mutants as ReadonlySet<string>).has(id),
      deliver: async (bytes: string, from: string) => { await a.send({ from: { kind: "actor", vid: from }, bytes }); },
      // a proposer's relationship identity: its own seed range, keyed on the party's key so two references never mint the same DID
      mintRel: () => ed25519Signer(seedOf(0xc0 + ((a.signerSeed + 3 * a.partyRelCounter++) & 0x3f))),
      relSigner: (did: string) => a.relSigners.get(did),
      exchange: (thread: string): ExchangeView | undefined => a.exchanges.get(thread),
      makeOffer: (to: string) => { const thread = a.push.makeOffer(to, QUERY_CRED); return { thread, doc: a.push.box.query({ to, type: CEX_OFFER_TYPE }).at(-1) ?? "{}" }; },
      newNonce: () => { const thread = a.newId(); const nonce = digestMultibase({ n: a.nonceCounter++, verifier: a.signer.did }); a.nonces.set(thread, { nonce, used: false }); return { thread, nonce }; },
      holdsCredential: (digest: string) => a.credentials.includes(digest),
      keptPresentation: (digest: string) => a.presentations.includes(digest),
      pushed: (q: { threadId: string; type: string }) => a.push.box.query(q).length,
      presentedOn: (thread: string) => a.presented.has(thread),
      declinedOn: (thread: string) => a.declined.has(thread),
      deferredOn: (thread: string) => a.deferrals.some((d) => String(d.threadId ?? d.id) === thread),
      witnessReading: (thread: string) => (a.wit?.mode === undefined ? undefined : a.wit.reading(thread)),
      held: (thread: string) => {
        const c = a.ceremonies.get(thread);
        if (c === undefined) return undefined;
        a.cerLapse(c);
        return { ...a.consentBinding(c), requester: c.proposer, k: a.essential.minApprovals, status: c.status };
      },
      adopt: (thread, ex) => { a.exchanges.set(thread, { id: thread, peer: ex.peer, theirRel: ex.theirRel, myRel: ex.myRel, state: "accepted", witnessedAsked: false, proposal: ex.proposal as unknown as TrustTaskDocument<unknown>, stored: [], shared: [] }); a.claimedRel.set(ex.theirRel, thread); },
    };
  }

  /** The IUT's answer to a proposal once its human has decided; the reply is unsigned here, `finish` addresses and signs it. */
  private decide(ex: Exchange, decision: "accept" | "decline"): TrustTaskDocument<unknown> {
    const doc = ex.proposal;
    if (decision === "decline") {
      ex.state = "declined";
      this.states.set(ex.id, "errored");
      if (this.m("declineAsResponse")) {
        return { id: this.newId(), threadId: ex.id, type: `${PROPOSE_TYPE}#response`, recipient: ex.peer, payload: { accept: false, relationshipDid: ex.myRel } } as TrustTaskDocument<unknown>;
      }
      return this.refuse(doc, this.m("declineWrongCode") ? "permissionDenied" : PROPOSE_DECLINED, "declined");
    }
    ex.state = "accepted";
    this.handled++;
    this.states.set(ex.id, "responded");
    const payload: Record<string, unknown> = { accept: true, relationshipDid: this.m("echoProposerDid") ? ex.theirRel : ex.myRel };
    const agrees = this.m("mirrorWitnessed") ? ex.witnessedAsked : ex.witnessedAsked && this.policy.witnessed;
    if (agrees) payload.witnessed = true;
    return { id: this.newId(), threadId: ex.id, type: `${PROPOSE_TYPE}#response`, recipient: ex.peer, payload } as TrustTaskDocument<unknown>;
  }

  private onPropose(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | void {
    const p = doc.payload as { relationshipDid: string; witnessed?: boolean };
    const peer = String(doc.issuer);
    // Profile checks (not specification text, see docs/07 O17 to O26): the DID is neither the sender's connection DID nor a reused one.
    if (p.relationshipDid === peer && !this.m("acceptConnectionDid")) return this.refuse(doc, "malformedRequest", "relationshipDid must not be the connection identifier");
    // A resubmission after a next-step is a new document (fresh id) on the exchange's thread: the exchange is keyed by the thread.
    const key = this.m("noResubmitThread") ? String(doc.id) : String(doc.threadId ?? doc.id);
    const existing = this.exchanges.get(key);
    // A thread belongs to its proposer: another party naming it is refused, not told the outcome.
    if (existing !== undefined && existing.peer !== peer && !this.m("proposeLeaksForeignOutcome")) return this.refuse(doc, "permissionDenied", "not permitted");
    const claimedBy = this.claimedRel.get(p.relationshipDid);
    if (claimedBy !== undefined && claimedBy !== key && !this.m("noRelationshipDidReuseCheck")) return this.refuse(doc, "malformedRequest", "relationshipDid already used in another exchange");
    this.claimedRel.set(p.relationshipDid, key);
    let ex = this.exchanges.get(key);
    if (ex !== undefined) {
      // Held: still awaited, so a further next-step. Decided: the outcome. Neither re-runs the decision or counts as a second execution.
      if (ex.state === "held") return this.nextStep(ex, doc);
      return this.outcome(ex, doc);
    }
    ex = { id: key, peer, theirRel: p.relationshipDid, myRel: this.mintRel(), state: "held", witnessedAsked: p.witnessed === true, proposal: doc, stored: [], shared: [] };
    this.exchanges.set(ex.id, ex);
    this.states.set(ex.id, "accepted");
    const mode: ProposePolicy = this.m("holdAutoAccepts") && this.policy.propose === "hold" ? "accept" : this.policy.propose;
    if (mode === "hold") {
      if (this.m("holdAnswersError")) return this.refuse(doc, "taskFailed", "decision pending");
      return this.nextStep(ex, doc);
    }
    return this.decide(ex, mode);
  }

  /** A held task is answered with a next-step (framework 8.6): the originating type with continuation resubmit, since propose has no status task. */
  private nextStep(ex: Exchange, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | void {
    if (this.m("silentHold")) return undefined;
    if (this.m("holdAnswersOk")) return { id: this.newId(), threadId: ex.id, type: "https://trusttasks.org/spec/trust-task-ok/0.1", recipient: ex.peer, payload: {} } as TrustTaskDocument<unknown>;
    const payload: Record<string, unknown> = {
      expects: this.m("holdEmptyExpects") ? [] : this.m("holdExpectsNoTypeUri") ? [{ reason: "pending" }] : [{ typeUri: this.m("holdExpectsOtherType") ? CARRIER_TYPE : PROPOSE_TYPE, reason: "the counterparty's decision is pending; resubmit the proposal to learn the outcome" }],
      continuation: this.m("holdContinuationProceed") ? "proceed" : "resubmit",
      message: this.m("holdMessageTooLong") ? "x".repeat(1100) : "decision pending",
    };
    if (!this.m("holdNoInResponseTo")) payload.inResponseTo = { typeUri: PROPOSE_TYPE, id: String(doc.id) };
    if (this.m("holdNextStepOpenPayload")) payload.note = "pending";
    return { id: this.newId(), threadId: ex.id, type: NEXT_STEP_TYPE, recipient: ex.peer, payload } as TrustTaskDocument<unknown>;
  }

  /** The answer to a resubmission once the human has decided: the acceptance again, or the decline. */
  private outcome(ex: Exchange, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    if (ex.state === "declined") return this.refuse(doc, PROPOSE_DECLINED, "declined");
    const payload: Record<string, unknown> = { accept: true, relationshipDid: ex.myRel };
    if (ex.witnessedAsked && this.policy.witnessed) payload.witnessed = true;
    return { id: this.newId(), threadId: ex.id, type: `${PROPOSE_TYPE}#response`, recipient: ex.peer, payload } as TrustTaskDocument<unknown>;
  }

  private onIssue(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    const p = doc.payload as { vrc: Record<string, unknown>; vrcDigestMultibase?: string };
    const ex = typeof doc.threadId === "string" ? this.exchanges.get(doc.threadId) : undefined;
    const bad = (m: string): ErrorResponse => this.refuse(doc, ISSUE_NOT_ACCEPTED, m);
    if (ex !== undefined && ex.peer !== doc.issuer && this.m("foreignThreadDistinct")) return this.refuse(doc, "permissionDenied", "this thread belongs to another party");
    if ((ex === undefined || ex.state !== "accepted" || ex.peer !== doc.issuer) && !this.m("acceptUnsolicited")) return bad("no accepted proposal for this delivery");
    const vrc = p.vrc;
    const subject = isObject(vrc.credentialSubject) ? vrc.credentialSubject.id : undefined;
    if (ex !== undefined && !this.m("noPartyBindingCheck") && !this.m("acceptUnsolicited") && (vrc.issuer !== ex.theirRel || subject !== ex.myRel)) return bad("credential parties do not match the accepted proposal");
    if (!this.m("noVcProofCheck")) {
      const v = verifyDocumentProof(vrc, { nowMs: this.now() });
      if (!v.valid) return bad("credential proof does not verify");
      if (v.purpose !== "assertionMethod" && !this.m("anyVcPurpose")) return bad("credential proof purpose is not assertionMethod");
    }
    const digest = this.m("copyDigest") ? String(p.vrcDigestMultibase) : digestMultibase(vrc);
    const stored = ex?.stored ?? [];
    const actual = digestMultibase(vrc);
    if (stored.length > 0 && !stored.includes(actual) && !this.m("noSecondVrcGuard")) return this.refuse(doc, ISSUE_ALREADY_ISSUED, "this exchange already holds a credential");
    // The document is valid and authorised: the effect runs as a transaction whose outcome the trigger `twoPhase` decides.
    const plan = this.tx;
    this.tx = { outcome: "commit", deliver: true };
    if (plan.outcome === "unknown") {
      // Coordinator fault: prepared, the outcome inquiry stays unresolved. Retryable indeterminate, still accepted, never guessed as responded.
      this.pending = { doc, ex, actual, digest };
      this.states.set(String(doc.id), "accepted");
      if (this.m("inflightAsResponded")) return this.receiptReply(doc, digest);
      const e = this.refuse(doc, "indeterminate", "the outcome is not yet known");
      e.payload.retryable = true;
      return e;
    }
    if (plan.outcome === "abort" || plan.outcome === "voteNo") {
      this.states.set(String(doc.id), "errored");
      if (this.m("abortStillStores")) this.storeVrc(ex, actual);
      if (this.m("respondOnPrepare")) return this.receiptReply(doc, digest);
      return this.abortError(doc, plan.outcome === "voteNo" && plan.reason === undefined ? { ...plan, reason: "storeFailed" } : plan);
    }
    if (plan.outcome === "inflight") {
      // Prepared, outcome unknown: accepted, no reply, nothing stored, and never guessed as responded.
      this.pending = { doc, ex, actual, digest };
      this.states.set(String(doc.id), "accepted");
      return this.m("inflightAsResponded") ? this.receiptReply(doc, digest) : undefined;
    }
    const reply = this.commitIssue(doc, ex, actual, digest);
    return plan.deliver ? reply : undefined;
  }

  private storeVrc(ex: Exchange | undefined, actual: string): void {
    if (ex === undefined) return;
    if (!ex.stored.includes(actual) || this.m("storeDuplicates")) ex.stored.push(actual);
  }

  /** The coordinator's outcome is `committed`: the effect exists, then (and only then) the receipt. */
  private commitIssue(doc: TrustTaskDocument<unknown>, ex: Exchange | undefined, actual: string, digest: string): TrustTaskDocument<unknown> {
    this.storeVrc(ex, actual);
    this.handled++;
    this.states.set(String(doc.id), "responded");
    return this.receiptReply(doc, digest);
  }

  private receiptReply(doc: TrustTaskDocument<unknown>, digest: string): TrustTaskDocument<unknown> {
    return { id: this.newId(), threadId: doc.threadId ?? doc.id, type: `${ISSUE_TYPE}#response`, issuer: this.signer.did, recipient: doc.issuer, issuedAt: this.stamp(), payload: { vrcDigestMultibase: digest } } as TrustTaskDocument<unknown>;
  }

  /** An aborted or failed transaction is `taskFailed` with a reason from the closed set; an unknown internal fact is an opaque internalError. */
  private abortError(doc: TrustTaskDocument<unknown>, plan: TxPlan): ErrorResponse {
    const internal = plan.internal;
    if (plan.reason !== undefined && TX_REASONS.includes(plan.reason)) {
      const e = this.refuse(doc, "taskFailed", this.m("abortLeaksInternalReason") && internal !== undefined ? `the exchange was not completed (${internal})` : "the exchange was not completed");
      e.payload.details = { reason: plan.reason };
      return e;
    }
    const e = this.refuse(doc, this.m("abortReasonFreeText") && internal !== undefined ? "taskFailed" : "internalError", this.m("abortLeaksInternalReason") && internal !== undefined ? `internal error (${internal})` : "internal error");
    if (this.m("abortReasonFreeText") && internal !== undefined) e.payload.details = { reason: internal };
    return e;
  }

  // ---------------------------------------------------------------- 3b-DTG tasks (groups TC and CEX, docs/04 section 11.5)

  /**
   * The binding of a ceremony held for approvals: challenge and payload digest, derived from the ceremony (the specification fixes
   * what the digest covers, not how a challenge is minted: task-consent/request 0.1, Binding).
   */
  private consentBinding(c: Ceremony): { challenge: string; payloadDigest: string } {
    const challenge = digestMultibase({ ceremonyId: c.id, purpose: "task-consent" });
    return { challenge, payloadDigest: digestMultibase({ challenge, payload: { content: c.content }, taskType: CER_BEGIN_TYPE }) };
  }

  private onDtg(doc: TrustTaskDocument<unknown>, myVid: string): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    switch (doc.type) {
      case CONSENT_REQUEST_TYPE:
        return this.onConsentRequest(doc);
      case CONSENT_DECISION_TYPE:
      case CONSENT_DECISION_01_TYPE:
        return this.onConsentDecision(doc);
      case CEX_ISSUE_TYPE:
        return this.onCredentialIssue(doc, myVid);
      case CEX_QUERY_TYPE:
        return this.onCredentialQuery(doc);
      case CEX_OFFER_TYPE:
        return this.onCredentialOffer(doc);
      case CEX_REQUEST_TYPE:
        return this.onCredentialRequest(doc);
      case CONSENT_GRANTED_TYPE:
        // task-consent/granted consumer 3: a notice for an unknown or already-resolved digest is dropped, not an error (this implementation has no pending task).
        this.handled++;
        return this.m("grantedUnknownIsError") ? this.refuse(doc, "taskFailed", "no pending task has this digest") : undefined;
      default:
        return this.onCredentialPresent(doc, myVid);
    }
  }

  /** task-consent/request: this device is the approver device. */
  private onConsentRequest(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse {
    const p = doc.payload as { requester: string; minApprovals: number; excludeRequester: boolean; expiresAt: string };
    if (!this.enrolled.has(String(doc.issuer)) && !this.m("consentRequestTrustsAnyone")) return this.refuse(doc, "task-consent/request:untrustedIssuer", "the issuer is not an executor this device is enrolled with");
    if (!Number.isInteger(p.minApprovals) || p.minApprovals < 1) return this.refuse(doc, "malformedRequest", "minApprovals must be at least 1");
    const expires = Date.parse(p.expiresAt);
    if (Number.isNaN(expires)) return this.refuse(doc, "malformedRequest", "expiresAt is not a timestamp");
    if (expires <= this.now() && !this.m("consentRequestPromptsExpired")) return this.refuse(doc, "expired", "the pending request has lapsed");
    if (p.excludeRequester && p.requester === this.signer.did && !this.m("consentRequestNoSelfExclusion")) return this.refuse(doc, "task-consent/request:notEligible", "this device is the requester");
    this.handled++;
    this.states.set(String(doc.id), "responded");
    return { id: this.newId(), threadId: doc.threadId ?? doc.id, type: `${CONSENT_REQUEST_TYPE}#response`, recipient: doc.issuer, payload: { status: "prompted" } } as TrustTaskDocument<unknown>;
  }

  /** task-consent/decision 0.2: this implementation is the executor; the pending request is a ceremony held for approvals. */
  private onConsentDecision(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse {
    const p = doc.payload as { challenge: string; payloadDigest: string; decision: string; actionId?: string; evidence?: unknown };
    const actor = String(doc.issuer);
    const code = (c: string): ErrorResponse => this.refuse(doc, `task-consent/decision:${c}`, "the decision was not accepted");
    // The evidence member must have the shape of one of the two kinds before anything else is read (closed union).
    if (p.evidence !== undefined) {
      const e = p.evidence as Record<string, unknown>;
      const ok = isObject(e) && ((e.kind === "webauthn" && isObject(e.assertion) && Object.keys(e).length === 2) || (e.kind === "approverSigned" && isObject(e.statement) && Object.keys(e).length === 2));
      if (!ok) return this.refuse(doc, "malformedRequest", "evidence is not one of the specified kinds");
    }
    let c = [...this.ceremonies.values()].find((x) => this.consentBinding(x).payloadDigest === p.payloadDigest);
    if (c === undefined && this.m("consentNoDigestCheck")) c = [...this.ceremonies.values()].find((x) => x.status === "pending");
    if (c !== undefined) this.cerLapse(c);
    const repeat = c !== undefined && c.status === "committed" && p.decision === "approve" && c.approvals.includes(actor);
    if (c === undefined || (c.status !== "pending" && !repeat)) return code("noPending");
    const binding = this.consentBinding(c);
    if (p.challenge !== binding.challenge && !this.m("consentNoChallengeCheck")) return code("challengeMismatch");
    if (p.actionId !== undefined && p.actionId !== c.id && !this.m("consentNoActionCheck")) return code("actionMismatch");
    if (!c.admins.includes(actor)) {
      if (this.m("consentNonApproverWrongCode")) return this.refuse(doc, "permissionDenied", "not permitted");
      if (!this.m("consentNonApproverApproves")) return code("notAnApprover");
    }
    // Evidence (a passkey assertion or an approver statement) cannot be verified here: it never verifies.
    if (p.evidence !== undefined && !this.m("consentEvidenceIgnored")) return code("evidenceInvalid");
    const reply = (status: string, extra: Record<string, unknown> = {}): TrustTaskDocument<unknown> => {
      this.states.set(String(doc.id), "responded");
      return { id: this.newId(), threadId: doc.threadId ?? doc.id, type: `${String(doc.type)}#response`, recipient: doc.issuer, payload: { status, payloadDigest: p.payloadDigest, ...(p.actionId === undefined ? {} : { actionId: p.actionId }), approvals: c!.approvals.length, ...extra } } as TrustTaskDocument<unknown>;
    };
    if (p.decision === "deny") {
      // Closes the pending request for every approver (consumer 9).
      if (!this.m("consentDenyKeepsPending")) {
        c.status = "aborted";
        this.states.set(c.beginId, "errored");
      }
      return reply("denied");
    }
    if (repeat) {
      if (this.m("consentReapproveSecondEffect")) {
        this.effects++;
        this.handled++;
      }
      return reply("granted");
    }
    if (!c.approvals.includes(actor) || this.m("consentDoubleApproveCounts")) c.approvals.push(actor);
    if (!this.cerQuorum(c)) {
      if (this.decisionHold) {
        this.states.set(String(doc.id), "responded");
        return { id: this.newId(), threadId: doc.threadId ?? doc.id, type: NEXT_STEP_TYPE, recipient: doc.issuer, payload: { expects: [{ typeUri: CONSENT_DECISION_TYPE, reason: "more approvals are needed" }], continuation: "resubmit", message: "approval recorded, more are needed", inResponseTo: { typeUri: CONSENT_DECISION_TYPE, id: String(doc.id) } } } as TrustTaskDocument<unknown>;
      }
      return reply("pending", { needed: c.admins.length });
    }
    this.cerCommit(c);
    return reply("granted");
  }

  /** The presentation that answers a query: a Data-Integrity VP over one held credential, bound to the query's nonce and to the verifier, on the query's thread. */
  private queryPresentation(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    this.presented.add(String(doc.threadId ?? doc.id));
    const nonce = (doc.payload as { nonce: string }).nonce;
    const vc = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "ConformanceCredential"], issuer: this.signer.did, validFrom: isoSeconds(this.now()), credentialSubject: { id: this.signer.did } }, this.signer, { created: this.now(), purpose: "assertionMethod" });
    const vp = signDocument({ "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: this.signer.did, verifiableCredential: [vc] }, this.signer, { created: this.now(), purpose: "authentication", controllerMember: "holder", challenge: this.m("qryPresentNoNonce") ? "not-the-query-nonce" : nonce, domain: String(doc.issuer) });
    this.states.set(String(doc.id), "responded");
    return { id: this.newId(), threadId: this.m("qryPresentOtherThread") ? this.newId() : doc.threadId ?? doc.id, type: CEX_PRESENT_TYPE, recipient: doc.issuer, payload: { vp_token: vp } } as TrustTaskDocument<unknown>;
  }

  /**
   * credential-exchange/query: this implementation is the holder. Candidates come only from the type index named by `meta` (no
   * discriminator, no candidates); a match is presented for a pre-trusted verifier, otherwise deferred and the verifier told so.
   */
  private onCredentialQuery(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse {
    const raw = (doc.payload as { dcql_query?: unknown }).dcql_query;
    const dcql = (isObject(raw) ? raw : {}) as { credentials?: { meta?: { type_values?: string[][] } }[] };
    const sets = (Array.isArray(dcql.credentials) ? dcql.credentials : []).flatMap((c) => (Array.isArray(c?.meta?.type_values) ? c.meta!.type_values! : []));
    const candidates = sets.length === 0 ? (this.m("qryEnumerates") ? this.held : []) : this.held.filter((h) => sets.some((t) => Array.isArray(t) && t.every((x) => h.includes(x))));
    if (candidates.length === 0 && !this.m("qryDefersUnmatched")) return this.refuse(doc, "credential-exchange/query:noMatch", "no credential satisfies the query");
    if (this.trusted.has(String(doc.issuer)) || this.m("qryAutoPresents")) {
      this.handled++;
      return this.queryPresentation(doc);
    }
    if (!this.m("qryNoDeferral")) {
      this.deferrals.push(doc);
      this.handled++;
    }
    const uniform = this.queryUniform && !this.m("qryRefusalDiscriminates");
    const e = this.refuse(doc, uniform ? "credential-exchange/query:noMatch" : "credential-exchange/query:consentRequired", uniform ? "no credential satisfies the query" : "the query was deferred for a decision");
    e.payload.retryable = !uniform;
    return e;
  }

  /** credential-exchange/offer: this implementation is the holder. It supports one credential configuration; an offer naming none it supports is said so. */
  private onCredentialOffer(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    const offer = (doc.payload as { credential_offer?: unknown }).credential_offer;
    const ids = isObject(offer) && Array.isArray(offer.credential_configuration_ids) ? offer.credential_configuration_ids : [];
    if (!ids.includes(QUERY_CRED) && !this.m("offerNoUnsupportedCode")) {
      this.push.onOfferRefused(doc, String(ids[0] ?? QUERY_CRED));
      return this.refuse(doc, "credential-exchange/offer:unsupportedCredential", "no offered credential configuration is supported");
    }
    this.handled++;
    this.push.onOfferAccepted(doc, String(ids.includes(QUERY_CRED) ? QUERY_CRED : ids[0] ?? QUERY_CRED));
    return undefined;
  }

  /** credential-exchange/request: this implementation is the issuer. It has made no offer, so every request corresponds to none. */
  private onCredentialRequest(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    if (this.m("reqAcceptsUnknownOffer")) {
      this.handled++;
      return undefined;
    }
    if (this.push.onRequest(doc)) {
      this.handled++;
      return undefined;
    }
    return this.refuse(doc, "credential-exchange/request:unknownOffer", "the request corresponds to no offer this issuer made");
  }

  /** credential-exchange/issue: this implementation is the holder (recipient). Accepted is silence: the task defines no response document. */
  private onCredentialIssue(doc: TrustTaskDocument<unknown>, myVid: string): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    for (const f of this.flows) {
      const why = (f as { checkStatement?: (d: FlowDoc) => string | undefined }).checkStatement?.(doc as unknown as FlowDoc);
      if (why !== undefined) return this.refuse(doc, "taskFailed", why);
    }
    const p = doc.payload as { credential_response?: Record<string, unknown>; sealed?: string };
    const both = p.credential_response !== undefined && p.sealed !== undefined;
    const neither = p.credential_response === undefined && p.sealed === undefined;
    if ((both && !this.m("cexAcceptsBoth")) || neither) return this.refuse(doc, "malformedRequest", "exactly one of credential_response and sealed is required");
    if (p.sealed !== undefined && !(both && this.m("cexAcceptsBoth"))) {
      // The reference holds no sealed-transfer key: the bundle cannot be processed.
      if (this.m("cexSealedStored")) return this.storeCredential(digestMultibase({ sealed: p.sealed }));
      return this.refuse(doc, CEX_ISSUE_UNSUPPORTED, "sealed bundles are not supported");
    }
    const credential = p.credential_response!.credential;
    if (typeof credential === "string" && this.m("cexStringStored")) return this.storeCredential(digestMultibase({ compact: credential }));
    if (typeof credential === "string") return this.refuse(doc, CEX_ISSUE_UNSUPPORTED, "SD-JWT credentials are not supported");
    if (!isObject(credential)) return this.refuse(doc, "malformedRequest", "credential_response carries no credential");
    if (!this.m("cexNoCredentialProofCheck")) {
      const v = verifyDocumentProof(credential, { nowMs: this.now() });
      if (!v.valid) return this.refuse(doc, "taskFailed", "the credential's issuer signature does not verify");
      if (v.purpose !== "assertionMethod" && !this.m("cexAnyCredentialPurpose")) return this.refuse(doc, "taskFailed", "the credential proof purpose is not assertionMethod");
    }
    const subject = isObject(credential.credentialSubject) ? credential.credentialSubject.id : undefined;
    if (this.attested && subject !== myVid && !this.m("cexAcceptsOtherSubject")) return this.refuse(doc, "permissionDenied", "the credential is about another party");
    return this.storeCredential(digestMultibase(credential));
  }

  private storeCredential(digest: string): undefined {
    if (this.m("cexNeverStores")) return undefined;
    if (!this.credentials.includes(digest) || this.m("cexStoresDuplicates")) this.credentials.push(digest);
    this.handled++;
    return undefined;
  }

  /** credential-exchange/present: this implementation is the verifier. The nonce comes from `trigger presentationNonce` (the thread it opened). */
  private onCredentialPresent(doc: TrustTaskDocument<unknown>, myVid: string): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    const token = (doc.payload as { vp_token: unknown }).vp_token;
    if (typeof token === "string") return this.refuse(doc, "taskFailed", "SD-JWT presentations are not supported");
    if (!isObject(token) && this.m("cexVpTokenUnchecked")) {
      this.presentations.push(digestMultibase({ raw: token as never }));
      this.handled++;
      return undefined;
    }
    if (!isObject(token)) return this.refuse(doc, "malformedRequest", "vp_token must be a string or an object");
    const vp = verifyDocumentProof(token, { nowMs: this.now(), controllerMember: "holder" });
    if (!vp.valid) return this.refuse(doc, "taskFailed", "the presentation proof does not verify");
    const proof = isObject(token.proof) ? token.proof : {};
    const thread = String(doc.threadId ?? doc.id);
    const issued = this.nonces.get(thread);
    const stale = issued === undefined || issued.used || issued.nonce !== proof.challenge;
    if (stale && !this.m("cexNoNonceCheck")) return this.refuse(doc, this.m("cexCodesSwapped") ? CEX_AUDIENCE : CEX_STALE_NONCE, "the presentation is not bound to a fresh nonce");
    if (proof.domain !== myVid && !this.m("cexNoAudienceCheck")) return this.refuse(doc, this.m("cexCodesSwapped") ? CEX_STALE_NONCE : CEX_AUDIENCE, "the presentation is bound to another audience");
    if (token.holder !== doc.issuer && this.attested && !this.m("cexHolderNotSender")) return this.refuse(doc, "permissionDenied", "the presenter is not the sender");
    const creds = Array.isArray(token.verifiableCredential) ? token.verifiableCredential : [];
    if (creds.length === 0 || !creds.every(isObject)) return this.refuse(doc, "malformedRequest", "the presentation carries no credential");
    if (!this.m("cexNoPresentedCredentialCheck")) {
      for (const cr of creds as Record<string, unknown>[]) {
        if (!verifyDocumentProof(cr, { nowMs: this.now() }).valid) return this.refuse(doc, "taskFailed", "a presented credential's issuer signature does not verify");
        const subject = isObject(cr.credentialSubject) ? cr.credentialSubject.id : undefined;
        if (this.attested && subject !== token.holder && !this.m("cexAcceptsOtherSubject")) return this.refuse(doc, "taskFailed", "a presented credential is about another party");
      }
    }
    if (issued !== undefined && !this.m("cexNonceReusable")) issued.used = true;
    if (!this.m("cexNeverStores")) this.presentations.push(digestMultibase(token));
    this.handled++;
    return undefined;
  }

  // ---------------------------------------------------------------- ceremony documents (group CER)

  private cerRefuse(doc: TrustTaskDocument<unknown>, reason: string): ErrorResponse {
    const e = this.refuse(doc, "taskFailed", "the ceremony was not completed");
    e.payload.details = { reason };
    return e;
  }

  /** A party that is not an administrator of the ceremony and a ceremony that does not exist get one and the same refusal. */
  private cerDeny(doc: TrustTaskDocument<unknown>): ErrorResponse {
    return this.refuse(doc, "permissionDenied", "not permitted");
  }

  /** A pending ceremony whose deadline has been reached becomes expired (half-open: the instant itself is late). */
  private cerLapse(c: Ceremony): void {
    if (c.status !== "pending" || this.m("cerNoDeadline")) return;
    const late = this.m("cerDeadlineInclusive") ? this.now() > c.deadlineMs : this.now() >= c.deadlineMs;
    if (late) {
      c.status = "expired";
      c.reason = "deadlineLapsed";
      this.states.set(c.beginId, "errored");
    }
  }

  private cerCommit(c: Ceremony): void {
    c.status = "committed";
    if (!this.m("cerRespondWithoutEffect")) {
      this.effects++;
      this.handled++;
    }
    this.states.set(c.beginId, "responded");
  }

  private cerFail(c: Ceremony, reason: string): void {
    c.status = "failed";
    c.reason = TX_REASONS.includes(reason) ? reason : "storeFailed";
    this.states.set(c.beginId, "errored");
  }

  private cerQuorum(c: Ceremony): boolean {
    const k = this.essential.minApprovals + (this.m("cerQuorumEarly") || this.lie === "completesEarly" ? -1 : this.m("cerQuorumLate") || this.lie === "completesLate" ? 1 : 0);
    return c.approvals.length >= (this.m("cerRespondOnFirstApproval") ? 1 : k);
  }

  /** The reply for the ceremony's current state to this document (a hold, the outcome, or the refusal). */
  private cerAnswer(c: Ceremony, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    switch (c.status) {
      case "pending":
        return this.cerHold(c, doc);
      case "committed":
        return { id: this.newId(), threadId: c.id, type: `${String(doc.type)}#response`, recipient: doc.issuer, payload: { ceremonyId: c.id, status: "committed", approvalCount: c.approvals.length, required: c.admins.length } } as TrustTaskDocument<unknown>;
      case "failed": {
        if (this.m("cerFailAsInternalError")) return this.refuse(doc, "internalError", "internal error");
        return this.cerRefuse(doc, c.reason ?? "storeFailed");
      }
      case "expired": {
        const first = !c.lapseAnswered;
        c.lapseAnswered = true;
        if (this.m("cerDeadlineExpiredCode")) return this.refuse(doc, "expired", "the approval deadline has passed");
        return this.cerRefuse(doc, !first && this.m("cerLateErrorUnstable") ? "notFound" : "deadlineLapsed");
      }
      case "aborted":
        return this.cerRefuse(doc, "notFound");
    }
  }

  /** A held ceremony is answered with a next-step (framework 8.6): `expects` names the status task where one is offered, else the originating type with resubmit. */
  private cerHold(c: Ceremony, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    if (this.m("cerHoldSilent")) return undefined;
    if (this.m("cerHoldAnswersError")) return this.refuse(doc, "taskFailed", "approvals pending");
    const awaited = Math.max(1, this.essential.minApprovals - c.approvals.length);
    const payload: Record<string, unknown> = this.ceremonyStatus && !this.m("cerHoldStatusNotNamed")
      ? {
        // A status task is offered: expects names it. The continuation is the reference's choice; the framework states no value for this case.
        expects: [{ typeUri: CER_STATUS_TYPE, reason: `${awaited} approval(s) are awaited; ask the status task for the outcome` }],
        ...(this.statusContinuation === "omit" ? {} : { continuation: this.statusContinuation }),
        message: "approvals pending",
      }
      : {
        expects: [{ typeUri: String(doc.type), reason: `${awaited} approval(s) are awaited; resubmit to learn the outcome` }],
        continuation: this.m("cerHoldContinuationProceed") ? "proceed" : "resubmit",
        message: "approvals pending",
      };
    if (!this.m("cerHoldNoInResponseTo")) payload.inResponseTo = { typeUri: String(doc.type), id: String(doc.id) };
    return { id: this.newId(), threadId: c.id, type: NEXT_STEP_TYPE, recipient: doc.issuer, payload } as TrustTaskDocument<unknown>;
  }

  /** After an approval is recorded: hold, or at quorum run the establishing effect as the plan says. */
  private cerAdvance(c: Ceremony, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    if (!this.cerQuorum(c)) return this.cerHold(c, doc);
    const plan = this.cerPlan;
    this.cerPlan = { outcome: "commit" };
    if (plan.outcome === "unknown") {
      // The effect's outcome cannot be read: the ceremony stays pending, the document accepted; never guessed as committed.
      this.cerPending = { c, doc };
      if (this.m("cerUnknownAsResponded")) return this.cerAnswerCommitted(c, doc);
      if (this.m("cerUnknownAsTaskFailed")) return this.refuse(doc, "taskFailed", "the outcome is not known");
      const e = this.refuse(doc, "indeterminate", "the outcome is not yet known");
      e.payload.retryable = !this.m("cerUnknownNotRetryable");
      return e;
    }
    if (plan.outcome === "fail") this.cerFail(c, plan.reason ?? "storeFailed");
    else this.cerCommit(c);
    return this.cerAnswer(c, doc);
  }

  private cerAnswerCommitted(c: Ceremony, doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    return { id: this.newId(), threadId: c.id, type: `${String(doc.type)}#response`, recipient: doc.issuer, payload: { ceremonyId: c.id, status: "committed", approvalCount: c.approvals.length, required: c.admins.length } } as TrustTaskDocument<unknown>;
  }

  /** Finish a ceremony reply: lifecycle state of the document, signature, and the verbatim retention of request and reply. */
  private cerFinish(doc: TrustTaskDocument<unknown>, c: Ceremony | undefined, r: TrustTaskDocument<unknown> | ErrorResponse | undefined, settled = false): TrustTaskDocument<unknown> | undefined {
    const type = r === undefined ? "" : String(r.type);
    const id = String(doc.id);
    if (r !== undefined) {
      if (type.endsWith("#response")) this.states.set(id, "responded");
      else if (type.includes("/trust-task-error/")) this.states.set(id, type.includes("/trust-task-error/") && (r.payload as { code?: string }).code === "indeterminate" ? "accepted" : "errored");
      else this.states.set(id, this.m("cerHoldPendingResponded") ? "responded" : "accepted");
    } else this.states.set(id, "accepted");
    const out = r === undefined ? undefined : this.finish(r as TrustTaskDocument<unknown>, doc, type.includes("/trust-task-error/"));
    if (settled) {
      const held = this.retained.get(id);
      if (held !== undefined && out !== undefined) held.reply = JSON.stringify(out);
    } else if (!this.m("cerRetainNothing")) {
      const request = this.m("cerRetainNormalised") ? canonicalJson(JSON.parse(this.lastBytes) as never) : this.lastBytes;
      this.retained.set(id, { request, ...(out === undefined ? {} : { reply: JSON.stringify(out) }) });
    }
    void c;
    return out;
  }

  private onCeremony(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | undefined {
    const actor = String(doc.issuer);
    const key = String(doc.threadId ?? doc.id);
    const kind = doc.type === CER_BEGIN_TYPE ? "begin" : doc.type === CER_APPROVE_TYPE ? "approve" : doc.type === CER_STATUS_TYPE ? "status" : "reset";
    let c = this.ceremonies.get(key);
    let r: TrustTaskDocument<unknown> | ErrorResponse | undefined;
    if (kind === "begin") {
      const p = doc.payload as { name: string; admins: string[] };
      const content = JSON.stringify([p.name, [...p.admins].sort()]);
      if ((!p.admins.includes(actor) && this.lie !== "anyPrincipalDecides") || (c !== undefined && c.proposer !== actor)) r = this.cerDeny(doc);
      else if (c !== undefined) {
        // A resubmission on the ceremony's thread (a fresh document): the outcome so far, never a second ceremony.
        this.cerLapse(c);
        if (c.content !== content) r = this.refuse(doc, "idConflict", "this ceremony exists with other content");
        else if (this.m("cerResubmitError")) r = this.refuse(doc, "taskFailed", "the ceremony exists");
        else {
          if (c.status === "committed" && this.m("cerResubmitSecondEffect")) {
            this.effects++;
            this.handled++;
          }
          r = this.cerAnswer(c, doc);
        }
      } else {
        c = { id: key, beginId: String(doc.id), proposer: actor, admins: [...p.admins], approvals: this.beginApproves() ? [actor] : [], status: "pending", deadlineMs: this.now() + this.cerWindowMs, content, lapseAnswered: false };
        this.ceremonies.set(key, c);
        this.states.set(c.beginId, "accepted");
        r = this.cerAdvance(c, doc);
      }
    } else if (c === undefined) {
      r = this.m("cerOracle") ? this.refuse(doc, "malformedRequest", "no such ceremony") : this.cerDeny(doc);
    } else if (!c.admins.includes(actor)) {
      if ((this.m("cerNonAdminApproves") || this.lie === "anyPrincipalDecides") && kind === "approve") {
        c.approvals.push(actor);
        r = this.cerAdvance(c, doc);
      } else r = this.m("cerNonAdminTaskFailed") ? this.refuse(doc, "taskFailed", "not permitted") : this.cerDeny(doc);
    } else if (kind === "status") {
      r = this.cerStatus(c, doc, actor);
    } else if (kind === "approve") {
      this.cerLapse(c);
      if (c.status === "pending") {
        if (!c.approvals.includes(actor) || this.m("cerDoubleApproveCountsTwice")) c.approvals.push(actor);
        r = this.cerAdvance(c, doc);
      } else if (c.status === "committed") {
        // Setting a state already set succeeds (SPEC.md 7.2, "Setting a state"): the outcome again, no second effect.
        if (this.m("cerReapproveAfterCommitError") && c.approvals.includes(actor)) r = this.cerRefuse(doc, "alreadyCommitted");
        else {
          if (this.m("cerReapproveSecondEffect")) {
            this.effects++;
            this.handled++;
          }
          r = this.cerAnswer(c, doc);
        }
      } else r = this.cerAnswer(c, doc);
    } else {
      this.cerLapse(c);
      const reset = (): ErrorResponse | TrustTaskDocument<unknown> => {
        c!.status = "aborted";
        return { id: this.newId(), threadId: c!.id, type: `${String(doc.type)}#response`, recipient: doc.issuer, payload: { ceremonyId: c!.id, status: "aborted" } } as TrustTaskDocument<unknown>;
      };
      if (c.status === "committed") {
        if (this.m("cerResetAfterCommit")) {
          this.effects--;
          r = reset();
        } else r = this.cerRefuse(doc, this.m("cerResetReasonWrong") ? "notAccepted" : "alreadyCommitted");
      } else if (c.status === "pending") r = this.m("cerResetPending") ? reset() : this.cerRefuse(doc, "notAccepted");
      else if (c.status === "failed") r = this.m("cerResetFailedRefused") ? this.cerRefuse(doc, "notAccepted") : reset();
      else if (c.status === "expired") r = this.m("cerResetExpiredRefused") ? this.cerRefuse(doc, "notAccepted") : reset();
      else r = this.cerRefuse(doc, "notFound");
    }
    return this.cerFinish(doc, c, r);
  }

  /** The status task: a read of the ceremony's state, answered with a response of its own type; it records no approval and runs no effect. */
  private cerStatus(c: Ceremony, doc: TrustTaskDocument<unknown>, actor: string): TrustTaskDocument<unknown> | ErrorResponse | undefined {
    this.cerLapse(c);
    if (this.m("cerStatusSilent")) return undefined;
    if (this.m("cerStatusError")) return this.refuse(doc, "taskFailed", "status unavailable");
    if (this.m("cerStatusAsNextStep") && c.status === "pending") return this.cerHold(c, doc);
    if (this.m("cerStatusApproves") && c.status === "pending" && !c.approvals.includes(actor)) {
      c.approvals.push(actor);
      return this.cerAdvance(c, doc);
    }
    if (this.m("cerStatusSecondEffect") && c.status === "committed") {
      this.effects++;
      this.handled++;
    }
    return { id: this.newId(), threadId: c.id, type: `${String(doc.type)}#response`, recipient: doc.issuer, payload: { ceremonyId: c.id, status: c.status, approvalCount: c.approvals.length, required: c.admins.length } } as TrustTaskDocument<unknown>;
  }

  private discover(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> {
    const given = (doc.payload as { patterns?: string[] }).patterns ?? [];
    const patterns = given.length === 0 ? (this.m("discoveryNoDefaultStar") ? [] : ["*"]) : this.m("discoveryFirstPatternOnly") ? given.slice(0, 1) : given;
    let base = this.typeList();
    if (this.m("discoveryOmitsServed")) base = base.filter((t) => t !== CARRIER_TYPE);
    if (this.m("discoveryListsUnserved")) base = [...base, "https://trusttasks.org/spec/conformance/gadget/0.1"];
    const slugOf = (t: string): string => /^https:\/\/trusttasks\.org\/spec\/(.+)\/\d+\.\d+$/.exec(t)?.[1] ?? t;
    const one = (pat: string, slug: string): boolean => {
      if (this.m("discoveryWildcardInterpreted") && pat.includes("*")) return new RegExp(`^${pat.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(slug);
      if (pat === "*") return true;
      if (pat.endsWith("/*")) return slug.startsWith(this.m("discoveryPrefixNoSlash") ? pat.slice(0, -2) : pat.slice(0, -1));
      return this.m("discoveryExactAsPrefix") ? slug.startsWith(pat) : slug === pat;
    };
    const matches = (slug: string): boolean => (this.m("discoveryIgnoresPatterns") ? true : this.m("discoveryAndSemantics") ? patterns.length > 0 && patterns.every((pt) => one(pt, slug)) : patterns.some((pt) => one(pt, slug)));
    let listed = base.filter((t) => matches(slugOf(t))).sort();
    if (this.m("discoveryUnsorted")) listed.reverse();
    if (this.m("discoveryDuplicates") && listed.length > 0) listed = [listed[0]!, ...listed];
    if (this.m("discoveryFragmentsListed")) listed = listed.map((t) => `${t}#request`);
    if (this.m("discoveryEmptyAsError") && listed.length === 0) return this.refuse(doc, "taskFailed", "nothing matches");
    const window: Record<string, number> = {
      maxAgeSeconds: this.m("discoveryWindowWiderMaxAge") ? 2 * this.window.maxAgeSeconds : this.window.maxAgeSeconds,
      clockSkewSeconds: this.m("discoveryWindowWiderSkew") ? 2 * this.window.clockSkewSeconds : this.window.clockSkewSeconds,
      expiryHorizonSeconds: this.m("discoveryHorizonWide") ? 2 * this.window.expiryHorizonSeconds : this.window.expiryHorizonSeconds,
    };
    return {
      id: this.newId(), threadId: doc.threadId ?? doc.id, type: `${DISCOVERY_TYPE}#response`, issuer: this.signer.did, recipient: doc.issuer, issuedAt: this.stamp(),
      payload: { supportedTypes: listed, frameworkVersion: this.m("discoveryTwoPartVersion") ? "0.6" : "0.6.0", acceptanceWindow: window },
    } as TrustTaskDocument<unknown>;
  }

  /** Decode a citation (multibase z, u or f) to its multihash: sha2-256 bytes, an algorithm this adapter does not implement, or garbage. */
  private decodeCitation(text: string): { kind: "sha256"; digest: Uint8Array } | { kind: "unknown" } | { kind: "invalid" } {
    let raw: Uint8Array;
    try {
      if (text.startsWith("z")) raw = fromMultibase(text);
      else if (text.startsWith("u")) raw = new Uint8Array(Buffer.from(text.slice(1), "base64url"));
      else if (text.startsWith("f") && /^f([0-9a-f]{2})+$/.test(text)) raw = new Uint8Array(Buffer.from(text.slice(1), "hex"));
      else return { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
    if (raw.length < 3) return { kind: "invalid" };
    if (raw[0] === 0x12 && raw[1] === 0x20 && raw.length === 34) return { kind: "sha256", digest: raw.subarray(2) };
    return { kind: "unknown" };
  }

  /** The witness-share receiver, checks in the order of docs/10 section 4; nothing is stored until every check passes. */
  private onShare(doc: TrustTaskDocument<unknown>): TrustTaskDocument<unknown> | ErrorResponse {
    const p = doc.payload as { presentation?: unknown; outcomeEvidence?: unknown };
    const bad = (m: string): ErrorResponse => this.refuse(doc, WSH_NOT_ACCEPTED, m);
    // 2. bundle shape (the payload schema of docs/10 section 3.2: a closed evidence object with both members)
    const ev = p.outcomeEvidence;
    const shapeOk = isObject(p.presentation) && isObject(ev) && isObject(ev.initiating) && isObject(ev.terminal) && Object.keys(ev).every((k) => k === "initiating" || k === "terminal");
    if (!shapeOk) return this.m("bundleShapeAsNotAccepted") ? bad("payload is not a presentation bundle") : this.refuse(doc, "malformedRequest", "payload is not a presentation bundle");
    const pres = p.presentation as Record<string, unknown>;
    const init = (ev as Record<string, unknown>).initiating as Record<string, unknown>;
    const term = (ev as Record<string, unknown>).terminal as Record<string, unknown>;
    // 3. accepted exchange, authorised by the exchange and nothing else
    const threadId = String(doc.threadId ?? doc.id);
    const ex = this.exchanges.get(threadId);
    if ((ex === undefined || ex.state !== "accepted" || ex.peer !== doc.issuer) && !this.m("acceptUnsolicited")) return bad("no accepted exchange with this sender");
    // 4.1 presentation: verifies, held by the sender's relationship DID, bound to this exchange and to this task
    const vp = verifyDocumentProof(pres, { nowMs: this.now(), controllerMember: "holder" });
    if (!vp.valid) return bad("presentation proof does not verify");
    if (ex !== undefined && pres.holder !== ex.theirRel) return bad("presentation holder is not the sender's relationship DID");
    const vpProof = pres.proof as Record<string, unknown>;
    if (!this.m("noChallengeCheck") && vpProof.challenge !== threadId) return bad("presentation challenge is not this exchange");
    if (!this.m("noDomainCheck") && vpProof.domain !== WSH_DOMAIN) return bad("presentation domain is not witness-share");
    // 4.2 exactly one credential
    const creds = pres.verifiableCredential;
    if (!Array.isArray(creds) || creds.length !== 1 || !isObject(creds[0])) return bad("presentation does not carry exactly one credential");
    const vwc = creds[0];
    // 4.3 the credential's own proof, independent of the evidence
    if (!this.m("noCredentialProof") && !verifyDocumentProof(vwc, { nowMs: this.now() }).valid) return bad("credential proof does not verify");
    const subject = isObject(vwc.credentialSubject) ? vwc.credentialSubject : {};
    const citation = (k: string): unknown => vwc[k] ?? subject[k];
    // 4.4 the citation
    if (typeof citation("taskContext") !== "string" || typeof citation("taskDigestMultibase") !== "string") return bad("credential carries no citation of the session document");
    if (!this.m("noTaskContextCheck") && init.id !== citation("taskContext")) return bad("citation does not name the initiating document");
    if (!this.m("noCitationDigest")) {
      const { proof: _top, ...unsigned } = init;
      let input: unknown = unsigned;
      if (this.m("digestIncludesProof")) input = init;
      else if (this.m("digestPlaceholderProof") && init.proof === undefined) input = { ...unsigned, proof: null };
      else if (this.m("digestStripsNestedProof")) input = JSON.parse(JSON.stringify(unsigned), (k, v) => (k === "proof" ? undefined : v));
      const cited = String(citation("taskDigestMultibase"));
      const dec = this.decodeCitation(cited);
      if (dec.kind === "invalid") return bad("citation digest is not a multibase multihash");
      if (dec.kind === "unknown") {
        if (!this.m("unknownMultihashFallsBackToId")) return bad("citation names a hash this verifier does not implement");
      } else if (this.m("compareDigestStrings")) {
        if (cited !== digestMultibase(input)) return bad("task digest does not reproduce");
      } else if (!Buffer.from(createHash("sha256").update(jcsBytes(input)).digest()).equals(Buffer.from(dec.digest))) return bad("task digest does not reproduce");
    }
    // 4.5 the terminal pairs with the initiating document
    const initThread = typeof init.threadId === "string" ? init.threadId : init.id;
    if (!this.m("noTerminalThread") && term.threadId !== initThread) return bad("terminal is not on the initiating document's thread");
    const ttype = typeof term.type === "string" ? term.type : "";
    const ver = /\/witness\/session\/(\d+\.\d+)$/.exec(String(init.type))?.[1];
    if (!this.m("terminalErrorAccepted")) {
      if (ttype.includes("/trust-task-error/") || !ttype.endsWith("#response")) return bad("terminal is not a response");
      if (!this.m("anyResponseType") && (ver === undefined || ttype !== `https://trusttasks.org/spec/witness/session/submit/${ver}#response`)) return bad("terminal is not the declared outcome-evidence type");
    }
    if (!this.m("noTerminalProof")) {
      if (term.proof === undefined) return bad("terminal carries no proof");
      const tv = verifyDocumentProof(term, { nowMs: this.now() });
      if (!tv.valid) return bad("terminal proof does not verify");
      if (!this.m("terminalSignedByIssuerOnly") && tv.signer !== init.recipient) return bad("terminal is not signed by the initiating document's recipient");
    }
    // 6 subject binding, 7 parties binding
    if (ex !== undefined && !this.m("noSubjectBinding") && subject.id !== ex.theirRel) return bad("credential is not about the sender's relationship DID");
    const initPayload = isObject(init.payload) ? init.payload : {};
    const partyList = (Array.isArray(subject.parties) ? subject.parties : initPayload.parties) as unknown;
    if (ex !== undefined && !this.m("noPartiesBinding") && !(Array.isArray(partyList) && partyList.includes(ex.theirRel) && partyList.includes(ex.myRel))) return bad("credential parties do not name this exchange");
    // 8 store, idempotent on the credential digest; 9 receipt by read-back
    const actual = digestMultibase(vwc);
    if (ex !== undefined && (!ex.shared.includes(actual) || this.m("wshStoresDuplicates"))) ex.shared.push(actual);
    this.handled++;
    this.states.set(String(doc.id), "responded");
    const digest = this.m("wshDigestOverPresentation") ? digestMultibase(pres) : actual;
    return { id: this.newId(), threadId, type: `${WSH_TYPE}#response`, issuer: this.signer.did, recipient: doc.issuer, issuedAt: this.stamp(), payload: { vwcDigestMultibase: digest } } as TrustTaskDocument<unknown>;
  }

  async send(params: SendParams): Promise<SendResult> {
    if (params.http === undefined || !this.https) return this.sendCore(params);
    return this.sendHttp(params, params.http);
  }

  /** The HTTPS binding (bindings/https/0.3) around the same consumer: request line, status mapping, content type. */
  private async sendHttp(params: SendParams, line: NonNullable<SendParams["http"]>): Promise<SendResult> {
    const refused = (status: number): SendResult => {
      if (this.m("httpRefusalAsErrorDoc")) {
        const e = { id: this.newId(), type: `${ERROR_TYPE_PREFIX}0.6`, issuer: this.signer.did, issuedAt: this.stamp(), payload: { code: "malformedRequest", message: "not found", retryable: false } };
        return { replies: [JSON.stringify(e)], transport: { kind: "document", status, contentType: "application/json" }, quiescentAfterMs: 0 };
      }
      return { replies: [], transport: { kind: "refused", status }, quiescentAfterMs: 0 };
    };
    const method = line.method ?? "POST";
    const path = line.path ?? "/trust-tasks";
    if (path !== "/trust-tasks" && !this.m("httpAnyPath")) return refused(404);
    if (method !== "POST" && !this.m("httpAnyMethod")) return refused(this.m("httpMethodStatus400") ? 400 : 405);
    if (this.m("httpNoAuthIs401") && params.from.kind === "none") return refused(401);
    let bytes = params.bytes;
    if (this.m("httpVerifyOverTypedDoc")) {
      try {
        const known = ["id", "type", "threadId", "parentThreadId", "issuer", "recipient", "issuedAt", "expiresAt", "payload", "proof", "ext", "extCritical"];
        const o = JSON.parse(bytes) as Record<string, unknown>;
        bytes = JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => known.includes(k))));
      } catch {
        /* undecodable: handled below */
      }
    }
    const r = await this.sendCore({ ...params, bytes });
    const json = "application/json";
    const flat = (code: string): number => (this.m("httpErrorAs200") ? 200 : this.m("httpStatusFlat") ? 400 : HTTP_STATUS[code] ?? 422);
    let status: number | undefined;
    if (r.replies.length === 1) {
      const doc = JSON.parse(r.replies[0]!) as { type?: string; payload?: { code?: string } };
      const isErr = String(doc.type).includes("/trust-task-error/");
      status = isErr ? flat(String(doc.payload?.code)) : 200;
      if (this.lastMeta === "dupReply" && this.m("httpDuplicateStatusSwapped")) return { replies: [], transport: { kind: "none", status: 202 }, quiescentAfterMs: 0 };
      return { ...r, transport: { ...r.transport, status, contentType: this.m("httpWrongContentType") ? "text/plain" : json } };
    }
    const swapped = this.m("httpDuplicateStatusSwapped");
    if (this.lastMeta === "dupInflight") status = swapped ? 204 : 202;
    else if (this.lastMeta === "dupDone") status = swapped ? 202 : 204;
    else if (this.lastMeta === "inboundError") status = 204;
    else if (this.lastMeta === "undecodable") status = 400;
    return { ...r, transport: { ...r.transport, ...(status === undefined ? {} : { status }) } };
  }

  private async sendCore(params: SendParams): Promise<SendResult> {
    this.lastMeta = "none";
    this.lastBytes = params.bytes;
    const out = (replies: unknown[], kind: SendResult["transport"]["kind"] = "document"): SendResult => ({
      replies: replies.map((r) => JSON.stringify(r)),
      transport: { kind: replies.length === 0 ? "none" : kind },
      quiescentAfterMs: 0,
    });

    let doc: TrustTaskDocument<unknown>;
    try {
      const parsed: unknown = JSON.parse(params.bytes);
      if (!isObject(parsed)) throw new Error("not an object");
      doc = parsed as unknown as TrustTaskDocument<unknown>;
    } catch {
      if (this.m("acceptGarbage")) {
        return out([this.finish({ id: this.newId(), type: CARRIER_RESPONSE_TYPE, payload: {} } as TrustTaskDocument<unknown>, {} as TrustTaskDocument<unknown>, false)]);
      }
      this.lastMeta = "undecodable";
      return out([]);
    }

    const type = typeof doc.type === "string" ? doc.type : "";
    // The ceremony-scenario members (docs/25): every arrival is kept in the inbox, and an answer to a step this party started is handled by the party, never answered.
    this.party.note(doc as unknown as Record<string, unknown>, params.from.kind === "none" ? "" : params.from.vid);
    if (this.dtg && this.ceremony && !this.consentDecisionVersions.includes("0.2") && type === CONSENT_DECISION_TYPE) {
      // an older executor: the type is recognised, the version is not served (framework 5.2; the refusal names what is served, as a VTA's does)
      const e = rejectWith(doc, this.newId(), toErrorPayload({ code: "unsupportedVersion" as never, message: "this executor serves task-consent/decision 0.1 only", retryable: false, details: { servedVersions: [CONSENT_DECISION_01_TYPE] } } as never));
      return out([this.finish(e, doc, true)]);
    }
    const owner = this.flows.find((f) => f.owns(doc as unknown as FlowDoc));
    if (owner !== undefined) return out((owner.receive(doc as unknown as FlowDoc) ?? []).map((r) => this.finish(r as unknown as TrustTaskDocument<unknown>, doc, errorKindOf(r))));
    if (this.party.owns(doc as unknown as Record<string, unknown>)) {
      this.party.receive(doc as unknown as Record<string, unknown>);
      return out([]);
    }
    if (type.includes("/trust-task-error/")) {
      // An inbound error is never answered (framework section 8: no error loops).
      if (this.m("errorFlipsState")) {
        const about = (doc.payload as { inResponseTo?: { id?: string } } | undefined)?.inResponseTo?.id;
        if (typeof about === "string") this.states.set(about, "errored");
      }
      if (this.m("answerInboundErrors")) {
        const e = rejectWith(doc, this.newId(), toErrorPayload({ code: "malformedRequest", message: "unexpected error", retryable: false }));
        return out([this.finish(e, doc, true)]);
      }
      this.lastMeta = "inboundError";
      return out([]);
    }
    if (this.m("controlProofFirst") && type.includes("/trust-task-control/") && doc.proof === undefined) {
      return out([this.finish(this.refuse(doc, "proofRequired", "proof required"), doc, true)]);
    }
    if (this.m("controlAccepted") && type.includes("/trust-task-control/")) {
      return out([this.finish({ id: this.newId(), threadId: doc.threadId ?? doc.id, type: `${type.split("#")[0]}#response`, recipient: doc.issuer, payload: {} } as TrustTaskDocument<unknown>, doc, false)]);
    }
    if (this.m("noTypeCheck") && type !== "" && !type.includes("/trust-task-error/")) {
      doc = { ...doc, type: CARRIER_TYPE };
    }

    if (this.m("lenientEnvelope")) {
      doc = { ...doc, id: doc.id ?? this.newId(), type: type === "" ? CARRIER_TYPE : doc.type, payload: doc.payload ?? { subject: "did:web:lenient.example" } };
    }
    if (this.m("noTimeChecks")) {
      const { issuedAt: _i, expiresAt: _e, ...rest } = doc as Record<string, unknown>;
      doc = rest as unknown as TrustTaskDocument<unknown>;
    }
    if (this.m("rollOverDates")) {
      const roll = (v: unknown): unknown => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : v);
      doc = { ...doc, ...(doc.issuedAt === undefined ? {} : { issuedAt: roll(doc.issuedAt) as string }), ...(doc.expiresAt === undefined ? {} : { expiresAt: roll(doc.expiresAt) as string }) };
    }
    if ((this.m("burnIdOnRefusal") || this.m("claimStoreFaultBurnsId")) && typeof doc.id === "string" && this.burned.has(doc.id)) {
      const e = rejectWith(doc, this.newId(), toErrorPayload({ code: "idConflict", message: "id already used", retryable: false }));
      return out([this.finish(e, doc, true)]);
    }
    const transport =
      params.from.kind === "none" || this.m("ignoreTransportIdentity")
        ? new UnauthenticatedTransport()
        : new StaticTransport({ issuer: params.from.vid });
    const myVid = this.m("noRecipientCheck") && typeof doc.recipient === "string" ? doc.recipient : this.signer.did;

    let outcome: Awaited<ReturnType<typeof consumeInbound>>;
    try {
      outcome = await this.consume(transport, type, doc, myVid);
    } catch (err) {
      if (!this.claimFault) throw err;
      // The duplicate record cannot be read: fail closed (framework 7.2 item 11 cannot be honoured), never as taskFailed.
      if (this.m("claimStoreFaultBurnsId") && typeof doc.id === "string") this.burned.add(doc.id);
      const taskFailed = this.m("claimStoreFailsAsTaskFailed");
      const e = rejectWith(doc, this.newId(), toErrorPayload({ code: taskFailed ? "taskFailed" : "unavailable", message: "temporarily unable to process", retryable: !taskFailed }));
      return out([this.finish(e, doc, true)]);
    }
    const res = this.reply(out, doc, outcome);
    const mutated = this.party.mutateReplies(doc as unknown as Record<string, unknown>, res.replies);
    return mutated.length === res.replies.length && mutated.every((t, i) => t === res.replies[i]) ? res : { ...res, replies: mutated, transport: { ...res.transport, kind: mutated.length === 0 ? "none" : res.transport.kind } };
  }

  /** The mutant `lookupFirst`: a payload naming a room or namespace the reference does not hold is not validated (the lookup that follows fails first). */
  private lookupFirstValidator(type: string): PayloadValidator {
    const task = this.plainTasks.get(type);
    return { validate: (schema, payload) => (task !== undefined && this.seeded.unknownObject(task, payload) ? { ok: true, errors: [] } : miniValidator.validate(schema, payload)) };
  }

  private consume(transport: StaticTransport | UnauthenticatedTransport, type: string, doc: TrustTaskDocument<unknown>, myVid: string): ReturnType<typeof consumeInbound> {
    return consumeInbound({
      transport,
      spec: this.spec(type),
      proofPolicy: { kind: "verify", verify: this.verifier() },
      payloadPolicy: this.m("noPayloadValidation") ? { kind: "acceptUnvalidated" } : { kind: "validate", validate: this.m("lookupFirst") ? this.lookupFirstValidator(type) : miniValidator },
      checks: this.checks(type),
      doc,
      myVid,
      now: this.m("windowOffByOne") ? this.now() - 1 : this.now(),
      newErrorId: () => this.newId(),
      clock: () => this.stamp(),
      handler: (accepted) => {
        if (this.wit?.serves(accepted.type) === true) return this.wit.handle(accepted as TrustTaskDocument<unknown>);
        const flow = this.flows.find((f) => f.types().includes(accepted.type));
        if (flow !== undefined) {
          const r = flow.handle(accepted as unknown as FlowDoc);
          return r === undefined ? undefined : this.finish(r as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, errorKindOf(r));
        }
        if (accepted.type === DISCOVERY_TYPE) {
          const d = accepted as TrustTaskDocument<unknown>;
          this.states.set(d.id, "responded");
          const r = this.discover(d);
          return this.finish(r, d, String(r.type).includes("/trust-task-error/"));
        }
        if (this.ceremony && this.cerTypes().includes(accepted.type)) {
          const d = accepted as TrustTaskDocument<unknown>;
          return this.onCeremony(d);
        }
        if (this.dtg && this.dtgTypes().includes(accepted.type)) {
          const d = accepted as TrustTaskDocument<unknown>;
          const r = this.onDtg(d, myVid);
          return r === undefined ? undefined : this.finish(r as TrustTaskDocument<unknown>, d, String(r.type).includes("/trust-task-error/"));
        }
        if (this.witnessServed && WIT_TYPES.includes(accepted.type)) {
          const d = accepted as TrustTaskDocument<unknown>;
          const r = this.witnessOracle.handle(d as unknown as Record<string, unknown>) as unknown as TrustTaskDocument<unknown>;
          const isErr = String(r.type).includes("/trust-task-error/");
          if (!isErr) {
            this.handled++;
            this.states.set(d.id, "responded");
          }
          const f = this.finish(r, d, isErr);
          return isErr ? f : (this.witnessOracle.seal(f as unknown as Record<string, unknown>) as unknown as TrustTaskDocument<unknown>);
        }
        if (this.vrc && (accepted.type === PROPOSE_TYPE || accepted.type === ISSUE_TYPE || (this.witnessShare && accepted.type === WSH_TYPE))) {
          const d = accepted as TrustTaskDocument<unknown>;
          const r = accepted.type === PROPOSE_TYPE ? this.onPropose(d) : accepted.type === ISSUE_TYPE ? this.onIssue(d) : this.onShare(d);
          return r === undefined ? undefined : this.finish(r as TrustTaskDocument<unknown>, d, String(r.type).includes("/trust-task-error/"));
        }
        if (this.gov !== undefined && GOV_TYPES.includes(accepted.type)) {
          const g = this.gov.handle(accepted.type, String(accepted.issuer), (accepted.payload ?? {}) as Record<string, unknown>);
          if (g !== undefined) {
            this.handled++;
            this.states.set(accepted.id, "responded");
            const d = accepted as TrustTaskDocument<unknown>;
            if (g.kind === "error") {
              const e = rejectWith(d, this.newId(), toErrorPayload({ code: g.code as never, message: g.message, retryable: false, ...(g.details === undefined ? {} : { details: g.details }) } as never));
              return this.finish(e, d, true);
            }
            const task = this.plainTasks.get(accepted.type)!;
            return this.finish({ id: this.newId(), threadId: accepted.threadId ?? accepted.id, type: task.responseTypeUri, issuer: this.signer.did, recipient: accepted.issuer, issuedAt: this.stamp(), payload: g.payload } as TrustTaskDocument<unknown>, d, false);
          }
        }
        const plainTask = this.plainTasks.get(accepted.type);
        if (plainTask !== undefined) {
          // O-02: the mutant `noPayloadValidation` is a platform that never validates and then acts on the payload: it answers the task's success response. It must not
          // fall into the task's own refusals (a standing code such as notAMember, a not-found code), which the payload negatives now accept beside malformedRequest.
          const acts = this.m("noPayloadValidation");
          const twoL = acts ? undefined : twoLRefusal(plainTask, accepted as { issuer: string; payload: unknown }, (id) => this.m(id));
          if (twoL !== undefined) {
            this.states.set(accepted.id, "errored");
            return this.finish(this.refuse(accepted as TrustTaskDocument<unknown>, twoL.code, twoL.message) as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, true);
          }
          if (this.m("lookupFirst") && this.seeded.unknownObject(plainTask, (accepted as { payload: unknown }).payload)) {
            this.states.set(accepted.id, "errored");
            return this.finish(this.refuse(accepted as TrustTaskDocument<unknown>, "taskFailed", "no such room or namespace") as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, true);
          }
          const reissued = this.seeded.reissueRefusal(plainTask, (accepted as { payload: unknown }).payload, (id) => (this.mutants as Set<string>).has(id));
          if (reissued !== undefined) {
            this.states.set(accepted.id, "errored");
            return this.finish(this.refuse(accepted as TrustTaskDocument<unknown>, reissued.code, reissued.message) as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, true);
          }
          const behaviour = acts ? undefined : behaviourRefusal(plainTask, (accepted as { payload: unknown }).payload, (id) => (this.mutants as Set<string>).has(id));
          if (behaviour !== undefined) {
            this.states.set(accepted.id, "errored");
            return this.finish(this.refuse(accepted as TrustTaskDocument<unknown>, behaviour.code, behaviour.message) as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, true);
          }
          if (this.m("plainInternalError")) {
            this.states.set(accepted.id, "errored");
            return this.finish(this.refuse(accepted as TrustTaskDocument<unknown>, "internalError", "refused") as unknown as TrustTaskDocument<unknown>, accepted as TrustTaskDocument<unknown>, true);
          }
          this.handled++;
          if (plainTask.responseSchema === undefined) {
            this.states.set(accepted.id, "accepted");
            return undefined;
          }
          this.states.set(accepted.id, "responded");
          // where the catalog's builder cannot build the response the extended builder (the one used for request payloads) answers
          const answer = plainTask.validResponse ?? (plainTask.responseSchema === undefined ? undefined : exampleExtended(plainTask.responseSchema));
          const payload = this.m("plainBadResponse") ? (badResponsePayload({ ...plainTask, validResponse: answer }) ?? answer) : (answer ?? {});
          // O-05: keys/create returns "the assigned keyId" (spec.md item 4); the reference assigns the one asked for, so a probe that captures it names the key the seed created
          const asked = (accepted as { payload: unknown }).payload;
          if (plainTask.typeUri === "https://trusttasks.org/spec/keys/create/0.1" && typeof payload === "object" && payload !== null && typeof (asked as { keyId?: unknown } | null)?.keyId === "string") (payload as Record<string, unknown>)["keyId"] = (asked as { keyId: string }).keyId;
          this.seeded.record(plainTask, (accepted as { payload: unknown }).payload, payload);
          const response = {
            id: this.newId(), threadId: accepted.threadId ?? accepted.id, type: plainTask.responseTypeUri, issuer: this.signer.did,
            recipient: accepted.issuer, issuedAt: this.stamp(), payload,
          } as TrustTaskDocument<unknown>;
          return this.finish(response, accepted as TrustTaskDocument<unknown>, false);
        }
        this.handled++;
        this.states.set(accepted.id, "responded");
        const subject = (accepted.payload as { subject?: string }).subject;
        const response = {
          id: this.newId(),
          threadId: accepted.threadId ?? accepted.id,
          type: CARRIER_RESPONSE_TYPE,
          issuer: this.signer.did,
          recipient: accepted.issuer,
          issuedAt: this.stamp(),
          payload: { subject, applied: true },
        } as TrustTaskDocument<unknown>;
        return this.finish(response, accepted as TrustTaskDocument<unknown>, false);
      },
    });

  }

  private reply(out: (replies: unknown[], kind?: SendResult["transport"]["kind"]) => SendResult, doc: TrustTaskDocument<unknown>, outcome: Awaited<ReturnType<typeof consumeInbound>>): SendResult {
    switch (outcome.kind) {
      case "handled":
        return out([outcome.response]);
      case "accepted":
      case "suppressed":
        return out([]);
      case "duplicate":
        if (this.m("duplicateAsFailure")) {
          const e = rejectWith(doc, this.newId(), toErrorPayload({ code: "taskFailed", message: "already executed", retryable: false }));
          return out([this.finish(e, doc, true)]);
        }
        if (this.m("duplicateEquivalentResponse") && outcome.priorResponse !== undefined) {
          // an equivalent response (same type and payload, a fresh envelope), not the retained document
          const { proof: _proof, ...rest } = outcome.priorResponse as unknown as Record<string, unknown>;
          return out([this.finish({ ...rest, id: this.newId() } as unknown as TrustTaskDocument<unknown>, doc, false)]);
        }
        this.lastMeta = outcome.priorResponse !== undefined ? "dupReply" : this.states.get(String(doc.id)) === "accepted" ? "dupInflight" : "dupDone";
        return out(outcome.priorResponse === undefined ? [] : [outcome.priorResponse]);
      case "rejected": {
        const err: ErrorResponse = outcome.error;
        if (this.m("burnIdOnRefusal") && typeof doc.id === "string") this.burned.add(doc.id);
        if (this.m("futureIssuedAtAsExpired") && err.payload.code === "malformedRequest" && typeof doc.issuedAt === "string" && Date.parse(doc.issuedAt) > this.now()) {
          err.payload.code = "expired";
        }
        if (this.claimFault && err.payload.code === "unavailable") {
          // The runtime refused for an unreadable duplicate record (fail closed); these mutants misreport it.
          if (this.m("claimStoreFaultBurnsId") && typeof doc.id === "string") this.burned.add(doc.id);
          if (this.m("claimStoreFailsAsTaskFailed")) {
            err.payload.code = "taskFailed";
            err.payload.retryable = false;
          }
        }
        if (this.m("mismatchRoutedToIssuer") && err.payload.code === "identityMismatch") (err as unknown as Record<string, unknown>).recipient = doc.issuer;
        if (this.m("expiredAsMalformed") && err.payload.code === "expired") err.payload.code = "malformedRequest";
        if (this.m("nonStandardCode") && err.payload.code === "malformedRequest") err.payload.code = "badRequest" as never;
        if (this.m("proofRequiredAsInvalid") && err.payload.code === "proofRequired") err.payload.code = "proofInvalid";
        return out([this.finish(err, doc, true)]);
      }
    }
  }
}
