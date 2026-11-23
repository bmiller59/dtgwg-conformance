// SPDX-License-Identifier: Apache-2.0
// Spot-check fixes (S-01..S-06): the reachable-code rule for every set, minted probe ids, the voting service in the scan and the scope, accepted codes that can arise,
// corrected exclusion reasons, and the library's tags-only effect default.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadRunnableVectors, type Scope } from "../src/coverage/completeness.ts";
import { uriMacroTable, scanVti } from "../src/coverage/matrix/vti.ts";
import { auditReachable, auditStep, loadTaskFacts, requireAuthorisedWhereStanding, stateCodes } from "../src/coverage/reachable.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { mintToken, substituteString } from "../src/runner/build.ts";
import { validate } from "../src/plain/schema.ts";
import { ROOT } from "./helpers.ts";

const TT = "https://trusttasks.org/spec/";
type J = Record<string, unknown>;
const all = loadRunnableVectors(ROOT);
const byId = new Map(all.map((x) => [x.vector["id"] as string, x]));
const stepsOf = (id: string): J[] => (byId.get(id)!.vector["steps"] as J[]);

describe("S-01: the reachable-code rule holds for every set", () => {
  const facts = loadTaskFacts(ROOT);
  it("no vector in any set asserts a task's own response while a code of that task can fire and is not accepted", () => {
    const f = auditReachable(ROOT);
    assert.deepEqual(f.map((x) => `${x.set} ${x.id} step ${x.step}: ${x.code}`), []);
  });
  it("the audit flags an unaccepted reachable code, a standing code without optional:authorised, and accepts each remedy", () => {
    const step = (expect: J): J => ({ send: { document: { type: `${TT}vtc/relationships/list/0.3`, payload: { did: "did:key:z6Mk", limit: 500 } } }, expect: { disposition: "response", type: `${TT}vtc/relationships/list/0.3#response`, ...expect } });
    const codes = (s: J, req: readonly string[] = [] as readonly string[]): string[] => auditStep(s, [...req], facts).map((x) => x.code);
    assert.ok(codes(step({})).includes("vtc/relationships/list:notFound"), "a member that never exists draws notFound");
    assert.ok(!codes(step({ orRefusal: ["vtc/relationships/list:notFound"] })).includes("vtc/relationships/list:notFound"));
    assert.ok(!codes(step({ acceptCodes: ["notFound"] })).includes("vtc/relationships/list:notFound"), "a local name covers the code");
    const w = { send: { document: { type: `${TT}witness/session/0.2`, payload: { parties: ["a", "b"] } } }, expect: { disposition: "response" } };
    assert.deepEqual(codes(w), ["witness/session:refused"]);
    assert.deepEqual(codes(w, ["optional:authorised"]), []);
    assert.deepEqual(auditStep({ ...w, expect: { disposition: "error", code: "malformedRequest" } }, [], facts), [], "an expected refusal asserts no success");
    assert.equal(requireAuthorisedWhereStanding({ requires: [] as string[], steps: [w] }, facts).requires!.includes("optional:authorised"), true);
  });
  it("the git-ns list vectors accept each spec's own administrator code, on the response and the refusal steps", () => {
    const want: Record<string, string> = { "CX-CA-019": "git-ns/account/list:notCommunityAdministrator", "CX-CA-021": "git-ns/activity/list:notAdministrator", "CX-CA-023": "git-ns/bridge/job/list:notAdministrator", "CX-CA-039": "git-ns/right/list:notCommunityAdministrator" };
    for (const [id, code] of Object.entries(want)) {
      const steps = stepsOf(id).map((s) => s["expect"] as J);
      for (const e of steps) assert.ok(((e["disposition"] === "response" ? e["orRefusal"] : e["code"]) as string[]).includes(code), `${id}: ${JSON.stringify(e)}`);
    }
  });
  it("CX-MB-046 accepts the member-not-found refusal on its response step", () => {
    const resp = stepsOf("CX-MB-046").map((s) => s["expect"] as J).filter((e) => e["disposition"] === "response");
    assert.ok(resp.length > 0 && resp.every((e) => (e["orRefusal"] as string[]).includes("vtc/relationships/list:notFound")));
  });
  it("the witness vectors that assert a session response require optional:authorised (a witness may decline by policy)", () => {
    for (const set of ["ceremony-witness", "witness"]) {
      const vs = all.filter((x) => x.set === set && (x.vector["steps"] as J[]).some((s) => ((s["expect"] as J | undefined)?.["disposition"] === "response") && /witness\/session\/\d/.test(String(((s["send"] as J | undefined)?.["document"] as J | undefined)?.["type"]))));
      assert.ok(vs.length >= 10, set);
      for (const x of vs) assert.ok((x.vector["requires"] as string[]).includes("optional:authorised"), x.vector["id"] as string);
    }
  });
  it("the seeded probes mint their ids per run instead of fixing them", () => {
    const seeds = (id: string): J[] => stepsOf(id).filter((s) => /seed/.test(String(((s["send"] as J)["document"] as J)["id"])));
    for (const x of all.filter((y) => y.set === "probe")) {
      const id = x.vector["id"] as string;
      const seedText = JSON.stringify(seeds(id));
      assert.ok(seeds(id).length > 0, id);
      assert.match(seedText, /\$mint\(/, `${id}: a seeding step names a fixed object`);
      assert.doesNotMatch(seedText, /cpca\d{3}|cpreissue0\d\d|"owner":"acme"|"roomId":"[^$]*"/, id);
    }
    // the seeded owner is the one the later step names, so the object the probe seeds is the object it asks about
    assert.match(JSON.stringify(stepsOf("CP-CA-002")), /"resource":"github\.com\/\$mint\(own_acme\)\/widgets"/);
  });
  it("mints a short lowercase token that fits the segment and key patterns, per salt, inside a longer string too", () => {
    const seg = loadTask(`${TT}git-ns/namespace/bind/0.2`)!.payloadSchema as J;
    const a = mintToken("CP-CA-001", "own", "s1");
    assert.match(a, /^m[0-9a-f]{15}$/);
    assert.deepEqual(validate(seg, { forge: "github.com", owner: a, mode: "manual" }), []);
    assert.notEqual(a, mintToken("CP-CA-001", "own", "s2"));
    assert.equal(a, mintToken("CP-CA-001", "own", "s1"));
    assert.notEqual(a, mintToken("CP-CA-001", "other", "s1"));
    const ctx = { vectorId: "CP-CA-001", salt: "s1" } as never;
    assert.equal(substituteString("github.com/$mint(own)/widgets", ctx), `github.com/${a}/widgets`);
    assert.equal(substituteString("$mint(own)", ctx), a);
  });
  it("every step that asserts a task's own response names a task whose front-matter codes are known (so the audit cannot skip a new vector)", () => {
    const missing = new Set<string>();
    for (const { vector: v } of all) for (const s of (v["steps"] as J[])) {
      const e = s["expect"] as J | undefined;
      if (e === undefined || !(e["disposition"] === "response" || (e["disposition"] === "answered" && e["success"] === true))) continue;
      const t = String((((s["send"] as J | undefined)?.["document"]) as J | undefined)?.["type"] ?? "");
      if (t !== "" && !t.startsWith("$") && !facts.has(t.replace(/#response$/, ""))) missing.add(t);
    }
    assert.deepEqual([...missing], [], "add the version to AUDITED_OLDER_VERSIONS in scripts/derive-task-facts.ts and re-run it");
  });
  it("a minted identifier rules out the already-exists codes", () => {
    const k = facts.get(`${TT}keys/create/0.1`)!;
    const minted = stateCodes(k, loadTask(`${TT}keys/create/0.1`)!.payloadSchema, { keyType: "ed25519", keyId: "$mint(key)" });
    assert.equal(minted.find((c) => c.code === "keys:alreadyExists")!.reachable, false);
    assert.equal(stateCodes(k, loadTask(`${TT}keys/create/0.1`)!.payloadSchema, { keyType: "ed25519", keyId: "fixed" }).find((c) => c.code === "keys:alreadyExists")!.reachable, true);
  });
});

describe("S-02: the voting service's routing table is read and its tasks are in scope", () => {
  const src = [
    "macro_rules! uri {", "    ($($path:ident)::+) => {", "        <vti_specs::voting::$($path)::+::Payload as trust_tasks_rs::Payload>::TYPE_URI", "    };", "}",
    "const SERVED: &[(&str, Task, Option<ElectionVersion>)] = &[", "    (uri!(election::close::v0_1), Task::Close, None),", "    (", "        uri!(ballot::cast_encrypted::v0_1),", "        Task::CastEncrypted,", "        None,", "    ),",
    "    // (uri!(commented::out::v0_1), Task::X, None),", "];", "fn other() { let _ = uri!(not::in::table::v0_1); }",
  ].join("\n");
  it("reads the uri! entries of const SERVED, with the family from the macro body, and ignores comments and other uses", () => {
    const r = uriMacroTable(src);
    assert.deepEqual(r.uris.sort(), [`${TT}voting/ballot/cast-encrypted/0.1`, `${TT}voting/election/close/0.1`]);
    assert.deepEqual(r.unresolved, []);
    assert.deepEqual(uriMacroTable("const SERVED: &[u8] = &[1];"), { uris: [], unresolved: [] });
  });
  const scope = JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;
  const voting = scope.tasks.filter((t) => t.vti.includes("voting"));
  it("the scope holds the 17 voting tasks the service serves at the latest version, plus ballot/cast 0.1, and records none of them as out of scope", () => {
    const want = ["ballot/cast-encrypted/0.1", "board/consistency/0.1", "board/head/0.1", "board/inclusion/0.1", "board/read/0.2", "election/cancel/0.1", "election/close/0.1", "election/register/0.4", "election/show/0.4", "result/show/0.1", "trustees/authorize/0.1", "trustees/confirm/0.1", "trustees/deal/0.1", "trustees/decrypt/0.1", "trustees/enrol/0.1", "trustees/justify/0.1", "trustees/status/0.1", "ballot/cast/0.1"].map((x) => `${TT}voting/${x}`).sort();
    assert.deepEqual(voting.map((t) => t.typeUri).sort(), want);
    assert.equal((scope.outOfScope ?? []).filter((o) => o.slug.startsWith("voting/")).length, 0);
  });
  it("every voting task has facts and an effect, and a vector (any set)", () => {
    const facts = loadTaskFacts(ROOT);
    const text = all.map((x) => JSON.stringify(x.vector)).join("\n");
    for (const t of voting) { assert.ok(facts.get(t.typeUri)?.effect !== undefined, t.typeUri); assert.ok(text.includes(`"${t.typeUri}"`), `${t.typeUri} has no vector`); }
  });
  const archives = (process.env["VTI_ARCHIVES"] ?? "").split(":").filter((d) => d !== "" && existsSync(d)); // VTI_ARCHIVES: colon-separated VTI source archives to scan
  it("the scanner finds the 22 served voting versions in each VTI archive present (skipped unless VTI_ARCHIVES names one)", { skip: archives.length === 0 }, () => {
    for (const d of archives) assert.equal([...scanVti(d).served].filter(([, s]) => s.has("voting")).length, 22, d);
  });
});

describe("S-04, S-05, S-06", () => {
  it("S-04: no vector accepts idConflict or proofInvalid for a request that cannot draw it", () => {
    for (const id of ["VC-VTA-056", "VC-VTC-073"]) for (const s of stepsOf(id)) assert.equal((s["expect"] as J)["acceptCodes"], undefined, id);
    for (const x of all) for (const s of x.vector["steps"] as J[]) for (const c of (((s["expect"] as J | undefined)?.["acceptCodes"]) as string[] | undefined) ?? []) assert.ok(!/^(idConflict|proofInvalid)$/.test(c) || x.set !== "complete", `${x.vector["id"]}: ${c}`);
  });
  it("S-04: the vector cites why the mandated code is not accepted", () => {
    const spec = (byId.get("VC-VTC-073")!.vector["spec"] as string[]).join("\n");
    assert.match(spec, /Not accepted \(S-04\).*proofInvalid/);
  });
  it("S-05: the four exclusion reasons describe what VTI does with the document, and the rule stays dispatched requests only", () => {
    const scope = JSON.parse(readFileSync(join(ROOT, "vectors-src", "complete", "scope.json"), "utf8")) as Scope;
    const out = new Map((scope.outOfScope ?? []).map((o) => [o.slug, o.reason]));
    assert.match(out.get("consent/approve-request")!, /vta-mobile-core\/src\/task\.rs:189-244.*verifies and parses/);
    assert.doesNotMatch(out.get("consent/approve-request")!, /mobile emits/);
    assert.match(out.get("rooms/keys/read-marker/moved")!, /VTA emits it.*vta-sdk client receives/);
    assert.doesNotMatch(out.get("rooms/keys/read-marker/moved")!, /client emits/);
    for (const s of ["auth/signing-key/authorize", "auth/step-up/approver/attest"]) { assert.match(out.get(s)!, /embedded evidence/, s); assert.doesNotMatch(out.get(s)!, /vtc named-only/, s); }
    for (const s of ["consent/approve-request", "rooms/keys/read-marker/moved", "auth/signing-key/authorize", "auth/step-up/approver/attest"]) assert.match(out.get(s)!, /dispatched request/, s);
  });
  it("S-06: the library default is tags-only and says why; the template-step limit is stated", () => {
    const suite = readFileSync(join(ROOT, "src", "runner", "suite.ts"), "utf8");
    assert.match(suite, /Why the library default is not "derive"/);
    assert.match(suite, /a step that names no Type URI \(a template step/);
    const doc = readFileSync(join(ROOT, "docs", "37-vector-completeness.md"), "utf8");
    assert.match(doc, /library `runSuite` keeps the tags-only default/);
    assert.match(doc, /template step/);
  });
});
