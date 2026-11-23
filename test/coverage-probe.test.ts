// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { isMutantId, MUTANTS } from "../src/adapters/reference/mutants.ts";
import { makeActors, runVector } from "../src/runner/engine.ts";
import { PROFILE_WINDOW } from "../src/runner/window.ts";
import { checkNonVacuity, runSuite } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { HELD_GITNS, HELD_ROOMS, KEY_CREATE, NS_BIND, REISSUES, reissueMutantId, ROOM_CREATE, ROOM_CREATE_LINKED } from "../src/coverage/probe.ts";
import { ACTIVE_RULES, BEHAVIOUR_RULES } from "../src/coverage/behaviour/index.ts";
import { ROOT, FIXTURES, VECTORS, tempDir } from "./helpers.ts";

const DIR = join(VECTORS, "probe");
const suite = loadSuite(DIR);
const all = suite.files.flatMap((f) => f.file.vectors);
const today = "2026-11-18";

async function run(vs: typeof all, mutants: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  for (const v of vs) {
    const adapter = new ReferenceAdapter({ mutants: mutants as never });
    const caps = await adapter.capabilities();
    const iut = (await adapter.provision(["iut"])).iut!;
    const o = await runVector(adapter, v, { caps, iutVid: iut.vid, actors: makeActors(), tier: v.tier, fixtureRoot: FIXTURES, defaultClockStart: "2026-11-12T10:00:00Z", window: PROFILE_WINDOW, salt: "" });
    out.set(v.id, o.pass);
  }
  return out;
}

describe("seeded-state probe (CP-RM, CP-CA; decision CV-16; advisory, channel proposed, outside every headline count)", () => {
  it("is exactly what scripts/generate-probe.ts produces", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(join(dir, "o"));
      const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(ROOT, "scripts", "generate-probe.ts"), join(dir, "o")], { cwd: ROOT, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ["manifest.json", ...suite.files.map((f) => f.path.slice(DIR.length + 1))]) assert.equal(readFileSync(join(dir, "o", rel), "utf8"), readFileSync(join(DIR, rel), "utf8"), rel);
    } finally {
      cleanup();
    }
  });
  it("every vector creates its object first through the platform's own task, is gated on it and on seed.defaults, and re-asks one held finding or re-issues one retired vector", () => {
    assert.ok(all.length >= 20);
    const seedType = (id: string): string => (id.startsWith("CP-RM") ? (ROOM_CREATE_LINKED[(all.find((v) => v.id === id)?.steps.find((s) => !String((s.send?.document as { type?: string } | undefined)?.type).includes("rooms/create"))?.send?.document as { type?: string } | undefined)?.type ?? ""] ?? ROOM_CREATE) : id.startsWith("CP-CA") ? NS_BIND : KEY_CREATE);
    for (const v of all) {
      assert.equal(v.source?.channel, "proposed", v.id);
      assert.ok(/^CP-(RM|CA|SD)-\d{3}$/.test(v.id), v.id);
      assert.equal((v.requires ?? []).includes("optional:seed.defaults"), !v.id.startsWith("CP-SD"), v.id);
      assert.ok((v.requires ?? []).includes(seedType(v.id)), v.id);
      const seeds = v.steps.filter((s) => (s.send?.document as { type?: string } | undefined)?.type === seedType(v.id));
      assert.ok(seeds.length >= 1 && v.steps.indexOf(seeds[0]!) === 0, v.id);
      for (const s of seeds) assert.equal(s.expect?.disposition, "response", `${v.id}: the seed must succeed, not be accepted as a refusal`);
      const probes = v.steps.slice(seeds.length);
      assert.ok(probes.length >= 1, v.id);
      const reissue = /re-issued from the retired (CB-[A-Z]+-\d+)/.exec(v.title)?.[1];
      if (reissue === undefined) {
        assert.deepEqual(v.mutants, ["noPayloadValidation"], v.id);
        for (const s of probes) assert.deepEqual((s.expect?.code as string[]).slice(0, 2), ["malformedRequest", "permissionDenied"], v.id); // then the task's own standing codes (D882)
        assert.ok(v.spec.some((x) => x.startsWith("Seeded-state probe")), v.id);
        const of = /seeded probe of ([A-Z]+-[A-Z]+-\d+)/.exec(v.title)?.[1];
        assert.ok([...HELD_ROOMS, ...HELD_GITNS].includes(of as never), `${v.id} ${String(of)}`);
      } else {
        assert.ok(REISSUES.some((r) => r.of === reissue), v.id);
        assert.deepEqual(v.mutants, [reissueMutantId(reissue)], v.id);
        assert.ok(isMutantId(reissueMutantId(reissue)) && !ACTIVE_RULES.some((r) => `bx:${r.key}` === reissueMutantId(reissue)), v.id);
        assert.equal(probes.length, 1, v.id);
      }
    }
  });
  it("a re-issue appends a new id and keeps its tombstone retired, with no oracle behaviour or mutant of its own", () => {
    const cov = loadSuite(join(VECTORS, "coverage")).files.flatMap((f) => f.file.vectors);
    for (const r of REISSUES) {
      const t = cov.find((v) => v.id === r.of) as { retired?: { reason: string } } | undefined;
      assert.ok(t?.retired !== undefined && t.retired.reason.length > 40, r.of);
      assert.ok(BEHAVIOUR_RULES.some((x) => x.retired !== undefined && `bs:${x.key}` === reissueMutantId(r.of)), r.of);
    }
  });
  it("is excluded from the default (registry) run and does not enter the registry vector directory", async () => {
    const r = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "" });
    assert.equal(r.results.length, 0);
    const root = loadSuite(VECTORS);
    const ids = new Set(root.files.flatMap((f) => f.file.vectors.map((v) => v.id)));
    for (const v of all) assert.ok(!ids.has(v.id), v.id);
  });
  it("the reference passes every vector; one that serves no plain task SKIPs them", async () => {
    const r = await runSuite({ adapter: new ReferenceAdapter(), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["proposed"] });
    assert.deepEqual(r.results.filter((x) => x.status !== "PASS").map((x) => `${x.id} ${x.status}`), []);
    assert.equal(r.results.length, all.length);
    const none = await runSuite({ adapter: new ReferenceAdapter({ plain: false }), suite, tier: 1, today, fixtureRoot: FIXTURES, salt: "", channels: ["proposed"] });
    assert.equal(none.results.filter((x) => x.status !== "SKIP").length, 0);
  });
  it("non-vacuity: a platform that never validates (noPayloadValidation) fails every probe", async () => {
    const rows = await checkNonVacuity(suite, FIXTURES);
    assert.ok(rows.length >= all.length);
    assert.deepEqual(rows.filter((x) => !x.caught), []);
  });
  it("the order is not the question: a lookup-first platform (lookupFirst) fails the unseeded held vectors and passes every probe", async () => {
    assert.ok(isMutantId("lookupFirst") && !("lookupFirst" in MUTANTS));
    const cov = loadSuite(join(VECTORS, "coverage"));
    const held = cov.files.flatMap((f) => f.file.vectors).filter((v) => [...HELD_ROOMS, ...HELD_GITNS].includes(v.id as never) && v.id !== "CX-RM-005");
    assert.equal(held.length, HELD_ROOMS.length + HELD_GITNS.length - 1);
    const unseeded = await run(held, ["lookupFirst"]);
    assert.deepEqual([...unseeded].filter(([, pass]) => pass).map(([id]) => id), [], "every held vector names an object the reference does not hold");
    const seeded = await run(all, ["lookupFirst"]);
    assert.deepEqual([...seeded].filter(([, pass]) => !pass).map(([id]) => id), []);
    const clean = await run(held, []);
    assert.deepEqual([...clean].filter(([, pass]) => !pass).map(([id]) => id), [], "the validate-first reference passes the unseeded vectors");
  });
});
