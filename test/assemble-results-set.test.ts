// SPDX-License-Identifier: Apache-2.0
// scripts/assemble-results-set.ts: the overlay is copied over a copy of the base, nothing is overwritten, and bad input is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemble, plan, planRuns, undocumentedRoots, type Overlay } from "../scripts/assemble-results-set.ts";

const overlay = { format: "ceremony-overlay/1", entries: [{ row: "x.ref", as: "box", source: "r/folder-a" }] };

function fixture(): { dir: string; base: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), "assemble-"));
  const base = join(dir, "base"), root = join(dir, "root");
  mkdirSync(join(base, "runs"), { recursive: true });
  writeFileSync(join(base, "runs", "INDEX.md"), "index");
  mkdirSync(join(root, "folder-a"), { recursive: true });
  writeFileSync(join(root, "folder-a", "scenario-result.json"), '{"results":[]}');
  writeFileSync(join(root, "folder-a", "transcript.jsonl"), "big");
  return { dir, base, root };
}

test("copies the base and the overlay folders; leaves the base alone", () => {
  const { dir, base, root } = fixture();
  try {
    const out = join(dir, "out");
    assemble(base, out, overlay, { r: root }, false);
    assert.equal(readFileSync(join(out, "runs", "INDEX.md"), "utf8"), "index");
    assert.equal(readFileSync(join(out, "ceremonies", "x.ref", "box", "scenario-result.json"), "utf8"), '{"results":[]}');
    assert.equal(existsSync(join(out, "ceremonies", "x.ref", "box", "transcript.jsonl")), false);
    assert.equal(existsSync(join(base, "ceremonies")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("dry run writes nothing", () => {
  const { dir, base, root } = fixture();
  try {
    const out = join(dir, "out");
    const log = assemble(base, out, overlay, { r: root }, true);
    assert.equal(log.length, 2);
    assert.equal(existsSync(out), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses an existing output, an unknown root and a missing source", () => {
  const { dir, base, root } = fixture();
  try {
    assert.throws(() => assemble(base, base, overlay, { r: root }, true), /not overwriting/);
    assert.throws(() => plan(overlay, {}, join(dir, "o")), /no --root/);
    assert.throws(() => plan({ ...overlay, entries: [{ row: "a", as: "b", source: "r/missing" }] }, { r: root }, join(dir, "o")), /no scenario-result/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("each: every child folder with a scenario-result.json is a ceremony run; run folders and files are copied whole", () => {
  const { dir, base, root } = fixture();
  try {
    mkdirSync(join(root, "set", "s1"), { recursive: true });
    mkdirSync(join(root, "set", "s2"), { recursive: true });
    mkdirSync(join(root, "set", "notes"), { recursive: true });
    writeFileSync(join(root, "set", "s1", "scenario-result.json"), "{}");
    writeFileSync(join(root, "set", "s2", "scenario-result.json"), "{}");
    mkdirSync(join(root, "runfolder", "core"), { recursive: true });
    writeFileSync(join(root, "runfolder", "README.md"), "r");
    writeFileSync(join(root, "runfolder", "core", "results.json"), "{}");
    writeFileSync(join(root, "INDEX.md"), "new index");
    const o = {
      format: "ceremony-overlay/1", sources: [{ root: "r", about: "fixture" }],
      entries: [{ row: "y.up", source: "r/set", each: true }],
      runs: [{ name: "2026-11-20-x", source: "r/runfolder" }],
      files: [{ source: "r/INDEX.md", as: "runs/INDEX.md" }],
    };
    assert.deepEqual(undocumentedRoots(o), []);
    const out = join(dir, "out");
    assemble(base, out, o, { r: root }, false);
    assert.equal(existsSync(join(out, "ceremonies", "y.up", "s1", "scenario-result.json")), true);
    assert.equal(existsSync(join(out, "ceremonies", "y.up", "s2", "scenario-result.json")), true);
    assert.equal(existsSync(join(out, "ceremonies", "y.up", "notes")), false);
    assert.equal(readFileSync(join(out, "runs", "2026-11-20-x", "core", "results.json"), "utf8"), "{}");
    assert.equal(readFileSync(join(out, "runs", "INDEX.md"), "utf8"), "new index");
    assert.equal(readFileSync(join(base, "runs", "INDEX.md"), "utf8"), "index");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses a run folder that is already in the base, a bad name, a missing source and an undocumented root", () => {
  const { dir, base, root } = fixture();
  try {
    mkdirSync(join(root, "rf"), { recursive: true });
    mkdirSync(join(base, "runs", "dup"), { recursive: true });
    const mk = (runs: { name: string; source: string }[]) => ({ format: "ceremony-overlay/1", entries: [], runs });
    assert.throws(() => assemble(base, join(dir, "o1"), mk([{ name: "dup", source: "r/rf" }]), { r: root }, false), /already in the base/);
    assert.throws(() => planRuns(mk([{ name: "../x", source: "r/rf" }]), { r: root }, join(dir, "o")), /bad run folder name/);
    assert.throws(() => planRuns(mk([{ name: "ok", source: "r/none" }]), { r: root }, join(dir, "o")), /no run folder/);
    assert.deepEqual(undocumentedRoots(mk([{ name: "ok", source: "zzz/a" }])), ["zzz"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the committed overlay names only labelled roots, documents each one, never a local path", () => {
  const o = JSON.parse(readFileSync(new URL("../results/ceremony-overlay.json", import.meta.url), "utf8")) as Overlay;
  for (const e of [...o.entries, ...(o.runs ?? []), ...(o.files ?? [])]) {
    assert.match(e.source, /^[a-z0-9-]+\/[A-Za-z0-9._/-]+$/);
    assert.equal(e.source.split("/").includes(".."), false);
  }
  assert.deepEqual(undocumentedRoots(o), []);
  for (const s of o.sources ?? []) assert.doesNotMatch(s.about, /\/(var|srv|home|tmp)\//);
});

test("a superseded folder inside a ceremony source is not copied", () => {
  const { dir, base, root } = fixture();
  try {
    mkdirSync(join(root, "folder-a", "superseded", "old"), { recursive: true });
    writeFileSync(join(root, "folder-a", "superseded", "old", "scenario-result.json"), "{}");
    const out = join(dir, "out");
    assemble(base, out, overlay, { r: root }, false);
    assert.equal(existsSync(join(out, "ceremonies", "x.ref", "box", "scenario-result.json")), true);
    assert.equal(existsSync(join(out, "ceremonies", "x.ref", "box", "superseded")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
