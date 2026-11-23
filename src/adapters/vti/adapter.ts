// SPDX-License-Identifier: Apache-2.0
// Adapter for the Verifiable Trust Infrastructure (VTI) community service (VTC), the live peer, over its HTTPS door.
// The suite measures a running `vtc` exactly as shipped: nothing in VTI is changed, hooked or configured for the suite.
//
// What it does and, as important, what it does not (every statement below is checked against vtc-service at the pinned ref):
//   - Binding: `POST <base>/v1/trust-tasks` (vtc-service/src/routes/mod.rs nests the API under /v1; routes/trust_tasks.rs). The door
//     reads no Authorization header, so no bearer is ever sent and `from` (transport identity) has no effect: sends from `actor`,
//     `none` and `spoof` are the same bytes with the same headers. Vectors that need a bearer-to-sender mapping (BND-002 and any
//     spoof vector) therefore measure that VTI has none; that is a finding, not something the adapter papers over.
//   - Carrier: `notifications/notify/0.1` addressed to the community. It requires proof, recipient and issuedAt, has a closed payload
//     and accepts a notification from any signer (what is kept is a policy matter and never visible in the answer, VTI-NTF-023).
//   - `handled` is derived from the wire: the number of distinct request ids of the carrier type that VTI answered with its `#response`
//     (HTTP 200). VTI offers no authenticated count of executions, and the carrier's effect (a held notification) is deduplicated by
//     the notification id, which the harness cannot vary, so a stored-record count would under-count. The count is zeroed by `reset`.
//     This is stated in the matrix label; it is as good as VTI's own claim that it executed the document.
//   - Clock: VTI reads the system clock (`chrono::Utc::now()`); there is no injection point. The adapter declares `clockFree`, so
//     the runner rebases every vector on real time and SKIPs the vectors that need exact clock control. `setClock`/`advance` are refused.
//   - Not provided (refused with a JSON-RPC error, and the matching capabilities are not declared): `trust`, `snapshot`, `diff`,
//     `verifyProof` (no proof-verification entry on the wire), every `trigger`, `observe` kinds other than `handled`/`documentState`/
//     `stored vrc` (VTI hosts no VRC, so zero is the truth), and `retained`.
//   - `reset` clears only the adapter's own counters. VTI's duplicate record is durable and cannot be wiped through the wire; the
//     runner's per-run id salt keeps runs from colliding. `restart` restarts the container (compose) with the data volume kept.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import type { Ed25519Signer } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import type {
  Adapter, Capabilities, DeclareGovernanceResult, EssentialGovernance, GovernanceDeclaration, ObserveQuery, ObserveResult, ProofVerifyResult, ProvisionedRole, SendParams, SendResult, TransportKind,
} from "../../adapter/contract.ts";
import { cited } from "../../adapter/contract.ts";
import { isObject } from "../../util/json.ts";
import { PushedBox } from "../../adapter/pushed.ts";
import { didKeyDocument } from "../vti-inprocess/adapter.ts";

/** The exact name the exceptions file keys VTI entries on (BND-002). */
export const VTI_ADAPTER_NAME = "verifiable-trust-infrastructure";
/**
 * The implementation name of this adapter when it drives the in-process VTC host (`controlUrl` set): a surface of its own, distinct from
 * the live service, so exceptions are keyed per surface (docs/04 section 8). The host runs the same service code over a loopback door.
 */
export const VTC_HOST_NAME = "verifiable-trust-infrastructure-vtc-inprocess";
export const NOTIFY_TYPE = "https://trusttasks.org/spec/notifications/notify/0.1";
export const PRESENT_TYPE = "https://trusttasks.org/spec/credential-exchange/present/0.1";
export const DISCOVERY_V0_3 = "https://trusttasks.org/spec/trust-task-discovery/0.3";
/** The acceptance window VTI applies and advertises (vti-common/src/trust_task/acceptance.rs: 600 s max age, 60 s skew; 30 d horizon). */
export const VTI_WINDOW = { maxAgeSeconds: 600, clockSkewSeconds: 60, expiryHorizonSeconds: 2_592_000 } as const;

export interface VtiConfig {
  /** Origin of the VTC, for example http://127.0.0.1:8200 */
  baseUrl: string;
  /** Mount of the API: the trust-task door is `<baseUrl><apiPrefix>/trust-tasks`. */
  apiPrefix: string;
  /** The service DID, when known; otherwise read from `<baseUrl>/.well-known/did.jsonl`. */
  serviceDid?: string;
  /** The version string recorded in the matrix (service version and pinned ref). */
  version: string;
  /** Directory of the docker compose project (the buildathon kit) and the service/profile used by `restart`. Absent: `restart` is refused and not declared. */
  composeDir?: string;
  composeService: string;
  composeProfile: string;
  /** Seconds to wait for the service to answer /health after a restart. */
  restartWaitSeconds: number;
  /** Upper bound on the total time one send spends waiting out the anonymous rate limit (HTTP 429). */
  maxRateLimitWaitMs: number;
  /**
   * Minimum spacing between two sends to the door, in ms (VTI_PACE_MS; 0 = none). The VTC admits documents that name a known signer
   * at one per 250 ms per source address after a burst of 120 (vtc-service routing/trust_task_admission.rs SIGNED_ADDRESS_*), and a known
   * signer's own bucket allows one per 500 ms after a burst of 60, so a long row is bound by that policy, not by the host. Pacing changes
   * little (Retry-After is exact); run shards, one host each, to go faster (docs/decisions/README.md D480, D481).
   */
  paceMs?: number;
  /**
   * Control interface of the in-process VTC host (vtc-host/), for example http://127.0.0.1:41000. Absent: the adapter measures a
   * running `vtc` exactly as before. Present: `baseUrl` is the host's loopback door, and the host gives what the live wire does not
   * (ACL seeding without a container, VTI's own proof verification, an administrator's bearer), see the header of vtc-host/src/main.rs.
   */
  controlUrl?: string;
  /**
   * With the host: the ACL role the harness actors are seeded with (default `member`, as the live kit seeds them: no administrative authority).
   * The plain-task vectors that test payload validation of administrative tasks are decided after the authorization check, so they need an
   * actor the service authorizes (`admin`); the role is the deployment's choice and is stated in the run README.
   */
  actorRole?: string;
  /**
   * With the host: run the platform's own boot-time installation of its shipped default policies before the first request (the host's
   * /ctl/defaults), as a deployed VTC does and the test-support state does not. Declares the optional capability `seed.defaults`. Off by
   * default, so every earlier run is measured exactly as before (docs/22, the seeded-state probe).
   */
  seedDefaults?: boolean;
  /** Ceremony track (docs/26): `reset` starts a fresh community (empty stores, same identity), `provision(peer)` is the service, and the trigger `seedMember` makes a DID a member. */
  ceremony?: boolean;
  /**
   * The community's public URL, whose origin the service's `auth/oob/request` accepts as the portal's own (T19: `portal_origin`, vtc-service/src/member_portal/oob.rs:
   * with a configured `public_url` the `Origin` header must equal that URL's origin exactly; the request's own address and Host header do not count). The in-process
   * host configures `http://vtc.test`, not its loopback address, so the sign-in's `Origin` and the `SignInPortal` service of the community's DID document use this.
   * Read from the host's `/ctl/info` (`publicUrl`) when it reports one, else this value, else for the in-process host the host's fixed default (HOST_PUBLIC_URL).
   */
  publicUrl?: string;
}

/** The public URL the in-process VTC host configures (vtc-host/src/main.rs `with_public_url`); the prebuilt hosts do not report it through /ctl/info. */
export const HOST_PUBLIC_URL = "http://vtc.test";

export const DEFAULT_CONFIG: VtiConfig = {
  baseUrl: "http://127.0.0.1:8200",
  apiPrefix: "/v1",
  version: "vtc-service (version not given)",
  composeService: "vtc",
  composeProfile: "vtc",
  restartWaitSeconds: 90,
  maxRateLimitWaitMs: 180_000,
};

/** Runs an external command; replaceable so tests do not need docker. */
export type CommandRunner = (cmd: string, args: string[], cwd: string) => Promise<void>;
const realRunner: CommandRunner = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 120_000 }, (err, _out, stderr) => (err ? reject(new Error(`${cmd} ${args.join(" ")}: ${err.message} ${stderr}`.trim())) : resolve()));
  });

export interface VtiAdapterOptions {
  config?: Partial<VtiConfig>;
  run?: CommandRunner;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** An identity of the adapter itself, never a harness actor: the community's administrator, which asks the VTC for a credential query. */
const ADMIN_SEED = 0x1c;
const TT = "https://trusttasks.org/spec/";
/** The Accepts criterion every VTC seeds at start-up (`seed_default_criteria`, id `member-credential`): a membership credential admits. */
export const MEMBERSHIP_CRITERION = "member-credential";
export const ROLE_LIST_TYPE = "https://trusttasks.org/spec/vtc/roles/list/0.1";
export const ROLE_DEFINE_TYPE = "https://trusttasks.org/spec/vtc/roles/define/0.1";
/**
 * Capabilities a declared role's ceiling is built from (vtc-service `acl/capability.rs`): `vtc.roles.assign` is what lets a holder grant at
 * all; the others are distinct, non-authority-conferring stand-ins, one per declared role, so that "may grant role Y" can be stated as
 * "holds Y's ceiling". The VTC decides who may grant a role by these ceilings, not by a who-may-grant-whom list.
 */
const ROLES_ASSIGN = "vtc.roles.assign";
const CEILING_POOL = ["vtc.members.manage", "vtc.join.decide", "vtc.invitations.manage", "vtc.credentials.issue", "vtc.directory.notes", "vtc.audit.read"];
export const JOIN_QUERY_TYPE = "https://trusttasks.org/spec/vtc/join-requests/query/0.1";

/** The harness roles: the same deterministic did:key identities the runner's `makeActors` uses (seeds 0x0a..0x0f). */
const ROLE_SEEDS: Record<string, number> = { A: 0x0a, X: 0x0b, R: 0x0c, S: 0x0d, Q: 0x0e, W: 0x0f };

/** The VTI ref the essential-governance evidence below was read at. */
export const VTI_EVIDENCE_REF = "26d0da81";

/**
 * The community service's essential governance, E (docs/04 section 19), as this adapter can state it. The VTC holds an
 * authority-conferring act for consent with an approver set fixed by its requirement, not by a configured rule (VTI-APV-018: every
 * other ACL entry that may decide the act, the requester excluded), and a threshold that is community configuration
 * (`acl.unrestricted_admin_consent_threshold`, default 1). E is readable only where the ACL is the harness's own: the in-process host
 * with the actors seeded `admin`. Then the authority set is the six harness actors plus the adapter's administrator identity, k is the
 * default 1 (the host does not change it), and the source is `fixed-rule` (advisory GOV-FIXED). The adapter offers no ceremony
 * (`optional:ceremony` is not declared: the VTC parks an act only after the requester's operation-bound passkey gesture, which the
 * harness cannot give), so nothing drives this E and the honesty check does not run.
 */
export function vtcEssential(cfg: Pick<VtiConfig, "controlUrl" | "actorRole">): EssentialGovernance {
  const rule = `VTI ${VTI_EVIDENCE_REF}: vtc-service/src/acl/admin_consent.rs:23 (approver set fixed by the requirement), :1593 approvers_for (every other ACL entry that may decide; the requester excluded); vtc-service/src/config.rs:894, :961 (acl.unrestricted_admin_consent_threshold, default 1)`;
  if (cfg.controlUrl === undefined) {
    return { source: "unreadable", evidence: rule, reason: "the live community service's ACL and its acl.unrestricted_admin_consent_threshold are the deployment's own; the adapter holds no administrator credential and reads neither" };
  }
  if (cfg.actorRole !== "admin") {
    return { source: "unreadable", evidence: rule, reason: `the harness actors are seeded ${cfg.actorRole ?? "member"}, which decides no authority-conferring act, so the authority set is held outside the harness; VTI_ACTOR_ROLE=admin makes it readable` };
  }
  return {
    source: "fixed-rule",
    principals: [...Object.keys(ROLE_SEEDS).map((r) => ({ vid: `$${r}`, role: "admin" })), { vid: ed25519Signer(seedOf(ADMIN_SEED)).did, role: "admin" }],
    consent: { task: "https://trusttasks.org/spec/acl/grant/0.2", approverSet: "admin", minApprovals: 1, excludeRequester: true },
    evidence: `${rule}; the ACL is the harness's (the host's /ctl/seed with VTI_ACTOR_ROLE=admin, plus the adapter's administrator identity) and the threshold is left at its default`,
  };
}

/**
 * Requirements the community service itself does not offer (not "the adapter cannot reach it"); each checked in vtc-service at the pinned
 * ref (the dispatch table `trust_tasks/mod.rs`, the served-URI list, the module notes of `trust_tasks/credential_exchange.rs`).
 */
const NO_VRC = "VTI defines no vrc/relationships task (no handler in the VTA or the VTC dispatch table)";
/** 2L types the community service does not serve: URI path absent from vtc-service/src (grep of the VTI checkout at the pinned ref, spec crates excluded), except where a constant carries it (stated per entry). */
export const NOT_OFFERED_2L: Record<string, string> = {
  "optional:emit": "this row drives the community service's handlers (the receiving side); the documents VTI builds itself are measured by the separate VTI emit row (src/adapters/vti-emit/), where the same vectors run",
  "https://trusttasks.org/spec/push/register/0.2": "the type's URI path appears in neither vtc-service/src nor vta-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vetting/attestation/0.1": "not in the VTC's own handlers: the type's URI path appears nowhere in vtc-service/src outside the specification crates (grep at the pinned ref); vta-service/src carries it (the agent service)",
  "https://trusttasks.org/spec/vetting/decline/0.1": "the type's URI path appears in neither vtc-service/src nor vta-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vetting/request/0.1": "the type's URI path appears in neither vtc-service/src nor vta-service/src outside the specification crates (grep at the pinned ref)",
  "https://trusttasks.org/spec/vta/notifications/deposit/0.1": "not in the VTC's own handlers: the type's URI path appears nowhere in vtc-service/src outside the specification crates (grep at the pinned ref); vta-service/src carries it (the agent service)",
  "https://trusttasks.org/spec/vta/notifications/dismiss/0.1": "not in the VTC's own handlers: the type's URI path appears nowhere in vtc-service/src outside the specification crates (grep at the pinned ref); vta-service/src carries it (the agent service)",
  "https://trusttasks.org/spec/vta/notifications/list/0.1": "not in the VTC's own handlers: the type's URI path appears nowhere in vtc-service/src outside the specification crates (grep at the pinned ref); vta-service/src carries it (the agent service)",
  "https://trusttasks.org/spec/vta/notifications/show/0.1": "not in the VTC's own handlers: the type's URI path appears nowhere in vtc-service/src outside the specification crates (grep at the pinned ref); vta-service/src carries it (the agent service)",
  "https://trusttasks.org/spec/vtc/members/request-vmc/0.1": "the VTC builds and pushes request-vmc to a member (routes/members/request_vmc.rs, via vta_sdk MEMBER_REQUEST_VMC_TYPE and push_document) and has no inbound handler for it",
};

export const NOT_OFFERED: Record<string, string> = {
  "https://trusttasks.org/spec/vrc/relationships/propose/0.1": NO_VRC,
  "https://trusttasks.org/spec/vrc/relationships/issue/0.1": NO_VRC,
  "https://trusttasks.org/spec/vrc/relationships/witness-share/0.1": "VTI defines no vrc/relationships task (its witness tasks are witness/session, a different family)",
  "https://trusttasks.org/spec/task-consent/request/0.1": "the VTC builds task-consent/request to push to an approver and has no inbound handler for it (no dispatch entry)",
  "https://trusttasks.org/spec/task-consent/granted/0.1": "the VTC has no inbound handler for task-consent/granted (no dispatch entry)",
  "https://trusttasks.org/spec/task-consent/decision/0.1": "the VTC dispatches task-consent/decision 0.2 only (vtc-service imports task_consent::decision::v0_2 only); no handler for version 0.1",
  "https://trusttasks.org/spec/credential-exchange/issue/0.1": "the VTC sends credential-exchange/issue (offer, request, issue run community to holder) and has no inbound handler for it",
  "https://trusttasks.org/spec/credential-exchange/offer/0.1": "the VTC sends credential-exchange/offer to a holder and has no inbound handler for it",
  "https://trusttasks.org/spec/credential-exchange/query/0.1": "the VTC sends credential-exchange/query to a holder (vtc/join-requests/query) and has no inbound handler for it; it serves present and request",
  "optional:discovery.expiryHorizon": "the service enforces a 30-day expiry horizon but its trust-task-discovery 0.3 answer does not state it (0.4 would), and DIS-013 reads the horizon from the answer; declaring the capability ended in a harness error (vti-reach, 2026-11-15)",
  "optional:ceremony": "VTI has no ceremony-document family (begin, approve, reset); its task-consent is a policy approval flow",
  "optional:receiptVerify": "VTI has no trust-ceremony-receipt verifier (only generated wire types)",
  "optional:fault.claimStore": "the accepted-id store is built inside the service from its own keyspace (`StoreAcceptedIds`, vti-trust-task-server); there is no seam to substitute a faulting store",
  "optional:transportIdentity": "the VTC's trust-task door reads no bearer token (routes/trust_tasks.rs): the sender is the signer of the document, so there is no transport identity to spoof",
};

const unsupported = (what: string): Error => new Error(`not supported by the VTI adapter: ${what}`);

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export class VtiAdapter implements Adapter {
  readonly cfg: VtiConfig;
  private readonly run: CommandRunner;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastSendAt = 0;
  private serviceDid: string | undefined;
  private didDocument: unknown;
  /** Distinct carrier request ids VTI answered with a `#response`. */
  private succeeded = new Set<string>();
  /** id -> last observed outcome, for `documentState`. */
  private states = new Map<string, "responded" | "errored">();
  /** FC-CEX-002 and 003 share FC-KVX's choreography (query to a holder, the holder's decision, the presentation relayed back): the same `cex-query` initiator serves the verifier seat (2026-11-21). */
  /** Join requests held at the last `reset` (host only): `stored presentation` counts what was added since. */
  private joinBaseline = 0;
  /** Ceremony track (FC-KVX): what reached the community (the holders' presentations) and how it answered each, by thread. */
  private readonly kvxInbox: { from: string; type: string; threadId: string; text: string }[] = [];
  private readonly kvxVerdict = new Map<string, "completed" | "refused">();
  private readonly kvxThreads = new Set<string>();
  /** observe.pushed (host only): what the VTC's push engine queued since the last `reset`, from its durable push records. */
  private readonly outbox = new PushedBox();
  private pushBaseline = new Set<string>();
  private readonly pushSeen = new Set<string>();

  constructor(opts: VtiAdapterOptions = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...opts.config };
    this.cfg.baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
    this.serviceDid = this.cfg.serviceDid;
    this.run = opts.run ?? realRunner;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private door(path = "/trust-tasks"): string {
    return `${this.cfg.baseUrl}${this.cfg.apiPrefix}${path}`;
  }

  /** A call to the in-process host's control interface. */
  private async ctl(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.cfg.controlUrl}/ctl/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
    const out = parseJson(await res.text());
    if (out === undefined || typeof out.error === "string") throw new Error(`host ${path}: ${out === undefined ? `HTTP ${res.status}` : String(out.error)}`);
    return out;
  }

  /**
   * `seed` through the host. A live service's control layer makes a member the way the service does (an application the administrator approves), which
   * leaves join-request records a fresh community does not hold; it reports them (`joinRequests`) so the scenario's counts stay relative to its own start.
   */
  private async seedCtl(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await this.ctl("seed", body);
    if (this.liveBase !== undefined && isObject(r.joinRequests)) for (const [st, k] of Object.entries(r.joinRequests)) this.liveBase[st] = (this.liveBase[st] ?? 0) + Number(k);
    return r;
  }
  /** Live service only: the join requests the community held (by status) when the scenario began, which `stored join-request` counts do not include. */
  private liveBase: Record<string, number> | undefined;
  /** The control layer reported a live service (info.live). */
  private live = false;

  /**
   * The push engine's records, from the host. A live service's control layer reports `unobservable` (its push records are in the service's store,
   * not on its wire): a check that needs them throws "unobservable: ..." and the ceremony runner records the scenario `inconclusive`, never `failed`.
   * `soft`: the provision-time baseline, which must not stop a scenario that never reads a push.
   */
  private async pushes(soft = false): Promise<Record<string, unknown>> {
    const r = await this.ctl("pushed");
    if (r.unobservable === true && !soft) throw new Error("unobservable: the live service's push records are not readable through its wire (class D: no operator observation of the push engine)");
    return r;
  }

  /** Read the service DID and its DID document from the log the VTC serves (the last entry's state; the log is not verified here). With a host: its did:key. */
  private async loadIdentity(): Promise<void> {
    if (this.didDocument !== undefined) return;
    if (this.cfg.controlUrl !== undefined) {
      const i = await this.ctl("info");
      this.cfg.baseUrl = String(i.baseUrl).replace(/\/+$/, "");
      if (typeof i.publicUrl === "string" && i.publicUrl !== "") this.cfg.publicUrl = i.publicUrl;
      else this.cfg.publicUrl ??= HOST_PUBLIC_URL;
      this.serviceDid = String(i.vtcDid);
      this.live = i.live === true;
      // a live service's control layer reports the document of the log the service serves (a did:webvh); the in-process host's is a did:key
      this.didDocument = isObject(i.didDocument) ? i.didDocument : didKeyDocument(this.serviceDid);
      for (const role of Object.keys(ROLE_SEEDS)) await this.seedCtl({ did: this.actor(role).did, role: this.cfg.actorRole ?? "member" });
      if (this.cfg.seedDefaults === true) await this.ctl("defaults");
      return;
    }
    const res = await fetch(`${this.cfg.baseUrl}/.well-known/did.jsonl`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GET /.well-known/did.jsonl answered ${res.status}`);
    const lines = (await res.text()).split("\n").filter((l) => l.trim() !== "");
    const last = parseJson(lines[lines.length - 1] ?? "");
    const state = last !== undefined && isObject(last.state) ? last.state : undefined;
    if (state === undefined || typeof state.id !== "string") throw new Error("the VTC's did.jsonl has no readable last entry with a state.id");
    if (this.serviceDid !== undefined && this.serviceDid !== state.id) throw new Error(`configured service DID ${this.serviceDid} is not the one the VTC serves (${state.id})`);
    this.serviceDid = state.id;
    this.didDocument = state;
  }

  /** The origin the service treats as its portal's: the configured public URL's, else (a service with none) the door's own. */
  portalOrigin(): string {
    return new URL(this.cfg.publicUrl ?? this.cfg.baseUrl).origin;
  }

  private actor(role: string): Ed25519Signer {
    const seed = ROLE_SEEDS[role];
    if (seed === undefined) throw new Error(`unknown harness role ${role}`);
    return ed25519Signer(seedOf(seed));
  }

  /** What the VTC says it serves, from a signed discovery 0.3 query (VTC answers discovery to identified callers only). */
  private async discoverTypes(): Promise<string[]> {
    await this.loadIdentity();
    const a = this.actor("A");
    const now = Date.now();
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type: DISCOVERY_V0_3, issuer: a.did, recipient: this.serviceDid!, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: {} },
      a,
      { created: now },
    );
    const r = await this.post(JSON.stringify(doc));
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    if (r.transport.status !== 200 || payload === undefined || !Array.isArray(payload.supportedTypes)) {
      throw new Error(`discovery 0.3 query to the VTC failed (HTTP ${String(r.transport.status)}): ${(r.replies[0] ?? "").slice(0, 300)}`);
    }
    const out: string[] = [];
    for (const e of payload.supportedTypes) {
      const t = typeof e === "string" ? e : isObject(e) ? e.type : undefined;
      if (typeof t === "string") out.push(t);
    }
    return out;
  }

  /**
   * With the host: the built-in role names the VTC itself lists (`vtc/roles/list/0.1`, asked as the administrator identity; the vocabulary is
   * the VTC's, with custom roles possible). Declared as the deployment's own roles for the plain family (`$role(n)`), never chosen by the suite.
   */
  private async builtInRoles(): Promise<string[]> {
    await this.loadIdentity();
    const admin = ed25519Signer(seedOf(ADMIN_SEED));
    await this.seedCtl({ did: admin.did, role: "admin" });
    const now = Date.now();
    const doc = signDocument(
      { id: `urn:uuid:${randomUUID()}`, type: ROLE_LIST_TYPE, issuer: admin.did, recipient: this.serviceDid!, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: {} },
      admin,
      { created: now },
    );
    const r = await this.post(JSON.stringify(doc));
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const roles = body !== undefined && isObject(body.payload) && Array.isArray(body.payload.roles) ? body.payload.roles : [];
    return roles.filter((x): x is Record<string, unknown> => isObject(x) && x.builtIn === true && typeof x.name === "string").map((x) => String(x.name));
  }

  async capabilities(): Promise<Capabilities> {
    const supported = await this.discoverTypes();
    const hostRoles = this.cfg.controlUrl === undefined ? [] : await this.builtInRoles();
    return {
      // ceremony track (docs/26, FC-KVX): the community as the verifier of a presentation (its query to a holder is the real push the host records)
      ...(this.cfg.controlUrl === undefined ? {} : { initiates: ["cex-query"] }),
      name: this.cfg.controlUrl === undefined ? VTI_ADAPTER_NAME : VTC_HOST_NAME,
      implementation: this.cfg.controlUrl === undefined ? VTI_ADAPTER_NAME : VTC_HOST_NAME,
      version: this.cfg.version,
      tierMax: 2,
      bindings: ["https"],
      supportedTypes: supported,
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
      // The VTC verifies proofs with the shared verifier (the VTA's is the same function), which accepts a P-256 did:key proof; stated only
      // where the adapter can ask the VTC (the host's /ctl/verify), because the live wire has no verification entry.
      cryptosuites: this.cfg.controlUrl === undefined ? ["eddsa-jcs-2022"] : ["eddsa-jcs-2022", "ecdsa-jcs-2019"],
      // discovery.acceptanceWindow: the discovery 0.3 answer states the window at response level (maxAgeSeconds, clockSkewSeconds); the
      // 0.4 `expiryHorizonSeconds` is not served, so `discovery.expiryHorizon` is not declared.
      // clockFree: no injectable clock. attested: the carrier requires a proof (and VTI signs its answers), so the unsigned Tier 1
      // vectors are SKIP for this implementation rather than failing on a refusal that is VTI's policy. restart only when the
      // compose project is given.
      optional: ["clockFree", "attested", "discovery.acceptanceWindow", ...(this.cfg.composeDir === undefined ? [] : ["restart"]), ...(this.cfg.controlUrl === undefined ? [] : ["proofVerify", "trigger.presentationNonce", "observe.pushed", "initiate", "peer.connect", "observe.received", "observe.ceremony", "governance.declare", ...(this.cfg.seedDefaults === true ? ["seed.defaults"] : []), ...(hostRoles.length === 0 ? [] : ["governance.roles", "governance.content"])])],
      // Governance (docs/17). With the host the adapter declares a role set through the VTC's own `vtc/roles/define/0.1` (custom roles; the VTA's
      // role set is a closed enum). `consent` is not declarable: the consent threshold is one community-wide setting, not a per-task rule.
      // `roles` (plain family, `$role(n)`): the VTC's own built-in roles, read from the VTC; `governance.content`: the in-process VTC accepts the
      // policy module an administrator upserts (its throwaway store). Adapter-declared, from the deployment, not chosen by the suite.
      governance: this.cfg.controlUrl === undefined
        ? { declaration: "none", reason: "the adapter holds no administrator credential for a running community service, so it cannot ask it to define a role", essential: vtcEssential(this.cfg) }
        : { declaration: "supported", items: ["roles", "authority"], ...(hostRoles.length === 0 ? {} : { roles: hostRoles }), essential: vtcEssential(this.cfg) },
      window: { ...VTI_WINDOW },
      // ceremony roles by union: the consent-gate track (FC-KVX, the community as the verifier of a presentation) and the paired-ceremony track (sign-in service, community of the onboarding and vetting groups)
      ceremonyRoles: [
        ...(this.cfg.controlUrl === undefined ? [] : [{ ceremony: "FC-KVX", roles: ["verifier"] }, { ceremony: "FC-CEX", roles: ["verifier"] }]),
        ...(this.cfg.ceremony === true ? [{ ceremony: "FC-AUT", roles: ["service"] }, { ceremony: "FC-MBR", roles: ["community"] }, { ceremony: "FC-ONB", roles: ["community"] }, { ceremony: "FC-IDV", roles: ["community"] }, { ceremony: "FC-DIR", roles: ["community"] }, { ceremony: "FC-VOT", roles: ["community"] }, { ceremony: "FC-RMS", roles: ["community"] }] : []),
      ],
      // Cited (docs/04 section 8): checked in vtc-service at the pinned ref. `optional:emit` stays uncited (measured on the VTI emit row).
      notOffered: {
        ...cited(NOT_OFFERED_2L, `VTI ${VTI_EVIDENCE_REF}: a search of vtc-service/src (and vta-service/src) outside the specification crates (a constant that carries the path is named in the reason)`),
        "optional:emit": NOT_OFFERED_2L["optional:emit"]!,
        ...cited(NOT_OFFERED, `VTI ${VTI_EVIDENCE_REF}: the vtc-service dispatch table (trust_tasks/mod.rs), the served-URI list and the module notes of trust_tasks/credential_exchange.rs`),
      },
      pins: { framework: "0.6.0", error: "0.6", binding: "https/0.3" },
    };
  }

  async provision(roles: string[]): Promise<Record<string, ProvisionedRole>> {
    const out: Record<string, ProvisionedRole> = {};
    for (const role of roles) {
      if (role === "iut" || role === "peer") {
        // `peer` (the ceremony runner's role name for the participant itself, docs/25) is the service: a scenario addresses the community by its own DID
        await this.loadIdentity();
        // Ceremony track: the DID document a deployed community publishes carries the sign-in services (VTI's own `sign_in_portal_service`, VTI-LNK-102); the in-process community is a did:key, which cannot, so the
        // adapter adds the two services the wallet reads (class D: a stand-in document for the one a did:webvh would publish).
        const doc = this.cfg.ceremony === true && isObject(this.didDocument)
          ? { ...this.didDocument, service: [{ id: `${this.serviceDid}#trust-tasks`, type: "TrustTaskHTTPS", serviceEndpoint: `${this.portalOrigin()}/v1` }, { id: `${this.serviceDid}#sign-in-portal`, type: "SignInPortal", serviceEndpoint: `${this.portalOrigin()}/members/` }] }
          : this.didDocument;
        out[role] = { vid: this.serviceDid!, didDocument: doc, transportAddress: this.door(), keyCustody: "iut" };
      } else {
        const s = this.actor(role);
        out[role] = { vid: s.did, transportAddress: "none", keyCustody: "harness" };
      }
    }
    return out;
  }

  /**
   * `declareGovernance` (host only): the declared roles become custom roles through `vtc/roles/define/0.1`, sent by the community's
   * administrator identity. The VTC states who may grant a role by capability ceilings, so the declared authority rule is first mapped to
   * ceilings and checked to be exactly the relation those ceilings give; a rule that is not such a relation is `unsupported` (not a verdict).
   * A refusal that asks for what the harness cannot give (the requester's bound passkey gesture, the consent of another administrator) is
   * `unsupported` too, with the VTC's own words; a refusal of the content itself is `rejected`.
   */
  async declareGovernance(decl: GovernanceDeclaration): Promise<DeclareGovernanceResult> {
    if (this.cfg.controlUrl === undefined) return { status: "unsupported", reason: "no host" };
    if (decl.consent !== undefined) return { status: "unsupported", reason: "the consent threshold is a community-wide setting, not a per-task rule" };
    const roles = decl.roles;
    if (roles.length > CEILING_POOL.length) return { status: "unsupported", reason: `more than ${CEILING_POOL.length} roles` };
    const grants = (g: string): string[] => decl.authority?.[g] ?? [];
    const cap = new Map(roles.map((r, i) => [r, CEILING_POOL[i]!] as const));
    const ceiling = (r: string): Set<string> => new Set([...(grants(r).length > 0 ? [ROLES_ASSIGN] : []), ...grants(r).map((y) => cap.get(y)!).filter((c) => c !== undefined)]);
    for (const g of roles) {
      const may = new Set(roles.filter((t) => ceiling(g).has(ROLES_ASSIGN) && [...ceiling(t)].every((c) => ceiling(g).has(c))));
      if (may.size !== grants(g).length || !grants(g).every((t) => may.has(t))) {
        return { status: "unsupported", reason: `the community service lets a holder grant a role whose ceiling it holds (with vtc.roles.assign); the declared rule for ${g} (may grant ${JSON.stringify(grants(g))}) is not such a relation (it would be ${JSON.stringify([...may])})` };
      }
    }
    await this.loadIdentity();
    const admin = ed25519Signer(seedOf(ADMIN_SEED));
    await this.seedCtl({ did: admin.did, role: "admin" });
    for (const name of roles) {
      const refs = [...ceiling(name)].map((capability) => ({ capability }));
      const now = Date.now();
      const doc = signDocument(
        { id: `urn:uuid:${randomUUID()}`, type: ROLE_DEFINE_TYPE, issuer: admin.did, recipient: this.serviceDid!, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: { name, ceiling: refs, approveScope: [] } },
        admin,
        { created: now },
      );
      const r = await this.post(JSON.stringify(doc));
      const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
      const p = body !== undefined && isObject(body.payload) ? body.payload : undefined;
      if (r.transport.status === 200 && typeof body?.type === "string" && body.type.endsWith("#response")) continue;
      const code = typeof p?.code === "string" ? p.code : `HTTP ${r.transport.status}`;
      const message = typeof p?.message === "string" ? p.message : (r.replies[0] ?? "").slice(0, 300);
      if (code === "permissionDenied" || code === "stepUpRequired" || /consent|gesture|step-up/i.test(message)) return { status: "unsupported", reason: `vtc/roles/define for ${name} answered ${code}: ${message}` };
      return { status: "rejected", reason: `vtc/roles/define for ${name} answered ${code}: ${message}` };
    }
    // The roles exist. Holding them is by the VTC's own acl/grant (not exercised here: the define path is closed to the harness, see above).
    return { status: "unsupported", reason: "the roles were defined, but granting them to the declared principals is not implemented in this adapter" };
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
  async verifyProof(params?: { bytes: string }): Promise<ProofVerifyResult> {
    if (this.cfg.controlUrl === undefined || params === undefined) throw unsupported("verifyProof (VTI exposes no proof-verification entry on the wire; proofVerify is declared only with the in-process host)");
    const r = await this.ctl("verify", { bytes: params.bytes });
    return { valid: r.valid === true };
  }

  /**
   * `presentationNonce` (host only): the community's administrator asks the VTC for a credential query for a holder, through the VTC's
   * own `vtc/join-requests/query/0.1` task (admin route; it prepares the single-use challenge and returns the query with its nonce and
   * the thread the holder presents on; the VTC's own push of it to the holder is best effort and not needed). The nonce is the VTC's.
   */
  async trigger(action: string, args: Record<string, unknown> = {}): Promise<{ documents: string[] }> {
    if (action === "seedMember" && this.cfg.ceremony === true && this.cfg.controlUrl !== undefined) {
      // Deployment state: the community's records already hold this DID as a member (the wallet joined it earlier); the community's own host seeds the ACL row and the member record.
      await this.loadIdentity();
      await this.seedCtl({ did: String(args.vid), role: "member", label: String(args.label ?? "Ceremony member") });
      return { documents: [] };
    }
    if (this.cfg.ceremony === true && this.cfg.controlUrl !== undefined && ["knowApplicant", "decide", "solicit", "grantVetter", "revokeVetterGrant", "dirMember", "offerRoom", "waitPast"].includes(action)) return this.ceremonyTrigger(action, args);
    if (action !== "presentationNonce" || this.cfg.controlUrl === undefined) throw unsupported(`trigger ${action} (VTI offers no trigger surface to the harness)`);
    await this.loadIdentity();
    const admin = ed25519Signer(seedOf(ADMIN_SEED));
    await this.seedCtl({ did: admin.did, role: "admin" });
    const now = Date.now();
    const doc = signDocument(
      {
        id: `urn:uuid:${randomUUID()}`,
        type: JOIN_QUERY_TYPE,
        issuer: admin.did,
        recipient: this.serviceDid!,
        issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"),
        payload: { holderDid: this.actor("A").did, criterionId: MEMBERSHIP_CRITERION },
      },
      admin,
      { created: now },
    );
    const r = await this.post(JSON.stringify(doc));
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    const query = payload !== undefined && isObject(payload.query) ? payload.query : undefined;
    if (r.transport.status !== 200 || payload === undefined || typeof payload.threadId !== "string" || typeof query?.nonce !== "string") {
      throw new Error(`presentationNonce: the VTC's credential query did not answer a thread and a nonce (HTTP ${String(r.transport.status)}): ${(r.replies[0] ?? "").slice(0, 300)}`);
    }
    return { documents: [JSON.stringify({ nonce: query.nonce, threadId: payload.threadId })] };
  }

  /** Ceremony track: set up the relationship with a peer (a participant of the scenario). Nothing to set up: the community door is unauthenticated and the holder's document proof says who it is. */
  async connect(): Promise<{ connected: boolean }> {
    return { connected: true };
  }

  /**
   * Ceremony track, FC-KVX: the community's administrator asks for a credential query for the holder `p.to` (the community's own `vtc/join-requests/query/0.1`, as `presentationNonce`
   * does for a harness actor) and the query the VTC signed and handed to its push engine is returned unsent, for the runner to relay to the holder. The administrator is the adapter's
   * own identity (a harness stand-in, class D: who asks for a query is a community decision); the document is the VTC's.
   */
  async initiate(p: { kind: string; to: string }): Promise<{ threadId: string; documents: string[]; sent: boolean }> {
    if (p.kind !== "cex-query" || this.cfg.controlUrl === undefined) throw unsupported(`initiate ${p.kind}`);
    await this.loadIdentity();
    const admin = ed25519Signer(seedOf(ADMIN_SEED));
    await this.seedCtl({ did: admin.did, role: "admin" });
    // the holder's DID document goes into the VTC's resolver cache (the host does this for a seeded actor), so the community can address its push
    await this.seedCtl({ did: p.to, role: "member" });
    const now = Date.now();
    const doc = signDocument({ id: `urn:uuid:${randomUUID()}`, type: JOIN_QUERY_TYPE, issuer: admin.did, recipient: this.serviceDid!, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload: { holderDid: p.to, criterionId: MEMBERSHIP_CRITERION } }, admin, { created: now });
    const r = await this.post(JSON.stringify(doc));
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const payload = body !== undefined && isObject(body.payload) ? body.payload : undefined;
    if (r.transport.status !== 200 || payload === undefined || typeof payload.threadId !== "string") throw new Error(`cex-query: the VTC did not raise a credential query (HTTP ${String(r.transport.status)}): ${(r.replies[0] ?? "").slice(0, 300)}`);
    const thread = payload.threadId;
    const pushed = await this.pushes();
    const row = (Array.isArray(pushed.pushes) ? pushed.pushes : []).find((x) => isObject(x) && isObject(x.document) && x.document.id === thread && x.recipient === p.to);
    if (row === undefined || !isObject(row)) throw new Error("cex-query: the VTC raised the query but its push engine holds no document for the holder");
    this.kvxThreads.add(thread);
    // mark it seen so a later relayPushed of the VTC's pushes does not hand it out a second time
    if (typeof row.id === "string") this.pushSeen.add(row.id);
    return { threadId: thread, documents: [JSON.stringify(row.document)], sent: false };
  }

  /** Ceremony track: what the community's administrator did through the door (the decisions and grants the scenario asked for), with the code each was answered. */
  private adminLog: { action: string; code: string }[] = [];
  /** One signed task to the community's door as `who` (default the seeded administrator): the answer's code (`ok` for a response) and payload. */
  private async doorCall(type: string, payload: Record<string, unknown>, who?: Ed25519Signer, stepUp = false): Promise<{ code: string; payload: Record<string, unknown> }> {
    await this.loadIdentity();
    const signer = who ?? ed25519Signer(seedOf(ADMIN_SEED));
    if (who === undefined) await this.seedCtl({ did: signer.did, role: "admin" });
    // the administrator's second-factor gesture for exactly this operation (class D: the host records it; see /ctl/stepup)
    if (stepUp) await this.ctl("stepup", { did: signer.did, type, payload });
    const now = Date.now();
    const doc = signDocument({ id: `urn:uuid:${randomUUID()}`, type, issuer: signer.did, recipient: this.serviceDid!, issuedAt: new Date(Math.floor(now / 1000) * 1000).toISOString().replace(".000Z", "Z"), payload }, signer, { created: now });
    const r = await this.post(JSON.stringify(doc));
    const body = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const p = body !== undefined && isObject(body.payload) ? body.payload : {};
    const trace = process.env.VTI_TRACE;
    if (trace !== undefined && trace !== "") appendFileSync(trace, `${JSON.stringify({ from: "community-console", type, status: r.transport.status, reply: r.replies[0] ?? null })}\n`);
    return { code: typeof body?.type === "string" && body.type.endsWith("#response") ? "ok" : typeof p.code === "string" ? p.code : `HTTP ${r.transport.status}`, payload: p };
  }
  /** The community's join requests by status (`list` 0.2 answers the pending ones unless a status is named): one status, or every status. */
  private async joinRequests(status?: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const st of status === undefined ? ["pending", "approved", "rejected", "withdrawn", "deferred"] : [status]) {
      const r = await this.doorCall(`${TT}vtc/join-requests/list/0.2`, { status: st });
      if (Array.isArray(r.payload.items)) out.push(...(r.payload.items as Record<string, unknown>[]));
    }
    return out;
  }
  private async ceremonyTrigger(action: string, args: Record<string, unknown>): Promise<{ documents: string[] }> {
    if (action === "knowApplicant") {
      // the wallet that is about to apply is not a member: its DID document is cached (a TrustTaskHTTPS service) so the community can plan its pushes (class D: no mediator)
      await this.ctl("resolve", { did: String(args.vid) });
      return { documents: [] };
    }
    if (action === "decide") {
      // The community's administrator (or, with `as: member`, a member with no administrative authority) decides a join request. `request`: `latest` (the newest the community holds), or `unknown` (an id it never minted).
      const asMember = args.as === "member";
      const who = asMember ? ed25519Signer(seedOf(0x47)) : undefined;
      if (who !== undefined) await this.seedCtl({ did: who.did, role: "member" });
      const items = await this.joinRequests();
      const latest = [...items].sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
      const id = args.request === "unknown" ? "00000000-0000-4000-8000-0000000000aa" : String(latest?.id ?? "00000000-0000-4000-8000-0000000000bb");
      const r = await this.doorCall(`${TT}vtc/join-requests/decide/0.1`, { id, decision: String(args.decision), ...(args.reason === undefined ? {} : { reason: String(args.reason) }) }, who);
      this.adminLog.push({ action: "decide", code: r.code });
      return { documents: [] };
    }
    if (action === "solicit") {
      // The administrator asks the community to request a reciprocal credential from an active member (vtc/members/solicit-vmc/0.1): the community then asks the member (request-vmc, pushed).
      const r = await this.doorCall(`${TT}vtc/members/solicit-vmc/0.1`, { memberDid: String(args.member), ...(args.reason === undefined ? {} : { reason: String(args.reason) }) });
      this.adminLog.push({ action: "solicit", code: r.code });
      return { documents: [] };
    }
    if (action === "grantVetter") {
      const r = await this.doorCall(`${TT}vtc/vetting/vetters/grant/0.1`, { memberDid: String(args.vid) });
      this.adminLog.push({ action: "grantVetter", code: r.code });
      return { documents: [] };
    }
    if (action === "dirMember") return this.dirMember(args);
    if (action === "waitPast") { await new Promise((ok) => setTimeout(ok, Number(args.ms ?? 3500))); return { documents: [] }; }
    if (action === "offerRoom") {
      // Rooms ceremony (docs/32): the community's administrator creates an open room and offers it to the member, through the door as an administrator does (class D: the community's VTA is the host's stand-in, `VTC_HOST_ROOMS`).
      const made = await this.doorCall(`${TT}vtc/rooms/community/create/0.4`, { label: "Ceremony room", visibility: "open", reason: "ceremony" }, undefined, true);
      this.adminLog.push({ action: "roomCreate", code: made.code });
      const room = isObject(made.payload.room) ? made.payload.room : {};
      const roomId = String((isObject(room.room) ? room.room.roomId : room.roomId) ?? "");
      const until = new Date(Date.now() + (args.expired === true ? 2500 : 30 * 86400000)).toISOString().replace(/\.\d+Z$/, "Z");
      const added = await this.doorCall(`${TT}vtc/rooms/community/members/add/0.2`, { roomId, member: String(args.vid), actions: ["read", "write"], validUntil: until, reason: "ceremony" }, undefined, true);
      this.adminLog.push({ action: "roomOffer", code: added.code });
      return { documents: [] };
    }
    throw unsupported(`trigger ${action}`);
  }
  /** Directory ceremony (docs/31): what the community's second member did through the door (class D stand-in), by the answer's code or by what the reading showed. */
  private dirLog: { kind: string; code: string; inList?: boolean; fields?: string[] }[] = [];
  /** The stand-in second member and the administrator, as the community's records hold them; `target` is the DID whose card is read. */
  private async dirMember(args: Record<string, unknown>): Promise<{ documents: string[] }> {
    const b = ed25519Signer(seedOf(0x61));
    await this.seedCtl({ did: b.did, role: "member", label: "Ceremony reader" });
    const op = String(args.op);
    if (op === "update") {
      const r = await this.doorCall(`${TT}vtc/directory/card/update/0.1`, { values: (args.values as Record<string, unknown> | undefined) ?? {}, visibility: (args.visibility as Record<string, unknown> | undefined) ?? {}, ...(args.listing === undefined ? {} : { discoverability: { listing: String(args.listing), search: "byName", external: false } }) }, b);
      this.dirLog.push({ kind: "update", code: r.code });
    } else if (op === "view" || op === "query") {
      const target = String(args.target);
      if (op === "query") {
        const q = await this.doorCall(`${TT}vtc/directory/query/0.1`, { subject: target, ...(args.fields === undefined ? {} : { fields: String(args.fields) }) }, b);
        this.dirLog.push({ kind: "query", code: q.code, fields: q.code === "ok" && isObject(q.payload.fields) ? Object.keys(q.payload.fields) : [] });
      } else {
        // the community's administrator names the entry (entries/show by DID is administrators only), then the member browses and opens it
        const a = await this.doorCall(`${TT}vtc/directory/entries/show/0.1`, { did: target });
        const entry = isObject(a.payload.entry) ? a.payload.entry : undefined;
        const eid = typeof entry?.entryId === "string" ? entry.entryId : undefined;
        const l = await this.doorCall(`${TT}vtc/directory/entries/list/0.2`, { limit: 100 }, b);
        const inList = eid !== undefined && Array.isArray(l.payload.items) && (l.payload.items as Record<string, unknown>[]).some((e) => e.entryId === eid);
        if (eid === undefined) this.dirLog.push({ kind: "show", code: "noCard", inList });
        else {
          const sh = await this.doorCall(`${TT}vtc/directory/entries/show/0.1`, { entryId: eid }, b);
          this.dirLog.push({ kind: "show", code: sh.code, inList, fields: sh.code === "ok" && isObject(sh.payload.entry) && isObject(sh.payload.entry.fields) ? Object.keys(sh.payload.entry.fields) : [] });
        }
      }
    } else throw unsupported(`dirMember ${op}`);
    return { documents: [] };
  }
  private async dirStored(kind: string): Promise<ObserveResult> {
    const last = this.dirLog.filter((x) => x.kind !== "update").at(-1);
    if (kind.startsWith("dir-admin-has:")) {
      // dir-admin-has:<field>:<did>
      const rest = kind.slice(14), at = rest.indexOf(":"), field = rest.slice(0, at), did = rest.slice(at + 1);
      const a = await this.doorCall(`${TT}vtc/directory/entries/show/0.1`, { did });
      return { value: isObject(a.payload.entry) && isObject(a.payload.entry.fields) && Object.keys(a.payload.entry.fields).includes(field) ? 1 : 0 };
    }
    if (kind === "dir-b:inList") return { value: last?.inList === true ? 1 : 0 };
    if (kind.startsWith("dir-b:field:")) return { value: last?.fields?.includes(kind.slice(12)) ? 1 : 0 };
    if (kind.startsWith("dir-b:code:")) return { value: last?.code === kind.slice(11) ? 1 : 0 };
    if (kind.startsWith("dir-b:update:")) return { value: this.dirLog.filter((x) => x.kind === "update" && x.code === kind.slice(13)).length };
    throw unsupported(`observe stored ${kind}`);
  }
  /** `stored` kinds of the ceremony track: join requests by status, a DID as a member, the push records by task type, the administrator's answers by code. */
  private async ceremonyStored(kind: string): Promise<ObserveResult> {
    if (kind.startsWith("dir-")) return this.dirStored(kind);
    if (kind.startsWith("rooms-")) {
      const n = Number(kind.slice(kind.indexOf(":") + 1));
      if (kind.startsWith("rooms-records:")) return { value: Number((await this.ctl("observe", { kind: "roomRecords" })).value) === n ? 1 : 0 };
      return { value: (kind.startsWith("rooms-writes:") ? this.roomsWrites : this.roomsUploads) === n ? 1 : 0 };
    }
    if (kind === "join-request") return { value: (await this.joinRequests()).length - Object.values(this.liveBase ?? {}).reduce((a, b) => a + b, 0) };
    if (kind.startsWith("join-request:")) return { value: (await this.joinRequests(kind.slice(13))).length - (this.liveBase?.[kind.slice(13)] ?? 0) };
    if (kind.startsWith("member:")) {
      const r = await this.doorCall(`${TT}vtc/members/list/0.2`, {});
      return { value: (Array.isArray(r.payload.items) ? (r.payload.items as Record<string, unknown>[]) : []).filter((m) => m.did === kind.slice(7)).length };
    }
    if (kind === "vmc") {
      // The member-issued acknowledgements the community holds (vtc/members/credentials/0.1, read by the administrator, one member at a time).
      const list = await this.doorCall(`${TT}vtc/members/list/0.2`, {});
      let n = 0;
      for (const m of Array.isArray(list.payload.items) ? (list.payload.items as Record<string, unknown>[]) : []) {
        if (typeof m.did !== "string") continue;
        const c = await this.doorCall(`${TT}vtc/members/credentials/0.1`, { did: m.did });
        if (c.code === "ok" && isObject(c.payload.memberVmc)) n++;
      }
      return { value: n };
    }
    if (kind.startsWith("admin:")) return { value: this.adminLog.filter((x) => `${x.action}:${x.code}` === kind.slice(6)).length };
    if (kind.startsWith("pushed:")) {
      const r = await this.pushes();
      return { value: (Array.isArray(r.pushes) ? r.pushes : []).filter((x) => isObject(x) && isObject(x.document) && String(x.document.type).includes(kind.slice(7)) && !this.pushBaseline.has(String(x.id))).length };
    }
    if (kind.startsWith("vetter:")) {
      const r = await this.doorCall(`${TT}vtc/vetting/vetters/list/0.1`, {});
      return { value: (Array.isArray(r.payload.vetters) ? (r.payload.vetters as Record<string, unknown>[]) : []).filter((v) => v.did === kind.slice(7) || v.vetterDid === kind.slice(7)).length };
    }
    throw unsupported(`observe stored ${kind}`);
  }

  async observe(query: ObserveQuery): Promise<ObserveResult> {
    switch (query.query) {
      case "received": {
        const docs = this.kvxInbox.filter((e) => (query.from === undefined || e.from === query.from) && (query.type === undefined || e.type === query.type) && (query.threadId === undefined || e.threadId === query.threadId)).map((e) => e.text);
        return { value: docs.length, documents: docs };
      }
      case "ceremony":
        return { value: this.kvxVerdict.get(String(query.threadId)) ?? (this.kvxThreads.has(String(query.threadId)) ? "open" : "unknown") };
      case "handled":
        return { value: this.succeeded.size };
      case "documentState":
        return { value: this.states.get(query.id) ?? "unknown" };
      case "pushed": {
        if (this.cfg.controlUrl === undefined) throw unsupported("observe pushed (no host: the live service's push records are not reachable)");
        const r = await this.pushes();
        for (const row of Array.isArray(r.pushes) ? r.pushes : []) {
          if (!isObject(row) || typeof row.id !== "string" || this.pushBaseline.has(row.id) || this.pushSeen.has(row.id)) continue;
          this.pushSeen.add(row.id);
          this.outbox.record(JSON.stringify(row.document), typeof row.recipient === "string" ? row.recipient : undefined);
        }
        return this.outbox.observe(query);
      }
      case "stored":
        // VTI hosts no VRC or witness presentation, so none is ever stored.
        if (query.kind === "vrc" || query.kind === "vwc" || query.kind === "vp") return { value: 0 };
        // With the host: a presentation the VTC accepted leaves the join request it decided (the durable record of its effect).
        if (query.kind === "presentation" && this.cfg.controlUrl !== undefined) return { value: Number((await this.ctl("observe", { kind: "joinRequests" })).value) - this.joinBaseline };
        if (this.cfg.ceremony === true && this.cfg.controlUrl !== undefined) return this.ceremonyStored(query.kind);
        throw unsupported(`observe stored ${query.kind}`);
      default:
        throw unsupported(`observe ${query.query}`);
    }
  }

  async reset(): Promise<void> {
    this.kvxInbox.length = 0;
    this.kvxVerdict.clear();
    this.kvxThreads.clear();
    this.succeeded = new Set();
    this.states = new Map();
    if (this.cfg.ceremony === true && this.cfg.controlUrl !== undefined) {
      this.adminLog = [];
      this.dirLog = [];
      this.roomsWrites = 0;
      this.roomsUploads = 0;
      this.roomsCounted.clear();
      await this.ctl("reset");
      this.didDocument = undefined;
    }
    if (this.cfg.controlUrl !== undefined) {
      await this.loadIdentity();
      if (this.live) {
        this.liveBase = {};
        for (const st of ["pending", "approved", "rejected", "withdrawn", "deferred"]) this.liveBase[st] = (await this.joinRequests(st)).length;
      }
      this.joinBaseline = Number((await this.ctl("observe", { kind: "joinRequests" })).value);
      this.outbox.clear();
      this.pushSeen.clear();
      const r = await this.pushes(true);
      this.pushBaseline = new Set((Array.isArray(r.pushes) ? r.pushes : []).flatMap((x) => (isObject(x) && typeof x.id === "string" ? [x.id] : [])));
    }
  }

  async restart(): Promise<void> {
    if (this.cfg.composeDir === undefined) throw unsupported("restart (no compose directory configured)");
    await this.run("docker", ["compose", "--profile", this.cfg.composeProfile, "restart", this.cfg.composeService], this.cfg.composeDir);
    const deadline = Date.now() + this.cfg.restartWaitSeconds * 1000;
    for (;;) {
      try {
        const r = await fetch(`${this.cfg.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`the VTC did not answer /health within ${this.cfg.restartWaitSeconds} s of the restart`);
      await this.sleep(1000);
    }
  }

  /** Rooms ceremony (docs/32): the writes and the uploads the host answered, read from the door (the host keeps records, not a count of writes). */
  private roomsWrites = 0;
  private roomsUploads = 0;
  private roomsCounted = new Set<string>();
  async send(params: SendParams): Promise<SendResult> {
    const r = await this.post(params.bytes, params.http);
    this.track(params.bytes, r);
    this.noteKvx(params, r);
    if (this.cfg.ceremony === true) {
      try {
        const q = JSON.parse(params.bytes) as { type?: string }, a = JSON.parse(r.replies[0] ?? "{}") as { type?: string };
        if (String(a.type).endsWith("#response") && !this.roomsCounted.has(String((a as { id?: string }).id))) {
          // A document delivered again is answered with the same reply (the same id): one write, not two.
          this.roomsCounted.add(String((a as { id?: string }).id));
          if (String(q.type).includes("/rooms/records/put/")) this.roomsWrites++; else if (String(q.type).includes("/rooms/blobs/upload/begin/")) this.roomsUploads++;
        }
      } catch { /* not a document */ }
    }
    const trace = process.env.VTI_TRACE;
    if (trace !== undefined && trace !== "") appendFileSync(trace, `${JSON.stringify({ from: params.from, request: params.bytes, status: r.transport.status, reply: r.replies[0] ?? null })}\n`);
    return r;
  }

  /** Ceremony track: a presentation that reached the community, and its answer (an acknowledgement without a document is acceptance, an error document is a refusal). */
  private noteKvx(params: SendParams, r: SendResult): void {
    const doc = parseJson(params.bytes);
    if (doc === undefined || this.cfg.controlUrl === undefined) return;
    const thread = typeof doc.threadId === "string" ? doc.threadId : String(doc.id);
    this.kvxInbox.push({ from: params.from.kind === "none" ? "" : params.from.vid, type: String(doc.type), threadId: thread, text: params.bytes });
    if (doc.type !== PRESENT_TYPE) return;
    const rep = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const refused = String(rep?.type ?? "").includes("/trust-task-error/") || r.transport.kind === "refused";
    this.kvxVerdict.set(thread, refused ? "refused" : r.transport.status === 202 || r.transport.status === 204 || r.transport.status === 200 ? "completed" : "refused");
    if (rep !== undefined) this.kvxInbox.push({ from: this.serviceDid ?? "", type: String(rep.type), threadId: thread, text: r.replies[0]! });
  }

  /** Update `handled` and `documentState` from what VTI answered. */
  private track(bytes: string, r: SendResult): void {
    const req = parseJson(bytes);
    const id = typeof req?.id === "string" ? req.id : undefined;
    if (id === undefined) return;
    // A presentation is acknowledged without a document (HTTP 202/204): the VTC took it for processing, which is its claim of execution.
    if (r.transport.kind === "none" && req?.type === PRESENT_TYPE && (r.transport.status === 202 || r.transport.status === 204)) {
      this.succeeded.add(id);
      this.states.set(id, "responded");
      return;
    }
    if (r.transport.kind !== "document") return;
    const rep = r.replies[0] === undefined ? undefined : parseJson(r.replies[0]);
    const type = typeof rep?.type === "string" ? rep.type : "";
    if (type.startsWith("https://trusttasks.org/spec/trust-task-error/")) {
      if (!this.succeeded.has(id)) this.states.set(id, "errored");
      return;
    }
    if (r.transport.status === 200 && req?.type === NOTIFY_TYPE && type === `${NOTIFY_TYPE}#response`) {
      this.succeeded.add(id);
      this.states.set(id, "responded");
    }
  }

  /** One HTTP exchange with the door; a 429 (anonymous budget, a documented limit) is waited out and the same bytes resent, up to a bound. */
  private async post(bytes: string, line: SendParams["http"] = {}): Promise<SendResult> {
    const method = line.method ?? "POST";
    const path = line.path === undefined || line.path === "/trust-tasks" ? "/trust-tasks" : line.path;
    const headers: Record<string, string> = { "content-type": line.contentType ?? "application/json" };
    // Ceremony track: `auth/oob/request` is accepted only from the portal's own page (T19), which a browser shows as its Origin; the starter role stands in for that browser (class D: the header).
    if (this.cfg.ceremony === true && bytes.includes("/auth/oob/request/")) headers.origin = this.portalOrigin();
    let waited = 0;
    for (;;) {
      const pace = this.cfg.paceMs ?? 0;
      if (pace > 0) {
        const due = this.lastSendAt + pace - Date.now();
        if (due > 0) await this.sleep(due);
        this.lastSendAt = Date.now();
      }
      const t0 = Date.now();
      const trace = process.env.VTI_TRACE;
      if (trace !== undefined && trace !== "") appendFileSync(trace, `${new Date().toISOString()} > ${method} ${path} ${bytes.slice(0, 160).replace(/\s+/g, " ")}\n`);
      let res: Response;
      let body: string;
      try {
        res = await fetch(this.door(path), { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: bytes }), signal: AbortSignal.timeout(60_000) });
        body = await res.text();
      } catch (err) {
        if (trace !== undefined && trace !== "") appendFileSync(trace, `${new Date().toISOString()} ! ${Date.now() - t0}ms ${(err as Error).message}\n`);
        throw err;
      }
      if (trace !== undefined && trace !== "") appendFileSync(trace, `${new Date().toISOString()} < ${res.status} ${Date.now() - t0}ms retry-after=${res.headers.get("retry-after") ?? "-"}\n`);
      if (res.status === 429) {
        const wait = Math.max(1000, Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-after") ?? "5") * 1000);
        if (waited + wait <= this.cfg.maxRateLimitWaitMs) {
          waited += wait;
          await this.sleep(wait);
          continue;
        }
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
}

export function createAdapter(): VtiAdapter {
  return new VtiAdapter({ config: configFromEnv(process.env) });
}

/** Configuration from the environment: VTI_BASE_URL, VTI_API_PREFIX, VTI_SERVICE_DID, VTI_VERSION, VTI_COMPOSE_DIR, VTI_COMPOSE_SERVICE, VTI_COMPOSE_PROFILE, VTI_CONTROL_URL (the in-process VTC host), VTI_PUBLIC_URL (the community's public URL, for the sign-in's Origin). */
export function configFromEnv(env: Record<string, string | undefined>): Partial<VtiConfig> {
  const c: Partial<VtiConfig> = {};
  if (env.VTI_CONTROL_URL) c.controlUrl = env.VTI_CONTROL_URL;
  if (env.VTI_ACTOR_ROLE) c.actorRole = env.VTI_ACTOR_ROLE;
  if (env.VTI_VTC_SEED_DEFAULTS === "1") c.seedDefaults = true;
  if (env.VTI_PUBLIC_URL) c.publicUrl = env.VTI_PUBLIC_URL;
  if (env.VTI_BASE_URL) c.baseUrl = env.VTI_BASE_URL;
  if (env.VTI_API_PREFIX !== undefined) c.apiPrefix = env.VTI_API_PREFIX;
  if (env.VTI_SERVICE_DID) c.serviceDid = env.VTI_SERVICE_DID;
  if (env.VTI_VERSION) c.version = env.VTI_VERSION;
  if (env.VTI_COMPOSE_DIR) c.composeDir = env.VTI_COMPOSE_DIR;
  if (env.VTI_COMPOSE_SERVICE) c.composeService = env.VTI_COMPOSE_SERVICE;
  if (env.VTI_COMPOSE_PROFILE) c.composeProfile = env.VTI_COMPOSE_PROFILE;
  if (env.VTI_PACE_MS !== undefined && Number.isFinite(Number(env.VTI_PACE_MS)) && Number(env.VTI_PACE_MS) >= 0) c.paceMs = Number(env.VTI_PACE_MS);
  return c;
}
