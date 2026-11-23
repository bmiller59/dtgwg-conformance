// SPDX-License-Identifier: Apache-2.0
/**
 * keyring-wallet witness-server adapter host. A plain Node program (no test runner): it registers the witness server's own TypeScript
 * toolchain (ts-node with the server's tsconfig and its `tsp-esm-preload.cjs`, exactly as the server's `start` script does), loads the
 * server's code by path, and serves the suite's adapter contract (docs/04 section 4) as HTTP JSON-RPC on 127.0.0.1 until the launcher
 * (launcher.ts) asks it to stop. Do not run it directly; run the launcher.
 *
 * What is the server's own, original code: `WitnessTaskSessions` (the witness/session and witness/session/submit handlers and the
 * trust-task discovery answer, WitnessTaskSessions.ts), `buildWitnessCredentialJson` (the credential it issues, credentialBuilder.ts),
 * the document-proof signer and verifier (@bifold/trust-tasks), the `@openvtc/trust-tasks` consume pipeline it calls, and Credo's own
 * JSON-LD presentation verification and credential signing, on a real Credo agent over a throw-away Askar SQLite wallet.
 * What is the shim: the carrier below `handleDocument` (an in-memory DidCommMessageSender stand-in that captures the reply instead of
 * packing and routing it; the DIDComm v1, v2 and TSP framing, connections and mediator are not exercised), the connection table, the
 * witness's connection DID (a did:key here, a did:peer in a deployment), and the clock (the process `Date` is replaced by a settable one).
 * No network beyond this loopback port; no secrets (every key is a fixed test seed).
 *
 * @ts-nocheck is deliberate: the server's modules are loaded by absolute path at run time and are not part of this repository's type graph.
 */
// @ts-nocheck
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../../adapter/contract.ts";
import { MAX_BODY_BYTES } from "../../adapter/server.ts";
import { ed25519Signer, seedOf } from "../../crypto/didkey.ts";
import { isSessionResponse, isSubmitResponse, LEGACY_SERVED, ACTOR_SEEDS, ISSUER_SEED, WITNESS_SEED, WITNESS_DOMAIN, capabilities, stateFromReply, vpVariantOf } from "./shim.ts";

const KW_ROOT = process.env.KW_ROOT ?? "../keyring-wallet";
const WS = `${KW_ROOT}/bifold/packages/witness-server`;
const PORT_FILE = process.env.WIT_HOST_PORT_FILE;
const POLICY = process.env.WIT_LOCALITY_POLICY === "off" || process.env.WIT_LOCALITY_POLICY === "required" ? process.env.WIT_LOCALITY_POLICY : "offered";
const SHAPE = process.env.WIT_CREDENTIAL_SHAPE === "wd02" ? "wd02" : "vsc";

// The settable clock: every Date.now() and new Date() in the server, Credo and the harness helpers reads it once set.
const RealDate = Date;
let clockMs: number | undefined;
const nowMs = (): number => clockMs ?? RealDate.now();
class SettableDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs());
    else super(...(args as [number]));
  }
  static now(): number {
    return nowMs();
  }
}
globalThis.Date = SettableDate as unknown as DateConstructor;

const req = createRequire(`${WS}/package.json`);
req("./tsp-esm-preload.cjs");
req("ts-node").register({ transpileOnly: true, project: `${WS}/tsconfig.json`, compilerOptions: { module: "commonjs" } });
const here = (name: string) => req.resolve(name);
// The native askar binding registers itself into askar-shared as an import side effect and must load before any @credo-ts module (the server's index.ts does the same).
const { askar } = req("@openwallet-foundation/askar-nodejs");
const credoCore = req("@credo-ts/core");
const credoDidcomm = req("@credo-ts/didcomm");
const { AskarModule } = req("@credo-ts/askar");
const { agentDependencies } = req("@credo-ts/node");
const vrcShared = req("@bifold/vrc-shared");
const { Agent, CacheModule, DidsModule, InMemoryLruCache, KeyDidRegistrar, KeyDidResolver, PeerDidNumAlgo, PeerDidRegistrar, PeerDidResolver, W3cCredentialsModule, ClaimFormat, JsonTransformer, W3cCredential, W3cPresentation, TypedArrayEncoder } = credoCore;
const { DidCommMessageSender } = credoDidcomm;

const { WitnessTaskSessions, SESSION_TYPES, SUBMIT_TYPES, DISCOVERY_TYPES } = req("./src/trustTasks/WitnessTaskSessions");
/** The versions the server build declares it serves (its own constants); a build without them is the 0.1-only one. */
const SERVED = Array.isArray(SESSION_TYPES) && Array.isArray(SUBMIT_TYPES) ? { session: [...SESSION_TYPES], submit: [...SUBMIT_TYPES], discovery: Array.isArray(DISCOVERY_TYPES) ? [...DISCOVERY_TYPES] : LEGACY_SERVED.discovery } : LEGACY_SERVED;
const { buildWitnessCredentialJson, extractVrcHardwareAttestationPublicKey } = req("./src/credentialBuilder");

type Ident = { did: string; vm: string; keyId: string };
let tmp = "";
let agent: any;
const identities: Record<string, Ident> = {};
let witnessIdentity: Ident;
let issuer: { did: string; vm: string };
let sessions: any;
/** Replies the server's `handleDocument` handed to the (shim) message sender, in order. */
let outbox: Record<string, unknown>[] = [];
let handled = 0;
let issued = 0;
const states = new Map<string, string>();
const snapshots = new Map<string, string>();
function setFakeClock(ms: number): void {
  clockMs = ms;
}

function git(dir: string): string {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--short=9", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function importIdentity(seed: Uint8Array): Promise<Ident> {
  const signer = ed25519Signer(seed);
  const imported = await agent.kms.importKey({
    privateJwk: { kty: "OKP", crv: "Ed25519", d: TypedArrayEncoder.toBase64Url(seed), x: Buffer.from(signer.publicKey).toString("base64url") },
  });
  const created = await agent.dids.create({ method: "key", options: { keyId: imported.keyId } });
  if (created.didState.state !== "finished" || created.didState.did !== signer.did) throw new Error(`did:key import failed: ${JSON.stringify(created.didState)}`);
  return { did: signer.did, vm: signer.verificationMethod, keyId: imported.keyId };
}

async function makeAgent(): Promise<void> {
  tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "wit-host-"));
  agent = new Agent({
    config: {},
    dependencies: agentDependencies,
    modules: {
      askar: new AskarModule({ askar, store: { id: "wit-host-wallet", key: "wit-host-key", database: { type: "sqlite", config: { path: join(tmp, "wallet.db") } } } }),
      w3cCredentials: new W3cCredentialsModule({ documentLoader: vrcShared.demoDocumentLoader }),
      diSuite: new vrcShared.DataIntegritySuiteModule(),
      cache: new CacheModule({ cache: new InMemoryLruCache({ limit: 100 }) }),
      dids: new DidsModule({ resolvers: [new KeyDidResolver(), new PeerDidResolver()], registrars: [new KeyDidRegistrar(), new PeerDidRegistrar()] }),
    },
  });
  await agent.initialize();
  for (const [name, byte] of Object.entries(ACTOR_SEEDS)) identities[name] = await importIdentity(seedOf(byte));
  witnessIdentity = await importIdentity(seedOf(WITNESS_SEED));
  // The credential issuer is a did:peer, as the server makes its own (createRandomPeerDid).
  const issuerKey = ed25519Signer(seedOf(ISSUER_SEED));
  const issuerImported = await agent.kms.importKey({ privateJwk: { kty: "OKP", crv: "Ed25519", d: TypedArrayEncoder.toBase64Url(seedOf(ISSUER_SEED)), x: Buffer.from(issuerKey.publicKey).toString("base64url") } });
  const peer = await agent.dids.create({ method: "peer", options: { numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc, keyId: issuerImported.keyId } });
  if (peer.didState.state !== "finished") throw new Error(`issuer did:peer creation failed: ${JSON.stringify(peer.didState)}`);
  const resolved = await agent.dids.resolve(peer.didState.did);
  const am = resolved.didDocument.assertionMethod?.[0] ?? resolved.didDocument.authentication?.[0];
  issuer = { did: peer.didState.did, vm: typeof am === "string" ? am : am.id };
}

/** The wallet seen by the server's handler: the real agent, with the DIDComm sender and connection lookup replaced by the in-memory carrier. */
function carrierAgent(): any {
  const sender = {
    sendMessage: async (ctx: any) => {
      const doc = ctx?.message?.document;
      if (doc !== undefined) outbox.push(JSON.parse(JSON.stringify(doc)));
    },
  };
  const container = new Proxy(agent.dependencyManager.container, {
    get: (t, p) => (p === "resolve" ? (token: unknown) => (token === DidCommMessageSender ? sender : t.resolve(token)) : Reflect.get(t, p, t)),
  });
  const dependencyManager = new Proxy(agent.dependencyManager, { get: (t, p) => (p === "container" ? container : Reflect.get(t, p, t)) });
  const modules = { didcomm: { connections: { getById: async (id: string) => ({ id }) } } };
  return new Proxy(agent, { get: (t, p) => (p === "dependencyManager" ? dependencyManager : p === "modules" ? modules : Reflect.get(t, p, t)) });
}

function boot(): void {
  outbox = [];
  handled = 0;
  issued = 0;
  states.clear();
  sessions = new WitnessTaskSessions({
    agent: carrierAgent(),
    name: "witness-conformance",
    domain: WITNESS_DOMAIN,
    localityPolicy: POLICY,
    credentialShape: SHAPE,
    getIssuer: async () => ({ did: issuer.did, verificationMethodId: issuer.vm }),
    buildVwcJson: (presentation, sessionId, localityAssertion) =>
      buildWitnessCredentialJson(presentation, { issuerDid: issuer.did, witnessName: "witness-conformance", sessionId, verificationMethod: "session-based-challenge", localityAssertion, shape: SHAPE }),
    vrcHardwareAttestationPublicKey: (presentation) => extractVrcHardwareAttestationPublicKey(presentation),
  });
}

/** What a vector can observe: open sessions, credentials issued. */
function fingerprint(): string {
  return JSON.stringify({ open: [...sessions.sessions.keys()].sort(), issued });
}

function actorOf(vid: string): { name: string; id: Ident } | undefined {
  for (const [name, id] of Object.entries(identities)) if (id.did === vid) return { name, id };
  return undefined;
}

/** A party's presentation, as the wallet builds it (witnessed-vrc-manager.ts): its relationship credential, wrapped in a presentation signed for {challenge, domain}. */
async function witnessPresentation(args: Record<string, unknown>): Promise<string> {
  const holder = actorOf(String(args.holder));
  if (holder === undefined) throw new Error(`witnessPresentation: no key held for ${String(args.holder)}`);
  const variant = vpVariantOf(args.variant);
  // a member presentation carries a credential that names the member DID itself (the holder), not the partner of a relationship
  const subject = variant === "member" ? holder.id.did : String(args.partner ?? "did:example:partner");
  const now = Date.now();
  const ctxs = ["https://www.w3.org/2018/credentials/v1"];
  // a presentation by someone outside the exchange is that someone's own credential in that someone's own presentation
  const vpHolder = variant === "outsiderHolder" ? (actorOf(String(args.outsider ?? identities.S.did)) ?? holder) : holder;
  const vrc = { "@context": ctxs, type: ["VerifiableCredential"], issuer: vpHolder.id.did, issuanceDate: new Date(now - 300000).toISOString(), credentialSubject: { id: subject } };
  const signedVrc = await agent.w3cCredentials.signCredential({
    format: ClaimFormat.LdpVc,
    credential: JsonTransformer.fromJSON(vrc, W3cCredential),
    proofType: "Ed25519Signature2018",
    verificationMethod: vpHolder.id.vm,
  });
  const vrcJson = JsonTransformer.toJSON(signedVrc);
  // a credential changed after it was signed: its own proof no longer verifies, while the presentation over it is sound
  if (variant === "tamperedCredential") vrcJson.credentialSubject.id = "did:example:someone-else";
  const vpJson0 = { "@context": ctxs, type: ["VerifiablePresentation"], holder: vpHolder.id.did, verifiableCredential: variant === "noCredential" ? [] : [vrcJson] };
  const challenge = variant === "wrongChallenge" ? "0000000000000000000000000000000f" : String(args.challenge);
  const domain = variant === "wrongDomain" ? "another-witness-domain" : String(args.domain);
  if (variant === "unsigned") return JSON.stringify(vpJson0);
  const signedVp = await agent.w3cCredentials.signPresentation({
    format: ClaimFormat.LdpVp,
    presentation: JsonTransformer.fromJSON(vpJson0, W3cPresentation),
    verificationMethod: vpHolder.id.vm,
    proofType: "Ed25519Signature2018",
    challenge,
    domain,
  });
  const vpJson = JsonTransformer.toJSON(signedVp);
  return JSON.stringify(vpJson);
}

const adapter = {
  async capabilities() {
    return capabilities({ commit: git(WS), bifoldCommit: git(`${KW_ROOT}/bifold`), policy: POLICY, shape: SHAPE, latest: process.env.WIT_ROW === "latest", served: SERVED });
  },
  async provision(roles: string[]) {
    const out: Record<string, unknown> = {};
    for (const r of roles) {
      if (r === "iut") {
        const doc = (await agent.dids.resolve(witnessIdentity.did)).didDocument;
        out.iut = { vid: witnessIdentity.did, didDocument: doc === undefined ? undefined : JSON.parse(JSON.stringify(doc)), transportAddress: "in-process (shim carrier)", keyCustody: "iut" };
      } else {
        const id = identities[r];
        out[r] = { vid: id === undefined ? ed25519Signer(seedOf(0x7f)).did : id.did, transportAddress: "none", keyCustody: "harness" };
      }
    }
    return out;
  },
  async trust() {},
  async setClock(iso: string) {
    setFakeClock(Date.parse(iso));
  },
  async advance(ms: number) {
    clockMs = nowMs() + ms;
  },
  async send(p: { from: { kind: string; vid?: string }; bytes: string }) {
    let document: unknown;
    try {
      document = JSON.parse(p.bytes);
    } catch {
      return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
    }
    if (typeof document !== "object" || document === null || Array.isArray(document) || p.from.kind === "none") return { replies: [], transport: { kind: "refused" }, quiescentAfterMs: 0 };
    const doc = document as Record<string, unknown>;
    outbox = [];
    const theirDid = String(p.from.vid);
    try {
      // The server's own dispatcher: by Type URI to the handler, then the proof on a `#response`, then the send (captured by the shim).
      await sessions.handleDocument(doc, `conn:${theirDid}`, witnessIdentity.did, theirDid, "didcomm-v1");
    } catch (error) {
      // In the server the carrier's handler catches and logs this; the sender sees nothing.
      process.stderr.write(`[witness host] handler threw: ${(error as Error).message}\n`);
    }
    const replies = outbox.map((d) => JSON.stringify(d));
    const id = typeof doc.id === "string" ? doc.id : undefined;
    if (id !== undefined) states.set(id, stateFromReply(outbox[0] === undefined ? undefined : String(outbox[0].type)));
    if (outbox.some((d) => isSessionResponse(String(d.type)) || isSubmitResponse(String(d.type)))) handled++;
    if (outbox.some((d) => isSubmitResponse(String(d.type)))) issued++;
    return { replies, transport: { kind: "document" }, quiescentAfterMs: 0 };
  },
  async trigger(action: string, args: Record<string, unknown>) {
    if (action === "witnessPresentation") return { documents: [JSON.stringify({ vp: await witnessPresentation(args) })] };
    throw new Error(`trigger ${action} is not supported by the witness server`);
  },
  async observe(q: { query: string; id?: string; kind?: string }) {
    switch (q.query) {
      case "handled":
        return { value: handled };
      case "documentState":
        return { value: states.get(q.id!) ?? "unknown" };
      case "stored":
        if (q.kind === "vwc") return { value: issued };
        if (q.kind === "session") return { value: sessions.sessions.size };
        return { value: 0 };
      default:
        throw new Error(`observe ${q.query} is not supported`);
    }
  },
  async restart() {
    throw new Error("restart is not supported (the sessions are in memory)");
  },
  async reset() {
    boot();
  },
  async snapshot() {
    const id = `s${snapshots.size + 1}`;
    snapshots.set(id, fingerprint());
    return id;
  },
  async diff(snapshotId: string) {
    const before = snapshots.get(snapshotId);
    const now = fingerprint();
    return before === now ? { changed: false } : { changed: true, detail: `${before} -> ${now}` };
  },
  async verifyProof() {
    throw new Error("verifyProof is not supported by the witness-server adapter");
  },
};

function readBody(req): Promise<string> {
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

async function main(): Promise<void> {
  await makeAgent();
  boot();
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
        const out = await dispatch(adapter as never, JSON.parse(body));
        const text = JSON.stringify(out);
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) }).end(text);
      } catch {
        if (!res.headersSent) res.writeHead(400).end("bad request");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  if (PORT_FILE) writeFileSync(PORT_FILE, String(port));
  await stopped;
  server.close();
  try {
    await agent.shutdown();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error((err as Error).stack ?? String(err));
    process.exit(2);
  },
);
