// SPDX-License-Identifier: Apache-2.0
// The refusal codes the payload probes (CV, schema) and invalid-example probes (CX) accept: malformedRequest or permissionDenied (SPEC.md 7.2
// does not order validation against authorisation), never a lookup answer (taskFailed), plus the documented refusals and the documented clamp.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DOCUMENTED_REFUSALS, REFUSAL_CODES } from "../src/coverage/build.ts";
import { loadInvalidExamples } from "../src/coverage/families.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { VECTORS } from "./helpers.ts";

const norm = (s: string): string => s.replace(/[`*_>|]/g, " ").replace(/\s+/g, " ").toLowerCase();
const vectors = loadSuite(join(VECTORS, "coverage")).files.flatMap((f) => f.file.vectors).filter((v) => /^C[VX]-/.test(v.id) && /the payload is validated against|lists as invalid/.test(v.title));
const refusal = (v: (typeof vectors)[number]) => v.steps.filter((s) => s.expect !== undefined && (s.expect.disposition === "error" || s.expect.orRefusal !== undefined));

describe("the refusal codes of the payload probes", () => {
  it("every refusal step accepts permissionDenied beside malformedRequest and never taskFailed", () => {
    let n = 0;
    for (const v of vectors) for (const s of refusal(v)) {
      const ex = s.expect!;
      const codes = ex.disposition === "error" ? (Array.isArray(ex.code) ? ex.code : [ex.code]) : ex.orRefusal!;
      assert.ok(REFUSAL_CODES.every((c) => codes.includes(c)), `${v.id}: ${JSON.stringify(codes)}`);
      assert.ok(!codes.includes("taskFailed"), v.id);
      n++;
    }
    assert.ok(n > 1000);
  });
  it("a documented clamp is a step that accepts the response, only for a task whose text says it clamps (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    const clamped = Object.entries(loadInvalidExamples().examples).filter(([, l]) => l.some((e) => e.clamped === true));
    assert.ok(clamped.length >= 5);
    assert.ok(vectors.some((v) => v.steps.some((s) => s.expect?.disposition === "response" && s.expect.orRefusal !== undefined)));
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set"); return; }
    for (const [type] of clamped) assert.ok(/clamped to/.test(readFileSync(join(kit, "specs", type, "spec.md"), "utf8")), type);
  });
  it("the documented refusals and the backup Channel requirement quote the task force's text (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set"); return; }
    for (const [label, list] of Object.entries(DOCUMENTED_REFUSALS)) {
      const [slug, version] = label.split(" ");
      const text = norm(readFileSync(join(kit, "specs", slug!, version!, "spec.md"), "utf8"));
      for (const d of list) assert.ok(text.includes(norm(d.quote)), `${label}: ${d.quote}`);
    }
    for (const slug of ["backup/initiate-export/0.1", "backup/initiate-import/0.1", "backup/finalize-import/0.1", "vtc/backup/export/0.1"]) {
      assert.ok(norm(readFileSync(join(kit, "specs", slug, "spec.md"), "utf8")).includes(norm("when it arrives over any other channel. It refuses after establishing entitlement and before")), slug);
      const cites = vectors.filter((v) => v.spec.some((x) => x.includes(`specs/${slug.replace(/\/[^/]+$/, "")}`) && x.includes("arrives over any other channel")));
      assert.ok(cites.length >= 2, slug);
    }
  });
});
