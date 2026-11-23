// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { COVERAGE_FAMILIES, CENSUS_HEADER, KW_ROLES, channelFor, FAMILY_IDS, isDestructive, loadCensus, loadInvalidExamples, parseCensus } from "../src/coverage/families.ts";
import { tfRefFor } from "../src/vectors/tfref.ts";
import { summarize } from "../scripts/task-census.ts";

describe("coverage census (docs/22)", () => {
  const rows = loadCensus();
  it("holds 662 used types, each in exactly one of the eight coverage families or the framework", () => {
    assert.equal(rows.length, 662);
    assert.equal(new Set(rows.map((r) => r.type)).size, 662);
    for (const r of rows) assert.ok(FAMILY_IDS.includes(r.family) || r.family === "FW", r.type);
    assert.equal(COVERAGE_FAMILIES.length, 8);
  });
  it("a type without a Trust Tasks specification is candidate, every other proposed; none is registry", () => {
    for (const r of rows) {
      const hasTf = tfRefFor(`pkg:@openvtc/trust-tasks@0.29.0#https://trusttasks.org/spec/${r.type}`) !== null;
      assert.equal(hasTf, r.tfStatus !== "none", r.type);
      assert.equal(channelFor(r.tfStatus), r.tfStatus === "draft" ? "proposed" : "candidate");
    }
    assert.equal(rows.filter((r) => r.tfStatus === "none").length, 10);
  });
  it("is not vacuous: a row lacking a family is refused", () => {
    assert.throws(() => parseCensus("type\tused_by\ttf_status\n"), /header/);
  });
  it("the header names the kw_role column, and the earlier five-column header is refused rather than misread", () => {
    assert.equal(CENSUS_HEADER, "type,used_by,tf_status,family,error_codes,kw_role");
    assert.throws(() => parseCensus("type\tused_by\ttf_status\tfamily\terror_codes\nacl/grant/0.1\tKW\tdraft\tSD\t0\n"), /header/);
    assert.throws(() => parseCensus(`${CENSUS_HEADER.split(",").join("\t")}\nacl/grant/0.1\tKW\tdraft\tSD\t0\tmaybe\n`), /no kw_role/);
    assert.throws(() => parseCensus(`${CENSUS_HEADER.split(",").join("\t")}\nacl/grant/0.1\tVTA\tdraft\tSD\t0\tsent\n`), /must have kw_role/);
  });
  it("every wallet type has a role, no other type has one, and the roles add up (sends = sent + both)", () => {
    const kw = rows.filter((r) => r.kw);
    assert.equal(kw.length, 191);
    for (const r of kw) assert.ok((KW_ROLES as readonly string[]).includes(r.kwRole!), r.type);
    for (const r of rows.filter((x) => !x.kw)) assert.equal(r.kwRole, undefined, r.type);
    const n = (k: string): number => kw.filter((r) => r.kwRole === k).length;
    assert.deepEqual([n("sent"), n("both"), n("received"), n("declared-only")], [153, 11, 14, 13]);
    assert.equal(kw.filter((r) => r.kwSends).length, n("sent") + n("both"));
    assert.equal(summarize().kwSends, 164);
  });
  it("the roles the emit report called receive-only or sender-less are checked against the source, with the corrections it needed", () => {
    const role = (t: string): string | undefined => rows.find((r) => r.type === t)?.kwRole;
    for (const t of ["auth/step-up/approve-request/0.1", "auth/step-up/approve-request/0.5", "task-consent/request/0.1", "task-consent/granted/0.1", "vtc/join-requests/submit-receipt/0.1", "vtc/members/removal-notice/0.1", "vtc/members/request-vmc/0.1", "credential-exchange/offer/0.1", "trust-task-error/0.6"]) assert.equal(role(t), "received", t);
    for (const t of ["rooms/keys/present/0.2", "rooms/records/put/0.4", "vtc/join-requests/decide/0.1", "vtc/invitations/issue/0.1", "vtc/invitations/deliver/0.1", "keys/sign/0.1", "keys/revoke/0.1", "vetting/vetters/grant/0.1", "rooms/keys/browse/0.2", "vta/contexts/get/1.0", "vta/webvh/dids/delete/1.0"]) assert.equal(role(t), "declared-only", t);
    // the source shows a sender for these three, which the report listed as sender-less
    assert.equal(role("trust-task-error/0.5"), "both");
    assert.equal(role("credential-exchange/present/0.1"), "sent");
    assert.equal(role("credential-exchange/issue/0.1"), "both");
    // decided 2026-11-18 from the wallet source: the REST request with the Trust-Task header is a send; the polls cast is forwarded by the wallet; 0.1 errors are read by prefix
    assert.equal(role("credential-exchange/request/0.1"), "sent");
    assert.equal(role("voting/ballot/cast/0.1"), "sent");
    assert.equal(role("trust-task-error/0.1"), "received");
    // the three rows added on 2026-11-18
    assert.equal(role("trust-task-discovery/0.1"), "both");
    assert.equal(role("trust-task-next-step/0.1"), "both");
    // the wallet's discovery ladder is [DISCOVERY_TASK_03, DISCOVERY_TASK]: 0.3 is sent first, so the census row names the wallet too
    assert.equal(role("trust-task-discovery/0.3"), "sent");
    assert.deepEqual([rows.find((r) => r.type === "trust-task-discovery/0.3")!.kw, rows.find((r) => r.type === "trust-task-discovery/0.3")!.vti], [true, true]);
    assert.equal(role("vtc/join-requests/manifest/0.4"), "sent");
  });
  it("kw-roles-evidence.md has one row per wallet type with the same role as the census, and no local path", () => {
    const md = readFileSync(new URL("../vectors-src/coverage/kw-roles-evidence.md", import.meta.url), "utf8");
    const rowsMd = new Map<string, { role: string; evidence: string }>();
    for (const l of md.split("\n")) { const m = /^\| `([^`]+)` \| ([a-z-]+) \| (.+) \|$/.exec(l); if (m) rowsMd.set(m[1]!, { role: m[2]!, evidence: m[3]! }); }
    const kw = rows.filter((r) => r.kw);
    assert.equal(rowsMd.size, kw.length);
    for (const r of kw) { const e = rowsMd.get(r.type); assert.ok(e, r.type); assert.equal(e!.role, r.kwRole, r.type); assert.ok(e!.evidence.length > 20, r.type); }
    assert.doesNotMatch(md, /\/(srv|home|var|tmp)\//);
    assert.match(md, /Status: draft proposal/);
  });
  it("destructive verbs are recognised", () => {
    for (const s of ["vta/backup/restore", "device/wipe", "vault/purge", "vta/webvh/delete"]) assert.ok(isDestructive(s), s);
    assert.ok(!isDestructive("rooms/keys/list"));
  });
  it("the summary counts every row, and the vendored invalid examples name only census types", () => {
    const s = summarize();
    assert.equal(s.types, 662);
    assert.equal(s.usedBy.both, 110);
    const ex = loadInvalidExamples();
    const known = new Set(rows.map((r) => r.type));
    for (const t of Object.keys(ex.examples)) assert.ok(known.has(t), t);
  });
});
