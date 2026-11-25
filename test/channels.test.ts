// SPDX-License-Identifier: Apache-2.0
// Spec-maturity channels (docs/04 section 18): classification, the harness toggle, advisory-only accounting, spec-drift, promotion.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { ADVISORY_BANNER, advisoryChannelsOf, buildMatrix, matrixMarkdown } from "../src/runner/matrix.ts";
import { exitCode, runSuite } from "../src/runner/suite.ts";
import type { SuiteRun } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { LoadedSuite } from "../src/vectors/load.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { currentDigest, detectDrift, digestPath, parseChannels } from "../src/vectors/source.ts";
import type { Channel, VectorSource } from "../src/vectors/source.ts";
import type { Vector } from "../src/vectors/types.ts";
import { FIXTURES, ROOT, VECTORS, tempDir } from "./helpers.ts";

const NODE = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];
const family = (dir: string) => loadSuite(join(VECTORS, dir));
const allVectors = (s: LoadedSuite): Vector[] => s.files.flatMap((f) => f.file.vectors);
// The ceremony family split (decision 39, docs/04 section 11.4): the suite's ceremony and two-phase design is proposed (profile
// ceremony-design) and the vectors that measure behaviour relative to the declared essential governance are candidates.
const CEREMONY_DESIGN = ["CER-003", "CER-004", "CER-006", "CER-007", "CER-008", "CER-009", "CER-010", "CER-011", "CER-012", "CER-013", "CER-014", "CER-016", "2PC-001", "2PC-002", "2PC-003", "2PC-004", "2PC-005", "2PC-008", "TIME-103"];
const PER_E = ["CER-017", "CER-018", "CER-019"];
const SUITE_LOCAL = /^(WSH|TD)-/;
const expectedChannel = (id: string): Channel => (SUITE_LOCAL.test(id) || PER_E.includes(id) ? "candidate" : CEREMONY_DESIGN.includes(id) ? "proposed" : "registry");

describe("channel classification of the shipped vectors", () => {
  const core = allVectors(loadSuite(VECTORS));
  const plain = allVectors(family("plain"));
  const emit = allVectors(family("emit"));
  it("every vector carries a valid source and the counts are the public ones", () => {
    // Decision 79 by the project owner and the TF-source audit: WSH-001..023 and TD-001..006 (the six that exercise the suite-local witness-share task) are candidates;
    // decision 39 adds the three per-declared-E ceremony vectors as candidates and moves the 19 ceremony-design vectors to proposed, so the
    // registry (gating) part of core is 394 - 32 - 19 = 343. The WIT group (witness/session and witness/session/submit, 40 vectors, all registry: the specs are in
    // the task-force repository) was added by the final integration: 434 in all (437 with WIT-017, WIT-018 and WIT-052 added by the retarget to 0.2, decision D290), 386 registry, 32 candidate and 19 proposed as before.
    assert.equal(core.length, 437);
    assert.equal(core.filter((v) => v.source!.channel === "registry").length, 386);
    assert.equal(core.filter((v) => /^WIT-/.test(v.id)).length, 43);
    assert.equal(core.filter((v) => v.source!.channel === "candidate").length, 32);
    assert.equal(core.filter((v) => v.source!.channel === "proposed").length, 19);
    assert.equal(plain.length, 543);
    assert.equal(emit.length, 183);
    for (const v of [...core, ...plain, ...emit]) assert.ok(v.source !== undefined, v.id);
  });
  it("all shipped vectors are registry except the 23 WSH, 6 TD and 3 per-declared-E vectors (candidates) and the 19 ceremony-design vectors (proposed); none derives from an open PR", () => {
    for (const v of [...core, ...plain, ...emit]) assert.equal(v.source!.channel, expectedChannel(v.id), v.id);
    for (const v of core.filter((x) => CEREMONY_DESIGN.includes(x.id))) assert.equal(v.source!.profile, "ceremony-design", v.id);
    assert.equal(core.filter((v) => v.source!.pr !== undefined).length, 0);
  });
  it("plain and emit vectors name the pinned package as their source", () => {
    for (const v of [...plain, ...emit]) {
      assert.match(v.source!.ref, /^pkg:@openvtc\/trust-tasks@0\.29\.0#https:\/\/trusttasks\.org\/spec\//, v.id);
      assert.ok(v.source!.pinnedDigest !== null, v.id);
    }
  });
  it("the vectors that rest on suite-local text or suite design say why: witness-share and TD (decision 79 by the project owner), the ceremony split (decision 39)", () => {
    const noted = core.filter((v) => v.source!.note !== undefined).map((v) => v.id);
    assert.deepEqual(noted, core.filter((v) => expectedChannel(v.id) !== "registry").map((v) => v.id));
    assert.equal(noted.length, 51);
    for (const v of core.filter((x) => SUITE_LOCAL.test(x.id))) assert.match(v.source!.note!, /decision 79/);
    for (const v of core.filter((x) => CEREMONY_DESIGN.includes(x.id) || PER_E.includes(x.id))) assert.match(v.source!.note!, /decision 39/);
  });
  it("every pin of a locally available source (suite files and the package) is current", () => {
    const drift = detectDrift([...core, ...plain, ...emit].map((v) => ({ id: v.id, source: v.source! })), { suite: ROOT }).filter((d) => !d.ref.startsWith("kit:"));
    assert.deepEqual(drift, []);
  });
});

describe("default channel accounting", () => {
  // All-channels figures are the ones measured with channels not applied: the reference adapter, unsalted, per directory and tier.
  // Default-channel figures differ for the core set only: the 23 WSH vectors (witness share, docs/10) moved from the grandfathered registry channel
  // to proposed (decision 78 by the project owner), so the default (registry) run is 361 core vectors and the 23 are advisory. This was a conscious update of the
  // pinned figures: the all-channels run still reproduces the old 384 results exactly (same counts, same hash), so no verdict changed, only which
  // channel the 23 count under. Plain and emit have no proposed vectors, so their default run equals their all-channels run.
  // Second conscious update (merge of observe-oracle-v2): CEX-033..039 (pushed-document observation, docs/20) are 7 new registry vectors, so the
  // default core run is 368 (361 + 7) and all channels 391 (384 + 7). Tier 1 gains 2 PASS (CEX-036, 038, the gating ones) and 5 CLARIFY (033, 034,
  // 035, 037, 039) for the reference adapter; nothing else moved. The 2L family (vectors/2l, 158 vectors, all proposed) is a separate directory and
  // is not in these figures.
  // Third conscious update (TF-source audit, decision 79 by the project owner and the audit recommendations, branch conformance/tfref): the default (registry) core run is now
  // 362 vectors, not 368: WSH-001..023 are channel candidate (decision 79, replacing proposed) and TD-001..006, whose test subject is the same suite-local witness-share
  // task, are candidates too (29 advisory in all). The all-channels core run (391) is UNCHANGED, hash and counts: no verdict moved, including DIS-007, which now
  // needs propose 0.1 instead of witness-share and still PASSes. Plain and emit hold out the vectors that cite a retired TF spec (excludedFromRun: PP-VLT-009/010/011 and
  // EM-PSH-001/003/005, EM-VLT-003), which are never run: plain 543 to 540 (PASS 437 to 435, CLARIFY 94 to 93), emit 183 to 179 (PASS 172 to 168); every other verdict is the
  // same. The vectors excluded from run are still in the files (543 and 183 loaded) so the all-channels figures equal the default ones.
  // Fourth conscious update (decision 39, essential versus extended governance): three new candidate vectors (CER-017..019, behaviour per
  // declared E) bring all channels to 394 (PASS +3); the other 391 results are unchanged, same hash once the three are left out. The default
  // (registry) core run is 343: the 19 ceremony-design vectors are proposed (advisory) and the three new ones are candidates.
  // Fifth conscious update (payload builder, branch conformance/payload-builder): the vectors/emit files are unchanged (still 179), but the reference
  // adapter now serves five more task types, because the extended payload builder (src/plain/schema.ts exampleExtended) gives their coverage task a valid
  // payload: EM-VLT-008, EM-AUT-047, EM-AUT-071, EM-KEY-005 and EM-KEY-016 move from SKIP (type not emitted) to PASS, so emit is PASS 173, SKIP 6.
  // No verdict of any other vector moved. This is the oracle gaining a capability, not a platform result.
  // The five, each checked as a behaviour change of the reference oracle and not a loosening. The old builder (`example`) returned no payload for the task,
  // so the oracle declared no emit for the type (SKIP "type not emitted"); the extended builder now returns one that satisfies the registry payload schema
  // (placeholder values, no claim about what the task does), and the reference emits it with the issuer, recipient, issuedAt and proof the task's policy requires:
  //  - EM-VLT-008 vault/credentials/receive 0.1: the oneOf alternatives only name `required` (credential | credentialBase64) and `credential` is an open object
  //    with minProperties 1, so `example` had nothing to build; now {credential: {member1: "x"}}.
  //  - EM-AUT-047 auth/revoke-session 0.2: three oneOf alternatives made of `required` plus `not` over members the enclosing schema describes; now {sessionId: "example"}.
  //  - EM-AUT-071 auth/step-up/approver/redeem/finish 0.1: `statement` is an open object with minProperties 1 (the attest document, opaque to the framework);
  //    now {enrollmentId, approverDid, statement: {member1: "x"}}.
  //  - EM-KEY-005 keys/import 0.1: a oneOf of three `required` alternatives (privateKeySealed | privateKeyJwe | privateKeyMultibase); now {keyType: "ed25519", privateKeySealed: "example"}.
  //  - EM-KEY-016 keys/sign-jws 0.1: a oneOf of `required` plus `not` (payload | payloadBase64Url); now {keyId: "example", payload: {}}.
  // Not a loosening: the vectors, the runner, the validator and the reference emit path are unchanged (the emit vectors are byte-identical), so the five are held to the
  // same checks as the other 168; with the mutants emitBadPayload, emitNoProof, emitNoRecipient and emitNoIssuedAt each of the five FAILs; and the emitted payload
  // has no error under the suite's own payload validator (src/plain/schema.ts), which b4f70b4 did not change. The payload members are placeholders, so these five
  // show the oracle emits a conforming document for the type, not that the placeholder is a meaningful request.
  // Sixth conscious update (final integration, group WIT): 40 witness vectors join core, so the core loaded is 434 and the default (registry) core is 383. The figures
  // below are still those of the 394 and 343 vectors that existed before, found by leaving the WIT ids out (same counts, same hash: nothing else moved); the WIT
  // verdicts on the reference are checked beside them in WIT_GOLDEN. O-14 and O-07 made AUTHZ-001, WIT-009 and WIT-029 CLARIFY (spec-silent, class C): the legacy core figures lose one PASS to CLARIFY (AUTHZ-001) and the WIT figures two. This is the suite growing, not a platform result.
  // Seventh conscious update (re-pin to task-force 98dda36f8, D960): auth/oob/redeem 0.1 is retired upstream (successor 0.2), so PP-AUT-035..038 and EM-AUT-015
  // are excluded from every run like the other retired-spec vectors: plain 540 to 536 (PASS 435 to 432, CLARIFY 93 to 92: PP-AUT-037 was the CLARIFY), emit
  // 179 to 178 (PASS 173 to 172). No other verdict moved; the hashes change only because the five ids leave the list.
  const WIT_GOLDEN: Record<1 | 2, Record<string, number>> = { 1: { PASS: 38, CLARIFY: 5 }, 2: { PASS: 38, CLARIFY: 5 } };
  type Fig = [number, Record<string, number>, string];
  const GOLDEN: [string, 1 | 2, Fig, Fig, number, number, number][] = [
    ["", 1, [394, { PASS: 255, CLARIFY: 73, SKIP: 66 }, "093ac67409ac33ef"], [343, { PASS: 233, CLARIFY: 63, SKIP: 47 }, "35694cdbcbd1522e"], 32, 0, 19],
    ["", 2, [394, { PASS: 281, CLARIFY: 72, SKIP: 41 }, "95c4c5ef313eb30d"], [343, { PASS: 244, CLARIFY: 61, SKIP: 38 }, "01f941247e589ecf"], 32, 0, 19],
    ["plain", 1, [536, { PASS: 432, CLARIFY: 92, SKIP: 12 }, "66bab7e42033c54c"], [536, { PASS: 432, CLARIFY: 92, SKIP: 12 }, "66bab7e42033c54c"], 0, 7, 0],
    ["emit", 1, [178, { PASS: 172, SKIP: 6 }, "9a17f9efb5572569"], [178, { PASS: 172, SKIP: 6 }, "9a17f9efb5572569"], 0, 5, 0],
  ];
  for (const [dir, tier, allFig, dfltFig, nCandidate, nExcludedFromRun, nProposed] of GOLDEN) {
    it(`reference, ${dir === "" ? "core" : dir}, tier ${tier}: default ${dfltFig[0]} vectors ${JSON.stringify(dfltFig[1])}; all channels ${allFig[0]} (without the WIT vectors; those are checked beside)`, async () => {
      const suite = loadSuite(join(VECTORS, dir));
      const mk = (channels?: Channel[]) => runSuite({ adapter: new ReferenceAdapter(), suite, tier, today: "2026-11-13", fixtureRoot: FIXTURES, salt: "", ...(channels === undefined ? {} : { channels }) });
      const check = (r: Awaited<ReturnType<typeof mk>>, [total, counts, hash]: Fig) => {
        // The figures are those of the run before the tier split (R9): a vector outside the selected tier counts as the SKIP it was then, in
        // vector order, so the hash shows that nothing else changed. The run itself records those vectors apart, never as SKIP.
        assert.ok(r.results.every((x) => !(x.status === "SKIP" && /^(tier [0-9] not selected|only runs at tier)/.test(x.reason ?? ""))));
        const byId = new Map(r.results.map((x) => [x.id, x.status as string]));
        for (const e of r.excludedByTier ?? []) { assert.ok(!byId.has(e.id), e.id); byId.set(e.id, "SKIP"); }
        const everyone = suite.files.flatMap((f) => f.file.vectors.map((v) => v.id)).filter((id) => byId.has(id)).map((id) => ({ id, status: byId.get(id)! }));
        const wit = everyone.filter((x) => /^WIT-/.test(x.id));
        const legacy = everyone.filter((x) => !/^WIT-/.test(x.id));
        if (dir === "") {
          const w: Record<string, number> = {};
          for (const x of wit) w[x.status] = (w[x.status] ?? 0) + 1;
          assert.deepEqual(w, WIT_GOLDEN[tier]);
        } else assert.equal(wit.length, 0);
        const c: Record<string, number> = {};
        for (const x of legacy) c[x.status] = (c[x.status] ?? 0) + 1;
        assert.equal(legacy.length, total);
        assert.deepEqual(c, counts);
        assert.equal(createHash("sha256").update(legacy.map((x) => `${x.id}:${x.status}`).join("\n")).digest("hex").slice(0, 16), hash);
      };
      const dflt = await mk();
      const all = await mk(["registry", "pr", "proposed", "candidate"]);
      check(dflt, dfltFig);
      check(all, allFig);
      assert.deepEqual(dflt.channels, ["registry"]);
      assert.equal(dflt.excludedByChannel!.registry.length, 0);
      assert.equal(dflt.excludedByChannel!.pr.length, 0);
      assert.equal(dflt.excludedByChannel!.proposed.length, nProposed);
      assert.ok(dflt.excludedByChannel!.proposed.every((id) => CEREMONY_DESIGN.includes(id)));
      assert.equal(dflt.excludedByChannel!.candidate.length, nCandidate);
      assert.ok(dflt.excludedByChannel!.candidate.every((id) => SUITE_LOCAL.test(id) || PER_E.includes(id)));
      assert.equal(Object.keys(dflt.excludedFromRun ?? {}).length, nExcludedFromRun);
      assert.equal(Object.keys(all.excludedFromRun ?? {}).length, nExcludedFromRun); // excluded from every run, whatever the channels
    });
  }
});

const TF_MAIN = { status: "main" as const, repoPath: "SPEC.md", commit: "0dbc98f1c059af300ff84eb1ab407edea16a16c1" };
/** A small in-memory suite: ENV-001 cloned into a registry, a pr and a proposed vector; the pr clone is made to fail. */
function mixedSuite(): LoadedSuite {
  const base = allVectors(loadSuite(VECTORS)).find((v) => v.id === "ENV-001")!;
  const src = (channel: Channel): VectorSource => ({
    slug: "trust-task-framework", version: "0.6.0", channel, ref: "kit:SPEC.md", pinnedDigest: "sha256:" + "0".repeat(64),
    ...(channel === "pr" ? { pr: { number: 904, headSha: "96b1d70eafd225b027b5e2da98079ae1570be2fc" }, tfRef: { status: "pr" as const, pr: 904, head: "96b1d70eafd225b027b5e2da98079ae1570be2fc" } } : { tfRef: TF_MAIN }),
    ...(channel === "proposed" ? { profile: "2L" } : {}),
  });
  const mk = (id: string, channel: Channel, failing = false): Vector => {
    const v = JSON.parse(JSON.stringify(base)) as Vector;
    v.id = id;
    v.source = src(channel);
    if (failing) {
      v.steps[v.steps.length - 1]!.expect = { disposition: "silence" } as never; // a valid request is answered: this expectation fails
      v.mutants = ["lenientEnvelope"]; // a negative vector declares a mutant (non-vacuity)
    }
    return v;
  };
  return { root: ROOT, files: [{ path: "x.json", file: { format: "tt-conformance-vectors/0.1", group: "ENV", family: "framework", clock: { start: "2026-11-12T10:00:00Z" }, vectors: [mk("ENV-001", "registry"), mk("ENV-002", "pr", true), mk("ENV-003", "proposed")] } }] };
}
const runMixed = (channels?: readonly Channel[], suite = mixedSuite()) =>
  runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-13", fixtureRoot: FIXTURES, salt: "", ...(channels === undefined ? {} : { channels }) });

describe("channel filtering", () => {
  it("the default runs registry only: other channels are excluded, not run, not counted, not SKIP", async () => {
    const r = await runMixed();
    assert.deepEqual(r.results.map((x) => [x.id, x.status, x.channel]), [["ENV-001", "PASS", "registry"]]);
    assert.deepEqual(r.excludedByChannel, { registry: [], pr: ["ENV-002"], proposed: ["ENV-003"], candidate: [] });
    assert.equal(r.results.filter((x) => x.status === "SKIP").length, 0);
  });
  it("--channels selects exactly the named channels", async () => {
    const r = await runMixed(["registry", "proposed"]);
    assert.deepEqual(r.results.map((x) => x.id), ["ENV-001", "ENV-003"]);
    assert.deepEqual(r.excludedByChannel!.pr, ["ENV-002"]);
    assert.deepEqual((await runMixed(["pr"])).results.map((x) => x.id), ["ENV-002"]);
  });
  it("parseChannels accepts the four names and refuses others", () => {
    assert.deepEqual(parseChannels("registry,pr,proposed,candidate"), ["registry", "pr", "proposed", "candidate"]);
    assert.deepEqual(parseChannels("pr"), ["pr"]);
    assert.throws(() => parseChannels("registry,draft"), /unknown channel "draft"/);
  });
  it("the validator requires a source, and pr and its number and head SHA go together", () => {
    const file = (src: unknown) => ({ format: "tt-conformance-vectors/0.1", group: "ENV", family: "f", clock: { start: "2026-11-12T10:00:00Z" }, vectors: [{ id: "ENV-001", title: "t", tier: 1, spec: ["x"], ...(src === undefined ? {} : { source: src }), clarify: null, steps: [{ send: { template: "carrier.request" }, expect: { disposition: "response" } }] }] });
    const ok = { slug: "s", version: "0.1", channel: "registry", ref: "kit:SPEC.md", pinnedDigest: null, tfRef: TF_MAIN };
    assert.deepEqual(validateVectorFile(file(ok)), []);
    assert.match(validateVectorFile(file(undefined)).join(), /source/);
    assert.match(validateVectorFile(file({ ...ok, channel: "pr" })).join(), /channel pr requires/);
    assert.deepEqual(validateVectorFile(file({ ...ok, channel: "pr", pr: { number: 904, headSha: "96b1d70" }, tfRef: { status: "pr", pr: 904, head: "96b1d70" } })), []);
    assert.match(validateVectorFile(file({ ...ok, pr: { number: 1, headSha: "abcdef0" } })).join(), /only allowed with channel pr/);
    assert.match(validateVectorFile(file({ ...ok, channel: "beta" })).join(), /channel/);
  });
});

describe("pr and proposed results are advisory only", () => {
  it("a FAIL in an advisory channel never changes the exit code; a FAIL in registry does", async () => {
    const r = await runMixed(["registry", "pr", "proposed"]);
    assert.equal(r.results.find((x) => x.id === "ENV-002")!.status, "FAIL");
    assert.equal(exitCode([r]), 0);
    const s = mixedSuite();
    s.files[0]!.file.vectors[0]!.steps[s.files[0]!.file.vectors[0]!.steps.length - 1]!.expect = { disposition: "silence" } as never;
    assert.equal(exitCode([await runMixed(["registry"], s)]), 1);
  });
  it("the gating matrix holds registry results only; advisory results are in their own matrix with a banner", async () => {
    const r = await runMixed(["registry", "pr", "proposed"]);
    const gating = buildMatrix([r]);
    const cell = gating.rows[0]!.families["framework"]!;
    assert.deepEqual(cell.counts, { PASS: 1, FAIL: 0, SKIP: 0, "KNOWN-FAIL": 0, CLARIFY: 0 });
    assert.equal(gating.channel, undefined);
    assert.doesNotMatch(matrixMarkdown(gating), /ADVISORY/);
    assert.deepEqual(advisoryChannelsOf([r]), ["pr", "proposed"]);
    const pr = buildMatrix([r], "pr");
    assert.equal(pr.channel, "pr");
    assert.equal(pr.rows[0]!.families["framework"]!.counts.FAIL, 1);
    const md = matrixMarkdown(pr);
    assert.match(md, /^# Capability matrix, advisory channel pr/);
    assert.match(md, /not an endorsement of any specification/);
    assert.match(md, /not part of the gating counts or of any headline total/);
    assert.equal(ADVISORY_BANNER("proposed").includes("suite-defined profile"), true);
    assert.match(ADVISORY_BANNER("candidate"), /candidates\): not an endorsement.*not part of the gating counts/);
  });
  it("the gating matrix notes what was excluded by channel", async () => {
    const md = matrixMarkdown(buildMatrix([await runMixed()]));
    assert.match(md, /Excluded by channel: 1 vector\(s\) of channel pr, 1 vector\(s\) of channel proposed .*not SKIP/);
  });
  it("the command line keeps advisory results out of the headline and the gating folder", () => {
    const { dir, cleanup } = tempDir();
    try {
      const s = mixedSuite();
      writeFileSync(join(dir, "x.json"), JSON.stringify(s.files[0]!.file));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: ["x.json"] }));
      const out = join(dir, "run");
      const r = spawnSync(process.execPath, [...NODE, join(ROOT, "src/runner/cli.ts"), "--adapter", "reference", "--vectors", dir, "--tier", "1", "--salt", "", "--channels", "registry,pr,proposed", "--today", "2026-11-15", "--out", out], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      // R4/R7: provenance beside results.json, with the pinned date and no local filesystem path
      const prov = JSON.parse(readFileSync(join(out, "run.json"), "utf8"));
      assert.equal(prov.format, "tt-conformance-run/0.2");
      assert.equal(prov.suite.version, JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")).version);
      assert.equal(prov.today, "2026-11-15");
      assert.equal(prov.todaySource, "pinned");
      assert.match(prov.vectors.digest, /^sha256:[0-9a-f]{64}$/);
      assert.deepEqual(Object.keys(prov.vectors.files), ["x.json"]);
      assert.equal(prov.implementations[0].capabilities.name, "reference");
      // R10: the minimum quiet period no-reply verdicts were held to
      assert.deepEqual(prov.implementations[0].quietPeriod, { minimumMs: 0, basis: "binding:in-process" });
      assert.ok(!JSON.stringify(prov).includes(dir), "no temp path in run.json");
      assert.match(r.stdout, /reference tier 1: \{"PASS":1\} \(clock set, minimum quiet 0 ms \(binding:in-process\)/);
      assert.match(r.stdout, /ADVISORY pr \(not an endorsement of any specification; not in the totals above\): \{"FAIL":1\}/);
      assert.match(r.stdout, /ADVISORY FAIL ENV-002/);
      assert.equal(JSON.parse(readFileSync(join(out, "results.json"), "utf8"))[0].results.length, 1);
      assert.ok(existsSync(join(`${out}-advisory`, "conformance-matrix-pr.md")));
      assert.ok(existsSync(join(`${out}-advisory`, "conformance-matrix-proposed.md")));
      assert.match(readFileSync(join(`${out}-advisory`, "README.md"), "utf8"), /not an endorsement of any specification/);
      const none = spawnSync(process.execPath, [...NODE, join(ROOT, "src/runner/cli.ts"), "--adapter", "reference", "--vectors", dir, "--tier", "1", "--salt", "", "--out", join(dir, "run2")], { cwd: ROOT, encoding: "utf8" });
      assert.match(none.stdout, /excluded by channel: pr 1, proposed 1/);
      assert.ok(!existsSync(join(dir, "run2-advisory")));
      const bad = spawnSync(process.execPath, [...NODE, join(ROOT, "src/runner/cli.ts"), "--vectors", dir, "--channels", "beta"], { cwd: ROOT, encoding: "utf8" });
      assert.equal(bad.status, 2);
    } finally {
      cleanup();
    }
  });
  it("promotion changes the tag and the tfRef (pr to main) only: the same vector then gates", async () => {
    const s = mixedSuite();
    const v = s.files[0]!.file.vectors[1]!;
    v.source = { ...v.source!, channel: "registry", tfRef: TF_MAIN };
    delete v.source.pr;
    assert.deepEqual(validateVectorFile(s.files[0]!.file), []);
    const r = await runMixed(undefined, s);
    assert.deepEqual(r.results.map((x) => [x.id, x.status]), [["ENV-001", "PASS"], ["ENV-002", "FAIL"]]);
    assert.equal(exitCode([r]), 1);
  });
});

describe("spec-drift", () => {
  const withKit = async (fn: (kit: string) => void | Promise<void>) => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "specs/a/b/0.1"), { recursive: true });
      writeFileSync(join(dir, "specs/a/b/0.1/spec.md"), "text v1\n");
      writeFileSync(join(dir, "specs/a/b/0.1/payload.schema.json"), "{}\n");
      await fn(dir);
    } finally {
      cleanup();
    }
  };
  const vec = (ref: string, pinned: string | null, id = "X-001", channel: Channel = "registry") => ({ id, source: { slug: "a/b", version: "0.1", channel, ref, pinnedDigest: pinned } as VectorSource });
  it("no finding while the pinned digest matches", async () => withKit((kit) => {
    const d = digestPath(join(kit, "specs/a/b/0.1"))!;
    assert.deepEqual(detectDrift([vec("kit:specs/a/b/0.1", d)], { kit, suite: ROOT }), []);
  }));
  it("a changed source, a removed source and an unpinned vector are flagged spec-drift, one finding per source", async () => withKit((kit) => {
    const ref = "kit:specs/a/b/0.1";
    const pinned = digestPath(join(kit, "specs/a/b/0.1"))!;
    writeFileSync(join(kit, "specs/a/b/0.1/spec.md"), "text v2\n");
    const changed = detectDrift([vec(ref, pinned, "X-001"), vec(ref, pinned, "X-002")], { kit, suite: ROOT });
    assert.equal(changed.length, 1);
    assert.deepEqual([changed[0]!.kind, changed[0]!.reason, changed[0]!.vectors, changed[0]!.pinned === pinned, changed[0]!.current !== pinned], ["spec-drift", "changed", ["X-001", "X-002"], true, true]);
    assert.equal(detectDrift([vec(ref, null)], { kit, suite: ROOT })[0]!.reason, "unpinned");
    rmSync(join(kit, "specs/a/b/0.1"), { recursive: true });
    assert.equal(detectDrift([vec(ref, pinned)], { kit, suite: ROOT })[0]!.reason, "missing-source");
    assert.equal(detectDrift([vec(ref, pinned)], { suite: ROOT })[0]!.reason, "missing-source"); // no checkout at all
  }));
  it("a run reports drift for the selected channels only, as advisory findings that never fail it", async () => withKit(async (kit) => {
    const s = mixedSuite();
    const [a, b, c] = s.files[0]!.file.vectors;
    const pinned = digestPath(join(kit, "specs/a/b/0.1"))!;
    a!.source = { ...a!.source!, ref: "kit:specs/a/b/0.1", pinnedDigest: pinned };
    b!.source = { ...b!.source!, ref: "kit:specs/a/b/0.1", pinnedDigest: "sha256:" + "1".repeat(64) }; // pr: drifted
    c!.source = { ...c!.source!, ref: "kit:specs/gone/0.1" }; // proposed: missing source
    const go = (channels: Channel[]) => runSuite({ adapter: new ReferenceAdapter(), suite: s, tier: 1, today: "2026-11-13", fixtureRoot: FIXTURES, salt: "", channels, drift: { kit, suite: ROOT } });
    assert.deepEqual((await go(["registry"])).drift, []);
    const all = await go(["registry", "pr", "proposed"]);
    assert.deepEqual(all.drift!.map((d) => `${d.channel}:${d.reason}`).sort(), ["pr:changed", "proposed:missing-source"]);
    assert.equal(exitCode([all]), 0);
    assert.match(matrixMarkdown(buildMatrix([all], "pr")), /spec-drift \(advisory, needs human review; never a failure\): 1 source/);
    assert.equal(buildMatrix([all]).drift, undefined);
  }));
  it("package sources digest the schema and policy, and the digests are stable", () => {
    const ref = allVectors(family("emit"))[0]!.source!.ref;
    assert.equal(currentDigest(ref, { suite: ROOT }), currentDigest(ref, { suite: ROOT }));
    assert.equal(currentDigest("pkg:@openvtc/trust-tasks@0.29.0#https://trusttasks.org/spec/nope/0.1", { suite: ROOT }), null);
  });
});
