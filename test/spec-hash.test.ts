// SPDX-License-Identifier: Apache-2.0
// The spec and schema hashes (src/vectors/spec-hash.ts, docs/23): markup-only changes keep the hash, a changed word moves it.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { hashTfPath, jsonHashOfText, normaliseSpec, passageDiff, specHashOfText } from "../src/vectors/spec-hash.ts";

const BASE = `# Grant

The recipient **MUST** reject a grant whose \`expires\` is in the past.

| Field | Meaning |
|---|---|
| id | the [grant id](https://example.test/x) |

- a bullet with _emphasis_ and snake_case_name
`;

describe("specHashOfText", () => {
  it("ignores whitespace, wrapping, emphasis, link syntax, heading hashes, table pipes and bullets", () => {
    const restyled = `## Grant\n\n\nThe recipient MUST   reject a grant\nwhose expires is in the past.\n\nField  Meaning\nid   the grant id\n\n* a bullet with *emphasis* and snake_case_name\n`;
    assert.equal(specHashOfText(restyled), specHashOfText(BASE));
  });
  it("is the same after a line shift (text inserted above that is itself markup only)", () => {
    assert.equal(specHashOfText(`\n\n\n<!-- note -->\n\n${BASE}`), specHashOfText(BASE));
  });
  it("changes when a word changes", () => {
    assert.notEqual(specHashOfText(BASE.replace("reject", "accept")), specHashOfText(BASE));
    assert.notEqual(specHashOfText(BASE.replace("MUST", "SHOULD")), specHashOfText(BASE));
  });
  it("keeps snake_case words intact", () => {
    assert.match(normaliseSpec(BASE), /snake_case_name/);
  });
});

describe("jsonHashOfText", () => {
  it("ignores key order and formatting, not values", () => {
    assert.equal(jsonHashOfText('{"a":1,"b":{"c":2}}'), jsonHashOfText('{\n "b": {"c": 2},\n "a": 1\n}'));
    assert.notEqual(jsonHashOfText('{"a":1}'), jsonHashOfText('{"a":2}'));
  });
});

describe("hashTfPath", () => {
  it("hashes a task spec and its payload schema; a missing file is null", () => {
    const root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "tt-spec-hash-"));
    mkdirSync(join(root, "specs/acl/grant/0.3"), { recursive: true });
    writeFileSync(join(root, "specs/acl/grant/0.3/spec.md"), BASE);
    writeFileSync(join(root, "specs/acl/grant/0.3/payload.schema.json"), '{"type":"object"}');
    const h = hashTfPath(root, "specs/acl/grant/0.3/spec.md")!;
    assert.equal(h.specHash, specHashOfText(BASE));
    assert.equal(h.schemaHash, jsonHashOfText('{"type":"object"}'));
    assert.equal(hashTfPath(root, "SPEC.md"), null);
  });
});

describe("passageDiff", () => {
  it("is empty for equal texts and shows the changed paragraph otherwise", () => {
    assert.deepEqual(passageDiff(BASE, BASE), []);
    const d = passageDiff(BASE, BASE.replace("reject", "accept"));
    assert.equal(d.length, 2);
    assert.match(d[0]!, /^- .*reject/);
    assert.match(d[1]!, /^\+ .*accept/);
  });
});
