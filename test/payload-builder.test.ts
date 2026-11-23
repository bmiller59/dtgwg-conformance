// SPDX-License-Identifier: Apache-2.0
// The schema-driven valid-payload builder (src/plain/schema.ts `exampleExtended`, src/plain/pattern.ts): one case per cause that left a
// census task version without a buildable valid payload, and the guard that what `example` already built is returned unchanged
// (every generated vector of those versions is derived from it).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageTasks } from "../src/coverage/catalog.ts";
import { loadTask } from "../src/plain/catalog.ts";
import { stringForPattern } from "../src/plain/pattern.ts";
import { example, exampleExtended, validate } from "../src/plain/schema.ts";

type S = Record<string, unknown>;
/** The extended builder builds a payload that `validate` accepts. */
function builds(schema: S): unknown {
  const v = exampleExtended(schema);
  assert.notEqual(v, undefined, "no payload built");
  assert.deepEqual(validate(schema, v), []);
  return v;
}

/** Census versions the builder could not build before this change (recorded in vectors/coverage/not-generated.json at the parent commit). */
const BEFORE_BUILDABLE = 517;

describe("pattern: a string constructed from the regular expression", () => {
  for (const [name, pattern, min] of [
    ["uuid", "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", 0],
    ["ulid class ranges", "^[0-9A-HJKMNP-TV-Z]{26}$", 0],
    ["prefix and bounded repeat", "^grp_[A-Za-z0-9_-]{16,64}$", 0],
    ["alternation", "^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$", 0],
    ["optional groups and escapes", "^P(?:\\d+D(?:T\\d+H)?|T\\d+H)$", 0],
    ["negated class", "^[^\\u0000-\\u001F\\u007F]+$", 0],
    ["dotted labels", "^[a-z][a-z0-9-]*(\\.[a-z0-9-]+)+$", 0],
    ["open end padded to minLength", "^-----BEGIN VTA SEALED BUNDLE-----", 64],
    ["unanchored escape class", "\\S", 0],
  ] as const) {
    it(name, () => {
      const s = stringForPattern(pattern, min);
      assert.notEqual(s, undefined);
      assert.ok(new RegExp(pattern, "u").test(s!), s);
      assert.ok([...s!].length >= min);
      builds({ type: "object", required: ["a"], properties: { a: { type: "string", pattern, ...(min > 0 ? { minLength: min } : {}) } } });
    });
  }
  it("refuses what it cannot construct (lookahead) rather than guessing", () => {
    assert.equal(stringForPattern("^(?=a)b$"), undefined);
  });
  it("respects maxLength", () => {
    assert.ok([...stringForPattern("^[a-z]{2,10}$", 0, 3)!].length <= 3);
  });
});

describe("oneOf / anyOf alternatives that name members only the enclosing schema describes", () => {
  const props = { sessionId: { type: "string", minLength: 1 }, all: { type: "boolean" }, subject: { type: "string", minLength: 1 } };
  it("exactly-one-of with `not required` (oneOf of required + not)", () => {
    const v = builds({ type: "object", additionalProperties: false, properties: props, oneOf: [
      { required: ["sessionId"], not: { anyOf: [{ required: ["all"] }, { required: ["subject"] }] } },
      { required: ["all"], not: { anyOf: [{ required: ["sessionId"] }, { required: ["subject"] }] } },
    ] }) as S;
    assert.deepEqual(Object.keys(v), ["sessionId"]);
  });
  it("a oneOf alternative that carries its own anyOf of required members", () => {
    builds({ type: "object", properties: { id: { type: "string" }, a: { type: "string" }, b: { type: "string" } }, oneOf: [
      { required: ["id"], anyOf: [{ required: ["a"] }, { required: ["b"] }] },
      { required: ["a", "b"], not: { required: ["id"] } },
    ] });
  });
});

describe("open objects with minProperties (opaque, non-empty members)", () => {
  it("members the schema does not name, keys from propertyNames through a $ref", () => {
    const v = builds({ type: "object", required: ["values"], properties: { values: { type: "object", minProperties: 1, propertyNames: { $ref: "#/$defs/Key" }, additionalProperties: { type: "string" } } }, $defs: { Key: { type: "string", pattern: "^[a-z][a-zA-Z0-9]*$" } } }) as { values: S };
    assert.equal(Object.keys(v.values).length, 1);
  });
  it("no propertyNames: a placeholder key", () => {
    builds({ type: "object", required: ["doc"], properties: { doc: { type: "object", minProperties: 2 } } });
  });
  it("never adds a member to a closed object", () => {
    assert.equal(exampleExtended({ type: "object", required: ["o"], properties: { o: { type: "object", minProperties: 1, additionalProperties: false } } }), undefined);
  });
});

describe("nesting deeper than the plain builder's limit", () => {
  it("a chain of required $ref members", () => {
    const defs: S = {};
    const N = 14;
    for (let i = 0; i < N; i++) defs[`D${i}`] = i === N - 1 ? { type: "string", minLength: 1 } : { type: "object", required: ["n"], properties: { n: { $ref: `#/$defs/D${i + 1}` } } };
    const schema = { type: "object", required: ["n"], properties: { n: { $ref: "#/$defs/D0" } }, $defs: defs };
    assert.equal(example(schema), undefined, "the plain builder stops at its depth limit");
    builds(schema);
  });
});

describe("what example already builds is returned unchanged", () => {
  it("exampleExtended is example where example builds", () => {
    const { tasks } = coverageTasks();
    let n = 0;
    for (const t of tasks) {
      const plain = loadTask(t.task.typeUri)!.validPayload;
      if (plain === undefined) continue;
      n++;
      assert.equal(JSON.stringify(exampleExtended(t.task.payloadSchema as S)), JSON.stringify(plain), t.task.typeUri);
    }
    assert.ok(n >= BEFORE_BUILDABLE - 5);
  });
  it("a schema example builds is not touched by the extended pass (first alternative that builds wins)", () => {
    const schema = { oneOf: [{ type: "string", pattern: "^zz[0-9]{3}$" }, { type: "string", const: "fallback" }] };
    assert.equal(example(schema), "fallback");
    assert.equal(exampleExtended(schema), "fallback");
  });
});

describe("census coverage of the builder", () => {
  it("more census task versions have a valid payload than before, and it is printed", () => {
    const { tasks } = coverageTasks();
    const built = tasks.filter((t) => t.task.validPayload !== undefined).length;
    console.log(`buildable census task versions: before ${BEFORE_BUILDABLE} of ${tasks.length}, now ${built}`);
    assert.ok(built >= tasks.length, `${tasks.length - built} versions still unbuildable`);
    assert.ok(built > BEFORE_BUILDABLE);
  });
  it("every built payload validates against its own schema", () => {
    for (const t of coverageTasks().tasks) if (t.task.validPayload !== undefined) assert.deepEqual(validate(t.task.payloadSchema as S, t.task.validPayload), [], t.task.typeUri);
  });
});
