// SPDX-License-Identifier: Apache-2.0
// Builds the scenario of a `verifyReceipt` step (vector group RCPT, docs/04 section 11.6): the fixture ceremony definition, an enactment of it
// (signed step documents that carry the `ceremony` member and chain by `prev`), the receipt a recorder issued for it
// (specs/trust-ceremony-receipt/0.1/spec.md:113-124), and what the verifier holds. Every deviation a vector names is applied here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerifyReceiptParams } from "../adapter/contract.ts";
import { toMultibase } from "../crypto/base58.ts";
import { digestMultibase } from "../crypto/digest.ts";
import { fromMultibase } from "../crypto/base58.ts";
import { signDocument } from "../crypto/proof.ts";
import { stepDigest } from "../crypto/stepdigest.ts";
import { deepClone, isObject } from "../util/json.ts";
import { removePointer, setPointer } from "../util/pointer.ts";
import type { Mutation, ReceiptDocSpec, ReceiptFixture, ReceiptSpec } from "../vectors/types.ts";
import { deterministicId, parseAt, substitute } from "./build.ts";
import type { BuildContext } from "./build.ts";

export const RECEIPT_TYPE = "https://trusttasks.org/spec/trust-ceremony-receipt/0.1";
const STEP_TYPE_BASE = "https://trusttasks.org/spec/conformance/receipt";

interface FixtureStep {
  issuer: string;
  recipient: string;
  prev: string[];
  optional?: true;
  terminal?: true;
  perRole?: true;
  maxRounds?: number;
}
interface Fixture {
  slug: string;
  steps: Record<string, FixtureStep>;
  roles: Record<string, "one" | "many">;
  completion: unknown;
  /** Role to the harness actors bound to it. */
  bindings: Record<string, string[]>;
  /** Instances of an enactment that ran every step. */
  all: string[];
  /** Actor that issues a step by default, and the actor it is addressed to. */
  issuerActor: Record<string, string>;
  recipientActor: Record<string, string>;
}

const FIXTURES: Record<ReceiptFixture, Fixture> = {
  linear: {
    slug: "receipt-linear",
    roles: { initiator: "one", reviewer: "one", recorder: "one", auditor: "one" },
    steps: {
      apply: { issuer: "initiator", recipient: "reviewer", prev: [] },
      review: { issuer: "reviewer", recipient: "initiator", prev: ["apply"], optional: true },
      decide: { issuer: "reviewer", recipient: "initiator", prev: ["review"], terminal: true },
    },
    completion: { allOf: ["apply", "decide"] },
    bindings: { initiator: ["A"], reviewer: ["X"], recorder: ["W"], auditor: ["Q"] },
    all: ["apply", "review", "decide"],
    issuerActor: { apply: "A", review: "X", decide: "X" },
    recipientActor: { apply: "X", review: "A", decide: "A" },
  },
  approve: {
    slug: "receipt-approve",
    roles: { proposer: "one", approver: "many", recorder: "one", auditor: "one" },
    steps: {
      propose: { issuer: "proposer", recipient: "approver", prev: [] },
      approve: { issuer: "approver", recipient: "proposer", prev: ["propose"], perRole: true, maxRounds: 2, terminal: true },
    },
    completion: { threshold: { n: 2, ofStep: "approve" } },
    bindings: { proposer: ["A"], approver: ["X", "S"], recorder: ["W"], auditor: ["Q"] },
    all: ["propose", "approve@X", "approve@S"],
    issuerActor: { propose: "A", approve: "X" },
    recipientActor: { propose: "X", approve: "A" },
  },
  prefix: {
    slug: "receipt-prefix",
    roles: { initiator: "one", responder: "one", recorder: "one", auditor: "one" },
    steps: {
      open: { issuer: "initiator", recipient: "responder", prev: [] },
      middle: { issuer: "responder", recipient: "initiator", prev: ["open"] },
      end: { issuer: "initiator", recipient: "responder", prev: ["middle"], optional: true, terminal: true },
    },
    completion: { allOf: ["open", "middle"] },
    bindings: { initiator: ["A"], responder: ["X"], recorder: ["W"], auditor: ["Q"] },
    all: ["open", "middle", "end"],
    issuerActor: { open: "A", middle: "X", end: "A" },
    recipientActor: { open: "X", middle: "A", end: "X" },
  },
};

/** A definition in the registry's shape (ceremonies/ceremony.meta.schema.json) for a fixture. The URI is on an authority this suite does not claim to be the registry's. */
export function fixtureDefinition(name: ReceiptFixture): Record<string, unknown> {
  const f = FIXTURES[name];
  return {
    slug: f.slug,
    version: "0.1",
    title: `Conformance fixture ${f.slug}`,
    summary: "A ceremony definition that exists only to exercise receipt verification in the conformance suite.",
    status: "draft",
    targetFrameworkVersion: "0.6.0",
    authors: ["dtgwg-conformance"],
    roles: Object.fromEntries(Object.entries(f.roles).map(([r, c]) => [r, { description: `The ${r}.`, cardinality: c }])),
    steps: Object.fromEntries(
      Object.entries(f.steps).map(([n, st]) => [n, {
        kind: "task", type: `${STEP_TYPE_BASE}/${n}/0.1`, issuer: st.issuer, recipient: st.recipient,
        ...(st.optional === true ? { optional: true } : {}), ...(st.perRole === true ? { multiplicity: "perRole" } : {}),
        ...(st.maxRounds === undefined ? {} : { maxRounds: st.maxRounds }), prev: st.prev, ...(st.terminal === true ? { terminal: true } : {}),
      }]),
    ),
    completion: f.completion,
    evidence: { level: "receipt", recorders: ["recorder", "auditor"] },
    exposure: { discloses: "metadata", actsAsSubject: false },
  };
}

export function definitionUri(name: ReceiptFixture): string {
  return `https://conformance.example/ceremony/${FIXTURES[name].slug}/0.1`;
}

interface Instance {
  key: string;
  step: string;
  actor: string;
  round: number;
}

function parseInstance(key: string, fx: Fixture): Instance {
  const m = /^([a-z][a-z0-9-]*)(?:@([A-Z]))?(?:#(\d+))?$/.exec(key);
  if (m === null) throw new Error(`bad receipt instance ${key}`);
  const step = m[1]!;
  if (fx.steps[step] === undefined) throw new Error(`unknown step in instance ${key}`);
  return { key, step, actor: m[2] ?? fx.issuerActor[step]!, round: m[3] === undefined ? 1 : Number(m[3]) };
}

function resolveTokens(value: unknown, tokens: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return tokens.get(value) ?? value;
  if (Array.isArray(value)) return value.map((x) => resolveTokens(x, tokens));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, resolveTokens(x, tokens)]));
  return value;
}

/** Apply mutations; `$stepId(instance)` and `$stepDigest(instance)` name an instance built earlier in the enactment. */
function mutate(doc: Record<string, unknown>, ms: readonly Mutation[] | undefined, ctx: BuildContext, afterSign: boolean, tokens: ReadonlyMap<string, string> = new Map()): void {
  for (const m of ms ?? []) {
    if ((m.afterSign === true) !== afterSign) continue;
    if (m.op === "set") setPointer(doc, m.path!, substitute(resolveTokens(m.value, tokens), ctx));
    else if (m.op === "remove") removePointer(doc, m.path!);
  }
}

export interface ReceiptScenario {
  params: VerifyReceiptParams;
  /** The enactment salt and the pinned definition digest, for tests. */
  salt: string;
  definitionDigest: string;
}

export function buildReceiptScenario(spec: ReceiptSpec, ctx: BuildContext, fixtureRoot = ""): ReceiptScenario {
  const name = spec.ceremony ?? "linear";
  const fx = FIXTURES[name];
  const actor = (a: string): { vid: string; signer: NonNullable<BuildContext["actors"][string]>["signer"] } => {
    const x = ctx.actors[a];
    if (x === undefined) throw new Error(`unknown actor ${a}`);
    return x;
  };
  const variant = spec.digest ?? {};
  const base = ctx.startMs ?? ctx.nowMs;
  const definition = fixtureDefinition(name);
  const definitionDigest = digestMultibase(definition);
  const keys = spec.instances ?? fx.all;
  const tokens = new Map<string, string>();
  /** The step documents of one enactment of the fixture; `tag` names a second enactment (`other`) whose ids, salt and enactment differ. */
  const enact = (tag: string): { docs: Map<string, Record<string, unknown>>; instances: Map<string, Instance>; enactment: string; salt: string } => {
    const suffix = tag === "" ? "" : `/${tag}`;
    const eSalt = toMultibase(new Uint8Array(createHash("sha256").update(`${ctx.salt ?? ""}/${ctx.vectorId}/enactment-salt${suffix}`).digest()));
    const eId = deterministicId(ctx.vectorId, `enactment${suffix}`, ctx.salt);
    const edig = (doc: Record<string, unknown>): string => stepDigest(doc, eSalt, variant);
    const edocs = new Map<string, Record<string, unknown>>();
    const einst = new Map<string, Instance>();
    for (const [i, key] of keys.entries()) {
      const inst = parseInstance(key, fx);
      einst.set(key, inst);
      const def = fx.steps[inst.step]!;
      const prev = def.prev.length === 0
        ? []
        : [...edocs.entries()].filter(([k]) => def.prev.includes(einst.get(k)!.step)).map(([, d]) => ({ id: d.id as string, digestMultibase: edig(d) }));
      const ceremony: Record<string, unknown> = {
        enactment: eId, step: inst.step, definition: definitionUri(name), definitionDigest,
        ...(inst.round === 1 ? {} : { round: inst.round }),
        ...(def.terminal === true ? { terminal: true } : {}),
        ...(prev.length === 0 ? {} : { prev }),
      };
      const issuedMs = base - 600_000 + i * 30_000;
      let doc: Record<string, unknown> = {
        id: deterministicId(ctx.vectorId, `step:${key}${suffix}`, ctx.salt),
        threadId: deterministicId(ctx.vectorId, `thread:${key}${suffix}`, ctx.salt),
        type: `${STEP_TYPE_BASE}/${inst.step}/0.1`,
        issuer: actor(inst.actor).vid,
        recipient: actor(fx.recipientActor[inst.step]!).vid,
        issuedAt: new Date(issuedMs).toISOString().replace(".000Z", "Z"),
        ceremony,
        payload: { note: `${inst.step} by ${inst.actor}` },
      };
      mutate(doc, spec.docMutate?.[key], ctx, false, tokens);
      const proof = spec.docProof?.[key];
      if (proof !== "none") {
        doc = signDocument(doc, actor(inst.actor).signer, { created: issuedMs, ...(doc.issuer === actor(inst.actor).vid ? {} : { allowIssuerMismatch: true }) });
        if (proof === "corrupt") doc = corrupt(doc);
      }
      mutate(doc, spec.docMutate?.[key], ctx, true, tokens);
      edocs.set(key, doc);
      if (tag === "") {
        tokens.set(`$stepId(${key})`, String(doc.id));
        tokens.set(`$stepDigest(${key})`, edig(doc));
      }
    }
    return { docs: edocs, instances: einst, enactment: eId, salt: eSalt };
  };
  const main = enact("");
  const { docs, instances, enactment, salt } = main;
  const dig = (doc: Record<string, unknown>): string => stepDigest(doc, salt, variant);

  // the receipt
  const r: ReceiptDocSpec = spec.receipt ?? {};
  const enumerate = spec.enumerate ?? keys;
  const steps = enumerate.map((k) => {
    const d = docs.get(k);
    if (d === undefined) throw new Error(`enumerated instance ${k} did not happen`);
    const inst = instances.get(k)!;
    const c = isObject(d.ceremony) ? d.ceremony : {};
    const echoTerminal = r.echo === "declared" ? fx.steps[inst.step]!.terminal === true : c.terminal === true;
    return {
      step: inst.step,
      ...(inst.round === 1 ? {} : { round: inst.round }),
      typeUri: String(d.type),
      issuer: String(d.issuer),
      id: String(d.id),
      digestMultibase: dig(d),
      ...(echoTerminal ? { terminal: true } : {}),
    };
  });
  const payload: Record<string, unknown> = r.payloadFrom !== undefined
    ? (JSON.parse(readFileSync(join(fixtureRoot, r.payloadFrom.file), "utf8")) as { payload: Record<string, unknown> }[])[r.payloadFrom.index]!.payload
    : {
        enactment, definition: definitionUri(name), definitionDigest, complete: r.complete ?? true,
        ...(r.salt === "omit" ? {} : { salt: r.salt === "wrong" ? toMultibase(new Uint8Array(createHash("sha256").update("another salt").digest())) : salt }),
        steps,
      };
  const issuer = actor(r.issuer ?? "W");
  const created = ctx.nowMs + (r.created === undefined ? 0 : parseAt(r.created, ctx.window));
  let receipt: Record<string, unknown> = {
    id: deterministicId(ctx.vectorId, "receipt", ctx.salt),
    type: r.type ?? RECEIPT_TYPE,
    issuer: issuer.vid,
    issuedAt: new Date(ctx.nowMs).toISOString().replace(".000Z", "Z"),
    payload,
  };
  mutate(receipt, r.mutate, ctx, false, tokens);
  if (r.sign !== null) {
    const signer = actor(r.signer ?? r.issuer ?? "W");
    receipt = signDocument(receipt, signer.signer, { created, purpose: "assertionMethod", ...(receipt.issuer === signer.vid ? {} : { allowIssuerMismatch: true }) });
    if (r.corrupt === true) receipt = corrupt(receipt);
  }
  mutate(receipt, r.mutate, ctx, true, tokens);

  // what the verifier holds
  const holdKeys = spec.hold === "none" ? [] : spec.hold === undefined || spec.hold === "all" ? keys : spec.hold;
  const source = spec.heldEnactment === "other" ? enact("other") : main;
  const held = holdKeys.map((k) => {
    const d = source.docs.get(k);
    if (d === undefined) throw new Error(`held instance ${k} did not happen`);
    let copy = deepClone(d);
    mutate(copy, spec.heldMutate?.[k], ctx, false, tokens);
    if (spec.heldResign?.includes(k) === true) {
      const inst = source.instances.get(k)!;
      const created = Date.parse(String(copy.issuedAt)) + 1000;
      copy = signDocument(copy, actor(inst.actor).signer, { created, ...(copy.issuer === actor(inst.actor).vid ? {} : { allowIssuerMismatch: true }) });
    }
    return JSON.stringify(copy);
  });
  const resolved = spec.definition ?? "resolved";
  const resolvedDefinition = resolved === "unresolvable" ? null : resolved === "altered" ? { ...definition, completion: name === "approve" ? { threshold: { n: 1, ofStep: "approve" } } : { allOf: [Object.keys(fx.steps)[0]!] } } : definition;
  const roleBindings = spec.bindings === "none" ? null : bindingsOf(fx, spec.bindings, ctx);
  return {
    params: {
      receipt: JSON.stringify(receipt),
      definition: resolvedDefinition as Record<string, unknown> | null,
      roleBindings,
      steps: held,
    },
    salt,
    definitionDigest,
  };
}

function bindingsOf(fx: Fixture, over: "full" | Record<string, string[]> | undefined, ctx: BuildContext): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const merged: Record<string, string[]> = { ...fx.bindings, ...(over === undefined || over === "full" ? {} : over) };
  for (const [role, actors] of Object.entries(merged)) {
    out[role] = actors.map((a) => {
      const x = ctx.actors[a];
      if (x === undefined) throw new Error(`unknown actor ${a}`);
      return x.vid;
    });
  }
  return out;
}

function corrupt(doc: Record<string, unknown>): Record<string, unknown> {
  const proof = doc.proof as Record<string, unknown>;
  const raw = fromMultibase(String(proof.proofValue));
  raw[0] = raw[0]! ^ 0x01;
  return { ...doc, proof: { ...proof, proofValue: toMultibase(raw) } };
}
