// SPDX-License-Identifier: Apache-2.0
// Reach of the gap versions against a VTI source tree (src/coverage/reach.ts, scripts/gap-reach.ts), on a small synthetic tree.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { classifyReach, featureOf, isGenerated, kindOf, modulePathOf, otherDirection, reachClassOf, scanReach } from "../src/coverage/reach.ts";
import { countsByFamily, gapVersions } from "../scripts/gap-reach.ts";
import { VECTORS } from "./helpers.ts";

const B = "https://trusttasks.org/spec/";
function tree(files: Record<string, string>): string {
  const r = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "reach-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(r, p)), { recursive: true });
    writeFileSync(join(r, p), c);
  }
  return r;
}

describe("gap reach: reading a VTI tree", () => {
  it("turns a type URI into the module path of its generated crate", () => {
    assert.equal(modulePathOf(`${B}did-management/did/check-name/0.1`), "did_management::did::check_name::v0_1");
    assert.equal(modulePathOf("https://example.org/x"), null);
  });
  it("leaves generated crates, locks and docs out, and sorts the rest by what the file is", () => {
    assert.ok(isGenerated("vti-specs-vtc/src/lib.rs"));
    assert.ok(isGenerated("vti-specs-core/trust-tasks.lock"));
    assert.ok(isGenerated("docs/x.md"));
    assert.ok(!isGenerated("vtc-service/src/trust_tasks/mod.rs"));
    assert.equal(kindOf("vtc-service/src/trust_tasks/mod.rs"), "dispatcher");
    assert.equal(kindOf("vta-sdk/src/client/rooms.rs"), "client");
    assert.equal(kindOf("vtc-service/tests/it/main.rs"), "test");
  });
  it("finds a literal, a module path and a constant, and reports the other versions VTI names instead", () => {
    const r = tree({
      "vtc-service/src/a.rs": `const X: &str = "${B}vtc/rooms/list/0.2";`,
      "vta-sdk/src/b.rs": "use vti_specs::did_management::did::list::v0_2;\nfn f() { let _ = did_management::did::list::v0_2::Payload::default(); }",
      "vta-sdk/src/trust_tasks.rs": `pub const TASK_K_0_1: &str = "${B}keys/x/0.1";`,
      "vta-service/src/c.rs": "fn g() { let _ = vta_sdk::trust_tasks::TASK_K_0_1; }",
      "vti-specs-vtc/src/lib.rs": `// ${B}ghost/thing/0.1`,
    });
    const m = scanReach(r, [`${B}vtc/rooms/list/0.1`, `${B}did-management/did/list/0.2`, `${B}keys/x/0.1`, `${B}ghost/thing/0.1`]);
    assert.deepEqual(m.get(`${B}vtc/rooms/list/0.1`)?.otherVersions, ["0.2"]);
    assert.deepEqual(m.get(`${B}did-management/did/list/0.2`)?.refs.client, ["vta-sdk/src/b.rs"]);
    assert.deepEqual(m.get(`${B}keys/x/0.1`)?.refs.dispatcher, ["vta-service/src/c.rs"]);
    assert.deepEqual(m.get(`${B}ghost/thing/0.1`)?.refs.other, []);
  });
  it("classifies declared, feature-gated, sent-only, other-version and absent, in that order of precedence", () => {
    const r = tree({
      "vta-sdk/src/c.rs": `fn f() { let _ = "${B}did-management/did/list/0.2"; }`,
      "vtc-service/src/a.rs": `fn f() { let _ = "${B}vtc/rooms/list/0.2"; }`,
    });
    const uris = ["vta/witness/open/0.2", "vtc/elections/create/0.5", "did-management/did/list/0.2", "vtc/rooms/list/0.1", "vta/none/1.0"].map((s) => B + s);
    const rows = classifyReach(uris.map((uri) => ({ uri, family: "f", retired: false })), new Set([uris[0] as string]), new Set([uris[1] as string]), scanReach(r, uris));
    assert.deepEqual(rows.map((x) => x.state), ["declared", "feature-gated", "sent-only", "other-version", "absent"]);
    assert.equal(rows[1]?.feature, "voting");
    assert.equal(featureOf(`${B}vta/attestation/status/0.1`), "tee");
    assert.equal(featureOf(`${B}vtc/vetting/hidden/show/0.1`), "vetting-pcs");
    assert.equal(featureOf(`${B}acl/list/0.3`), undefined);
  });
  it("splits other-version by direction and gives an older or retired version reach class scope, whatever the platform does", () => {
    assert.equal(otherDirection(`${B}x/y/0.1`, ["0.2"]), "superseded");
    assert.equal(otherDirection(`${B}x/y/0.3`, ["0.2"]), "behind");
    assert.equal(otherDirection(`${B}x/y/0.3`, ["0.2", "0.4"]), "mixed");
    assert.equal(otherDirection(`${B}x/y/0.10`, ["0.9"]), "behind", "versions compare as numbers");
    const f = { uri: `${B}a/b/0.1`, family: "a", retired: false };
    assert.equal(reachClassOf(f, "declared"), "reached");
    assert.equal(reachClassOf(f, "absent"), "platform", "no focus given: every version counts as the target");
    assert.equal(reachClassOf({ ...f, focus: "focus" }, "other-version"), "platform");
    assert.equal(reachClassOf({ ...f, focus: "older" }, "absent"), "scope");
    assert.equal(reachClassOf({ ...f, focus: "older" }, "declared"), "scope", "an older version a host serves is outside the headline all the same");
    assert.equal(reachClassOf({ ...f, retired: true }, "absent"), "scope");
    const r = tree({ "vtc-service/src/a.rs": `const X: &str = "${B}vtc/rooms/list/0.2";` });
    const uris = ["vtc/rooms/list/0.1", "vtc/rooms/list/0.3"].map((s) => B + s);
    const rows = classifyReach([{ uri: uris[0] as string, family: "vtc", retired: false, focus: "older" }, { uri: uris[1] as string, family: "vtc", retired: false, focus: "focus" }], new Set(), new Set(), scanReach(r, uris));
    assert.deepEqual(rows.map((x) => [x.state, x.otherDirection, x.reachClass]), [["other-version", "superseded", "scope"], ["other-version", "behind", "platform"]]);
    assert.deepEqual(countsByFamily(rows).vtc, { total: 2, "other-version": 2, "other-version:superseded": 1, "other-version:behind": 1, "class:scope": 1, "class:platform": 1 });
  });
  it("the gap versions are the 703 vectors/gap names (554 of the first step, 148 of the uncovered families, and trust-task-discovery 0.1 once the witness retarget freed it)", () => {
    assert.equal(gapVersions(`${VECTORS}/gap`).size, 703);
  });
});
