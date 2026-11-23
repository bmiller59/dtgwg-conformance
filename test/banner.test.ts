// SPDX-License-Identifier: Apache-2.0
// One status banner on every reader-facing page: the same sentence near the top of each tracked Markdown file, so no page
// can be read as an adopted or endorsed standard. A page may add sentences after the banner.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

export const BANNER =
  "**Status: draft proposal.** This is a draft proposal for discussion and review by the DTGWG (Trust over IP Decentralized Trust Graph Working Group). It is not an adopted or endorsed standard or test suite.";

/** How many lines (after any YAML front matter) the banner must appear within. */
const WITHIN = 8;

/** Files without the banner, and why. */
const EXEMPT: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /^vectors\//, why: "vector data, not a page" },
  { pattern: /(^|\/)(LICENSE|NOTICE|COPYING)[^/]*$/i, why: "licence texts are reproduced unchanged" },
  {
    pattern: /^docs\/10-witness-share-profile\.md$/,
    why: "pinned source text of the witness-share vectors (vectors/pins.json holds its digest); any edit is spec drift. It states its own draft status",
  },
  { pattern: /^results\/TEMPLATE-run\/(draft-issues\/|issues-PLATFORM\.md$)/, why: "templates for text addressed to a platform's maintainers; each carries a 'draft, not filed' line instead" },
];

function trackedMarkdown(): string[] | undefined {
  const r = spawnSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: SUITE_ROOT, encoding: "utf8" });
  if (r.status !== 0) return undefined;
  return r.stdout.split("\0").filter((f) => f !== "");
}

/** The lines of a page after a leading YAML front-matter block, if any. */
function body(text: string): string[] {
  const lines = text.split("\n");
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) return lines.slice(end + 1);
  }
  return lines;
}

describe("status banner", () => {
  test(`every tracked page carries the banner within its first ${WITHIN} lines`, (t) => {
    const files = trackedMarkdown();
    if (files === undefined) {
      t.skip("not a git checkout");
      return;
    }
    const checked = files.filter((f) => !EXEMPT.some((e) => e.pattern.test(f)));
    assert.ok(checked.length > 20, "expected the top-level pages and docs/ to be checked");
    const missing = checked.filter((f) => {
      const head = body(readFileSync(join(SUITE_ROOT, f), "utf8")).slice(0, WITHIN);
      return !head.some((l) => l.replace(/^>\s*/, "").startsWith(BANNER));
    });
    assert.deepEqual(missing, [], `pages without the status banner (add it, or an exemption with a reason): ${missing.join(", ")}`);
  });
});
