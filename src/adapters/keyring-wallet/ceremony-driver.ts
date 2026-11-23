// SPDX-License-Identifier: Apache-2.0
/**
 * Ceremony driver for the keyring-wallet jest host (docs/26). The wallet's own request code (VtaClient, vtaDevices, vtiCardVault, stepUp,
 * oobSignIn) runs for real over a session that is carried by the scenario runner instead of a network: `sendTo` hands the signed document to
 * the runner (`initiate` returns it unsent), and the answer comes back through `deliver` (the runner's `send` to the wallet), after which the
 * wallet's code carries on by itself. A version refusal therefore walks the wallet's own step-down: the next rung's document is returned by
 * `deliver` and the runner relays it (`InitiateResult.continues`).
 *
 * Nothing here builds, signs or edits a Trust Task document. What is a stand-in (class D) is named where it is used: the persona agent that
 * signs `identify` and `grant` for the sign-in, the successor key of a key swap, the did:key in place of a did:peer. The wallet checks every
 * answer as it does in the app.
 */
type Doc = Record<string, any>;

export interface DriverCtx {
  tt: string;
  core: string;
  require: (p: string) => any;
  agent: () => any;
  did: string;
  didKeyId: string;
  /** The verification method id the persona's proofs name, where it is not `<did>#<didKeyId>` (a did:peer:2 manager DID: wire mode). */
  personaVm?: string;
  sampleSubject: string;
  successor: () => { did: string; keyId: string; publicKey: Uint8Array };
  uvSigner: () => { did: string; sign: (b: Uint8Array) => Uint8Array };
  /**
   * Wire mode (keyring-wallet-vta-wire): `client` is a VtaClient whose session is the wallet's real mediator session, so the wallet itself sends and reads
   * every document over a real DIDComm v2 wire. `initiate` then runs the wallet's call to its end and returns the documents that went out (`sent: true`);
   * the host reports what crossed the wire through `tapSent` and `tapReceived`.
   */
  wire?: { client: any; clientFor?: (recipient: string) => any; timeoutMs?: number };
}

export type FlowState = "open" | "completed" | "refused" | "aborted";

interface Flow {
  id: string;
  kind: string;
  state: FlowState;
  detail: string;
  outbound: string[];
  sent: Doc[];
  received: Doc[];
  /** Resolves a pending wait for progress. */
  wake?: () => void;
  /** A `post` made by the wallet's sign-in code waits here for the answer the runner delivers. */
  postWaiter?: (doc: Doc) => void;
  result?: unknown;
  /** `agent`: the call goes through the wallet's community controller (vtiAgent), whose answers are read by its own `deliver`. */
  via?: "agent";
}

const PROGRESS_MS = Number(process.env.KW_CEREMONY_PROGRESS_MS ?? 30000);

export function makeDriver(ctx: DriverCtx) {
  const req = ctx.require;
  const { VtaClient } = req(`${ctx.tt}/module/VtaClient`);
  const { VtiRefusal } = req(`${ctx.tt}/module/vtiAgent`);
  const devices = req(`${ctx.tt}/module/vtaDevices`);
  const flows = new Map<string, Flow>();
  let active: Flow | undefined;
  let client: any;
  let clientFor = "";
  let n = 0;

  // getters: the wire host mints a new manager DID at every reset, and the persona is always the current one
  const persona = { get did() { return ctx.did; }, contextId: "ceremony-context", kmsKeyIds: { get signing() { return ctx.didKeyId; }, get keyAgreement() { return ctx.didKeyId; } }, vtaKeyIds: { get signing() { return ctx.personaVm ?? `${ctx.did}#${ctx.didKeyId}`; } } };

  const touch = (f: Flow) => {
    const w = f.wake;
    f.wake = undefined;
    w?.();
  };
  const session = {
    isOpen: true,
    sendTo: async (_to: string, msg: { body: Doc }) => {
      const f = active;
      if (f === undefined) return;
      const doc = JSON.parse(JSON.stringify(msg.body));
      f.sent.push(doc);
      f.outbound.push(JSON.stringify(doc));
      touch(f);
    },
    // after a key swap the wallet closes its session and reopens it as the successor: here there is nothing to close
    stop: async () => undefined,
    sendTspFrame: async () => {
      throw new Error("the ceremony driver carries DIDComm documents only");
    },
  };

  /** The person's answer to the agent's step-up request on this phone (the wallet asks `onStepUp`): set per flow by `args.stepUp`. */
  let stepUpDecision: "approve" | "deny" = "approve";
  const stepUpAsked: unknown[] = [];
  const clientOptions = { onStepUp: async (request: unknown, context: unknown) => { stepUpAsked.push({ request, context }); return stepUpDecision; } };
  // wire mode: the person's answer to a step-up request reaches the real client through its options, as in the app (`onStepUp`)
  if (ctx.wire !== undefined) ctx.wire.client.options = { ...ctx.wire.client.options, ...clientOptions };
  function clientOf(recipient: string, as?: string): any {
    if (ctx.wire !== undefined) return ctx.wire.clientFor !== undefined ? ctx.wire.clientFor(recipient) : ctx.wire.client;
    const asKey = as === "successor" ? ctx.successor().did : ctx.did;
    if (client !== undefined && clientFor === `${recipient}|${asKey}`) return client;
    const c = new VtaClient(ctx.agent(), recipient, { getManager: async () => undefined, setManager: async () => undefined }, clientOptions);
    c.mediator = { did: "did:web:mediator.example", wsEndpoint: "wss://mediator.example/ws", httpEndpoint: "https://mediator.example" };
    c.session = session;
    c.identity = { did: asKey };
    c.managerDid = asKey;
    c.carriageByPeer.set(recipient, "didcomm");
    c.replyThreading = "threaded";
    client = c;
    clientFor = `${recipient}|${asKey}`;
    return c;
  }

  /** Wait until the flow has a document to send or has ended (bounded). */
  async function progress(f: Flow): Promise<void> {
    if (f.outbound.length > 0 || f.state !== "open") return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        f.wake = undefined;
        resolve();
      }, PROGRESS_MS);
      f.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  type Kind = (c: any, args: Record<string, any>, f: Flow) => Promise<unknown>;
  const SPEC = "https://trusttasks.org/spec/";
  const cardVault = req(`${ctx.tt}/module/vtiCardVault`);
  const oob = req(`${ctx.tt}/module/oobSignIn`);
  const oobAgent = req(`${ctx.tt}/module/oobSignInAgent`);
  const proofs = req(`${ctx.tt}/documentProof`);
  /** Sign-in state across the steps of one ceremony: what the wallet's own claim and prove returned. */
  const signIn: { claimed?: any; proved?: any } = {};
  /** Class D: the community's DID document with the services a sign-in reads (a did:key cannot carry them; a deployed community publishes a did:webvh that does). */
  const communityDoc = (did: string) => ({ id: did, verificationMethod: [{ id: `${did}#${did.slice(8)}`, type: "Multikey", controller: did, publicKeyMultibase: did.slice(8) }], authentication: [`${did}#${did.slice(8)}`], assertionMethod: [`${did}#${did.slice(8)}`], service: [{ id: `${did}#tt`, type: "TrustTaskHTTPS", serviceEndpoint: "https://community.example" }, { id: `${did}#portal`, type: "SignInPortal", serviceEndpoint: "https://portal.example/" }] });
  /** The wallet's POST of a sign-in document: handed to the runner, and answered by what it delivers back. */
  const post = (_url: string, document: Doc): Promise<unknown> => {
    const f = active;
    if (f === undefined) return Promise.reject(new Error("no ceremony flow is running"));
    f.sent.push(JSON.parse(JSON.stringify(document)));
    f.outbound.push(JSON.stringify(document));
    const answer = new Promise<unknown>((resolve) => { f.postWaiter = resolve as (d: Doc) => void; });
    touch(f);
    return answer;
  };
  const docs = new Map<string, Doc>();
  const resolveDid = async (did: string) => docs.get(did) ?? communityDoc(did);
  /** Class D: the member's agent, standing in for vault/sign-trust-task (signs identify and grant as the persona with the wallet identity's key). The wallet checks what it returns. */
  const standInAgent = (vtaDid: string) => ({
    did: vtaDid,
    signTrustTask: async (request: Doc) => proofs.signDocumentProof(ctx.agent(), request.unsignedEnvelope, ctx.did, { proofPurpose: String(request.unsignedEnvelope.type).includes("/grant/") ? "assertionMethod" : "authentication" }),
    vaultList: async () => [], vaultUpsert: async () => ({}), sealVaultSecret: async () => ({}), heartbeat: async () => undefined, register: async () => "registered",
  });
  /** The community controller (join, vetting directory) on the same capture: its own `ask` builds, signs and addresses the document (taskDocument) and reads the answer. */
  const { vtiAgent } = req(`${ctx.tt}/module/vtiAgent`);
  // The member's acknowledgement of its membership (vtc/members/vmc): the wallet's own builders, store reads and sender. The store is in memory (class D: the wallet's records are a stand-in for its
  // generic-records store); what it holds comes from the credential delivery the wallet's own inbox code (`receiveIssue`) keeps, so the wallet owes an acknowledgement only for a membership it was given.
  const memberVmc = req(`${ctx.tt}/module/vtiMemberVmc`);
  const reciprocateMod = req(`${ctx.tt}/module/vtiReciprocate`);
  const inboxMod = req(`${ctx.tt}/module/vtiInbox`);
  const held = { memberships: new Map<string, any>(), cards: [] as any[] };
  const memberStore = {
    getMembership: async (community: string, personaDid?: string) => held.memberships.get(`${community}|${personaDid ?? ctx.did}`),
    listMemberships: async () => [...held.memberships.values()],
    saveMembership: async (m: any) => { held.memberships.set(`${m.communityDid}|${m.personaDid}`, m); },
    saveHeldCredential: async (i: any) => { held.cards.push(i); },
    listHeldCredentials: async () => held.cards,
    getSubmission: async () => (lastRequestId === undefined ? undefined : { requestId: lastRequestId }),
  };
  /** The card check of the wallet's inbox (time window, then the issuer's proof) without the status-list read: the harness hosts no status list at the URL a card names (class D). */
  const cardCheck = async (credential: Doc, issuer: string): Promise<string | undefined> => {
    const now = Date.now(), from = Date.parse(String(credential.validFrom ?? "")), until = Date.parse(String(credential.validUntil ?? ""));
    if (Number.isFinite(from) && from > now + 60000) return "notYetValid";
    if (Number.isFinite(until) && now > until + 60000) return "expired";
    return (await req(`@bifold/trust-tasks`).verifyDocumentProof(ctx.agent(), credential, issuer)) ? undefined : "proof";
  };
  const agentPrep = (f: Flow, a?: Record<string, any>) => {
    f.via = "agent";
    // wire mode: the community leg rides the wallet's real mediator session too (the community's answers come back through `agentDeliver`)
    // A misaddressed application (`args.recipient`, FC-MBR-008): the document names another community, but only the real one is on the wire, so the session delivers to it
    // (the wallet builds, signs and addresses the document; only the destination is the real community's, as for FC-ACL-007; class D).
    const real = ctx.wire?.client.session;
    vtiAgent.session = ctx.wire === undefined ? session : a?.recipient !== undefined && a._to !== undefined && real !== undefined ? { isOpen: true, sendTo: (_to: string, pt: any) => real.sendTo(String(a._to), { ...pt, to: [String(a._to)] }), stop: async () => undefined } : real;
    vtiAgent.state = { status: "connected", did: ctx.did };
    vtiAgent.agent = ctx.agent();
    vtiAgent.persona = persona;
    vtiAgent.asks?.clear?.();
  };
  /** Class D: the person was shown the directory statement the manifest carries (manifest 0.4) and kept it; the wallet sends nothing under a statement the person was not shown. */
  /** The community a call is addressed to: `args.recipient` (a misaddressed application) or the peer. */
  const to = (a: Record<string, any>): string => String(a.recipient ?? a._to);
  /** The request id the community minted for this applicant's latest application, as the wallet keeps it from the submit answer and polls with it. */
  let lastRequestId: string | undefined;
  const seen = (m: any) => m?.directoryDisclosure?.statementDigest;
  /** Directory (docs/31): the wallet's own service over the community controller; what each call last read is kept here for the host's observe. */
  /** Elections reads (docs/31): the newest type both sides serve; what the last read showed is kept for the host's observe. */
  const vote: { polls?: number; refused?: string; version?: string } = {};
  const voteAsk = async (types: string[], community: string, payload: Record<string, unknown>, what: string) => {
    const seenTypes = [...new Set(types)];
    for (let i = 0; i < seenTypes.length; i++) {
      try {
        const r: any = await vtiAgent.communityTask(community, seenTypes[i], payload);
        vote.version = seenTypes[i]!.slice(seenTypes[i]!.lastIndexOf("/") + 1);
        if (what === "polls") vote.polls = Array.isArray(r?.elections) ? r.elections.length : undefined;
        return r;
      } catch (e: any) {
        if (e?.name === "VtiRefusal" && e.code === "unsupportedVersion" && i + 1 < seenTypes.length) continue;
        if (e?.name === "VtiRefusal") vote.refused = String(e.code).slice(String(e.code).lastIndexOf(":") + 1);
        throw e;
      }
    }
  };
  /** Rooms (docs/32): what each call last read, for the host's `observe stored` (`roomsStoredKind`). The credentials an offer carried are kept to be presented on the member's own writes (class D: the agent's `rooms/keys/act` attaches them in the app). */
  const rooms: Record<string, any> = {};
  const roomsKept: { roomId?: string; creds?: { invitation: string; membership: string; authority: string } } = {};
  const roomsWire = () => req(`${ctx.tt}/../rooms/real/wire`);
  const roomsTail = (c: unknown): string => String(c).slice(String(c).lastIndexOf(":") + 1);
  /** The wallet's own ladder: a version refusal means the question was not taken, so the next type is asked; any other refusal is kept by the tail of its code. Returns the answer and the type that served it. */
  const roomsLadder = async (types: string[], run: (type: string) => Promise<any>): Promise<{ answer: any; type: string }> => {
    for (let i = 0; i < types.length; i++) {
      try { return { answer: await run(types[i]!), type: types[i]! }; } catch (e: any) {
        if (e?.name === "VtiRefusal" && e.code === "unsupportedVersion" && i + 1 < types.length) continue;
        if (e?.name === "VtiRefusal") rooms.refused = roomsTail(e.code);
        throw e;
      }
    }
    throw new Error("no type to ask");
  };
  const roomsPresentation = (a: Record<string, any>): Record<string, unknown> | undefined => {
    if (a.presentation === "none" || roomsKept.creds === undefined) return undefined;
    const spoil = (cred: string): string => { try { const j = JSON.parse(cred); if (j?.credentialSubject !== undefined) j.credentialSubject.id = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"; return JSON.stringify(j); } catch { return `${cred}x`; } };
    const m = a.presentation === "foreign" ? spoil(roomsKept.creds.membership) : roomsKept.creds.membership;
    const au = a.presentation === "foreign" ? spoil(roomsKept.creds.authority) : roomsKept.creds.authority;
    return { membership: m, authority: [au] };
  };
  const dir: Record<string, any> = {};
  const ballot: { outcome?: string; leaf?: number; refused?: string; receipts?: number } = {};
  const personaState: { minted?: any } = {};
  const dirKnown = new Map<string, string>();
  const dirService = (f: Flow) => {
    agentPrep(f);
    const { AgentDirectoryService } = req(`${ctx.tt}/../directory/directoryService`);
    return new AgentDirectoryService({ communityTask: (did: string, type: string, payload: Record<string, unknown>) => vtiAgent.communityTask(did, type, payload) });
  };
  /** A directory refusal is the wallet's `DirectoryRefused`; surfaced as the refusal the flow reports, and kept by code for `dir-refused:<code>`. */
  const dirCall = async (run: () => Promise<any>): Promise<any> => {
    try { return await run(); } catch (e: any) {
      if (e?.name === "DirectoryRefused") { dir.refused = e.code; throw new VtiRefusal(e.code, e.message); }
      throw e;
    }
  };
  const dirRows = (rows: any[]) => { dir.rows = rows.map((r) => ({ entryId: r.entryId, name: r.name?.text ?? r.name })); for (const r of dir.rows) if (r.name !== undefined) dirKnown.set(r.name, r.entryId); };
  const dirSeen = (card: any) => {
    dir.none = card === undefined;
    dir.seen = card === undefined ? [] : [...(card.name === undefined ? [] : ["displayName"]), ...(card.role === undefined ? [] : ["role"]), ...(card.picture === undefined ? [] : ["avatar"]), ...card.entries.map((e: any) => e.key)];
    dir.seenName = card?.name?.text ?? card?.name;
  };
  const applyJoin = async (a: Record<string, any>, f: Flow) => {
    agentPrep(f, a);
    // wire mode: the criteria are read from the real community (the misaddressed one has no manifest to read, nor a wire path)
    const m0 = await vtiAgent.fetchManifest(ctx.wire !== undefined ? String(a._to) : to(a), ctx.agent());
    // `args.wire` makes the wallet speak a submit version it would not choose (an older community's), to walk its own refusal handling
    const m = typeof a.wire === "string" ? { ...m0, wire: a.wire } : m0;
    const crit = (m.criteria ?? []).find((x: any) => x.id === (a.criterion ?? "review"));
    const verdict = await vtiAgent.apply(to(a), m, { requirementsDigest: crit?.requirementsDigest, registryConsent: a.consent === true, disclosureSeen: seen(m) });
    lastRequestId = verdict?.requestId;
    return verdict;
  };
  const FOREIGN_HOLDER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
  const kinds: Record<string, Kind> = {
    // ---- community join (vtiAgent: fetchManifest, apply, status, withdraw, supplement). The community is `_to`; the wallet's own version step-down and refusal reading run.
    "join-manifest": async (_c, a, f) => { agentPrep(f); return vtiAgent.fetchManifest(to(a), ctx.agent()); },
    "join-apply": async (_c, a, f) => applyJoin(a, f),
    // FC-ONB-007 / FC-MBR-013 (class D stand-in): the wallet builds only its own presentation, so the driver has the wallet's own VP builder name another holder (a DID that is not the signer of the document); the wallet's own apply, version ladder and sender do the rest, and the community must refuse it (presentationInvalid).
    "join-apply-foreign": async (_c, a, f) => {
      const orig = vtiAgent.presentation;
      vtiAgent.presentation = function (this: unknown, c?: unknown[]) { return { ...orig.call(this, c), holder: FOREIGN_HOLDER }; };
      try { return await applyJoin(a, f); } finally { vtiAgent.presentation = orig; }
    },
    // the poll names the request it holds the id of (the wallet's own `status` option); `args.idless` polls as a wallet whose first answer was lost would
    "join-status": async (_c, a, f) => { agentPrep(f); const id = a.requestId ?? (a.idless === true ? undefined : lastRequestId); return vtiAgent.status(to(a), id === undefined ? {} : { requestId: String(id) }); },
    // the member's acknowledgement (vtiReciprocate.reciprocateIfOwed: the wallet's own check that it holds a membership, its own VMC builder and sender). The community asked (solicit-vmc), so it is sent again if sent before (`force`).
    // `args.unsolicited`: the member delivers before any membership is held (the task allows it): the wallet never does (it owes nothing), so the driver builds the acknowledgement of a stand-in grant with the wallet's own builder and signs and sends it with the wallet's own sender, carrying the request id (class D).
    "join-vmc": async (_c, a, f) => {
      agentPrep(f);
      const community = to(a);
      if (a.unsolicited === true) {
        const grant = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential", "DTGCredential", "MembershipCredential"], id: "urn:uuid:00000000-0000-4000-8000-0000000000a1", issuer: community, issuerScope: "public", validFrom: "2026-01-01T00:00:00Z", credentialSubject: { id: ctx.did } };
        const vc = await memberVmc.signMemberVmc(ctx.agent(), persona, memberVmc.buildMemberVmc(grant, ctx.did));
        return vtiAgent.sendMemberVmc(community, vc, lastRequestId);
      }
      const out = await reciprocateMod.reciprocateIfOwed(ctx.agent(), memberStore, persona, community, { force: true, sessionDid: () => ctx.did, send: (c: string, vc: Doc, r?: string) => vtiAgent.sendMemberVmc(c, vc, r) });
      if (out !== "acknowledged" && out !== "alreadyAcknowledged") throw new Error(`the wallet did not acknowledge its membership (${String(out)}): it holds no membership the community delivered`);
      return out;
    },
    "join-withdraw": async (_c, a, f) => { agentPrep(f); return vtiAgent.withdraw(to(a), { ...(a.requestId === undefined ? {} : { requestId: String(a.requestId) }), ...(a.reason === undefined ? {} : { reason: String(a.reason) }) }); },
    // ---- vetter profile (vtiVetting VtiVetterDesk.publishProfile): the wallet's own builder, schema check and signed send. Its stores are in memory (class D: the person's choices are sample inputs).
    "vetter-profile": async (_c, a, f) => {
      agentPrep(f);
      const vetting = req(`${ctx.tt}/module/vtiVetting`);
      const store: Doc = { getApplication: async () => undefined, saveApplication: async () => undefined, listDesk: async () => [], saveDesk: async () => undefined, listTickets: async () => [], saveTicket: async () => undefined, getProfile: async () => undefined, saveProfile: async () => undefined, forget: async () => undefined, clearDesk: async () => undefined };
      const desk = new vetting.VtiVetterDesk(ctx.agent(), { ...persona, communityDid: a._to }, store, { listMemberships: async () => [], listHeldCredentials: async () => [] }, undefined);
      await desk.publishProfile({ listed: a.listed !== false, displayName: "Ceremony vetter" });
      return "published";
    },
    // ---- member directory (AgentDirectoryService over the same community controller): the wallet's own requests and parsers. `dirState` keeps what each call last read for the host's `observe stored`.
    "dir-my-card": async (_c, a, f) => {
      const svc = dirService(f);
      const card = await dirCall(() => svc.showMyCard(to(a)));
      const fields = await dirCall(() => svc.cardFields(to(a), card));
      dir.card = { revision: card.revision, name: card.name?.text ?? card.name, missing: [...card.missingRequired] };
      dir.fieldKeys = fields.map((x: any) => x.key);
      return card;
    },
    "dir-set-name": async (_c, a, f) => {
      const svc = dirService(f);
      const card = await dirCall(() => svc.showMyCard(to(a)));
      const rev = a.expectedRevision === "stale" ? card.revision - 1 : card.revision;
      try {
        const next = await dirCall(() => svc.setMyName(to(a), String(a.name), rev));
        dir.card = { revision: next.revision, name: next.name?.text ?? next.name, missing: [...next.missingRequired] };
        dir.conflict = false;
        return next;
      } catch (e: any) {
        // the card moved on: the wallet's own DirectoryConflict (the community answered `superseded`); not a refusal of the person's request
        if (e?.name === "DirectoryConflict") { dir.conflict = true; return "conflict"; }
        throw e;
      }
    },
    "dir-list-members": async (_c, a, f) => {
      const page = await dirCall(() => dirService(f).listMembers(to(a)));
      dirRows(page.rows);
      return page;
    },
    // by the members list, then the entry of the row it names; `list: false` goes straight to an entry id kept from an earlier list
    "dir-show-member": async (_c, a, f) => {
      const svc = dirService(f);
      if (a.list !== false) dirRows((await dirCall(() => svc.listMembers(to(a)))).rows);
      const id = dirKnown.get(String(a.target));
      if (id === undefined) { dir.seen = []; dir.none = true; return "no entry"; }
      const card = await dirCall(() => svc.showMember(to(a), id));
      dirSeen(card);
      return card ?? "not shown";
    },
    "dir-lookup-name": async (_c, a, f) => { const name = await dirCall(() => dirService(f).lookupName(to(a), String(a.subject))); dir.lookup = name?.text ?? name; return name ?? "none"; },
    "dir-member-by-did": async (_c, a, f) => { const card = await dirCall(() => dirService(f).memberCardByDid(to(a), String(a.subject))); dirSeen(card); return card ?? "not shown"; },
    "join-supplement": async (_c, a, f) => { agentPrep(f); return vtiAgent.supplement(to(a), a.requestId === undefined ? {} : { requestId: String(a.requestId) }); },

    // ---- persona (VtaClient: listContexts, listServers, mintPersona, createContext, borrowKey): the wallet's own requests, in the order ensurePersona makes them. Not ensurePersona itself: its key
    // borrowing needs a confidential channel (keys/export-secret), which this carrier is not, so the borrow is a step of its own (persona-borrow-key).
    "persona-context": (c, a) => c.createContext(String(a.id ?? "keyring"), String(a.name ?? "Keyring")),
    "persona-mint": async (c, a) => {
      const contexts = await c.listContexts();
      const servers = await c.listServers();
      const contextId = c.personaContextId(contexts);
      const label = String(a.label ?? "p1");
      const minted = await c.mintPersona(servers[0] !== undefined ? { contextId, serverId: servers[0].id, label } : { contextId, didUrl: `${String(a.didUrl ?? "https://persona.example")}/${label}`, label });
      personaState.minted = minted;
      return minted;
    },
    "persona-borrow-key": (c, a) => c.borrowKey(String(a.keyId ?? personaState.minted?.signingKeyId ?? "did:webvh:example#key-0")),

    // ---- elections, the member's reads (the wallet's POLL_GENERATIONS list/show constants through the community controller): the ladder walk is the kind's, class D (the wallet's PollService
    // needs its record store and an agent backend). A version refusal means the question was not taken, so the next generation is asked.
    "vote-list": async (_c, a, f) => { agentPrep(f); const polls = req(`${ctx.tt}/../polls/pollTasks`); return voteAsk(polls.POLL_GENERATIONS.map((g: any) => g.list), to(a), {}, "polls"); },
    // ---- ballot cast (docs/32): the wallet's own postCast (ballotBox.ts: the recipient check, the door, the receipt checked before it is believed). Class D: the cast comes from the platform's voting library through BALLOT_CTL (the agent's
    // `vta/pcs/vote` is not run), and the door is the runner's relay (the wallet's real door resolves the ballot box's DID document for an HTTPS service). A `CastFailure` is the refusal the flow reports.
    "ballot-cast": async (_c, a, f) => {
      const ctl = process.env.BALLOT_CTL;
      if (ctl === undefined || ctl === "") throw new Error("BALLOT_CTL (the ballot host's control address) is not set");
      const box = req(`${ctx.tt}/../polls/ballotBox`);
      const tasks = req(`${ctx.tt}/../polls/pollTasks`);
      const built: any = await (await fetch(`${ctl}/ctl/cast`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ electionId: String(a.electionId ?? "e1"), variant: String(a.variant ?? "ok"), version: String(a.version ?? "0.1") }) })).json();
      if (built.document === undefined) throw new Error(`the ballot host built no cast: ${JSON.stringify(built)}`);
      const door = {
        endpointOf: async () => "https://ballot-box.example/trust-tasks",
        post: async (url: string, document: Doc) => { const answer: any = await post(url, document); return { status: String(answer?.type).includes("/trust-task-error/") ? 422 : 200, body: answer }; },
        verify: async (document: Doc) => { const v: any = await proofs.verifyTrustTaskProof(ctx.agent(), document); return v.ok ? v : { ok: false, detail: `${v.reason}: ${v.detail}` }; },
      };
      try {
        const receipt = await box.postCast(built.document, to(a), door);
        const answer = tasks.parseCastAnswer(receipt.payload);
        ballot.outcome = answer?.outcome; ballot.leaf = answer?.leafIndex; (ballot as any).firstLeaf ??= answer?.leafIndex; ballot.receipts = (ballot.receipts ?? 0) + 1; ballot.refused = undefined;
        return receipt;
      } catch (e: any) {
        if (e?.name !== "CastFailure") throw e;
        const local = e.code !== undefined ? String(e.code).slice(String(e.code).lastIndexOf(":") + 1) : /another ballot box/.test(e.message) ? "wrongRecipient" : e.kind;
        ballot.refused = local;
        throw new VtiRefusal(String(e.code ?? e.kind), e.message);
      }
    },
    "vote-show": async (_c, a, f) => { agentPrep(f); const polls = req(`${ctx.tt}/../polls/pollTasks`); return voteAsk(polls.POLL_GENERATIONS.map((g: any) => g.show), to(a), { electionId: String(a.electionId ?? "no-such-election") }, "show"); },
    // ---- rooms (docs/32): the wallet's own type ladders, parsers and file sealing (rooms/real/wire.ts, files/stream.ts) over the community controller (community leg) and its VTA client (agent leg). The host-bound requests (accept, put, begin) are signed
    // as the persona by the community controller, with the presentation of the offer's credentials (class D: in the app the member's agent completes and signs them with `rooms/keys/act`).
    "rooms-offers": async (_c, a, f) => {
      agentPrep(f); const w = roomsWire();
      const { answer, type } = await roomsLadder([...w.OFFERS_LIST_TYPES], (t) => vtiAgent.communityTask(to(a), t, {}));
      const parsed = w.parseOffers(answer);
      rooms.offers = parsed.items.length; rooms.offerState = parsed.items[0]?.state; rooms.offerCreds = parsed.items[0] !== undefined; rooms.offersVersion = type.slice(type.lastIndexOf("/") + 1);
      if (parsed.items[0] !== undefined) { roomsKept.roomId = parsed.items[0].roomId; roomsKept.creds = parsed.items[0].credentials; }
      return parsed;
    },
    "rooms-memberships": async (_c, a, f) => {
      agentPrep(f); const w = roomsWire();
      const { answer } = await roomsLadder([w.ROOMS_TASK.membershipsList], (t) => vtiAgent.communityTask(to(a), t, {}));
      const parsed = w.parseMemberships(answer);
      rooms.memberships = parsed.items.map((m: any) => m.state);
      return parsed;
    },
    "rooms-accept": async (_c, a, f) => {
      agentPrep(f); const w = roomsWire();
      const { answer } = await roomsLadder([w.ROOMS_TASK.offersAccept], (t) => vtiAgent.communityTask(to(a), t, { roomId: String(a.roomId ?? roomsKept.roomId ?? "") }));
      rooms.accepted = w.parseAccept(answer) === undefined ? "" : "admitted";
      return answer;
    },
    "rooms-put": async (_c, a, f) => {
      agentPrep(f); const w = roomsWire(); const pres = roomsPresentation(a);
      const payload = { roomId: String(a.roomId ?? roomsKept.roomId ?? ""), key: String(a.key ?? "note-1"), expectedVersion: Number(a.expectedVersion ?? 0), cleartext: { title: String(a.title ?? "Ceremony note"), body: String(a.body ?? "written by the ceremony") }, ...(pres === undefined ? {} : { presentation: pres }) };
      const { answer } = await roomsLadder([w.ROOMS_TASK.recordsPut03], (t) => vtiAgent.communityTask(to(a), t, payload));
      const put = w.parsePut(answer);
      rooms.putKey = put?.key; rooms.putVersion = put?.version;
      return answer;
    },
    "rooms-blob-begin": async (_c, a, f) => {
      agentPrep(f); const stream = req(`${ctx.tt}/../rooms/real/files/stream`); const upload = req(`${ctx.tt}/../rooms/real/files/upload`); const pres = roomsPresentation(a);
      const roomId = String(a.roomId ?? roomsKept.roomId ?? "");
      const plaintext = new Uint8Array(Number(a.size ?? 5000)).map((_, i) => (i * 31 + 7) & 0xff);
      const sealed = stream.sealFile(new Uint8Array(32).fill(9), { roomId, fileId: stream.newFileId(), epoch: 0, segmentSize: upload.UPLOAD_SEGMENT_SIZE }, plaintext, "ceremony.bin");
      const manifest = a.corrupt === true ? { ...sealed.blob, chunks: { ...sealed.blob.chunks, chunkCount: sealed.blob.chunks.chunkCount + 1 } } : sealed.blob;
      const payload = { roomId, uploadKey: "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH", manifest, ...(pres === undefined ? {} : { presentation: pres }) };
      const { answer } = await roomsLadder([upload.UPLOAD_TASK.begin], (t) => vtiAgent.communityTask(to(a), t, payload));
      rooms.upload = (answer as any)?.uploadId;
      return answer;
    },
    "rooms-keys-list": async (c, a) => {
      const w = roomsWire();
      const { answer, type } = await roomsLadder([w.ROOMS_TASK.keysList02, w.ROOMS_TASK.keysList01], (t) => c.task(t, {}));
      rooms.keys = w.parseKeysList(answer).length; rooms.keysVersion = type.slice(type.lastIndexOf("/") + 1);
      return answer;
    },
    "rooms-key-package": async (c, a) => {
      const w = roomsWire();
      const { answer } = await roomsLadder([w.ROOMS_TASK.keysKeyPackage], (t) => c.task(t, { roomId: String(a.roomId ?? roomsKept.roomId ?? "did:example:no-such-room"), invitation: a.invitation === "own" ? String(roomsKept.creds?.invitation ?? "") : a.invitation === "foreign" ? JSON.stringify({ "@context": ["https://www.w3.org/ns/credentials/v2", "https://registry.trustoverip.org/dtg/context/v1"], type: ["VerifiableCredential", "DTGCredential", "InvitationCredential"], issuer: "did:example:not-the-room", issuerScope: "public", validFrom: "2026-01-01T00:00:00Z", credentialSubject: { id: "did:example:member" } }) : String(a.invitation ?? "not-a-credential") }));
      rooms.keyPackage = w.parseKeyPackage(answer) !== undefined;
      return answer;
    },
    "rooms-act": async (c, a, f) => {
      const w = roomsWire();
      // the document is built as the service's `actAndSend` builds it: an id, the type, the persona as issuer, the recipient, issuedAt and the payload
      const document = { id: `urn:uuid:${req("node:crypto").randomUUID()}`, type: `${SPEC}${String(a.actType ?? "rooms/records/put/0.3")}`, issuer: ctx.did, recipient: String(a.host ?? a._to), issuedAt: new Date().toISOString(), payload: { roomId: String(a.roomId ?? "did:example:no-such-room"), key: "k", cleartext: { body: "x" } } };
      const { answer, type } = await roomsLadder([...w.KEYS_ACT_TYPES], (t) => c.task(t, { document }));
      rooms.acted = w.parseActed(answer) !== undefined; rooms.actVersion = type.slice(type.lastIndexOf("/") + 1);
      void f;
      return answer;
    },
    // ---- step-up (stepUp.ts): an approval for a challenge the agent never issued, built and signed by the wallet's own code
    "step-up-unprompted": (c) => c.task("https://trusttasks.org/spec/auth/step-up/approve-response/0.7", req(`${ctx.tt}/module/stepUp`).approveResponsePayload({ subject: ctx.did, sessionId: "sess-unprompted", challenge: "unprompted-challenge-0123456789" }, "approved")),
    // ---- sign-in (oobSignIn claimSignIn, oobSignInAgent identifyAndProve and approveSignIn): the wallet is the approver
    "oob-claim": async (_c, a) => {
      // the community's DID document as its host publishes it (class D when it is a stand-in carrying the sign-in services)
      if (a.doc !== undefined && a.doc !== null) docs.set(String(a.from), a.doc);
      const exp = a.claimClosesAt === undefined ? null : Math.floor(Date.parse(String(a.claimClosesAt)) / 1000);
      const link = { outcome: "accept", via: "url", from: String(a.from), id: String(a.id), exp, flow: "sign-in", task: null, ignored: [] };
      signIn.claimed = await oob.claimSignIn(link, { resolveDid, post, isKnownCommunity: () => true });
      return signIn.claimed.requestId;
    },
    "oob-prove": async (_c, a) => {
      if (signIn.claimed === undefined) throw new Error("no claimed sign-in: run oob-claim first");
      const typed = a.offset === undefined || Number(a.offset) === 0 ? String(a.number) : String((Number(a.number) + Number(a.offset)) % 100).padStart(2, "0");
      signIn.proved = await oobAgent.identifyAndProve(signIn.claimed, typed, { post, resolveDid, vta: standInAgent(String(a.agent ?? "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK")), persona: { did: ctx.did, entryId: "dir_StandInEntry000000" } });
      return signIn.proved.identifiedAs;
    },
    "oob-approve": async (_c, a) => {
      if (signIn.proved === undefined) throw new Error("no proved sign-in: run oob-prove first");
      const uv = ctx.uvSigner();
      return oobAgent.approveSignIn(signIn.proved, { post, resolveDid, vta: standInAgent(String(a.agent ?? "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK")), uvDid: async () => uv.did, uvSign: async (b: Uint8Array) => uv.sign(b), uvReset: async () => undefined });
    },
    "oob-cancel": async () => {
      if (signIn.claimed === undefined) throw new Error("no claimed sign-in to cancel");
      return oob.cancelSignIn(signIn.claimed, { post, resolveDid, isKnownCommunity: () => true });
    },
    // ---- vault (vtiCardVault: keepCardsInAgent, fetchAgentCards). The card is a stand-in for a community's membership credential (class D): the card source is not the wallet.
    "vault-keep-card": async (c, a) => {
      const store = { listMemberships: async () => [{ personaDid: ctx.did, communityDid: String(a.communityDid ?? "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"), vmc: a.card }], listHeldCredentials: async () => [] };
      const r = await cardVault.keepCardsInAgent(ctx.agent(), store, persona, (type: string, payload: Record<string, unknown>) => c.task(type, payload));
      if (r.cannotKeep.length > 0) throw Object.assign(new Error("the agent would not keep the card"), { code: "cannotKeep" });
      return r;
    },
    "vault-restore": async (c) => {
      cardVault.forgetCardReads();
      return cardVault.fetchAgentCards((type: string, payload: Record<string, unknown>) => c.task(type, payload));
    },
    "vault-query": (c, a) => c.task(`${SPEC}vault/credentials/query/0.1`, a.query ?? { purpose: "membership" }),

    // ---- ACL (VtaClient: listAcl, grantAdmin, labelAclEntry, revokeSubject, rotateManagerKey)
    "acl-list": (c) => c.listAcl(),
    "acl-grant": (c, a) => c.grantAdmin(a.subject ?? ctx.sampleSubject, { label: a.label ?? "Ceremony member" }),
    "acl-update": (c, a) => c.labelAclEntry(a.subject ?? ctx.sampleSubject, a.label ?? "Renamed"),
    "acl-revoke": (c, a) => c.revokeSubject(a.subject ?? ctx.sampleSubject),
    "acl-swap-key": async (c) => {
      // Class D: the successor key and DID are made by a stand-in key creator (a fixed Ed25519 key, did:key rather than did:peer); the wallet
      // builds the document and signs the link proof itself (rotateManagerKey).
      const s = ctx.successor();
      const base = ctx.agent();
      const wrapped = Object.create(base);
      wrapped.kms = { createKey: async () => ({ keyId: s.keyId, publicJwk: { kty: "OKP", crv: "Ed25519", kid: s.keyId, x: Buffer.from(s.publicKey).toString("base64url") } }) };
      wrapped.dids = { ...base.dids, create: async () => ({ didState: { state: "finished", did: s.did } }) };
      c.agent = wrapped;
      try {
        return await c.rotateManagerKey();
      } catch (e: any) {
        // The swap is done and the VTA answered; what failed is the wallet signing in again as the successor over a real mediator, which this carrier does not have.
        if (e?.name === "SwapDoneSignInFailed" || e?.newDid !== undefined) return e.newDid ?? s.did;
        throw e;
      }
    },
    "acl-whoami": (c) => c.whoAmI(5000),
    // ---- devices (vtaDevices)
    "device-register": (c, a) => devices.registerThisDevice(c, { displayName: a.displayName ?? "Ceremony phone", platform: a.platform ?? "ios" }),
    "device-heartbeat": (c, a) => devices.heartbeat(c, a.ext),
    "device-list": (c) => devices.listAgentDevices(c),
    "device-set-wake": (c, a) => devices.setThisDeviceWake(c, { gateway: a.gateway ?? "did:web:push.example", handle: a.handle ?? "ceremony-handle" }, { pushPlatform: a.pushPlatform ?? "apns" }),
    // the wallet's own "remove another device": list the agent's devices, wipe a registered one that is not this phone, then revoke its access-list entry
    "device-remove-other": async (c) => {
      const list = await devices.listAgentDevices(c);
      const other = list.find((d: any) => !d.isThisPhone && d.source === "registered" && d.deviceId);
      if (other === undefined) throw new Error("no other registered device on the agent");
      return devices.removeAgentDevice(c, other);
    },
    // wipe another registered device and leave its access-list entry: the binding stays, marked wiped
    "device-wipe-other": async (c) => {
      const list = await devices.listAgentDevices(c);
      const other = list.find((d: any) => !d.isThisPhone && d.source === "registered" && d.deviceId);
      if (other === undefined) throw new Error("no other registered device on the agent");
      return c.task(devices.AGENT_DEVICE_TASK.wipe, { deviceId: other.deviceId, scope: "cacheAndKeys", reason: "Ceremony: wipe without revoking" });
    },
    "device-wipe": (c, a) => devices.removeAgentDevice(c, { source: "registered", deviceId: a.deviceId, isThisPhone: false, did: a.did ?? ctx.sampleSubject }),
  };

  function finish(f: Flow, p: Promise<unknown>): void {
    p.then(
      (r) => {
        f.state = "completed";
        f.result = r;
        f.detail = "the wallet's call returned";
      },
      (e: any) => {
        f.state = e instanceof VtiRefusal ? "refused" : "aborted";
        f.detail = `${e?.code ?? e?.name ?? "error"}: ${String(e?.message ?? e).slice(0, ctx.wire !== undefined ? 1500 : 300)}`;
      },
    ).finally(() => {
      if (process.env.KW_CEREMONY_TRACE) require("node:fs").appendFileSync(process.env.KW_CEREMONY_TRACE, `${JSON.stringify({ kind: f.kind, state: f.state, detail: f.detail, sent: f.sent.map((d) => d.type), received: f.received.map((d) => `${d.type} ${d.payload?.code ?? ""}`) })}\n`);
      touch(f);
    });
  }

  return {
    kinds: () => Object.keys(kinds),
    /** Start one wallet call. The first document it sends is returned unsent; `continues` says the wallet may send more after each answer. */
    initiate: async (p: { kind: string; to: string; args?: Record<string, any> }) => {
      const run = kinds[p.kind];
      if (run === undefined) throw new Error(`the wallet adapter has no ceremony kind ${p.kind}`);
      stepUpDecision = p.args?.stepUp === "deny" ? "deny" : "approve";
      const f: Flow = { id: `urn:uuid:ceremony-${++n}`, kind: p.kind, state: "open", detail: "", outbound: [], sent: [], received: [] };
      flows.set(f.id, f);
      active = f;
      const c = clientOf(typeof p.args?.recipient === "string" ? p.args.recipient : p.to, typeof p.args?.as === "string" ? p.args.as : undefined);
      const call = run(c, { ...(p.args ?? {}), _to: p.to }, f);
      finish(f, call);
      if (ctx.wire !== undefined) {
        // the wallet's own call carries itself over the wire: wait for its end (bounded), then report what it sent
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([call.catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, ctx.wire!.timeoutMs ?? 120000)))]);
        if (timer !== undefined) clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 0));
        if (f.state === "open") { f.state = "aborted"; f.detail = "the wallet's call did not end within the wire timeout"; }
        const sentDocs = f.sent.map((d) => JSON.stringify(d));
        f.outbound.splice(0);
        return { threadId: f.id, documents: sentDocs, sent: true as const };
      }
      await progress(f);
      const docs = f.outbound.splice(0);
      const as = clientFor.split("|")[1];
      return { threadId: f.id, documents: docs, sent: false, continues: true, ...(as !== undefined && as !== ctx.did ? { from: as } : {}) };
    },
    /** A document that reached the wallet from the peer: the answer to what it sent, handed to its own client. Returns what the wallet sends next. */
    /** A credential delivery the community pushed (credential-exchange/issue carrying its membership or role card): kept by the wallet's own inbox code, as its persona inbox keeps it. */
    receiveDelivery: async (bytes: string): Promise<void> => {
      const doc = JSON.parse(bytes) as Doc;
      agentPrep({ via: "agent" } as Flow);
      await inboxMod.receiveIssue(memberStore, ctx.did, { id: doc.id, typ: "application/didcomm-plain+json", type: "https://trusttasks.org/binding/didcomm/0.1/envelope", from: doc.issuer, to: [ctx.did], thid: doc.threadId, created_time: Math.floor(Date.now() / 1000), body: doc }, { via: "approval", checkCard: cardCheck });
    },
    deliver: async (bytes: string) => {
      const doc = JSON.parse(bytes) as Doc;
      const f = active;
      if (f === undefined || client === undefined) return { replies: [] as string[], transport: { status: 202, kind: "none" } };
      f.received.push(doc);
      if (f.postWaiter !== undefined) {
        // an answer to a sign-in POST: the wallet's sign-in code reads it directly (it has no DIDComm thread)
        const w = f.postWaiter;
        f.postWaiter = undefined;
        w(doc);
        await progress(f);
        const out = f.outbound.splice(0);
        return { replies: out, transport: { status: out.length > 0 ? 200 : 202, kind: out.length > 0 ? "document" : "none" }, quiescentAfterMs: 0 };
      }
      if (f.via === "agent") {
        // the community's answer to a join or vetting-directory task: the controller matches it to its ask by the thread, as it does an answer off the mediator
        await vtiAgent.deliver({ id: doc.id, typ: "application/didcomm-plain+json", type: "https://trusttasks.org/binding/didcomm/0.1/envelope", from: doc.issuer, to: [ctx.did], thid: doc.threadId, created_time: Math.floor(Date.now() / 1000), body: doc });
        await progress(f);
        const out = f.outbound.splice(0);
        return { replies: out, transport: { status: out.length > 0 ? 200 : 202, kind: out.length > 0 ? "document" : "none" }, quiescentAfterMs: 0 };
      }
      client.deliver({ id: doc.id, typ: "application/didcomm-plain+json", type: "https://didcomm.org/trust-task/2.0/document", from: doc.issuer, to: [ctx.did], thid: doc.threadId, created_time: Math.floor(Date.now() / 1000), body: doc });
      await progress(f);
      const docs = f.outbound.splice(0);
      return { replies: docs, transport: { status: docs.length > 0 ? 200 : 202, kind: docs.length > 0 ? "document" : "none" }, quiescentAfterMs: 0 };
    },
    /** Wire mode: a plaintext from a community that reached the wallet's session is handed to the wallet's own community controller, which matches it to its ask by the thread. */
    agentDeliver: (pt: any): void => { void vtiAgent.deliver(pt); },
    /** Wire mode: a Trust Task document the wallet's session sent / received over the wire, filed under the flow that is running. */
    tapSent: (doc: Doc): void => { if (active !== undefined) active.sent.push(JSON.parse(JSON.stringify(doc))); },
    tapReceived: (doc: Doc): void => { if (active !== undefined) active.received.push(JSON.parse(JSON.stringify(doc))); },
    accepts: () => active !== undefined && active.state === "open",
    state: (thread: string): FlowState | "unknown" => flows.get(thread)?.state ?? "unknown",
    detail: (thread: string): string => flows.get(thread)?.detail ?? "",
    received: (thread?: string): Doc[] => (thread === undefined ? [...flows.values()].flatMap((f) => f.received) : (flows.get(thread)?.received ?? [])),
    sent: (thread?: string): Doc[] => (thread === undefined ? [...flows.values()].flatMap((f) => f.sent) : (flows.get(thread)?.sent ?? [])),
    result: (thread: string): unknown => flows.get(thread)?.result,
    /** The newest finished flow's result (for `observe stored`). */
    stepUpAsked: (): number => stepUpAsked.length,
    /** The directory state each call last read (`dirStoredKind` reads it). */
    dirState: (): Record<string, unknown> => dir,
    voteState: (): Record<string, unknown> => vote,
    roomsState: (): Record<string, unknown> => rooms,
    ballotState: (): Record<string, unknown> => ballot,
    personaState: (): { minted?: Record<string, unknown> } => personaState,
    lastResult: (): unknown => [...flows.values()].at(-1)?.result,
    reset: () => {
      flows.clear();
      signIn.claimed = undefined;
      signIn.proved = undefined;
      vtiAgent.asks?.clear?.();
      lastRequestId = undefined;
      held.memberships.clear(); held.cards.length = 0;
      for (const k of Object.keys(dir)) delete dir[k];
      personaState.minted = undefined;
      for (const k of Object.keys(vote)) delete (vote as any)[k];
      for (const k of Object.keys(rooms)) delete rooms[k];
      roomsKept.roomId = undefined; roomsKept.creds = undefined;
      for (const k of Object.keys(ballot)) delete (ballot as any)[k];
      dirKnown.clear();
      stepUpAsked.length = 0;
      active = undefined;
      client = undefined;
      clientFor = "";
    },
    persona,
    SPEC,
  };
}
