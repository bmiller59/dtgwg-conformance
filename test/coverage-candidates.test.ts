// SPDX-License-Identifier: Apache-2.0
// Candidate coverage vectors (decision CV-6, docs/24): a vector exists only where a local text exists, and says what it rests on.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { BLOCKED, CANDIDATE_PLATFORM, CANDIDATE_TASKS, CANDIDATE_TEXT, LINKED, candidateSchema } from "../src/coverage/candidates.ts";
import { loadCensus } from "../src/coverage/families.ts";
import { validate } from "../src/plain/schema.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { deriveImplementedBy } from "../src/vectors/implemented-by.ts";
import { detectDrift } from "../src/vectors/source.ts";
import { runSuite } from "../src/runner/suite.ts";
import { ROOT, FIXTURES, VECTORS } from "./helpers.ts";

const DIR = join(VECTORS, "coverage");
const suite = loadSuite(DIR);
const cc = suite.files.filter((f) => f.file.group.startsWith("CC-")).flatMap((f) => f.file.vectors);
const doc = readFileSync(join(ROOT, CANDIDATE_TEXT), "utf8");

describe("candidate coverage vectors (CC; docs/24)", () => {
  it("exactly the candidate types with a local text have a vector, one each; every other no-specification type is blocked or linked, never guessed", () => {
    const none = loadCensus().filter((r) => r.tfStatus === "none").map((r) => r.type).sort();
    assert.equal(none.length, 10);
    assert.deepEqual([...CANDIDATE_TASKS.map((c) => c.type), ...BLOCKED.map((b) => b.type), ...LINKED.map((l) => l.type)].sort(), none);
    assert.deepEqual(cc.map((v) => `${v.source!.slug}/${v.source!.version}`).sort(), CANDIDATE_TASKS.map((c) => c.type).sort());
    const notGen = JSON.parse(readFileSync(join(DIR, "not-generated.json"), "utf8")) as { types: { type: string; reason: string; candidate?: string; blockedOn?: string; linkedTo?: string }[] };
    for (const t of notGen.types.filter((x) => x.reason === "no-specification")) assert.equal([t.candidate, t.blockedOn, t.linkedTo].filter((x) => x !== undefined).length, 1, t.type);
  });
  it("each is channel candidate with the suite-owned text, a current digest, an implementer, no tfRef, no valid request and a mutant", () => {
    assert.equal(cc.length, 5);
    for (const v of cc) {
      const s = v.source!;
      assert.equal(s.channel, "candidate", v.id);
      assert.equal(s.candidate!.localText, CANDIDATE_TEXT, v.id);
      assert.equal(s.ref, `suite:${CANDIDATE_TEXT}`, v.id);
      // the platform the quoted source shows, plus any platform a recorded run of these vectors shows executing them (none yet at the time of writing)
      assert.deepEqual(s.candidate!.implementedBy, [...new Set([...deriveImplementedBy((id) => id.startsWith("CC-")), CANDIDATE_PLATFORM])].sort(), v.id);
      assert.equal(s.tfRef, undefined, v.id);
      assert.deepEqual(detectDrift([{ id: v.id, source: s }], { suite: ROOT }), [], v.id);
      assert.deepEqual(v.mutants, ["noPayloadValidation"], v.id);
      for (const st of v.steps) { assert.ok("send" in st); assert.equal((st.expect as { disposition: string }).disposition, "error", v.id); }
    }
  });
  it("every probe breaks the declared shape (a valid request is never sent) and the shape names a required member", () => {
    for (const c of CANDIDATE_TASKS) {
      assert.ok(c.required.length > 0, c.type);
      for (const p of c.probes) assert.ok(validate(candidateSchema(c), p.payload).length > 0, `${c.type}: ${p.label}`);
    }
  });
  it("the text names no local filesystem path and carries the draft status line", () => {
    assert.ok(!/\/(home|var|srv|tmp)\//.test(doc));
    assert.match(doc, /Status: draft proposal/);
  });
  it("a platform quote is exactly the platform's lines, when its source is at hand (VTI_SOURCE names a checkout of the release commit)", { skip: process.env["VTI_SOURCE"] === undefined || !existsSync(process.env["VTI_SOURCE"]) }, () => {
    const src = process.env["VTI_SOURCE"]!;
    const re = /Source: `([^`:]+):(\d+)-(\d+)`[^\n]*\n\n```\n([\s\S]*?)\n```/g;
    let n = 0;
    for (const m of doc.matchAll(re)) {
      const lines = readFileSync(join(src, m[1]!), "utf8").split("\n").slice(Number(m[2]) - 1, Number(m[3]));
      assert.equal(m[4], lines.join("\n"), `${m[1]}:${m[2]}-${m[3]}`);
      n++;
    }
    assert.ok(n >= 7, `${n} quotes checked`);
  });
  it("the reference passes them, and every mutant is caught (a vector that cannot fail proves nothing)", async () => {
    const run = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today: "2026-11-18", fixtureRoot: FIXTURES, salt: "", channels: ["candidate"] });
    const mine = run.results.filter((r) => r.id.startsWith("CC-"));
    assert.equal(mine.length, 5);
    assert.deepEqual(mine.filter((r) => r.status !== "PASS").map((r) => `${r.id} ${r.status}`), []);
    for (const mutant of ["noPayloadValidation"]) {
      const bad = await runSuite({ adapter: new ReferenceAdapter({ mutants: [mutant as never] }), suite, tier: 1, today: "2026-11-18", fixtureRoot: FIXTURES, salt: "", channels: ["candidate"] });
      assert.deepEqual(bad.results.filter((r) => r.id.startsWith("CC-") && r.status === "PASS").map((r) => r.id), [], mutant);
    }
  });
});
