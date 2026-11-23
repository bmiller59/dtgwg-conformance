// SPDX-License-Identifier: Apache-2.0
// The older-sets fixes (O-01 to O-17, F3-01 to F3-04; docs/decisions/README.md D880 and later).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { replyRequiredClause } from "../src/coverage/reply-required.ts";
import { frontMatterCodes, isStandingName, standingCodes } from "../src/coverage/standing.ts";
import { replyIsShould, replyRequiredTasks } from "../src/vectors/error-reply.ts";
import { pushedErrors } from "../src/runner/engine.ts";
import { versionRoleOf } from "../src/vectors/version-role.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { causedByOldWording, classifyChange, isStale, widens } from "../scripts/older-sets-rerun.ts";
import { validate } from "../src/plain/schema.ts";
import { auditCoverage, auditStep, loadTaskFacts, stepDocument, TEMPLATE_EXEMPT } from "../src/coverage/reachable.ts";
import { loadRunnableVectors } from "../src/coverage/completeness.ts";

const root = join(import.meta.dirname, "..");
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
/** Every vector file of a set directory (manifest order). */
function setVectors(dir: string): { file: string; v: J }[] {
  const base = join(root, "vectors", dir);
  // a set with its own manifest lists its files; the core set's files sit in its directories and are listed by the top-level manifest
  const files = existsSync(join(base, "manifest.json")) ? (JSON.parse(readFileSync(join(base, "manifest.json"), "utf8")) as { files: string[] }).files : readdirSync(base).filter((f) => f.endsWith(".json"));
  return files.flatMap((f) => ((JSON.parse(readFileSync(join(base, f), "utf8")) as { vectors: J[] }).vectors).map((v) => ({ file: f, v })));
}
const ERROR_SET_DIRS = ["plain", "2l", "coverage", "gap", "probe", "witness", "complete"] as const;

describe("O-01: an error reply to a rejection is a SHOULD unless the task text puts it inside a MUST", () => {
  it("the matcher finds a reply inside a MUST and ignores a SHOULD, a bare code and a negated mention", () => {
    const fm = "---\nslug: x/y\n---\n";
    const must = `${fm}A conforming **receiving party** (\`recipient\`):\n\n1. Applies the pipeline.\n3. On acceptance, returns the receipt. On refusal, returns a \`trust-task-error\` with \`x/y:notAccepted\`.\n`;
    assert.equal(replyRequiredClause(must)?.line, 7);
    const sentence = `${fm}## Rules\n\nThe consumer MUST answer a transient failure with a retryable \`trust-task-error\`.\n`;
    assert.ok(replyRequiredClause(sentence) !== null);
    const should = `${fm}A conforming consumer **SHOULD**:\n\n1. Return a \`trust-task-error\` for a refusal.\n`;
    assert.equal(replyRequiredClause(should), null);
    const ownShould = `${fm}A conforming **consumer** **MUST**:\n\n1. Validate.\n2. **SHOULD** answer with a \`trust-task-error\`.\n`;
    assert.equal(replyRequiredClause(ownShould), null);
    const bareCode = `${fm}A conforming **consumer** **MUST**:\n\n3. Refuse with \`x/y:notFound\` if it holds no ticket.\n`;
    assert.equal(replyRequiredClause(bareCode), null, "naming the refusal code is not saying the reply is required (SPEC.md 7.2: the rejection is the MUST, the reply a SHOULD)");
    const negated = `${fm}A conforming **consumer** **MUST**:\n\n1. Return \`credentials: []\`, not an error response, for none.\n`;
    assert.equal(replyRequiredClause(negated), null);
    assert.equal(replyRequiredClause(`---\nerrorCodes:\n  - code: a\n    meaning: "MUST return a trust-task-error"\n---\nbody\n`), null, "the front matter is not read");
  });
  it("the committed list is current against the task-force text (needs TT_KIT)", (t) => {
    const kit = process.env["TT_KIT"];
    if (kit === undefined || !existsSync(join(kit, "specs"))) { t.skip("TT_KIT is not set"); return; }
    execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(root, "scripts", "derive-reply-required.ts"), kit, "--check"], { stdio: "ignore" });
  });
  it("the list names the tasks whose reply is mandated, and they are real task versions", () => {
    const list = JSON.parse(readFileSync(join(root, "vectors-src", "complete", "reply-required.json"), "utf8")) as { scanned: number; required: Record<string, { line: number }> };
    assert.ok(list.scanned > 1400);
    for (const k of ["https://trusttasks.org/spec/witness/session/0.2", "https://trusttasks.org/spec/vrc/relationships/issue/0.1", "https://trusttasks.org/spec/vtc/relationships/request/0.2"]) assert.ok(k in list.required, k);
    assert.ok(Object.keys(list.required).length < list.scanned * 0.05, "a MUST-reply task is the exception");
  });
  it("every error step of the older sets carries errorReply should, except for a task that requires the reply", () => {
    let should = 0, kept = 0;
    for (const dir of ERROR_SET_DIRS) for (const { v } of setVectors(dir)) {
      for (const s of (v["steps"] as J[])) {
        const ex = s["expect"];
        if (!isObj(ex) || ex["disposition"] !== "error" || !isObj(s["send"]) || !isObj(s["send"]["document"])) continue;
        const required = [...replyRequiredTasks()].some((t) => String((s["send"] as J & { document: J }).document["type"]).startsWith(t));
        if (required) { assert.equal(ex["errorReply"], undefined, `${String(v["id"])}: a task that requires the reply keeps the FAIL on silence`); kept++; }
        else { assert.equal(ex["errorReply"], "should", `${String(v["id"])}: silence on a rejection is a note, not a FAIL (SPEC.md 7.2, :1071)`); should++; }
      }
    }
    assert.ok(should > 10000, `marked ${should}`);
    assert.ok(kept >= 0);
  });
  it("replyIsShould leaves a hand-set step, a non-error step and a stepless document alone", () => {
    const doc = { type: "https://trusttasks.org/spec/acl/show/0.3" };
    assert.equal(replyIsShould({ send: { document: doc }, expect: { disposition: "error", code: "malformedRequest" } }), true);
    assert.equal(replyIsShould({ send: { document: doc }, expect: { disposition: "error", errorReply: "should" } }), false);
    assert.equal(replyIsShould({ send: { document: doc }, expect: { disposition: "response" } }), false);
    assert.equal(replyIsShould({ send: { document: { type: "https://trusttasks.org/spec/witness/session/0.2" } }, expect: { disposition: "error" } }), false, "witness/session requires the reply on declining");
    assert.equal(replyIsShould({ trigger: {}, expect: { disposition: "error" } }), false);
  });
});

describe("O-02, O-03: the task's own standing codes are accepted beside permissionDenied on payload negatives", () => {
  it("standing codes are the caller-standing codes of the front matter and never a lookup", () => {
    const t = "https://trusttasks.org/spec/rooms/keys/backfill/0.2";
    assert.ok(standingCodes(t).includes("rooms/keys/backfill:notAMember"));
    assert.ok(!standingCodes("https://trusttasks.org/spec/vtc/rooms/limits/set/0.1").some((c) => /notFound$/.test(c)));
    for (const x of ["notFound", "unknownRepo", "archived", "taskFailed", "malformedRequest"]) assert.equal(isStandingName(`a/b:${x}`), false, x);
    assert.ok(frontMatterCodes(t).length > 0);
  });
  it("every payload negative of every older set accepts each standing code of its task", () => {
    let checked = 0;
    for (const dir of ["plain", "coverage", "gap", "2l"] as const) for (const { v } of setVectors(dir)) {
      if (!/is validated against|are refused|is refused \(|refused \(/.test(String(v["title"])) || v["retired"] !== undefined) continue;
      for (const s of v["steps"] as J[]) {
        const ex = s["expect"] as J | undefined;
        const doc = isObj(s["send"]) ? (s["send"] as J)["document"] : undefined;
        if (!isObj(ex) || ex["disposition"] !== "error" || !isObj(doc) || !Array.isArray(ex["code"])) continue;
        if (!(ex["code"] as string[]).includes("malformedRequest") || !(ex["code"] as string[]).includes("permissionDenied")) continue;
        const uri = String(doc["type"]).split("#")[0]!;
        for (const c of standingCodes(uri)) { assert.ok((ex["code"] as string[]).includes(c), `${String(v["id"])}: ${c}`); checked++; }
      }
    }
    assert.ok(checked > 1000, `checked ${checked}`);
  });
  it("the gap negatives accept permissionDenied and the standing codes, not malformedRequest alone (O-03)", () => {
    const gp = setVectors("gap").filter(({ v }) => /payload member is refused|breaks a constraint|lists as invalid/.test(String(v["title"])));
    assert.ok(gp.length > 1000, `${gp.length}`);
    for (const { v } of gp) for (const s of v["steps"] as J[]) { const ex = s["expect"] as J; assert.ok(Array.isArray(ex["code"]) && (ex["code"] as string[]).includes("malformedRequest") && (ex["code"] as string[]).includes("permissionDenied"), String(v["id"])); }
  });
});

describe("O-04: a CB vote or voter/register row accepts the code the text runs before the stated one", () => {
  const byId = new Map(setVectors("coverage").map(({ v }) => [String(v["id"]), v]));
  const codes = (id: string): string[] => (((byId.get(id)!["steps"] as J[])[0]!["expect"] as J)["code"] as string[]);
  it("vote rows accept the ticket lookup (item 3), the ballot rows also the voting key and the window (items 5 and 6)", () => {
    for (const id of ["CB-VP-017", "CB-VP-018", "CB-VP-021", "CB-VP-022", "CB-VP-025", "CB-VP-026"]) assert.ok(codes(id).includes("vta/pcs/vote:notFound"), id);
    for (const id of ["CB-VP-019", "CB-VP-023", "CB-VP-027"]) for (const c of ["notFound", "parametersInvalid", "notOpen"]) assert.ok(codes(id).includes(`vta/pcs/vote:${c}`), `${id} ${c}`);
    assert.ok(!codes("CB-VP-017").includes("vta/pcs/vote:ballotInvalid"), "only codes the text runs earlier are added");
  });
  it("voter/register rows accept the suite and voting-key checks (item 3) that run before the member check (item 9)", () => {
    for (const id of ["CB-VP-031", "CB-VP-032", "CB-VP-033"]) for (const c of ["unsupportedSuite", "parametersInvalid"]) assert.ok(codes(id).includes(`vta/pcs/voter/register:${c}`), `${id} ${c}`);
  });
});

const find = (dir: string, id: string): J => { const r = setVectors(dir).find(({ v }) => v["id"] === id); assert.ok(r, id); return r.v; };
const stepsOf = (v: J): J[] => v["steps"] as J[];

describe("O-05, O-06, O-17: probes, WSB-003 and the invalid sends", () => {
  it("every probe requires optional:authorised, and a CP-SD probe names the key the seed's response assigned", () => {
    const probes = setVectors("probe");
    assert.ok(probes.length >= 20);
    for (const { v } of probes) assert.ok((v["requires"] as string[]).includes("optional:authorised"), String(v["id"]));
    const sd = probes.filter(({ v }) => /^CP-SD-00[1-4]$/.test(String(v["id"])));
    assert.equal(sd.length, 4);
    for (const { v } of sd) {
      const seed = stepsOf(v)[0]!;
      assert.deepEqual(seed["capture"], { keyid: "/payload/keyId" }, String(v["id"]));
      const later = JSON.stringify(stepsOf(v)[1]);
      assert.ok(later.includes("$cap(keyid)") && !later.includes("$mint(key)"), String(v["id"]));
    }
  });
  it("CP-RM-007 seeds with the rooms/create version rooms/records/prune 0.2 links (0.3)", () => {
    const v = setVectors("probe").find(({ v }) => stepsOf(v).some((s) => JSON.stringify(s).includes("rooms/records/prune/0.2")))!.v;
    assert.ok(JSON.stringify(stepsOf(v)[0]).includes("rooms/create/0.3"));
    assert.ok((v["requires"] as string[]).includes("https://trusttasks.org/spec/rooms/create/0.3"));
  });
  it("WSB-003 builds the presentation through the witnessPresentation trigger, so only the submitter is wrong", () => {
    const v = find("witness", "WSB-003");
    const steps = stepsOf(v);
    const trig = steps.find((s) => isObj(s["trigger"]))!;
    assert.equal((trig["trigger"] as J)["action"], "witnessPresentation");
    assert.equal(((trig["trigger"] as J)["args"] as J)["variant"], "valid");
    assert.ok(JSON.stringify(steps[steps.length - 1]).includes("$capJson(vpX)"));
    assert.ok((v["requires"] as string[]).includes("optional:witness.presentation"));
    assert.equal(((steps[steps.length - 1]!["expect"]) as J)["code"], "witness/session/submit:challengeMismatch");
  });
  it("GP-VTN-166 sends the specification's own example: roles[0] is an object that the schema accepts", () => {
    const v = find("gap", "GP-VTN-166");
    const payload = ((stepsOf(v)[0]!["send"] as J)["document"] as J)["payload"] as J;
    assert.equal(typeof (payload["roles"] as unknown[])[0], "object");
    assert.deepEqual(validate(loadTask("https://trusttasks.org/spec/vtn/memberships/join/0.1")!.payloadSchema as J, payload), []);
  });
  it("the clamp steps name the conflict between the clamp text and the schema maximum as spec-open", () => {
    for (const id of ["CX-CA-019", "CX-CA-021", "CX-CA-023", "CX-CA-039", "CX-MB-046"]) {
      const v = setVectors("coverage").find(({ v }) => v["id"] === id)!.v;
      assert.ok((v["spec"] as string[]).some((x) => /conflicts with itself/.test(x) && /class C/.test(x)), id);
    }
  });
});

describe("O-07 to O-16: the Low items", () => {
  it("no vector cites SPEC.md:1118 for item 17 (it is :1137)", () => {
    for (const dir of [...ERROR_SET_DIRS, "emit", "emit-more", "framework"]) for (const { v } of setVectors(dir)) for (const x of v["spec"] as string[]) assert.ok(!/SPEC\.md:[^"]*\b1118\b/.test(x), `${String(v["id"])}: ${x.slice(0, 80)}`);
  });
  it("the framework cite for unknown members is the 7.2 rule, not the ext clause", () => {
    assert.ok((find("framework", "ENV-012")["spec"] as string[]).some((x) => x.startsWith("SPEC.md:1067")));
  });
  it("2PC-006, 2PC-007 and BND-005 assert a status on a SHOULD mapping only as httpStatusShould", () => {
    for (const id of ["2PC-006", "2PC-007", "BND-005"]) {
      const all = setVectors("framework").concat(setVectors("ceremony-vrc")).find(({ v }) => v["id"] === id);
      const v = all?.v ?? (() => { throw new Error(id); })();
      for (const st of stepsOf(v)) assert.ok(!isObj(st["expect"]) || (st["expect"] as J)["httpStatus"] === undefined, `${id} has a hard httpStatus`);
    }
  });
  it("WIT-009 is CLARIFY (the code is spec-silent); WIT-036 and WIT-037 no longer require a built presentation", () => {
    const w = setVectors("ceremony-witness");
    const get = (id: string): J => w.find(({ v }) => v["id"] === id)!.v;
    assert.ok(typeof get("WIT-009")["clarify"] === "string" && get("WIT-009")["clarifyClass"] === "spec-silent");
    for (const id of ["WIT-036", "WIT-037"]) assert.ok(!(get(id)["requires"] as string[]).includes("optional:witness.presentation"), id);
  });
  it("a negative push check waits at least the binding's minimum quiet period", async () => {
    const waited: number[] = [];
    const adapter = { observe: async () => ({ documents: [] }) } as never;
    const spec = { type: "https://trusttasks.org/spec/x/y/0.1", none: true, withinMs: 100 } as never;
    assert.deepEqual(await pushedErrors(adapter, spec, {} as never, "vid", async (ms) => { waited.push(ms); }, 1500), []);
    assert.deepEqual(waited, [1500]);
    waited.length = 0;
    await pushedErrors(adapter, spec, {} as never, "vid", async (ms) => { waited.push(ms); }, 0);
    assert.deepEqual(waited, [100], "a synchronous binding keeps the vector's own wait");
  });
  it("a vector on an older or retired version is labelled, and a specification the manifest lists as retired is labelled retired and excluded from every run (D901)", () => {
    assert.equal(versionRoleOf("vta/webvh/dids/list", "1.0", "retired"), "retired");
    assert.equal(versionRoleOf("witness/session", "0.1", "draft"), "older");
    assert.equal(versionRoleOf("witness/session", "0.2", "draft"), undefined);
    for (const [dir, id] of [["emit-more", "EX-VTA-020"], ["coverage", "CV-AA-177"], ["coverage", "CV-AA-178"]] as const) {
      const v = find(dir, id);
      assert.equal(((v["source"] as J)["versionRole"]), "retired", id);
      assert.ok((v["excludedFromRun"] as J | undefined)?.["reason"], `${id} is excluded from every run (D901)`);
      assert.match(String((v["excludedFromRun"] as J)["reason"]), /successor vta\/dids\/list\/0\.1/, id);
    }
    let older = 0;
    for (const dir of ["plain", "emit", "emit-more", "coverage", "gap", "2l", "witness", "complete"]) for (const { v } of setVectors(dir)) {
      const src = v["source"] as J;
      if (src["versionRole"] === "older") older++;
    }
    assert.ok(older > 1000, `${older} vectors are labelled older`);
  });
});

describe("F3-01 to F3-04: what the reachable-code audit looks at", () => {
  const cov = auditCoverage(root);
  const facts = loadTaskFacts(root);
  it("every set directory that holds runnable vectors is in the audit (dropping one fails here)", () => {
    const dirs = readdirSync(join(root, "vectors"), { withFileTypes: true }).filter((e) => e.isDirectory() && !["imported", "ceremony-scenarios", "governance"].includes(e.name)).map((e) => e.name);
    const present = new Set(loadRunnableVectors(root).map((x) => x.set));
    for (const d of dirs) assert.ok(present.has(d), `${d} holds vectors the audit does not load`);
    assert.deepEqual(cov.map((c) => c.set).sort(), [...present].sort());
    for (const set of ["2l", "framework", "gap", "plain", "complete", "coverage", "witness", "ceremony-vrc", "dtg", "probe"]) assert.ok((cov.find((c) => c.set === set)?.vectors ?? 0) > 0, set);
  });
  it("steps that assert `answered` with success are audited as well as `response` steps (ignoring them fails here)", () => {
    assert.ok((cov.find((c) => c.set === "complete")?.answeredSuccess ?? 0) >= 30);
    const step = { send: { document: { type: "https://trusttasks.org/spec/vtc/relationships/list/0.3", payload: { did: "did:key:z6Mk" } } }, expect: { disposition: "answered", success: true } };
    assert.ok(auditStep(step, [], facts).some((f) => f.code === "vtc/relationships/list:notFound"), "an answered+success step draws the same finding as a response step");
    assert.deepEqual(auditStep({ ...step, expect: { disposition: "answered" } }, [], facts), [], "answered without success asserts no success");
  });
  it("template steps are audited: the audited steps of the template-driven sets are most of the asserting ones", () => {
    const t = cov.reduce((n, c) => n + c.templated, 0);
    assert.ok(t > 150, `${t} template steps assert a response`);
    const vrc = cov.find((c) => c.set === "ceremony-vrc")!;
    assert.ok(vrc.audited >= 70 && vrc.templated >= 90);
  });
  it("what the audit cannot name is a known kind: framework carriers and discovery, suite-local ceremony and witness-share documents, and steps with no document", () => {
    const known = /^(template (carrier\.request|discovery\.request|ceremony\.\w+)|no document|https:\/\/trusttasks\.org\/spec\/(vrc\/relationships\/witness-share\/0\.1|task-consent\/decision\/0\.1))$/;
    const odd = cov.flatMap((c) => c.unaudited.map((u) => `${c.set}: ${u}`)).filter((u) => !known.test(u.slice(u.indexOf(" ") + 1)));
    assert.deepEqual(odd, [], "a new asserting step that names a task with no facts must get facts (scripts/derive-task-facts.ts) or be listed here");
  });
  it("the template exemptions are the whole limit: each one still matches a template step, and with none the template steps draw exactly those codes", () => {
    const drawn = new Set<string>();
    for (const { vector: v } of loadRunnableVectors(root)) for (const s of v["steps"] as J[]) {
      const send = isObj(s["send"]) ? s["send"] : undefined;
      if (send === undefined || typeof send["template"] !== "string" || isObj(send["document"])) continue;
      for (const f of auditStep(s, (v["requires"] as string[]) ?? [], facts, { exempt: {} })) drawn.add(f.code);
    }
    assert.deepEqual([...drawn].sort(), Object.keys(TEMPLATE_EXEMPT).sort());
  });
  it("the limit: a template step is read without its `mutate` list (a mutate cannot be applied to the audit's copy)", () => {
    const d = stepDocument({ send: { template: "cex.request", params: { id: "$id(x)" }, mutate: [{ op: "set", path: "/payload/extra", value: true }] } })!;
    assert.equal(d["id"], "$id(x)");
    assert.ok(!("extra" in (d["payload"] as J)), "the mutate is not applied");
    assert.equal(stepDocument({ send: { template: "no.such.template" } }), undefined);
  });
  it("F3-04: the seed steps with a fixed identifier (create, bind, register outside the probes) are all weak, so none can false-FAIL on a second run", () => {
    let n = 0;
    for (const { set, vector: v } of loadRunnableVectors(root)) {
      if (set === "probe") continue;
      for (const s of v["steps"] as J[]) {
        const doc = isObj(s["send"]) ? (s["send"] as J)["document"] : undefined;
        const m = isObj(doc) ? /spec\/(.+)\/\d+\.\d+$/.exec(String(doc["type"])) : null;
        const ex = s["expect"] as J | undefined;
        if (!isObj(doc) || m === null || !/\/(create|bind|register)$/.test(m[1]!) || !isObj(ex) || ["error", "silence", "any-refusal", "duplicate"].includes(String(ex["disposition"]))) continue;
        if (JSON.stringify(doc["payload"]).includes("$mint(")) continue;
        n++;
        const strong = (ex["disposition"] === "response" && ex["orRefusal"] === undefined && ex["acceptCodes"] === undefined) || (ex["disposition"] === "answered" && ex["success"] === true);
        assert.equal(strong, false, `${String(v["id"])}: a fixed-identifier seed asserts the response`);
      }
    }
    assert.ok(n >= 50, `${n} fixed-identifier seed steps`);
  });
});

describe("D890: which recorded results a vector change makes stale", () => {
  const vec = (over: J = {}, expect: J = { disposition: "error", code: ["malformedRequest"], noSideEffect: true }): J => ({ id: "X-001", requires: ["t"], clarify: null, steps: [{ send: { document: { type: "t" } }, expect }], ...over });
  it("a vector that now accepts more is widened; a changed requirement, step or CLARIFY flag is structural; a vector that stops running is excluded; labels are no change", () => {
    const base = vec();
    assert.equal(classifyChange(base, vec({}, { disposition: "error", code: ["malformedRequest", "permissionDenied"], noSideEffect: true, errorReply: "should" })), "widened");
    assert.equal(classifyChange(base, vec({}, { disposition: "error", code: ["permissionDenied"], noSideEffect: true })), "structural", "a code removed narrows the vector");
    assert.equal(classifyChange(base, vec({ requires: ["t", "optional:authorised"] })), "structural");
    assert.equal(classifyChange(base, vec({ clarify: "text" })), "structural");
    assert.equal(classifyChange(base, vec({ steps: [] })), "structural");
    assert.equal(classifyChange(base, vec({ excludedFromRun: { reason: "r" } })), "excluded");
    assert.equal(classifyChange(base, { ...base, title: "t2", spec: ["x"], source: { versionRole: "older" } }), "none");
    assert.equal(widens({ disposition: "error", code: "a", httpStatus: 200 }, { disposition: "error", code: ["a", "b"], httpStatusShould: 200 }), true);
    assert.equal(widens({ disposition: "error", code: "a", httpStatusShould: 200 }, { disposition: "error", code: "a", httpStatus: 200 }), false, "an advisory status made hard narrows the vector");
    assert.equal(widens({ disposition: "error", code: "a" }, { disposition: "any-refusal" }), true);
  });
  it("a widening keeps a recorded PASS and SKIP and re-runs the rest; a structural change re-runs every result", () => {
    for (const st of ["PASS", "SKIP"]) assert.equal(isStale("widened", st), false, st);
    for (const st of ["FAIL", "KNOWN-FAIL", "CLARIFY"]) assert.equal(isStale("widened", st), true, st);
    for (const st of ["PASS", "SKIP", "FAIL"]) assert.equal(isStale("structural", st), true, st);
    assert.equal(isStale("excluded", "FAIL"), false);
    assert.equal(isStale("none", "FAIL"), false);
  });
  it("a recorded failure is class B (old wording) when the answer is now accepted or the silence is now a note, and not otherwise", () => {
    const next = vec({}, { disposition: "error", code: ["malformedRequest", "permissionDenied"], noSideEffect: true, errorReply: "should" });
    assert.equal(causedByOldWording(["step 1: expected code malformedRequest, got permissionDenied"], next), true);
    assert.equal(causedByOldWording(["step 1: expected code malformedRequest, got taskFailed"], next), false);
    assert.equal(causedByOldWording(["step 1: expected one error, got 0 replies"], next), true);
    assert.equal(causedByOldWording(["step 1: expected one error, got 0 replies"], vec()), false);
    assert.equal(causedByOldWording([], next), false);
    assert.equal(causedByOldWording(["^step 1: expected code malformedRequest\\|permissionDenied, got permissionDenied$"], next), true, "an exception regex reads the same way");
  });
});
