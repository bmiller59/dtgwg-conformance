// SPDX-License-Identifier: Apache-2.0
// The reconciliation of the keyring-wallet task-grain list with the census (docs/22): computed from the files, balanced, and printed.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseCensus, CENSUS_HEADER } from "../src/coverage/families.ts";
import { loadCensus } from "../src/coverage/families.ts";
import { buildCoveragePage, namedTypesOf, scopeFileSlugs } from "../src/coverage/pages.ts";
import { reconcile } from "../src/coverage/reconcile.ts";
import { scopeTasks } from "../src/glance/docs.ts";
import { ROOT } from "./helpers.ts";

const head = CENSUS_HEADER.split(",").join("\t");
describe("reconcile (synthetic)", () => {
  const census = parseCensus([head,
    "a/one/0.1\tKW\tdraft\tSD\t0\tsent", "a/one/0.2\tKW\tdraft\tSD\t0\tsent", "b/two/0.1\tKW\tdraft\tSD\t0\treceived", "c/three/0.1\tKW\tdraft\tSD\t0\tdeclared-only", "d/four/0.1\tVTA\tdraft\tSD\t0\t-"].join("\n"));
  it("finds census-only and list-only slugs, balances, and separates sent from named", () => {
    const r = reconcile(census, ["a/one", "x/gone", "b/two"], ["a/one/0.2", "e/five/0.1"]);
    assert.deepEqual(r.censusOnly.map((x) => x.slug), ["c/three"]);
    assert.deepEqual(r.listOnly.map((x) => x.slug), ["e/five", "x/gone"]);
    assert.equal(r.censusSlugs, 3); assert.equal(r.taskList, 4); assert.equal(r.balances, true);
    assert.equal(r.multiVersionSlugs, 1); assert.equal(r.censusSentSlugs, 1); assert.equal(r.sentNotInList, 0); assert.equal(r.listNotSent, 1);
    assert.deepEqual(r.namedNotKwRow.map((x) => x.type), ["e/five/0.1"]);
  });
});

describe("reconcile (the repository's own files)", () => {
  const r = reconcile(loadCensus(), scopeFileSlugs(ROOT), namedTypesOf(ROOT));
  it("agrees with the task list the page and README already use", () => {
    assert.equal(r.taskList, scopeTasks(ROOT, "keyring-wallet").length);
    assert.equal(r.inScopeFile + r.fromNamedFile, r.taskList);
  });
  it("balances: census slugs = task list - list-only + census-only, and every census KW type belongs to a counted slug", () => {
    assert.equal(r.balances, true);
    assert.equal(r.censusSlugs, new Set(loadCensus().filter((x) => x.kw).map((x) => x.slug)).size);
    assert.equal(r.both + r.censusOnly.length, r.censusSlugs);
  });
  it("is printed on the coverage page with every census-only and list-only task named", () => {
    const page = buildCoveragePage(ROOT);
    assert.match(page, /## Reconciling the task-grain and version-grain figures/);
    for (const x of r.censusOnly) assert.ok(page.includes(`| \`${x.slug}\` |`), x.slug);
    for (const x of r.listOnly) assert.ok(page.includes(`| \`${x.slug}\` |`), x.slug);
    assert.match(page, new RegExp(`${r.censusSlugs} = ${r.taskList} - ${r.listOnly.length} \\+ ${r.censusOnly.length}`));
  });
  it("the page headline for keyring-wallet is the sent count, with the all-used figure beside it", () => {
    const page = buildCoveragePage(ROOT);
    const kw = loadCensus().filter((x) => x.kw);
    assert.match(page, new RegExp(`keyring-wallet sends ${kw.filter((x) => x.kwSends).length} of the ${kw.length} types its source names`));
    assert.match(page, new RegExp(`${kw.length} types, \\d+ with a vector`));
  });
});
