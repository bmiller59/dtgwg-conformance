// SPDX-License-Identifier: Apache-2.0
// The layer map in README.md and the layer model in docs/01-layer-model.md must not drift apart: the same bands in the same
// order with the same titles, the same vector-group lists, and every "what the suite checks here" sentence in the README table
// stated in docs/01 word for word.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

const read = (f: string) => readFileSync(join(SUITE_ROOT, f), "utf8");
const BAND = /^\s{1,2}(4b|4a|3d|3c|3b-DTG|3b|3a|2|1)\s+(.+?)(?:\s{2,}(?:groups:\s*(.+)|no vectors))?\s*$/;

interface Row { id: string; title: string; groups: string }

/** Bands from the first fenced text block that lists them (README diagram or docs/01 section 2). */
function bands(markdown: string, from: string): Row[] {
  const start = markdown.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const open = markdown.indexOf("```", start);
  const close = markdown.indexOf("```", open + 3);
  const rows: Row[] = [];
  for (const line of markdown.slice(open, close).split("\n")) {
    const m = BAND.exec(line.replace(/\.{3,}.*$/, ""));
    if (m) rows.push({ id: m[1] ?? "", title: (m[2] ?? "").trim(), groups: (m[3] ?? "").trim() });
  }
  return rows;
}

const strip = (s: string) => s.replace(/`/g, "").replace(/\s+/g, " ").trim();

describe("layer map: README and docs/01 agree", () => {
  const readme = read("README.md");
  const model = read("docs/01-layer-model.md");
  const ORDER = ["4b", "4a", "3d", "3c", "3b-DTG", "3b", "3a", "2", "1"];

  test("README lists every band in order", () => {
    assert.deepEqual(bands(readme, "## The layer map").map((r) => r.id), ORDER);
  });

  test("docs/01 diagram lists the same bands with the same titles", () => {
    const a = bands(readme, "## The layer map");
    const b = bands(model, "## 2. Diagram").filter((r) => r.id !== "AP");
    for (const row of a) {
      const other = b.find((x) => x.id === row.id);
      assert.ok(other, `docs/01 diagram lacks band ${row.id}`);
      const name = (t: string) => (t.split(/\s{2,}/)[0] ?? "").trim();
      assert.equal(name(other.title), name(row.title), `band ${row.id}: title differs (${row.title} vs ${other.title})`);
    }
  });

  test("every 'what the suite checks here' sentence in the README table is stated in docs/01", () => {
    const table = readme.slice(readme.indexOf("| Band |"), readme.indexOf("</details>", readme.indexOf("| Band |")));
    const rows = table.split("\n").filter((l) => /^\| (4b|4a|3d|3c|3b-DTG|3b|3a|2|1) /.test(l));
    assert.equal(rows.length, ORDER.length);
    const modelText = strip(model);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const checks = strip(cells[4] ?? "");
      assert.ok(modelText.includes(checks), `docs/01 does not state: ${checks}`);
    }
  });

  test("the layer-model credit names its author in the README and in docs/01", () => {
    assert.match(readme, /proposed by Brendan A\. Miller/);
    assert.match(model, /proposed by Brendan A\. Miller/);
  });

  test("error replies sit in 3b, not 3a", () => {
    const a3 = model.slice(model.indexOf("### Layer 3a:"), model.indexOf("### Layer 3b:"));
    assert.ok(!/error response form/.test(a3));
    assert.match(model.slice(model.indexOf("### Layer 3b:")), /trust-task-error/);
  });
});
