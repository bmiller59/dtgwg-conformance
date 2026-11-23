// SPDX-License-Identifier: Apache-2.0
// Review R19: the governance probes are suite instruments, marked `probe` and counted apart from the candidates (docs/04 section 18.1, docs/17).
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { familyTable } from "../src/glance/docs.ts";
import { loadProbes } from "../src/governance/probes.ts";
import { countedClassOf, probeMarkerErrors } from "../src/vectors/source.ts";
import { validateVectorFile } from "../src/vectors/validate.ts";
import { ROOT, tempDir, VECTORS } from "./helpers.ts";

describe("the probe marker", () => {
  it("every shipped governance probe carries probe: true and stays in channel candidate", () => {
    const probes = loadProbes(join(VECTORS, "governance"));
    assert.equal(probes.length, 5);
    for (const p of probes) {
      assert.equal(p.probe, true, p.id);
      assert.equal(p.source.channel, "candidate", p.id);
      assert.equal(countedClassOf(p), "probe", p.id);
    }
  });
  it("countedClassOf: the channel, except a probe", () => {
    assert.equal(countedClassOf({ source: { channel: "candidate" } }), "candidate");
    assert.equal(countedClassOf({ source: { channel: "registry" } }), "registry");
    assert.equal(countedClassOf({}), "registry");
    assert.equal(countedClassOf({ probe: true, source: { channel: "candidate" } }), "probe");
  });
  it("the validator allows only probe: true, and only in channel candidate", () => {
    assert.deepEqual(probeMarkerErrors({ source: { channel: "registry" } }, "$"), []);
    assert.deepEqual(probeMarkerErrors({ probe: true, source: { channel: "candidate" } }, "$"), []);
    assert.match(probeMarkerErrors({ probe: false, source: { channel: "candidate" } }, "$").join(), /only true/);
    assert.match(probeMarkerErrors({ probe: true, source: { channel: "registry" } }, "$").join(), /must be in channel candidate/);
    // in a vector file
    const core = JSON.parse(readFileSync(join(VECTORS, "framework", "env.json"), "utf8"));
    const one = { ...core, vectors: [{ ...core.vectors[0], probe: true }] };
    assert.match(validateVectorFile(one).join(), /probe: a probe must be in channel candidate/);
  });
  it("the governance loader refuses a probe without the marker", () => {
    const { dir, cleanup } = tempDir();
    try {
      const j = JSON.parse(readFileSync(join(VECTORS, "governance", "gov.json"), "utf8"));
      delete j.probes[2].probe;
      mkdirSync(join(dir, "g"));
      writeFileSync(join(dir, "g", "gov.json"), JSON.stringify(j));
      assert.throws(() => loadProbes(join(dir, "g")), /probes\[2\]\.probe: every governance probe carries probe: true/);
    } finally {
      cleanup();
    }
  });
});

describe("probes are counted apart wherever channel counts are shown", () => {
  it("the families block: core keeps candidate 32, the probes have their own row as probe 5", () => {
    const t = familyTable(ROOT);
    assert.match(t, /\| core \|.*candidate 32 \(Tier 1: 22\)/);
    assert.match(t, /\| governance probes \(`npm run governance`\) \| `vectors\/governance` \| 5 \| 0 \| 5 \| probe 5 \(channel candidate, counted apart\) \|/);
    assert.ok(!/\| governance probes.*candidate [0-9]/.test(t.replace("channel candidate, counted apart", "")));
  });
});
