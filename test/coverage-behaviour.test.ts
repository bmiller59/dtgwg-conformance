// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ACTIVE_RULES, BEHAVIOUR_MUTANTS, BEHAVIOUR_RULES, behaviourMutantId } from "../src/coverage/behaviour/index.ts";
import { ACTOR, alsoAcceptNote, base64urlCanonical, base64urlMembers, PERMISSION_DENIED_NOTE, stateFreeNote, withCanonicalValid } from "../src/coverage/behaviour/types.ts";
import { checkNonVacuityDeclarations } from "../src/vectors/validate.ts";
import { coverageTasks } from "../src/coverage/catalog.ts";
import { FAMILY_IDS, isDestructive } from "../src/coverage/families.ts";
import { frontMatterCodes, isStandingName, LOOKUP_NAME } from "../src/coverage/standing.ts";
import { localCode } from "../src/coverage/reachable.ts";
import { isMutantId } from "../src/adapters/reference/mutants.ts";

const norm = (s: string): string => s.replace(/[`*_>|]/g, " ").replace(/\s+/g, " ").toLowerCase();

describe("behavioural coverage rules (docs/22 phase 4)", () => {
  it("every rule is in a known family, names a non-destructive task, quotes the text, and has its own registered mutant", () => {
    for (const r of BEHAVIOUR_RULES) {
      assert.ok(FAMILY_IDS.includes(r.family), r.key);
      assert.ok(!isDestructive(r.slug), `${r.key}: a destructive task gets schema-invalid payloads only`);
      assert.ok(r.quote.length > 0 && r.quote.every((q) => /^specs\/.+\/spec\.md: ".{8,}"$/.test(q)), `${r.key}: quote form specs/<slug>/<version>/spec.md: "<words>"`);
      assert.ok(r.codes.length > 0 && !r.codes.includes("permissionDenied"), `${r.key}: permissionDenied is added by the generator`);
      assert.ok(!("authorityFree" in r), `${r.key}: no rule is authority-free: an authorisation gate may answer before any task check (SPEC 7.2 item 10)`);
      if (r.retired === undefined) assert.ok(isMutantId(behaviourMutantId(r)) && behaviourMutantId(r) in BEHAVIOUR_MUTANTS, r.key);
      else assert.ok(!(behaviourMutantId(r) in BEHAVIOUR_MUTANTS) && r.retired.reason.length > 40 && r.retired.since !== "", `${r.key}: a retired rule has a reason and no mutant`);
      assert.ok(r.key.startsWith(`${r.slug}/${r.version}:`), r.key);
    }
  });
  it("an unknown-identifier rule is state-free and its vector says so in its spec text; a rule about anything else does not", () => {
    const stateFree = BEHAVIOUR_RULES.filter((r) => r.stateFree === true);
    assert.ok(stateFree.length > 0);
    assert.ok(BEHAVIOUR_RULES.some((r) => r.stateFree !== true), "rules with a different trigger (cursors, limits, combinations) are not labelled");
    assert.match(stateFreeNote(), /^State-free: the identifier names nothing on a platform with no such object; a platform with seeded state may answer differently, so the vector accepts only the task's code, permissionDenied and the further codes it names \(the task's own standing codes, and a code the text runs earlier\)\.$/);
    // the vectors: every state-free rule's vector carries the sentence, and no other behavioural vector does
    const dir = join(import.meta.dirname, "..", "vectors", "coverage");
    let withNote = 0, all = 0;
    for (const f of readdirSync(dir).filter((x) => /^cb-.*\.json$/.test(x))) {
      for (const v of (JSON.parse(readFileSync(join(dir, f), "utf8")) as { vectors: { spec: string[] }[] }).vectors) { all++; if (v.spec.some((x) => x.startsWith("State-free: the identifier names nothing"))) withNote++; }
    }
    assert.equal(all, BEHAVIOUR_RULES.length);
    assert.equal(withNote, stateFree.length);
  });
  it("every quoted passage occurs in the task force's specification text (needs TT_KIT, a copy at the pinned commit)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set: the quotes were not checked against the text"); return; }
    for (const r of BEHAVIOUR_RULES) {
      for (const q of r.quote) {
        const m = /^(specs\/.+\/spec\.md): "(.+)"$/.exec(q)!;
        assert.ok(existsSync(join(kit, m[1]!)), `${r.key}: ${m[1]}`);
        assert.ok(norm(readFileSync(join(kit, m[1]!), "utf8")).includes(norm(m[2]!)), `${r.key}: quoted words not found in ${m[1]}`);
      }
    }
  });
  it("every trigger document satisfies the preconditions of the rule it tests, so only the intended rule is exercised", () => {
    const { tasks } = coverageTasks();
    // the one rule that breaks a base64url member on purpose: the broken member IS the rule
    const BREAKS_BASE64 = new Set(["keys/sign-jws/0.1:payloadInvalid"]);
    let checked = 0;
    for (const r of BEHAVIOUR_RULES) {
      const found = tasks.find((x) => x.task.slug === r.slug && x.task.version === r.version);
      assert.ok(found, r.key);
      const task = withCanonicalValid(found.task);
      const payload = r.trigger(task)!;
      // 1. a member the schema describes as base64url decodes (a placeholder that only matches the alphabet is refused as malformed before the rule is reached)
      if (!BREAKS_BASE64.has(r.key)) for (const m of base64urlMembers(task, payload)) assert.ok(base64urlCanonical(m.value), `${r.key}: ${m.path} is not canonical base64url`);
      // 2. a member named did or ...Did is a DID (or the actor token the harness replaces by the request actor's DID)
      for (const [k, v] of Object.entries(payload)) if ((k === "did" || /Did$/.test(k)) && typeof v === "string") assert.ok(/^did:[a-z0-9]+:.+/.test(v) || v === ACTOR, `${r.key}: ${k} = ${v} is not a DID`);
      // 3. auth/signing-key/enroll: keyNotIssuer is refused unless signingKeyDid is the issuer, so the document names the actor as the key
      if (r.slug === "auth/signing-key/enroll" && r.retired === undefined) assert.equal(payload["signingKeyDid"], ACTOR, `${r.key}: signingKeyDid must be the issuer`);
      // 4. auth/oob/claim: a document whose parentThreadId is not payload.requestId is malformedRequest, so the rule's document carries it
      if (r.slug === "auth/oob/claim") assert.equal(r.envelope?.(task, payload)["parentThreadId"], payload["requestId"], `${r.key}: parentThreadId must equal payload.requestId`);
      // 5. auth/step-up/approve-response: the proof's signer is the subject and is checked before the challenge is looked up
      if (r.slug === "auth/step-up/approve-response") assert.equal(payload["subject"], ACTOR, `${r.key}: the subject is the actor`);
      // 6. vtc/rooms/limits/set: a request naming none of limits, clear and filesEnabled is invalidCombination, so an unknown-room rule names a change
      if (r.slug === "vtc/rooms/limits/set" && r.codes[0]!.endsWith(":notFound")) assert.ok(payload["limits"] !== undefined, `${r.key}: names no change`);
      checked++;
    }
    assert.equal(checked, BEHAVIOUR_RULES.length);
  });
  it("the canonical valid payload decodes where the registry builder's placeholder does not", () => {
    const { tasks } = coverageTasks();
    const t = tasks.find((x) => x.task.slug === "vta/backup/put-chunk" && x.task.version === "1.0")!;
    assert.ok(base64urlMembers(t.task, t.task.validPayload).some((m) => !base64urlCanonical(m.value)), "the builder's `data` placeholder is not decodable");
    const fixed = withCanonicalValid(t.task);
    assert.ok(base64urlMembers(fixed, fixed.validPayload).every((m) => base64urlCanonical(m.value)));
  });
  it("a retired rule is a tombstone in the vector file: same id, no mutant, the retirement marker, and never a deleted id", () => {
    const dir = join(import.meta.dirname, "..", "vectors", "coverage");
    const byTitle = new Map<string, { id: string; retired?: { reason: string; since: string }; mutants?: string[] }>();
    for (const f of readdirSync(dir).filter((x) => /^cb-.*\.json$/.test(x))) for (const v of (JSON.parse(readFileSync(join(dir, f), "utf8")) as { vectors: { id: string; title: string; retired?: { reason: string; since: string }; mutants?: string[] }[] }).vectors) byTitle.set(v.title, v);
    for (const r of BEHAVIOUR_RULES) {
      const v = byTitle.get(r.title);
      assert.ok(v, `${r.key}: no vector`);
      if (r.retired === undefined) assert.ok(v.retired === undefined && (v.mutants ?? []).length === 1, r.key);
      else assert.deepEqual([v.retired, v.mutants], [r.retired, undefined], r.key);
    }
    assert.equal(ACTIVE_RULES.length + BEHAVIOUR_RULES.filter((r) => r.retired !== undefined).length, BEHAVIOUR_RULES.length);
  });
  it("every CB vector accepts permissionDenied, says once what a permissionDenied answer shows, and lists each further accepted code with its quote", () => {
    const dir = join(import.meta.dirname, "..", "vectors", "coverage");
    const byTitle = new Map(BEHAVIOUR_RULES.map((r) => [r.title, r]));
    let n = 0;
    for (const f of readdirSync(dir).filter((x) => /^cb-.*\.json$/.test(x))) {
      for (const v of (JSON.parse(readFileSync(join(dir, f), "utf8")) as { vectors: { id: string; title: string; spec: string[]; steps: { expect: { code: string[] } }[] }[] }).vectors) {
        const r = byTitle.get(v.title)!;
        n++;
        assert.ok(v.steps[0]!.expect.code.includes("permissionDenied"), v.id);
        assert.equal(v.spec.filter((x) => x === PERMISSION_DENIED_NOTE).length, 1, v.id);
        for (const a of r.alsoAccept ?? []) { assert.ok(v.steps[0]!.expect.code.includes(a.code), v.id); assert.ok(v.spec.includes(alsoAcceptNote(a)), v.id); }
        // O-02 / O-04: the task's own standing codes and (for a validation rule) lookup codes follow, each from the task's front matter and each with its note
        const base = [...r.codes, ...(r.alsoAccept ?? []).map((a) => a.code)];
        const codes = v.steps[0]!.expect.code;
        assert.deepEqual(codes.slice(0, base.length), base, v.id);
        assert.equal(codes[codes.length - 1], "permissionDenied", v.id);
        const extra = codes.slice(base.length, -1);
        const fm = new Set(frontMatterCodes(`https://trusttasks.org/spec/${r.slug}/${r.version}`).map((e) => e.code));
        for (const c of extra) {
          assert.ok(fm.has(c), `${v.id}: ${c} is not a front-matter code of the task`);
          assert.ok(isStandingName(c) || (r.retired === undefined && LOOKUP_NAME.test(localCode(c)) && !r.codes.some((x) => LOOKUP_NAME.test(localCode(x)))), `${v.id}: ${c} is neither a standing code nor a lookup code before a validation rule`);
          assert.ok(v.spec.some((x) => x.includes(`${c} (`)), `${v.id}: ${c} has no note`);
        }
      }
    }
    assert.equal(n, BEHAVIOUR_RULES.length);
  });
  it("a further accepted code is listed by the text: its quoted words occur in the specification and the code is one of the task's errorCodes (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set"); return; }
    for (const r of BEHAVIOUR_RULES) for (const a of r.alsoAccept ?? []) {
      const m = /^(specs\/.+\/spec\.md): "(.+)"$/.exec(a.quote)!;
      const text = readFileSync(join(kit, m[1]!), "utf8");
      assert.ok(norm(text).includes(norm(m[2]!)), `${r.key}: ${a.code}: quoted words not found`);
      assert.ok(text.includes(a.code) || a.code === "unavailable", `${r.key}: ${a.code} is not named in ${m[1]}`);
    }
  });
  it("the loader's non-vacuity rule exempts a retired vector (a tombstone is never run) and nothing else", () => {
    const step = { send: { document: {} }, expect: { disposition: "error", code: ["x"] } };
    const file = (extra: object) => ({ vectors: [{ id: "CB-XX-001", clarify: null, steps: [step], ...extra }] }) as never;
    assert.equal(checkNonVacuityDeclarations(file({})).length, 1);
    assert.equal(checkNonVacuityDeclarations(file({ retired: { reason: "r", since: "s" } })).length, 0);
    assert.equal(checkNonVacuityDeclarations(file({ mutants: ["m"] })).length, 0);
  });
});
