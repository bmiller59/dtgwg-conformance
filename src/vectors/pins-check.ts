// SPDX-License-Identifier: Apache-2.0
// One agreed task-force commit: every generator input that records which commit of the Trust Tasks repository it was read at must record the same one.
// The manifest (vectors/tf-manifest.json, `main`) names it; the kit pin, the invalid-example snapshot, the gap snapshot, the completion extras, the scope
// inputs, the spec-hash table and the imported fixtures' provenance must agree with it. A commit may be written in full or as an unambiguous prefix of at
// least 9 characters (the scope inputs record 9). A missing commit (null) is a disagreement: a pin that is not recorded cannot be checked.
import { loadPins, type PinFact } from "../tfalign/suite.ts";

export interface PinProblem { source: string; commit: string | null; expected: string; why: string }
export interface PinReport { expected: string; pins: PinFact[]; problems: PinProblem[] }

/** Whether two commit ids name the same commit (one may be a prefix, at least 9 characters, of the other). */
export function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (!/^[0-9a-f]{9,40}$/.test(x) || !/^[0-9a-f]{9,40}$/.test(y)) return false;
  return x.startsWith(y) || y.startsWith(x);
}

export function checkPins(suiteRoot: string): PinReport {
  const pins = loadPins(suiteRoot);
  const main = pins.find((p) => p.source === "vectors/tf-manifest.json (main)");
  const expected = main?.commit ?? "";
  const problems: PinProblem[] = [];
  if (main === undefined || main.commit === null || !/^[0-9a-f]{40}$/.test(main.commit)) problems.push({ source: "vectors/tf-manifest.json (main)", commit: main?.commit ?? null, expected: "a full 40-character commit", why: "the manifest does not name a full commit" });
  for (const p of pins) {
    if (p === main) continue;
    if (p.commit === null) problems.push({ source: p.source, commit: null, expected, why: "no commit recorded" });
    else if (!sameCommit(p.commit, expected)) problems.push({ source: p.source, commit: p.commit, expected, why: "records a different commit than the manifest's main" });
  }
  return { expected, pins, problems };
}

export function formatPinReport(r: PinReport): string {
  const L = [`pins: ${r.pins.length} recorded, agreed commit ${r.expected.slice(0, 9)}`];
  for (const p of r.pins) L.push(`  ${p.commit === null ? "(none)".padEnd(9) : p.commit.slice(0, 9)}  ${p.source}`);
  for (const q of r.problems) L.push(`DISAGREE ${q.source}: ${q.why} (${q.commit === null ? "none" : q.commit.slice(0, 9)}, expected ${q.expected.slice(0, 9)})`);
  return L.join("\n");
}
