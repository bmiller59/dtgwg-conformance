// SPDX-License-Identifier: Apache-2.0
// R5: every CLARIFY vector carries a class, an age and a slot for task-force question ids (docs/04 section 18.10).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CLARIFY_CLASSES, applyClarifyMeta, clarifyMetaProblems, loadClarifyMeta } from "../src/vectors/clarify.ts";
import { loadSuite } from "../src/vectors/load.ts";
import type { Vector, VectorFile } from "../src/vectors/types.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { ROOT, VECTORS } from "./helpers.ts";

function allVectors(): Vector[] {
  const dirs = [VECTORS, ...readdirSync(VECTORS).map((d) => join(VECTORS, d)).filter((d) => existsSync(join(d, "manifest.json")) && d !== join(VECTORS, "governance"))];
  return dirs.flatMap((d) => loadSuite(d).files.flatMap((f) => f.file.vectors));
}

describe("CLARIFY classes, age and task-force questions", () => {
  const meta = loadClarifyMeta(ROOT);
  const vs = allVectors();
  it("every CLARIFY vector carries the entry from vectors-src/clarify-classes.json, and no other vector carries one", (t) => {
    const clarify = vs.filter((v) => v.clarify !== null);
    assert.ok(clarify.length > 0);
    for (const v of clarify) {
      const m = meta.vectors[v.id];
      assert.ok(m !== undefined, `${v.id}: no entry`);
      assert.deepEqual({ class: v.clarifyClass, since: v.clarifySince, questions: v.clarifyQuestions }, m, v.id);
    }
    for (const v of vs.filter((x) => x.clarify === null)) assert.ok(v.clarifyClass === undefined && v.clarifySince === undefined && v.clarifyQuestions === undefined, v.id);
    const ids = new Set(clarify.map((v) => v.id));
    assert.deepEqual(Object.keys(meta.vectors).filter((id) => !ids.has(id)), [], "entries for vectors that are not CLARIFY");
    const by: Record<string, number> = {};
    for (const v of clarify) by[v.clarifyClass!] = (by[v.clarifyClass!] ?? 0) + 1;
    t.diagnostic(`CLARIFY by class: ${CLARIFY_CLASSES.map((c) => `${c} ${by[c] ?? 0}`).join(", ")}; unclassified: ${clarify.filter((v) => v.clarifyClass === "unclassified").map((v) => v.id).join(", ")}`);
  });
  it("question ids name a drafted question in docs/proposals/tf-question-list.md or docs/09", () => {
    const tfq = readFileSync(join(ROOT, "docs", "proposals", "tf-question-list.md"), "utf8");
    const d09 = readFileSync(join(ROOT, "docs", "09-draft-questions-for-task-force.md"), "utf8");
    for (const [id, m] of Object.entries(meta.vectors)) {
      for (const q of m.questions) {
        const [kind, n] = q.split(":") as [string, string];
        assert.ok(kind === "tfq" ? new RegExp(`^${n}\\. `, "m").test(tfq) : new RegExp(`^## Draft ${n}:`, "m").test(d09), `${id}: ${q} names no drafted question`);
      }
    }
  });
  it("the format is checked: class, age and question ids", () => {
    assert.deepEqual(clarifyMetaProblems({ class: "spec-silent", since: "0.1.0-draft", questions: ["tfq:Q3", "d09:1"] }, "x"), []);
    assert.deepEqual(clarifyMetaProblems({ class: "spec-silent", since: "2026-11-15", questions: [] }, "x"), []);
    const bad = clarifyMetaProblems({ class: "vague", since: "soon", questions: ["Q3"] }, "x");
    for (const re of [/class must be/, /since must be/, /questions must be/]) assert.ok(bad.some((p) => re.test(p)), String(re));
  });
  it("the validator requires the three fields on a CLARIFY vector and refuses them elsewhere; the generators' helper fills them", () => {
    const file = JSON.parse(readFileSync(join(VECTORS, "framework", "prf.json"), "utf8")) as VectorFile;
    const v = file.vectors.find((x) => x.clarify !== null)!;
    const stripped: VectorFile = { ...file, vectors: [{ ...v, clarifyClass: undefined, clarifySince: undefined, clarifyQuestions: undefined }] };
    assert.ok(validateVectorFile(JSON.parse(JSON.stringify(stripped))).some((m) => /clarifyClass/.test(m)));
    applyClarifyMeta([stripped], meta);
    assert.deepEqual(validateVectorFile(JSON.parse(JSON.stringify(stripped))), []);
    const plain = file.vectors.find((x) => x.clarify === null)!;
    assert.ok(validateVectorFile({ ...file, vectors: [{ ...plain, clarifyClass: "spec-silent" }] }).some((m) => /CLARIFY vectors only/.test(m)));
    assert.throws(() => applyClarifyMeta([{ ...file, vectors: [{ ...plain, id: "PRF-999", clarify: "x" }] }], meta), /PRF-999/);
  });
});
