// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { checkNonVacuity, gateReason, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { digestMultibase } from "../src/crypto/digest.ts";
import { evidenceErrors, taskDigest, WITNESSED_PREDICATE } from "../src/runner/witness-evidence.ts";
import { substitute } from "../src/runner/build.ts";
import type { BuildContext } from "../src/runner/build.ts";
import { ACTOR_SEEDS, capabilities, isSessionResponse, isSubmitResponse, stateFromReply, vpVariantOf, SESSION_TYPE, SUBMIT_TYPE, SESSION_TYPE_01, SUBMIT_TYPE_01, DISCOVERY_TYPE, DISCOVERY_TYPE_01 } from "../src/adapters/witness-server/shim.ts";
import { launchPlan } from "../src/adapters/witness-server/launcher.ts";
import { makeActors } from "../src/runner/engine.ts";
import { ed25519Signer, seedOf } from "../src/crypto/didkey.ts";
import { FIXTURES, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const wit = { ...suite, files: suite.files.filter((f) => f.file.group === "WIT") };
const vectors = wit.files.flatMap((f) => f.file.vectors);
const run = (adapter: ReferenceAdapter): Promise<SuiteRun> => runSuite({ adapter, suite: wit, tier: 1, today: "2026-11-19", fixtureRoot: FIXTURES, salt: "wit" });

describe("group WIT (witness/session and witness/session/submit)", () => {
  it("has the planned vectors, each citing a specification and each negative one naming a mutant", () => {
    assert.equal(vectors.length, 43);
    for (const v of vectors) assert.ok(v.spec.some((s) => /witness\/session|SPEC\.md/.test(s)), `${v.id} cites no specification`);
    assert.deepEqual(vectors.filter((v) => v.clarify !== null).map((v) => v.id), ["WIT-009", "WIT-029", "WIT-036", "WIT-040", "WIT-041"]);
  });

  it("the reference passes every applicable vector and every CLARIFY vector is observed to pass", async () => {
    const r = await run(new ReferenceAdapter());
    assert.deepEqual(r.results.filter((x) => x.status === "FAIL").map((x) => `${x.id}: ${(x.failures ?? []).join("; ")}`), []);
    for (const x of r.results.filter((y) => y.status === "CLARIFY")) assert.match(x.reason ?? "", /observed: pass/, x.id);
    assert.equal(r.results.filter((x) => x.status === "PASS").length, 38);
  });

  it("every mutant is caught by the vector that names it", async () => {
    const rows = await checkNonVacuity(wit, FIXTURES);
    assert.ok(rows.length >= 38);
    assert.deepEqual(rows.filter((x) => !x.caught).map((x) => `${x.vector}/${x.mutant}`), []);
  });

  it("an implementation that does not serve the witness types gets SKIP, never PASS", async () => {
    const a = new ReferenceAdapter({ witnessTasks: false });
    const caps = await a.capabilities();
    assert.ok(!caps.supportedTypes.some((t) => t.includes("/witness/session")));
    const r = await run(a);
    assert.ok(r.results.every((x) => x.status === "SKIP"));
  });

  it("targets 0.2 (the latest); only WIT-015, WIT-016 and WIT-052 name 0.1, and a 0.1-only witness gets SKIP for the 0.2 vectors", () => {
    const old = capabilities({ commit: "c", bifoldCommit: "b", policy: "offered", shape: "vsc" });
    const g = (c: typeof old, id: string): string | null => gateReason(vectors.find((v) => v.id === id)!, c, 1);
    assert.match(g(old, "WIT-001") ?? "", /type not declared/);
    assert.match(g(old, "WIT-020") ?? "", /type not declared/);
    assert.equal(g(old, "WIT-015"), null);
    assert.equal(g(old, "WIT-052"), null);
    // a server that serves both pairs, as a newer server build does (it declares them in its own SESSION_TYPES and SUBMIT_TYPES)
    const both = capabilities({ commit: "c", bifoldCommit: "b", policy: "offered", shape: "vsc", served: { session: [SESSION_TYPE, SESSION_TYPE_01], submit: [SUBMIT_TYPE, SUBMIT_TYPE_01], discovery: [DISCOVERY_TYPE, DISCOVERY_TYPE_01] } });
    for (const id of ["WIT-001", "WIT-016", "WIT-017", "WIT-020", "WIT-052"]) assert.equal(g(both, id), null, id);
    // a 0.2-only witness (VTI's) runs the 0.2 vectors and skips the 0.1 ones
    const only02 = capabilities({ commit: "c", bifoldCommit: "b", policy: "offered", shape: "vsc", served: { session: [SESSION_TYPE], submit: [SUBMIT_TYPE], discovery: [DISCOVERY_TYPE] } });
    assert.equal(g(only02, "WIT-020"), null);
    for (const id of ["WIT-015", "WIT-016", "WIT-052"]) assert.match(g(only02, id) ?? "", /type not declared/, id);
    const used = new Set(vectors.flatMap((v) => v.spec.concat(v.requires ?? [])).join(" ").match(/witness\/session(\/submit)?\/0\.\d/g));
    assert.deepEqual([...used].sort(), ["witness/session/0.1", "witness/session/0.2", "witness/session/submit/0.1", "witness/session/submit/0.2"]);
    for (const v of vectors) if (!["WIT-015", "WIT-016", "WIT-052"].includes(v.id)) assert.ok(!(v.requires ?? []).some((r) => /\/0\.1$/.test(r)), `${v.id} requires a 0.1 type`);
  });
});

describe("outcome-evidence checks", () => {
  const session = { id: "urn:uuid:s", type: SESSION_TYPE, issuer: "did:key:zA", recipient: "did:key:zW", payload: { parties: ["did:key:zA", "did:key:zB"] }, proof: { proofValue: "zx" } };
  const vwc = { type: ["VerifiableCredential", "DTGCredential", "StatementCredential"], issuer: "did:key:zW", taskContext: "urn:uuid:s", taskDigestMultibase: taskDigest(session), credentialSubject: { id: "did:key:zA", predicate: WITNESSED_PREDICATE }, proof: { proofValue: "zy" } };
  const response = { type: `${SUBMIT_TYPE}#response`, issuer: "did:key:zW", proof: { proofValue: "zz" }, payload: { vwc, vwcDigestMultibase: digestMultibase(vwc) } };
  const all = ["taskContext", "taskDigest", "vwcDigest", "issuerIsResponder", "subjectIsOpener", "statementType", "responseSigned"] as const;

  it("a conforming response passes every check; the task digest ignores the session's proof", () => {
    assert.deepEqual(evidenceErrors(all, response, session), []);
    const { proof: _p, ...unsigned } = session;
    assert.equal(taskDigest(session), taskDigest(unsigned));
  });

  it("each deviation fails exactly its own check", () => {
    const broken = (r: Record<string, unknown>): string[] => evidenceErrors(all, r, session);
    const withVwc = (patch: Record<string, unknown>): Record<string, unknown> => {
      const v = { ...vwc, ...patch };
      return { ...response, payload: { vwc: v, vwcDigestMultibase: digestMultibase(v) } };
    };
    assert.match(broken(withVwc({ taskContext: "urn:uuid:other" })).join(), /taskContext/);
    assert.equal(broken(withVwc({ taskContext: "urn:uuid:other" })).length, 1);
    assert.match(broken(withVwc({ taskDigestMultibase: undefined })).join(), /taskDigest/);
    assert.match(broken(withVwc({ issuer: "did:peer:0zOther" })).join(), /issuerIsResponder/);
    assert.match(broken(withVwc({ credentialSubject: { id: "did:key:zB", predicate: WITNESSED_PREDICATE } })).join(), /subjectIsOpener/);
    assert.match(broken(withVwc({ type: ["VerifiableCredential"] })).join(), /statementType/);
    assert.match(broken({ ...response, payload: { ...(response.payload as object), vwcDigestMultibase: "zQmOther" } }).join(), /vwcDigest/);
    const { proof: _x, ...unsignedResponse } = response;
    assert.match(broken(unsignedResponse).join(), /responseSigned/);
    // a taskContext nested in the credential subject (the placement of the older credential shape) does not satisfy the top-level rule
    assert.match(broken(withVwc({ taskContext: undefined, credentialSubject: { id: "did:key:zA", predicate: WITNESSED_PREDICATE, taskContext: "urn:uuid:s" } })).join(), /taskContext/);
  });
});

describe("witness-server adapter pieces", () => {
  it("declares the types the server build serves (0.1 only when it exports none), no generic carrier, and the presentation helper", () => {
    const caps = capabilities({ commit: "c", bifoldCommit: "b", policy: "offered", shape: "vsc" });
    assert.deepEqual(caps.supportedTypes.filter((t) => t.includes("/witness/")), [SESSION_TYPE_01, SUBMIT_TYPE_01]);
    const latest = capabilities({ commit: "c", bifoldCommit: "b", policy: "offered", shape: "vsc", served: { session: [SESSION_TYPE], submit: [SUBMIT_TYPE], discovery: [DISCOVERY_TYPE] } });
    assert.deepEqual(latest.supportedTypes, [SESSION_TYPE, SUBMIT_TYPE, DISCOVERY_TYPE]);
    assert.ok(isSessionResponse(`${SESSION_TYPE}#response`) && isSessionResponse(`${SESSION_TYPE_01}#response`) && !isSessionResponse(`${SUBMIT_TYPE}#response`));
    assert.ok(isSubmitResponse(`${SUBMIT_TYPE}#response`) && isSubmitResponse(`${SUBMIT_TYPE_01}#response`) && !isSubmitResponse(`${SESSION_TYPE}#response`));
    assert.deepEqual(caps.carriers, []);
    assert.ok(caps.optional.includes("witness.presentation"));
    assert.equal(caps.window?.clockSkewSeconds, 300);
  });
  it("imports the same actor seeds the harness signs with", () => {
    const actors = makeActors();
    // the harness has since gained further actors (B, C, D, F, G, H: governance authority sets), which the witness host does not need: every actor the host imports must exist in the harness with the same key
    for (const [name, byte] of Object.entries(ACTOR_SEEDS)) {
      assert.ok(actors[name] !== undefined, `harness actor ${name}`);
      assert.equal(actors[name]!.vid, ed25519Signer(seedOf(byte)).did, `seed of actor ${name}`);
    }
  });
  it("maps replies to document states and rejects unknown presentation variants", () => {
    assert.equal(stateFromReply(undefined), "accepted");
    assert.equal(stateFromReply("https://trusttasks.org/spec/trust-task-error/0.6"), "errored");
    assert.equal(stateFromReply(`${SESSION_TYPE}#response`), "responded");
    assert.equal(vpVariantOf(undefined), "valid");
    assert.throws(() => vpVariantOf("nonsense"), /unknown presentation variant/);
  });
  it("the launcher runs the host under the server's checkout, read only, with the cache in the temp dir", () => {
    const plan = launchPlan("/kw", "port.txt", "/here");
    assert.equal(plan.command, "nice");
    assert.deepEqual(plan.args.slice(0, 2), ["-n", "10"]);
    assert.ok(plan.args.includes("/here/witness-host.ts"));
    assert.equal(plan.cwd, "/kw/bifold/packages/witness-server");
    assert.equal(plan.env.KW_ROOT, "/kw");
  });
  it("$capJson puts a captured presentation in as a JSON value, and leaves other tokens alone", () => {
    const ctx = { captures: { vpses: JSON.stringify({ holder: "did:key:zA" }) }, iutVid: "did:key:zW", actors: {} } as unknown as BuildContext;
    assert.deepEqual(substitute({ vp: "$capJson(vpses)", to: "$iut" }, ctx), { vp: { holder: "did:key:zA" }, to: "did:key:zW" });
    assert.equal(substitute("$capJson(missing)", ctx), "$capJson(missing)");
  });
});
