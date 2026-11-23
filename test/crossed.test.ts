// SPDX-License-Identifier: Apache-2.0
// Artifact-crossed replay (docs/14 section 7, src/crossed/): live and recorded producers, the verdict record, and non-vacuity (a mutant
// receiver and a mutant producer each change the recorded verdicts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { CROSSED_FORMAT, emitVectorIndex, parseProduced, produceLive, REAL_TIME, receiverClockSettable, receiverVid, replay } from "../src/crossed/crossed.ts";
import { main } from "../src/crossed/cli.ts";
import { loadSuite } from "../src/vectors/load.ts";

const TYPES = ["https://trusttasks.org/spec/acl/grant/0.2", "https://trusttasks.org/spec/acl/list/0.2", "https://trusttasks.org/spec/policy/upsert/0.1"];
const peer = (mutants: string[] = []): ReferenceAdapter => new ReferenceAdapter({ signerSeed: 0x50, name: "reference-peer", mutants });

test("reference producer into the reference receiver: every document accepted, recorded as artifact-crossed, never demonstrated", async () => {
  const receiver = new ReferenceAdapter();
  const produced = await produceLive("reference-peer", peer(), await receiverVid(receiver), { types: TYPES });
  assert.equal(produced.documents.length, TYPES.length);
  const r = await replay("reference", receiver, produced, "live");
  assert.equal(r.format, CROSSED_FORMAT);
  assert.equal(r.evidence, "artifact-crossed");
  assert.equal(r.demonstrated, false);
  assert.equal(r.countedAsConformance, false);
  assert.equal(r.sameParty, false);
  assert.deepEqual(r.cases.map((c) => c.verdict), TYPES.map(() => "accepted"));
  assert.ok(r.cases.every((c) => c.addressedToReceiver && c.receiverClock === "set"));
});

test("non-vacuity: a producer mutant is rejected by the reference receiver and accepted by a receiver mutant", async () => {
  const ref = new ReferenceAdapter();
  const bad = await produceLive("mutant-peer:emitBadPayload", peer(["emitBadPayload"]), await receiverVid(ref), { types: TYPES });
  const atRef = await replay("reference", ref, bad, "live");
  assert.ok(atRef.cases.every((c) => c.verdict === "rejected" && c.errorCode !== undefined), JSON.stringify(atRef.totals));
  const lax = new ReferenceAdapter({ mutants: ["noPayloadValidation"] });
  const atLax = await replay("mutant:noPayloadValidation", lax, bad, "recorded");
  assert.deepEqual(atLax.cases.map((c) => c.verdict), TYPES.map(() => "accepted"));
});

test("recorded replay into a receiver with another identity is flagged as not addressed to it", async () => {
  const produced = await produceLive("reference-peer", peer(), await receiverVid(new ReferenceAdapter()), { types: TYPES.slice(0, 1) });
  const back = parseProduced(JSON.parse(JSON.stringify(produced)));
  const r = await replay("mutant-peer:noRecipientCheck", new ReferenceAdapter({ signerSeed: 0x51, mutants: ["noRecipientCheck"] }), back, "recorded");
  assert.equal(r.producerSource, "recorded");
  assert.equal(r.cases[0]!.addressedToReceiver, false);
  assert.throws(() => parseProduced({ format: "other" }), /format/);
});

test("a type the receiver does not serve is not sent", async () => {
  const produced = await produceLive("reference-peer", peer(), "did:example:nobody", { types: TYPES.slice(0, 1) });
  const r = await replay("reference-witness", new ReferenceAdapter({ witness: true, vrc: false, ceremony: false, dtg: false, plain: false }), produced, "live");
  assert.equal(r.cases[0]!.verdict, "not-served");
});

test("a receiver that does not support trust still receives the document, and the case says so; other trust errors stay adapter errors", async () => {
  const produced = await produceLive("reference-peer", peer(), await receiverVid(new ReferenceAdapter()), { types: TYPES.slice(0, 1) });
  const noTrust = new ReferenceAdapter();
  noTrust.trust = async () => { throw new Error("not supported by the test adapter: trust"); };
  const r = await replay("reference", noTrust, produced, "live");
  assert.equal(r.cases[0]!.verdict, "accepted");
  assert.match(r.cases[0]!.note ?? "", /^trust not supported by the receiver/);
  const broken = new ReferenceAdapter();
  broken.trust = async () => { throw new Error("boom"); };
  assert.equal((await replay("reference", broken, produced, "live")).cases[0]!.verdict, "adapter-error");
});

test("a receiver whose clock cannot be set gets documents produced on real time", async () => {
  const produced = await produceLive("reference-peer", peer(), await receiverVid(new ReferenceAdapter()), { types: TYPES.slice(0, 1), realTime: true });
  assert.equal(produced.clock, REAL_TIME);
  const issuedAt = Date.parse(String((JSON.parse(produced.documents[0]!.text) as { issuedAt: string }).issuedAt));
  assert.ok(Math.abs(Date.now() - issuedAt) < 60_000);
  const free = new ReferenceAdapter({ clockFree: true, name: "reference-clockfree" });
  assert.equal(await receiverClockSettable(free), false);
  assert.equal(await receiverClockSettable(new ReferenceAdapter()), true);
});

test("a live producer's documents carry distinct ids (one producer reset, not one per type)", async () => {
  const produced = await produceLive("reference-peer", peer(), await receiverVid(new ReferenceAdapter()), { types: TYPES });
  const ids = produced.documents.map((d) => (JSON.parse(d.text) as { id: string }).id);
  assert.equal(new Set(ids).size, ids.length);
});

test("each produced type is linked to the emit vectors that check it", () => {
  const idx = emitVectorIndex([loadSuite(join(import.meta.dirname, "..", "vectors", "emit"))]);
  assert.ok((idx.get(TYPES[0]!) ?? []).length > 0);
});

test("the command line writes produced.json, crossed.json, crossed.md and run.json, and replays from the record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-crossed-"));
  try {
    assert.equal(await main(["--producer", "reference-peer", "--receiver", "reference", "--types", TYPES.join(","), "--out", join(dir, "live")]), 0);
    for (const f of ["produced.json", "crossed.json", "crossed.md", "run.json"]) readFileSync(join(dir, "live", f), "utf8");
    const run = JSON.parse(readFileSync(join(dir, "live", "run.json"), "utf8")) as { tool: string; evidence: string; suite: { version: string } };
    assert.equal(run.tool, "crossed");
    assert.equal(run.evidence, "artifact-crossed");
    assert.match(readFileSync(join(dir, "live", "crossed.md"), "utf8"), /not demonstrated interoperation/);
    assert.equal(await main(["--producer-run", join(dir, "live"), "--receiver", "reference", "--out", join(dir, "again")]), 0);
    const again = JSON.parse(readFileSync(join(dir, "again", "crossed.json"), "utf8")) as { producerSource: string; totals: { accepted: number } };
    assert.equal(again.producerSource, "recorded");
    assert.equal(again.totals.accepted, TYPES.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
