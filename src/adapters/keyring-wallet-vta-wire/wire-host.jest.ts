// SPDX-License-Identifier: Apache-2.0
/**
 * @jest-environment node
 *
 * One-shot proof host: the wallet's real VtaClient talks to a live VTA over a real mediator (DIDComm v2, authcrypt, forward, messagepickup).
 * Not a test of this repository; it is a "test" only because the wallet's code runs under its own jest. Run it through driver.ts.
 *   KW_WIRE_VTA_DID, KW_WIRE_MEDIATOR_DID, KW_WIRE_OUT (results.json), KW_WIRE_TRACE, KW_WIRE_DID_FILE, KW_WIRE_GRANTED_FILE
 */
// @ts-nocheck
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { buildWireAgent } from "./wire-agent.ts";
import { kCapabilities } from "./wire-caps.ts";

const SERVE = process.env.KW_WIRE_SERVE === "1";

jest.setTimeout(10 * 60 * 1000);
const env = (k: string) => {
  const v = process.env[k];
  if (v === undefined || v === "") throw new Error(`${k} is not set`);
  return v;
};

/** One scripted step, through the wallet's own VtaClient method (the wallet builds, signs, packs and reads the reply itself). */
async function runOp(client: any, st: any) {
  switch (st.op) {
    case "discovery": {
      const types = await client.supportedTypes();
      return { count: types?.length, sample: types?.slice(0, 5), has: types?.filter((t: string) => (st.expect ?? ["/acl/list/"]).some((e: string) => t.includes(e))).length };
    }
    case "acl-list": {
      const rows = await client.listAcl();
      return { count: rows.length, roles: rows.map((r: any) => r.role), subjects: rows.map((r: any) => String(r.did ?? r.subject).slice(0, 24)) };
    }
    case "acl-grant": return { role: (await client.grantAdmin(st.did, { label: st.label })).role };
    case "acl-label": return { label: (await client.labelAclEntry(st.did, st.label)).label };
    case "acl-revoke": return { removed: (await client.revokeSubject(st.did)) === undefined ? "entry removed" : "answered the entry" };
    case "contexts-list": return { count: (await client.listContexts()).length };
    case "task": return await client.task(st.type, st.payload ?? {}, st.timeoutMs ?? 30000);
    default: throw new Error(`unknown step op ${st.op}`);
  }
}

(SERVE ? it.skip : it)("the wallet's VtaClient exchanges real trust tasks with a VTA over DIDComm v2", async () => {
  // The wallet's jest setup freezes Date.now at 2024-01-01 (jestSetup.js); a real wire needs the real clock (a mediator refuses expired messages).
  jest.restoreAllMocks();
  const { client, trace, agent } = await buildWireAgent({ vtaDid: env("KW_WIRE_VTA_DID"), mediatorDid: env("KW_WIRE_MEDIATOR_DID"), tracePath: process.env.KW_WIRE_TRACE, resolver: process.env.KW_WIRE_RESOLVER === "real" ? "real" : "shim" });
  const result: any = { steps: [] };
  const step = async (name: string, f: () => Promise<any>) => {
    const t = Date.now();
    try {
      const value = await f();
      result.steps.push({ name, ok: true, ms: Date.now() - t, value });
      return value;
    } catch (e: any) {
      result.steps.push({ name, ok: false, ms: Date.now() - t, error: e.message });
      throw e;
    }
  };
  try {
    const did = await step("manager-did", () => client.ensureManagerIdentity());
    writeFileSync(env("KW_WIRE_DID_FILE"), did);
    const granted = env("KW_WIRE_GRANTED_FILE");
    for (let i = 0; i < 300 && !existsSync(granted); i++) await new Promise((r) => setTimeout(r, 200));
    await step("connect", async () => (await client.connect(), { open: client.isConnected }));
    const steps = JSON.parse(process.env.KW_WIRE_STEPS || '[{"op":"discovery"},{"op":"acl-list"}]');
    for (const st of steps) await step(st.name ?? st.op, () => runOp(client, st));
    result.ok = true;
  } catch (e: any) {
    result.ok = false;
    result.error = e.message;
  } finally {
    await client.disconnect().catch(() => undefined);
    await agent.shutdown().catch(() => undefined);
    result.trace = trace.lines.length;
    writeFileSync(env("KW_WIRE_OUT"), JSON.stringify(result, null, 2));
  }
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------- serve mode: the wallet as ceremony participant K (and the wire for V's sends)
// JSON-RPC 2.0 over HTTP POST. The contract methods of the participant K (capabilities, provision, connect, initiate, observe, trigger, reset) and two wire methods
// the V side of the adapter uses: `wire.send` (a document, exactly as given, authcrypted as the wallet's DID and forwarded; the answers it draws) and `wire.discover`.
//   KW_WIRE_SERVE=1, KW_WIRE_VTA_DID, KW_WIRE_MEDIATOR_DID, KW_WIRE_DID_FILE, KW_WIRE_GRANTED_FILE, KW_WIRE_PORT_FILE, KW_WIRE_TRACE, KW_WIRE_RESOLVER, KW_WIRE_INFO (json)
(SERVE ? it : it.skip)("serve the wallet's wire participant until stopped", async () => {
  jest.restoreAllMocks();
  const KW_ROOT = process.env.KW_ROOT ?? "../keyring-wallet";
  const CORE = `${KW_ROOT}/bifold/packages/core`;
  const TT = `${CORE}/src/modules/trust-tasks`;
  const { client, trace, agent, core, tap, forgetManagers } = await buildWireAgent({ vtaDid: env("KW_WIRE_VTA_DID"), mediatorDid: env("KW_WIRE_MEDIATOR_DID"), tracePath: process.env.KW_WIRE_TRACE, resolver: process.env.KW_WIRE_RESOLVER === "real" ? "real" : "shim" });
  let did: string = await client.ensureManagerIdentity();
  writeFileSync(env("KW_WIRE_DID_FILE"), did);
  const granted = env("KW_WIRE_GRANTED_FILE");
  for (let i = 0; i < 600 && !existsSync(granted); i++) await new Promise((r) => setTimeout(r, 200));
  if (!existsSync(granted)) throw new Error("the wallet's DID was not granted on the VTA in time");
  await client.connect();
  const { makeDriver } = require("../keyring-wallet/ceremony-driver");
  const SAMPLE = "did:key:z6MkovJ72De5cDPYw4vLs6FpFRfdh18Lkyx46PKH9j7QekKz";
  // the wallet's manager DID is a did:peer:2 (not a did:key): the key its proofs are made with is the one its document lists under `authentication`, and the KMS holds it under its own id.
  // The community leg (vtiAgent, as a persona) names both; they are read again after every new manager DID (reset).
  let signKeys = { kms: did, vm: "" };
  const readSignKeys = async (d: string) => {
    const doc: any = (await agent.dids.resolveDidDocument(d)).toJSON();
    const first = doc.authentication?.[0];
    const ref = typeof first === "string" ? first : first?.id;
    const rel = String(ref).startsWith(d) ? String(ref).slice(d.length) : String(ref);
    const [rec] = await agent.dids.getCreatedDids({ did: d });
    const kms = rec?.keys?.find((k: any) => k.didDocumentRelativeKeyId === rel)?.kmsKeyId;
    signKeys = { kms: kms ?? d, vm: `${d}${rel}` };
  };
  await readSignKeys(did);
  const driver = makeDriver({ tt: TT, core: CORE, require, agent: () => agent, get did() { return did; }, get didKeyId() { return signKeys.kms; }, get personaVm() { return signKeys.vm; }, sampleSubject: SAMPLE, successor: () => { throw new Error("key swap is not carried on this row (the successor session needs a second mediator login)"); }, uvSigner: () => { throw new Error("no UV key on this row"); }, wire: { client, clientFor: (r: string) => clientFor(r) } });
  const TASK = "https://trusttasks.org/binding/didcomm/0.1/envelope";
  const isDoc = (b: any) => b !== null && typeof b === "object" && typeof b.type === "string" && "payload" in b;
  // raw sends wait for the answers on their thread
  const waiters: { ids: Set<string>; docs: any[]; wake: () => void }[] = [];
  tap.onSend = (_to: string, pt: any) => { if (isDoc(pt?.body)) driver.tapSent(pt.body); };
  // FC-KVC, the approver's side: what the executor (the VTA) pushed to this wallet over the wire. A request is kept only from an executor this wallet was enrolled with
  // (`trigger enrolExecutor`), as the wallet's own approver path does; the decision is then built, signed and sent by the wallet's own `VtaClient.decideConsent`.
  const CONSENT_REQUEST = "https://trusttasks.org/spec/task-consent/request/0.1";
  const kv = { enrolled: new Set<string>(), inbox: [] as { from: string; thread: string; doc: any; text: string }[], cex: new Map<string, string>(), replies: [] as any[] };
  // every Trust Task document that reaches the wallet over the wire since the last reset (a community's pushes among them: `wire.inbound`)
  const inbound: any[] = [];
  tap.onReceive = (pt: any) => {
    if (!isDoc(pt?.body)) return;
    inbound.push(JSON.parse(JSON.stringify(pt.body)));
    if (pt.body.type === CONSENT_REQUEST && kv.enrolled.has(String(pt.body.issuer))) kv.inbox.push({ from: String(pt.body.issuer), thread: String(pt.body.id), doc: pt.body, text: JSON.stringify(pt.body) });
    driver.tapReceived(pt.body);
    // a community's answer (not the agent's) goes to the wallet's own community controller too
    if (String(pt.from) !== env("KW_WIRE_VTA_DID")) { try { driver.agentDeliver(pt); } catch { /* the VTA client has it as well */ } }
    for (const c of others.values()) { try { c.deliver(pt); } catch { /* the main client has it too */ } }
    for (const w of waiters) if ([pt.thid, pt.pthid, pt.body?.threadId].some((x) => typeof x === "string" && w.ids.has(x))) { w.docs.push(pt.body); w.wake(); }
  };
  // A misaddressed document (FC-ACL-007): a second VtaClient names another agent as the recipient of what it signs, but its session is the real one and
  // everything is sent to the real VTA (the wallet builds, signs and packs; only the destination is the real agent's). Its answers come back through the same session.
  const { VtaClient } = require(`${TT}/module/VtaClient`);
  const others = new Map<string, any>();
  const clientFor = (recipient: string) => {
    if (recipient === env("KW_WIRE_VTA_DID")) return client;
    let c = others.get(recipient);
    if (c === undefined) {
      c = new VtaClient(agent, recipient, { getManager: async () => undefined, setManager: async () => undefined }, client.options);
      c.mediator = client.mediator;
      const real = client.session;
      c.session = { isOpen: true, sendTo: (_to: string, pt: any) => real.sendTo(env("KW_WIRE_VTA_DID"), { ...pt, to: [env("KW_WIRE_VTA_DID")] }), stop: async () => undefined };
      c.identity = client.identity;
      c.managerDid = client.managerDid ?? did;
      c.carriageByPeer.set(recipient, "didcomm");
      c.replyThreading = "threaded";
      others.set(recipient, c);
    }
    return c;
  };
  // The community leg (the VTC): the wallet's own VtaClient code builds, signs (the wallet's own proof) and packs the Trust Task; its destination is the community, over the same real
  // mediator session. (VtaClient is the wallet's client for a VTA; a community takes the same signed DIDComm binding envelope.)
  const communityClient = (community: string) => {
    let c = others.get(`community:${community}`);
    if (c === undefined) {
      c = new VtaClient(agent, community, { getManager: async () => undefined, setManager: async () => undefined }, client.options);
      c.mediator = client.mediator;
      const real = client.session;
      c.session = { isOpen: true, sendTo: (_to: string, pt: any) => real.sendTo(community, { ...pt, to: [community] }), stop: async () => undefined };
      c.identity = client.identity;
      c.managerDid = client.managerDid ?? did;
      c.carriageByPeer.set(community, "didcomm");
      c.replyThreading = "threaded";
      others.set(`community:${community}`, c);
    }
    return c;
  };
  const info = JSON.parse(process.env.KW_WIRE_INFO || "{}");
  const walletDoc = async () => { try { return JSON.parse(JSON.stringify((await agent.dids.resolveDidDocument(did)).toJSON())); } catch { return { id: did }; } };
  const rawSend = async (bytes: string, peer: string = env("KW_WIRE_VTA_DID")) => {
    const doc = JSON.parse(bytes);
    const threadId = String(doc.threadId ?? doc.id);
    const w = { ids: new Set([threadId, String(doc.id)]), docs: [] as any[], wake: () => undefined as void };
    const first = new Promise<void>((r) => (w.wake = r));
    waiters.push(w);
    const now = Math.floor(Date.now() / 1000);
    await client.sendTo(peer, { id: `urn:uuid:${core.utils.uuid()}`, typ: "application/didcomm-plain+json", type: TASK, from: did, to: [peer], thid: threadId, created_time: now, expires_time: now + 300, body: doc });
    await Promise.race([first, new Promise((r) => setTimeout(r, 15000))]);
    await new Promise((r) => setTimeout(r, 400));
    waiters.splice(waiters.indexOf(w), 1);
    return w.docs.map((d) => JSON.stringify(d));
  };
  const methods: Record<string, (p: any) => Promise<unknown>> = {
    capabilities: async () => kCapabilities({ walletCommit: info.walletCommit ?? "unknown", resolver: process.env.KW_WIRE_RESOLVER === "real" ? "real" : "shim", kinds: driver.kinds() }),
    provision: async () => ({ peer: { vid: did, didDocument: await walletDoc(), transportAddress: "didcomm:mediator", keyCustody: "iut" } }),
    connect: async () => ({ connected: client.isConnected, detail: "the wallet's session on the mediator is open" }),
    // a scenario starts with a fresh session on the mediator and the VTA: a step-up elevates the session (acr aal2), and that must not carry into the next scenario
    // The VTA keeps a step-up elevation per DID for a while, across reconnects and a re-granted entry: only a new identity starts a scenario unelevated. The wallet therefore mints
    // a new manager DID (its own ensureManagerIdentity, as for a new link) and logs in as it; the V side of the adapter grants it on the VTA's access list (V.reset).
    // A new phone for the card vault too: the wallet remembers which cards it has already kept (an Askar record and a module cache), and a keep it believes done sends nothing.
    reset: async () => {
      driver.reset();
      inbound.length = 0;
      kv.enrolled.clear(); kv.inbox.length = 0; kv.cex.clear(); kv.replies.length = 0;
      others.clear();
      for (const r of await agent.genericRecords.findAllByQuery({ recordType: "keyring/vti-card-vault" })) await agent.genericRecords.delete(r);
      require(`${TT}/module/vtiCardVault`).resetCardVaultCache();
      await client.disconnect();
      forgetManagers();
      did = await client.ensureManagerIdentity();
      await readSignKeys(did);
      await client.connect();
      return null;
    },
    initiate: async (p) => {
      if (p.kind !== "consent-decision") return driver.initiate(p);
      // the wallet's own approver path over the real wire: find the request the VTA pushed, decide it (the wallet builds, signs, packs, sends and reads the answer)
      const req = [...kv.inbox].reverse().find((e) => e.thread === p.thread || e.doc.threadId === p.thread) ?? [...kv.inbox].reverse()[0];
      if (req === undefined) throw new Error("initiate consent-decision: no task-consent request reached the wallet over the wire");
      // a document changed after it was signed needs the signer's key, which the wallet keeps: the harness cannot make one on this wire (class D, not reached)
      if (p.args?.tamper !== undefined || p.args?.repeat === true) throw new Error(`not offered by the wire row: a ${p.args?.tamper !== undefined ? `tampered (${String(p.args.tamper)})` : "repeated"} decision (the wallet signs and sends its own decisions; the harness cannot alter or replay one)`);
      const decision = p.args?.decision === "deny" ? "deny" : "approve";
      try {
        const ans = await client.decideConsent({ challenge: req.doc.payload.challenge, payloadDigest: req.doc.payload.payloadDigest }, decision);
        kv.replies.push({ thread: req.thread, answer: ans });
        kv.cex.set(req.thread, ans?.status === "granted" ? "completed" : ans?.status === "denied" ? "aborted" : ans?.status === "pending" ? "held" : "open");
      } catch (e: any) {
        kv.replies.push({ thread: req.thread, error: String(e?.code ?? ""), message: String(e?.message ?? e) });
        kv.cex.set(req.thread, "refused");
      }
      if (p.thread !== undefined && p.thread !== req.thread) kv.cex.set(p.thread, kv.cex.get(req.thread) as string);
      return { threadId: p.thread ?? req.thread, documents: [], sent: true };
    },
    // what the wallet's last call returned (or why it threw), for the community leg (join-manifest, join-apply): the wallet's own result, as JSON
    "wire.lastResult": async () => { try { return JSON.parse(JSON.stringify(driver.lastResult() ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v))); } catch { return String(driver.lastResult()); } },
    "wire.kvReceived": async () => kv.inbox.map((e) => e.text),
    "wire.inbound": async () => inbound,
    "wire.kvReplies": async () => kv.replies,
    observe: async (q) => {
      if (q.query === "ceremony" && q.threadId !== undefined && kv.cex.has(String(q.threadId))) return { value: kv.cex.get(String(q.threadId)) };
      if (q.query === "received" && (q.type === CONSENT_REQUEST || kv.inbox.some((e) => e.thread === q.threadId))) {
        const docs = kv.inbox.filter((e) => (q.threadId === undefined || e.thread === q.threadId || e.doc.threadId === q.threadId) && (q.from === undefined || e.from === q.from)).map((e) => e.text);
        return { value: docs.length, documents: docs };
      }
      if (q.query === "ceremony") { const st = driver.state(String(q.threadId)); return { value: st === "refused" || st === "aborted" ? "refused" : st, documents: [driver.detail(String(q.threadId))] }; }
      if (q.query === "received") { const docs = driver.received(q.threadId === undefined ? undefined : String(q.threadId)).filter((d: any) => (q.type === undefined || d.type === q.type) && (q.from === undefined || d.issuer === q.from)); return { value: docs.length, documents: docs.map((d: any) => JSON.stringify(d)) }; }
      if (q.query === "stored") {
        if (q.kind === "restored-cards") { const r = driver.lastResult(); return { value: Array.isArray(r) ? r.filter((x: any) => x?.credential).length : 0 }; }
        if (q.kind === "step-up-asked") return { value: driver.stepUpAsked() };
        // the community leg: what the wallet's own status poll last read (the wallet's own record of the community's answer)
        if (q.kind.startsWith("join-status:")) { const r: any = driver.lastResult(); return { value: r?.status === q.kind.slice(12) ? 1 : 0 }; }
        if (q.kind === "join-status-not-misleading") { const r: any = driver.lastResult(); return { value: r === undefined || r?.status === "rejected" ? 1 : 0 }; }
        if (q.kind.startsWith("join-status-reason:")) { const r: any = driver.lastResult(); return { value: r?.reason === q.kind.slice(19) ? 1 : 0 }; }
        return { value: 0 };
      }
      throw new Error(`unsupported observe ${q.query}`);
    },
    trigger: async (p) => {
      if (p.action === "enrolExecutor") { kv.enrolled.add(String(p.args?.vid ?? p.vid)); return { documents: [] }; }
      throw new Error(`not offered by the wire row: the wire participant has no trigger ${p.action}${p.action === "clockOffset" ? " (a real wire has real time)" : ""}`); },
    "wire.send": async (p) => ({ replies: await rawSend(p.bytes) }),
    // the community leg: a Trust Task document (unsigned read: over DIDComm the transport names the sender) packed by the wallet's session and sent to a community (the VTC) through the mediator
    // a signed Trust Task to a community through the wallet's own client: the answer (or the refusal, as `error`) the wallet read
    "wire.communityTask": async (p) => {
      try { return { answer: await communityClient(p.to).task(p.type, p.payload ?? {}, p.timeoutMs ?? 30000) }; } catch (e: any) { return { error: String(e?.code ?? e?.name ?? "error"), message: String(e?.message ?? e) }; }
    },
    "wire.sendTo": async (p) => ({ replies: await rawSend(p.bytes, p.to) }),
    "wire.discover": async () => (await client.supportedTypes()) ?? [],
    "wire.sent": async () => driver.sent(),
    // what the agent's vault holds for the wallet's identity (the vault is the caller's): counted, or emptied between scenarios (purge: irrecoverable, the harness's own cards only)
    "wire.vault": async (p) => {
      const SPEC = "https://trusttasks.org/spec/vault/credentials/";
      // the same questions the wallet asks (AGENT_CARD_QUERIES): the vault refuses an unfiltered query
      const ids = new Set<string>();
      for (const q of [{ purpose: "membership" }, { purpose: "role" }, { purpose: "endorsement" }, { type: "AuthorityCredential" }]) {
        const a: any = await client.task(`${SPEC}query/0.1`, q);
        for (const d of a?.credentials ?? []) if (typeof d.id === "string") ids.add(d.id);
      }
      if (p.op === "clear") for (const id of ids) await client.task(`${SPEC}purge/0.1`, { id, reason: "wire row: end of scenario" });
      return { count: ids.size };
    },
  };
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((r) => (stop = r));
  let chain: Promise<void> = Promise.resolve();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      chain = chain.then(async () => {
        if (req.url === "/shutdown") { res.writeHead(200).end("bye"); stop(); return; }
        let id: unknown = null;
        try {
          const rpc = JSON.parse(body);
          id = rpc.id ?? null;
          const f = methods[rpc.method];
          const out = f === undefined ? { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${rpc.method}` } } : { jsonrpc: "2.0", id, result: (await f(rpc.params ?? {})) ?? null };
          const text = JSON.stringify(out);
          res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) }).end(text);
        } catch (e: any) {
          const text = JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: String(e?.message ?? e) } });
          if (!res.headersSent) res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(text) }).end(text);
        }
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  writeFileSync(env("KW_WIRE_PORT_FILE"), String((server.address() as any).port));
  await stopped;
  server.close();
  await client.disconnect().catch(() => undefined);
  await agent.shutdown().catch(() => undefined);
  trace.log({ dir: "host", kind: "stopped" });
});
