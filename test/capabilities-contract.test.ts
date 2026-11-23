// SPDX-License-Identifier: Apache-2.0
// R13: optional capability names form a closed list; the adapter contract carries a version.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { CONTRACT_VERSION, OPTIONAL_CAPABILITIES, REQUIRE_PREFIXES, requireEntryProblem, unknownOptionalNames } from "../src/adapter/contract.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { ROOT, VECTORS, tempDir } from "./helpers.ts";

const NODE = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name), ext) : d.name.endsWith(ext) ? [join(dir, d.name)] : []));
}

function oneVector(extra: Record<string, unknown>): unknown {
  return {
    format: "tt-conformance-vectors/0.1",
    group: "XX",
    family: "x",
    clock: { start: "2026-01-01T00:00:00Z" },
    vectors: [{ id: "XX-001", title: "t", tier: 1, spec: ["s"], clarify: null, steps: [{ send: {} }], ...extra }],
  };
}

describe("R13: optional capability names and the contract version", () => {
  it("every optional name used in vectors/ and src/ is in OPTIONAL_CAPABILITIES; the list is sorted and has no duplicate", () => {
    const used = new Set<string>();
    for (const f of [...walk(VECTORS, ".json"), ...walk(join(ROOT, "src"), ".ts")]) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/optional:([A-Za-z][A-Za-z.]*[A-Za-z])(?![A-Za-z.])/g)) used.add(m[1]!);
    }
    assert.deepEqual(unknownOptionalNames([...used]), []);
    // names only declared by adapters or in skipIfOptional are not prefixed: check them through the vectors' skipIfOptional and the reference adapter below
    assert.equal(new Set(OPTIONAL_CAPABILITIES).size, OPTIONAL_CAPABILITIES.length);
    assert.deepEqual([...OPTIONAL_CAPABILITIES], [...OPTIONAL_CAPABILITIES].sort());
  });
  it("the shipped vectors load, so none requires an unknown name", () => {
    assert.ok(loadSuite(VECTORS).files.length > 0);
  });
  it("the validator rejects an unknown optional name in requires or skipIfOptional, and an unknown requires form", () => {
    assert.match(validateVectorFile(oneVector({ requires: ["optional:recieptVerify"] })).join("\n"), /unknown optional capability optional:recieptVerify/);
    assert.match(validateVectorFile(oneVector({ skipIfOptional: ["atested"] })).join("\n"), /unknown optional capability atested/);
    assert.match(validateVectorFile(oneVector({ requires: ["carier:openPayload"] })).join("\n"), /unknown requires form/);
    assert.deepEqual(validateVectorFile(oneVector({ requires: ["optional:receiptVerify", "carrier:openPayload", "discovery", "https://example.test/x/0.1"], skipIfOptional: ["attested"] })).filter((m) => /requires|skipIfOptional/.test(m)), []);
    for (const p of REQUIRE_PREFIXES) assert.equal(requireEntryProblem(`${p}`) === null, false);
  });
  it("the reference adapters declare only known names and state the contract version", async () => {
    for (const a of [new ReferenceAdapter(), new ReferenceAdapter({ attested: true }), new ReferenceAdapter({ ceremonyStatus: true }), new ReferenceAdapter({ witness: true, vrc: false, ceremony: false, dtg: false, plain: false }), new ReferenceAdapter({ clockFree: true })]) {
      const caps = await a.capabilities();
      assert.deepEqual(unknownOptionalNames(caps.optional), [], caps.name);
      assert.equal(caps.contractVersion, CONTRACT_VERSION);
    }
  });
  it("the runner warns on an adapter declaring an unknown name, and fails under --strict", () => {
    const { dir, cleanup } = tempDir();
    try {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "tt-conformance-manifest/0.1", files: [] }));
      const mod = join(dir, "typo-adapter.ts");
      writeFileSync(
        mod,
        `import { ReferenceAdapter } from ${JSON.stringify(pathToFileURL(join(ROOT, "src/adapters/reference/reference.ts")).href)};\n` +
          `export function createAdapter() { const a = new ReferenceAdapter({ name: "typo" }); const c = a.capabilities.bind(a); a.capabilities = async () => ({ ...(await c()), optional: [...(await c()).optional, "recieptVerify"] }); return a; }\n`,
      );
      const args = [...NODE, join(ROOT, "src/runner/cli.ts"), "--adapter", `module:${mod}`, "--vectors", dir, "--tier", "1", "--today", "2026-11-15"];
      const warn = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
      assert.equal(warn.status, 0, warn.stderr + warn.stdout);
      assert.match(warn.stderr, /warning: typo: declares unknown optional capability name\(s\) recieptVerify/);
      assert.match(warn.stdout, new RegExp(`typo: adapter contract ${CONTRACT_VERSION.replace(".", "\\.")}`));
      const strict = spawnSync(process.execPath, [...args, "--strict"], { cwd: ROOT, encoding: "utf8" });
      assert.equal(strict.status, 2, strict.stderr + strict.stdout);
      assert.match(strict.stderr, /--strict: typo: declares unknown optional capability/);
    } finally {
      cleanup();
    }
  });
});
