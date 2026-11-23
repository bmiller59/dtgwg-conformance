// SPDX-License-Identifier: Apache-2.0
// Rendering of governance findings (docs/17): a separate advisory section, never part of the gating totals, no colour, no order other
// than alphabetical by platform name.
import { GOV_KINDS, GOV_KIND_LABEL, GOV_KIND_MEANING } from "./findings.ts";
import type { GovKind } from "./findings.ts";
import type { GovRun } from "./probes.ts";

export const GOV_BANNER =
  "Governance (advisory). These findings report only whether a governance declaration could be given to a platform and whether the platform applied it. " +
  "Governance is the end user's choice and is never decided by this suite; a finding makes no statement about whether any governance, declared or observed, is appropriate. " +
  "They are not an endorsement of any specification, are not part of the gating counts, any headline total or the exit code, and the platforms are listed alphabetically with no order of merit.";

export interface EvidenceRow {
  id: string;
  platform: string;
  commit: string;
  file: string;
  line: string;
  what: string;
  declarationPath: "none" | "partial" | "yes" | "n/a";
  specLevel: "platform" | "spec" | "both";
  kind: "fixed" | "default" | "mechanics" | "spec";
  verified: "V";
  auditedOn: string;
}

export interface EvidenceFile {
  format: string;
  notATestResult: true;
  auditedOn: string;
  note: string;
  rows: EvidenceRow[];
}

export const countsOf = (run: GovRun): Record<GovKind, number> => {
  const c = Object.fromEntries(GOV_KINDS.map((k) => [k, 0])) as Record<GovKind, number>;
  for (const f of run.findings) c[f.kind]++;
  return c;
};

/** The cell text for the advisory column. */
export function cellText(run: GovRun): string {
  const c = countsOf(run);
  return GOV_KINDS.filter((k) => c[k] > 0).map((k) => `${GOV_KIND_LABEL[k]} ${c[k]}`).join(" / ") || "no probes";
}

const byName = (a: GovRun, b: GovRun): number => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0);

export function governanceMarkdown(runs: GovRun[], evidence?: EvidenceFile): string {
  const sorted = [...runs].sort(byName);
  const out: string[] = ["# Governance (advisory)", "", `> ${GOV_BANNER}`, "", "## Finding kinds", ""];
  for (const k of GOV_KINDS) out.push(`- \`${k}\` (${GOV_KIND_LABEL[k]}): ${GOV_KIND_MEANING[k]}`);
  out.push("", "## Governance (advisory) column", "", "| Platform | Governance (advisory) |", "|---|---|");
  for (const r of sorted) out.push(`| ${r.platform} | ${cellText(r)} |`);
  for (const r of sorted) {
    out.push("", `## ${r.platform}`, "", "| Probe | Channel | Finding | Detail |", "|---|---|---|---|");
    for (const f of r.findings) out.push(`| ${f.probe}: ${f.title} | ${f.channel} | ${f.kind} | ${f.text.replace(/\|/g, "\\|")} |`);
  }
  if (evidence !== undefined) out.push("", evidenceMarkdown(evidence));
  return out.join("\n") + "\n";
}

export function evidenceMarkdown(e: EvidenceFile): string {
  const out: string[] = ["## Static governance evidence (not a test result)", "", `Read from the code on ${e.auditedOn}, never executed. ${e.note}`, "", "| Platform | Id | Location | What is stated in the code | Declaration path | Level |", "|---|---|---|---|---|---|"];
  const rows = [...e.rows].sort((a, b) => (a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : a.id < b.id ? -1 : 1));
  for (const r of rows) out.push(`| ${r.platform} | ${r.id} | \`${r.file}:${r.line}\` (${r.commit}) | ${r.what.replace(/\|/g, "\\|")} | ${r.declarationPath} | ${r.specLevel} |`);
  return out.join("\n");
}

export function governanceJson(runs: GovRun[], channelsNote = "all findings advisory"): unknown {
  return {
    format: "tt-governance-advisory/0.1",
    advisory: true,
    note: GOV_BANNER,
    scope: channelsNote,
    platforms: [...runs].sort(byName).map((r) => ({ platform: r.platform, salt: r.salt, counts: countsOf(r), findings: r.findings })),
  };
}
