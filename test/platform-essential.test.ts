// SPDX-License-Identifier: Apache-2.0
// Each platform adapter states its platform's essential governance E (docs/04 section 19) from evidence: the source, the authority set
// size, k and the evidence are asserted here, and a fixed built-in rule shows the advisory GOV-FIXED at a glance.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Capabilities, EssentialGovernance } from "../src/adapter/contract.ts";
import { handleText } from "../src/adapter/server.ts";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { vtcEssential } from "../src/adapters/vti/adapter.ts";
import { vtaEssential } from "../src/adapters/vti-inprocess/adapter.ts";
import { EMIT_ESSENTIAL } from "../src/adapters/vti-emit/adapter.ts";
import { capabilities as kwCapabilities, kwEssential } from "../src/adapters/keyring-wallet/shim.ts";
import { WITNESS_ESSENTIAL, WitnessServerAdapter } from "../src/adapters/witness-server/adapter.ts";
import { resolveEssential } from "../src/runner/essential.ts";
import type { EssentialRecord } from "../src/runner/essential.ts";
import { makeActors } from "../src/runner/engine.ts";
import { essentialLabel } from "../src/glance/render.ts";
import type { SurfaceModel } from "../src/glance/model.ts";

const caps = (essential: EssentialGovernance): Capabilities =>
  ({ name: "t", version: "t", tierMax: 1, bindings: [], supportedTypes: [], carriers: [], cryptosuites: [], optional: [], pins: { framework: "", error: "", binding: "" }, governance: { essential } }) as Capabilities;
const record = (e: EssentialGovernance): EssentialRecord => resolveEssential(caps(e), makeActors()).record;
/** The at-a-glance label a surface would show for this declaration (the honesty check does not run: no ceremony is offered). */
const label = (r: EssentialRecord): string =>
  essentialLabel({ essential: { run: "r", source: r.source, members: r.authority.length, minApprovals: r.minApprovals, singleParty: r.singleParty, ...(r.finding === undefined ? {} : { finding: r.finding }), ...(r.reason === undefined ? {} : { reason: r.reason }), probe: { result: "not-run" } } } as SurfaceModel);
const cites = (e: EssentialGovernance, ...parts: RegExp[]): void => {
  assert.ok(e.evidence !== undefined, "evidence present");
  for (const p of parts) assert.match(e.evidence!, p);
  assert.doesNotMatch(e.evidence!, /\/home\/|\/srv\/|\/var\/tmp|\/tmp\//, "no local path in the evidence");
};

describe("VTI states its essential governance", () => {
  it("VTA in process: a fixed built-in rule (super admin decides a deferred query), a set of one, k = 1, GOV-FIXED and single-party at a glance", () => {
    const e = vtaEssential();
    const r = record(e);
    assert.equal(r.source, "fixed-rule");
    assert.equal(r.authority.length, 1);
    assert.equal(r.minApprovals, 1);
    assert.equal(r.finding, "GOV-FIXED");
    cites(e, /26d0da81/, /credential_exchange\.rs:\d+/, /extractor\.rs:\d+/);
    assert.match(label(r), /single-party/);
    assert.match(label(r), /GOV-FIXED/);
  });
  it("VTC with the host and the actors seeded admin: the VTI-APV-018 rule over the harness ACL, seven members, k = 1, requester excluded, GOV-FIXED", () => {
    const e = vtcEssential({ controlUrl: "http://127.0.0.1:1", actorRole: "admin" });
    const r = record(e);
    assert.equal(r.source, "fixed-rule");
    assert.deepEqual(r.authority.slice(0, 6), ["$A", "$X", "$R", "$S", "$Q", "$W"]);
    assert.equal(r.authority.length, 7);
    assert.equal(r.minApprovals, 1);
    assert.equal(e.consent?.excludeRequester, true);
    cites(e, /26d0da81/, /admin_consent\.rs:\d+/, /config\.rs:894/);
    assert.match(label(r), /1 of an authority set of 7, declared from fixed rule \(GOV-FIXED/);
  });
  it("VTC with member actors, and the live service: unreadable, each with its own reason, the rule still cited", () => {
    for (const [cfg, why] of [[{ controlUrl: "http://127.0.0.1:1" }, /seeded member/], [{}, /live community service/]] as const) {
      const e = vtcEssential(cfg);
      const r = record(e);
      assert.equal(r.source, "unreadable");
      assert.equal(r.finding, "GOV-NOT-PROBED");
      assert.match(e.reason ?? "", why);
      cites(e, /admin_consent\.rs/);
    }
  });
  it("emit: unreadable, the surface serves nothing", () => {
    assert.equal(record(EMIT_ESSENTIAL).source, "unreadable");
    assert.match(EMIT_ESSENTIAL.reason ?? "", /emit surface/);
  });
});

describe("keyring-wallet states its essential governance", () => {
  const build = { commit: "abc123456", bifoldCommit: "def456789", walletTypes: ["https://trusttasks.org/spec/vrc/relationships/propose/0.1"], consent: true };
  it("the wallet's person decides alone: fixed rule, a set of one, k = 1, cited at the measured commit; GOV-FIXED and single-party at a glance", () => {
    const e = kwCapabilities(build).governance?.essential;
    assert.deepEqual(e, kwEssential());
    const r = record(e!);
    assert.equal(r.source, "fixed-rule");
    assert.equal(r.authority.length, 1);
    assert.equal(r.minApprovals, 1);
    assert.equal(r.finding, "GOV-FIXED");
    cites(e!, /62af4d2d4/, /7e14c5124/, /ceremony\.ts:\d+/);
    assert.match(label(r), /single-party.*GOV-FIXED/);
  });
});

describe("witness server and example server state their essential governance", () => {
  it("witness server: unreadable, with the reason", async () => {
    const c = await new WitnessServerAdapter({ root: ".", version: "v1", invitationUrl: "http://x/?oob=y", inboundPort: 0 }).capabilities();
    assert.deepEqual(c.governance?.essential, WITNESS_ESSENTIAL);
    const r = record(WITNESS_ESSENTIAL);
    assert.equal(r.source, "unreadable");
    assert.match(r.reason ?? "", /black-box witness server/);
  });
  it("example server: the reference's E crosses the wire contract unchanged ($A and $X, k = 2, from its configuration, with evidence)", async () => {
    const res = (await handleText(new ReferenceAdapter({}), JSON.stringify({ jsonrpc: "2.0", id: 1, method: "capabilities", params: {} }))) as { result?: Capabilities };
    const e = res.result?.governance?.essential;
    assert.ok(e !== undefined);
    const r = record(e);
    assert.equal(r.source, "platform-config");
    assert.deepEqual(r.authority, ["$A", "$X"]);
    assert.equal(r.minApprovals, 2);
    assert.ok(e.evidence !== undefined);
  });
});
