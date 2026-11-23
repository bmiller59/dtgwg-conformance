// SPDX-License-Identifier: Apache-2.0
// Ceremony scenarios (docs/25): format, contract members, the runner on the reference adapter (oracle first), and the mutants that must end a
// scenario in `failed`. The runs here are two reference parties: they show the format and the engine work, never anything about a platform.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CEREMONY_STATES, OPTIONAL_CAPABILITIES, RPC_METHODS, dispatch } from "../src/adapter/contract.ts";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios, validateScenarioFile, TERMINAL_STATES, SCENARIO_STATUSES, SCENARIO_MANIFEST } from "../src/ceremony/scenario.ts";
import type { ScenarioFile } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { CEREMONY_MUTANTS } from "../src/adapters/reference/ceremony-party.ts";
import { MUTANTS } from "../src/adapters/reference/mutants.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { readLedger, ledgerProblems } from "../src/vectors/ledger.ts";
import { ROOT, VECTORS, tempDir } from "./helpers.ts";

const DIR = join(VECTORS, "ceremony-scenarios");
const files = (): ScenarioFile[] => loadScenarios(DIR).files.map((f) => f.file);
const run = (specs: Record<string, string>, only?: string[]) => runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", ...(only === undefined ? {} : { only }) });
const PAIR = { P: "reference", R: "reference-peer" };
const status = async (specs: Record<string, string>, id: string) => (await run(specs, [id])).results[0]!;

describe("ceremony scenarios: format", () => {
  it("the committed files load and validate, and the evidence kind is complete-ceremony", () => {
    const l = loadScenarios(DIR);
    assert.ok(l.files.length >= 1);
    for (const f of l.files) { assert.equal(f.file.evidence, "complete-ceremony"); assert.equal(f.file.ceremony.channel, f.file.group === "FC-WSH" ? "candidate" : "proposed"); }
    assert.ok(l.files.every((f) => f.file.scenarios.every((sc) => sc.title !== "")));
    // the first seven groups are the reference-only scenarios of docs/25; the paired groups (docs/26) follow
    assert.deepEqual(l.files.flatMap((f) => f.file.scenarios.map((s) => s.id)).slice(0, 29), ["FC-VRC-001", "FC-VRC-002", "FC-TCA-001", "FC-TCA-002", "FC-TCA-003", "FC-CEX-001", "FC-CEX-002", "FC-CEX-003", "FC-MAT-001", "FC-MAT-002", "FC-MAT-003", "FC-WSH-001", "FC-WSH-002", "FC-WSH-003", "FC-WSH-004", "FC-VET-001", "FC-VET-002", "FC-VET-003", "FC-VET-004", "FC-VET-005", "FC-VET-006", "FC-ONB-001", "FC-ONB-002", "FC-ONB-003", "FC-ONB-004", "FC-ONB-005", "FC-ONB-006", "FC-ONB-007", "FC-ONB-008"]);
    // the consent-gate groups (docs/27) come last, after the paired groups
    assert.deepEqual(l.files.flatMap((f) => f.file.scenarios.map((s) => s.id)).slice(-20), ["FC-KVC-001", "FC-KVC-002", "FC-KVC-003", "FC-KVC-004", "FC-KVC-005", "FC-KVC-006", "FC-KVC-007", "FC-KVC-008", "FC-KVC-009", "FC-KVC-010", "FC-KVC-011", "FC-KVC-012", "FC-KVC-013", "FC-KVC-014", "FC-KVC-101", "FC-KVX-001", "FC-KVX-002", "FC-KVX-003", "FC-KVX-004", "FC-KVX-005"]);
  });
  it("every step that sends a document cites its Trust Tasks specification with a pin and hashes", () => {
    for (const f of files()) for (const s of f.scenarios) for (const st of s.steps) if (st.do.initiate !== undefined || st.do.approve !== undefined) {
      if (st.source?.channel === "candidate") { // no Trust Tasks home (witness-share): the local text is the source, there is no spec hash
        assert.equal(st.source.candidate?.localText, "docs/10-witness-share-profile.md", `${s.id}/${st.id}`);
      } else {
        assert.ok(["draft", "main"].includes(String(st.source?.tfRef?.status)), `${s.id}/${st.id}`); // main: the framework text the held task exercises (SPEC.md)
        assert.match(String(st.source?.specHash), /^sha256:[0-9a-f]{64}$/, `${s.id}/${st.id}`);
      }
      assert.match(String(st.source?.pinnedDigest), /^sha256:/, `${s.id}/${st.id}`);
    }
  });
  it("JSON schema enums agree with the code", () => {
    const schema = JSON.parse(readFileSync(join(ROOT, "schema", "tt-ceremony-scenarios-0.1.schema.json"), "utf8"));
    assert.deepEqual(schema.$defs.state.enum, [...CEREMONY_STATES]);
    assert.deepEqual(schema.$defs.terminal.enum, [...TERMINAL_STATES]);
    assert.deepEqual(schema.$defs["result-status"].enum, [...SCENARIO_STATUSES]);
  });
  it("the validator names each malformed scenario", () => {
    const good = JSON.parse(readFileSync(join(DIR, "fc-vrc.json"), "utf8")) as ScenarioFile;
    const bad = (edit: (f: Record<string, any>) => void): string[] => { const f = JSON.parse(JSON.stringify(good)); edit(f); return validateScenarioFile(f); };
    assert.deepEqual(validateScenarioFile(good), []);
    assert.match(bad((f) => { f.evidence = "exchange"; }).join(), /evidence must be complete-ceremony/);
    assert.match(bad((f) => { f.ceremony.channel = "registry"; }).join(), /never registry/);
    assert.match(bad((f) => { f.scenarios[0].deadlineMs = 0; }).join(), /deadlineMs/);
    assert.match(bad((f) => { f.scenarios[0].deadlineMs = 10_000_000; }).join(), /nothing waits without a bound/);
    assert.match(bad((f) => { f.scenarios[0].allowedTerminals = ["incomplete"]; }).join(), /allowedTerminals/);
    assert.match(bad((f) => { f.scenarios[0].steps[2].do.initiate.to = "Z"; }).join(), /two participants/);
    assert.match(bad((f) => { delete f.scenarios[0].steps[2].source; }).join(), /cites its task/);
    assert.match(bad((f) => { f.scenarios[0].steps[3].expect[1].receiptMatches.step = "nope"; }).join(), /no step nope/);
    assert.match(bad((f) => { f.scenarios[0].steps[2].expect[0].ceremony = "done"; f.scenarios[0].steps[2].expect[0].received = undefined; }).join(), /unknown state/);
    assert.match(bad((f) => { f.scenarios[1].id = "FC-VRC-001"; }).join(), /duplicate/);
    assert.match(bad((f) => { f.scenarios[0].id = "FC-WSH-001"; }).join(), /<group>-<NNN>/);
  });
  it("are exactly what scripts/generate-ceremony-scenarios.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-ceremony-scenarios.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of readdirSync(join(dir, "o"))) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally { cleanup(); }
  });
  it("stays out of the default run: not a vector manifest, no vector loader reads it, its ids are in the ledger but its steps are not", () => {
    assert.notEqual(String(SCENARIO_MANIFEST), "manifest.json");
    const ids = loadSuite(VECTORS).files.flatMap((f) => f.file.vectors.map((v) => v.id));
    assert.ok(!ids.some((i) => i.startsWith("FC-")));
    assert.ok(readLedger(ROOT).includes("FC-VRC-001") && readLedger(ROOT).includes("FC-TCA-003") && !readLedger(ROOT).some((i) => i.includes("#")));
    assert.deepEqual(ledgerProblems(ROOT), []);
  });
});

describe("ceremony scenarios: the contract members", () => {
  it("are optional capabilities, RPC methods and observe queries", async () => {
    for (const c of ["initiate", "peer.connect", "observe.received", "observe.ceremony"]) assert.ok((OPTIONAL_CAPABILITIES as readonly string[]).includes(c), c);
    assert.ok(RPC_METHODS.includes("initiate") && RPC_METHODS.includes("connect"));
    const a = new ReferenceAdapter();
    const caps = await a.capabilities();
    for (const c of ["initiate", "peer.connect", "observe.received", "observe.ceremony"]) assert.ok(caps.optional.includes(c), c);
    assert.deepEqual(caps.initiates, ["vrc-propose", "vrc-issue", "witness-session", "witness-session-submit", "vrc-witness-share", "consent-begin", "consent-request", "consent-decision", "consent-gate", "consent-resubmit", "cex-offer", "cex-query"]);
    // through the JSON-RPC dispatch (what a stdio adapter serves)
    const r = await dispatch(a, { jsonrpc: "2.0", id: 1, method: "connect", params: { peer: { vid: "did:key:z6Mkexample" } } });
    assert.deepEqual("result" in r ? r.result : null, { connected: true, detail: "in-process peer recorded (the reference has no carrier to set up)" });
  });
  it("an adapter that serves no VRC does not declare them", async () => {
    const caps = await (await makeAdapter("reference-witness")).capabilities();
    assert.ok(!caps.optional.includes("initiate") && caps.initiates === undefined);
  });
  it("initiate refuses a peer it is not connected to, and an unknown kind", async () => {
    const a = new ReferenceAdapter();
    await assert.rejects(a.initiate({ kind: "vrc-propose", to: "did:key:zX" }), /not connected/);
    await a.connect({ peer: { vid: "did:key:zX" } });
    await assert.rejects(a.initiate({ kind: "vetting-request", to: "did:key:zX" }), /does not start/);
    await assert.rejects(a.initiate({ kind: "vrc-issue", to: "did:key:zX", thread: "urn:uuid:none" }), /no accepted proposal/);
  });
  it("observe ceremony reads unknown for a thread it never saw, never an invented state", async () => {
    assert.deepEqual(await new ReferenceAdapter().observe({ query: "ceremony", threadId: "urn:uuid:nothing" }), { value: "unknown" });
  });
  it("the ceremony mutants are named apart from the vector mutants", () => {
    for (const m of Object.keys(CEREMONY_MUTANTS)) assert.ok(!(m in MUTANTS), m);
    assert.throws(() => new ReferenceAdapter({ mutants: ["ceremonyNoSuch" as never] }), /unknown mutant/);
    assert.doesNotThrow(() => new ReferenceAdapter({ mutants: Object.keys(CEREMONY_MUTANTS) as never }));
  });
});

describe("ceremony scenarios: the oracle (two reference parties complete, or end as specified)", () => {
  it("FC-VRC-001 completes: every receipt matches and both parties read completed", async () => {
    const r = await status(PAIR, "FC-VRC-001");
    assert.equal(r.status, "completed", r.reason);
    assert.equal(r.terminal, "completed");
    assert.deepEqual(Object.values(r.participants).map((p) => p.states), ["completed", "completed"]);
    assert.ok(r.assertions.length >= 6 && r.assertions.every((a) => a.ok));
    assert.equal(r.countedAsConformance, false);
    assert.equal(r.evidence, "complete-ceremony");
    assert.match(r.label, /ran together, one pair \(.*\), one carrier \(runner-carried relay, in process\), one date \(2026-11-18\)/);
  });
  it("FC-VRC-002 ends in its specified refusal (declined), which is not a completion", async () => {
    const r = await status(PAIR, "FC-VRC-002");
    assert.equal(r.status, "ended-as-specified", r.reason);
    assert.equal(r.terminal, "declined");
  });
  it("the runner built no document: every transcript entry of a step was built by a participant, and each is hashed", async () => {
    const out = await run(PAIR, ["FC-VRC-001"]);
    const built = out.transcript.filter((t) => t.kind === "built");
    assert.equal(built.length, 3);
    for (const t of out.transcript) { assert.equal(t.carrier, "runner-relay"); assert.match(t.sha256, /^[0-9a-f]{64}$/); }
    // the credential the receiver stored is the one that was built: one built issue per direction, each answered by a reply on its thread
    assert.equal(out.transcript.filter((t) => t.kind === "reply").length, 3);
  });
  it("the same pair run twice reads the same states (a rerun is a new run, never a retry)", async () => {
    const a = await status(PAIR, "FC-VRC-001"), b = await status(PAIR, "FC-VRC-001");
    assert.deepEqual([a.status, a.terminal], [b.status, b.terminal]);
  });
});

describe("ceremony scenarios: non-vacuity", () => {
  // [participant spec, scenario, step the failure must be named at (or the completion)]
  const MUT: [string, string, string, RegExp][] = [
    ["dropped receipt (responder)", "R=mutant-peer:ceremonyDropReceipt", "issue-pr", /no delivery receipt at P/],
    ["dropped receipt (proposer's own receipts)", "P=mutant:ceremonyDropReceipt", "issue-rp", /no delivery receipt at R/],
    ["receipt on a wrong thread", "R=mutant-peer:ceremonyReceiptWrongThread", "issue-pr", /no delivery receipt at P/],
    ["receipt with a wrong digest", "R=mutant-peer:ceremonyReceiptWrongDigest", "issue-pr", /receipts seen: z/],
    ["early completion (responder)", "R=mutant-peer:ceremonyEarlyCompletion", "propose", /R reads completed, expected open/],
    ["early completion (proposer)", "P=mutant:ceremonyEarlyCompletion", "propose", /P reads completed, expected open/],
  ];
  for (const [name, who, step, why] of MUT) {
    it(`${name}: FC-VRC-001 ends failed at ${step}`, async () => {
      const [slot, spec] = who.split("=") as [string, string];
      const r = await status({ ...PAIR, [slot]: spec }, "FC-VRC-001");
      assert.equal(r.status, "failed");
      assert.equal(r.failedStep, step);
      assert.match(r.reason, why);
    });
  }
  it("a decline sent as a non-error answer, or with another code, ends FC-VRC-002 failed", async () => {
    for (const m of ["declineAsResponse", "declineWrongCode"]) {
      const r = await status({ ...PAIR, R: `mutant-peer:${m}` }, "FC-VRC-002");
      assert.equal(r.status, "failed", m);
    }
  });
  it("a scenario whose first step is skipped does not complete: no connect, no initiate", async () => {
    const fs = files();
    const s = fs[0]!.scenarios[0]!;
    s.steps = s.steps.filter((x) => x.id !== "connect");
    const out = await runScenarios(fs, { make: (x) => makeAdapter(PAIR[x as "P" | "R"]), specs: PAIR, today: "2026-11-18", only: ["FC-VRC-001"] });
    assert.equal(out.results[0]!.status, "failed");
    assert.match(out.results[0]!.reason, /not connected/);
  });
  it("two participants with one key are inconclusive, and an adapter without the capabilities is skipped with the reason", async () => {
    const same = await status({ P: "reference", R: "reference" }, "FC-VRC-001");
    assert.equal(same.status, "inconclusive");
    const skipped = await status({ P: "reference", R: "reference-witness" }, "FC-VRC-001");
    assert.equal(skipped.status, "skipped");
    assert.match(skipped.reason, /does not offer/);
    const unbound = await status({ P: "reference" }, "FC-VRC-001");
    assert.equal(unbound.status, "skipped");
  });
  it("a participant whose state cannot be read makes the run inconclusive, never completed", async () => {
    const fs = files();
    const out = await runScenarios(fs, {
      make: async (slot) => { const a = new ReferenceAdapter({ signerSeed: slot === "P" ? 0x42 : 0x50 }); if (slot === "R") a.observe = async (q) => (q.query === "ceremony" ? { value: "unknown" } : ReferenceAdapter.prototype.observe.call(a, q)); return a; },
      specs: PAIR, today: "2026-11-18", only: ["FC-VRC-002"],
    });
    assert.equal(out.results[0]!.status, "inconclusive");
  });
});

describe("ceremony scenarios: the command line", () => {
  it("writes scenario-result.json, transcript.jsonl and run.json, labels the result and exits 0 on completion", () => {
    const { dir, cleanup } = tempDir();
    try {
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "src", "ceremony", "cli.ts"), "--participant", "P=reference", "--participant", "R=reference-peer", "--out", join(dir, "run"), "--date", "2026-11-18"], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /FC-VRC-001\tcompleted/);
      const res = JSON.parse(readFileSync(join(dir, "run", "scenario-result.json"), "utf8"));
      assert.equal(res.countedAsConformance, false);
      assert.equal(res.evidence, "complete-ceremony");
      assert.ok(res.results.every((x: { countedAsConformance: boolean }) => x.countedAsConformance === false));
      assert.ok(readFileSync(join(dir, "run", "transcript.jsonl"), "utf8").trim().split("\n").length >= 10);
      assert.equal(JSON.parse(readFileSync(join(dir, "run", "run.json"), "utf8")).carrier, "runner-carried relay, in process");
    } finally { cleanup(); }
  });
  it("exits 1 on a failed scenario and 2 on a usage error", () => {
    const base = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "src", "ceremony", "cli.ts")];
    assert.equal(spawnSync(process.execPath, [...base, "--participant", "P=reference", "--participant", "R=mutant-peer:ceremonyDropReceipt"], { cwd: ROOT, encoding: "utf8" }).status, 1);
    assert.equal(spawnSync(process.execPath, base, { cwd: ROOT, encoding: "utf8" }).status, 2);
  });
});

describe("the carrier named in a result's label", () => {
  it("is the runner's relay unless every participant declares a wire mode, and then it is that wire", async () => {
    const { carrierOf, RELAY_CARRIER } = await import("../src/ceremony/runner.ts");
    assert.equal(carrierOf([undefined, undefined]), RELAY_CARRIER);
    assert.equal(carrierOf(["mint-on-verified", undefined]), RELAY_CARRIER);
    assert.equal(carrierOf(["wire: real DIDComm v2 to a live VTA", undefined]), RELAY_CARRIER, "one participant on the wire is not a wire run");
    assert.equal(carrierOf(["wire: real DIDComm v2 to a live VTA", "wire: real DIDComm v2 to a live VTA"]), "wire: real DIDComm v2 to a live VTA");
  });
});
