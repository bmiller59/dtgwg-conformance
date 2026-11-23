// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToday, recordPath, redactArgv, redactDeep } from "../src/runner/provenance.ts";

describe("run provenance (R4)", () => {
  const root = "/r/suite";
  it("records paths inside the suite tree relative, and any other absolute path as <path>", () => {
    assert.equal(recordPath("/r/suite/vectors/plain", root), "vectors/plain");
    assert.equal(recordPath("/elsewhere/x", root), "<path>");
    assert.equal(recordPath("vectors", root), "vectors");
  });
  it("redacts absolute paths embedded in adapter specs and options, not URLs", () => {
    assert.deepEqual(redactArgv(["http:http://127.0.0.1:8080/"], root), ["http:http://127.0.0.1:8080/"]);
    assert.deepEqual(redactArgv(["--kit", "/x/tf", "--adapter", "stdio:node /x/a.js", "--out", "/r/suite/results/runs/x"], root), ["--kit", "<path>", "--adapter", "stdio:node <path>", "--out", "results/runs/x"]);
    assert.deepEqual(redactDeep({ a: ["KW_ROOT=/x/kw"], n: 1 }, root), { a: ["KW_ROOT=<path>"], n: 1 });
  });
  it("--today takes only a calendar date", () => {
    assert.equal(parseToday("2026-11-15"), "2026-11-15");
    assert.throws(() => parseToday("15/11/2026"));
    assert.throws(() => parseToday("2026-13-45"));
  });
});

describe("run.json cites the suite (R1)", () => {
  it("records the suite commit id, a dirty flag and the package version", async () => {
    const { suiteCommit, suiteVersion, buildToolProvenance } = await import("../src/runner/provenance.ts");
    const root = new URL("..", import.meta.url).pathname;
    const c = suiteCommit(root);
    if (c.commit !== null) assert.match(c.commit, /^[0-9a-f]{40}$/);
    assert.equal(suiteVersion(root), JSON.parse((await import("node:fs")).readFileSync(`${root}package.json`, "utf8")).version);
    const t = buildToolProvenance({ root, tool: "governance", argv: [] });
    assert.equal(t.suite.version, suiteVersion(root));
    assert.equal(suiteVersion("/nonexistent"), null);
  });
});
