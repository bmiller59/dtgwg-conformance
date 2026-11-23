// SPDX-License-Identifier: Apache-2.0
import { clarifyMetaProblems } from "./clarify.ts";
import { isObject } from "../util/json.ts";
import { DISPOSITIONS, FORMAT, MUTATION_OPS, QUORUM_PATTERNS, SUBGROUPS } from "./types.ts";
import type { VectorFile } from "./types.ts";
import { GROUP_ID, parseVectorId } from "./ids.ts";
import { probeMarkerErrors, validateSource } from "./source.ts";
import { OPTIONAL_CAPABILITIES, RECEIPT_OUTCOMES, requireEntryProblem } from "../adapter/contract.ts";

/** A semver version, pre-release allowed (`0.1.0-draft`). */
export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Whether the accepted verdicts of a `verifyReceipt` step are exactly `complete` (a positive step); any other set is a negative one. */
export function receiptExpectsComplete(outcome: string | string[]): boolean {
  return (Array.isArray(outcome) ? outcome : [outcome]).every((o) => o === "complete");
}

// literal terms (5m, 30s, 250ms, 1h) or window members (windowMaxAge, windowSkew, windowHorizon), each with a sign: "+windowMaxAge+windowSkew+0s"
const OFFSET = /^([+-](\d+(ms|s|m|h)|windowMaxAge|windowSkew|windowHorizon))+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Spec-drift hashes are REQUIRED on a vector of a coverage family (family starting with "coverage") in channel proposed or candidate whenever it cites a
 * Trust Tasks file on main (tfRef): `tfCommit`, `specHash`, and `schemaHash` when the cited file is a task spec (docs/23). Optional everywhere else.
 */
export function coverageHashErrors(source: unknown, family: string, p: string): string[] {
  if (!family.startsWith("coverage") || !isObject(source)) return [];
  if (source.channel !== "proposed" && source.channel !== "candidate") return [];
  const t = source.tfRef;
  if (!isObject(t) || t.status === "pr" || typeof t.repoPath !== "string") return [];
  const errs: string[] = [];
  for (const k of ["tfCommit", "specHash"]) if (source[k] === undefined) errs.push(`${p}.source.${k}: required on a vector of a coverage family in channel ${String(source.channel)} (spec drift, docs/23)`);
  if (/^specs\/.+\/\d+\.\d+\/spec\.md$/.test(t.repoPath) && source.schemaHash === undefined) errs.push(`${p}.source.schemaHash: required for a task spec on a vector of a coverage family in channel ${String(source.channel)} (docs/23)`);
  return errs;
}

/** Structural validation of one vector file. Returns human-readable errors; empty means valid. */
export function validateVectorFile(value: unknown): string[] {
  const errs: string[] = [];
  const e = (path: string, msg: string): void => void errs.push(`${path}: ${msg}`);
  if (!isObject(value)) return ["$: not an object"];
  if (value.format !== FORMAT) e("$.format", `must be ${FORMAT}`);
  if (typeof value.group !== "string" || !GROUP_ID.test(value.group)) e("$.group", "bad group id");
  if (typeof value.family !== "string" || value.family === "") e("$.family", "required string");
  if (!isObject(value.clock) || typeof value.clock.start !== "string" || !ISO.test(value.clock.start)) {
    e("$.clock.start", "required RFC 3339 UTC instant");
  }
  if (!Array.isArray(value.vectors) || value.vectors.length === 0) {
    e("$.vectors", "non-empty array required");
    return errs;
  }
  value.vectors.forEach((v: unknown, i: number) => {
    const p = `$.vectors[${i}]`;
    if (!isObject(v)) return e(p, "not an object");
    const id = typeof v.id === "string" ? parseVectorId(v.id) : null;
    if (id === null) e(`${p}.id`, "does not match <GROUP>-<NNN>");
    else if (id.group !== value.group) e(`${p}.id`, `group ${id.group} differs from file group ${String(value.group)}`);
    if (typeof v.title !== "string" || v.title === "") e(`${p}.title`, "required");
    if (v.tier !== 1 && v.tier !== 2) e(`${p}.tier`, "must be 1 or 2");
    if (!Array.isArray(v.spec) || v.spec.length === 0 || !v.spec.every((s) => typeof s === "string")) {
      e(`${p}.spec`, "non-empty array of strings (traceability) required");
    }
    errs.push(...validateSource(v.source, `${p}.source`));
    errs.push(...coverageHashErrors(v.source, typeof value.family === "string" ? value.family : "", p));
    if (v.synthetic !== undefined && v.synthetic !== true) e(`${p}.synthetic`, "only true is allowed");
    errs.push(...probeMarkerErrors(v, p));
    if (v.excludedFromRun !== undefined && !(isObject(v.excludedFromRun) && typeof v.excludedFromRun.reason === "string" && v.excludedFromRun.reason !== "")) e(`${p}.excludedFromRun`, "object {reason, note?} with a non-empty reason required");
    if (v.retired !== undefined) {
      const r = v.retired;
      if (!(isObject(r) && typeof r.reason === "string" && r.reason !== "" && typeof r.since === "string" && SEMVER.test(r.since) && (r.replacedBy === undefined || (typeof r.replacedBy === "string" && parseVectorId(r.replacedBy) !== null)))) e(`${p}.retired`, "object {reason, since: <suite version>, replacedBy?: <vector id>} required");
    }
    if (isObject(v.source) && isObject(v.source.tfRef) && v.source.tfRef.status === "retired" && v.excludedFromRun === undefined) e(`${p}.excludedFromRun`, "a vector that cites a retired TF spec must be excluded from every run (excludedFromRun)");
    if (!("clarify" in v) || (v.clarify !== null && typeof v.clarify !== "string")) e(`${p}.clarify`, "string or null required");
    if (typeof v.clarify === "string") for (const m of clarifyMetaProblems({ class: v.clarifyClass, since: v.clarifySince, questions: v.clarifyQuestions }, `${p}.clarify*`)) e(`${p}.clarifyClass`, m);
    else if (v.clarifyClass !== undefined || v.clarifySince !== undefined || v.clarifyQuestions !== undefined) e(`${p}.clarifyClass`, "clarifyClass, clarifySince and clarifyQuestions belong to CLARIFY vectors only");
    if (v.effect !== undefined && !["destructive", "mutating", "read-only"].includes(String(v.effect))) e(`${p}.effect`, "one of destructive, mutating, read-only");
    if (v.strength !== undefined && !["asserted", "weak"].includes(String(v.strength))) e(`${p}.strength`, "one of asserted, weak");
    if (Array.isArray(v.steps)) {
      const answeredSteps = (v.steps as unknown[]).filter((x) => isObject(x) && isObject(x.expect) && x.expect.disposition === "answered") as { expect: Record<string, unknown> }[];
      const strong = answeredSteps.some((x) => x.expect.success === true);
      if (answeredSteps.length > 0 && v.strength === undefined && v.retired === undefined && isObject(v.source) && v.source.profile === "vectors-complete") e(`${p}.strength`, "a vectors-complete vector with an answered step declares its strength (asserted or weak)");
      if (v.strength === "asserted" && !answeredSteps.every((x) => x.expect.success === true)) e(`${p}.strength`, "asserted needs success: true on every answered step");
      if (v.strength === "weak" && strong) e(`${p}.strength`, "weak with a success step: declare asserted");
      if (v.strength === "asserted" && !(Array.isArray(v.requires) && v.requires.includes("optional:authorised"))) e(`${p}.requires`, "an asserted-success vector requires optional:authorised (authorisation decides whether the request succeeds)");
      for (const x of answeredSteps) if (x.expect.followOn !== undefined && !(Array.isArray(x.expect.followOn) && x.expect.followOn.every((c) => typeof c === "string"))) e(`${p}.steps`, "followOn: array of Type URIs");
      for (const x of answeredSteps) if (x.expect.acceptCodes !== undefined && !(Array.isArray(x.expect.acceptCodes) && x.expect.acceptCodes.every((c) => typeof c === "string"))) e(`${p}.steps`, "acceptCodes: array of strings");
    }
    for (const k of ["requires", "skipIfOptional", "mutants", "advisoryMutants"] as const) {
      if (v[k] !== undefined && (!Array.isArray(v[k]) || !(v[k] as unknown[]).every((s) => typeof s === "string"))) {
        e(`${p}.${k}`, "array of strings");
      }
    }
    if (Array.isArray(v.requires)) for (const r of v.requires) if (typeof r === "string") { const m = requireEntryProblem(r); if (m !== null) e(`${p}.requires`, m); }
    if (Array.isArray(v.skipIfOptional)) for (const o of v.skipIfOptional) if (typeof o === "string" && !(OPTIONAL_CAPABILITIES as readonly string[]).includes(o)) e(`${p}.skipIfOptional`, `unknown optional capability ${o} (see OPTIONAL_CAPABILITIES)`);
    if (v.tier === 2 && !(SUBGROUPS as readonly unknown[]).includes(v.subgroup)) e(`${p}.subgroup`, `a Tier 2 vector names its sub-group (${SUBGROUPS.join(", ")})`);
    if (v.tier === 1 && v.subgroup !== undefined) e(`${p}.subgroup`, "a Tier 1 vector has no sub-group");
    for (const k of ["exactClock", "profileWindow"] as const) if (v[k] !== undefined && typeof v[k] !== "boolean") e(`${p}.${k}`, "boolean");
    if (v.clockStart !== undefined && (typeof v.clockStart !== "string" || !ISO.test(v.clockStart))) e(`${p}.clockStart`, "RFC 3339 UTC");
    if (!Array.isArray(v.steps) || v.steps.length === 0) {
      e(`${p}.steps`, "non-empty array required");
      return;
    }
    v.steps.forEach((s: unknown, j: number) => {
      const sp = `${p}.steps[${j}]`;
      if (!isObject(s)) return e(sp, "not an object");
      if (s.at !== undefined && (typeof s.at !== "string" || !OFFSET.test(s.at))) e(`${sp}.at`, "offset like +5s");
      if (s.atAbsolute !== undefined && (typeof s.atAbsolute !== "string" || !ISO.test(s.atAbsolute))) e(`${sp}.atAbsolute`, "RFC 3339 UTC");
      if (s.when !== undefined && !(isObject(s.when) && typeof s.when.proposerApproves === "boolean" && Object.keys(s.when).length === 1)) e(`${sp}.when`, "{proposerApproves: boolean}");
      const hasSend = isObject(s.send);
      const hasVerify = isObject(s.verifyProof);
      const hasReceipt = isObject(s.verifyReceipt);
      const hasTrigger = isObject(s.trigger);
      const hasRestart = s.restart === true;
      const hasEmit = isObject(s.emit);
      const hasPushed = isObject(s.observePushed);
      if (s.quorum !== undefined) {
        if (!(QUORUM_PATTERNS as readonly unknown[]).includes(s.quorum)) e(`${sp}.quorum`, `one of ${QUORUM_PATTERNS.join(", ")}`);
        if (Object.keys(s).some((k) => k !== "quorum" && k !== "at" && !(k === "expect" && s.quorum === "begin"))) e(sp, "a quorum step has no member but quorum and at (and expect, for begin)");
        return;
      }
      if (Number(hasSend) + Number(hasVerify) + Number(hasReceipt) + Number(hasTrigger) + Number(hasRestart) + Number(hasEmit) + Number(hasPushed) !== 1) e(sp, "exactly one of send / verifyProof / verifyReceipt / trigger / restart / emit / observePushed required");
      if (hasPushed) {
        const op = s.observePushed as Record<string, unknown>;
        for (const k of ["to", "type", "threadId"]) if (op[k] !== undefined && (typeof op[k] !== "string" || op[k] === "")) e(`${sp}.observePushed.${k}`, "non-empty string");
        if (op.none !== undefined && typeof op.none !== "boolean") e(`${sp}.observePushed.none`, "boolean");
        if (op.count !== undefined && (!Number.isInteger(op.count) || (op.count as number) < 1 || op.none === true)) e(`${sp}.observePushed.count`, "positive integer, not with none");
        if (op.withinMs !== undefined && (!Number.isInteger(op.withinMs) || (op.withinMs as number) < 0 || (op.withinMs as number) > 60000)) e(`${sp}.observePushed.withinMs`, "whole milliseconds, 0 to 60000");
        for (const k of ["pointer", "match"]) if (op[k] !== undefined && (!isObject(op[k]) || op.none === true)) e(`${sp}.observePushed.${k}`, "object, not with none");
        if (op.to === undefined && op.type === undefined && op.threadId === undefined) e(`${sp}.observePushed`, "at least one of to / type / threadId");
        return;
      }
      if (hasEmit && typeof (s.emit as Record<string, unknown>).type !== "string") e(`${sp}.emit.type`, "required string");
      if (hasTrigger && typeof (s.trigger as Record<string, unknown>).action !== "string") e(`${sp}.trigger.action`, "required string");
      if (hasSend) {
        const send = s.send as Record<string, unknown>;
        const sources = ["template", "document", "raw", "same"].filter((k) => send[k] !== undefined);
        if (sources.length !== 1) e(`${sp}.send`, "exactly one of template / document / raw / same required");
        if (send.same !== undefined && send.same !== "previous") e(`${sp}.send.same`, 'only "previous" is defined');
        if (send.mutate !== undefined) {
          if (!Array.isArray(send.mutate)) e(`${sp}.send.mutate`, "array");
          else
            send.mutate.forEach((m: unknown, k: number) => {
              if (!isObject(m) || !(MUTATION_OPS as readonly string[]).includes(String(m.op))) e(`${sp}.send.mutate[${k}].op`, `one of ${MUTATION_OPS.join(", ")}`);
              else if ((m.op === "set" || m.op === "remove") && typeof m.path !== "string") e(`${sp}.send.mutate[${k}].path`, "JSON pointer required");
            });
        }
      }
      if (hasReceipt) {
        const vr = s.verifyReceipt as Record<string, unknown>;
        const outcomes = isObject(vr.expect) ? (Array.isArray(vr.expect.outcome) ? vr.expect.outcome : [vr.expect.outcome]) : [];
        if (!isObject(vr.scenario)) e(`${sp}.verifyReceipt.scenario`, "required object");
        if (outcomes.length === 0 || !outcomes.every((o) => (RECEIPT_OUTCOMES as readonly unknown[]).includes(o))) e(`${sp}.verifyReceipt.expect.outcome`, `one or more of ${RECEIPT_OUTCOMES.join(", ")}`);
      } else if (hasVerify) {
        const vp = s.verifyProof as Record<string, unknown>;
        if (typeof vp.file !== "string") e(`${sp}.verifyProof.file`, "required");
        if (vp.expect !== "valid" && vp.expect !== "invalid") e(`${sp}.verifyProof.expect`, "valid | invalid");
      } else if ((hasTrigger || hasRestart) && s.expect === undefined) {
        /* a trigger that only sets the IUT up has nothing to assert */
      } else {
        if (!isObject(s.expect)) return e(`${sp}.expect`, "required");
        const ex = s.expect;
        if (!(DISPOSITIONS as readonly string[]).includes(String(ex.disposition))) e(`${sp}.expect.disposition`, `one of ${DISPOSITIONS.join(", ")}`);
        if (ex.code !== undefined && typeof ex.code !== "string" && !(Array.isArray(ex.code) && ex.code.every((c) => typeof c === "string"))) e(`${sp}.expect.code`, "string or string[]");
        if (ex.sameErrorAs !== undefined && (!Number.isInteger(ex.sameErrorAs) || (ex.sameErrorAs as number) < 1 || (ex.sameErrorAs as number) > j)) e(`${sp}.expect.sameErrorAs`, "1-based index of an earlier step");
        if ((ex.disposition === "answered" || ex.disposition === "emitted") && typeof ex.plainType !== "string") e(`${sp}.expect.plainType`, "required for disposition answered");
        if (ex.disposition === "error" && ex.code === undefined) e(`${sp}.expect.code`, "required for disposition error");
      }
    });
  });
  return errs;
}

/** Cross-file rules, applied by the loader after every file is individually valid. */
export function checkNonVacuityDeclarations(file: VectorFile): string[] {
  const errs: string[] = [];
  for (const v of file.vectors) {
    const negative = v.steps.some(
      (s) => s.expect !== undefined && ["error", "silence", "any-refusal"].includes(s.expect.disposition),
    ) || v.steps.some((s) => s.verifyProof?.expect === "invalid") || v.steps.some((s) => s.verifyReceipt !== undefined && !receiptExpectsComplete(s.verifyReceipt.expect.outcome));
    if (negative && (v.mutants === undefined || v.mutants.length === 0) && v.clarify === null && v.retired === undefined) { // a retired vector is a tombstone: never run, so no mutant is needed
      errs.push(`${v.id}: negative vector declares no mutant (non-vacuity requires at least one)`);
    }
  }
  return errs;
}
