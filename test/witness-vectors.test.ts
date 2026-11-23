// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { loadSuite } from "../src/vectors/load.ts";
import { relaxThreadIdValidation, threadRepresentable, v2ThreadHeaders } from "../src/carriers/didcomm/carrier.ts";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = join(ROOT, "vectors", "witness");

describe("witness vectors and the DIDComm carrier helpers", () => {
  const suite = loadSuite(DIR);
  const all = suite.files.flatMap((f) => f.file.vectors);
  it("load, validate and trace to a specification rule", () => {
    assert.ok(all.length > 0);
    for (const v of all) assert.ok(v.spec.length > 0 && v.spec.every((s) => s.length > 3), v.id);
  });
  it("every vector requires a DIDComm carriage", () => {
    for (const v of all) assert.ok((v.requires ?? []).includes("binding:didcomm"), v.id);
  });
  it("are exactly what scripts/generate-witness-vectors.ts produces", () => {
    const dir = mkdtempSync(join(tmpdir(), "wit-"));
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-witness-vectors.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", ...suite.files.map((f) => f.path.slice(DIR.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("thread ids are carried on ~thread only when they have the RFC 0008 shape (bindings/didcomm-v1 0.2 section 3.1)", () => {
    assert.equal(threadRepresentable("urn:uuid:4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92"), false);
    assert.equal(threadRepresentable("4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92"), true);
    assert.equal(threadRepresentable("short"), false);
    assert.equal(threadRepresentable(undefined), false);
  });
  it("a v2 envelope carries thid/pthid only when Credo would accept them; the document keeps its own threadId in the body", () => {
    const urn = "urn:uuid:4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92";
    const plain = "4a0e2b77-88c1-4d55-9f2a-6c3d1e5b7a92";
    assert.deepEqual(v2ThreadHeaders({ id: urn }), {});
    assert.deepEqual(v2ThreadHeaders({ id: urn, threadId: plain }), { thid: plain });
    assert.deepEqual(v2ThreadHeaders({ id: plain, parentThreadId: urn }), { thid: plain });
    assert.deepEqual(v2ThreadHeaders({ id: urn, threadId: plain, parentThreadId: plain }), { thid: plain, pthid: plain });
  });
  it("the inbound ~thread pattern check is lifted for the thread ids only", () => {
    const target = { name: "ThreadDecorator" };
    const other = { name: "Other" };
    const m = (propertyName: string, name: string) => ({ propertyName, name });
    const store = new Map<unknown, unknown[]>([
      [target, [m("threadId", "matches"), m("parentThreadId", "matches"), m("senderOrder", "isInt"), m("threadId", "isOptional")]],
      [other, [m("threadId", "matches")]],
    ]);
    const removed = relaxThreadIdValidation({ getMetadataStorage: () => ({ validationMetadatas: store }) });
    assert.equal(removed, 2);
    assert.deepEqual(store.get(target), [m("senderOrder", "isInt"), m("threadId", "isOptional")]);
    assert.equal((store.get(other) as unknown[]).length, 1);
  });
});
