// SPDX-License-Identifier: Apache-2.0
// Adapter contract (docs/04-suite-design.md section 4). Methods are JSON-RPC 2.0 methods; an
// adapter is any object implementing `Adapter`. Binary payloads (`bytes`) travel as UTF-8 text
// because Trust Task documents are JSON text; the harness never re-serialises them.

export type TransportKind = "document" | "none" | "refused";

export interface CarrierDecl {
  typeUri: string;
  /**
   * `openPayload`: the same Type URI also accepts a payload with a member its schema does not name (a vector that sends one to a
   * closed-payload implementation would otherwise measure the payload schema, not the rule under test; docs/04 section 4.2).
   */
  class: "consequential" | "read" | "fire-and-forget" | "openPayload";
  /** A valid request payload, so generic vectors can use the carrier. */
  validPayload: Record<string, unknown>;
}

/**
 * The ceremony-document family an implementation serves (vector group CER, docs/04 section 11.4): begin, approve, reset and an
 * optional status task, each a Type URI, with request payload templates in which `$A` and `$X` name the harness actors that are the
 * ceremony's two administrators (A begins and resets; X approves). The ceremony id is the thread id: begin's own id.
 */
export interface CeremonyDecl {
  beginType: string;
  approveType: string;
  resetType: string;
  /** A task by which the producer can learn the outcome. Absent: the implementation offers none (framework 8.6, resubmit rule). */
  statusType?: string;
  /**
   * Declared (required): whether a begin document counts as the proposer's own approval. `true`: the begin's issuer is recorded as
   * approving, so with two administrators one approval by the other completes the quorum. `false`: the begin records no approval and
   * every named administrator, the proposer included, approves by an approve document; the harness then sends the proposer's approval
   * wherever a vector needs the quorum (docs/04 section 11.4). The capability name is `ceremony.proposerApproves`.
   */
  proposerApproves: boolean;
  beginPayload: Record<string, unknown>;
  approvePayload: Record<string, unknown>;
  resetPayload: Record<string, unknown>;
  /** Request payload template of the status task; required with `statusType`. `$A` and `$X` may be used. */
  statusPayload?: Record<string, unknown>;
}

/**
 * The acceptance window an implementation enforces (and advertises through discovery 0.4), in whole seconds. The framework text sets no
 * numbers; the profile pins are 300 / 60 / 2592000 (`PROFILE_WINDOW`). An implementation with another window declares it here and is
 * measured against its own window; the difference from the profile is reported in the matrix (docs/04 section 6).
 */
export interface AcceptanceWindow {
  maxAgeSeconds: number;
  clockSkewSeconds: number;
  expiryHorizonSeconds: number;
}

/**
 * Revision of this adapter contract (the `Capabilities` shape, the RPC methods, the `optional` names below). An adapter may state the
 * revision it was written against in `Capabilities.contractVersion`; the runner records it in run.json. Additive changes keep the minor.
 */
export const CONTRACT_VERSION = "0.1";

/**
 * The closed list of optional capability names (`Capabilities.optional`, a vector's `requires: ["optional:<name>"]` and its
 * `skipIfOptional`). The loader rejects a vector that names any other; the runner warns (fails under `--strict`) when an adapter
 * declares any other, since a misspelt name would otherwise turn every vector that needs it into a silent SKIP.
 * Meanings: see `Capabilities.optional`; `authorised` (the harness actors hold, on the deployment, the standing every task the vectors send requires, so a vector that asserts success may expect the task's own response; this includes community membership and an administrator role, not only permission: the asserted vectors depend on the actor being a member where the task answers `notMember` or `notAMember`, and an administrator where it answers `notAdministrator`; R-06; and a witness whose own policy accepts the harness actors' sessions, where the task answers `witness/session:refused`; S-01), `attested` (Tier 2 attested sub-group), `control` (a control channel the harness drives),
 * `binding.requireBearer` (the HTTPS binding requires a bearer token), `governance.declare` (the adapter implements `declareGovernance`),
 * `initiate` (the `initiate` method, with `Capabilities.initiates`), `peer.connect` (the `connect` method), `observe.received` and `observe.ceremony`
 * (the `received` and `ceremony` observe queries): the four members of the ceremony-scenario track (docs/25), used only by the separate scenario runner,
 * `initiate.vetterDirectory` (the member can send the vetter directory's list, show and revoke-statement tasks: keyring-wallet defines them but sends only vetters/profile; docs/30), `initiate.foreignPresentation` (the applicant can present a credential held by another party, which a wallet never builds), `initiate.reciprocate` (the member can deliver its reciprocal membership credential to the community, vtc/members/vmc: FC-ONB; a wallet sends it only once it holds the membership and the community asked), `initiate.oobTamper` (the approver of the sign-in ceremony can send a respond or prove deliberately broken, so the service's checks are exercised; the wallet cannot), `witness.presentation` (the adapter builds the witness presentation the WIT group asks for through the `witnessPresentation` trigger helper: its format belongs to the implementation, docs/29), `trigger.consentSetup` (FC-KVC: the executor's consent policy, an approver set and k, is configured through the participant's own `trigger`; a VTA reads it from its deployment configuration), `trigger.serveVersions` (the sign-in service can be told which task versions it serves, a deployment's release; docs/26), `trigger.requireStepUp` (the deployment can be told to gate a task type on a step-up of the caller's session, the way an operator's policy does; paired ceremonies, docs/26), `seed.defaults` (the implementation has its own shipped default policies in force before the first request, as a deployed instance does; the in-process VTC host installs them through the platform's own boot call when asked, docs/22 seeded-state probe).
 */
export const OPTIONAL_CAPABILITIES = [
  "attested",
  "authorised",
  "binding.requireBearer",
  "castFutureVersion",
  "ceremony",
  "ceremony.status",
  "clock",
  "clockFree",
  "control",
  "discovery.acceptanceWindow",
  "discovery.expiryHorizon",
  "emit",
  "fault.claimStore",
  "governance.content",
  "governance.declare",
  "governance.roles",
  "idempotencyKey",
  "initiate",
  "initiate.foreignPresentation",
  "initiate.oobTamper",
  "initiate.reciprocate",
  "initiate.vetterDirectory",
  "observe.ceremony",
  "observe.deferred",
  "observe.pushed",
  "observe.received",
  "observe.retained",
  "peer.connect",
  "proofVerify",
  "receiptVerify",
  "restart",
  "seed.defaults",
  "transportIdentity",
  "trigger.ceremonyDeadline",
  "trigger.ceremonyEffect",
  "trigger.consent",
  "trigger.consentBinding",
  "trigger.consentEnrol",
  "trigger.consentSetup",
  "trigger.holdCredential",
  "trigger.makeOffer",
  "trigger.openElection",
  "trigger.presentationNonce",
  "trigger.queryDecision",
  "trigger.requireBoundStepUp",
  "trigger.requireStepUp",
  "trigger.serveVersions",
  "trigger.twoPhase",
  "trigger.verifierTrust",
  "witness.presentation",
] as const;
export type OptionalCapability = (typeof OPTIONAL_CAPABILITIES)[number];

/**
 * Prefixed forms a vector's `requires` entry may take. Besides these, an entry is the bare word `discovery` (any trust-task-discovery
 * version) or a Type URI (`https://...`).
 */
export const REQUIRE_PREFIXES = ["optional:", "carrier:", "emit:", "binding:", "cryptosuite:", "window:"] as const;

/** Why one `requires` entry is malformed, or null when it is well-formed (known prefix and, for `optional:`, a known name). */
export function requireEntryProblem(req: string): string | null {
  if (req.startsWith("optional:")) return (OPTIONAL_CAPABILITIES as readonly string[]).includes(req.slice(9)) ? null : `unknown optional capability ${req} (see OPTIONAL_CAPABILITIES)`;
  if (REQUIRE_PREFIXES.some((p) => req.startsWith(p))) return req.slice(req.indexOf(":") + 1) === "" ? `empty ${req}` : null;
  if (req === "discovery" || req.startsWith("https://")) return null;
  return `unknown requires form ${req} (expected ${REQUIRE_PREFIXES.join(" / ")}<name>, discovery, or a Type URI)`;
}

/** The names in `optional` that are not in OPTIONAL_CAPABILITIES. */
export function unknownOptionalNames(optional: readonly string[]): string[] {
  return optional.filter((o) => !(OPTIONAL_CAPABILITIES as readonly string[]).includes(o));
}

/** A cited `notOffered` entry: the reason, and the evidence for it (source path and ref, or the observation). */
export interface NotOfferedEntry { reason: string; evidence: string }
/** The reason text of a `notOffered` entry. */
export const notOfferedReason = (e: string | NotOfferedEntry): string => (typeof e === "string" ? e : e.reason);
/** The evidence of a `notOffered` entry; undefined for an uncited (string) entry. */
export const notOfferedEvidence = (e: string | NotOfferedEntry): string | undefined => (typeof e === "string" || e.evidence === "" ? undefined : e.evidence);
/** Every entry of a `notOffered` table with the same evidence (a table the adapter header says was checked as one survey). */
export function cited(table: Record<string, string>, evidence: string): Record<string, NotOfferedEntry> {
  return Object.fromEntries(Object.entries(table).map(([k, reason]) => [k, { reason, evidence }]));
}

export interface Capabilities {
  name: string;
  /** The adapter contract revision the adapter was written against (CONTRACT_VERSION, for example "0.1"). Optional; recorded in run.json. */
  contractVersion?: string;
  /** The implementation these capabilities belong to when `name` also names a mode (for example `x-attested`); runs that share it are merged into one matrix row. Default: `name`. */
  implementation?: string;
  /** The platform this row exercises when its `name` is a carriage variant of it (keyring-wallet over DIDComm is a row of the platform `keyring-wallet`): exceptions keyed on the platform apply to the row as well as exceptions keyed on its name. Optional. */
  platform?: string;
  version: string;
  /** Highest tier the implementation claims. */
  tierMax: 1 | 2;
  /**
   * Carriages the adapter reaches the implementation on: `in-process`, `https`, and (additive, optional; docs/13) `didcomm` (any DIDComm
   * carriage, listed beside the specific one) with `didcomm-v1` (bindings/didcomm-v1 0.2) and/or `didcomm-v2` (binding/didcomm 0.2).
   * A vector gates on one with `requires: ["binding:<name>"]`; an adapter that does not declare it gets SKIP.
   */
  bindings: string[];
  supportedTypes: string[];
  /**
   * Type URIs the implementation serves but does not name in its discovery answer (additive, optional): the vector gate counts them as
   * declared, the discovery vectors do not expect them in the list. The adapter states the evidence for each in its source.
   */
  unlistedTypes?: string[];
  carriers: CarrierDecl[];
  cryptosuites: string[];
  /**
   * transportIdentity (the transport authenticates the sender, so `from` means something: a sender the transport names that differs from the in-band issuer
   * is refused identityMismatch, framework 7.2 item 6, which applies only to "an authenticated identity derived from the transport"; an implementation whose
   * transport authenticates no sender does not declare it, and the vectors that send `from.spoof` are SKIP for it),
   * control, idempotencyKey, restart, trigger.consent, clock (the harness can set the clock) or clockFree (it cannot: exactly one of
   * the two is declared; the runner then rebases every vector on real time), proofVerify, receiptVerify (the `verifyReceipt` helper method exists),
   * ceremony (with `ceremony` below), ceremony.status (a status task exists), trigger.ceremonyDeadline, trigger.ceremonyEffect, observe.retained, observe.pushed (the `pushed` observe query exists; docs/20).
   * The complete list of accepted names is OPTIONAL_CAPABILITIES.
   */
  optional: string[];
  /** Present with the optional capability `ceremony`. */
  ceremony?: CeremonyDecl;
  /** The enforced acceptance window; absent means the profile pins. A runner-given window overrides it. */
  window?: AcceptanceWindow;
  /**
   * Requirements (a `requires` entry: a Type URI, or `optional:<name>`) that the implementation itself does not offer, each with the
   * reason, as opposed to ones the adapter merely cannot reach. A vector gated on one of them is SKIP with the reason
   * "not offered by the implementation: ...", so a report can tell "VTI does not offer it" from "the adapter cannot reach it".
   * Absent: every gap is the generic "missing capability" / "type not declared" reason.
   * A SKIP is "not applicable" only from an entry that carries evidence (`{ reason, evidence }`: where in the platform's source, at which
   * commit or ref, or what was observed, the fact was checked; docs/04 section 8). A plain string, or any other gate, is "not reached".
   */
  notOffered?: Record<string, string | NotOfferedEntry>;
  /**
   * Governance the deployment (never the suite) chose, for the plain-task family (docs/02 section 5, docs/04 section 11.7). The suite
   * never fixes a role name, a role's meaning or who may grant what: a vector that needs a role value carries `$role(n)` and is SKIP
   * ("governance not declared") unless the adapter declares `roles` here together with the optional capability `governance.roles`.
   * `governance.content` (optional capability only) declares that the deployment accepts policy content in `policy/upsert` requests
   * written by the harness; vectors that carry policy content are SKIP without it.
   */
  governance?: GovernanceCapability;
  /** With the optional capability `initiate`: the kinds of step the implementation can start towards a peer (for example `vrc-propose`, `vrc-issue`; docs/25). */
  initiates?: string[];
  /** Ceremony roles the implementation can play (docs/25): `ceremony` is a scenario group (`FC-VRC`), `roles` the role names it offers. A scenario that needs another role is SKIP "role not offered". */
  ceremonyRoles?: { ceremony: string; roles: string[] }[];
  /** A labelled mode the participant runs in, when it is not its plain behaviour (docs/25 section 6.4: the witness oracle's `mint-on-verified`). A scenario result carries it next to the participant, so a reader sees which mode produced the outcome. */
  mode?: string;
  /** With the optional capability `emit`: the Type URIs (request, or `#response` form) the adapter can emit through its real builders. A vector for any other type is SKIP. */
  emits?: string[];
  pins: { framework: string; error: string; binding: string };
}

/**
 * Governance declaration (docs/04 section 19, docs/17). The suite never fixes a role name, a role's meaning or who may grant what; where
 * a governance probe needs one it declares nonce values of its own through `declareGovernance` and checks only whether the platform
 * honoured them. All members are additive and optional.
 * - `roles`: stand-in role values for the plain-task family (`$role(n)`), as before.
 * - `declaration`: `supported` (the adapter implements `declareGovernance`), `none` (the platform has no declaration path the adapter can
 *   reach) or `unknown` (default; the adapter says nothing). Only `supported` runs a differential probe; the other two are reported as
 *   GOV-NOT-PROBED, never as a negative finding.
 * - `items`: which declarable items `declareGovernance` accepts: `roles`, `authority`, `consent`.
 * - `reason`: why no declaration is possible (shown with GOV-NOT-PROBED).
 */
export interface GovernanceCapability {
  roles?: string[];
  declaration?: "supported" | "none" | "unknown";
  items?: GovernanceItem[];
  reason?: string;
  /** The platform's essential governance (E): who may decide a held task and how many approvals it needs. Absent: unreadable. */
  essential?: EssentialGovernance;
}

/**
 * Essential governance, E (docs/02 section 5.1, docs/04 section 19, decision 39): the authority set (the principals who may decide a
 * held task) and `minApprovals` (at least 1). The suite never asserts what E should be; it records what the adapter states and runs
 * the per-declared-E vectors against it. The shape reuses GovernanceDeclaration: the authority set is every entry of `principals`
 * whose role is `consent.approverSet`, and k is `consent.minApprovals`. A principal's `vid` is a harness actor token (`$A`, `$X`,
 * `$B` ...), so the harness can drive approvals from it, or a DID.
 * - `source`: `platform-config` (read from the platform's own configuration), `harness-configured` (the harness configured the
 *   platform this way for the run), `fixed-rule` (a built-in rule of the platform; it still fills E and is reported as the advisory
 *   GOV-FIXED) or `unreadable` (`reason` says why). An adapter that states nothing is unreadable ("authority set unreadable").
 * - `evidence`: where the values were read (a file and line at a commit, a setting name), or the rule's citation for `fixed-rule`.
 */
export interface EssentialGovernance {
  source: EssentialSource;
  principals?: GovernanceDeclaration["principals"];
  consent?: GovernanceDeclaration["consent"];
  evidence?: string;
  /** Required for `unreadable`: why E cannot be read. */
  reason?: string;
}
export type EssentialSource = "platform-config" | "harness-configured" | "fixed-rule" | "unreadable";
export type GovernanceItem = "roles" | "authority" | "consent";

/** A governance declaration, as a deployment would state it. Every value comes from the caller (the probes use nonce names). */
export interface GovernanceDeclaration {
  /** The role vocabulary. */
  roles: string[];
  /** Who holds which role at the start (VIDs of harness actors). */
  principals: { vid: string; role: string }[];
  /** Authority rule: for each role, the roles an entry of it may grant. A role with no key, or an empty list, may grant nothing. Absent: not declared. */
  authority?: Record<string, string[]>;
  /** Consent rule for one task: a request for `task` is held for `minApprovals` distinct approvers of `approverSet`. Absent: not declared. */
  consent?: { task: string; approverSet: string; minApprovals: number; excludeRequester: boolean };
}

/** `applied`: the platform now runs under the declaration. `rejected`: it refused it (reason given). `unsupported`: no declaration path (reason given). */
export type DeclareGovernanceResult =
  | { status: "applied" }
  | { status: "rejected"; reason: string }
  | { status: "unsupported"; reason?: string };

export interface ProvisionedRole {
  vid: string;
  didDocument?: unknown;
  transportAddress: string;
  keyCustody: "iut" | "harness";
}

/** The authenticated transport identity of the sender: a harness actor, nobody, or a spoofed identity. */
export type SendFrom = { kind: "actor"; vid: string } | { kind: "none" } | { kind: "spoof"; vid: string };

/**
 * HTTPS binding request line (bindings/https/0.3 section 2). Present only when the vector exercises the binding and the adapter
 * declares the `https` binding; absent means the default `POST /trust-tasks` with `Content-Type: application/json`. The sender
 * identity is `from` (the adapter presents the bearer token it holds for that identity; `none` sends no Authorization header).
 */
export interface HttpRequestLine {
  method?: string;
  path?: string;
  contentType?: string;
}

export interface SendParams {
  from: SendFrom;
  /** Document text exactly as it goes on the wire. */
  bytes: string;
  channel?: string;
  http?: HttpRequestLine;
}

export interface SendResult {
  /** Reply documents emitted, as text, in order. */
  replies: string[];
  /** `status` and `contentType` are reported by adapters that declare the `https` binding and were given `http`. */
  transport: { status?: number; kind: TransportKind; contentType?: string };
  quiescentAfterMs: number;
}

export type ObserveQuery =
  | { query: "handled" }
  | { query: "documentState"; id: string }
  | { query: "stored"; kind: string; digest?: string }
  /** Verbatim retention (optional `observe.retained`): the text of the request with this document id, or of the reply to it, as held; "" when none. */
  | { query: "retained"; id: string; side: "request" | "reply" }
  /**
   * Pushed documents (optional `observe.pushed`, docs/20): the documents the implementation sent on its own initiative (not as the reply to a
   * `send`), to a party other than the sender of the request. Each filter that is given must match; none given matches every pushed document.
   * `to` is the recipient VID, `threadId` the document's thread (its `id` when it opens one), `type` the exact Type URI. `value` is the count and
   * `documents` the matching documents as text, oldest first.
   */
  | { query: "pushed"; threadId?: string; to?: string; type?: string }
  /**
   * Received documents (optional `observe.received`, docs/25): the documents that reached this implementation, whatever it did with them (an answered
   * request, a refused one, a reply to something it initiated), oldest first. Each filter that is given must match: `from` is the sender VID, `threadId`
   * the document's thread (its `id` when it opens one), `type` the exact Type URI. `value` is the count and `documents` the matching documents as text.
   */
  | { query: "received"; from?: string; threadId?: string; type?: string }
  /**
   * The implementation's own reading of one ceremony thread (optional `observe.ceremony`, docs/25): `value` is one of CEREMONY_STATES. A state the
   * implementation cannot map is `unknown`, never invented. `detail` (in `documents[0]`) is for people and is never asserted.
   */
  | { query: "ceremony"; threadId: string };

/** The terminal-state vocabulary of the ceremony-scenario track (docs/25), plus the non-terminal readings `open` and `held` and `unknown`. */
export const CEREMONY_STATES = ["open", "held", "completed", "declined", "refused", "expired", "aborted", "unknown"] as const;
export type CeremonyState = (typeof CEREMONY_STATES)[number];

export interface ObserveResult {
  /** `handled`/`stored`: a count (`stored` kind `ceremony-effect`: effects of committed ceremonies). `documentState`: unknown | accepted | responded | errored. `retained`: text. */
  value: number | string;
  /** `pushed` only (additive): the matching pushed documents as text, oldest first; `value` is their count. */
  documents?: string[];
}

/**
 * Initiation (optional capability `initiate`, docs/25). The implementation starts a step of a ceremony towards a peer: it builds and signs the
 * document with its own keys and code. `to` is the peer's VID (the one it was `connect`ed to), `thread` the thread to continue (absent: it opens a
 * new one), `args` hints the implementation may ignore. `sent` says who carried the documents: `false` (every adapter today) means they are returned
 * unsent and the scenario runner relays them (runner-carried mode, never admitted as live evidence); `true` means the implementation sent them itself.
 */
export interface InitiateParams {
  kind: string;
  to: string;
  thread?: string;
  args?: Record<string, unknown>;
}
export interface InitiateResult {
  threadId: string;
  documents: string[];
  sent: boolean;
  /** The identity the carrier presents for these documents when it is not the participant's own: a pairwise identity (a witness session is held under the party's relationship DID). Absent: the participant's own identity. */
  from?: string;
  /**
   * The implementation runs its own flow (the wallet's real code, with its own version step-down) and may answer a relayed reply with a further
   * document: when true, the runner hands each reply it relays back to this participant and relays whatever documents the participant sends in
   * answer (bounded), instead of treating the reply as the end of the exchange. Optional, additive (ceremony track, docs/26).
   */
  continues?: boolean;
}

/** Connection set-up (optional capability `peer.connect`, docs/25): make the carrier relationship with a peer, beyond `trust` (which only teaches a key). */
export interface ConnectParams {
  peer: { vid: string; didDocument?: unknown; transportAddress?: string };
  role?: string;
}
export interface ConnectResult {
  connected: boolean;
  detail?: string;
}

export interface ProofVerifyResult {
  valid: boolean;
}

/**
 * Helper layer (optional capability `receiptVerify`, vector group RCPT, docs/04 section 11.6). The verifier rules of
 * `trust-ceremony-receipt` 0.1 have no wire output, so the receipt vectors hand a verifier the receipt and what it holds and ask for its
 * verdict. The method is a pure verification: it changes no state the other vectors observe.
 */
export interface VerifyReceiptParams {
  /** The receipt document text, exactly as received. */
  receipt: string;
  /** The ceremony definition the verifier resolved for `payload.definition` (registry definition shape). Absent or null: it could not be resolved. */
  definition?: Record<string, unknown> | null;
  /** The enactment's role bindings, role name to the VIDs bound to it. Absent or null: they are not available to the verifier. */
  roleBindings?: Record<string, string[]> | null;
  /** The step documents the verifier holds, each exactly as received. Absent or empty: it holds none. */
  steps?: string[];
}

/**
 * The verdict. `complete`: the receipt verified and the enactment is complete. `incomplete`: it verified but the enumerated steps do
 * not satisfy the definition's completion rule, or are a prefix. `unverifiable`: the verifier could not check something the verdict
 * needs (the definition, the role bindings, the terminal marker) and says so instead of guessing. `invalid`: the receipt is rejected.
 * `reason` is for people and is never asserted.
 */
export type ReceiptOutcome = "complete" | "incomplete" | "unverifiable" | "invalid";
export const RECEIPT_OUTCOMES: readonly ReceiptOutcome[] = ["complete", "incomplete", "unverifiable", "invalid"];
export interface VerifyReceiptResult {
  outcome: ReceiptOutcome;
  reason?: string;
}

/**
 * Producer (outbound) class (optional capability `emit`, vector group EM, docs/04 section 11.8). The implementation is asked to
 * emit the document of a Type URI through its own real builders (the code that builds and signs the request or response it sends in
 * normal operation) and returns it unsent. The harness validates the document against the task's payload schema and policy. `args`
 * are hints the harness may give (`recipient`, a VID of a harness actor to address); the adapter chooses every other input the real
 * builder needs and must not edit the document it returns. An adapter declares the Type URIs it can emit in `Capabilities.emits`.
 */
export interface EmitParams {
  type: string;
  args?: Record<string, unknown>;
}
export interface EmitResult {
  /** The emitted documents (usually one), as text, exactly as the builder produced them. */
  documents: string[];
  /**
   * Optional (contract addition for the project owner's review): notes naming any part of the document the implementation did not build or sign
   * itself (a stand-in, class D). The harness records them as advisories next to the result; they never change PASS or FAIL.
   */
  standIn?: string[];
}

export interface Adapter {
  capabilities(): Promise<Capabilities>;
  provision(roles: string[]): Promise<Record<string, ProvisionedRole>>;
  trust(vid: string, didDocument?: unknown): Promise<void>;
  setClock(iso: string): Promise<void>;
  advance(ms: number): Promise<void>;
  send(params: SendParams): Promise<SendResult>;
  trigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }>;
  observe(query: ObserveQuery): Promise<ObserveResult>;
  restart(): Promise<void>;
  reset(): Promise<void>;
  snapshot(): Promise<string>;
  diff(snapshotId: string): Promise<{ changed: boolean; detail?: string }>;
  /** Helper layer (optional capability `proofVerify`): verify a proof on bytes as received. */
  verifyProof(params: { bytes: string }): Promise<ProofVerifyResult>;
  /** Helper layer (optional capability `receiptVerify`): verify a `trust-ceremony-receipt` against what the verifier holds. Absent on an adapter that does not declare the capability. */
  verifyReceipt?(params: VerifyReceiptParams): Promise<VerifyReceiptResult>;
  /** Producer class (optional capability `emit`): emit the document of `type` through the implementation's own builders. */
  emit?(params: EmitParams): Promise<EmitResult>;
  /** Ceremony track (optional capability `initiate`, docs/25): start a step towards a connected peer. */
  initiate?(params: InitiateParams): Promise<InitiateResult>;
  /** Ceremony track (optional capability `peer.connect`, docs/25): set up the relationship with a peer. */
  connect?(params: ConnectParams): Promise<ConnectResult>;
  /** Governance (optional capability `governance.declare`, `capabilities.governance.declaration` = `supported`): run the platform under this declaration. Cleared by `reset`. */
  declareGovernance?(decl: GovernanceDeclaration): Promise<DeclareGovernanceResult>;
}

export const RPC_METHODS = [
  "capabilities", "provision", "trust", "setClock", "advance", "send", "trigger",
  "observe", "restart", "reset", "snapshot", "diff", "verifyProof", "verifyReceipt", "emit", "declareGovernance", "initiate", "connect",
] as const;
export type RpcMethod = (typeof RPC_METHODS)[number];

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: unknown;
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string } };

/** Serve one JSON-RPC request on an in-process adapter (the same dispatch a stdio or HTTP shim would use). */
export async function dispatch(adapter: Adapter, req: RpcRequest): Promise<RpcResponse> {
  const id = req.id ?? null;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "invalid request" } };
  }
  if (!(RPC_METHODS as readonly string[]).includes(req.method)) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${req.method}` } };
  }
  const fn = (adapter as unknown as Record<string, ((p?: unknown) => Promise<unknown>) | undefined>)[req.method];
  // an optional helper method (`verifyReceipt`) the adapter does not implement
  if (typeof fn !== "function") return { jsonrpc: "2.0", id, error: { code: -32000, message: `method not supported by this adapter: ${req.method}` } };
  try {
    const params = req.params;
    let result: unknown;
    switch (req.method as RpcMethod) {
      case "trust": {
        const p = params as { vid: string; didDocument?: unknown };
        result = await adapter.trust(p.vid, p.didDocument);
        break;
      }
      case "advance":
        result = await adapter.advance((params as { ms: number }).ms);
        break;
      case "setClock":
        result = await adapter.setClock((params as { iso: string }).iso);
        break;
      case "trigger": {
        const p = params as { action: string; args: Record<string, unknown> };
        result = await adapter.trigger(p.action, p.args ?? {});
        break;
      }
      case "provision":
        result = await adapter.provision((params as { roles: string[] }).roles);
        break;
      case "diff":
        result = await adapter.diff((params as { snapshotId: string }).snapshotId);
        break;
      default:
        result = await fn.call(adapter, params);
    }
    return { jsonrpc: "2.0", id, result: result ?? null };
  } catch (err) {
    return { jsonrpc: "2.0", id, error: { code: -32000, message: (err as Error).message } };
  }
}
