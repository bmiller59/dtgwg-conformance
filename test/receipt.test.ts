// SPDX-License-Identifier: Apache-2.0
// Group RCPT: trust-ceremony-receipt verification through the optional `verifyReceipt` adapter method (docs/04 section 11.6).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import { dispatch } from "../src/adapter/contract.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { capabilities as kwCapabilities } from "../src/adapters/keyring-wallet/shim.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { validateReceiptPayload, verifyReceipt } from "../src/adapters/reference/receipt-verifier.ts";
import { toMultibase } from "../src/crypto/base58.ts";
import { parseDigest, sameDigest, stepDigest } from "../src/crypto/stepdigest.ts";
import { jcsBytes } from "../src/util/json.ts";
import { buildReceiptScenario, fixtureDefinition } from "../src/runner/receipt.ts";
import type { BuildContext } from "../src/runner/build.ts";
import { makeActors } from "../src/runner/engine.ts";
import { checkNonVacuity, gateReason, runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { ReceiptSpec } from "../src/vectors/types.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const today = "2026-11-14";
const rcpt = suite.files.find((f) => f.file.group === "RCPT")!.file.vectors;
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const T0 = Date.parse("2026-11-12T10:00:00Z");
const ctx: BuildContext = { vectorId: "RCPT-T", iutVid: "did:key:iut", actors: makeActors(), carrier: "", nowMs: T0, startMs: T0, salt: "t" };
const scenario = (spec: ReceiptSpec = {}): ReturnType<typeof buildReceiptScenario> => buildReceiptScenario(spec, ctx, FIXTURES);
const verdict = (spec: ReceiptSpec = {}, mutants: string[] = []): string => verifyReceipt(scenario(spec).params, T0, new Set(mutants)).outcome;

describe("the step digest (spec.md:93-111)", () => {
  const doc = { id: "urn:uuid:1", type: "https://example.org/t/0.1", payload: { a: 1 }, proof: { type: "DataIntegrityProof", proofValue: "zabc" } };
  const salt = toMultibase(new Uint8Array(32).fill(7));
  const independent = (message: Uint8Array, s: Uint8Array): string => toMultibase(new Uint8Array([0x12, 0x20, ...createHash("sha256").update(Buffer.concat([message, s])).digest()]));
  it("is multibase(multihash(sha2-256(JCS(document) || salt))), over the document including its proof", () => {
    assert.equal(stepDigest(doc, salt), independent(jcsBytes(doc), new Uint8Array(32).fill(7)));
    assert.equal(stepDigest(doc, salt), "z" + stepDigest(doc, salt).slice(1));
  });
  it("differs for a prefix salt, for a document without its proof, and for any change of the document or the salt", () => {
    const base = stepDigest(doc, salt);
    assert.notEqual(stepDigest(doc, salt, { saltAt: "prefix" }), base);
    assert.notEqual(stepDigest(doc, salt, { withoutProof: true }), base);
    assert.notEqual(stepDigest({ ...doc, payload: { a: 2 } }, salt), base);
    assert.notEqual(stepDigest({ ...doc, proof: { ...doc.proof, proofValue: "zabd" } }, salt), base);
    assert.notEqual(stepDigest(doc, toMultibase(new Uint8Array(32).fill(8))), base);
  });
  it("is not the task digest of the framework (the task digest leaves the proof out)", () => {
    const { proof: _p, ...rest } = doc;
    assert.equal(stepDigest(doc, salt, { withoutProof: true }), stepDigest(rest, salt));
  });
  it("parses and compares on decoded bytes", () => {
    const d = stepDigest(doc, salt);
    assert.equal(parseDigest(d)?.code, 0x12);
    assert.equal(parseDigest(stepDigest(doc, salt, { hash: "sha2-512" }))?.code, 0x13);
    const u = "u" + Buffer.from(parseDigest(d) === undefined ? [] : [0x12, 0x20, ...parseDigest(d)!.digest]).toString("base64url");
    assert.ok(sameDigest(d, u));
    assert.ok(!sameDigest(d, stepDigest(doc, salt, { saltAt: "prefix" })));
    assert.equal(parseDigest("not-multibase"), undefined);
  });
});

describe("the receipt payload schema", () => {
  const examples = JSON.parse(readFileSync(join(FIXTURES, "receipt/payload.invalid-examples.json"), "utf8")) as { note: string; payload: unknown }[];
  it("rejects every one of the registry's invalid examples", () => {
    assert.equal(examples.length, 12);
    for (const [i, e] of examples.entries()) assert.notDeepEqual(validateReceiptPayload(e.payload), [], `example ${i + 1}: ${e.note}`);
  });
  it("accepts the payloads the scenario builder produces", () => {
    for (const spec of [{}, { ceremony: "approve" }, { ceremony: "prefix" }, { instances: ["apply", "decide"] }] as ReceiptSpec[]) {
      const receipt = JSON.parse(scenario(spec).params.receipt) as { payload: unknown };
      assert.deepEqual(validateReceiptPayload(receipt.payload), []);
    }
  });
  it("builds a salt of at least 22 characters and definitions in the registry shape", () => {
    assert.ok(scenario().salt.length >= 22);
    const def = fixtureDefinition("approve") as { steps: Record<string, { multiplicity?: string; terminal?: boolean }>; evidence: { recorders: string[] } };
    assert.equal(def.steps.approve!.multiplicity, "perRole");
    assert.deepEqual(def.evidence.recorders, ["recorder", "auditor"]);
  });
});

describe("the reference verifier", () => {
  it("verifies the three fixture enactments complete", () => {
    assert.equal(verdict(), "complete");
    assert.equal(verdict({ ceremony: "approve" }), "complete");
    assert.equal(verdict({ ceremony: "prefix" }), "complete");
  });
  it("tells the four verdicts apart", () => {
    assert.equal(verdict({ hold: "none" }), "unverifiable");
    assert.equal(verdict({ ceremony: "approve", instances: ["propose", "approve@X"] }), "incomplete");
    assert.equal(verdict({ receipt: { sign: null } }), "invalid");
    assert.equal(verdict({ definition: "unresolvable" }), "unverifiable");
  });
  it("is stateless: verifying the same receipt twice gives the same verdict and changes nothing", async () => {
    const a = new ReferenceAdapter();
    const before = await a.snapshot();
    const p = scenario().params;
    assert.equal((await a.verifyReceipt(p)).outcome, (await a.verifyReceipt(p)).outcome);
    assert.deepEqual(await a.diff(before), { changed: false });
  });
  it("is deterministic: the same scenario builds the same bytes", () => {
    assert.deepEqual(scenario().params, scenario().params);
    assert.notEqual(scenario().params.receipt, buildReceiptScenario({}, { ...ctx, salt: "other" }, FIXTURES).params.receipt);
  });
  it("each mutant turns one rule off: a verdict the specification forbids appears", () => {
    assert.equal(verdict({ receipt: { sign: null } }, ["rcptProofOptional"]), "complete");
    assert.equal(verdict({ digest: { saltAt: "prefix" } }, ["rcptSaltPrefix"]), "complete");
    assert.equal(verdict({ digest: { withoutProof: true } }, ["rcptDigestExcludesProof"]), "complete");
    assert.equal(verdict({ ceremony: "approve", instances: ["propose", "approve@X"] }, ["rcptTrustCompleteFlag"]), "complete");
  });
});

describe("vector group RCPT", () => {
  it("has 70 vectors in its own family, every one gated on the optional capability receiptVerify, none with a send step", () => {
    assert.equal(rcpt.length, 70);
    assert.equal(suite.files.find((f) => f.file.group === "RCPT")!.file.family, "ceremony-receipt");
    for (const v of rcpt) {
      assert.deepEqual(v.requires, ["optional:receiptVerify"], v.id);
      assert.ok(v.steps.every((s) => s.verifyReceipt !== undefined), v.id);
    }
  });
  it("is Tier 1 throughout: no stricter rule is gating, and every point the text leaves open is CLARIFY", () => {
    assert.ok(rcpt.every((v) => v.tier === 1 && v.subgroup === undefined));
    const clarify = rcpt.filter((v) => v.clarify !== null).map((v) => v.id);
    assert.equal(clarify.length, 12);
    // a CLARIFY vector asserts nothing the specification states, so it names no mutant
    for (const v of rcpt.filter((x) => x.clarify !== null)) assert.equal(v.mutants, undefined, v.id);
  });
  it("cites a file and line for every Tier 1 vector, and a registry file for the imported rows", () => {
    for (const v of rcpt) assert.ok(v.spec.length > 0 && v.spec.every((s) => /(spec\.md|payload\.schema\.json|payload\.invalid-examples\.json|ceremony\.meta\.schema\.json|SPEC\.md):\d+/.test(s)), `${v.id}: ${v.spec.join(" | ")}`);
    const imported = rcpt.filter((v) => v.origin !== undefined);
    assert.equal(imported.length, 12);
    for (const v of imported) assert.equal(v.origin!.fixture, "receipt/payload.invalid-examples.json");
  });
  it("every negative vector names mutants, every rcpt mutant is used, and each is caught (non-vacuity)", async () => {
    const only = { ...suite, files: suite.files.filter((f) => f.file.group === "RCPT") };
    const rows = await checkNonVacuity(only, FIXTURES);
    assert.ok(rows.length >= 50, String(rows.length));
    assert.deepEqual(rows.filter((r) => !r.caught).map((r) => `${r.vector}:${r.mutant}`), []);
    const used = new Set(rows.map((r) => r.mutant));
    for (const m of Object.keys(MUTANTS).filter((x) => x.startsWith("rcpt"))) assert.ok(used.has(m), `unused mutant ${m}`);
  });
  it("passes the reference adapter at both tiers, plain and attested; the CLARIFY rows report what the reference observes", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 1], [new ReferenceAdapter({ attested: true, name: "reference-attested" }), 2]] as const) {
      const run = await runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, salt: "rc" });
      const r = run.results.filter((x) => x.group === "RCPT");
      assert.equal(r.length, 70);
      assert.deepEqual(r.filter((x) => x.status === "FAIL"), []);
      assert.equal(r.filter((x) => x.status === "PASS").length, 58);
      for (const x of r.filter((y) => y.status === "CLARIFY")) assert.match(x.reason ?? "", /\(observed: pass\)$/, x.id);
    }
  });
  it("is SKIP, never PASS, for an adapter that does not declare receiptVerify (VTI, keyring-wallet, truststackers)", async () => {
    const base = new ReferenceAdapter();
    const bare = Object.create(base) as ReferenceAdapter;
    bare.capabilities = async () => ({ ...(await base.capabilities()), optional: (await base.capabilities()).optional.filter((o) => o !== "receiptVerify") });
    const run = await runSuite({ adapter: bare, suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "rc" });
    const r = run.results.filter((x) => x.group === "RCPT");
    assert.equal(r.length, 70);
    assert.ok(r.every((x) => x.status === "SKIP" && /missing capability optional:receiptVerify/.test(x.reason ?? "")));
    assert.deepEqual(run.results.filter((x) => x.status === "FAIL"), []);
    // the declared capability sets of the other adapters, as they are in this repository, do not include it
    const kw = kwCapabilities({ commit: "c", bifoldCommit: "b", walletTypes: [], consent: true });
    const vtiOptional = ["clockFree", "attested", "discovery.acceptanceWindow"];
    for (const optional of [kw.optional, vtiOptional]) {
      const caps = { ...kw, optional };
      for (const v of rcpt) assert.match(gateReason(v, caps, 1) ?? "", /optional:receiptVerify/, v.id);
    }
  });
  it("a vector of the group fails, not passes, against an adapter that declares the capability and answers wrongly", async () => {
    const base = new ReferenceAdapter();
    const liar = Object.create(base) as ReferenceAdapter;
    liar.verifyReceipt = async () => ({ outcome: "complete" });
    const run = await runSuite({ adapter: liar, suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "rc" });
    const fails = run.results.filter((x) => x.group === "RCPT" && x.status === "FAIL").length;
    assert.ok(fails > 40, String(fails));
  });
  it("the positive vectors are the anchors of the family; a refuse-everything verifier leaves them failing", async () => {
    const base = new ReferenceAdapter();
    const refuser = Object.create(base) as ReferenceAdapter;
    refuser.verifyReceipt = async () => ({ outcome: "invalid" });
    const run = await runSuite({ adapter: refuser, suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "rc" });
    const anchors = run.results.filter((x) => x.group === "RCPT" && x.anchor === true);
    assert.equal(anchors.length, 7);
    assert.ok(anchors.every((x) => x.status === "FAIL"));
  });
});

describe("verifyReceipt on the wire contract", () => {
  it("serves the method over stdio and answers as the in-process adapter does", async () => {
    const cmd = [...NODE, `${ROOT}/src/adapters/example-server/server.ts`, "stdio"].map(q).join(" ");
    const a = rpcAdapterFromSpec(`stdio:${cmd}`);
    try {
      assert.ok((await a.capabilities()).optional.includes("receiptVerify"));
      const p = scenario().params;
      assert.deepEqual(await a.verifyReceipt(p), await new ReferenceAdapter().verifyReceipt(p));
      assert.equal((await a.verifyReceipt(scenario({ receipt: { sign: null } }).params)).outcome, "invalid");
    } finally {
      await a.close();
    }
  });
  it("an adapter without the method answers a JSON-RPC error that says so", async () => {
    const real = new ReferenceAdapter();
    const lacking = { ...Object.fromEntries(["capabilities", "provision", "trust", "setClock", "advance", "send", "trigger", "observe", "restart", "reset", "snapshot", "diff", "verifyProof"].map((k) => [k, (real as unknown as Record<string, unknown>)[k]])) } as unknown as Adapter;
    const res = await dispatch(lacking, { jsonrpc: "2.0", id: 1, method: "verifyReceipt", params: {} });
    assert.ok("error" in res && /not supported/.test(res.error.message));
    const unknown = await dispatch(lacking, { jsonrpc: "2.0", id: 2, method: "verifyReceiptX" });
    assert.ok("error" in unknown && unknown.error.code === -32601);
  });
});
