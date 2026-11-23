// SPDX-License-Identifier: Apache-2.0
// Adapter for VTI's own trust-task code, run in-process: the "VTI in-process" row. A Rust host (rust/src/main.rs) starts VTI's `MockVta`
// (the VTA's real router, trust-task dispatcher, handlers, stores and response signer, with the VTA's own test-support state) inside
// one process; this adapter talks to it over the VTA's HTTPS door on a loopback port and, for what the wire does not give a
// harness, over a small control interface of the host (bearer minting, VTI's own proof verifier, a count of stored credentials).
//
// What this row measures, and what it does not (each line checked against the VTI source at the pinned ref; see docs and the run README):
//   - VTI's real pipeline and handlers for the types the VTA serves; the VTA is the service here, not the community service (VTC)
//     the HTTPS adapter measures. The difference is stated in the matrix label.
//   - The sender is authenticated by the bearer (the VTA door maps the bearer to the sender and refuses a document whose issuer
//     differs), so `transportIdentity` is declared and `from` has an effect: `actor` presents the actor's own bearer, `spoof` the
//     named identity's bearer, `none` no bearer. The bearer is minted by the host through VTI's own test-support helper, the shortcut
//     VTI's route tests take; the real login handshake is not exercised.
//   - `proofVerify`: VTI's own `verify_trust_task_proof_value` on the document as received (the same function the pipeline calls).
//   - Clock: VTI reads the system clock; there is no injection point, so `clockFree` (rebase mode), as for the HTTPS adapter.
//   - Not reachable and not declared: every task family the VTA does not serve. Those vectors SKIP, and the run README says which
//     of them VTI does not offer and which the adapter cannot reach.
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import type {
  Adapter, Capabilities, EssentialGovernance, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult, TransportKind,
} from "../../adapter/contract.ts";
import { isObject } from "../../util/json.ts";
import { PushedBox } from "../../adapter/pushed.ts";
import { cited } from "../../adapter/contract.ts";
import type { ConnectParams, ConnectResult, InitiateParams, InitiateResult } from "../../adapter/contract.ts";
import { KVC_KINDS, VtaConsentDriver } from "./consent.ts";
import { TaskRefusal, askSteppingDown } from "./step-down.ts";

/** The VTI ref the source facts of this adapter (E, notOffered) were checked at (the same as the live adapter's VTI_EVIDENCE_REF). */
const VTI_EVIDENCE_REF = "26d0da81";

/** The row name (exceptions are keyed on it). */
export const INPROCESS_NAME = "verifiable-trust-infrastructure-inprocess";
/** Runs of both VTI adapters are one matrix row family; the label says which. */
export const INPROCESS_IMPLEMENTATION = "verifiable-trust-infrastructure-inprocess";
export const ROW_LABEL = "VTA handlers in process (loopback HTTPS door, minted bearer)";
export const NOTIFY_TYPE = "https://trusttasks.org/spec/notifications/notify/0.1";
/** The consequential types the harness sends: `handled` counts the distinct requests of these that VTI answered with their `#response`. */
export const ISSUE_TYPE = "https://trusttasks.org/spec/credential-exchange/issue/0.1";
export const QUERY_TYPE = "https://trusttasks.org/spec/credential-exchange/query/0.1";
export const OFFER_TYPE = "https://trusttasks.org/spec/credential-exchange/offer/0.1";
/** The holder operator's decisions on a deferred presentation (VTI's `credential-exchange/pending/approve` and `pending/deny`, super-admin only). */
export const PENDING_APPROVE_TYPE = "https://trusttasks.org/spec/credential-exchange/pending/approve/0.1";
export const PENDING_DENY_TYPE = "https://trusttasks.org/spec/credential-exchange/pending/deny/0.1";
/** The holder operator's list of deferred presentations (VTI's `credential-exchange/pending-list`, super-admin only). */
export const PENDING_LIST_TYPE = "https://trusttasks.org/spec/credential-exchange/pending/list/0.1";
const EXECUTED_TYPES = new Set([NOTIFY_TYPE, ISSUE_TYPE, QUERY_TYPE, OFFER_TYPE]);
/**
 * The pre-session authentication family: dispatched on `/trust-tasks` ahead of the ACL gate (vta-service `trust_tasks/auth.rs`, `owns` and
 * `dispatch_pre_session`), so the discovery list, which is built from the gated table, does not name them. Declared here from that source.
 */
export const PRE_SESSION_TYPES = [
  "https://trusttasks.org/spec/auth/challenge/0.1",
  "https://trusttasks.org/spec/auth/authenticate/0.3",
  "https://trusttasks.org/spec/auth/refresh/0.2",
];
/** The VTA's closed role vocabulary (vti-common/src/acl/mod.rs `Role`), most to least privileged. */
export const VTA_ROLES = ["admin", "initiator", "application", "reader", "monitor"] as const;
export const DISCOVERY_V0_3 = "https://trusttasks.org/spec/trust-task-discovery/0.3";
export const VTI_WINDOW = { maxAgeSeconds: 600, clockSkewSeconds: 60, expiryHorizonSeconds: 2_592_000 } as const;
const ROLE_SEEDS: Record<string, number> = { A: 0x0a, X: 0x0b, R: 0x0c, S: 0x0d, Q: 0x0e, W: 0x0f };
/** Seeds of identities the adapter itself uses, never a harness actor: the VTA's operator (super admin, reads the deferral list) and the issuer that delivers a held credential. */
const OPERATOR_SEED = 0x1a;
const HOLD_ISSUER_SEED = 0x1b;
/** The ACL role the harness actors hold: the least-privileged one (no administrative authority). VTI_ACTOR_ROLE overrides it (the seeded-state probe of keys needs an actor the VTA authorises to create a key; the role is the deployment's choice and is stated in the run README). */
export const ACTOR_ROLE = "monitor";

/**
 * The VTA's essential governance, E (docs/04 section 19), on this host. The task the VTA holds for a decision here is a deferred
 * `credential-exchange/query` (a verifier the holder has not pre-trusted): it is decided by one `credential-exchange/pending/approve`
 * from a super admin (role `admin` of the closed `Role` enum with an unrestricted scope). Who may decide and how many is a built-in
 * rule, not configuration, so the source is `fixed-rule` (advisory GOV-FIXED). The super admins are the ACL's: on this host the only
 * one is the adapter's operator identity (the harness actors hold `monitor`), so the declared set has one member. The VTA's
 * configurable consent (declarative approval rules, vta-sdk approvals) gates other tasks; the host seeds no rule. The adapter offers
 * no ceremony (`optional:ceremony`), so nothing drives this E and the honesty check does not run.
 */
export function vtaEssential(): EssentialGovernance {
  return {
    source: "fixed-rule",
    principals: [{ vid: ed25519Signer(seedOf(OPERATOR_SEED)).did, role: "admin" }],
    consent: { task: QUERY_TYPE, approverSet: "admin", minApprovals: 1, excludeRequester: false },
    evidence: "VTI 26d0da81: vta-service/src/trust_tasks/credential_exchange.rs:51 (pending tasks super-admin only), :442 handle_pending_approve (one approval re-presents); vti-common/src/auth/extractor.rs:350 (super admin: Admin with unrestricted scope), vti-common/src/acl/mod.rs:22 (closed Role enum); the ACL is the host's (the operator identity is the only admin; harness actors are monitor); no approval rule seeded (vta-policy/src/defaults.rs:79, vta-sdk/src/approvals/mod.rs:98)",
  };
}

export interface InprocessConfig {
  /** Control interface of the host, for example http://127.0.0.1:41000 */
  controlUrl: string;
  version: string;
  /**
   * Declare the optional capability `attested` (default true, as every earlier run). False is the "non-attested run": the vectors that
   * assert an unsigned document is accepted (`skipIfOptional: ["attested"]`, 12 at Tier 1) then run, against the carrier VTI offers.
   */
  attested?: boolean;
  /**
   * The host runs VTI's `MockVta::start_with_transports` (embedded mediator, did:peer:2 VTA, a running messaging session), so the VTA's push
   * engine can queue what it pushes (`VTI_INPROCESS_TRANSPORTS=1`). The adapter then declares `observe.pushed` (answered from the push engine's
   * durable records), `trigger.verifierTrust` (the holder's trusted verifiers, deployment configuration) and `trigger.queryDecision`
   * (`pending/approve`, `pending/deny` by the operator). The host builds the same wiring as `MockVta::start_with_transports` over a store directory it keeps, so `restart` still works.
   */
  transports?: boolean;
  /**
   * Upper bound on the total time one send spends waiting out the VTA's own per-client operation budget (HTTP 429 with `retry-after`;
   * VTI-TRN-029, default 100 operations per second per client). Default 30000 ms.
   */
  maxRateLimitWaitMs?: number;
  /** Ceremony track (docs/26): `reset` starts a fresh VTA (empty stores) so each scenario begins from nothing, and the adapter declares the ceremony roles it can serve. */
  ceremony?: boolean;
  /** Sleep used while waiting out a 429 (tests inject a fake). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Requirements VTI itself does not offer (not "the adapter cannot reach it"). Each was checked in the VTI source at the pinned ref: the
 * VTA and VTC dispatch tables, the generated specification crates and a search for the names below hold no handler for them.
 */
export const NOT_OFFERED: Record<string, string> = {
  "https://trusttasks.org/spec/vrc/relationships/propose/0.1": "VTI defines no vrc/relationships task (no handler in the VTA or the VTC)",
  "https://trusttasks.org/spec/vrc/relationships/issue/0.1": "VTI defines no vrc/relationships task (no handler in the VTA or the VTC)",
  "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1": "VTI defines no vrc/relationships task (its witness tasks are witness/session, a different family)",
  "https://trusttasks.org/spec/task-consent/request/0.1": "the VTA sends task-consent/request to an approver device and has no inbound handler for it",
  "optional:discovery.expiryHorizon": "the service enforces a 30-day expiry horizon but its trust-task-discovery 0.3 answer does not state it (0.4 would), and DIS-013 reads the horizon from the answer; declaring the capability ended in a harness error (vti-reach, 2026-11-15)",
  "optional:ceremony": "VTI has no ceremony-document family (begin, approve, reset); its task-consent is a policy approval flow",
  "optional:receiptVerify": "VTI has no trust-ceremony-receipt verifier (only generated wire types)",
  "optional:trigger.twoPhase": "VTI has no two-phase-commit issue transaction",
  "https://trusttasks.org/spec/task-consent/granted/0.1": "the VTA sends task-consent/granted to a requester device (push_granted) and has no inbound handler for it",
  "https://trusttasks.org/spec/task-consent/decision/0.1": "the VTA dispatches task-consent/decision 0.2 only; no handler for version 0.1",
  "https://trusttasks.org/spec/credential-exchange/present/0.1": "the VTA is the holder: it sends credential-exchange/present (after pending/approve) and has no inbound handler for it; the community service (VTC) serves present",
  "optional:fault.claimStore": "the accepted-id store is built inside the service from its own keyspace (`AppState::accepted_ids()` returns `StoreAcceptedIds::new(accepted_ids_ks)`, vta-service server.rs); there is no seam to substitute a faulting store",
  "https://trusttasks.org/spec/credential-exchange/request/0.1": "the VTA is the holder: it sends credential-exchange/request to an issuer and has no inbound handler for it",
};

/** The 2L vectors (vectors/2l) need more than the registry set: the emit capability and types the VTA does not serve. 2L types whose URI path appears nowhere in vta-service/src (grep of the VTI checkout at the pinned ref, spec crates excluded) and that the VTA does not list in its discovery answer. */
export const NOT_OFFERED_2L: Record<string, string> = {
  "optional:emit": "this row drives the VTA's handlers (the receiving side); the documents VTI builds itself are measured by the separate VTI emit row (src/adapters/vti-emit/, VTI's own client builders), where the same vectors run",
  "https://trusttasks.org/spec/vetting/attestation/0.1": "not in the VTA's discovery list; vta-service/src names the path only in two doc comments of wire-form helpers (operations/pcs.rs:778, :993), vtc-service/src not at all",
  "https://trusttasks.org/spec/push/register/0.2": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vetting/decline/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vetting/request/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/directory/card/show/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/directory/card/update/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/directory/entries/list/0.2": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/directory/entries/show/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/directory/fields/list/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/directory/images/get/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/directory/images/upload/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/directory/query/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/invitations/deliver/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/invitations/issue/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/invitations/list/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/invitations/revoke/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/join-requests/manifest/0.4": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/join-requests/status/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/join-requests/submit/0.3": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/join-requests/supplement/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/join-requests/withdraw/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/members/request-vmc/0.1": "not in the VTA's discovery list, and the type's URI path appears in neither vta-service/src nor vtc-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vtc/members/vmc/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/notifications/list/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/notifications/relay/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
  "https://trusttasks.org/spec/vtc/notifications/show/0.1": "not in the VTA's discovery list, and the type's URI path appears nowhere in vta-service/src outside the specification crates (grep at the pinned ref); vtc-service/src carries it (the community service)",
};

/** The ceremonies of the paired track (docs/26) in which this VTA is the service (the member phone's agent). */
export const CEREMONY_ROLES = ["FC-ACL", "FC-DEV", "FC-VLT", "FC-STU", "FC-PER", "FC-RMS"].map((ceremony) => ({ ceremony, roles: ["agent"] }));
const ACL_LIST_TYPE = "https://trusttasks.org/spec/acl/list/0.4";
const DEVICE_LIST_TYPE = "https://trusttasks.org/spec/device/list/0.3";
const DEVICE_REGISTER_TYPE = "https://trusttasks.org/spec/device/register/0.2";

const unsupported = (what: string): Error => new Error(`not supported by the VTI in-process adapter: ${what}`);

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The did:key document of a did:key (the VTA's own identity is one). */
export function didKeyDocument(did: string): Record<string, unknown> {
  const fp = did.slice("did:key:".length);
  const vm = `${did}#${fp}`;
  return { id: did, verificationMethod: [{ id: vm, type: "Multikey", controller: did, publicKeyMultibase: fp }], authentication: [vm], assertionMethod: [vm] };
}

export class VtiInprocessAdapter implements Adapter {
  readonly cfg: InprocessConfig;
  private baseUrl = "";
  private vtaDid = "";
  /** The VTA's DID document as the host's resolver gave it (null for the did:key VTA, whose document the adapter builds). */
  private vtaDoc: Record<string, unknown> | undefined;
  /** The deployment's holder identity (`credential_holder_did`), when the host configured one (transports mode); else the VTA's own DID is the subject. */
  private holderDid: string | undefined;
  private tokens = new Map<string, { token: string; at: number }>();
  /** ACL entries that belong to a live deployment (its administrator), not to a scenario: `acl-entry` counts leave them out (control layer `info.aclIgnore`; empty for the in-process host). */
  private aclIgnore = new Set<string>();
  private succeeded = new Set<string>();
  private states = new Map<string, "responded" | "errored">();
  /** Vault credential count at the last `reset`: `stored credential` is what was added since (each vector starts from `reset`). */
  private credentialBaseline = 0;
  /** Deferred queries at the last `reset` (the VTA instance persists across vectors): `stored deferral` counts those added since. */
  private deferralBaseline = 0;
  /** What the VTA's push engine queued since the last `reset` (read from its durable push records, see `refreshPushed`). */
  private readonly outbox = new PushedBox();
  /** Push records already present at the last `reset` (the VTA instance persists across vectors). */
  private pushBaseline = new Set<string>();
  private readonly pushSeen = new Set<string>();
  /** Ceremony track: the access-list and device counts at the last `reset` (the operator's own row is in the baseline). */
  private aclBaseline = 0;
  private deviceBaseline = 0;

  /** The ceremony track for the VTA's task-consent flow (FC-KVC, consent.ts). */
  private readonly consent: VtaConsentDriver;

  constructor(cfg: InprocessConfig) {
    this.cfg = { ...cfg, controlUrl: cfg.controlUrl.replace(/\/+$/, "") };
    this.consent = new VtaConsentDriver({
      vtaDid: async () => { await this.load(); return this.vtaDid; },
      ctl: (path, body) => this.ctl(path, body),
      post: (bytes, from, role) => this.post(bytes, from, {}, role),
      operator: (type, payload) => this.operatorCall(type, payload),
    });
  }

  private async ctl(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.cfg.controlUrl}/ctl/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const out = parseJson(await res.text());
    if (out === undefined || typeof out.error === "string") throw new Error(`host ${path}: ${out === undefined ? `HTTP ${res.status}` : String(out.error)}`);
    return out;
  }

  private async load(): Promise<void> {
    if (this.baseUrl !== "") return;
    const i = await this.ctl("info");
    this.baseUrl = String(i.baseUrl).replace(/\/+$/, "");
    this.vtaDid = String(i.vtaDid);
    this.vtaDoc = isObject(i.didDocument) ? i.didDocument : undefined;
    this.holderDid = typeof i.holderDid === "string" ? i.holderDid : undefined;
    this.aclIgnore = new Set(Array.isArray(i.aclIgnore) ? i.aclIgnore.map(String) : []);
  }

  private async bearer(did: string, role: string = process.env.VTI_ACTOR_ROLE || ACTOR_ROLE): Promise<string> {
    const hit = this.tokens.get(did);
    if (hit !== undefined && Date.now() - hit.at < 600_000) return hit.token;
    const r = await this.ctl("token", { did, role });
    const token = String(r.token);
    this.tokens.set(did, { token, at: Date.now() });
    return token;
  }

  private actor(role: string): Ed25519Signer {
    const seed = ROLE_SEEDS[role];
    if (seed === undefined) throw new Error(`unknown harness role ${role}`);
    return ed25519Signer(seedOf(seed));
  }

  private async discoverTypes(): Promise<string[]> {
    await this.load();
    const a = this.actor("A");
    const now = Date.now();
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type: DISCOVERY_V0_3, issuer: a.did, recipient: this.vtaDid, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: {} },
      a,
      { created: now },
    );
    const r = await this.post(JSON.stringify(doc), { kind: "actor", vid: a.did });
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    if (r.transport.status !== 200 || payload === undefined || !Array.isArray(payload.supportedTypes)) {
      throw new Error(`discovery 0.3 query to the VTA failed (HTTP ${String(r.transport.status)}): ${(r.replies[0] ?? "").slice(0, 300)}`);
    }
    const out: string[] = [];
    for (const e of payload.supportedTypes) {
      const t = typeof e === "string" ? e : isObject(e) ? e.type : undefined;
      if (typeof t === "string") out.push(t);
    }
    return out;
  }

  /** Ceremony track: whether the host can turn on the VTA's policy enforcement (`/ctl/enforce`); an older host has no such endpoint. */
  private enforceOk: boolean | undefined;
  async capabilities(): Promise<Capabilities> {
    if (this.cfg.ceremony === true && this.enforceOk === undefined) {
      this.enforceOk = await this.ctl("enforce", { on: false }).then(() => true, () => false);
    }
    const supported = await this.discoverTypes();
    const policy = await this.consent.policyCapable();
    return {
      // the ceremony track (docs/25, FC-KVC): the VTA as the executor of a task held for consent. `executor` only when the host can switch the gate on (/ctl/policy); otherwise
      // `executor-leg`, the decision leg alone against a stand-in request (consent.ts header). A suite choice of the harness, stated in every run record.
      initiates: [...KVC_KINDS],
      ceremonyRoles: [{ ceremony: "FC-KVC", roles: [policy ? "executor" : "executor-leg"] }, ...(policy ? [{ ceremony: "FC-TCA", roles: ["executor"] }] : []), ...(this.cfg.ceremony === true ? CEREMONY_ROLES : [])],
      name: INPROCESS_NAME,
      implementation: INPROCESS_IMPLEMENTATION,
      version: `${this.cfg.version}, ${ROW_LABEL}${this.cfg.transports === true ? "; push-capable host (embedded mediator, did:peer:2 VTA)" : ""}`,
      tierMax: 2,
      bindings: ["https"],
      supportedTypes: supported,
      unlistedTypes: [...PRE_SESSION_TYPES],
      carriers: [
        {
          typeUri: NOTIFY_TYPE,
          class: "consequential",
          validPayload: {
            notification: {
              notificationId: "ttc-conformance-notification",
              revision: 1,
              kind: "org.example:conformance",
              subject: { heldBy: "did:example:conformance-holder", id: "conformance-1", openWith: "https://trusttasks.org/spec/vtc/elections/show/0.6" },
              audience: "did:example:conformance-audience",
              status: "available",
              relayable: false,
            },
          },
        },
      ],
      // discovery.expiryHorizon is deliberately NOT declared: the VTA enforces a 30-day horizon (VTI_WINDOW) but its discovery 0.3 answer does
      // not state it (0.4 would), and DIS-013 reads the horizon from the answer, so declaring it ends in a harness error (tried: FAIL, 2026-11-15).
      cryptosuites: ["eddsa-jcs-2022", "ecdsa-jcs-2019"],
      optional: [...(this.cfg.ceremony === true && this.enforceOk === true ? ["trigger.requireStepUp"] : []), "clockFree", ...(this.cfg.attested === false ? [] : ["attested"]), "transportIdentity", "proofVerify", "binding.requireBearer", "discovery.acceptanceWindow", "trigger.holdCredential", "observe.deferred", "governance.roles", "governance.content", "restart", "initiate", "peer.connect", "observe.received", "observe.ceremony", ...(policy ? ["trigger.consentSetup"] : []), ...(this.cfg.transports === true ? ["observe.pushed", "trigger.verifierTrust", "trigger.queryDecision"] : [])],
      window: { ...VTI_WINDOW },
      // Cited (docs/04 section 8): the tables were checked in the VTI source at the pinned ref. `optional:emit` is not a platform fact (the
      // emit vectors are measured on the VTI emit row), so it stays uncited and its SKIPs read "not reached".
      notOffered: {
        ...cited(NOT_OFFERED_2L, `VTI ${VTI_EVIDENCE_REF}: the VTA's discovery list and a search of vta-service/src and vtc-service/src outside the specification crates (the file is named in the reason where one carries the path)`),
        "optional:emit": NOT_OFFERED_2L["optional:emit"]!,
        ...cited(NOT_OFFERED, `VTI ${VTI_EVIDENCE_REF}: the VTA and VTC dispatch tables, the generated specification crates and a search for the names (the handler or file is named in the reason)`),
      },
      // Governance. Two separate statements, both from VTI's source at the pinned ref (VTI is the deployment here; the suite chooses nothing):
      //  - `roles` (plain family, `$role(n)`): the VTA's own, fixed role vocabulary, the closed enum `Role` in vti-common/src/acl/mod.rs
      //    (admin, initiator, application, reader, monitor; `Role::parse` refuses any other). Declared as the deployment's own roles with the
      //    optional capability `governance.roles`, and `governance.content` (the in-process VTA accepts any policy module an administrator
      //    upserts; the module is the host's throwaway store). Both are adapter-declared and fixed, not invented by the suite.
      //  - `declaration: none` (docs/17 probes): no operation lets a deployer declare a different role set, an authority rule or a consent
      //    rule on the VTA: the role vocabulary is that closed enum, so the governance probes are NOT-PROBED, never a verdict on correctness.
      governance: {
        roles: [...VTA_ROLES],
        declaration: "none",
        reason: "the VTA's role set is a closed enum (vti-common/src/acl/mod.rs `Role`: admin, initiator, application, reader, monitor; `Role::parse` refuses any other), and no operation declares an authority rule or a consent rule; only the community service (VTC) accepts custom roles (vtc/roles/define)",
        essential: vtaEssential(),
      },
      pins: { framework: "0.6.0", error: "0.6", binding: "https/0.3" },
    };
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const role of roles) {
      if (role === "iut" || role === "peer") {
        // `peer` (the ceremony runner's role name for the participant itself, docs/25) is the VTA: a scenario addresses the executor by its own DID
        await this.load();
        out[role] = { vid: this.vtaDid, didDocument: this.vtaDid.startsWith("did:key:") ? didKeyDocument(this.vtaDid) : (this.vtaDoc ?? { id: this.vtaDid }), transportAddress: `${this.baseUrl}/trust-tasks`, keyCustody: "iut" };
      } else {
        const s = this.actor(role);
        out[role] = { vid: s.did, transportAddress: "none", keyCustody: "harness" };
      }
    }
    return out;
  }

  async trust(): Promise<void> {
    throw unsupported("trust (harness actors are did:key, which VTI resolves itself)");
  }
  async setClock(): Promise<void> {
    throw unsupported("setClock (VTI has no injectable clock; the adapter declares clockFree)");
  }
  async advance(): Promise<void> {
    throw unsupported("advance (VTI has no injectable clock)");
  }
  async snapshot(): Promise<string> {
    throw unsupported("snapshot");
  }
  async diff(): Promise<{ changed: boolean }> {
    throw unsupported("diff");
  }
  /** The host rebuilds the VTA over its kept store directory (a restart: only what reached the disk survives); the port changes, the DID does not. */
  async restart(): Promise<void> {
    const r = await this.ctl("restart");
    const did = String(r.vtaDid);
    if (did !== this.vtaDid) throw new Error(`the restarted VTA has another DID (${did}, was ${this.vtaDid})`);
    this.baseUrl = String(r.baseUrl).replace(/\/+$/, "");
    this.tokens = new Map();
  }
  async trigger(action: string, args: Record<string, unknown> = {}): Promise<{ documents: string[] }> {
    if (action === "holdCredential") {
      await this.holdCredential(typeof args.type === "string" ? args.type : "https://example.org/conformance#ConformanceCredential");
      return { documents: [] };
    }
    if (action === "requireStepUp" && this.cfg.ceremony === true && this.enforceOk === true) {
      // Deployment configuration, as an operator's policy: gate one task type on a step-up of the caller's session (a rule's `requireStepUp`, vta-service policy_gate.rs). The policy is installed
      // through the VTA's own `policy/upsert` by its operator, and enforcement (a setting of the service, off by default) is then turned on by the host.
      const type = `https://trusttasks.org/spec/${String(args.type)}`;
      const module = `package vta.policy\nimport rego.v1\ngated if input.request.typeUri == "${type}"\ndecision := {"decision": "requireStepUp"} if { gated; input.consumer.acr != "aal2" }\ndecision := {"decision": "allow"} if { gated; input.consumer.acr == "aal2" }\ndecision := {"decision": "allow"} if not gated`;
      await this.operatorCall("https://trusttasks.org/spec/policy/upsert/0.3", { id: "ceremony-step-up", name: "ceremony step-up gate", module, priority: 100, enabled: true, expectedVersion: 0 });
      await this.ctl("enforce", { on: true });
      return { documents: [] };
    }
    if (action === "actorRole" && this.cfg.ceremony === true) {
      // Deployment configuration: the role the VTA's access list gives this identity (default for harness actors is VTI_ACTOR_ROLE or monitor).
      this.tokens.delete(String(args.vid));
      await this.bearer(String(args.vid), String(args.role));
      return { documents: [] };
    }
    if (action === "seedDevice" && this.cfg.ceremony === true) {
      // Class D stand-in for a second phone of the same member: another did:key registers its own device binding through the VTA's own `device/register`.
      const other = ed25519Signer(seedOf(Number(args.seed ?? 0x2b)));
      await this.operatorCallAs(other, "admin", DEVICE_REGISTER_TYPE, { consumerKind: { kind: "companion", formFactor: "mobile" }, displayName: String(args.displayName ?? "Second phone"), platform: String(args.platform ?? "android") });
      return { documents: [] };
    }
    if (action === "consentSetup") {
      await this.consent.setup(args);
      return { documents: [] };
    }
    if (action === "verifierTrust" && this.cfg.transports === true) {
      // Deployment configuration of the holder: the verifier is on the VTA's trusted-verifier list (`trusted_presentation_verifiers`), so its query is answered at once.
      await this.ctl("trust-verifier", { vid: String(args.vid) });
      return { documents: [] };
    }
    if (action === "queryDecision" && this.cfg.transports === true) {
      // The holder's operator decides a deferred query: `pending/approve` (the VTA presents and pushes the answer) or `pending/deny`.
      const approve = args.decision === "approve";
      if (!approve && args.decision !== "decline") throw new Error("queryDecision: decision must be approve or decline");
      await this.operatorCall(approve ? PENDING_APPROVE_TYPE : PENDING_DENY_TYPE, { id: String(args.thread) });
      return { documents: [] };
    }
    throw unsupported(`trigger ${action}`);
  }

  /** A task the VTA's operator (super admin) sends: the holder operator's out-of-band surface. */
  private async operatorCall(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const op = ed25519Signer(seedOf(OPERATOR_SEED));
    // a call with a version ladder (acl/list) asks the newest version and steps down to what the host serves (class D harness request step, see step-down.ts)
    return askSteppingDown(type, (t) => this.operatorCallAs(op, "admin", t, payload), this.servedRung);
  }
  /** The rung of each version ladder this host answered on. */
  private readonly servedRung = new Map<string, string>();

  /** A task sent by an identity of the adapter itself (never a harness actor), with a bearer of the given role. */
  private async operatorCallAs(op: Ed25519Signer, role: string, type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.load();
    const now = Date.now();
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type, issuer: op.did, recipient: this.vtaDid, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload },
      op,
      { created: now },
    );
    const headers = { "content-type": "application/json", authorization: `Bearer ${await this.bearer(op.did, role)}` };
    const res = await fetch(`${this.baseUrl}/trust-tasks`, { method: "POST", headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const body = parseJson(text);
    if (res.status !== 200 || body === undefined || String(body.type).includes("/trust-task-error/")) {
      const refused = body !== undefined && isObject(body.payload) ? body.payload : undefined;
      if (refused !== undefined && typeof refused.code === "string") throw new TaskRefusal(`${type} on the VTA failed (HTTP ${String(res.status)}): ${JSON.stringify(refused).slice(0, 400)}`, refused.code, refused.details);
    }
    if (res.status !== 200 || body === undefined || String(body.type).includes("/trust-task-error/")) throw new Error(`${type} on the VTA failed (HTTP ${String(res.status)}): ${body !== undefined && isObject(body.payload) ? JSON.stringify(body.payload).slice(0, 400) : text.slice(0, 300)}`);
    return body;
  }

  /** Pull the push engine's records not yet seen into the box, oldest first (the adapter observes; the VTA's own handlers caused every push). */
  private async refreshPushed(): Promise<void> {
    const r = await this.ctl("pushed");
    const rows = Array.isArray(r.pushes) ? r.pushes : [];
    for (const row of rows) {
      if (!isObject(row) || typeof row.id !== "string" || this.pushBaseline.has(row.id) || this.pushSeen.has(row.id)) continue;
      this.pushSeen.add(row.id);
      this.outbox.record(JSON.stringify(row.document), typeof row.recipient === "string" ? row.recipient : undefined);
    }
  }

  /**
   * Helper `holdCredential`: the VTA comes to hold a credential of this type through its own `credential-exchange/issue` handler
   * (the path a community admitting it takes): a W3C credential about the VTA, signed by an issuer identity of the adapter and
   * delivered by it. The issuer is not a harness actor, so no vector's sender, verifier or `handled` count is touched; the credential
   * baseline moves with it, so `stored credential` keeps counting only what a vector itself added.
   */
  private async holdCredential(type: string): Promise<void> {
    await this.load();
    const issuer = ed25519Signer(seedOf(HOLD_ISSUER_SEED));
    const now = Date.now();
    const created = Math.floor(now / 1000) * 1000;
    const vc = signDocument(
      {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential", type],
        issuer: issuer.did,
        validFrom: new Date(created).toISOString().replace(".000Z", "Z"),
        credentialSubject: { id: this.holderDid ?? this.vtaDid },
      },
      issuer,
      { created, purpose: "assertionMethod" },
    );
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type: ISSUE_TYPE, issuer: issuer.did, recipient: this.vtaDid, issuedAt: new Date(created).toISOString().replace(".000Z", "Z"), payload: { credential_response: { credential: vc } } },
      issuer,
      { created },
    );
    const r = await this.post(JSON.stringify(doc), { kind: "actor", vid: issuer.did });
    const rep = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    if (r.transport.status !== 200 || rep?.type !== `${ISSUE_TYPE}#response`) {
      throw new Error(`holdCredential: the VTA did not take the credential (HTTP ${String(r.transport.status)}): ${(r.replies[0] ?? "").slice(0, 300)}`);
    }
    this.credentialBaseline = await this.credentialsNow();
  }

  /** Deferred queries: the VTA's own `credential-exchange/pending-list`, asked by its operator (super admin). */
  private async deferralsNow(): Promise<number> {
    await this.load();
    const op = ed25519Signer(seedOf(OPERATOR_SEED));
    const now = Date.now();
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type: PENDING_LIST_TYPE, issuer: op.did, recipient: this.vtaDid, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: {} },
      op,
      { created: now },
    );
    const headers = { "content-type": "application/json", authorization: `Bearer ${await this.bearer(op.did, "admin")}` };
    const res = await fetch(`${this.baseUrl}/trust-tasks`, { method: "POST", headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    const body = parseJson(text);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    if (res.status !== 200 || payload === undefined || !Array.isArray(payload.pending)) {
      throw new Error(`pending-list on the VTA failed (HTTP ${String(res.status)}): ${text.slice(0, 300)}`);
    }
    return payload.pending.length;
  }

  /** The access list as the VTA's own `acl/list` answers it to its operator. */
  private async aclNow(): Promise<Record<string, unknown>[]> {
    const body = await this.operatorCall(ACL_LIST_TYPE, {});
    const p = isObject(body.payload) ? body.payload : {};
    return Array.isArray(p.entries) ? p.entries.filter(isObject) : [];
  }

  /**
   * The device bindings as the VTA's own `device/list` answers them to its operator. Both flags are sent: the list spec gives `includeDisabled` the meaning "include devices with
   * `disabledAt` set" and `includeWiped` no text, the wipe spec does not say a wipe disables, and VTI sets `disabledAt` on a wipe, so a reading that asks for the wiped binding names both.
   */
  private async devicesNow(): Promise<Record<string, unknown>[]> {
    const body = await this.operatorCall(DEVICE_LIST_TYPE, { includeWiped: true, includeDisabled: true });
    const p = isObject(body.payload) ? body.payload : {};
    return Array.isArray(p.devices) ? p.devices.filter(isObject) : [];
  }

  async verifyProof(params: { bytes: string }): Promise<ProofVerifyResult> {
    const r = await this.ctl("verify", { bytes: params.bytes });
    return { valid: r.valid === true };
  }

  private async credentialsNow(): Promise<number> {
    return Number((await this.ctl("observe", { kind: "credentials" })).value);
  }

  /** Ceremony track: set up the relationship with a peer (a participant of the scenario). */
  async connect(params: ConnectParams): Promise<ConnectResult> {
    this.consent.connect(params.peer.vid);
    return { connected: true };
  }
  async initiate(params: InitiateParams): Promise<InitiateResult> {
    await this.load();
    return this.consent.initiate(params);
  }

  async observe(query: ObserveQuery): Promise<ObserveResult> {
    switch (query.query) {
      case "received":
        return this.consent.received(query);
      case "ceremony":
        return this.consent.ceremony(String(query.threadId));
      case "handled":
        return { value: this.succeeded.size };
      case "pushed":
        if (this.cfg.transports !== true) throw unsupported("observe pushed (this host has no messaging session)");
        await this.refreshPushed();
        return this.outbox.observe(query);
      case "documentState":
        return { value: this.states.get(query.id) ?? "unknown" };
      case "stored":
        if (query.kind === "ceremony-effect") return { value: await this.consent.effectsAny() };
        if (query.kind === "credential") {
          const r = await this.ctl("observe", { kind: "credentials" });
          // a live service's credential store is not readable on its wire (class D): the scenario is inconclusive, not failed
          if (r.unobserved === true) throw new Error("unobservable: the live service's credential store is not readable through its wire (class D)");
          return { value: Number(r.value) - this.credentialBaseline };
        }
        if (query.kind === "deferral") return { value: (await this.deferralsNow()) - this.deferralBaseline };
        // entries other than the identities the adapter itself minted a bearer for (the participants' own rows, which a login would have created)
        if (query.kind === "acl-entry") return { value: (await this.aclNow()).filter((e) => !this.tokens.has(String(e.subject)) && !this.aclIgnore.has(String(e.subject))).length };
        if (query.kind.startsWith("acl-subject:")) return { value: (await this.aclNow()).filter((e) => e.subject === query.kind.slice("acl-subject:".length)).length };
        if (query.kind.startsWith("acl-label:")) { const [subject, label] = query.kind.slice("acl-label:".length).split("|"); return { value: (await this.aclNow()).filter((e) => e.subject === subject && e.label === label).length }; }
        if (query.kind.startsWith("context:")) { const b = await this.operatorCall("https://trusttasks.org/spec/vta/contexts/list/1.0", {}); const p = isObject(b.payload) ? b.payload : {}; return { value: (Array.isArray(p.contexts) ? p.contexts : []).filter((c) => isObject(c) && c.id === query.kind.slice(8)).length }; }
        if (query.kind === "dids" || query.kind.startsWith("dids-in:")) { const b = await this.operatorCall("https://trusttasks.org/spec/vta/dids/list/0.1", query.kind === "dids" ? {} : { contextId: query.kind.slice(8) }); const p = isObject(b.payload) ? b.payload : {}; return { value: Array.isArray(p.dids) ? p.dids.length : 0 }; }
        if (query.kind === "key-released") return { value: this.keyReleased };
        if (query.kind === "device") return { value: (await this.devicesNow()).length - this.deviceBaseline };
        if (query.kind === "device-wiped") return { value: (await this.devicesNow()).filter((d) => d.wipedAt !== undefined && d.wipedAt !== null).length };
        if (query.kind === "device-live") return { value: (await this.devicesNow()).filter((d) => (d.wipedAt === undefined || d.wipedAt === null) && d.lastSeenAt !== undefined && d.lastSeenAt !== null).length };
        // VTI offers no VRC, witnessed credential or presentation store.
        if (query.kind === "vrc" || query.kind === "vwc" || query.kind === "vp" || query.kind === "presentation") return { value: 0 };
        throw unsupported(`observe stored ${query.kind}`);
      default:
        throw unsupported(`observe ${query.query}`);
    }
  }

  private keyReleased = 0;
  async reset(): Promise<void> {
    this.consent.reset();
    this.keyReleased = 0;
    this.succeeded = new Set();
    this.states = new Map();
    if (this.cfg.ceremony === true) {
      // each scenario starts from a fresh VTA: empty stores, the same identity
      const r = await this.ctl("reset");
      this.baseUrl = "";
      this.tokens = new Map();
      void r;
    }
    await this.load();
    this.credentialBaseline = await this.credentialsNow();
    this.deferralBaseline = await this.deferralsNow();
    if (this.cfg.ceremony === true) {
      this.aclBaseline = (await this.aclNow()).length;
      this.deviceBaseline = (await this.devicesNow()).length;
    }
    if (this.cfg.transports === true) {
      await this.ctl("trust-verifier", { clear: true });
      this.outbox.clear();
      this.pushSeen.clear();
      const r = await this.ctl("pushed");
      this.pushBaseline = new Set((Array.isArray(r.pushes) ? r.pushes : []).flatMap((x) => (isObject(x) && typeof x.id === "string" ? [x.id] : [])));
    }
  }

  async send(params: SendParams): Promise<SendResult> {
    await this.load();
    const r = await this.post(params.bytes, params.from, params.http);
    this.track(params.bytes, r);
    this.consent.afterSend(params.bytes, r);
    await this.refreshAfterStepUp(r);
    // persona ceremony (docs/31): a private key the agent released over the runner's carrier is counted
    try { const q = JSON.parse(params.bytes) as { type?: string }; const a = JSON.parse(r.replies[0] ?? "{}") as { type?: string }; if (String(q.type).includes("/keys/export-secret/") && String(a.type).endsWith("#response")) this.keyReleased++; } catch { /* not a document */ }
    const trace = process.env.VTI_INPROCESS_TRACE;
    if (trace !== undefined && trace !== "") appendFileSync(trace, `${JSON.stringify({ from: params.from, request: params.bytes, status: r.transport.status, reply: r.replies[0] ?? null })}\n`);
    return r;
  }

  /**
   * Step-up (docs/26, class D stand-in): VTI records the elevation on the session and tells the client to refresh to get an access token at the
   * elevated acr (vta-service step_up.rs, step 8). The harness carries a bearer per actor, so on an `elevated` answer it takes the refreshed
   * token of that session (the host's /ctl/token with the session id) and uses it from the next request on, as the client's refresh would.
   */
  private async refreshAfterStepUp(r: SendResult): Promise<void> {
    const rep = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    if (rep === undefined || typeof rep.type !== "string" || !rep.type.includes("/auth/step-up/approve-response/") || !isObject(rep.payload) || rep.payload.status !== "elevated" || !isObject(rep.payload.session)) return;
    const { id, subject } = rep.payload.session as { id?: unknown; subject?: unknown };
    if (typeof id !== "string" || typeof subject !== "string") return;
    const t = await this.ctl("token", { did: subject, role: process.env.VTI_ACTOR_ROLE || ACTOR_ROLE, sessionId: id });
    if (typeof t.token === "string") this.tokens.set(subject, { token: t.token, at: Date.now() });
  }

  private track(bytes: string, r: SendResult): void {
    const req = parseJson(bytes);
    const id = typeof req?.id === "string" ? req.id : undefined;
    if (id === undefined || r.transport.kind !== "document") return;
    const rep = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const type = typeof rep?.type === "string" ? rep.type : "";
    if (type.startsWith("https://trusttasks.org/spec/trust-task-error/")) {
      if (!this.succeeded.has(id)) this.states.set(id, "errored");
      return;
    }
    if (r.transport.status === 200 && typeof req?.type === "string" && EXECUTED_TYPES.has(req.type) && type === `${req.type}#response`) {
      this.succeeded.add(id);
      this.states.set(id, "responded");
    }
  }

  private async post(bytes: string, from: SendParams["from"], line: SendParams["http"] = {}, role?: string): Promise<SendResult> {
    const method = line.method ?? "POST";
    const path = line.path === undefined || line.path === "/trust-tasks" ? "/trust-tasks" : line.path;
    const headers: Record<string, string> = { "content-type": line.contentType ?? "application/json" };
    if (from.kind !== "none") headers.authorization = `Bearer ${await this.bearer(from.vid, role)}`;
    // The VTA bounds each client's operations per second (VTI-TRN-029) and refuses work past the budget with a 429 before the task
    // runs, so the answer to a request that was throttled says nothing about the task. The limit is a documented one: wait it out
    // (`retry-after`, whole seconds, at least 1) and resend the same bytes, up to a bound, as the community adapter does.
    const maxWait = this.cfg.maxRateLimitWaitMs ?? 30_000;
    let waited = 0;
    let res: Response;
    let body: string;
    for (;;) {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: bytes }), signal: AbortSignal.timeout(60_000) });
      body = await res.text();
      if (res.status !== 429) break;
      const wait = Math.max(1000, Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-after") ?? "1") * 1000);
      if (waited + wait > maxWait) break;
      waited += wait;
      await (this.cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
    }
    const status = res.status;
    const contentType = res.headers.get("content-type") ?? undefined;
    let kind: TransportKind;
    let replies: string[];
    if (status === 202 || status === 204) {
      kind = "none";
      replies = [];
    } else if ([404, 405, 413, 429].includes(status) || body === "") {
      kind = "refused";
      replies = [];
    } else {
      kind = "document";
      replies = [body];
    }
    return { replies, transport: { status, kind, ...(contentType === undefined ? {} : { contentType }) }, quiescentAfterMs: 0 };
  }
}
