// SPDX-License-Identifier: Apache-2.0
// scripts/rename-original.ts: renames the old platform label to "original"; dry run by default; idempotent; skips upstream text.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { PROTECTED, plan, renameText } from "../scripts/rename-original.ts";
import { tempDir } from "./helpers.ts";

const OLD = ["un", "modified"].join("");
const Old = OLD[0]!.toUpperCase() + OLD.slice(1);

describe("rename-original", () => {
  it("renames in lower case, Capitalised, UPPER case and inside identifiers", () => {
    const r = renameText(`${OLD} VTI; ${Old} 66.7%; const ${OLD.toUpperCase()}; ${OLD}Partner; completion${Old}; kw-${OLD}-row`);
    assert.equal(r.text, "original VTI; Original 66.7%; const ORIGINAL; originalPartner; completionOriginal; kw-original-row");
    assert.equal(r.count, 6);
  });
  it("uses phrase rules where original would read wrongly", () => {
    assert.equal(renameText(`at its upstream main, ${OLD}. It`).text, "at its upstream main. It");
    assert.equal(renameText(`at its upstream \`main\` (\`d7ebe8f\`, 2026-10-30), ${OLD}. It`).text, "at its upstream `main` (`d7ebe8f`, 2026-10-30). It");
    assert.equal(renameText(`container \`vta:26d0\`, ${OLD}, with policy`).text, "container `vta:26d0`, with policy");
    assert.equal(renameText(`code is run ${OLD} behind a stand-in; the code is ${OLD};`).text, "code is run as published behind a stand-in; the code is the original;");
    assert.equal(renameText(`wallet ${OLD}: 5 completed`).text, "original wallet: 5 completed");
    assert.equal(renameText(`ended as specified, ${OLD}: 62%`).text, "ended as specified, on the original platforms: 62%");
  });
  it("is idempotent", () => {
    const once = renameText(`the ${OLD} VTI, wallet ${OLD}: x, ${Old}Pair`).text;
    assert.equal(renameText(once).count, 0);
    assert.equal(renameText(once).text, once);
  });
  it("protects upstream specification snapshots and generated vectors", () => {
    for (const f of ["vectors-src/alignment/tf-snapshot.json", "vectors-src/coverage/tf-invalid-examples.json", "vectors/probe/cp-ca.json"]) assert.ok(PROTECTED.some((p) => p.test(f)), f);
    assert.ok(!PROTECTED.some((p) => p.test("docs/decisions.md")));
  });
  it("dry run changes nothing; execute rewrites tracked files only and a second plan is empty", () => {
    const { dir, cleanup } = tempDir();
    try {
      const sh = (...a: string[]): void => { execFileSync("git", a, { cwd: dir, stdio: "ignore" }); };
      sh("init", "-q");
      const put = (f: string, s: string): void => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); };
      put("docs/a.md", `The ${OLD} VTI.\n`);
      put("vectors-src/alignment/tf-snapshot.json", `"spec says ${OLD}."\n`);
      put("untracked.md", `${OLD}\n`);
      sh("add", "docs/a.md", "vectors-src/alignment/tf-snapshot.json");
      const p = plan(dir);
      assert.deepEqual(p.changes, [{ file: "docs/a.md", count: 1 }]);
      assert.equal(readFileSync(join(dir, "docs/a.md"), "utf8"), `The ${OLD} VTI.\n`);
      p.write(p.changes);
      assert.equal(readFileSync(join(dir, "docs/a.md"), "utf8"), "The original VTI.\n");
      assert.equal(readFileSync(join(dir, "vectors-src/alignment/tf-snapshot.json"), "utf8"), `"spec says ${OLD}."\n`);
      assert.equal(readFileSync(join(dir, "untracked.md"), "utf8"), `${OLD}\n`);
      assert.deepEqual(plan(dir).changes, []);
    } finally { cleanup(); }
  });
});
