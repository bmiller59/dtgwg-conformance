// SPDX-License-Identifier: Apache-2.0
// The CE (what a platform sends) coverage vectors require `emit:<type>`. For the VTI emit adapter every such type must be accounted for:
// a client builder in the host's flow table drives it, or the source survey (not-built.json) records, with evidence, that VTI has none.
// A type in neither is reported by a run as a bare "type not emitted", which reads as a platform difference the survey never checked.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { VECTORS } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const BASE = "https://trusttasks.org/spec/";

function ceEmitTypes(): string[] {
  const dir = join(VECTORS, "coverage");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => /^ce-.*\.json$/.test(x))) {
    for (const v of JSON.parse(readFileSync(join(dir, f), "utf8")).vectors as { requires: string[] }[]) {
      for (const r of v.requires) if (r.startsWith("emit:")) out.add(r.slice(5));
    }
  }
  return [...out].sort();
}

describe("VTI emit adapter: the CE coverage types are all accounted for", () => {
  const flows = readFileSync(join(ROOT, "src/adapters/vti-emit/rust/src/flows.rs"), "utf8");
  const built = new Set([...flows.matchAll(/^\s*"([^"]+)", "([^"]+)",/gm)].map((m) => BASE + m[1]!));
  const notBuilt = JSON.parse(readFileSync(join(ROOT, "src/adapters/vti-emit/not-built.json"), "utf8")) as Record<string, string>;
  it("every CE emit type has a client flow or a surveyed not-built reason, never both", () => {
    const types = ceEmitTypes();
    assert.ok(types.length >= 30, "the CE vectors name emit types");
    const missing = types.filter((t) => !built.has(t) && notBuilt[`emit:${t}`] === undefined);
    assert.deepEqual(missing, [], "types with neither a flow nor a not-built entry");
    const both = types.filter((t) => built.has(t) && notBuilt[`emit:${t}`] !== undefined);
    assert.deepEqual(both, [], "types with a flow and a stale not-built entry");
  });
  it("the fixed file identifier the file-key flow sends satisfies the task's own pattern (a stricter client refuses a placeholder)", { skip: process.env.TT_KIT === undefined ? "TT_KIT names no task-force checkout" : false }, () => {
    const schema = JSON.parse(readFileSync(join(process.env.TT_KIT ?? "", "specs/rooms/keys/file-key/0.2/payload.schema.json"), "utf8")) as { properties: { fileId: { pattern: string } } };
    const m = /const FILE_ID: &str = "([^"]+)";/.exec(flows);
    assert.ok(m !== null, "flows.rs defines FILE_ID");
    assert.match(m[1]!, new RegExp(schema.properties.fileId.pattern));
  });
});
