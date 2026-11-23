// SPDX-License-Identifier: Apache-2.0
// FC-WSH (docs/25 section 6.4): a witnessed VRC with witness-share, channel candidate (local text docs/10), as a whole ceremony between two reference
// parties and the reference witness oracle in its LABELLED mode `mint-on-verified`. The oracle first, then the mutants that must end a scenario `failed`.
// Never a statement about a platform and never about the witness server, which is not run here.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { makeAdapter } from "../src/runner/adapters.ts";
import { loadScenarios } from "../src/ceremony/scenario.ts";
import { runScenarios } from "../src/ceremony/runner.ts";
import { VECTORS } from "./helpers.ts";

const files = () => loadScenarios(join(VECTORS, "ceremony-scenarios")).files.map((f) => f.file);
const party = (seed: number, mut?: string) => `reference-party:seed=${seed},attested${mut === undefined ? "" : `,mut=${mut}`}`;
const witness = (mut?: string) => `reference-witness:mode=mint-on-verified${mut === undefined ? "" : `,mut=${mut}`}`;
const run = async (specs: Record<string, string>, id: string) => (await runScenarios(files(), { make: (s) => makeAdapter(specs[s]!), specs, today: "2026-11-18", only: [id] })).results[0]!;
const TRIO = (p?: string, r?: string, w?: string) => ({ P: party(130, p), R: party(131, r), W: witness(w) });

describe("FC-WSH: the oracle", () => {
  for (const id of ["FC-WSH-001", "FC-WSH-002"]) {
    it(`${id} completes: all three read completed, never a conformance count, the mode is in the result`, async () => {
      const r = await run(TRIO(), id);
      assert.equal(r.status, "completed", r.reason);
      assert.deepEqual(Object.values(r.participants).map((p) => p.states), ["completed", "completed", "completed"]);
      assert.equal(r.participants["W"]!.mode, "mint-on-verified");
      assert.equal(r.participants["P"]!.mode, undefined);
      assert.match(r.label, /mint-on-verified/);
      assert.equal(r.countedAsConformance, false);
      assert.equal(r.evidence, "complete-ceremony");
      assert.ok(r.assertions.length >= 8 && r.assertions.every((a) => a.ok));
    });
  }
  it("no order between share and issue is asserted: 001 shares before it issues, 002 issues before it shares, both complete", async () => {
    const order = async (id: string) => {
      const out = await runScenarios(files(), { make: (s) => makeAdapter(TRIO()[s as "P" | "R" | "W"]), specs: TRIO(), today: "2026-11-18", only: [id] });
      return out.transcript.filter((t) => t.kind === "built" && /witness-share\/0\.1|relationships\/issue\/0\.1/.test(t.bytes.slice(0, 400))).map((t) => (t.bytes.includes("witness-share") ? "share" : "issue"));
    };
    const a = await order("FC-WSH-001"), b = await order("FC-WSH-002");
    assert.deepEqual(a, ["share", "share", "issue", "issue"]);
    assert.deepEqual(b, ["issue", "issue", "share", "share"]);
  });
  it("the party builds every witnessed document itself: the session and the submission are signed by the relationship DID, the share by the party, none by the runner", async () => {
    const out = await runScenarios(files(), { make: (s) => makeAdapter(TRIO()[s as "P" | "R" | "W"]), specs: TRIO(), today: "2026-11-18", only: ["FC-WSH-001"] });
    const built = out.transcript.filter((t) => t.kind === "built").map((t) => ({ from: t.from, doc: JSON.parse(t.bytes) as { type: string; issuer: string; parentThreadId?: string; payload: Record<string, unknown> } }));
    const sess = built.filter((b) => b.doc.type.endsWith("/witness/session/0.1"));
    const sub = built.filter((b) => b.doc.type.endsWith("/witness/session/submit/0.1"));
    assert.equal(sess.length, 2);
    assert.equal(sub.length, 2);
    for (const b of sess) assert.equal((b.doc.payload["parties"] as string[]).length, 2);
    // the submission presents the relationship credential that is issued later, unchanged
    const issued = built.filter((b) => b.doc.type.endsWith("/relationships/issue/0.1")).map((b) => JSON.stringify(b.doc.payload["vrc"]));
    const presented = sub.map((b) => JSON.stringify(((b.doc.payload["vp"] as { verifiableCredential: unknown[] }).verifiableCredential)[0]));
    assert.deepEqual(presented.sort(), issued.sort());
    // the credential is minted by the witness: its issuer is the witness, its citation names the session document
    const share = built.find((b) => b.doc.type.endsWith("/witness-share/0.1"))!.doc.payload as { presentation: { verifiableCredential: { issuer: string; taskContext: string }[] }; outcomeEvidence: { initiating: { id: string } } };
    assert.equal(share.presentation.verifiableCredential[0]!.taskContext, share.outcomeEvidence.initiating.id);
  });
  it("FC-WSH-003: a replayed binding is refused and nothing is minted; FC-WSH-004: a bounced credential is refused", async () => {
    for (const id of ["FC-WSH-003", "FC-WSH-004"]) {
      const r = await run(TRIO(), id);
      assert.equal(r.status, "ended-as-specified", r.reason);
      assert.equal(r.terminal, "refused");
    }
  });
  it("the unmutated reference-witness is not a witness for this scenario: it offers no role and no mode, so the slot is skipped", async () => {
    const r = await run({ ...TRIO(), W: "reference-witness" }, "FC-WSH-001");
    assert.equal(r.status, "skipped");
    assert.match(r.reason, /does not offer|role not offered/);
    const caps = await (await makeAdapter("reference-witness")).capabilities();
    assert.equal(caps.mode, undefined);
    assert.equal(caps.ceremonyRoles, undefined);
  });
  it("a witness with mutants but no explicit mode option is still the plain oracle: no mode is declared", async () => {
    assert.equal((await (await makeAdapter("mutant-witness:witnessChallengeReuse")).capabilities()).mode, undefined);
    assert.equal((await (await makeAdapter(witness())).capabilities()).mode, "mint-on-verified");
    await assert.rejects(() => makeAdapter("reference-witness:mode=other"));
  });
  it("an adapter that is not a participant of this group is skipped with the reason", async () => {
    assert.equal((await run({ ...TRIO(), P: "reference-witness" }, "FC-WSH-001")).status, "skipped");
  });
});

describe("FC-WSH: non-vacuity", () => {
  // [what is broken, scenario, specs, step it must fail at]
  const MUT: [string, string, Record<string, string>, string][] = [
    ["the responder keeps the share but never sends the receipt", "FC-WSH-001", TRIO(undefined, "ceremonyDropReceipt"), "share-pr"],
    ["the responder's receipt is on a new thread", "FC-WSH-001", TRIO(undefined, "ceremonyReceiptWrongThread"), "share-pr"],
    ["the responder's receipt carries the wrong digest", "FC-WSH-001", TRIO(undefined, "ceremonyReceiptWrongDigest"), "share-pr"],
    ["the responder's receipt is the digest of the presentation, not of the credential", "FC-WSH-001", TRIO(undefined, "wshDigestOverPresentation"), "share-pr"],
    ["the proposer reports the ceremony completed as soon as the proposal is accepted", "FC-WSH-001", TRIO("ceremonyEarlyCompletion"), "propose"],
    ["the responder reports the ceremony completed as soon as the proposal is accepted", "FC-WSH-002", TRIO(undefined, "ceremonyEarlyCompletion"), "propose"],
    ["the responder accepts a credential that is not about the sender (the credential bounced back)", "FC-WSH-004", TRIO(undefined, "noSubjectBinding"), "share-bounce"],
    ["the witness accepts a binding replayed from another of the party's sessions (a fixed challenge)", "FC-WSH-003", TRIO(undefined, undefined, "witnessChallengeReuse"), "submit-replay"],
    ["the witness sends its terminal answer unsigned, so the evidence cannot be relied on", "FC-WSH-001", TRIO(undefined, undefined, "unsignedReplies"), "share-pr"],
  ];
  for (const [name, id, specs, step] of MUT) {
    it(`${name}: ${id} ends failed at ${step}`, async () => {
      const r = await run(specs, id);
      assert.equal(r.status, "failed", `${r.status}: ${r.reason}`);
      assert.equal(r.failedStep, step, r.reason);
    });
  }
});
