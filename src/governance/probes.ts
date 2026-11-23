// SPDX-License-Identifier: Apache-2.0
// Governance probes (docs/17). A probe declares nonce governance through the adapter, exercises the platform through ordinary tasks and
// compares the outcome with the declaration only. No probe contains a built-in role name, rule or number: every governance value comes
// from the declaration the probe itself generates.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Adapter, Capabilities, GovernanceDeclaration, GovernanceItem } from "../adapter/contract.ts";
import { buildSend } from "../runner/build.ts";
import type { BuildContext } from "../runner/build.ts";
import { PROFILE_WINDOW } from "../runner/window.ts";
import { makeActors } from "../runner/engine.ts";
import { makeFinding } from "./findings.ts";
import type { GovFinding, GovKind } from "./findings.ts";
import { probeMarkerErrors } from "../vectors/source.ts";
import type { VectorSource } from "../vectors/source.ts";

export const GOV_FORMAT = "tt-governance-probes/0.1";
export const GRANT = "https://trusttasks.org/spec/acl/grant/0.3";
export const LIST = "https://trusttasks.org/spec/acl/list/0.4";
export const EVALUATE = "https://trusttasks.org/spec/policy/evaluate/0.4";
/**
 * The versions of a task a probe can speak, newest first. A platform that serves an older version of the same task is probed on it: the
 * probe names the same members, except that `acl/grant` 0.2 has no `purposes` member (its entry is closed). A platform that serves none
 * of the listed versions is NOT-PROBED ("does not serve").
 */
export const TASK_VERSIONS: Record<string, string[]> = {
  [GRANT]: [GRANT, "https://trusttasks.org/spec/acl/grant/0.2"],
  [LIST]: [LIST, "https://trusttasks.org/spec/acl/list/0.3"],
};

export type ProbeKind = "differential" | "default";
export const SCENARIOS = ["role-vocabulary", "unknown-role", "authority-rule", "consent-values", "undeclared-principal"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface GovProbe {
  id: string;
  title: string;
  kind: ProbeKind;
  scenario: Scenario;
  /** The declarable items the adapter must accept. */
  declares: GovernanceItem[];
  /** Type URIs the platform must serve. */
  requires: string[];
  spec: string[];
  source: VectorSource;
  /** Static evidence rows (results/governance-evidence.json) that sit beside this probe. */
  evidence: string[];
  /** Every governance probe is a suite instrument (docs/04 section 18.1): counted as `probe`, apart from the candidates. */
  probe: true;
}

export interface GovProbeFile {
  format: string;
  group: string;
  probes: GovProbe[];
}

export function loadProbes(dir: string): GovProbe[] {
  if (!existsSync(dir)) return [];
  const out: GovProbe[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "manifest.json").sort()) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8")) as GovProbeFile;
    if (j.format !== GOV_FORMAT) throw new Error(`${f}: format must be ${GOV_FORMAT}`);
    for (const [i, p] of j.probes.entries()) {
      const errs = p.probe === true ? probeMarkerErrors(p, `${f}: probes[${i}]`) : [`${f}: probes[${i}].probe: every governance probe carries probe: true`];
      if (errs.length > 0) throw new Error(errs.join("; "));
    }
    out.push(...j.probes);
  }
  return out;
}

// ---------------------------------------------------------------- the run

interface Reply {
  kind: "response" | "error" | "none";
  code?: string;
  details?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

interface Env {
  adapter: Adapter;
  caps: Capabilities;
  iutVid: string;
  actors: ReturnType<typeof makeActors>;
  salt: string;
  probeId: string;
  seq: number;
  clock: { settable: boolean };
  /** The version of acl/grant and acl/list this platform serves (see TASK_VERSIONS). */
  grant: string;
  list: string;
}

const hex = (s: string, n = 8): string => createHash("sha256").update(s).digest("hex").slice(0, n);
/** A name with no semantics, stable for one run. */
const nonce = (env: Env, what: string): string => `gov-${what}-${hex(`${env.salt}|${env.probeId}|${what}`)}`;

async function ask(env: Env, as: string, type: string, payload: Record<string, unknown>): Promise<Reply> {
  const now = env.clock.settable ? Date.parse("2026-11-15T12:00:00.000Z") : Math.floor(Date.now() / 1000) * 1000;
  if (env.clock.settable) await env.adapter.setClock(new Date(now).toISOString());
  const name = `s${env.seq++}`;
  const ctx: BuildContext = { vectorId: env.probeId, iutVid: env.iutVid, actors: env.actors, carrier: "", nowMs: now, startMs: now, captures: {}, window: PROFILE_WINDOW, salt: env.salt };
  const built = buildSend({ from: as, document: { id: `$id(${name})`, type, issuer: `$${as}`, recipient: "$iut", issuedAt: "$now+0s", payload } }, ctx, undefined);
  const res = await env.adapter.send({ from: { kind: "actor", vid: env.actors[as]!.vid }, bytes: built.bytes });
  const first = res.replies[0];
  if (first === undefined) return { kind: "none" };
  const doc = JSON.parse(first) as { type?: string; payload?: Record<string, unknown> };
  if (String(doc.type).includes("/trust-task-error/")) {
    const p = (doc.payload ?? {}) as { code?: string; details?: Record<string, unknown> };
    const code = typeof p.code === "string" ? p.code.slice(p.code.lastIndexOf(":") + 1) : "";
    return { kind: "error", code, ...(p.details === undefined ? {} : { details: p.details }) };
  }
  return { kind: "response", ...(doc.payload === undefined ? {} : { payload: doc.payload }) };
}

const grantPayload = (subject: string, role: string, env: Env): Record<string, unknown> => ({
  entry: { subject, role, act: { scope: "all" }, keys: { scope: "all" }, capabilities: { scope: "ceiling" }, ...(env.grant === GRANT ? { purposes: { scope: "any" } } : {}) },
});

/** The role the platform holds for `subject` according to a list reply: a role, "" (no entry), or undefined (could not be read). */
async function listed(env: Env, as: string, subject: string): Promise<string | undefined> {
  const r = await ask(env, as, env.list, {});
  if (r.kind !== "response") return undefined;
  const entries = (r.payload?.entries ?? []) as { subject?: string; role?: string }[];
  return entries.find((e) => e.subject === subject)?.role ?? "";
}

const grantedRole = (r: Reply): string | undefined => ((r.payload?.entry as { role?: string } | undefined)?.role);
const describe = (r: Reply): string => (r.kind === "response" ? `an accepted answer (role ${grantedRole(r) ?? "not stated"})` : r.kind === "error" ? `a refusal with code ${r.code}` : "no answer");
const sameSet = (a: unknown, b: string[]): boolean => Array.isArray(a) && a.length === b.length && b.every((x) => a.includes(x));

interface Verdict {
  kind: GovKind;
  declared: string;
  observed: string;
}

type ScenarioFn = (env: Env, apply: (d: GovernanceDeclaration) => Promise<string | undefined>) => Promise<Verdict | { notProbed: string }>;

const A = "A";
const X = "X";
const R = "R";
const Q = "Q";

const scenarios: Record<Scenario, ScenarioFn> = {
  // The declared role is accepted, held and listed under its declared name; a refusal that names the known roles names the declared set.
  "role-vocabulary": async (env, apply) => {
    const r0 = nonce(env, "r0"), r1 = nonce(env, "r1"), unknown = nonce(env, "rx");
    const declared = `a role set {${r0}, ${r1}} in which ${r0} may grant ${r0} and ${r1}`;
    const rejected = await apply({ roles: [r0, r1], principals: [{ vid: env.actors[A]!.vid, role: r0 }], authority: { [r0]: [r0, r1], [r1]: [] } });
    if (rejected !== undefined) return { kind: "GOV-FIXED", declared, observed: `a refusal of the declaration (${rejected})` };
    const subject = `did:example:${nonce(env, "s1")}`;
    const g = await ask(env, A, env.grant, grantPayload(subject, r1, env));
    if (g.kind === "none") return { notProbed: "no answer to the grant request" };
    if (g.kind === "error") return { kind: "GOV-FIXED", declared: `${declared}; a grant of ${r1}`, observed: `${describe(g)}${g.code === "roleNotRecognized" && g.details?.knownRoles !== undefined ? ` listing known roles ${JSON.stringify(g.details.knownRoles)}` : ""}` };
    if (grantedRole(g) !== r1) return { kind: "GOV-FIXED", declared: `${declared}; a grant of ${r1}`, observed: describe(g) };
    const held = await listed(env, A, subject);
    if (held !== undefined && held !== r1) return { kind: "GOV-FIXED", declared: `${declared}; a grant of ${r1}`, observed: held === "" ? "an accepted answer and no entry in the list" : `an entry listed under role ${held}` };
    const u = await ask(env, A, env.grant, grantPayload(`did:example:${nonce(env, "s2")}`, unknown, env));
    if (u.kind === "error" && u.details?.knownRoles !== undefined && !sameSet(u.details.knownRoles, [r0, r1])) {
      return { kind: "GOV-FIXED", declared: `${declared}; the known roles`, observed: `known roles ${JSON.stringify(u.details.knownRoles)} in a refusal` };
    }
    return { kind: "GOV-HONOURED", declared: `${declared}; a grant of ${r1}`, observed: `an accepted answer, the entry held and listed under ${r1}${held === undefined ? " (the list could not be read back)" : ""}` };
  },

  // A role that was never declared is refused, and no entry is held for the subject.
  "unknown-role": async (env, apply) => {
    const r0 = nonce(env, "r0"), unknown = nonce(env, "rx");
    const rejected = await apply({ roles: [r0], principals: [{ vid: env.actors[A]!.vid, role: r0 }], authority: { [r0]: [r0] } });
    if (rejected !== undefined) return { notProbed: `the declaration was refused (${rejected}), so no undeclared role could be tried against it` };
    const subject = `did:example:${nonce(env, "s1")}`;
    const g = await ask(env, A, env.grant, grantPayload(subject, unknown, env));
    if (g.kind === "none") return { notProbed: "no answer to the grant request" };
    const held = await listed(env, A, subject);
    if (g.kind === "response" || (held !== undefined && held !== "")) {
      return { kind: "GOV-DEFAULT", declared: "", observed: `${describe(g)}${held === undefined || held === "" ? "" : `, an entry listed under role ${held}`} for a role that was not declared (${unknown})` };
    }
    return { kind: "GOV-HONOURED", declared: `a role set {${r0}}; a grant of the undeclared role ${unknown}`, observed: `${describe(g)} and no entry held` };
  },

  // Each outcome of a declared who-may-grant-what rule is the declared outcome.
  "authority-rule": async (env, apply) => {
    const [r1, r2, r3] = [nonce(env, "r1"), nonce(env, "r2"), nonce(env, "r3")];
    const authority = { [r1]: [r3], [r2]: [] as string[], [r3]: [r1, r2] };
    const declared = `roles {${r1}, ${r2}, ${r3}} where ${r1} may grant ${r3}, ${r2} may grant nothing, ${r3} may grant ${r1} and ${r2}`;
    const rejected = await apply({ roles: [r1, r2, r3], principals: [{ vid: env.actors[A]!.vid, role: r1 }, { vid: env.actors[X]!.vid, role: r2 }, { vid: env.actors[R]!.vid, role: r3 }], authority });
    if (rejected !== undefined) return { kind: "GOV-FIXED", declared, observed: `a refusal of the declaration (${rejected})` };
    const cases: { by: string; holds: string; role: string }[] = [
      { by: A, holds: r1, role: r3 }, { by: A, holds: r1, role: r1 }, { by: X, holds: r2, role: r1 }, { by: R, holds: r3, role: r2 }, { by: R, holds: r3, role: r3 },
    ];
    const diffs: string[] = [];
    let n = 0;
    for (const c of cases) {
      const want = (authority[c.holds as keyof typeof authority] ?? []).includes(c.role);
      const g = await ask(env, c.by, env.grant, grantPayload(`did:example:${nonce(env, `s${n++}`)}`, c.role, env));
      if (g.kind === "none") return { notProbed: "no answer to a grant request" };
      const got = g.kind === "response";
      if (got !== want) diffs.push(`a holder of ${c.holds} granting ${c.role}: declared ${want ? "accepted" : "refused"}, observed ${describe(g)}`);
    }
    if (diffs.length > 0) return { kind: "GOV-FIXED", declared, observed: `${cases.length - diffs.length} of ${cases.length} declared outcomes; ${diffs.join("; ")}` };
    return { kind: "GOV-HONOURED", declared, observed: `each of ${cases.length} grants decided as declared` };
  },

  // A declared consent rule is stated with its own values (declared twice, with different values); the platform supplies none of its own.
  "consent-values": async (env, apply) => {
    const task = `https://example.org/conformance/${nonce(env, "task")}`;
    const set = nonce(env, "set");
    const notes: string[] = [];
    let declaredAll = "";
    let n = 0;
    for (const [k, ex] of [[3, true], [2, false]] as const) {
      const declared = `consent for ${task}: minApprovals ${k}, excludeRequester ${ex}`;
      declaredAll += `${declaredAll === "" ? "" : "; then "}${declared}`;
      const rejected = await apply({ roles: [nonce(env, "r0")], principals: [], consent: { task, approverSet: set, minApprovals: k, excludeRequester: ex } });
      if (rejected !== undefined) return { kind: "GOV-FIXED", declared, observed: `a refusal of the declaration (${rejected})` };
      const r = await ask(env, A, EVALUATE, { input: { request: { typeUri: task, sideEffects: "none", exposure: { discloses: "none", actsAsSubject: false } }, site: { kind: "webOrigin", origin: "https://example.org/x" }, contextId: "example", consumer: { did: "example" } } });
      n++;
      if (r.kind === "none") return { notProbed: "no answer to the evaluate request" };
      const dec = (r.payload?.decision ?? {}) as { decision?: string; requireConsent?: Record<string, unknown> };
      if (r.kind !== "response" || dec.decision !== "requireConsent" || dec.requireConsent === undefined) {
        return { kind: "GOV-FIXED", declared, observed: `${r.kind === "response" ? `the decision ${String(dec.decision)}` : describe(r)} for a task the declaration gates` };
      }
      const rc = dec.requireConsent;
      const missing = ["minApprovals", "excludeRequester"].filter((m) => rc[m] === undefined);
      if (missing.length > 0) return { kind: "GOV-DEFAULT", declared, observed: `a consent decision without ${missing.join(" and ")}, leaving the value to the receiver` };
      if (rc.minApprovals !== k || rc.excludeRequester !== ex) return { kind: "GOV-FIXED", declared, observed: `a consent decision with minApprovals ${String(rc.minApprovals)} and excludeRequester ${String(rc.excludeRequester)}` };
      notes.push(`${k}/${String(ex)}`);
    }
    return { kind: "GOV-HONOURED", declared: declaredAll, observed: `consent decisions stating ${notes.join(" and ")} (${n} declarations)` };
  },

  // A principal the declaration does not name holds no role: its request is refused, not treated as the request of a default role.
  "undeclared-principal": async (env, apply) => {
    const r0 = nonce(env, "r0"), r1 = nonce(env, "r1");
    const rejected = await apply({ roles: [r0, r1], principals: [{ vid: env.actors[A]!.vid, role: r0 }], authority: { [r0]: [r0, r1] } });
    if (rejected !== undefined) return { notProbed: `the declaration was refused (${rejected}), so no undeclared principal could be tried against it` };
    const subject = `did:example:${nonce(env, "s1")}`;
    const g = await ask(env, Q, env.grant, grantPayload(subject, r1, env));
    if (g.kind === "none") return { notProbed: "no answer to the grant request" };
    const held = await listed(env, A, subject);
    if (g.kind === "response" || (held !== undefined && held !== "")) return { kind: "GOV-DEFAULT", declared: "", observed: `${describe(g)} for a principal the declaration does not name` };
    return { kind: "GOV-HONOURED", declared: `${r0} held by one principal, nobody else named; a grant by an unnamed principal`, observed: `${describe(g)} and no entry held` };
  },
};

export interface GovRunOptions {
  adapter: Adapter;
  probes: GovProbe[];
  salt?: string;
}

export interface GovRun {
  platform: string;
  salt: string;
  findings: GovFinding[];
}

export async function runGovernance(opts: GovRunOptions): Promise<GovRun> {
  const caps = await opts.adapter.capabilities();
  const provisioned = await opts.adapter.provision(["iut"]);
  const iut = provisioned.iut;
  if (iut === undefined) throw new Error("adapter did not provision role iut");
  const salt = opts.salt ?? hex(String(Math.random()), 12);
  const gov = caps.governance;
  const findings: GovFinding[] = [];
  const base = (p: GovProbe) => ({ probe: p.id, title: p.title, platform: caps.name, channel: p.source.channel });
  for (const p of opts.probes) {
    const notProbed = (reason: string): void => void findings.push(makeFinding("GOV-NOT-PROBED", { ...base(p), reason }));
    const decl = gov?.declaration ?? "unknown";
    if (decl !== "supported" || opts.adapter.declareGovernance === undefined || !caps.optional.includes("governance.declare")) {
      notProbed(decl === "none" ? `governance-undeclared: the adapter states the platform has no declaration path it can reach${gov?.reason === undefined ? "" : ` (${gov.reason})`}` : `governance-undeclared: the adapter declares no governance declaration path (declaration ${decl})`);
      continue;
    }
    const missingItem = p.declares.find((i) => !(gov?.items ?? []).includes(i));
    if (missingItem !== undefined) {
      notProbed(`governance-undeclared: the adapter does not accept the declarable item ${missingItem}`);
      continue;
    }
    const serves = (t: string): string | undefined => (TASK_VERSIONS[t] ?? [t]).find((v) => caps.supportedTypes.includes(v) || (caps.unlistedTypes ?? []).includes(v));
    const missingType = p.requires.find((t) => serves(t) === undefined);
    if (missingType !== undefined) {
      notProbed(`the platform does not serve ${missingType}`);
      continue;
    }
    const env: Env = { adapter: opts.adapter, caps, iutVid: iut.vid, actors: makeActors(), salt, probeId: p.id, seq: 0, clock: { settable: caps.optional.includes("clock") }, grant: serves(GRANT) ?? GRANT, list: serves(LIST) ?? LIST };
    const apply = async (d: GovernanceDeclaration): Promise<string | undefined> => {
      await opts.adapter.reset();
      const res = await opts.adapter.declareGovernance!(d);
      if (res.status === "applied") return undefined;
      if (res.status === "unsupported") throw new Error(`the adapter reports no declaration path${res.reason === undefined ? "" : ` (${res.reason})`}`);
      return res.reason;
    };
    try {
      await opts.adapter.reset();
      const v = await scenarios[p.scenario](env, apply);
      if ("notProbed" in v) notProbed(v.notProbed);
      else findings.push(makeFinding(v.kind, { ...base(p), declared: v.declared, observed: v.observed }));
    } catch (err) {
      notProbed(/^the adapter reports no declaration path/.test((err as Error).message) ? (err as Error).message : `the probe could not run: ${(err as Error).message}`);
    }
  }
  return { platform: caps.name, salt, findings };
}
