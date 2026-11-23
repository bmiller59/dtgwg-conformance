// SPDX-License-Identifier: Apache-2.0
// The decision register is a folder of topic files: every anchor id is unique across the folder, and the README table lists every file.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

const dir = join(SUITE_ROOT, "docs", "decisions");
const topics = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();

describe("decision register", () => {
  test("every anchor id appears once across the folder", () => {
    const seen = new Map<string, string>();
    for (const f of topics) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/<a id="([^"]+)"><\/a>/g)) {
        const id = m[1] ?? "";
        assert.ok(!seen.has(id), `${id} is in both ${seen.get(id)} and ${f}`);
        seen.set(id, f);
      }
    }
    assert.ok(seen.size > 200, `expected the recorded decisions, found ${seen.size}`);
  });

  test("the README table lists every topic file", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    for (const f of topics) assert.ok(readme.includes(`(${f})`), `README does not list ${f}`);
  });
});
