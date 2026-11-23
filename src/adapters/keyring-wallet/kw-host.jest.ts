// SPDX-License-Identifier: Apache-2.0
/**
 * @jest-environment node
 *
 * keyring-wallet adapter host. This file is a jest "test" only because keyring-wallet's trust-task code is TypeScript with React
 * Native and Credo imports that run only under its own jest/babel setup (this is the "jest-hosted real code" of decision 42). It
 * starts an HTTP JSON-RPC server (the suite's adapter contract, docs/04 section 4) inside that jest process and serves it until the
 * launcher (launcher.ts) asks it to stop. Do not run it directly; run the launcher.
 *
 * What is the wallet's own, original code: the trust-task registry (registry.ts), the consume pipeline and its checks
 * (services/TrustTasksService.ts: schema validation, recipient and identity checks, proof policy, KEYRING_CONSUME_CHECKS), the
 * inbound dispatch and handlers (ceremony.ts), the document-proof verifier (documentProof.ts), the DIDComm v1 carriage
 * (module/DidCommV1Carriage.ts) and its message class. What is the shim: the in-memory DidCommMessageSender and
 * DidCommMessageHandlerRegistry the carriage sits on (nothing is packed, routed or delivered), the in-memory storage service, the
 * connection records, and the conformance carrier task registered into the wallet's open registry. For credential-exchange query
 * (handled by the wallet's own `handleInboundCredentialExchangeQuery`, `matchDcqlQuery` and `respondToCredentialExchangeQuery`, with
 * Credo's own DcqlService and W3cCredentialRepository) the shim also supplies the held credential records (their `expandedTypes`
 * tag set by the shim), the presentation signature (eddsa-jcs-2022 in place of Credo's JSON-LD signing) and a KMS holding only the
 * IUT's connection-DID key. KW_QUERY=off serves no query.
 *
 * @ts-nocheck is deliberate: the wallet's modules are loaded by absolute path at run time and are not part of this repository's
 * type graph.
 */
// @ts-nocheck
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dispatch } from "../../adapter/contract.ts";
import { PushedBox } from "../../adapter/pushed.ts";
import { MAX_BODY_BYTES } from "../../adapter/server.ts";
import { dirStoredKind } from "../reference/dir-state.ts";
import { voteStoredKind } from "../reference/vote-state.ts";
import { ballotStoredKind } from "../reference/ballot-state.ts";
import { personaStoredKind } from "../reference/persona-state.ts";
import { roomsStoredKind } from "../reference/rooms-state.ts";
import { didKeyFromEd25519, ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { signDocument } from "../../crypto/proof.ts";
import { heldCredential } from "./held-credential.ts";
import { isTamperMode, tamperDecision } from "../../ceremony/tamper.ts";
import { CARRIER_TYPE, ISSUE_TYPE, PROPOSE_TYPE, QUERY_TYPE, WITNESS_SHARE_TYPE, ConnectionTable, DocStates, Outbox, answers, capabilities, identitySeed, iutIdentity, provisionRoles, stateFromReply } from "./shim.ts";

const KW_ROOT = process.env.KW_ROOT ?? "../keyring-wallet";
const CORE = `${KW_ROOT}/bifold/packages/core`;
const TT = `${CORE}/src/modules/trust-tasks`;
const PORT_FILE = process.env.KW_HOST_PORT_FILE;
/**
 * KW_REAL_AGENT=<module>: keyring-wallet-didcomm mode (src/adapters/keyring-wallet-didcomm). The agent is a REAL Credo agent behind a real
 * DIDComm endpoint (the module builds it); this host then serves only the out-of-band control plane (triggers, observes, clock, reset)
 * against it, with the same code the shim adapter uses. `send` is not used: the data path is DIDComm.
 */
const REAL = process.env.KW_REAL_AGENT ? require(process.env.KW_REAL_AGENT) : undefined;

// The module classes must be the copies the wallet's own files resolve (core's nested @credo-ts), or the DI tokens differ.
const credoCore = require(require.resolve("@credo-ts/core", { paths: [CORE] }));
const credoDidcomm = require(require.resolve("@credo-ts/didcomm", { paths: [CORE] }));
const { InjectionSymbols, EventEmitter, DidKey, utils, DcqlService, W3cCredentialRepository, W3cCredentialRecord, MdocApi, SdJwtVcApi, Kms, TypedArrayEncoder } = credoCore;
const { DidCommMessageSender, DidCommMessageHandlerRegistry } = credoDidcomm;
// The document-proof code lives in the wallet's @bifold/trust-tasks package, which resolves its own @credo-ts/core copy: its KMS token is that copy's class.
const credoCoreOfProofs = require(require.resolve("@credo-ts/core", { paths: [`${KW_ROOT}/bifold/packages/trust-tasks`] }));

const ceremony = require(`${TT}/ceremony`);
const { trustTaskRegistry } = require(`${TT}/registry`);
const tts = require(`${TT}/services/TrustTasksService`);
const { respondWith, TrustTasksService } = tts;
const { getOrCreateRelationshipDid } = require(`${CORE}/src/modules/vrc/vrc-manager`);
const { vrcFlowStore } = require(`${CORE}/src/modules/vrc/witnessStatusStore`);
const { TrustTaskMessage } = require(`${TT}/messages/TrustTaskMessage`);
const { credentialExchangeStore } = require(`${TT}/credentialExchangeStore`);
const { verifyDocumentProof, digestMultibase } = require(`${TT}/documentProof`);
const { verifyDocumentProof: suiteVerifyProof } = require("../../crypto/proof.ts");
const { JsonTransformer } = credoCore;
const { RelationshipDidRepository } = require(`${CORE}/src/modules/vrc/repositories/RelationshipDidRepository`);

jest.setTimeout(6 * 60 * 60 * 1000);

// Wallet task types this adapter drives for real (none yet: only the carrier). A type is declared only when a vector can reach it.
const WSH_STANDIN = process.env.KW_WSH !== "off";
/** KW_QUERY=off: serve no credential-exchange query (the earlier reach). Default: the wallet's own `handleInboundCredentialExchangeQuery`. */
const QUERY_SERVED = process.env.KW_QUERY !== "off";
const SERVED_WALLET_TYPES: string[] = [PROPOSE_TYPE, ISSUE_TYPE, ...(WSH_STANDIN ? [WITNESS_SHARE_TYPE] : []), ...(QUERY_SERVED ? [QUERY_TYPE] : [])];
/** KW_CARRIER_PROOF=verify: the carrier installs the wallet's own verifier as the issue handler does, passing the proof's own purpose (the wallet's default purpose, assertionMethod, would refuse the authentication proofs the suite signs with); default: the module default (acceptUnverified). */
const CARRIER_PROOF = process.env.KW_CARRIER_PROOF === "verify" ? "verify" : "default";
/** The shim's clock: jest fake timers fake Date only (as the wallet's pinClock helper), so every Date.now()/new Date() in the wallet reads it. */
const FAKE_CLOCK = process.env.KW_CLOCK !== "rebase";
let clockFaked = false;
function setFakeClock(ms: number): void {
  if (!FAKE_CLOCK) throw new Error("the clock is not settable (KW_CLOCK=rebase)");
  if (!clockFaked) {
    jest.useFakeTimers({ now: ms, doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "nextTick", "queueMicrotask", "hrtime", "performance"] });
    clockFaked = true;
  } else jest.setSystemTime(ms);
}
const idn = iutIdentity();
const outbox = new Outbox();
const conns = new ConnectionTable(idn.vid);
let storage: unknown[] = [];
let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
/** Documents the wallet's real pipeline accepted and handled (counted around the wallet's own `consume`, which still runs). */
let handled = 0;
let credentials: unknown[] = [];
/** Credentials the holder helper `holdCredential` put in the wallet's credential store (kept apart from the VRCs the issue handler stores, which `observe stored vrc` counts). */
let held: unknown[] = [];
/** Query ids the wallet has put in front of its user (its `credentialExchangeStore` prompts), and the thread each query came in on. */
const deferrals = new Set<string>();
const queryThreads = new Map<string, string>();
let listening = false;
function listenForPrompts(): void {
  if (listening) return;
  listening = true;
  credentialExchangeStore.on("queryPrompt", (p: { queryId: string }) => deferrals.add(p.queryId));
  credentialExchangeStore.on("queryPromptCleared", (p: { queryId: string }) => deferrals.delete(p.queryId));
}
let policy = { propose: "hold" as "hold" | "accept" | "decline", witnessed: false };
const states = new DocStates();
const snapshots = new Map<string, string>();
/** Documents the wallet sent that answer nothing the harness sent (its own discovery query, its own VRC delivery): not replies. */
const unsolicited: Record<string, unknown>[] = [];
/**
 * observe.pushed: every document the wallet handed to its carrier that is not the reply to what the harness just sent (stragglers from
 * an earlier step and the answers of a trigger included). Everything the wallet sends goes through the one sender the shim installs
 * (the outbox), and nothing leaves the outbox without passing `keep` or `reply`, so the record is complete.
 */
const pushedBox = new PushedBox();
function peerOf(connectionId: string | undefined): string | undefined {
  try {
    return connectionId === undefined || connectionId === "" ? undefined : conns.get(connectionId).theirDid;
  } catch {
    return undefined;
  }
}
function keep(s: { connectionId?: string; document: Record<string, unknown> }): void {
  states.note(s.document);
  unsolicited.push(s.document);
  // `to`: the document's own recipient, else the peer of the connection it was sent on (the wallet's documents do not always name one).
  pushedBox.record(JSON.stringify(s.document), typeof s.document.recipient === "string" ? s.document.recipient : peerOf(s.connectionId));
}

function digestBytesEqualSafe(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  try {
    return require(`${TT}/documentProof`).digestBytesEqual(a, b);
  } catch {
    return a === b;
  }
}

function git(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** A did:key (or the did:peer:0 the shim mints from one) resolves from the identifier alone, through Credo's own resolver code. */
async function resolveDidDocument(did: string): Promise<unknown> {
  if (did.startsWith("did:webvh:")) return resolveWebvh(did);
  const asKey = did.startsWith("did:peer:0z") ? `did:key:${did.slice("did:peer:0".length)}` : did;
  if (!asKey.startsWith("did:key:")) throw new Error(`the shim resolves only did:key and did:peer:0 (${did})`);
  const doc = DidKey.fromDid(asKey).didDocument;
  return did === asKey ? doc : JSON.parse(JSON.stringify(doc).split(asKey).join(did));
}

/**
 * Class D stand-in for the live rows (a community container publishes a did:webvh): the document is the last state of the log the service serves
 * at its did:webvh address (http for a localhost address, https otherwise). The log's hash chain and proofs are NOT verified here: the shim is the
 * resolver, and the live row measures the wallet's use of the document, not a did:webvh resolver.
 */
async function resolveWebvh(did: string): Promise<unknown> {
  const parts = did.split(":").slice(3);
  if (parts.length === 0) throw new Error(`not a did:webvh address (${did})`);
  const host = decodeURIComponent(parts[0]!);
  const path = parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join("/") + "/did.jsonl" : ".well-known/did.jsonl";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const res = await fetch(`${local ? "http" : "https"}://${host}/${path}`);
  if (!res.ok) throw new Error(`did:webvh log of ${did}: HTTP ${res.status}`);
  const last = (await res.text()).split("\n").filter((l) => l.trim() !== "").pop();
  const state = last === undefined ? undefined : JSON.parse(last).state;
  if (state === undefined || state.id !== did) throw new Error(`did:webvh log of ${did} does not state that DID`);
  // The wallet reads a community's join manifest over the community's REST service when its document lists one (its own fast path), which takes the read off the carrier
  // the scenario records and changes the number of documents the scenario sees. The rows record the carrier path, as the in-process rows do: the document the shim
  // hands the wallet does not list the REST service (class D, stated in docs/35); KW_LIVE_REST=on leaves it in.
  if (process.env.KW_LIVE_REST === "on" || !Array.isArray(state.service)) return state;
  return { ...state, service: state.service.filter((sv: { type?: unknown }) => sv.type !== "VTCRest") };
}

/** Connections whose relationship-DID record exists. The wallet creates it when a connection forms (the legacy RCE handshake), before any trust task arrives. */
const prepared = new Set<string>();
let minted = 0;
/** The relationship identifier the wallet's own `getOrCreateRelationshipDid` asks its KMS for: a fresh did:peer:0 (the KMS is the one stand-in here). */
async function createDid() {
  const did = `did:peer:0${didKeyFromEd25519(ed25519Signer(seedOf(0x70 + (((identitySeed() === 0x4b ? 0 : 64) + minted++) % 128))).publicKey).slice("did:key:".length)}`;
  return { didState: { state: "finished", did } };
}

/** The IUT's own key (its connection DID), the one key the shim's KMS stand-in holds (see makeAgent). */
const iutSigner = ed25519Signer(seedOf(identitySeed()));
// Class D stand-in keys the KMS also signs with: only the successor key of the emitted acl/swap-key (registered when that document is built).
const standInKeys = new Map<string, { sign: (b: Uint8Array) => Uint8Array }>();
/** The issuer of the credentials `holdCredential` gives the wallet (any did:key; the wallet does not check its credentials' issuers when matching). */
const heldIssuer = ed25519Signer(seedOf(0x5c));

/**
 * The record the wallet's credential store would hold for a W3C JSON-LD credential of the given type IRI: a real Credo
 * W3cCredentialRecord, signed eddsa-jcs-2022 by a did:key issuer. Credo computes the `expandedTypes` tag by JSON-LD expansion when it
 * stores a credential (that needs a document loader the shim does not have), so the shim sets the tag to the expansion of the
 * credential's own types (the @vocab names the IRI's namespace); `matchDcqlQuery` and Credo's DcqlService read that tag.
 */
function heldRecord(typeIri: string) {
  const { vc } = heldCredential(typeIri, idn.vid, heldIssuer);
  return new W3cCredentialRecord({ credentialInstances: [{ credential: vc }], tags: { expandedTypes: ["https://www.w3.org/2018/credentials#VerifiableCredential", typeIri] } });
}

/** Credo's tag-query semantics over the shim's in-memory records: a scalar tag equals, an array tag contains every value, `$or` / `$and` combine. */
function tagMatch(tags: Record<string, unknown>, q: Record<string, unknown>): boolean {
  return Object.entries(q).every(([k, v]) => {
    if (k === "$or") return (v as Record<string, unknown>[]).some((s) => tagMatch(tags, s));
    if (k === "$and") return (v as Record<string, unknown>[]).every((s) => tagMatch(tags, s));
    if (k === "$not") return !tagMatch(tags, v as Record<string, unknown>);
    const t = tags[k];
    if (Array.isArray(v)) return Array.isArray(t) && v.every((x) => t.includes(x));
    return t === v;
  });
}

function makeAgent() {
  const registrations = new Map();
  const singletons = new Map();
  const container = {
    isRegistered: (t: unknown) => registrations.has(t) || singletons.has(t),
    register: (t: unknown, p: unknown) => registrations.set(t, p),
    resolve: (t: unknown) => {
      if (singletons.has(t)) return singletons.get(t);
      const r = registrations.get(t);
      if (r && "useFactory" in r) {
        const i = r.useFactory(container);
        singletons.set(t, i);
        return i;
      }
      throw new Error(`shim container cannot resolve ${String(t)}`);
    },
  };
  const matches = (r: any, kind: any, q: Record<string, unknown>) =>
    (!kind || r.constructor === kind) && Object.entries(q).every(([k, v]) => (r.getTags() ?? {})[k] === v);
  const storageService = {
    save: async (_c: unknown, record: unknown) => void storage.push(record),
    update: async () => undefined,
    delete: async (_c: unknown, record: unknown) => void (storage = storage.filter((r) => r !== record)),
    getAll: async (_c: unknown, kind: unknown) => storage.filter((r) => matches(r, kind, {})),
    findByQuery: async (_c: unknown, kind: unknown, q: Record<string, unknown>) => storage.filter((r) => matches(r, kind, q)),
  };
  singletons.set(InjectionSymbols.StorageService, storageService);
  const events = { emit: () => undefined };
  singletons.set(EventEmitter, events);
  // The shim carrier: what the wallet's DIDComm v1 carriage hands its message sender goes to the outbox, and the inbound message
  // handler the carriage registers is kept so documents can be delivered to it.
  singletons.set(DidCommMessageSender, {
    sendMessage: async (outbound: { message: { document: Record<string, unknown> }; connection?: { id: string } }) => {
      outbox.push(outbound.connection?.id ?? "", JSON.parse(JSON.stringify(outbound.message.document)));
    },
  });
  singletons.set(DidCommMessageHandlerRegistry, {
    registerMessageHandler: (h: { handle: (c: unknown) => Promise<unknown> }) => {
      handler = h.handle;
    },
  });
  // The wallet's own repository over the in-memory storage service.
  singletons.set(RelationshipDidRepository, new RelationshipDidRepository(storageService, events));
  // credential-exchange query: the wallet's `matchDcqlQuery` resolves Credo's own DcqlService, which reads Credo's own
  // W3cCredentialRepository (here over an in-memory storage service with Credo's tag-query rules, holding the `holdCredential`
  // records) and asks the mdoc and SD-JWT APIs for their records (the shim wallet holds none of those).
  const heldStorage = {
    findByQuery: async (_c: unknown, _kind: unknown, q: Record<string, unknown>) => held.filter((r: any) => tagMatch(r.getTags(), q)),
    getAll: async () => held,
  };
  singletons.set(W3cCredentialRepository, new W3cCredentialRepository(heldStorage, events));
  singletons.set(MdocApi, { findAllByQuery: async () => [], getAll: async () => [] });
  singletons.set(SdJwtVcApi, { findAllByQuery: async () => [], getAll: async () => [] });
  singletons.set(DcqlService, new DcqlService());
  // KMS stand-in: it holds the IUT's connection-DID key only, which is what the wallet signs a credential-exchange present under
  // (`signDocumentProof(agent, present, connection.did)`). Relationship-DID keys stay unavailable, as before this stand-in existed,
  // so the wallet's VRC delivery and witness-share sends fail at signing exactly as in the earlier runs.
  const iutKeyIds = new Set([TypedArrayEncoder.toBase58(iutSigner.publicKey), iutSigner.did.slice("did:key:".length)]);
  const kms = {
    sign: async (o: { keyId: string; data: Uint8Array }) => {
      const extra = standInKeys.get(o.keyId);
      if (extra !== undefined) return { signature: extra.sign(o.data) };
      if (!iutKeyIds.has(o.keyId)) throw new Error(`the shim KMS holds no key ${o.keyId}`);
      return { signature: iutSigner.sign(o.data) };
    },
  };
  singletons.set(Kms.KeyManagementApi, kms);
  singletons.set(credoCoreOfProofs.Kms.KeyManagementApi, kms);
  // DID resolution: a real Credo agent registers DidResolverService, which the wallet's own code resolves from the agent context
  // (a document-proof verifier resolves the issuer's DID document through it). Without it every signed document is refused for
  // its proof, valid or not, so proof vectors cannot tell the two apart. The resolver is the shim's did:key and did:peer:0
  // resolution (Credo's own DidKey code), the one `agent.dids.resolveDidDocument` already uses.
  const didResolver = {
    resolveDidDocument: async (_c: unknown, did: string) => resolveDidDocument(did),
    resolve: async (_c: unknown, did: string) => {
      try {
        return { didDocument: await resolveDidDocument(did), didDocumentMetadata: {}, didResolutionMetadata: {} };
      } catch (e) {
        return { didDocument: null, didDocumentMetadata: {}, didResolutionMetadata: { error: "notFound", message: String(e) } };
      }
    },
  };
  singletons.set(credoCore.DidResolverService, didResolver);
  singletons.set(credoCoreOfProofs.DidResolverService, didResolver);
  const logger = { info() {}, warn() {}, debug() {}, error() {}, trace() {} };
  const dependencyManager = { container, registerSingleton: () => undefined, resolve: (t: unknown) => container.resolve(t) };
  return {
    // Credo services take the agent context and resolve their collaborators from its dependency manager (DcqlService does).
    context: { dependencyManager, resolve: (t: unknown) => container.resolve(t) },
    config: { logger },
    dependencyManager,
    // getCreatedDids: the shim keeps no DidRecords, so `signDocumentProof` takes the key's legacy id, as Credo does without one.
    dids: { resolveDidDocument, create: createDid, getCreatedDids: async () => [] },
    genericRecords: { save: async () => undefined, findAllByQuery: async () => [], delete: async () => undefined },
    // Credential storage for the issue handler's "store": an in-memory list (Credo's W3C module needs an Askar store).
    w3cCredentials: {
      getAll: async () => [...credentials, ...held],
      store: async (o: { record: unknown }) => void credentials.push(o.record),
      // Stand-in for Credo's JSON-LD verification (the wallet's own witnessShare tests mock it too; real Credo verifies only
      // Ed25519Signature2018, which cannot verify the suite's eddsa-jcs-2022 bundles). The suite's own eddsa-jcs-2022 verifier
      // answers; challenge and domain are compared as Credo does. Everything after this call in the wallet is the wallet's own.
      verifyCredential: async (o: { credential: unknown }) => ({ isValid: suiteVerifyProof(JsonTransformer.toJSON(o.credential), { nowMs: Date.now() }).valid }),
      verifyPresentation: async (o: { presentation: unknown; challenge?: string; domain?: string }) => {
        const vp = JsonTransformer.toJSON(o.presentation);
        const proof = vp?.proof ?? {};
        if (o.challenge !== undefined && proof.challenge !== o.challenge) return { isValid: false };
        if (o.domain !== undefined && proof.domain !== o.domain) return { isValid: false };
        return { isValid: suiteVerifyProof(vp, { nowMs: Date.now(), controllerMember: "holder" }).valid };
      },
      // Stand-in for Credo's JSON-LD presentation signing (Ed25519Signature2018 needs a JSON-LD document loader and the KMS): the
      // presentation the wallet built (`buildChallengeBoundVp`) is signed eddsa-jcs-2022 by the holder's key with the challenge and
      // domain the wallet passes. What the wallet puts in the presentation, and everything after this call, is the wallet's own.
      signPresentation: async (o: { presentation: unknown; verificationMethod: string; challenge?: string; domain?: string }) => {
        const vp = JsonTransformer.toJSON(o.presentation);
        if (vp.holder !== iutSigner.did) throw new Error(`the shim signs presentations for ${iutSigner.did} only`);
        return signDocument(vp, iutSigner, { purpose: "authentication", challenge: o.challenge, domain: o.domain, controllerMember: "holder", created: Date.now() });
      },
    },
    modules: { didcomm: { connections: { getById: async (id: string) => conns.get(id) } } },
  };
}

let agent = makeAgent();

/** The conformance carrier's spec policy: what a consequential task declares (proof optional, as the registry's non-attested posture). */
const CARRIER_SPEC = {
  typeUri: CARRIER_TYPE,
  isBearer: false,
  isProofRequired: false,
  isRecipientRequired: false,
  isIssuedAtRequired: true,
  payloadSchema: { type: "object", required: ["subject"], properties: { subject: { type: "string" } }, additionalProperties: true },
};

function registerCarrier(): void {
  if (trustTaskRegistry.get(CARRIER_TYPE)) return;
  trustTaskRegistry.register({
    typeUri: CARRIER_TYPE,
    spec: CARRIER_SPEC,
    handleRequest: async (a: any, service: any, document: Record<string, unknown>, ctx: any) => {
      // The wallet's own `consume`. With no policy given the module default applies (acceptUnverified proof policy,
      // KEYRING_CONSUME_CHECKS), as in the wallet's discovery and propose handlers; KW_CARRIER_PROOF=verify installs the wallet's
      // verifier as its issue handler does.
      const outcome = await service.consume(a.context, {
        spec: CARRIER_SPEC,
        document,
        myDid: ctx.recipientDid,
        senderDid: ctx.senderDid,
        connectionId: ctx.connectionId,
        ...(CARRIER_PROOF === "verify"
          ? { proofPolicy: { kind: "verify", verify: { verify: (doc: unknown) => verifyDocumentProof(a, doc as Record<string, unknown>, ctx.senderDid, { proofPurpose: (doc as { proof?: { proofPurpose?: string } }).proof?.proofPurpose }) } } }
          : {}),
        handler: async (doc: Record<string, unknown>) => respondWith(doc, utils.uuid(), { accepted: true }, () => new Date().toISOString()),
      });
      // As the wallet's issue handler does: a handled outcome sends its response, a rejected one sends the ready error document.
      if (outcome.kind === "handled" && outcome.response) await ceremony.sendTrustTaskDocument(a, ctx.connectionId, outcome.response);
      else if (outcome.kind === "rejected" && outcome.error) await ceremony.sendTrustTaskDocument(a, ctx.connectionId, outcome.error);
    },
  });
}

let counting = false;
function countHandled(): void {
  if (counting) return;
  counting = true;
  const real = TrustTasksService.prototype.consume;
  TrustTasksService.prototype.consume = async function (...args: unknown[]) {
    const outcome = await real.apply(this, args);
    // A proposal is executed when the person accepts it (below), not when the pipeline lets it through to the consent prompt; a
    // credential-exchange query likewise when the person approves it and the wallet presents (queryDecision).
    const spec = (args[1] as { spec?: { typeUri?: string } } | undefined)?.spec;
    if ((outcome.kind === "handled" || outcome.kind === "accepted") && spec?.typeUri !== PROPOSE_TYPE && spec?.typeUri !== QUERY_TYPE) handled++;
    return outcome;
  };
}

/** The credentials the wallet stored (the issue handler's), apart from the ones `holdCredential` seeded. */
const heldIds = new Set<string>();
async function storedRecords(): Promise<any[]> {
  if (REAL === undefined) return credentials;
  return (await agent.w3cCredentials.getAll()).filter((r: any) => !heldIds.has(r.id));
}
/** The wallet's connections (shim: its table; real: the agent's records, as the app lists them). */
async function connList(): Promise<{ id: string }[]> {
  return REAL === undefined ? conns.all() : (await agent.modules.didcomm.connections.getAll()).filter((c: any) => c.isReady);
}
/** The shim-only emit agent in real mode (the producer builders use no transport; see docs/18). */
let emitAgent: any;
const answered = new Set<string>();
/** Real mode: what the app does on its own when a connection forms and when the policy decides a proposal (the shim does both inside `send`). */
async function realTick(): Promise<void> {
  for (const c of await connList()) {
    if (!prepared.has(c.id)) {
      prepared.add(c.id);
      try {
        await getOrCreateRelationshipDid(agent, (c as any).theirDid, c.id);
      } catch (e) {
        console.error("getOrCreateRelationshipDid failed:", (e as Error).message);
      }
    }
    const prompt = vrcFlowStore.getProposalPrompt(c.id);
    if (prompt && policy.propose !== "hold" && !answered.has(String(prompt.exchangeId))) {
      answered.add(String(prompt.exchangeId));
      await ceremony.respondToRelationshipProposal(agent, c.id, policy.propose === "accept");
      if (policy.propose === "accept") handled++;
    }
  }
}
/** Real mode reset: what a fresh wallet would not hold. Connections and the agent stay (they are the transport). */
async function wipeReal(): Promise<void> {
  for (const c of await connList()) {
    vrcFlowStore.clearProposalPrompt(c.id);
    try {
      vrcFlowStore.clearFlow(c.id);
    } catch {
      /* none */
    }
  }
  for (const r of await agent.w3cCredentials.getAll()) await agent.dependencyManager.resolve(W3cCredentialRepository).deleteById(agent.context, r.id);
  // The relationship-DID records (a previous vector's accepted proposal sets the counterparty's): a fresh wallet has only the ones its connections form.
  const rels = agent.dependencyManager.resolve(RelationshipDidRepository);
  for (const r of await rels.getAll(agent.context)) await rels.deleteById(agent.context, r.id);
  // The documents the wallet retained (an accepted proposal on a connection makes the next one an "upgrade", read from these).
  const docs = agent.dependencyManager.resolve(require(`${TT}/services/TrustTaskDocumentRepository`).TrustTaskDocumentRepository);
  for (const r of await docs.getAll(agent.context)) await docs.deleteById(agent.context, r.id);
  prepared.clear();
  heldIds.clear();
  answered.clear();
}

async function boot(): Promise<void> {
  outbox.clear();
  pushedBox.clear();
  conns.clear();
  storage = [];
  credentials = [];
  held = [];
  queryThreads.clear();
  unsolicited.length = 0;
  handler = undefined;
  handled = 0;
  prepared.clear();
  policy = { propose: "hold", witnessed: false };
  states.clear();
  kvReset();
  if (REAL !== undefined) {
    const first = agent === undefined || !(agent as any).__real;
    if (first) {
      agent = await REAL.agent();
      (agent as any).__real = true;
      ceremony.setupTrustTasksInbound(agent);
      if (process.env.KW_DIDCOMM_VERSIONS === "v1,v2") ceremony.setDidCommV2Enabled(true);
    } else await wipeReal();
  } else agent = makeAgent();
  registerCarrier();
  countHandled();
  listenForPrompts();
  if (REAL === undefined) ceremony.setupTrustTasksInbound(agent);
}

/** Reset: the person declines every query still waiting (the wallet's own `respondToCredentialExchangeQuery`), which clears both its pending map and its prompt store. */
async function clearDeferrals(): Promise<void> {
  for (const id of [...deferrals]) await ceremony.respondToCredentialExchangeQuery(agent, id, false);
  deferrals.clear();
}

/** What a vector can observe: executions, document states, stored credentials. Diagnostic retention of rejected documents is not a side effect (docs/05 K10). */
async function fingerprint(): Promise<string> {
  return JSON.stringify({ handled, states: [...states], credentials: (await storedRecords()).length, deferrals: deferrals.size });
}

type Doc = Record<string, unknown>;
function sortReplies(sent: { document: Doc }[], thread: string, id: string | undefined): string[] {
  const out: string[] = [];
  for (const s of sent) {
    states.note(s.document);
    if (answers(s.document, thread, id)) out.push(JSON.stringify(s.document));
    else keep(s);
  }
  return out;
}

async function afterProposeDelivered(connection: { id: string } | undefined, doc: Doc): Promise<void> {
  if (connection === undefined || doc.type !== PROPOSE_TYPE) return;
  const prompt = vrcFlowStore.getProposalPrompt(connection.id);
  if (!prompt || policy.propose === "hold") return;
  await ceremony.respondToRelationshipProposal(agent, connection.id, policy.propose === "accept");
  if (policy.propose === "accept") handled++;
}

async function send(p: { from: { kind: string; vid?: string }; bytes: string }) {
  if (CEREMONY && driver.accepts()) {
    // A reply from the peer to a document the wallet's own flow sent: the wallet's client takes it, and carries on by itself.
    try {
      const t = String(JSON.parse(p.bytes)?.type ?? "");
      if (t.endsWith("#response") || t.includes("/trust-task-error/") || t.includes("/trust-task-next-step/")) return await driver.deliver(p.bytes);
    } catch { /* not a document: the ordinary path refuses it */ }
  }
  if (CEREMONY) {
    // A community's credential delivery (credential-exchange/issue carrying its membership or role card): the wallet's inbox keeps it (the ceremony driver's `receiveDelivery`).
    try {
      const d = JSON.parse(p.bytes);
      if (d?.type === "https://trusttasks.org/spec/credential-exchange/issue/0.1" && /MembershipCredential|AuthorityCredential/.test(p.bytes)) {
        await driver.receiveDelivery(p.bytes);
        return { replies: [], transport: { status: 202, kind: "none" }, quiescentAfterMs: 0 };
      }
    } catch { /* not a document: the ordinary path refuses it */ }
  }
  let document: unknown;
  try {
    document = JSON.parse(p.bytes);
  } catch {
    // Undecodable bytes never reach a trust-task handler in the wallet (the DIDComm layer refuses them first).
    return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
  const doc = document as Doc;
  const connection = p.from.kind === "none" ? undefined : conns.forPeer(String(p.from.vid));
  if (connection !== undefined && !prepared.has(connection.id)) {
    prepared.add(connection.id);
    await getOrCreateRelationshipDid(agent, connection.theirDid, connection.id);
  }
  for (const s of outbox.take()) keep(s);
  const id = typeof doc.id === "string" ? doc.id : undefined;
  const thread = String(doc.threadId ?? doc.id);
  if (id !== undefined) states.request(id, thread);
  if (doc.type === QUERY_TYPE && id !== undefined) queryThreads.set(thread, id);
  if (handler === undefined) throw new Error("the wallet registered no inbound handler");
  await handler({ message: new TrustTaskMessage({ document: doc }), connection });
  await afterProposeDelivered(connection, doc);
  const quiescentAfterMs = await outbox.settle(40, 800);
  const replies = sortReplies(outbox.take(), thread, id);
  if (id !== undefined) states.set(id, stateFromReply(replies[0] === undefined ? undefined : (JSON.parse(replies[0]).type as string)));
  if (process.env.KW_HOST_TRACE) appendFileSync(process.env.KW_HOST_TRACE, JSON.stringify({ from: p.from, request: doc, replies: replies.map((r) => JSON.parse(r)) }) + "\n");
  return { replies, transport: { kind: replies.length > 0 ? "document" : "none" }, quiescentAfterMs };
}

async function trigger(action: string, args: Record<string, unknown>) {
  if (action === "clockOffset") {
    // Ceremony track: the wallet's clock (the shim's faked Date) moved by `seconds`, so its next document is genuinely signed at that time.
    const secs = Number(args.seconds ?? 0);
    if (secs === 0) { if (clockFaked) { jest.useRealTimers(); clockFaked = false; } return { documents: [] }; }
    setFakeClock(Math.floor(performance.timeOrigin + performance.now()) + secs * 1000);
    return { documents: [] };
  }
  if (action === "policy") {
    const p = args.propose;
    if (p !== "accept" && p !== "decline" && p !== "hold") throw new Error("policy.propose must be accept, decline or hold");
    policy = { propose: p, witnessed: args.witnessed === true };
    return { documents: [] };
  }
  if (action === "consent") {
    // The person decides a held proposal: the wallet's own `respondToRelationshipProposal`, by the exchange the prompt names.
    const exchangeId = String(args.exchangeId);
    const found = (await connList()).find((c) => vrcFlowStore.getProposalPrompt(c.id)?.exchangeId === exchangeId);
    if (found === undefined) throw new Error(`no proposal is awaiting consent for exchange ${exchangeId}`);
    for (const s of outbox.take()) keep(s);
    await ceremony.respondToRelationshipProposal(agent, found.id, args.decision === "accept");
    if (args.decision === "accept") handled++;
    await outbox.settle(40, 800);
    const docs = sortReplies(outbox.take(), exchangeId, undefined);
    for (const d of docs) pushedBox.record(d, typeof JSON.parse(d).recipient === "string" ? JSON.parse(d).recipient : found.theirDid);
    return { documents: docs };
  }
  if (action === "holdCredential" && QUERY_SERVED) {
    // Helper: the wallet comes to hold a W3C JSON-LD credential of this type IRI (in its credential store, see heldRecord).
    const rec = heldRecord(typeof args.type === "string" ? args.type : "https://example.org/conformance#ConformanceCredential");
    if (REAL === undefined) held.push(rec);
    else {
      await agent.dependencyManager.resolve(W3cCredentialRepository).save(agent.context, rec);
      heldIds.add(rec.id);
    }
    return { documents: [] };
  }
  if (action === "queryDecision" && QUERY_SERVED) {
    // The person decides a deferred query: the wallet's own `respondToCredentialExchangeQuery`, by the query id its prompt names.
    const thread = String(args.thread);
    // Over the shim the host saw the query arrive (`queryThreads`); with the real agent (DIDComm row) it did not, and the thread opened by a query is the query's own id.
    const queryId = queryThreads.get(thread) ?? (deferrals.has(thread) ? thread : undefined);
    if (queryId === undefined || !deferrals.has(queryId) || credentialExchangeStore.getQueryPrompt(queryId) === undefined) throw new Error(`no deferred query in thread ${thread}`);
    for (const s of outbox.take()) keep(s);
    await ceremony.respondToCredentialExchangeQuery(agent, queryId, args.decision === "approve");
    await outbox.settle(40, 800);
    // What the wallet sends on the query's thread (a credential-exchange/present) is the answer; anything else is unsolicited.
    const out: string[] = [];
    for (const s of outbox.take()) {
      states.note(s.document);
      if (s.document.threadId === thread) {
        out.push(JSON.stringify(s.document));
        pushedBox.record(JSON.stringify(s.document), typeof s.document.recipient === "string" ? s.document.recipient : peerOf(s.connectionId));
      } else keep(s);
    }
    if (out.length > 0) handled++;
    return { documents: out };
  }
  throw new Error(`unsupported trigger ${action}`);
}

// ---------------------------------------------------------------- producer class (emit)
// The wallet's own VtaClient (module/VtaClient.ts) and device helpers (module/vtaDevices.ts) build and sign every request they send:
// `VtaClient.sendTask` makes the document, signs it with `signDocumentProof` (the shim KMS holds the IUT's connection key) and hands it
// to a session. Here the session is a capture: `sendTo` records the document and throws, so nothing leaves and no answer is awaited.
// The wallet's code is the original; the shim supplies the session, the identity, the store and the carriage decision (didcomm).
// Each type is emitted by the real method that sends it first (the version ladder's first rung); inputs the real callers take from the
// person or the agent (a subject DID, a label) are fixed sample values chosen here, never by the harness.
const { makeEmitter } = require("./emitters");
const SAMPLE_SUBJECT = didKeyFromEd25519(ed25519Signer(seedOf(0x4d)).publicKey);
const emitter = makeEmitter({ tt: TT, core: CORE, agent: () => (REAL === undefined ? agent : (emitAgent ??= makeAgent())), did: idn.vid, didKeyId: idn.vid.slice("did:key:".length), sampleSubject: SAMPLE_SUBJECT, require, successor: () => { const sg = ed25519Signer(seedOf(0x4f)); const did = didKeyFromEd25519(sg.publicKey); for (const id of [TypedArrayEncoder.toBase58(sg.publicKey), did.slice("did:key:".length)]) standInKeys.set(id, sg); return { did, keyId: did.slice("did:key:".length), publicKey: sg.publicKey }; }, uvSigner: () => { const sg = ed25519Signer(seedOf(0x4e)); return { did: didKeyFromEd25519(sg.publicKey), sign: (b: Uint8Array) => sg.sign(b) }; } });
// ---------------------------------------------------------------- ceremony driver (docs/26): the wallet's own request code, carried by the runner
const { makeDriver } = require("./ceremony-driver");
const driver = makeDriver({ tt: TT, core: CORE, require, agent: () => agent, did: idn.vid, didKeyId: idn.vid.slice("did:key:".length), sampleSubject: SAMPLE_SUBJECT, successor: () => emitterCtxSuccessor(), uvSigner: () => { const sg = ed25519Signer(seedOf(0x4e)); return { did: didKeyFromEd25519(sg.publicKey), sign: (b: Uint8Array) => sg.sign(b) }; } });
function emitterCtxSuccessor() { const sg = ed25519Signer(seedOf(0x4f)); const did = didKeyFromEd25519(sg.publicKey); for (const id of [TypedArrayEncoder.toBase58(sg.publicKey), did.slice("did:key:".length)]) standInKeys.set(id, sg); return { did, keyId: did.slice("did:key:".length), publicKey: sg.publicKey }; }
const CEREMONY = process.env.KW_CEREMONY === "on";
let EMITS_CACHE: string[] | undefined;
const emitTypes = async (): Promise<string[]> => (process.env.KW_EMIT === "off" ? [] : (EMITS_CACHE ??= await emitter.types()));

async function emit(p: { type: string; args?: { recipient?: string } }) {
  // The addressee is the VTA (or community) the wallet is addressing: the harness's hint when given.
  const { docs, standIn } = await emitter.emit(p.type, typeof p.args?.recipient === "string" ? p.args.recipient : undefined);
  return { documents: docs.map((d: unknown) => JSON.stringify(d)), ...(standIn.length > 0 ? { standIn } : {}) };
}

// ---------------------------------------------------------------- ceremony track (docs/25, groups FC-KVC and FC-KVX)
// The wallet as one participant of a ceremony run with a platform. What is the wallet's own: the decision a real approver sends (`VtaClient.decideConsent`, its own
// signature, its own step-down over the decision versions from the refusals the peer really sent) and, for a credential-exchange query, the wallet's own handler and
// `respondToCredentialExchangeQuery` (the `send`, `trigger queryDecision` and `observe pushed` above). What is the shim (class D): the carrier (the runner relays documents,
// nothing is packed or delivered over a mediator), the inbox that stands in for the wallet's approver-device ingestion of a task-consent request (vtaAgent.ts is not driven: it
// needs a live agent session), and the tamper applied by the negative scenarios (src/ceremony/tamper.ts, re-signed with the wallet's own key).
type KvEntry = { from: string; thread: string; doc: Doc; text: string };
const kv = { alias: new Map<string, string>(), enrolled: new Set<string>(), peers: new Set<string>(), inbox: [] as KvEntry[], docThread: new Map<string, string>(), cex: new Map<string, string>() };
const kvReset = () => {
  kv.peers.clear();
  kv.enrolled.clear();
  kv.alias.clear();
  kv.inbox.length = 0;
  kv.docThread.clear();
  kv.cex.clear();
};
const CONSENT_REQUEST_TYPE = "https://trusttasks.org/spec/task-consent/request/0.1";
const kvIsReplyType = (t: string) => t.endsWith("#response") || t.includes("/trust-task-error/") || t.includes("/trust-task-next-step/");
/** A document the wallet's registry does not serve and a reply to a document the wallet sent: kept in the inbox, never answered. Everything else goes to the wallet's own handlers. */
function kvIntercept(p: { from: { kind: string; vid?: string }; bytes: string }): boolean {
  let doc: Doc;
  try {
    doc = JSON.parse(p.bytes) as Doc;
  } catch {
    return false;
  }
  const type = String(doc.type ?? "");
  const from = p.from.kind === "none" ? "" : String(p.from.vid);
  const irt = String((doc.payload as { inResponseTo?: { id?: string } } | undefined)?.inResponseTo?.id ?? "");
  const mapped = kv.docThread.get(String(doc.threadId ?? "")) ?? kv.docThread.get(irt);
  if (type === CONSENT_REQUEST_TYPE) {
    // a device takes a consent request only from an agent it is enrolled with (the wallet's VTA link); any other is dropped, never prompted
    if (!kv.enrolled.has(String(doc.issuer))) return true;
    const thread = String(doc.threadId ?? doc.id);
    kv.docThread.set(thread, thread);
    kv.inbox.push({ from, thread, doc, text: p.bytes });
    return true;
  }
  if (kvIsReplyType(type) && mapped !== undefined) {
    kv.inbox.push({ from, thread: mapped, doc, text: p.bytes });
    return true;
  }
  // a reply to a presentation the wallet sent (the verifier's #response or refusal): kept for the wallet's reading of the thread
  if (kvIsReplyType(type) && (kv.cex.has(String(doc.threadId ?? "")) || kv.cex.has(irt))) {
    const thread = kv.cex.has(String(doc.threadId ?? "")) ? String(doc.threadId) : irt;
    kv.inbox.push({ from, thread, doc, text: p.bytes });
    if (type.includes("/trust-task-error/")) kv.cex.set(thread, "refused");
    return true;
  }
  return false;
}
async function kvInitiate(p: { kind: string; to: string; thread?: string; args?: Record<string, unknown> }) {
  if (p.kind !== "consent-decision") throw new Error(`initiate: this adapter does not start ${p.kind}`);
  if (!kv.peers.has(p.to)) throw new Error(`initiate: not connected to ${p.to} (call connect first)`);
  // the request the executor sent THIS wallet: on the scenario's thread, else (an executor that mints one request per approver, each with its own id) the newest this wallet holds
  const req = [...kv.inbox].reverse().find((e) => e.thread === p.thread && e.doc.type === CONSENT_REQUEST_TYPE) ?? [...kv.inbox].reverse().find((e) => e.doc.type === CONSENT_REQUEST_TYPE);
  if (req === undefined || p.thread === undefined) throw new Error("initiate consent-decision: no task-consent request was received on that thread");
  if (req.thread !== p.thread) kv.alias.set(p.thread, req.thread);
  const scen = p.thread;
  p = { ...p, thread: req.thread };
  const pl = req.doc.payload as { challenge: string; payloadDigest: string };
  const refusals = kv.inbox.filter((e) => e.thread === p.thread && String(e.doc.type).includes("/trust-task-error/") && String((e.doc.payload as { code?: string }).code ?? "").startsWith("unsupported")).map((e) => e.doc);
  const built = await emitter.consentDecision(p.to, { challenge: pl.challenge, payloadDigest: pl.payloadDigest }, p.args?.decision === "deny" ? "deny" : "approve", refusals);
  let text = JSON.stringify(built.document);
  kv.docThread.set(String(built.document.threadId), p.thread);
  kv.docThread.set(String(built.document.id), p.thread);
  if (p.args?.tamper !== undefined) {
    if (!isTamperMode(p.args.tamper)) throw new Error(`initiate consent-decision: unknown tamper ${String(p.args.tamper)}`);
    text = tamperDecision(text, p.args.tamper, ed25519Signer(seedOf(identitySeed())), Date.now());
  }
  return { threadId: scen, documents: p.args?.repeat === true ? [text, text] : [text], sent: false };
}
/** The wallet's reading of a thread, from what reached it: an approver reads what the executor answered to its decision; a holder reads its own deferral and presentation. */
function kvCeremony(scenarioThread: string): string {
  const thread = kv.alias.get(scenarioThread) ?? scenarioThread;
  const mine = kv.inbox.filter((e) => e.thread === thread);
  const cex = kv.cex.get(thread);
  if (cex !== undefined) return cex;
  if (mine.length === 0) return "unknown";
  const replies = mine.filter((e) => kvIsReplyType(String(e.doc.type)));
  const last = replies.at(-1);
  if (last === undefined) return "open";
  const type = String(last.doc.type);
  const pl = (last.doc.payload ?? {}) as { status?: string; code?: string };
  if (type.includes("/trust-task-next-step/")) return "held";
  if (type.includes("/trust-task-error/")) return String(pl.code ?? "").startsWith("unsupported") ? "open" : "refused";
  return pl.status === "granted" ? "completed" : pl.status === "denied" ? "aborted" : pl.status === "pending" ? "held" : "open";
}
const kvReceived = (q: { from?: string; type?: string; threadId?: string }) => {
  const t = q.threadId === undefined ? undefined : (kv.alias.get(q.threadId) ?? q.threadId);
  const docs = kv.inbox.filter((e) => (q.from === undefined || e.from === q.from) && (q.type === undefined || e.doc.type === q.type) && (t === undefined || e.thread === t)).map((e) => e.text);
  return { value: docs.length, documents: docs };
};


const KV = process.env.KW_CEREMONY !== "off";
/** The additions to the capabilities of a wallet that can take part in the ceremony track. */
function kvMerge(c: any) {
  if (!KV) return c;
  return {
    ...c,
    optional: [...new Set([...c.optional, "initiate", "peer.connect", "observe.received", "observe.ceremony", "trigger.consentEnrol"])],
    initiates: [...(c.initiates ?? []), "consent-decision"],
    ceremonyRoles: [...(c.ceremonyRoles ?? []), { ceremony: "FC-KVC", roles: ["approver", "outsider", "approver-laddered"] }, { ceremony: "FC-KVX", roles: ["holder"] }, { ceremony: "FC-CEX", roles: ["holder"] }],
  };
}
const baseSend = send;
const baseTrigger = trigger;
const adapter = {
  capabilities: async () => kvMerge(capabilities({
      commit: git(KW_ROOT),
      bifoldCommit: git(`${KW_ROOT}/bifold`),
      walletTypes: SERVED_WALLET_TYPES,
      consent: true,
      fakeClock: FAKE_CLOCK,
      carrierProof: CARRIER_PROOF,
      witnessShare: WSH_STANDIN,
      query: QUERY_SERVED,
      emits: await emitTypes(),
      ...(CEREMONY ? { ceremony: { initiates: driver.kinds() } } : {}),
    })),
  provision: async (roles: string[]) => provisionRoles(roles),
  trust: async () => undefined,
  setClock: async (p: { iso: string } | string) => setFakeClock(Date.parse(typeof p === "string" ? p : p.iso)),
  advance: async (p: { ms: number } | number) => setFakeClock(Date.now() + (typeof p === "number" ? p : p.ms)),
  send: async (p: { from: { kind: string; vid?: string }; bytes: string }) => {
    if (KV && kvIntercept(p)) return { replies: [], transport: { kind: "none" }, quiescentAfterMs: 0 };
    const r = await baseSend(p);
    if (KV) {
      try {
        const d = JSON.parse(p.bytes) as Doc;
        const thread = String(d.threadId ?? d.id);
        // the wallet's own handler kept the query for its person: the holder reads `held`; a query it answered at once is read from its own presentation
        if (d.type === QUERY_TYPE) {
          kv.inbox.push({ from: p.from.kind === "none" ? "" : String(p.from.vid), thread, doc: d, text: p.bytes });
          const qid = queryThreads.get(thread);
          if (qid !== undefined && deferrals.has(qid)) kv.cex.set(thread, "held");
        }
      } catch {
        /* undecodable: the wallet refused it already */
      }
    }
    return r;
  },
  trigger: async (action: string, args: Record<string, unknown>) => {
    if (KV && action === "enrolExecutor") { kv.enrolled.add(String(args.vid)); return { documents: [] }; }
    const r = await baseTrigger(action, args);
    if (KV && action === "queryDecision") kv.cex.set(String(args.thread), args.decision === "approve" ? (r.documents.length > 0 ? "completed" : "refused") : "declined");
    if (KV && action === "queryDecision" && args.tamper !== undefined && r.documents.length > 0) {
      // a harness stand-in (class D, src/ceremony/tamper.ts): the presentation the wallet's own handler built is changed in ONE way and re-signed with the wallet's own key; the pushed record is replaced so the runner relays the changed one
      if (!isTamperMode(args.tamper)) throw new Error(`queryDecision: unknown tamper ${String(args.tamper)}`);
      const changed = r.documents.map((t: string) => tamperDecision(t, args.tamper as never, ed25519Signer(seedOf(identitySeed())), Date.now()));
      const to = r.documents.map((t: string) => String(JSON.parse(t).recipient ?? ""));
      pushedBox.drop(r.documents);
      changed.forEach((t: string, i: number) => pushedBox.record(t, to[i]));
      return { documents: changed };
    }
    return r;
  },
  emit,
  // Two ceremony tracks share these methods: the wallet's own request code (docs/26, `driver`) and the consent-gate approver (FC-KVC/FC-KVX, `kv`).
  // The consent-decision kind and the threads the consent track opened go to the consent track; everything else goes to the driver.
  initiate: async (p: { kind: string; to: string; thread?: string; args?: Record<string, unknown> }) => (KV && p.kind === "consent-decision" ? kvInitiate(p) : driver.initiate(p)),
  connect: async (p: { peer?: { vid: string } }) => {
    if (KV && p?.peer?.vid !== undefined) kv.peers.add(p.peer.vid);
    return { connected: true, detail: "the wallet addresses the peer by DID; there is no connection to make (carrier is the runner's relay)" };
  },
  observe: async (q: { query: string; id?: string; kind?: string; threadId?: string; type?: string; from?: string }) => {
    const kvThread = q.threadId !== undefined && (kv.alias.has(q.threadId) || kv.inbox.some((e) => e.thread === q.threadId) || kv.cex.has(q.threadId));
    if (q.query === "ceremony") {
      if (KV && kvThread) return { value: kvCeremony(String(q.threadId)) };
      const st = driver.state(String(q.threadId));
      return { value: st === "refused" || st === "aborted" ? "refused" : st };
    }
    if (q.query === "received") {
      if (KV && (kvThread || q.threadId === undefined && kv.inbox.length > 0)) return kvReceived(q);
      const docs = driver.received(q.threadId === undefined ? undefined : String(q.threadId)).filter((d: Doc) => (q.type === undefined || d.type === q.type) && (q.from === undefined || d.issuer === q.from));
      return { value: docs.length, documents: docs.map((d: Doc) => JSON.stringify(d)) };
    }
    if (q.query === "handled") return { value: handled };
    if (q.query === "pushed") return pushedBox.observe(q as { to?: string; type?: string; threadId?: string });
    if (q.query === "emitReport") {
      await emitTypes();
      return { value: emitter.report() };
    }
    if (q.query === "documentState") return { value: states.get(String(q.id)) };
    if (q.query === "stored") {
      if (q.kind === "vrc") return { value: (await storedRecords()).filter((r: any) => (r.getTags?.() ?? {})[require(`${CORE}/src/modules/vrc/utils/witnessCredentialUtils`).WITNESS_VERIFIED_TAG] !== "true").length };
      if (q.kind === "vwc") {
        const digestOf = (r: any): string | undefined => {
          try {
            return digestMultibase(JsonTransformer.toJSON(r.firstCredential));
          } catch {
            return undefined;
          }
        };
        const { WITNESS_VERIFIED_TAG } = require(`${CORE}/src/modules/vrc/utils/witnessCredentialUtils`);
        const witnessed = (await storedRecords()).filter((r: any) => (r.getTags?.() ?? {})[WITNESS_VERIFIED_TAG] === "true");
        const digest = (q as { digest?: string }).digest;
        return { value: digest === undefined ? witnessed.length : witnessed.filter((r) => digestBytesEqualSafe(digestOf(r), digest)).length };
      }
      // Queries the wallet holds for its user's decision (its credentialExchangeStore prompts).
      if (q.kind === "deferral" && QUERY_SERVED) return { value: deferrals.size };
      // Ceremony track: how many cards the wallet's last restore (fetchAgentCards) got back with their credential.
      if (q.kind === "step-up-asked") return { value: driver.stepUpAsked() };
      if (q.kind.startsWith("join-status:")) { const r: any = driver.lastResult(); return { value: r?.status === q.kind.slice(12) ? 1 : 0 }; }
      if (q.kind === "join-status-not-misleading") { const r: any = driver.lastResult(); return { value: r === undefined || r?.status === "rejected" ? 1 : 0 }; }
      if (q.kind.startsWith("join-status-reason:")) { const r: any = driver.lastResult(); return { value: r?.reason === q.kind.slice(19) ? 1 : 0 }; }
      if (q.kind.startsWith("vote:")) return { value: voteStoredKind(driver.voteState(), q.kind) };
      if (q.kind.startsWith("rooms:")) return { value: roomsStoredKind(driver.roomsState() as any, q.kind) };
      if (q.kind.startsWith("cast:")) return { value: ballotStoredKind(driver.ballotState(), q.kind) };
      if (q.kind.startsWith("persona:")) return { value: personaStoredKind(driver.personaState(), q.kind) };
      if (q.kind.startsWith("dir-")) return { value: dirStoredKind(driver.dirState(), q.kind) };
      if (q.kind === "restored-cards") { const r = driver.lastResult(); return { value: Array.isArray(r) ? r.filter((x: any) => x?.credential).length : 0 }; }
      return { value: 0 };
    }
    throw new Error(`unsupported observe ${q.query}`);
  },
  restart: async () => {
    if (REAL !== undefined) {
      await REAL.restart();
      return;
    }
    // The wallet process restarts: the agent (container, handlers, in-memory services) is rebuilt over the same stored records.
    outbox.clear();
    handler = undefined;
    agent = makeAgent();
    ceremony.setupTrustTasksInbound(agent);
  },
  reset: async () => {
    driver.reset();
    require(`${TT}/module/taskVersions`).forgetAllVersions();
    if (clockFaked) {
      jest.useRealTimers();
      clockFaked = false;
    }
    await clearDeferrals();
    await boot();
  },
  snapshot: async () => {
    const id = `snap-${snapshots.size}`;
    snapshots.set(id, await fingerprint());
    return id;
  },
  diff: async (p: { snapshotId?: string } | string) => {
    const before = snapshots.get(typeof p === "string" ? p : String(p.snapshotId));
    const now = await fingerprint();
    return before === now ? { changed: false } : { changed: true, detail: `${before} -> ${now}` };
  },
  verifyProof: async (p: { bytes: string }) => {
    // The wallet's own verifier, as the receive path calls it: under the controller of the proof's verification method, for the
    // purpose the proof names (the wallet's default is assertionMethod; the proof's own purpose is passed so a valid proof is not
    // refused on purpose alone).
    try {
      const doc = JSON.parse(p.bytes);
      const proof = Array.isArray(doc.proof) ? doc.proof[0] : doc.proof;
      const controller = String(proof?.verificationMethod ?? "").split("#")[0];
      return { valid: await verifyDocumentProof(agent, doc, controller, { proofPurpose: proof?.proofPurpose }) };
    } catch {
      return { valid: false };
    }
  },
};

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) reject(new Error("too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

test("serve the adapter contract until stopped", async () => {
  // jestSetup pins Date.now() to 2024; the pipeline and the documents must read one real clock.
  jest.restoreAllMocks();
  jest.spyOn(Date, "now").mockRestore?.();
  await boot();
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((r) => (stop = r));
  let chain: Promise<void> = Promise.resolve();
  const server = createServer((req, res) => {
    chain = chain.then(async () => {
      try {
        const body = await readBody(req);
        if (req.url === "/shutdown") {
          res.writeHead(200).end("bye");
          stop();
          return;
        }
        const parsed = JSON.parse(body);
        const out = await dispatch(adapter as never, parsed);
        const text = JSON.stringify(out);
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) }).end(text);
      } catch {
        if (!res.headersSent) res.writeHead(400).end("bad request");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let ticking = true;
  if (REAL !== undefined) {
    // Control-plane duties of the app, and the stop file (the launcher also asks over HTTP; either ends the host).
    const t0 = performance.now();
    (async () => {
      while (ticking) {
        try {
          await realTick();
        } catch (e) {
          console.error("tick:", (e as Error).message);
        }
        if ((process.env.KW_STOP_FILE && require("node:fs").existsSync(process.env.KW_STOP_FILE)) || performance.now() - t0 > Number(process.env.KW_HOST_MAX_MS ?? 90 * 60 * 1000)) stop();
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    await REAL.publishInvitation(agent);
  }
  if (PORT_FILE) writeFileSync(PORT_FILE, String(port));
  await stopped;
  ticking = false;
  server.close();
  if (REAL !== undefined) await REAL.shutdown();
});
