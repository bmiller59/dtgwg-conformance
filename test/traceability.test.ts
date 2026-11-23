// SPDX-License-Identifier: Apache-2.0
// Reverse traceability extraction (docs/04 section 18.11, src/traceability/extract.ts). The page itself needs a task-force clone and is
// not checked here (scripts/traceability.ts --check does that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, extractStatements, parseCitations } from "../src/traceability/extract.ts";

const TEXT = [
  "---", "status: draft", "proofRequirement: REQUIRED", "---",          // 1-4 front matter: skipped
  "## 2. Requirements Language",                                       // 5
  "The key words MUST and SHOULD are to be interpreted as described in BCP 14.", // 6 boilerplate: skipped
  "## 7. Consumers",                                                   // 7
  "### 7.2 Pipeline",                                                  // 8
  "1. Reject a document that",                                         // 9  one statement over two lines
  "   **MUST NOT** be processed.",                                     // 10
  "2. A consumer SHOULD log it.",                                      // 11
  "",                                                                  // 12
  "```", "MUST inside code", "```",                                    // 13-15 code: skipped
  "| `id` | **MUST** | string |",                                      // 16 table row
  "An implementation MAY do this.",                                    // 17 MAY only: not a requirement
  "#### 7.2.1 Detail",                                                 // 18
  "It is REQUIRED here.",                                              // 19
].join("\n");

test("statements: blocks with a BCP 14 keyword, outside front matter, code and the boilerplate", () => {
  const st = extractStatements("SPEC.md", TEXT);
  assert.deepEqual(st.map((s) => [s.start, s.end, s.section, s.keywords.join(",")]), [
    [9, 10, "7.2", "MUST NOT"], [11, 11, "7.2", "SHOULD"], [16, 16, "7.2", "MUST"], [19, 19, "7.2.1", "REQUIRED"],
  ]);
});

test("citations: single lines, lists, ranges and numbered sections", () => {
  const c = parseCitations("V-1", "SPEC.md:1015, 1017 and 1118 (7.2 items 5 and 7); SPEC.md:1011-1023; specs/a/b/0.1/spec.md:49-52; SPEC.md 4.7 item 8; SPEC.md (framework 0.5.0, draft) 8.3 (x)");
  const spec = c.find((x) => x.path === "SPEC.md")!;
  assert.deepEqual(spec.lines, [[1015, 1015], [1017, 1017], [1118, 1118], [1011, 1023]]);
  assert.deepEqual(spec.sections, ["4.7", "8.3"]);
  assert.deepEqual(c.find((x) => x.path === "specs/a/b/0.1/spec.md")!.lines, [[49, 52]]);
});

test("coverage: a line inside the block, else the section or a parent section, else none", () => {
  const [multi, should, row, req] = extractStatements("SPEC.md", TEXT);
  const byLine = parseCitations("V-1", "SPEC.md:10");
  assert.deepEqual(coverage(multi!, byLine), { by: "line", vectors: ["V-1"] });
  assert.equal(coverage(should!, byLine).by, "none");
  const bySec = parseCitations("V-2", "SPEC.md 7.2 item 1");
  assert.equal(coverage(row!, bySec).by, "section");
  assert.equal(coverage(req!, bySec).by, "section");
  assert.equal(coverage(req!, parseCitations("V-3", "SPEC.md 7.20")).by, "none");
  assert.equal(coverage(multi!, parseCitations("V-4", "specs/x/0.1/spec.md:10")).by, "none");
});
