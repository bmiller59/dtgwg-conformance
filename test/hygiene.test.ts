// SPDX-License-Identifier: Apache-2.0
// Public-safety hygiene: no tracked file may carry a local filesystem path (home directories,
// shared working trees, temporary directories). Use placeholders such as `<TF checkout>` instead.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { SUITE_ROOT } from "../src/vectors/source.ts";

// Built from parts so this file does not match itself.
const SLASH = "/";
const PRIVATE_PATH = new RegExp(
  [`${SLASH}home${SLASH}`, `${SLASH}srv${SLASH}`, `${SLASH}var${SLASH}tmp${SLASH}`, `(^|[\\s'"\`(=:])${SLASH}tmp${SLASH}`].join("|"),
);

/** Explicit allowlist: a file and a fragment of the one line in it that may name such a path. */
const ALLOW: ReadonlyArray<{ file: string; line: string }> = [
  // The hygiene rule itself, which quotes the scan pattern.
  { file: "CLAUDE.md", line: "Scan before committing" },
];

describe("hygiene: tracked files", () => {
  test("no tracked file contains a private filesystem path", (t) => {
    const r = spawnSync("git", ["grep", "-nI", "-E", PRIVATE_PATH.source, "--", "."], { cwd: SUITE_ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
    if (r.status === null || r.status > 1) {
      t.skip("not a git checkout");
      return;
    }
    const hits = r.stdout
      .split("\n")
      .filter((l) => l !== "")
      .filter((l) => {
        const [file] = l.split(":", 1);
        return !ALLOW.some((a) => a.file === file && l.includes(a.line));
      });
    assert.deepEqual(hits, [], "replace these paths with placeholders such as <TF checkout>");
  });
});
