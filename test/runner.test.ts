// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import type { Adapter } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { EXPECT_FAILURE_MISMATCH, exceptionApplies, exitCode, gateDecision, gateReason, runSuite, unmatchedExpectations } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { ExceptionEntry } from "../src/vectors/types.ts";
import { FIXTURES, ROOT, VECTORS, tempDir } from "./helpers.ts";

const suite = loadSuite(VECTORS);
const run = (adapter: Adapter, tier: 1 | 2, exceptions: ExceptionEntry[] = [], today = "2026-11-13") =>
  runSuite({ adapter, suite, tier, exceptions, today, fixtureRoot: FIXTURES });
const status = (r: Awaited<ReturnType<typeof run>>, id: string) => r.results.find((x) => x.id === id)?.status;

describe("capability gating", () => {
  it("gateReason covers type, carrier, optional, cryptosuite and tier", async () => {
    const caps = await new ReferenceAdapter().capabilities();
    const v = (over: object) => ({ id: "X-001", title: "", tier: 1, spec: ["s"], clarify: null, steps: [], ...over }) as never;
    assert.match(gateReason(v({ requires: ["https://trusttasks.org/spec/vrc/relationships/nonexistent/0.1"] }), caps, 1)!, /type not declared/);
    assert.match(gateReason(v({ requires: ["carrier:read"] }), caps, 1)!, /carrier:read/);
    assert.match(gateReason(v({ requires: ["optional:nonexistent"] }), caps, 1)!, /optional:nonexistent/);
    assert.match(gateReason(v({ requires: ["cryptosuite:ecdsa-jcs-2019"] }), caps, 1)!, /cryptosuite/);
    assert.match(gateReason(v({ tier: 2 }), caps, 2)!, /claims tier 1/);
    assert.match(gateReason(v({ tier: 2 }), caps, 1)!, /not selected/);
    assert.match(gateReason(v({ exactTier: true }), caps, 2)!, /only runs at tier 1/);
    assert.match(gateReason(v({ skipIfOptional: ["clock"] }), caps, 1)!, /declares optional clock/);
    assert.equal(gateReason(v({ requires: ["carrier:consequential"] }), caps, 1), null);
  });
  it("the ES256 proof fixtures are SKIP for the Ed25519-only reference", async () => {
    const r = await run(new ReferenceAdapter(), 2);
    const skipped = r.results.filter((x) => x.status === "SKIP" && x.group === "PRF" && /cryptosuite/.test(x.reason ?? ""));
    assert.equal(skipped.length, 4); // PRF-003 and PRF-005 (P-384) need their own capability, cryptosuite:ecdsa-jcs-2019:P-384
    assert.match(skipped[0]!.reason!, /cryptosuite/);
  });
  it("an adapter that declares no carrier skips every wire vector but still runs helper-layer proof vectors", async () => {
    const base = new ReferenceAdapter();
    const bare = new Proxy(base, {
      get(t, p, rcv) {
        if (p === "capabilities") return async () => ({ ...(await t.capabilities()), name: "bare", carriers: [], supportedTypes: [] });
        const val = Reflect.get(t, p, rcv) as unknown;
        return typeof val === "function" ? (val as (...a: unknown[]) => unknown).bind(t) : val;
      },
    }) as Adapter;
    const r = await run(bare, 1);
    assert.equal(status(r, "ENV-001"), "SKIP");
    assert.equal(status(r, "DUP-001"), "SKIP");
    assert.equal(status(r, "PRF-001"), "PASS");
    assert.equal(exitCode([r]), 0);
  });
});

describe("tier selection", () => {
  it("tier 1 never runs tier 2 vectors; tier 2 leaves out exact-tier-1 vectors; both are recorded apart, never SKIP (R9)", async () => {
    const t1 = await run(new ReferenceAdapter({ attested: true, name: "att" }), 1);
    assert.equal(status(t1, "PRF-103"), undefined);
    assert.deepEqual(t1.excludedByTier!.find((e) => e.id === "PRF-103"), { id: "PRF-103", reason: "tier 2 not selected", channel: "registry" });
    assert.ok(t1.results.every((x) => x.status !== "SKIP" || !/^(tier [0-9] not selected|only runs at tier)/.test(x.reason ?? "")));
    const t2 = await run(new ReferenceAdapter({ attested: true, name: "att" }), 2);
    assert.equal(status(t2, "PRF-108"), undefined);
    assert.equal(t2.excludedByTier!.find((e) => e.id === "PRF-108")?.reason, "only runs at tier 1");
    // the matrix lists them apart, and counts none of them as SKIP
    const m = buildMatrix([t1]);
    assert.equal(m.rows[0]!.excludedByTier, t1.excludedByTier!.filter((e) => e.channel === "registry").length);
    assert.match(matrixMarkdown(m), /Excluded by tier, att: \d+ vector\(s\) outside the selected tier/);
    assert.equal(status(t2, "PRF-103"), "PASS");
  });
});

describe("exceptions: KNOWN-FAIL, stale and expired", () => {
  const exc = (over: Partial<ExceptionEntry> = {}): ExceptionEntry => ({
    impl: "reference+noRecipientCheck", vector: "ID-001", reason: "recipient check not implemented", owner: "maintainer-x", expires: "2027-03-01", acknowledged: null, ...over,
  });
  it("a failing vector with a live exception is KNOWN-FAIL and does not gate", async () => {
    // The mutant also breaks every other recipient-check vector (the ceremony pipelines), so each carries an exception.
    const broken = (await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1)).results.filter((x) => x.status === "FAIL").map((x) => x.id);
    assert.ok(broken.includes("ID-001") && broken.length > 1);
    const r = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, broken.map((vector) => exc({ vector })));
    assert.equal(status(r, "ID-001"), "KNOWN-FAIL");
    assert.match(r.results.find((x) => x.id === "ID-001")!.reason!, /maintainer-x/);
    assert.match(r.results.find((x) => x.id === "ID-001")!.reason!, /expires 2027-03-01, unacknowledged\)$/);
    assert.equal(exitCode([r]), 0);
    const acked = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, broken.map((vector) => exc({ vector, acknowledged: { by: "platform-x maintainers", on: "2026-11-16", ref: "challenges/x.md" } })));
    assert.match(acked.results.find((x) => x.id === "ID-001")!.reason!, /acknowledged by platform-x maintainers on 2026-11-16\)$/);
  });
  it("without the exception the same run is FAIL and gates", async () => {
    const r = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1);
    assert.equal(status(r, "ID-001"), "FAIL");
    assert.equal(exitCode([r]), 1);
  });
  it("an exception for a vector that now passes is itself a FAIL (stale)", async () => {
    const r = await run(new ReferenceAdapter(), 1, [exc({ impl: "reference" })]);
    assert.equal(status(r, "ID-001"), "FAIL");
    assert.match(r.results.find((x) => x.id === "ID-001")!.reason!, /stale/);
  });
  it("expectFailure: a failure that matches is KNOWN-FAIL; a failure for another reason is FAIL (docs/04 section 8)", async () => {
    const broken = (await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1)).results.filter((x) => x.status === "FAIL");
    const id1 = broken.find((x) => x.id === "ID-001")!;
    assert.ok(id1.failures !== undefined && id1.failures.length > 0);
    const others = broken.filter((x) => x.id !== "ID-001").map((x) => exc({ vector: x.id }));
    const anchored = `^${id1.failures[0]!.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")}$`;
    const ok = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, [...others, exc({ expectFailure: { failures: [anchored] } })]);
    assert.equal(status(ok, "ID-001"), "KNOWN-FAIL");
    assert.equal(exitCode([ok]), 0);
    const other = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, [...others, exc({ expectFailure: { failures: [anchored, "^step 9: a failure this vector never reports$"] } })]);
    assert.equal(status(other, "ID-001"), "FAIL");
    const reason = other.results.find((x) => x.id === "ID-001")!.reason!;
    assert.ok(reason.startsWith(EXPECT_FAILURE_MISMATCH), reason);
    assert.match(reason, /step 9: a failure this vector never reports/);
    assert.doesNotMatch(reason, new RegExp(anchored.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")));
    assert.equal(exitCode([other]), 1);
    assert.deepEqual(unmatchedExpectations(exc({ expectFailure: { failures: ["^a$", "b"] } }), ["a", "xbx"]), []);
    assert.deepEqual(unmatchedExpectations(exc({ expectFailure: { failures: ["^a$", "c"] } }), ["a", "xbx"]), ["c"]);
    assert.deepEqual(unmatchedExpectations(exc(), ["anything"]), []);
  });
  it("an inherited exception says so while it holds and when it turns stale", async () => {
    const broken = (await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1)).results.filter((x) => x.status === "FAIL").map((x) => x.id);
    const r = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, broken.map((vector) => exc({ vector, inherited: "copied from other-surface" })));
    assert.match(r.results.find((x) => x.id === "ID-001")!.reason!, /inherited, not yet recorded on this surface: copied from other-surface\)$/);
    const stale = await run(new ReferenceAdapter(), 1, [exc({ impl: "reference", inherited: "copied from other-surface" })]);
    assert.match(stale.results.find((x) => x.id === "ID-001")!.reason!, /stale.*it was inherited \(copied from other-surface\)/);
  });
  it("an expired exception fails the run even while the vector still fails", async () => {
    const r = await run(new ReferenceAdapter({ mutants: ["noRecipientCheck"] }), 1, [exc({ expires: "2026-11-01" })]);
    assert.equal(status(r, "ID-001"), "FAIL");
    assert.match(r.results.find((x) => x.id === "ID-001")!.reason!, /expired/);
  });
});

describe("not applicable only from a cited notOffered entry (docs/04 section 8)", () => {
  it("a cited entry gives the SKIP its evidence; a plain string or an undeclared type gives none", async () => {
    const a = new ReferenceAdapter({ name: "gated" });
    const caps = await a.capabilities();
    const v = suite.files.flatMap((f) => f.file.vectors).find((x) => (x.requires ?? []).some((r) => r.startsWith("https://")) && x.tier === 1)!;
    const req = v.requires!.find((r) => r.startsWith("https://"))!;
    const without = { ...caps, supportedTypes: caps.supportedTypes.filter((t) => t !== req), unlistedTypes: [], carriers: caps.carriers.filter((c) => c.typeUri !== req) };
    assert.deepEqual(gateDecision(v, without, 1), { reason: `type not declared: ${req}` });
    assert.deepEqual(gateDecision(v, { ...without, notOffered: { [req]: "no handler" } }, 1), { reason: `not offered by the implementation: no handler (${req})` });
    assert.deepEqual(gateDecision(v, { ...without, notOffered: { [req]: { reason: "no handler", evidence: "x 1234: src/a.rs:1" } } }, 1), { reason: `not offered by the implementation: no handler (${req})`, evidence: "x 1234: src/a.rs:1" });
    assert.equal(gateReason(v, { ...without, notOffered: { [req]: { reason: "no handler", evidence: "e" } } }, 1), `not offered by the implementation: no handler (${req})`);
    a.capabilities = async () => ({ ...without, notOffered: { [req]: { reason: "no handler", evidence: "x 1234: src/a.rs:1" } } });
    const r = await run(a, 1);
    assert.equal(r.notApplicableRule, "cited-notOffered");
    const x = r.results.find((y) => y.id === v.id)!;
    assert.equal(x.status, "SKIP");
    assert.equal(x.evidence, "x 1234: src/a.rs:1");
    assert.ok(r.results.filter((y) => y.status === "SKIP" && y.id !== v.id && !(y.reason ?? "").includes(req)).every((y) => y.evidence === undefined));
  });
});

describe("an exception keyed by platform", () => {
  // A row that is a carriage variant of a platform (keyring-wallet over DIDComm) declares `platform`; an exception keyed on the platform applies to it.
  const row = (platform?: string): ReferenceAdapter => {
    const a = new ReferenceAdapter({ mutants: ["noRecipientCheck"], name: "variant-row" });
    const caps = a.capabilities.bind(a);
    a.capabilities = async () => ({ ...(await caps()), ...(platform === undefined ? {} : { platform }) });
    return a;
  };
  it("applies to a row that declares the platform, and not to one that does not", async () => {
    const failing = (await run(row(), 1)).results.filter((x) => x.status === "FAIL").map((x) => x.id);
    const excs = failing.map((vector): ExceptionEntry => ({ impl: "some-platform", vector, reason: "keyed on the platform", owner: "maintainer-x", expires: "2027-03-01", acknowledged: null }));
    const withPlatform = await run(row("some-platform"), 1, excs);
    assert.equal(status(withPlatform, "ID-001"), "KNOWN-FAIL");
    assert.equal(exitCode([withPlatform]), 0);
    assert.equal(status(await run(row(), 1, excs), "ID-001"), "FAIL");
    assert.equal(status(await run(row("another-platform"), 1, excs), "ID-001"), "FAIL");
  });
  it("does not apply to a surface its notOn names: that row is judged without it, so a pass is PASS, not stale", async () => {
    const failing = (await run(row(), 1)).results.filter((x) => x.status === "FAIL").map((x) => x.id);
    const excs = failing.map((vector): ExceptionEntry => ({ impl: "some-platform", vector, reason: "keyed on the platform", owner: "maintainer-x", expires: "2027-03-01", acknowledged: null, ...(vector === "ID-001" ? { notOn: { "variant-row": "this surface's path does not carry the difference" } } : {}) }));
    const r = await run(row("some-platform"), 1, excs);
    assert.equal(status(r, "ID-001"), "FAIL");
    assert.doesNotMatch(r.results.find((x) => x.id === "ID-001")!.reason ?? "", /stale|keyed on the platform/);
    assert.ok(failing.filter((id) => id !== "ID-001").every((id) => status(r, id) === "KNOWN-FAIL"));
    const passing = new ReferenceAdapter({ name: "variant-row" });
    const caps = passing.capabilities.bind(passing);
    passing.capabilities = async () => ({ ...(await caps()), platform: "some-platform" });
    assert.equal(status(await run(passing, 1, excs), "ID-001"), "PASS");
    assert.equal(exceptionApplies({ impl: "some-platform", notOn: { "variant-row": "x" } }, { name: "other-row", platform: "some-platform" }), true);
    assert.equal(exceptionApplies({ impl: "variant-row", notOn: { "other-row": "x" } }, { name: "variant-row", platform: "some-platform" }), true);
  });
});

describe("an exception scoped to one tier", () => {
  const e = (tier: 1 | 2): ExceptionEntry => ({ impl: "reference", vector: "ID-001", reason: "tier scoped", owner: "maintainer-x", expires: "2027-03-01", acknowledged: null, tier });
  it("is judged only at its own tier: stale there when the vector passes, ignored at the other", async () => {
    const t1 = await run(new ReferenceAdapter(), 1, [e(2)]);
    assert.equal(status(t1, "ID-001"), "PASS");
    const t2 = await run(new ReferenceAdapter(), 2, [e(2)]);
    assert.equal(status(t2, "ID-001"), "FAIL");
    assert.match(t2.results.find((x) => x.id === "ID-001")!.reason!, /stale/);
  });
});

describe("CLARIFY never gates", () => {
  it("a clarify vector is reported CLARIFY whatever it observes", async () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = {
        format: "tt-conformance-vectors/0.1", group: "CLR", family: "framework", clock: { start: "2026-11-12T10:00:00Z" },
        vectors: [{ id: "CLR-001", title: "unsettled", tier: 1, spec: ["open question"], source: { slug: "s", version: "0.1", channel: "registry", ref: "suite:docs/README.md", pinnedDigest: null, tfRef: { status: "main", repoPath: "SPEC.md", commit: "0dbc98f1c059af300ff84eb1ab407edea16a16c1" } }, clarify: "spec silent on this", clarifyClass: "spec-silent", clarifySince: "0.1.0-draft", clarifyQuestions: [],
          steps: [{ send: { template: "carrier.request" }, expect: { disposition: "silence" } }] }],
      };
      writeFileSync(join(dir, "c.json"), JSON.stringify(file));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["c.json"] }));
      const r = await runSuite({ adapter: new ReferenceAdapter(), suite: loadSuite(dir), tier: 1, today: "2026-11-13", fixtureRoot: dir });
      assert.equal(r.results[0]!.status, "CLARIFY");
      assert.equal(exitCode([r]), 0);
    } finally {
      cleanup();
    }
  });
});

describe("capability matrix", () => {
  it("builds JSON and markdown per implementation x tier x family", async () => {
    const runs = [await run(new ReferenceAdapter(), 1), await run(new ReferenceAdapter({ attested: true, name: "reference-attested" }), 2)];
    const m = buildMatrix(runs);
    assert.deepEqual(m.families, ["ceremony-doc", "ceremony-receipt", "dtg-credential-exchange", "dtg-task-consent", "framework", "https-binding", "trust-task-discovery", "two-phase-commit", "vrc-issue", "vrc-propose", "witness-session"]); // vrc-witness-share is all candidates (WSH and TD), outside the default run
    // the attested and the non-attested run of one implementation are one row
    assert.deepEqual(m.rows.map((r) => [r.impl, r.tiers]), [["reference", [1, 2]]]);
    assert.deepEqual(m.rows[0]!.runs, ["reference@1", "reference-attested@2"]);
    assert.equal(m.rows[0]!.families.framework!.status, "PASS");
    // the Tier 2 profile-window rows an attested server skips: no run of the row executed them (the Tier 1 run leaves them out by tier)
    assert.deepEqual(m.rows[0]!.needsNonAttestedRun, ["DUP-110", "DUP-111", "DUP-112", "DUP-113"]);
    const md = matrixMarkdown(m);
    assert.match(md, /\| reference \| 1\+2 \| PASS/);
  });
  it("rolls FAIL above KNOWN-FAIL above PASS", () => {
    const mk = (status: string) => ({ impl: "i", tier: 1 as const, results: [{ id: "A-001", group: "A", family: "f", tier: 1 as const, status }, { id: "A-002", group: "A", family: "f", tier: 1 as const, status: "PASS" }] });
    assert.equal(buildMatrix([mk("KNOWN-FAIL") as never]).rows[0]!.families.f!.status, "KNOWN-FAIL");
    assert.equal(buildMatrix([mk("FAIL") as never]).rows[0]!.families.f!.status, "FAIL");
    assert.equal(buildMatrix([mk("SKIP") as never]).rows[0]!.families.f!.status, "PASS");
  });
});

describe("command line", () => {
  it("runs the reference adapters, writes the matrix files and exits 0", () => {
    const { dir, cleanup } = tempDir();
    try {
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "src", "runner", "cli.ts"), "--out", dir], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const matrix = JSON.parse(readFileSync(join(dir, "conformance-matrix.json"), "utf8"));
      assert.equal(matrix.format, "tt-conformance-matrix/0.1");
      assert.ok(readFileSync(join(dir, "conformance-matrix.md"), "utf8").includes("| reference |"));
    } finally {
      cleanup();
    }
  });
  it("exits non-zero when a vector fails", () => {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "src", "runner", "cli.ts"), "--adapter", "mutant:noRecipientCheck", "--tier", "1"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL ID-001/);
  });
});

describe("an interim next step before the terminal reply", () => {
  const vec = (disposition: string) => ({
    format: "tt-conformance-vectors/0.1", group: "NSX", family: "framework", clock: { start: "2026-11-12T10:00:00Z" },
    vectors: [{ id: "NSX-001", title: "terminal reply after a next step", tier: 1, spec: ["SPEC.md 4.4.1, 4.12"], source: { slug: "s", version: "0.1", channel: "registry", ref: "suite:docs/README.md", pinnedDigest: null, tfRef: { status: "main", repoPath: "SPEC.md", commit: "0dbc98f1c059af300ff84eb1ab407edea16a16c1" } }, clarify: null, requires: ["carrier:consequential"],
      steps: [{ send: { template: "carrier.request" }, expect: { disposition } }] }],
  });
  const withNextStep = (inner: ReferenceAdapter): Adapter => new Proxy(inner as unknown as Adapter, {
    get(t, k, r) {
      if (k !== "send") return Reflect.get(t, k, r);
      return async (p: never) => {
        const res = await (t as Adapter).send(p);
        const sent = JSON.parse((p as { bytes: string }).bytes) as { id: string; type: string };
        const next = JSON.stringify({ id: "urn:uuid:00000000-0000-4000-8000-000000000001", type: "https://trusttasks.org/spec/trust-task-next-step/0.1", threadId: sent.id, issuer: JSON.parse(res.replies[0]!).issuer, recipient: JSON.parse(res.replies[0]!).recipient, issuedAt: JSON.parse(res.replies[0]!).issuedAt, payload: { expects: [{ typeUri: sent.type }], continuation: "resubmit", inResponseTo: { typeUri: sent.type, id: sent.id } } });
        return { ...res, replies: [next, ...res.replies] };
      };
    },
  });
  it("is not an extra reply for a step that expects the response; a lone next step still is not the response", async () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, "c.json"), JSON.stringify(vec("response")));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["c.json"] }));
      const s = loadSuite(dir);
      const ok = await runSuite({ adapter: withNextStep(new ReferenceAdapter()), suite: s, tier: 1, today: "2026-11-13", fixtureRoot: dir });
      assert.equal(ok.results[0]!.status, "PASS", JSON.stringify(ok.results[0]));
      const two = await runSuite({ adapter: new Proxy(withNextStep(new ReferenceAdapter()), { get: (t, k, r) => (k === "send" ? async (p: never) => { const x = await (t as Adapter).send(p); return { ...x, replies: [x.replies[0]!, x.replies[0]!] }; } : Reflect.get(t, k, r)) }), suite: s, tier: 1, today: "2026-11-13", fixtureRoot: dir });
      assert.equal(two.results[0]!.status, "FAIL");
    } finally {
      cleanup();
    }
  });
});
