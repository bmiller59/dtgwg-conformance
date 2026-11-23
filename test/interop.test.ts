// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, render, type Ledger, type Entry } from "../scripts/interop-ledger-view.ts";
import { compute } from "../scripts/interop-matrix.ts";
import { NEEDS_RUNS, RESULTS } from "./helpers.ts";

const good: Entry = {
  id: "IX-001", date: "2026-12-01",
  sender: { platform: "keyring-wallet", version: "abc" }, receiver: { platform: "VTI", version: "def" },
  task: "acl/list", version: "0.3", carrier: "https", evidence: ["results/interop/example.json"], outcome: "accepted",
};

test("the seed ledger is valid and empty", () => {
  const l = JSON.parse(readFileSync(new URL("../results/interop/ledger.json", import.meta.url), "utf8")) as Ledger;
  assert.deepEqual(validate(l), []);
  assert.equal(l.entries.length, 0);
  assert.match(render(l), /No cross-platform execution has been recorded/);
});

test("the ledger refuses entries without evidence, with a stand-in as a party, or with one platform on both sides", () => {
  const f = "tt-interop-ledger/0.1";
  assert.deepEqual(validate({ format: f, entries: [good] }), []);
  assert.ok(validate({ format: f, entries: [{ ...good, evidence: [] }] }).length > 0);
  assert.ok(validate({ format: f, entries: [{ ...good, sender: { platform: "truststackers-stand-in", version: "x" } }] }).length > 0);
  assert.ok(validate({ format: f, entries: [{ ...good, receiver: { platform: "keyring-wallet", version: "x" } }] }).length > 0);
});

test("the pair matrix computes and never pairs the two VTI surfaces", NEEDS_RUNS, () => {
  const m = compute(RESULTS);
  assert.ok(m.pairs.length > 0);
  for (const p of m.pairs) {
    assert.ok(!(p.pair.includes("vti-live") && p.pair.includes("vti-inproc")));
    assert.ok(p.total.bothPass <= p.total.ran);
  }
});
