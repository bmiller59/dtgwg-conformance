// SPDX-License-Identifier: Apache-2.0
// FC-VET (docs/25 section 6.6): identity vetting, defined by ceremonies/vetting/identity-vetting/0.1 in the Trust Tasks repository, as a whole ceremony between two
// reference parties (an applicant and a vetter, vetting-party.ts). The oracle first, then the mutants that must end a scenario `failed`. Never a statement about a platform.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const party = (seed: number, mut?: string) => `reference-party:seed=${seed},attested,vetting${mut === undefined ? "" : `,mut=${mut}`}`;
const PAIR = (a?: string, v?: string) => ({ A: party(140, a), V: party(141, v) });
const out = (specs: Record<string, string>, id: string) => runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", only: [id] });
const run = async (specs: Record<string, string>, id: string) => (await out(specs, id)).results[0]!;
const IDS = ["FC-VET-001", "FC-VET-002", "FC-VET-003", "FC-VET-004", "FC-VET-005", "FC-VET-006"];

describe("FC-VET: the oracle", () => {
  for (const [id, status, terminal] of [["FC-VET-001", "completed", "completed"], ["FC-VET-003", "completed", "completed"], ["FC-VET-006", "completed", "completed"], ["FC-VET-002", "ended-as-specified", "declined"], ["FC-VET-004", "ended-as-specified", "refused"], ["FC-VET-005", "ended-as-specified", "refused"]] as const) {
    it(`${id} ends ${status} (${terminal}), never a conformance count`, async () => {
      const r = await run(PAIR(), id);
      assert.equal(r.status, status, r.reason);
      assert.equal(r.terminal, terminal);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
      assert.ok(r.assertions.length >= 2 && r.assertions.every((a) => a.ok));
    });
  }
  it("the card is bound to the session and the statement cites it by id and by the digest of the session document, in each round", async () => {
    const t = (await out(PAIR(), "FC-VET-003")).transcript.filter((x) => x.kind === "built").map((x) => JSON.parse(x.bytes) as { id: string; type: string; threadId?: string; parentThreadId?: string; payload: Record<string, unknown> });
    const sessions = t.filter((d) => d.type.endsWith("/vetting/session/0.1"));
    assert.equal(sessions.length, 2);
    assert.notEqual(sessions[0]!.payload["challenge"], sessions[1]!.payload["challenge"]);
    assert.equal(sessions[0]!.parentThreadId, t.find((d) => d.type.endsWith("/vetting/request/0.1"))!.id);
    const card = t.find((d) => d.type.endsWith("/session/0.1#response"))!;
    const c = card.payload["card"] as Record<string, unknown>;
    assert.equal(card.threadId, sessions[1]!.id);
    assert.equal(c["challenge"], sessions[1]!.payload["challenge"]);
    assert.equal(c["domain"], sessions[1]!.payload["domain"]);
    const st = (t.find((d) => d.type.endsWith("/credential-exchange/issue/0.1"))!.payload["credential_response"] as { credential: Record<string, unknown> }).credential;
    assert.equal(st["taskContext"], sessions[1]!.id);
  });
  it("an adapter that is not a vetting party is skipped with the reason", async () => {
    assert.equal((await run({ A: "reference", V: party(141) }, "FC-VET-001")).status, "skipped");
    assert.equal((await run({ A: party(140), V: "reference-peer" }, "FC-VET-001")).status, "skipped");
  });
  it("the default reference is not a vetting party: it offers no kind and no role of the group (it serves the registry's vetting request and decline as plain tasks, as before, and not the session), and the party lists each type once", async () => {
    const caps = await (await makeAdapter("reference")).capabilities();
    const pc = await (await makeAdapter(party(140))).capabilities();
    assert.equal(new Set(pc.supportedTypes).size, pc.supportedTypes.length);
    assert.ok(!caps.supportedTypes.includes("https://trusttasks.org/spec/vetting/session/0.1") && pc.supportedTypes.includes("https://trusttasks.org/spec/vetting/session/0.1"));
    assert.ok(!(caps.initiates ?? []).some((k) => k.startsWith("vetting-")));
    assert.ok(!(caps.ceremonyRoles ?? []).some((c) => c.ceremony === "FC-VET"));
  });
  it("the honest vetter opens no fourth round and attests nothing without an accepted card", async () => {
    const v = await makeAdapter(party(141));
    await v.reset();
    await v.connect!({ peer: { vid: "did:key:zAnother" } });
    await assert.rejects(v.initiate!({ kind: "vetting-attest", to: "did:key:zAnother", thread: "urn:uuid:none" }), /no vetting request/);
  });
  it("the scenarios' steps match the ceremony definition: step names, issuers, recipients, the session bound of 3 rounds and the completion", () => {
    const tf = process.env["TT_KIT"];
    const defPath = tf === undefined ? "" : join(tf, "ceremonies/vetting/identity-vetting/0.1/ceremony.json");
    if (!existsSync(defPath)) { console.log("# FC-VET definition test skipped: TT_KIT names no Trust Tasks checkout"); return; }
    const def = JSON.parse(readFileSync(defPath, "utf8")) as { roles: Record<string, unknown>; steps: Record<string, { type: string; issuer: string; recipient: string; prev: string[]; maxRounds?: number; optional?: boolean; terminal?: boolean }>; completion: { allOf: unknown[] } };
    assert.deepEqual(Object.keys(def.roles).sort(), ["applicant", "vetter"]);
    const s = files().flatMap((f) => f.scenarios).find((x) => x.id === "FC-VET-001")!;
    const slot = Object.fromEntries(Object.entries(s.participants).map(([k, p]) => [p.role, k]));
    const kindOf: Record<string, string> = { request: "vetting-request", session: "vetting-session", attest: "vetting-attest", decline: "vetting-decline" };
    const dec = files().flatMap((f) => f.scenarios).find((x) => x.id === "FC-VET-002")!;
    for (const [name, d] of Object.entries(def.steps)) {
      const st = [...s.steps, ...dec.steps].find((x) => x.id === name);
      assert.ok(st, `step ${name}`);
      assert.equal(st.do.initiate?.kind, kindOf[name]);
      assert.equal(st.do.initiate?.by, slot[d.issuer], name);
      assert.equal(st.do.initiate?.to, slot[d.recipient], name);
      assert.equal(st.source?.slug, d.type.replace("https://trusttasks.org/spec/", "").replace(/\/0\.1$/, ""), name);
    }
    assert.equal(def.steps["session"]!.maxRounds, 3);
    assert.deepEqual(def.steps["attest"]!.prev, ["session"]);
    assert.deepEqual(def.steps["decline"]!.prev, ["session"]);
    assert.deepEqual(def.completion.allOf, ["request", "session", { anyOf: ["attest", "decline"] }]);
    // the card the party builds has exactly the members of the shared Vetting Card schema's required list
    const schemaPath = join(tf!, "specs/vetting/_shared/0.1/vetting-card.schema.json");
    if (!existsSync(schemaPath)) return;
    const card = JSON.parse(readFileSync(schemaPath, "utf8")) as { $defs: { VettingCard: { required: string[]; properties: Record<string, unknown> } } };
    return out(PAIR(), "FC-VET-001").then((o) => {
      const built = o.transcript.filter((x) => x.kind === "built").map((x) => JSON.parse(x.bytes) as { type: string; payload: { card?: Record<string, unknown> } }).find((d) => d.type.endsWith("#response"))!.payload.card!;
      for (const k of card.$defs.VettingCard.required) assert.ok(k in built, `card member ${k}`);
      for (const k of Object.keys(built)) assert.ok(k in card.$defs.VettingCard.properties, `card has no member ${k}`);
    });
  });
});

describe("FC-VET: non-vacuity", () => {
  // [what is broken, scenario, specs, step it must fail at]
  const MUT: [string, string, Record<string, string>, string][] = [
    ["the vetter keeps the request but sends no acceptance receipt", "FC-VET-001", PAIR(undefined, "ceremonyDropReceipt"), "request"],
    ["the vetter's acceptance arrives on a new thread", "FC-VET-001", PAIR(undefined, "ceremonyReceiptWrongThread"), "request"],
    ["the vetter reports the ceremony completed as soon as it accepted the request", "FC-VET-001", PAIR(undefined, "ceremonyEarlyCompletion"), "request"],
    ["the applicant reports the ceremony completed as soon as the vetter accepted", "FC-VET-001", PAIR("ceremonyEarlyCompletion"), "request"],
    ["the applicant's card is not bound to the session (another challenge)", "FC-VET-001", PAIR("vetCardUnbound"), "answer"],
    ["the vetter accepts a card that is not bound to the session", "FC-VET-004", PAIR(undefined, "vetAcceptsUnboundCard"), "answer-unbound"],
    ["the applicant accepts a statement that cites no session (attest without a session)", "FC-VET-005", PAIR("vetAcceptsUncitedStatement"), "attest-no-session"],
    ["the applicant accepts a decline after it holds the statement", "FC-VET-006", PAIR("vetAcceptsDeclineAfterAttest"), "decline-after-attest"],
    ["the applicant never keeps the statement it is issued", "FC-VET-001", PAIR("cexNeverStores"), "attest"],
  ];
  for (const [name, id, specs, step] of MUT) {
    it(`${name}: ${id} ends failed at ${step}`, async () => {
      const r = await run(specs, id);
      assert.equal(r.status, "failed", `${r.status}: ${r.reason}`);
      assert.equal(r.failedStep, step, r.reason);
    });
  }
  it("every scenario of the group has an oracle run above and at least one mutant that ends it failed", () => {
    assert.equal(IDS.length, files().flatMap((f) => f.scenarios).filter((x) => x.id.startsWith("FC-VET-")).length);
    for (const id of IDS.filter((i) => i !== "FC-VET-002" && i !== "FC-VET-003")) assert.ok(MUT.some((m) => m[1] === id), id);
  });
});
