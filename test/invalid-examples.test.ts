// SPDX-License-Identifier: Apache-2.0
// The task force's invalid payload examples are read by one loader that keeps the `variant` marker, classified against the schema of their
// OWN variant (request or response), with `format` handled as its own class; and no generated vector sends a response entry as a request.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { classifyInvalidExample, countClasses, readInvalidExamples, variantOf } from "../src/plain/invalid-examples.ts";
import { formatOk, validate } from "../src/plain/schema.ts";
import { loadSnapshot } from "../src/plain/snapshot.ts";
import { loadAlignmentSnapshot } from "../src/plain/alignment-snapshot.ts";
import { loadInvalidExamples } from "../src/coverage/families.ts";
import { loadTasks, payloadMatches } from "../src/tfalign/analyse.ts";
import { openTf } from "../src/tfalign/source.ts";
import { loadSuiteFacts } from "../src/tfalign/suite.ts";
import { SUITE_ROOT } from "../src/vectors/source.ts";

const read = (f: string): string => readFileSync(join(SUITE_ROOT, f), "utf8");

// A task whose request and response payloads differ: the request is an open object with an optional `name`, the response must carry a `status` of a fixed set.
const REQUEST = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { name: { type: "string" }, at: { type: "string", format: "date-time" } }, $defs: { Response: { $anchor: "response", type: "object", required: ["status"], properties: { status: { enum: ["ok", "failed"] } }, additionalProperties: false } } };
const RESPONSE = { $ref: "#/$defs/Response", $defs: REQUEST.$defs };

describe("each invalid example is validated with the schema of its own variant", () => {
  test("a response entry the REQUEST schema accepts is classified by the RESPONSE schema (refused), never as accepted", () => {
    const e = { note: "Response with an unknown status", payload: { status: "bogus" }, variant: "response" as const };
    assert.equal(validate(REQUEST, e.payload).length, 0, "fixture: the request schema accepts it, which is the trap");
    const c = classifyInvalidExample({ request: REQUEST, response: RESPONSE }, e);
    assert.equal(c.variant, "response");
    assert.equal(c.class, "refused");
  });
  test("a response entry the REQUEST schema refuses is still judged by the RESPONSE schema", () => {
    // valid as a response, invalid as a request: checked against the request schema it would wrongly count as a usable negative
    const e = { note: "Response that is in fact valid", payload: { status: "ok" }, variant: "response" as const };
    const reqOnly = { ...REQUEST, additionalProperties: false };
    assert.ok(validate(reqOnly, e.payload).length > 0);
    assert.equal(classifyInvalidExample({ request: reqOnly, response: RESPONSE }, e).class, "schema-accepted");
  });
  test("a request entry is judged by the request schema; a response entry with no response schema is its own class", () => {
    assert.equal(classifyInvalidExample({ request: REQUEST, response: RESPONSE }, { payload: { name: 7 } }).class, "refused");
    assert.equal(classifyInvalidExample({ request: REQUEST }, { payload: { status: "x" }, variant: "response" }).class, "no-schema");
  });
});

describe("format: a validator that does not assert it can never yield a schema-accepted count with format-only entries in it", () => {
  const e = { note: "`at` is not an RFC 3339 timestamp", payload: { at: "last Tuesday" } };
  test("the plain validator accepts the entry (the trap)", () => assert.equal(validate(REQUEST, e.payload).length, 0));
  test("with formats asserted it is refused", () => assert.ok(validate(REQUEST, e.payload, { formats: true }).length > 0));
  test("the classifier puts it in the format-only class, and countClasses keeps it out of schema-accepted", () => {
    const list = [classifyInvalidExample({ request: REQUEST }, e), classifyInvalidExample({ request: REQUEST }, { payload: { name: 1 } })];
    assert.deepEqual(list.map((x) => x.class), ["format-only", "refused"]);
    const c = countClasses(list);
    assert.equal(c.schemaAccepted, 0);
    assert.equal(c.formatOnly, 1);
  });
  test("asserted formats follow the task force's build (RFC 3339 date and date-time with a time zone, absolute RFC 3986 uri)", () => {
    for (const [f, ok, bad] of [["date", "2024-02-29", "2026-02-29"], ["date-time", "2026-11-12T10:00:00Z", "2026-11-12T10:00:00"], ["date-time", "2026-12-31T23:59:60Z", "2026-11-12T25:00:00Z"], ["uri", "https://a.example/x?y#z", "last Tuesday"], ["uri", "did:web:a.example", "/relative/path"]] as const) {
      assert.ok(formatOk(f, ok), `${f} ${ok}`);
      assert.ok(!formatOk(f, bad), `${f} ${bad}`);
    }
    assert.ok(formatOk("did", "anything"), "a format the suite does not assert stays an annotation");
  });
});

describe("every loader keeps the `variant` marker", () => {
  const raw = [{ note: "request one", payload: { a: 1 } }, { note: "reply one", payload: { status: "x" }, variant: "response" }, { note: "no payload" }];
  test("the shared reader (scripts/gap-snapshot.ts, scripts/refresh-coverage-inputs.ts)", () => {
    const out = readInvalidExamples(raw);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map(variantOf), ["request", "response"]);
    assert.equal(out[1]!.variant, "response");
  });
  test("both snapshot scripts use the shared reader", () => {
    for (const f of ["scripts/gap-snapshot.ts", "scripts/refresh-coverage-inputs.ts"]) assert.match(read(f), /readInvalidExamples\(/, f);
  });
  test("the alignment analysis (src/tfalign/analyse.ts loadTasks) keeps it", () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-variant-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const put = (p: string, body: string): void => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); };
    put("specs/alpha/one/0.1/spec.md", "---\nstatus: draft\n---\n# T\n");
    put("specs/alpha/one/0.1/payload.invalid-examples.json", JSON.stringify(raw));
    const tf = openTf(dir);
    try { assert.deepEqual(loadTasks(tf).invalid.map((e) => e.variant), ["request", "response", "request"]); } finally { tf.cleanup(); }
  });
  test("the committed inputs carry it (gap and alignment snapshots, coverage inputs)", () => {
    const resp = (l: { variant?: unknown }[]): number => l.filter((e) => variantOf(e) === "response").length;
    assert.ok(loadSnapshot().tasks.reduce((n, t) => n + resp(t.invalidExamples), 0) > 0, "gap snapshot");
    assert.ok(loadAlignmentSnapshot().tasks.reduce((n, t) => n + resp(t.invalidExamples), 0) > 0, "alignment snapshot");
    assert.ok(Object.values(loadInvalidExamples().examples).reduce((n, l) => n + resp(l), 0) > 0, "coverage inputs");
  });
});

describe("no generated vector sends a response entry as a request", () => {
  test("no request step of a vector built from invalid examples carries a non-empty response entry of its task", () => {
    const resp = new Map<string, unknown[]>();
    for (const t of loadAlignmentSnapshot().tasks) for (const e of t.invalidExamples) if (variantOf(e) === "response" && JSON.stringify(e.payload) !== "{}") { const l = resp.get(t.typeUri) ?? []; l.push(e.payload); resp.set(t.typeUri, l); }
    const facts = loadSuiteFacts(SUITE_ROOT);
    const fromExamples = new Set(facts.vectors.filter((v) => /invalid-examples\.json|lists as invalid/.test(v.text) && !/"retired":\{/.test(v.text)).map((v) => v.id));
    const bad = facts.docs.filter((d) => d.variant === "request" && fromExamples.has(d.vectorId) && (resp.get(d.typeUri) ?? []).some((p) => payloadMatches(d.payload, p))).map((d) => `${d.vectorId} (${d.file})`);
    assert.deepEqual([...new Set(bad)], []);
  });
  test("the alignment set's not-generated list names the class of every classified entry and has no schema-accepted entry", () => {
    const items = (JSON.parse(read("vectors/alignment/not-generated.json")) as { items: { reason: string; class?: string }[] }).items;
    assert.ok(!items.some((i) => /inconsistency inside the specification/.test(i.reason)), "the old mislabel is gone");
    assert.equal(items.filter((i) => i.class === "schema-accepted").length, 0);
    assert.ok(items.some((i) => i.class === "format-only"));
    assert.ok(items.some((i) => i.class?.startsWith("response-entry")));
  });
});
