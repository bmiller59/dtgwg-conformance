// SPDX-License-Identifier: Apache-2.0
// Tier 1 audit applied: Tier 2 sub-groups, advisories (SHOULD mismatches), the declared window in the matrix, and the BND-002 exception.
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, describe, it } from "node:test";
import { rpcAdapterFromSpec } from "../src/adapter/client.ts";
import type { Adapter } from "../src/adapter/contract.ts";
import { serveHttp } from "../src/adapter/server.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { holdErrors, validateReply, type EngineEnv } from "../src/runner/engine.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { exitCode, gateReason, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { loadExceptions, loadSuite } from "../src/vectors/load.ts";
import { SUBGROUPS } from "../src/vectors/types.ts";
import type { Vector } from "../src/vectors/types.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { FIXTURES, ROOT, VECTORS } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const all = suite.files.flatMap((f) => f.file.vectors);
const byId = new Map(all.map((v) => [v.id, v]));
const today = "2026-11-13";
const NODE = [process.execPath, "--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const run = (adapter: Adapter, tier: 1 | 2, extra: Partial<Parameters<typeof runSuite>[0]> = {}): Promise<SuiteRun> => runSuite({ adapter, suite, tier, today, fixtureRoot: FIXTURES, ...extra });
const result = (r: SuiteRun, id: string) => r.results.find((x) => x.id === id)!;

const servers: Server[] = [];
after(() => {
  for (const s of servers) s.close();
});

describe("Tier 2 sub-groups", () => {
  it("every Tier 2 vector names one sub-group, no Tier 1 vector has one, and the moved vectors are where the audit decided", () => {
    for (const v of all) {
      if (v.tier === 2) assert.ok((SUBGROUPS as readonly string[]).includes(v.subgroup ?? ""), v.id);
      else assert.equal(v.subgroup, undefined, v.id);
    }
    const group = (g: string): string[] => all.filter((v) => v.subgroup === g).map((v) => v.id).sort();
    const range = (prefix: string, ns: number[]): string[] => ns.map((n) => `${prefix}-${String(n).padStart(3, "0")}`);
    assert.deepEqual(group("profile-window"), [...range("DUP", [110, 111, 112, 113]), ...range("TIME", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 17, 18, 19, 20])].sort());
    assert.deepEqual(group("profile-ceremony"), ["2PC-001", "2PC-004", "2PC-005", "CER-003", "CER-008", "CER-009", "CER-014", "TIME-103"]);
    assert.deepEqual(group("profile-witness-share"), ["WSH-001", "WSH-002", "WSH-003", "WSH-004", "WSH-005", "WSH-013", "WSH-017", "WSH-025"]);
    assert.deepEqual(group("profile-p384"), ["PRF-003", "PRF-005"]);
    for (const id of ["TIME-012", "TIME-016", "TIME-021", "BND-007"]) assert.equal(byId.get(id)!.subgroup, "attested", id);
    for (const id of ["TIME-013", "TIME-014", "TIME-023", "TIME-024"]) {
      assert.equal(byId.get(id)!.tier, 1, id);
      assert.equal(byId.get(id)!.profileWindow, undefined, id);
    }
    for (const id of ["TIME-101", "TIME-102", "TIME-104", "TIME-105", "CER-001", "CER-002", "CER-005", "CER-015", "2PC-003", "2PC-006", "2PC-007", "BND-004"]) assert.equal(byId.get(id)!.tier, 1, id);
  });
  it("the validator refuses a Tier 2 vector without a sub-group and a Tier 1 vector with one", () => {
    const file = JSON.parse(JSON.stringify(suite.files[0]!.file)) as { vectors: Record<string, unknown>[] };
    file.vectors[0]!.tier = 2;
    assert.match(validateVectorFile(file).join("\n"), /names its sub-group/);
    file.vectors[0]!.tier = 1;
    file.vectors[0]!.subgroup = "attested";
    assert.match(validateVectorFile(file).join("\n"), /no sub-group/);
  });
  it("a profile sub-group runs for an implementation that does not claim attested; the attested sub-group does not", () => {
    const caps = { optional: ["clock"], tierMax: 1, carriers: [{ class: "consequential" }], bindings: [], cryptosuites: [], supportedTypes: [] } as unknown as Parameters<typeof gateReason>[1];
    const mk = (subgroup: Vector["subgroup"]): Vector => ({ id: "X-001", title: "t", tier: 2, subgroup, spec: [], clarify: null, steps: [{ send: { template: "carrier.request" } }] });
    assert.match(gateReason(mk("attested"), caps, 2)!, /claims tier 1/);
    assert.equal(gateReason(mk("profile-ceremony"), caps, 2), null);
    assert.match(gateReason(mk("profile-ceremony"), caps, 1)!, /not selected/);
  });
});

describe("advisories: a SHOULD mismatch is reported, never a Tier 1 failure, never hidden", () => {
  const advisoryFor = async (mutant: string, id: string, tier: 1 | 2, attested: boolean) => result(await run(new ReferenceAdapter({ attested, mutants: [mutant] }), tier), id);
  it("a wrong reply thread or a swapped recipient is an advisory at Tier 1 and a failure on the attested profile", async () => {
    for (const mutant of ["wrongReplyThread", "swapRecipientInReply"]) {
      const t1 = await advisoryFor(mutant, "RSP-001", 1, false);
      assert.equal(t1.status, "PASS", mutant);
      assert.ok((t1.advisories ?? []).length > 0, mutant);
      const t2 = await advisoryFor(mutant, "RSP-001", 2, true);
      assert.equal(t2.status, "FAIL", mutant);
    }
  });
  it("a hold without inResponseTo and a default retryable that differs are advisories, a non-boolean retryable stays a failure", async () => {
    assert.ok(((await advisoryFor("holdNoInResponseTo", "VRC-PRO-008", 1, false)).advisories ?? []).length > 0);
    assert.equal((await advisoryFor("holdNoInResponseTo", "VRC-PRO-008", 1, false)).status, "PASS");
    assert.equal((await advisoryFor("retryableAlways", "ERR-005", 1, false)).status, "CLARIFY");
    assert.ok(((await advisoryFor("retryableAlways", "ERR-005", 1, false)).advisories ?? []).length > 0);
    assert.equal((await advisoryFor("errorWithoutRetryable", "ERR-001", 1, false)).status, "FAIL");
  });
  it("2PC-007's 409 for idConflict and 202 for an in-progress duplicate are status-table SHOULDs (bindings/https 0.3 section 4, 5.1 item 4): an advisory at Tier 1, a failure on the attested profile (O-11)", async () => {
    const t1 = await advisoryFor("httpStatusFlat", "2PC-007", 1, false);
    assert.equal(t1.status, "PASS");
    assert.ok((t1.advisories ?? []).some((a) => /expected 409/.test(a)), JSON.stringify(t1.advisories));
    assert.equal((await advisoryFor("httpStatusFlat", "2PC-007", 2, true)).status, "FAIL");
    const sw = await advisoryFor("httpDuplicateStatusSwapped", "2PC-007", 1, false);
    assert.equal(sw.status, "PASS");
    assert.ok((sw.advisories ?? []).some((a) => /expected 202/.test(a)), JSON.stringify(sw.advisories));
    assert.equal((await advisoryFor("httpDuplicateStatusSwapped", "2PC-007", 2, true)).status, "FAIL");
    assert.equal(byId.get("TIME-022")!.profileWindow, undefined);
  });
  it("the reference records no advisory at any tier", async () => {
    for (const [adapter, tier] of [[new ReferenceAdapter(), 1], [new ReferenceAdapter(), 2], [new ReferenceAdapter({ attested: true }), 1], [new ReferenceAdapter({ attested: true }), 2]] as const) {
      const r = await run(adapter, tier);
      assert.deepEqual(r.results.filter((x) => (x.advisories ?? []).length > 0), []);
      assert.equal(exitCode([r]), 0);
    }
  });
  it("validateReply keeps the next-step thread and the identityMismatch routing as failures, and files the rest as advisories", () => {
    const env = { caps: { optional: [] }, iutVid: "did:key:iut", tier: 1 } as unknown as EngineEnv;
    const request = { id: "urn:uuid:1", type: "https://x.example/spec/c/begin/0.1", issuer: "did:key:a", threadId: "urn:uuid:1" };
    const adv: string[] = [];
    const reply = (type: string, threadId: string): string => JSON.stringify({ id: "urn:uuid:2", type, threadId, issuer: "did:key:iut", recipient: "did:key:other", payload: {} });
    const errs = validateReply(reply("https://x.example/spec/c/begin/0.1#response", "urn:uuid:other"), request, { kind: "actor", vid: "did:key:a" }, env, 0, { push: (m) => adv.push(m) });
    assert.deepEqual(errs, []);
    assert.equal(adv.length, 2); // thread and recipient
    const hard = validateReply(reply("https://trusttasks.org/spec/trust-task-next-step/0.1", "urn:uuid:other"), request, { kind: "actor", vid: "did:key:a" }, env, 0, { push: (m) => adv.push(m) });
    assert.ok(hard.some((e) => /threadId/.test(e)));
  });
  it("a hold's inResponseTo and a declared status task are advisories through the soft collector", () => {
    const request = { id: "urn:uuid:1", type: "https://x.example/spec/c/begin/0.1" };
    const soft: string[] = [];
    const errs = holdErrors({ payload: { expects: [{ typeUri: "https://x.example/spec/c/begin/0.1" }] } }, request, "https://x.example/spec/c/status/0.1", (m) => soft.push(m));
    assert.deepEqual(errs, []);
    assert.equal(soft.length, 2);
  });
  it("a duplicate answered with an equivalent response is an advisory; one answered with anything else fails (DUP-001)", async () => {
    const eq = result(await run(new ReferenceAdapter({ mutants: ["duplicateEquivalentResponse"] }), 1), "DUP-001");
    assert.equal(eq.status, "PASS");
    assert.ok((eq.advisories ?? []).some((a) => /equivalent response/.test(a)));
    assert.equal(result(await run(new ReferenceAdapter({ mutants: ["duplicateAsFailure"] }), 1), "DUP-001").status, "FAIL");
  });
  it("advisories reach the matrix, the window is always printed, and the Tier 2 sub-groups are listed", async () => {
    const r = await run(new ReferenceAdapter({ mutants: ["wrongReplyThread"], name: "mutant" }), 1);
    const md = matrixMarkdown(buildMatrix([r]));
    assert.match(md, /Advisories, mutant: [1-9]\d* SHOULD mismatch/);
    assert.match(md, /Window, mutant: maxAgeSeconds 300, clockSkewSeconds 60, expiryHorizonSeconds 2592000 \(equal to the profile pins/);
    const clean = matrixMarkdown(buildMatrix([await run(new ReferenceAdapter(), 2)]));
    assert.match(clean, /Advisories, reference: 0 SHOULD mismatch/);
    assert.match(clean, /Tier 2 sub-groups, reference .*profile-window 20\/0\/0\/0\/0/);
    const wide = matrixMarkdown(buildMatrix([await run(new ReferenceAdapter({ window: { maxAgeSeconds: 600 }, name: "w10" }), 1)]));
    assert.match(wide, /Window, w10: maxAgeSeconds 600,.*differs from the profile pins/);
  });
  it("VRC-ISS-020 accepts an idempotent receipt or a task-specific refusal, with one stored credential", () => {
    assert.deepEqual(byId.get("VRC-ISS-020")!.steps.at(-1)!.expect!.orRefusal, ["vrc/relationships/issue:alreadyIssued", "vrc/relationships/issue:notAccepted"]);
  });
  it("DUP-103 needs the carrier:openPayload capability, which a closed-payload implementation does not declare", async () => {
    assert.ok((byId.get("DUP-103")!.requires ?? []).includes("carrier:openPayload"));
    assert.ok((await new ReferenceAdapter().capabilities()).carriers.some((c) => c.class === "openPayload"));
    assert.ok(!(await new ReferenceAdapter({ attested: true }).capabilities()).carriers.some((c) => c.class === "openPayload"));
  });
  it("expired documents use skew-aware offsets (ERR-001, VRC-ISS-013, BND-004, BND-007)", () => {
    for (const id of ["ERR-001", "VRC-ISS-013", "BND-004", "BND-007"]) assert.match(JSON.stringify(byId.get(id)!.steps), /nowAt\(-windowSkew,-10s\)/, id);
  });
});

describe("the BND-002 exception for the existing VTI implementation", () => {
  const all = loadExceptions(`${ROOT}/exceptions/exceptions.json`).exceptions;
  // The VTI row also holds the entries the live run recorded (proofInvalid and the purpose pin); they are stale for a reference adapter that
  // merely carries the VTI name, so these tests load the BND-002 entry alone.
  // The mutant below routes the mismatch error to the contested issuer (a MUST at bindings/https/0.3 :131), a failure of BND-002 other than the one VTI recorded, so the entry is used without its expectFailure.
  const excs = all.filter((e) => e.vector === "BND-002" || e.impl !== "verifiable-trust-infrastructure").map(({ expectFailure: _, ...e }) => e);
  it("is one BND-002 entry, owner unassigned, with a short expiry, for the VTI row only; every VTI entry is unassigned and expires soon", () => {
    // other implementations' rows (keyring-wallet) hold their own entries in the same file
    const vtiOnly = excs.filter((e) => e.impl === "verifiable-trust-infrastructure");
    assert.equal(vtiOnly.length, 1);
    for (const e of all.filter((y) => y.impl === "verifiable-trust-infrastructure")) assert.ok(e.owner === "unassigned" && e.expires > today && e.expires <= "2027-01-31", e.vector);
    const x = vtiOnly[0]!;
    assert.deepEqual([x.impl, x.vector, x.owner], ["verifiable-trust-infrastructure", "BND-002", "unassigned"]);
    assert.ok(x.expires > today && x.expires <= "2027-01-31", x.expires);
  });
  it("leaves the reference adapter untouched: it still passes BND-002 with the exceptions loaded", async () => {
    const r = await run(new ReferenceAdapter(), 1, { exceptions: excs });
    assert.equal(result(r, "BND-002").status, "PASS");
    assert.equal(exitCode([r]), 0);
  });
  it("records a VTI-named implementation that fails BND-002 as KNOWN-FAIL, and an expired entry fails the run", async () => {
    const vti = (): ReferenceAdapter => new ReferenceAdapter({ mutants: ["mismatchRoutedToIssuer"], name: "verifiable-trust-infrastructure" });
    const r = await run(vti(), 1, { exceptions: excs });
    assert.equal(result(r, "BND-002").status, "KNOWN-FAIL");
    // only BND-002 is excepted, and only for this implementation; the mutant also fails the framework vectors that check the same MUST (ID-002, VRC-PRO-015) and WIT-011, its witness-session counterpart
    const failed = r.results.filter((x) => x.status === "FAIL").map((x) => x.id);
    assert.deepEqual(failed, ["ID-002", "VRC-PRO-015", "WIT-011"]);
    assert.equal(result(await run(new ReferenceAdapter({ mutants: ["mismatchRoutedToIssuer"], name: "other-implementation" }), 1, { exceptions: excs }), "BND-002").status, "FAIL");
    // the recorded entry states the VTI failure (expectFailure); the mutant fails BND-002 another way, so with it the result is FAIL
    const asRecorded = await run(vti(), 1, { exceptions: all.filter((e) => e.vector === "BND-002" && e.impl === "verifiable-trust-infrastructure") });
    assert.equal(result(asRecorded, "BND-002").status, "FAIL");
    assert.match(result(asRecorded, "BND-002").reason ?? "", /does not match the observed failure/);
    const late = await run(vti(), 1, { exceptions: excs, today: "2027-02-01" });
    assert.equal(result(late, "BND-002").status, "FAIL");
  });
});

describe("in-process, stdio and HTTP give identical results, advisories included", () => {
  it("for a mutant that records advisories, at both tiers", async () => {
    const mk = (): ReferenceAdapter => new ReferenceAdapter({ mutants: ["wrongReplyThread", "swapRecipientInReply"], name: "reference" });
    const s = await serveHttp(mk(), 0);
    servers.push(s);
    const addr = s.address();
    const http = rpcAdapterFromSpec(`http:http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/rpc`);
    const stdio = rpcAdapterFromSpec(`stdio:${NODE.map(q).join(" ")} ${q(`${ROOT}/src/adapters/example-server/server.ts`)} stdio --mutant wrongReplyThread,swapRecipientInReply`);
    try {
      for (const tier of [1, 2] as const) {
        const a = await run(mk(), tier, { salt: "" });
        assert.ok(a.results.some((x) => (x.advisories ?? []).length > 0));
        assert.deepEqual((await run(stdio, tier, { salt: "" })).results, a.results);
        assert.deepEqual((await run(http, tier, { salt: "" })).results, a.results);
      }
    } finally {
      await stdio.close();
    }
  });
});
