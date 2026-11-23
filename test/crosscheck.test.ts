// SPDX-License-Identifier: Apache-2.0
// The VTI cross-check harness (src/crosscheck): its cases are well formed, a faithful verifier agrees with VTI where VTI is right,
// a verifier that accepts everything is caught, and the bundle loader reads the shape VTI vendors. No VTI checkout is needed
// except for the one test that is skipped without VTI_ROOT.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { verifyDocumentProof } from "../src/crypto/proof.ts";
import { allCases, CONSOLE_FIXTURE, CONSOLE_FIXTURE_FILE, freshnessCases, javascriptDocument, holderDid, proofCases, signVerbatim } from "../src/crosscheck/cases.ts";
import { bundleOverlap, loadBundles } from "../src/crosscheck/bundles.ts";
import { markdown, runCrossCheck, summary } from "../src/crosscheck/run.ts";
import { tempDir } from "./helpers.ts";

describe("crosscheck cases", () => {
  it("have unique ids, a VTI source and a stated expectation", () => {
    const ids = allCases().map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of allCases()) {
      assert.match(c.source, /\.rs/);
      assert.ok(c.title.length > 10);
    }
  });

  it("signVerbatim keeps the spelling it is given and the suite's own verifier accepts it", () => {
    const doc = signVerbatim({ ...javascriptDocument(holderDid()), issuedAt: "2026-09-25T12:37:33+00:00" }, { created: "2026-09-25T12:37:33.000Z" }) as { issuedAt: string; proof: { created: string } };
    assert.equal(doc.issuedAt, "2026-09-25T12:37:33+00:00");
    assert.equal(doc.proof.created, "2026-09-25T12:37:33.000Z");
    assert.equal(verifyDocumentProof(doc, { nowMs: Date.parse("2026-09-25T12:40:00Z") }).valid, true);
  });

  it("the console fixture is VTI's, not re-signed: it carries the proof value VTI's file carries", () => {
    assert.equal((CONSOLE_FIXTURE.proof as { proofValue: string }).proofValue.slice(0, 8), "z5ZXbjex");
    const p = proofCases().find((c) => c.id === "XC-P-001");
    assert.equal(p?.origin, "vti-bytes");
  });

  it("matches the file in a VTI checkout when VTI_ROOT is set", { skip: process.env.VTI_ROOT === undefined }, () => {
    const file = JSON.parse(readFileSync(join(process.env.VTI_ROOT!, CONSOLE_FIXTURE_FILE), "utf8")) as unknown;
    assert.deepEqual(file, CONSOLE_FIXTURE);
  });

  it("every tamper case differs from the signed document it tampers", () => {
    const good = JSON.stringify(proofCases().find((c) => c.id === "XC-P-003")!.document);
    for (const c of proofCases().filter((x) => /^XC-P-01[0-3]$/.test(x.id))) assert.notEqual(JSON.stringify(c.document), good);
  });
});

describe("crosscheck run", () => {
  it("a faithful verifier agrees on every proof case", async () => {
    const run = await runCrossCheck(new ReferenceAdapter(), proofCases());
    assert.deepEqual(run.results.filter((r) => r.verdict !== "AGREE").map((r) => r.id), []);
  });

  it("a verifier that accepts every proof is caught on the cases VTI says are invalid", async () => {
    const run = await runCrossCheck(new ReferenceAdapter({ mutants: ["acceptUnverifiedProof"] }), proofCases());
    const bad = run.results.filter((r) => r.verdict === "DISAGREE").map((r) => r.id);
    assert.ok(bad.includes("XC-P-002") && bad.includes("XC-P-010") && bad.includes("XC-P-014"), bad.join(","));
    assert.equal(run.results.find((r) => r.id === "XC-P-001")?.verdict, "AGREE");
  });

  it("the freshness cases VTI makes about a future date and a missing timestamp agree; the empty-interval pair is recorded as a disagreement", async () => {
    const run = await runCrossCheck(new ReferenceAdapter(), freshnessCases());
    const verdicts = Object.fromEntries(run.results.map((r) => [r.id, r.verdict]));
    assert.deepEqual(verdicts, { "XC-F-001": "AGREE", "XC-F-002": "AGREE", "XC-F-003": "DISAGREE", "XC-F-004": "DISAGREE", "XC-F-005": "AGREE" });
    assert.deepEqual(summary(run), { agree: 3, disagree: 2, notRun: 0 });
    assert.match(markdown([run]), /XC-F-003 an expiry equal to the issue time is malformedRequest \| malformedRequest \| expired \| DISAGREE/);
  });

  it("an adapter that fails a call gives NOT-RUN, never a pass", async () => {
    const adapter = new ReferenceAdapter();
    adapter.verifyProof = async () => {
      throw new Error("boom");
    };
    const run = await runCrossCheck(adapter, proofCases().slice(0, 2));
    assert.deepEqual(run.results.map((r) => r.verdict), ["NOT-RUN", "NOT-RUN"]);
  });
});

describe("crosscheck bundles", () => {
  it("reads the bundles VTI vendors and counts the types an implementation serves", () => {
    const { dir, cleanup } = tempDir();
    try {
      const d = join(dir, "vti-specs-core", "trust-tasks", "credential-exchange", "issue");
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "0.1.bundle.json"), JSON.stringify({ slug: "credential-exchange/issue", typeUri: "https://trusttasks.org/spec/credential-exchange/issue/0.1", version: "0.1", policy: { proofRequired: { value: true } }, errorCodes: ["notAccepted"] }));
      const d2 = join(dir, "vti-specs-core", "trust-tasks", "task-consent", "request");
      mkdirSync(d2, { recursive: true });
      writeFileSync(join(d2, "0.1.bundle.json"), JSON.stringify({ slug: "task-consent/request", typeUri: "https://trusttasks.org/spec/task-consent/request/0.1", version: "0.1", policy: {}, errorCodes: [] }));
      assert.equal(loadBundles(dir).length, 2);
      const o = bundleOverlap(dir, ["https://trusttasks.org/spec/credential-exchange/issue/0.1", "https://trusttasks.org/spec/task-consent/request/0.2"]);
      assert.equal(o.served.length, 1);
      assert.equal(o.sameSlugOtherVersion.length, 1);
    } finally {
      cleanup();
    }
  });
});
