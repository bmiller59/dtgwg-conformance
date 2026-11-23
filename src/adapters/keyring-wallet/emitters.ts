// SPDX-License-Identifier: Apache-2.0
/**
 * Producer-class (emit) flows for the keyring-wallet jest host (docs/04 section 11.8). Each flow drives a real builder of the wallet
 * (module/VtaClient.ts, stepUp.ts, oobSignIn.ts, vtiAgent.ts, pcs*, vaults, rooms and directory senders) and captures the signed
 * document it hands to its session or to its HTTPS post. The wallet's code is the original; this file only supplies the capturing
 * session and the sample inputs a person or an agent would give. Nothing is sent and nothing is awaited.
 *
 * Version ladders: the capturing session refuses every document as `unsupportedVersion` (as an older agent would), so the wallet's
 * own step-down (`TaskVersions.ask`, taskVersions.ts) walks every rung it names and each rung's document is captured. A flow whose
 * wallet code has its own loop (join manifest, join submit) is walked by the same refusal; where the wallet code gives a refusal
 * no way to step down, only the first rung is reached and the others are reported as not reached.
 *
 * Governance: no role value or policy content is chosen here. Where the wallet's own builder hard-codes one (acl/grant sends
 * `role: admin`), the document carries it as the wallet builds it and `evidence` records the fact for the governance audit.
 */
import { appendFileSync, writeFileSync } from "node:fs";

type Doc = Record<string, any>;
export interface EmitCtx {
  tt: string; // wallet trust-tasks module root
  core: string; // wallet core package root
  agent: () => any;
  did: string; // the IUT's connection DID (the shim KMS holds its key)
  didKeyId: string; // key id the shim KMS knows for it
  sampleSubject: string;
  require: (path: string) => any;
  /** Class D: a successor key for acl/swap-key; the shim KMS signs with it (and only it besides the identity key). */
  successor: () => { did: string; keyId: string; publicKey: Uint8Array };
  uvSigner: () => { did: string; sign: (bytes: Uint8Array) => Uint8Array };
}

/** Why a type is not emitted, by prefix, for the status file (printed by the probe script, never claimed as a result). */
export const NOT_EMITTED_REASONS: Record<string, string> = {};

const SPEC = "https://trusttasks.org/spec/";
const SAMPLE_PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const REQUEST_ID = "SampleRequestId0123456789";
const B58 = "z3FoSampXpQ";
let runs = 0;
const SAMPLE_COMMUNITY = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const DEFAULT_VTA = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const SAMPLE_META = { community: SAMPLE_COMMUNITY, requirementsDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA", method: "inPerson", claimsVerified: ["name"], livenessConfirmed: true, declaredRelationship: "none", identityCommitment: B58, cardDigestMultibase: B58, validFrom: "2026-11-12T10:00:00Z", validUntil: "2026-11-12T10:15:00Z" };
const SAMPLE_PARAMS = { suite: "ps-ddh-bls12381", helperKey: "zHelperKeySample", tokenKey: "zTokenKeySample", vetterLabels: ["vetter/2026-11"], tokenLabels: ["token-1"], dripPerTick: 3, tickLength: "P3D", events: [] as unknown[] };

export interface Flow {
  name: string;
  run: (e: Env) => Promise<unknown>;
  /** Note recorded when a captured document carries a governance value the wallet's own builder chose. */
}
export interface Env {
  ctx: EmitCtx;
  client: any; // VtaClient on the capturing session
  vtiAgent: any; // the wallet's community controller on the same capture
  docs: Doc[];
  recipient: string;
  /** Class D notes by emitted type: the part of the document the wallet did not build or sign itself (a stand-in). */
  standIn: Map<string, string>;
}

const debugFile = process.env.KW_EMIT_DEBUG;
const debug = (where: string, err: unknown) => {
  if (debugFile && !(err as any)?.code?.startsWith?.("unsupported")) appendFileSync(debugFile, `${where}: ${(err as Error)?.stack?.split("\n").slice(0, 3).join(" | ") ?? err}\n`);
};

export function makeEmitter(ctx: EmitCtx) {
  const req = ctx.require;
  const { VtaClient } = req(`${ctx.tt}/module/VtaClient`);
  const devices = req(`${ctx.tt}/module/vtaDevices`);
  const stepUp = req(`${ctx.tt}/module/stepUp`);
  const { VtiRefusal, vtiAgent } = req(`${ctx.tt}/module/vtiAgent`);
  const oob = req(`${ctx.tt}/module/oobSignIn`);
  const cardVault = req(`${ctx.tt}/module/vtiCardVault`);
  const pcsChallenge = req(`${ctx.tt}/module/pcsChallenge`);
  const joinWire = req(`${ctx.tt}/module/joinWire`);
  const vtaClaim = req(`${ctx.tt}/module/vtaClaim`);
  const memberVmc = req(`${ctx.tt}/module/vtiMemberVmc`);
  const renewal = req(`${ctx.tt}/module/vtiCardRenewal`);
  const rotation = req(`${ctx.tt}/module/vtaRotation`);
  const directoryWire = req(`${ctx.core}/src/modules/directory/wire`);
  const roomsWire = req(`${ctx.core}/src/modules/rooms/real/wire`);
  const pcsVetter = req(`${ctx.tt}/module/pcsVetterTasks`);
  const pcsVta = req(`${ctx.tt}/module/pcsVtaPayloads`);

  const refuse = () => new VtiRefusal("unsupportedVersion", "capture: version not served");
  const persona = { did: ctx.did, contextId: "sample-context", kmsKeyIds: { signing: ctx.didKeyId, keyAgreement: ctx.didKeyId }, vtaKeyIds: { signing: `${ctx.did}#${ctx.didKeyId}` } };
  const swallow = async (p: Promise<unknown> | unknown) => {
    try {
      await p;
    } catch (err) {
      debug("swallowed", err); // the capture refuses every send; what matters is what was captured
    }
  };

  const flows: Flow[] = [];
  const flow = (name: string, run: (e: Env) => Promise<unknown>) => flows.push({ name, run });
  /** A task sender with the VtaClient's signature, for the wallet's module-level helpers. */
  const taskOf = (e: Env) => (type: string, payload: Record<string, unknown>) => e.client.task(type, payload);

  // ---- VtaClient methods (the wallet's own ladders step down through every rung on the refusal)
  flow("whoami", (e) => e.client.whoAmI(1000));
  flow("revoke-session", (e) => e.client.task(`${SPEC}auth/revoke-session/0.2`, { all: true, reason: "Unlinked on this phone" }, 1000));
  flow("config-show", (e) => e.client.agentLabel());
  flow("acl-list", (e) => e.client.listAcl());
  flow("acl-grant", (e) => e.client.grantAdmin(ctx.sampleSubject, { label: "Sample" }));
  flow("acl-revoke", (e) => e.client.revokeSubject(ctx.sampleSubject));
  flow("acl-update", (e) => e.client.labelAclEntry(ctx.sampleSubject, "Sample"));
  flow("acl-swap-key", async (e) => {
    // The wallet makes the successor key and DID itself (createVtiClientDid) and signs the link proof with it. The shim agent has no key
    // creator, so a stand-in one hands out a fixed Ed25519 key (the shim KMS signs with it), and the DID created is its did:key rather than a
    // did:peer. The mediator and the manager store are stand-ins too. Class D for those parts; the document is the wallet's own build.
    const s = ctx.successor();
    const base = ctx.agent();
    const wrapped = Object.create(base);
    wrapped.kms = { createKey: async () => ({ keyId: s.keyId, publicJwk: { kty: "OKP", crv: "Ed25519", kid: s.keyId, x: Buffer.from(s.publicKey).toString("base64url") } }) };
    wrapped.dids = { ...base.dids, create: async () => ({ didState: { state: "finished", did: s.did } }) };
    e.client.agent = wrapped;
    e.standIn.set(`${SPEC}acl/swap-key/0.1`, "class D: built by the wallet's rotateManagerKey; the successor key and DID are made by a stand-in key creator (a fixed Ed25519 key, did:key), the mediator and manager store are stand-ins, and the shim KMS signs the link proof with that key");
    await e.client.rotateManagerKey();
  });
  flow("policy-get", (e) => e.client.readApprovals());
  flow("policy-upsert", (e) => e.client.writeApprovals({ rules: [], sets: [] }, 0));
  flow("vault-list", (e) => e.client.vaultList({}));
  flow("vault-upsert", async (e) => {
    // The wallet's own sign-in vault helper builds the upsert; the list it makes first is answered empty by the stand-in (the agent's
    // answer), the seal is the wallet's own when the shim can pack it, else a placeholder envelope (the schema checks shape only).
    const port = req(`${ctx.tt}/module/oobSignInAgent`).vtaSignInPort(e.client, { platform: "ios" });
    const vta = { ...port, vaultList: async (f: Doc) => (await swallow(port.vaultList(f)), []), sealVaultSecret: async (secret: Doc) => port.sealVaultSecret(secret).catch(() => ({ envelope: "didcomm-authcrypt", jwe: "{}" })) };
    await swallow(req(`${ctx.tt}/module/oobSignInAgent`).ensureSignInVaultEntry(e.recipient, { did: ctx.did, signingKeyId: ctx.didKeyId, contextId: "sample-context" }, { vta }));
  });
  flow("vault-sign-trust-task", (e) =>
    e.client.signTrustTask({ entryId: "dir_Sample0123456789", unsignedEnvelope: { id: "urn:uuid:00000000-0000-4000-8000-000000000001", type: `${SPEC}auth/oob/identify/0.1`, issuer: ctx.did, recipient: ctx.sampleSubject, issuedAt: "2026-11-12T10:00:00Z", payload: {} } }),
  );
  flow("consent-decision", (e) => e.client.decideConsent({ challenge: "sample-challenge-0123456789", payloadDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA" }, "approve"));
  flow("contexts", async (e) => {
    await swallow(e.client.listContexts());
    await swallow(e.client.createContext("sample-ctx", "Sample context"));
  });
  flow("contexts-delete", async (e) => {
    const { VTA_TASK_VERSIONS } = req(`${ctx.tt}/module/VtaClient`);
    await swallow(e.client.versions.ask("contextsDelete", VTA_TASK_VERSIONS.contextsDelete, (type: string) => e.client.task(type, { id: "sample-ctx" })));
  });
  flow("webvh", async (e) => {
    await swallow(e.client.listServers());
    await swallow(e.client.listDids("sample-ctx"));
    await swallow(e.client.mintPersona({ contextId: "sample-ctx", serverId: "sample-server", label: "Sample" }));
  });
  flow("webvh-rotate-keys", (e) => rotation.rotatePersonaKeys({ task: (t: string, p: Doc) => e.client.task(t, p), borrowKey: async () => ({ keyId: "k", publicKeyMultibase: "z6Mk" }) }, { setPersona: async () => undefined }, { ...persona, vtaDid: e.recipient, vtaKeyIds: { signing: `${ctx.sampleSubject}#key-1`, keyAgreement: `${ctx.sampleSubject}#key-2` } }));
  flow("keys-export-secret", (e) => e.client.borrowKey(`${ctx.sampleSubject}#key-1`));
  flow("pcs", async (e) => {
    const c = e.client;
    const common = { contextId: "sample-ctx", community: SAMPLE_COMMUNITY };
    await swallow(c.createPcsApplication({ ...common, joinDid: ctx.sampleSubject, parameters: SAMPLE_PARAMS }));
    await swallow(c.showPcsApplication("urn:uuid:00000000-0000-4000-8000-000000000002"));
    await swallow(c.deletePcsApplication("urn:uuid:00000000-0000-4000-8000-000000000002"));
    await swallow(c.verifyPcsAttestation({ applicationId: "urn:uuid:00000000-0000-4000-8000-000000000002", parameters: SAMPLE_PARAMS, attestation: { suite: SAMPLE_PARAMS.suite, attestation: B58, meta: { ...SAMPLE_META, tokenLabel: "token-1", tokenSerial: B58 }, token: { label: "token-1", serial: B58, shown: B58 } } }));
    await swallow(c.provePcs({ applicationId: "urn:uuid:00000000-0000-4000-8000-000000000002", parameters: SAMPLE_PARAMS, requirementsDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA", challenge: "sample-challenge-0123456789" }));
    await swallow(c.showPcsVetter(common));
    await swallow(c.pcsRootRequest({ ...common, memberDid: ctx.sampleSubject, parameters: SAMPLE_PARAMS, label: "vetter/2026-11" }));
    await swallow(c.pcsRootAccept({ ...common, parameters: SAMPLE_PARAMS, response: { label: "vetter/2026-11", preCredential: B58 } }));
    await swallow(c.pcsTokensRequest({ ...common, parameters: SAMPLE_PARAMS, label: "vetter/2026-11", tick: 1, count: 1 }));
    await swallow(c.pcsTokensAccept({ ...common, parameters: SAMPLE_PARAMS, response: { label: "vetter/2026-11", tick: 1, preCredentials: [B58] } }));
    await swallow(c.pcsTokensAbandon({ ...common, draw: { label: "vetter/2026-11", tick: 1 } }));
    await swallow(c.pcsAttest({ ...common, parameters: SAMPLE_PARAMS, applicantId: B58, meta: SAMPLE_META }));
  });
  flow("device", async (e) => {
    await swallow(devices.registerThisDevice(e.client, { displayName: "Sample phone", platform: "ios" }));
    await swallow(devices.heartbeat(e.client));
    await swallow(devices.listAgentDevices(e.client));
    await swallow(devices.removeAgentDevice(e.client, { source: "registered", deviceId: "sample-device", isThisPhone: false, did: ctx.sampleSubject }));
    await swallow(devices.setThisDeviceWake(e.client, { gateway: "https://push.example", handle: "sample-handle" }));
  });

  // ---- step-up: the wallet answers an agent's approve-request through VtaClient.answerStepUp; one run per request version
  for (const requestType of stepUp.STEP_UP_REQUEST_TYPES as string[]) {
    for (const decision of ["approve", "deny"]) {
      flow(`step-up-response-${requestType.slice(-3)}-${decision}`, async (e) => {
        e.client.options = { onStepUp: async () => decision };
        const request = { issuer: e.recipient, subject: ctx.did, sessionId: "urn:uuid:00000000-0000-4000-8000-000000000003", challenge: "sample-challenge-0123456789", reason: "Sample", requestType, responseType: stepUp.approveResponseTypeFor(requestType) };
        await swallow(e.client.answerStepUp({ ok: true, request }, new Error("step-up"), `${SPEC}acl/list/0.3`, async () => undefined));
      });
    }
  }

  // ---- auth/oob sign-in and provision/vta (HTTPS post is the cut point: the stand-in records the document and answers
  // "unsupported type", so the wallet's own step-down (claim 0.2 to 0.1, prove 0.3 to 0.1) walks every rung it names).
  const COMMUNITY_BASE = "https://community.example";
  const unsupportedAnswer = { type: `${SPEC}trust-task-error/0.5`, payload: { code: "unsupportedType", message: "capture", retryable: false } };
  const didDoc = (did: string) => ({ id: did, service: [{ id: `${did}#tasks`, type: oob.TRUST_TASK_HTTPS, serviceEndpoint: COMMUNITY_BASE }, { id: `${did}#portal`, type: oob.SIGN_IN_PORTAL, serviceEndpoint: `${COMMUNITY_BASE}/portal` }] });
  const oobDeps = (e: Env) => ({
    resolveDid: async (did: string) => (did.startsWith("did:key:") && did !== e.recipient ? ((await ctx.agent().dids.resolveDidDocument(did)) as any) : didDoc(did)),
    post: async (_url: string, document: Doc) => {
      e.docs.push(JSON.parse(JSON.stringify(document)));
      return unsupportedAnswer;
    },
    isKnownCommunity: () => true,
    now: () => Math.floor(Date.now() / 1000),
  });
  const trigger = (e: Env, flow: string) => ({ outcome: "accept", via: "url", from: e.recipient, id: REQUEST_ID, exp: null, flow, task: null, ignored: [] });
  flow("oob-claim", async (e) => {
    await swallow(oob.claimSignIn(trigger(e, "sign-in"), oobDeps(e)));
  });
  const claimedOf = (e: Env) => ({ requestId: REQUEST_ID, vtcDid: e.recipient, base: COMMUNITY_BASE, portalOrigin: COMMUNITY_BASE, decisionDeadline: Math.floor(Date.now() / 1000) + 600, keyA: oob.newThrowawayKey(), answer: {} });
  flow("oob-cancel", async (e) => {
    await swallow(oob.cancelSignIn(claimedOf(e), oobDeps(e)));
  });
  // identify and grant are built by the wallet but signed by the member's VTA (vault/sign-trust-task): the stand-in VTA below sends the
  // real vault/sign-trust-task through the capture and signs with the IUT key so the wallet's own checks pass. Those two types are
  // therefore not reported as the wallet's emissions (the signature is not the wallet's); prove and respond are signed by the wallet.
  const agentDeps = (e: Env) => {
    const uv = ctx.uvSigner();
    const standInVta = {
      did: e.recipient,
      signTrustTask: async (request: Doc) => {
        await swallow(e.client.signTrustTask(request));
        const type = String(request.unsignedEnvelope.type);
        const signed = await req(`${ctx.core}/src/modules/trust-tasks/documentProof`).signDocumentProof(ctx.agent(), request.unsignedEnvelope, ctx.did, { proofPurpose: type.includes("/grant/") ? "assertionMethod" : "authentication" });
        // Class D: the envelope is the wallet's own builder output, but the signature is made here, standing in for the member's agent
        // (vault/sign-trust-task), with the key the wallet's identity holds. Reported as an emission of the type, with that note.
        e.docs.push(JSON.parse(JSON.stringify(signed)));
        e.standIn.set(type, "class D: built by the wallet; signed by a stand-in for the member's agent (vault/sign-trust-task) using the wallet identity's key");
        return signed;
      },
      vaultList: async () => [],
      vaultUpsert: async () => ({}),
      sealVaultSecret: async () => ({}),
      heartbeat: async () => undefined,
      register: async () => "registered",
    };
    return { ...oobDeps(e), vta: standInVta, uvDid: async () => uv.did, uvSign: async (bytes: Uint8Array) => uv.sign(bytes), uvReset: async () => undefined };
  };
  const oobAgent = req(`${ctx.tt}/module/oobSignInAgent`);
  flow("oob-prove", async (e) => {
    await swallow(oobAgent.identifyAndProve(claimedOf(e), "42", { ...agentDeps(e), persona: { did: ctx.did, entryId: "dir_Sample0123456789" } }));
  });
  flow("oob-respond", async (e) => {
    for (const version of ["0.3", "0.2", "0.1"]) {
      const proved = { claimed: claimedOf(e), step2: { type: `${SPEC}auth/oob/prove/${version}#response`, payload: {} }, sessionKey: DEFAULT_VTA, requester: { browser: "b", os: "o", location: "l", sameNetwork: true }, identifiedAs: ctx.did, persona: { did: ctx.did, entryId: "dir_Sample0123456789" }, version, provesTried: [version] };
      await swallow(oobAgent.approveSignIn(proved, agentDeps(e)));
    }
  });
  const farmDeps = (e: Env) => ({
    resolveDid: async (did: string) => didDoc(did),
    post: async (_url: string, body: string) => {
      e.docs.push(JSON.parse(body));
      throw new Error("capture");
    },
    sign: async (doc: Doc) => req(`${ctx.core}/src/modules/trust-tasks/documentProof`).signDocumentProof(ctx.agent(), doc, ctx.did, { proofPurpose: "authentication" }),
    walletDid: ctx.did,
    sleep: async () => undefined,
  });
  flow("provision-claim", async (e) => {
    await swallow(vtaClaim.claimVta({ outcome: "accept", via: "url", from: e.recipient, id: "SampleReservationHandle0123456789", exp: null, flow: "vta-claim", task: null, ignored: [] }, farmDeps(e)));
  });
  flow("provision-redeem", async (e) => {
    const claimed = { farmDid: e.recipient, handle: "SampleReservationHandle0123456789", url: `${COMMUNITY_BASE}/trust-tasks`, threadId: "urn:uuid:00000000-0000-4000-8000-000000000005", walletDid: ctx.did, claimCheck: "sample", farmDocument: didDoc(e.recipient) };
    await swallow(vtaClaim.redeemVta(claimed, farmDeps(e), { shouldStop: () => e.docs.length > 0, maxWaitMs: 5000 }));
  });

  // ---- vault/credentials (the wallet's card-vault helpers, with the wallet's own sender)
  flow("vault-credentials", async (e) => {
    await swallow(cardVault.fetchAgentCards(taskOf(e)));
    const cardId = `urn:uuid:00000000-0000-4000-8000-${String(++runs).padStart(12, "0")}`;
    const store = { listMemberships: async () => [{ personaDid: ctx.did, communityDid: SAMPLE_COMMUNITY, vmc: { id: cardId } }], listHeldCredentials: async () => [] };
    await swallow(cardVault.keepCardsInAgent(ctx.agent(), store, persona, taskOf(e)));
    for (const type of [`${SPEC}vault/credentials/get/0.2`, `${SPEC}vault/credentials/get/0.1`]) await swallow(e.client.task(type, { id: cardId }));
  });

  // ---- the community leg (vtc, vetting, directory, rooms, polls) through the wallet's controller
  flow("vtc-join", async (e) => {
    const v = e.vtiAgent;
    for (const wire of joinWire.MANIFEST_WIRES as string[]) await swallow(v.ask(e.recipient, joinWire.manifestTaskType(wire), {}));
    await swallow(v.fetchChallenge(e.recipient, {}));
    await swallow(v.status(e.recipient, { requestId: REQUEST_ID }));
    await swallow(v.supplement(e.recipient, { requestId: REQUEST_ID, credentials: [] }));
    await swallow(v.withdraw(e.recipient, { requestId: REQUEST_ID, reason: "Sample" }));
    await swallow(v.selfRemove(e.recipient, { disposition: "tombstone" }));
    await swallow(v.sendMemberVmc(e.recipient, { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential"], id: "urn:uuid:vmc-sample" }, REQUEST_ID));
    for (const wire of joinWire.JOIN_WIRES as string[]) {
      await swallow(v.ask(e.recipient, joinWire.joinTaskType("submit", wire), joinWire.submitPayload(wire, { vp: { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiablePresentation"], holder: ctx.did, verifiableCredential: [] }, registryConsent: false })));
    }
  });
  flow("vtc-members", async (e) => {
    await swallow(e.vtiAgent.ask(e.recipient, renewal.MEMBERS_RENEW, {}));
  });
  flow("vtc-vetting", async (e) => {
    const t = pcsVetter.VTC_VETTER_TASK as Record<string, string>;
    await swallow(e.vtiAgent.ask(e.recipient, t.pcsRoot, { label: "vetter/2026-11", id: B58, request: { proof: B58 } }));
    await swallow(e.vtiAgent.ask(e.recipient, t.pcsTokens, { label: "vetter/2026-11", tick: 1, requests: [{ commitment: B58, openingProof: B58 }] }));
    await swallow(e.vtiAgent.ask(e.recipient, `${SPEC}vtc/vetting/vetters/list/0.1`, {}));
    await swallow(e.vtiAgent.ask(e.recipient, `${SPEC}vtc/vetting/vetters/profile/0.1`, { listed: true, languages: ["en"], methods: ["inPerson"], acceptsDocumentation: [], events: [] }));
  });
  // ---- vetting: the wallet's applicant and vetter-desk classes over an in-memory store (the person's choices are sample inputs).
  // vetting/attestation is not driven: its body is the hidden attestation the agent built (VtaClient.pcsAttest), forwarded unchanged.
  const vetting = req(`${ctx.tt}/module/vtiVetting`);
  flow("vetting", async (e) => {
    const applications = new Map<string, Doc>();
    const desks = new Map<string, Doc>();
    const store: Doc = {
      getApplication: async (c: string) => applications.get(c),
      saveApplication: async (a: Doc) => void applications.set(a.communityDid, a),
      listDesk: async () => [...desks.values()],
      saveDesk: async (d: Doc) => void desks.set(d.requestId, d),
      listTickets: async () => [],
      saveTicket: async () => undefined,
      getProfile: async () => undefined,
      saveProfile: async () => undefined,
      forget: async () => undefined,
      clearDesk: async () => undefined,
    };
    const communityStore: Doc = { listMemberships: async () => [], listHeldCredentials: async () => [] };
    const p = { ...persona, communityDid: SAMPLE_COMMUNITY };
    applications.set(SAMPLE_COMMUNITY, { communityDid: SAMPLE_COMMUNITY, joinDid: ctx.did, minStatements: 1, requiredClaims: ["name"], acceptedMethods: ["inPerson"], requests: [], requirementsDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA" });
    const applicant = new vetting.VtiApplicant(ctx.agent(), p, store, communityStore, undefined, {});
    await swallow(applicant.requestVetter({ vetterDid: e.recipient, code: "ABCD-2345", manifest: { criteria: [] } as any }));
    desks.set(REQUEST_ID, { requestId: REQUEST_ID, requestDocumentId: "urn:uuid:00000000-0000-4000-8000-000000000006", applicantDid: e.recipient, communityDid: SAMPLE_COMMUNITY, status: "accepted", receivedAt: "2026-11-12T10:00:00Z" });
    const desk = new vetting.VtiVetterDesk(ctx.agent(), p, store, communityStore, undefined);
    await swallow(desk.openSession(REQUEST_ID, ["name"], "inPerson"));
    desks.set(REQUEST_ID, { ...desks.get(REQUEST_ID), status: "accepted", session: undefined });
    await swallow(desk.decline(REQUEST_ID, "Sample"));
  });
  // ---- polls (vtc/elections): the wallet's own generations table, through the community controller
  const pollTasks = req(`${ctx.core}/src/modules/polls/pollTasks`);
  flow("polls", async (e) => {
    for (const g of pollTasks.POLL_GENERATIONS as Doc[]) {
      await swallow(e.vtiAgent.communityTask(e.recipient, g.list, {}));
      await swallow(e.vtiAgent.communityTask(e.recipient, g.show, { electionId: "sample-election" }));
    }
  });
  // ---- push/register: the app's own gateway client, with its fetch seam as the cut point (app/src/push/pushGateway.ts)
  flow("push-register", async (e) => {
    const gateway = req(`${ctx.core}/../../../app/src/push/pushGateway`);
    await swallow(gateway.registerWithGateway("https://push.example", { platform: "fcm", token: "sample-token" }, e.recipient, async (_url: string, init: { body: string }) => {
      e.docs.push(JSON.parse(init.body));
      throw new Error("capture");
    }, e.recipient)); // 5th argument: the gateway DID the build is configured with (ignored by a wallet whose function takes four)
  });
  flow("directory", async (e) => {
    for (const type of Object.values(directoryWire.DIRECTORY_TASK) as string[]) {
      const payload: Doc = type.includes("entries/list") ? { limit: directoryWire.MEMBERS_PAGE } : type.includes("query") ? { subject: ctx.sampleSubject } : type.includes("entries/show") ? { entryId: "dir_Sample0123456789" } : type.includes("images/get") ? { entryId: "dir_Sample0123456789", field: "picture", sha256: "0".repeat(64) } : type.includes("images/upload") ? (directoryWire.uploadPayload(SAMPLE_PHOTO) ?? {}) : {};
      await swallow(e.vtiAgent.communityTask(e.recipient, type, payload));
    }
  });
  flow("rooms", async (e) => {
    const t = roomsWire.ROOMS_TASK as Record<string, string>;
    await swallow(e.vtiAgent.communityTask(e.recipient, t.membershipsList, {}));
    for (const k of ["offersList04", "offersList03", "offersList02"]) await swallow(e.vtiAgent.communityTask(e.recipient, t[k], {}));
    await swallow(e.client.task(t.keysBrowse03, { roomId: "sample-room", host: e.recipient }));
    await swallow(e.client.task(t.keysBrowse, { roomId: "sample-room", host: e.recipient }));
    await swallow(e.client.task(t.keysRead, { roomId: "sample-room", host: e.recipient, key: "sample-key" }));
  });

  // ---- polls through the wallet's own poll service (voter register / accept / vote / receipt). The service's backend is the capture: each
  // agent task is built by the wallet's own VtaClient (handed to the capturing session) and answered with the agent's reply the service
  // needs to go on; the community's `show` answer is a poll the wallet's own jest fixtures use. The cast itself (voting/ballot/cast) is
  // the agent's document, forwarded unchanged, so it is not the wallet's emission and is not driven.
  const pollSvc = req(`${ctx.core}/src/modules/polls/pollService`);
  const pollTasks2 = req(`${ctx.core}/src/modules/polls/pollTasks`);
  const POLL_ID = "motion-7";
  const POLL_CHOICE = "option-the-member-chose";
  const pollManifest = {
    electionId: POLL_ID, community: SAMPLE_COMMUNITY,
    questions: [{ key: "motion", type: "choice", options: [{ key: POLL_CHOICE }, { key: "other" }], minSelections: 1, maxSelections: 1, optional: false }],
    secrecy: "open", roll: { rule: "members" }, registrationOpensAt: "2026-11-01T00:00:00Z", votingOpensAt: "2026-11-03T00:00:00Z", votingClosesAt: "2026-11-07T18:00:00Z",
    revote: "refuse", board: { visibility: "public", auditors: [] }, ballotBox: DEFAULT_VTA, binding: false, allowEarlyClose: true, resultsBeforeClose: false, textReleaseThreshold: 10,
  };
  const pollShown = { manifest: pollManifest, manifestDigest: "uEiBw9fNwLHJcQmaa0a_rH6YC3iKj7e0m8tBRFtLfS1x9KA", state: "voting", parameters: { suite: "ps-ddh-bls12381", votingKey: "z6MkvotingKeyAbC" }, disclosure: { ballotBox: DEFAULT_VTA } };
  pollTasks2.POLL_GENERATIONS.forEach((g: Doc, i: number) => {
    flow(`polls-voter-${i}`, async (e) => {
      const records = new Map<string, Doc>();
      let builds = 0;
      const door = {
        endpointOf: async () => "https://vote.example/trust-tasks",
        post: async (_u: string, document: Doc) => ({ status: 200, body: { type: `${pollTasks2.POLL_TASK.cast}#response`, issuer: DEFAULT_VTA, recipient: document.issuer, threadId: document.id, payload: { electionId: POLL_ID, outcome: "counted", leafIndex: 0 }, proof: {} } }),
        verify: async () => ({ ok: true, signer: DEFAULT_VTA }),
      };
      const backend = {
        communityTask: async (_c: string, type: string) => {
          if (![g.list, g.show].includes(type)) throw new VtiRefusal("unsupportedType", "capture: not served");
          return type.includes("/show/") ? pollShown : { elections: [] };
        },
        sendCompleted: async () => ({ electionId: POLL_ID, label: `voter/${POLL_ID}`, preCredential: B58 }),
        agentTask: async (type: string, payload: Doc) => {
          await swallow(e.client.task(type, payload));
          if (type === g.register) return { electionId: POLL_ID, manifestDigest: pollShown.manifestDigest, request: {}, ticketDocument: { type: `${SPEC}vtc/elections/tickets/issue/0.1#request`, payload: {} } };
          if (type === pollTasks2.POLL_TASK.accept) return { electionId: POLL_ID, ticketHeld: true };
          if (type === g.vote) return { castDocument: { id: `urn:uuid:00000000-0000-4000-8000-00000000000${++builds}`, type: `${pollTasks2.POLL_TASK.cast}#request`, issuer: SAMPLE_COMMUNITY, recipient: DEFAULT_VTA, payload: { community: SAMPLE_COMMUNITY, electionId: POLL_ID, cast: { ballot: payload.ballot } }, proof: {} }, tag: B58 };
          return { electionId: POLL_ID, status: "kept", leafIndex: 0 };
        },
        agentServedTypes: async () => [g.register, pollTasks2.POLL_TASK.accept, g.vote, pollTasks2.POLL_TASK.receipt],
        currentAgent: () => e.recipient,
        linkedAgents: () => [e.recipient],
        voterTarget: async (community: string) => ({ contextId: "sample-ctx", community, member: ctx.did }),
        records: { get: async (c: string, id: string) => records.get(`${c} ${id}`), put: async (r: Doc) => void records.set(`${r.community} ${r.electionId}`, JSON.parse(JSON.stringify(r))), list: async () => [...records.values()] },
        door, serially: (_k: string, work: () => Promise<unknown>) => work(), now: () => Date.parse("2026-11-04T00:00:00Z"), random: () => 0.5, sleep: async () => undefined, warn: noop,
      };
      const service = pollSvc.createPollService(backend);
      await swallow(service.takeTicket(SAMPLE_COMMUNITY, POLL_ID));
      await swallow(service.vote(SAMPLE_COMMUNITY, POLL_ID, { motion: { choice: [POLL_CHOICE] } }));
    });
  });

  // ---- rooms through the wallet's own rooms service (join a sealed room, write to a sealed room, list held rooms). Its backend is the
  // capture: each task to the agent is built by the wallet's own VtaClient and answered with the agent reply the service needs to go on
  // (shapes as the wallet's own rooms jest tests give them). `rooms/keys/act` is walked per version by what the agent serves. The documents
  // the agent completes as the member (offers/accept, records/put, curate, blobs/*) are carried inside the act task unsigned and
  // are the agent's to sign, so they are not the wallet's emissions and are not reported; the act request that carries them is.
  const roomsSvc = req(`${ctx.core}/src/modules/rooms/real/agentRoomsService`);
  const roomsWire2 = roomsWire;
  const ROOM_COMMUNITY = { did: SAMPLE_COMMUNITY, personaDid: ctx.did };
  const SEALED_ROOM = "did:webvh:QmSealedRoom:community.example";
  const roomOffer = { roomId: SEALED_ROOM, host: SAMPLE_COMMUNITY, label: "Sample room", visibility: "attributed", actions: ["read", "write"], validUntil: "2026-12-01T00:00:00Z", offeredAt: "2026-11-01T00:00:00Z", state: "open", credentials: { invitation: `{"id":"urn:inv:${SEALED_ROOM}"}`, membership: `{"id":"urn:vmc:${SEALED_ROOM}","credentialSubject":{"id":"${ctx.did}"}}`, authority: `{"id":"urn:vac:${SEALED_ROOM}","credentialSubject":{"id":"${ctx.did}"}}` } };
  const roomsWorld = (e: Env, served: string[]) => {
    const T = roomsWire2.ROOMS_TASK as Record<string, string>;
    const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    const agentTask = async (type: string, payload: Doc): Promise<unknown> => {
      await swallow(e.client.task(type, payload));
      if (type === T.keysList01 || type === T.keysList02) return { rooms: [] };
      if (type === T.keysBrowse || type === T.keysBrowse03) return { records: [] };
      if (type === T.keysSeal02) return { sealed: { ciphertext: `sealed:${String(payload.plaintext)}`, nonce: "nonce", epoch: 2 } };
      if (type === T.vaultReceive) return { id: "stored", types: [], status: "valid" };
      if (type === T.vaultQuery) return { credentials: [{ id: `held-${String(payload.type)}`, types: [], status: "valid" }] };
      if (type === T.vaultGet02 || type === T.vaultGet01) return { credential: { credentialSubject: { id: ctx.did } } };
      if (type === T.keysKeyPackage) return { keyPackage: "kp-sample", expiresAt: "2026-12-01T00:00:00Z", alreadyMinted: false };
      if (type === T.keysWelcome) return { epoch: 2 };
      if (type === T.keysBackfill) return { roomId: payload.roomId, earliestReadableEpoch: 1 };
      if ((roomsWire2.KEYS_ACT_TYPES as readonly string[]).includes(type)) {
        const document = payload.document as Doc;
        return { principal: ctx.did, document: { ...document, issuer: ctx.did, proof: { type: "DataIntegrityProof" } } };
      }
      throw new Error(`unexpected agent task ${type}`);
    };
    const communityTask = async (_did: string, type: string): Promise<unknown> => {
      if (type === T.membershipsList) return { items: [{ roomId: SEALED_ROOM, host: SAMPLE_COMMUNITY, label: "Sample room", visibility: "attributed", actions: ["read", "write"], state: "admitted" }] };
      if ((roomsWire2.OFFERS_LIST_TYPES as readonly string[]).includes(type)) return { items: [roomOffer], renewals: [] };
      throw new Error(`unexpected community task ${type}`);
    };
    let ids = 0;
    const backend = {
      agentLinked: () => true,
      agentServedTypes: async () => served,
      agentTask,
      communities: async () => [ROOM_COMMUNITY],
      communityTask,
      sendCompleted: async (_c: string, _r: string, document: Doc) => (document.type === T.offersAccept ? { roomId: (document.payload as Doc).roomId, state: "admitted", epoch: 1, welcome: "welcome-sample" } : { key: (document.payload as Doc).key, version: 1, epoch: 1 }),
      newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
      leaveCommunity: async () => undefined,
      decodeBase64Url: (v: string) => Buffer.from(v, "base64url").toString("utf8"),
      encodeBase64Url: b64,
      hiddenOffers: async () => [],
      hideOffer: async () => undefined,
      warn: noop,
    };
    return new roomsSvc.AgentRoomsService(backend, undefined, { now: () => Date.parse("2026-11-04T00:00:00Z"), sleep: async () => undefined });
  };
  for (const act of roomsWire2.KEYS_ACT_TYPES as string[]) {
    const T = roomsWire2.ROOMS_TASK as Record<string, string>; const S = (k: string): string => T[k] ?? "";;
    flow(`rooms-join-${act.slice(-3)}`, async (e) => {
      const service = roomsWorldOf(e, [S("keysList02"), S("keysKeyPackage"), S("keysWelcome"), S("keysBackfill"), S("vaultReceive"), S("vaultQuery"), S("vaultGet02"), act]);
      const offers = await service.listOffers();
      await swallow(service.acceptOffer((await service.previewOffer(offers[0].offerId)).token));
    });
    flow(`rooms-write-${act.slice(-3)}`, async (e) => {
      const service = roomsWorldOf(e, [S("keysList02"), S("keysBrowse"), S("keysRead"), S("keysSeal02"), act]);
      await swallow(service.confirmWrite((await service.prepareWrite(SEALED_ROOM, { title: "Sample", body: "Sample" })).token));
    });
  }
  flow("rooms-held-01", async (e) => {
    await swallow(roomsWorldOf(e, [roomsWire2.ROOMS_TASK.keysList01]).listMyRooms());
  });
  flow("rooms-held-02", async (e) => {
    await swallow(roomsWorldOf(e, [roomsWire2.ROOMS_TASK.keysList02]).listMyRooms());
  });
  function roomsWorldOf(e: Env, served: string[]) {
    return roomsWorld(e, served);
  }

  const noop = () => undefined;
  // ---------------------------------------------------------------- runner
  /** The capturing session ends a send in `Captured` (a ceremony step that wants the document and nothing more); the emit flows end it in a refusal that walks the ladder. */
  class Captured extends Error {}
  function envFor(recipient: string, answer?: (body: Doc, attempt: number) => never): Env {
    const docs: Doc[] = [];
    const session = {
      isOpen: true,
      sendTo: async (_to: string, msg: { body: Doc }) => {
        docs.push(JSON.parse(JSON.stringify(msg.body)));
        if (answer !== undefined) answer(msg.body, docs.length - 1);
        throw refuse();
      },
      sendTspFrame: async () => {
        throw refuse();
      },
    };
    // The store takes the manager record the key swap writes before it sends (acl/swap-key); the mediator is the one the wallet would
    // resolve from the agent's DID document, here a fixed sample (class D for acl/swap-key: the successor DID is a real peer DID made
    // by the wallet's own createVtiClientDid, against that sample mediator).
    const client = new VtaClient(ctx.agent(), recipient, { getManager: async () => undefined, setManager: async () => undefined }, {});
    client.mediator = { did: "did:web:mediator.example", wsEndpoint: "wss://mediator.example/ws", httpEndpoint: "https://mediator.example" };
    client.session = session;
    client.identity = { did: ctx.did };
    client.carriageByPeer.set(recipient, "didcomm");
    client.replyThreading = "threaded";
    // The community controller on the same capture: its own taskDocument signs with the persona's key.
    vtiAgent.session = session;
    vtiAgent.state = { status: "connected", did: ctx.did };
    vtiAgent.agent = ctx.agent();
    vtiAgent.persona = persona;
    vtiAgent.asks?.clear?.();
    return { ctx, client, vtiAgent, docs, recipient, standIn: new Map<string, string>() };
  }

  const standIns = new Map<string, string>();
  async function runFlow(f: Flow, recipient: string): Promise<Doc[]> {
    const e = envFor(recipient);
    try {
      await f.run(e);
    } catch (err) {
      debug(f.name, err); // every send is refused by the capture
    }
    for (const [t, n] of e.standIn) standIns.set(t, n);
    return e.docs;
  }

  let typeToFlow: Map<string, Flow[]> | undefined;
  const report: Record<string, string[]> = {};
  async function discover(): Promise<Map<string, Flow[]>> {
    if (typeToFlow) return typeToFlow;
    const m = new Map<string, Flow[]>();
    for (const f of flows) {
      const docs = await runFlow(f, DEFAULT_VTA);
      report[f.name] = [...new Set(docs.map((d) => String(d.type)))];
      for (const t of new Set(docs.map((d) => String(d.type)))) m.set(t, [...(m.get(t) ?? []), f]);
    }
    if (process.env.KW_EMIT_REPORT) writeFileSync(process.env.KW_EMIT_REPORT, JSON.stringify(report, null, 1));
    typeToFlow = m;
    return m;
  }
  const evidenceFile = process.env.KW_EMIT_EVIDENCE;
  function evidence(docs: Doc[]): void {
    if (!evidenceFile) return;
    for (const d of docs) {
      const p = d.payload ?? {};
      const notes: string[] = [];
      if (p.entry && typeof p.entry.role === "string") notes.push(`role "${p.entry.role}" chosen by the wallet's builder`);
      if (typeof p.role === "string") notes.push(`role "${p.role}" chosen by the wallet's builder`);
      if (typeof p.module === "string") notes.push("policy module (rego) synthesised by the wallet's builder");
      if (p.entry && typeof p.entry.allowedContexts !== "undefined") notes.push("full admin authority members hard-coded by the wallet's builder");
      for (const n of notes) appendFileSync(evidenceFile, `${JSON.stringify({ type: d.type, note: n })}\n`);
    }
  }

  return {
    types: async () => [...(await discover()).keys()].sort(),
    emit: async (type: string, recipient?: string): Promise<{ docs: Doc[]; standIn: string[] }> => {
      const found = (await discover()).get(type);
      if (!found) throw new Error(`the wallet adapter emits no ${type}`);
      const out: Doc[] = [];
      for (const f of found) {
        const docs = (await runFlow(f, recipient ?? DEFAULT_VTA)).filter((d) => d.type === type);
        out.push(...docs);
        if (docs.length > 0) break;
      }
      evidence(out);
      const note = standIns.get(type);
      return { docs: out.slice(0, 1), standIn: note === undefined ? [] : [note] };
    },
    report: () => report,
    noop,
    /**
     * A ceremony step (FC-KVC): the wallet's own `VtaClient.decideConsent` builds and signs a task-consent decision for the request an executor sent. `refusals` are the
     * executor's earlier refusals of this decision, in order (the real documents the peer sent): attempt n is answered with refusal n as the wallet's own session would
     * deliver it (a VtiRefusal with the code and details), so the wallet's own step-down (`TaskVersions.ask`, `versionAfterRefusal`) decides which rung to build next. The
     * first attempt nothing refuses is captured and returned unsent. Returns the document and the version URIs the wallet tried.
     */
    consentDecision: async (recipient: string, request: { challenge: string; payloadDigest: string }, decision: "approve" | "deny", refusals: Doc[] = []): Promise<{ document: Doc; tried: string[] }> => {
      const e = envFor(recipient, (_body, attempt) => {
        const r = refusals[attempt];
        if (r !== undefined) {
          const pl = (r.payload ?? {}) as Doc;
          throw new VtiRefusal(String(pl.code ?? "unsupportedVersion"), String(pl.message ?? "refused"), pl.details);
        }
        throw new Captured("captured");
      });
      try {
        await e.client.decideConsent(request, decision);
      } catch (err) {
        if (!(err instanceof Captured)) throw err;
      }
      const document = e.docs.at(-1);
      if (document === undefined) throw new Error("the wallet built no consent decision");
      return { document, tried: e.docs.map((d) => String(d.type)) };
    },
  };
}
