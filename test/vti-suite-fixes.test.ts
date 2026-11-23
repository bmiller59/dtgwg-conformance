// SPDX-License-Identifier: Apache-2.0
// Suite changes made while measuring the live VTI service (docs/21-vector-group-rationale.md section 3, docs/05 section 1.4): discovery 0.3 vectors, the major-version
// carrier token, the transport-identity capability, advisories on unparseable-document refusals.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ReferenceAdapter } from "../src/adapters/reference/reference.ts";
import { DISCOVERY_TYPE, DISCOVERY_TYPE_V0_3, discoveryTypeOf, substituteString } from "../src/runner/build.ts";
import type { BuildContext } from "../src/runner/build.ts";
import { makeActors, validateReply } from "../src/runner/engine.ts";
import type { EngineEnv } from "../src/runner/engine.ts";
import { gateReason } from "../src/runner/suite.ts";
import { loadSuite } from "../src/vectors/load.ts";
import { VECTORS } from "./helpers.ts";

const ctx = (extra: Partial<BuildContext> = {}): BuildContext => ({ vectorId: "T", iutVid: "did:key:zIut", actors: makeActors(), carrier: "https://trusttasks.org/spec/notifications/notify/0.1", nowMs: 0, ...extra });
const vectors = loadSuite(VECTORS).files.flatMap((f) => f.file.vectors);
const vec = (id: string) => vectors.find((v) => v.id === id)!;

describe("discovery version", () => {
  it("prefers 0.4, falls back to 0.3, and is undefined when neither is served", () => {
    assert.equal(discoveryTypeOf([DISCOVERY_TYPE, DISCOVERY_TYPE_V0_3]), DISCOVERY_TYPE);
    assert.equal(discoveryTypeOf([DISCOVERY_TYPE_V0_3]), DISCOVERY_TYPE_V0_3);
    assert.equal(discoveryTypeOf(["https://trusttasks.org/spec/x/0.1"]), undefined);
  });
  it("the tokens resolve to the served version, default 0.4", () => {
    assert.equal(substituteString("$discovery", ctx()), DISCOVERY_TYPE);
    assert.equal(substituteString("$discovery", ctx({ discoveryType: DISCOVERY_TYPE_V0_3 })), DISCOVERY_TYPE_V0_3);
    assert.equal(substituteString("$discoveryResponse", ctx({ discoveryType: DISCOVERY_TYPE_V0_3 })), `${DISCOVERY_TYPE_V0_3}#response`);
  });
  it("the DIS vectors are gated on serving either version", async () => {
    const caps = await new ReferenceAdapter().capabilities();
    assert.equal(gateReason(vec("DIS-003"), caps, 1), null);
    const only03 = { ...caps, supportedTypes: caps.supportedTypes.map((t) => (t === DISCOVERY_TYPE ? DISCOVERY_TYPE_V0_3 : t)) };
    assert.equal(gateReason(vec("DIS-003"), only03, 1), null);
    const none = { ...caps, supportedTypes: caps.supportedTypes.filter((t) => t !== DISCOVERY_TYPE) };
    assert.match(gateReason(vec("DIS-003"), none, 1) ?? "", /trust-task-discovery/);
  });
});

describe("carrier major version token", () => {
  it("raises the MAJOR of the carrier's own Type URI", () => {
    assert.equal(substituteString("$carrierMajor", ctx()), "https://trusttasks.org/spec/notifications/notify/1.0");
    assert.equal(substituteString("$carrierMajor", ctx({ carrier: "https://trusttasks.org/spec/conformance/widget/0.1" })), "https://trusttasks.org/spec/conformance/widget/1.0");
  });
  it("ENV-010 asks for the carrier's family at another MAJOR", () => {
    assert.equal(vec("ENV-010").steps[0]!.send!.params!.type, "$carrierMajor");
  });
});

describe("transport identity capability", () => {
  it("gates the vectors that spoof the transport sender, the binding's own bearer vector included (bindings/https/0.3 :129: the token mapping is deployment-defined)", async () => {
    const caps = await new ReferenceAdapter({ attested: true }).capabilities();
    assert.ok(caps.optional.includes("transportIdentity"));
    for (const id of ["ID-002", "ID-004"]) assert.equal(gateReason(vec(id), caps, 2), null, id);
    const without = { ...caps, optional: caps.optional.filter((o) => o !== "transportIdentity") };
    for (const id of ["ID-002", "ID-004"]) assert.match(gateReason(vec(id), without, 2) ?? "", /optional:transportIdentity/, id);
    assert.match(gateReason(vec("BND-002"), without, 1) ?? "", /optional:transportIdentity/);
    assert.equal(gateReason(vec("BND-002"), caps, 1), null);
    assert.equal(gateReason(vec("ID-003"), without, 2), null);
  });
});

describe("advisories on a refusal of an undecodable document", () => {
  const env = { caps: { optional: [] }, iutVid: "did:webvh:iut", actors: makeActors(), tier: 1, fixtureRoot: "", defaultClockStart: "" } as unknown as EngineEnv;
  const request = { id: "urn:uuid:req", type: "https://trusttasks.org/spec/x/0.1", issuer: "did:key:zA", threadId: "urn:uuid:th" };
  const refusal = (code: string): string => JSON.stringify({ id: "urn:uuid:r", type: "https://trusttasks.org/spec/trust-task-error/0.6", issuer: "did:webvh:iut", payload: { code, retryable: false } });
  it("a malformedRequest refusal with no thread and no recipient raises no advisory", () => {
    const adv: string[] = [];
    validateReply(refusal("malformedRequest"), request, { kind: "none" }, env, 0, { push: (m: string) => adv.push(m) });
    assert.deepEqual(adv, []);
  });
  it("any other refusal still raises them (a hole in the check would be a regression)", () => {
    const adv: string[] = [];
    validateReply(refusal("wrongRecipient"), request, { kind: "none" }, env, 0, { push: (m: string) => adv.push(m) });
    assert.ok(adv.some((a) => /threadId/.test(a)) && adv.some((a) => /not addressed to the request issuer/.test(a)), adv.join("; "));
  });
});

describe("proof purpose a task's specification fixes", () => {
  it("auth/step-up/approve-response is signed for assertionMethod in every version, other tasks keep the framework default", async () => {
    const { specifiedProofPurpose } = await import("../src/crypto/proof-purpose.ts");
    for (const v of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7"]) assert.equal(specifiedProofPurpose(`https://trusttasks.org/spec/auth/step-up/approve-response/${v}`), "assertionMethod", v);
    assert.equal(specifiedProofPurpose("https://trusttasks.org/spec/auth/step-up/approve-request/0.3"), undefined);
    assert.equal(specifiedProofPurpose("https://trusttasks.org/spec/auth/whoami/0.1"), undefined);
    assert.equal(specifiedProofPurpose(undefined), undefined);
  });
});

describe("VTI host seeding", () => {
  it("the VTA host's bearer carries the authentication factor, and the VTC host's seeded actors have member records", async () => {
    const { readFileSync } = await import("node:fs");
    const vta = readFileSync(new URL("../src/adapters/vti-inprocess/rust/src/main.rs", import.meta.url), "utf8");
    assert.match(vta, /amr: vec!\["did"\.to_string\(\)\]/);
    assert.match(vta, /with_aal\(vec!\["did"\.to_string\(\)\], "aal1"\)/);
    const vtc = readFileSync(new URL("../src/adapters/vti/vtc-host/src/main.rs", import.meta.url), "utf8");
    assert.match(vtc, /store_member\(members_ks/);
  });
});
