// SPDX-License-Identifier: Apache-2.0
// Registry promotion (docs/04 section 18.6 and 18.9, docs/33). The hand input is vectors-src/promotions.json; every vector generator
// that makes promotable vectors runs applyPromotions over its files after the vectors are built. The promotion is a tag edit only: channel
// to `registry`, the suite-defined `profile` (proposed only) removed, and a `source.promotion` record added. Steps, expectations and ids
// never change, and `tfRef` is kept. Demotion is the same edit the other way: delete the id from the file (or set the amended rule off)
// and regenerate.
//
// The amended two-surface rule (decision D353, PROVISIONAL until the project owner confirms): for a task only one implementation serves,
// the reference adapter (oracle) and the VTI in-process host count as the two surfaces of docs/04 18.9 item 3. Vectors promoted on that
// basis carry `rule: "single-implementer"` and `provisional: true`, and are listed in `amendedRule.enabled`'s scope: setting
// `amendedRule.enabled` to false returns every one of them to its former channel, so the amendment is reversible in one edit.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Vector, VectorFile } from "./types.ts";

export const PROMOTION_FORMAT = "tt-conformance-promotions/0.1";
export const PROMOTION_RULES = ["standard", "single-implementer"] as const;
export type PromotionRule = (typeof PROMOTION_RULES)[number];

export interface PromotionBatch {
  /** YYYY-MM-DD of the promotion commit's review. */
  date: string;
  /** Repository path (with anchor) of the review record: template, sample, findings. */
  record: string;
  /** Vector ids by the rule that let them gate. */
  ids: Record<PromotionRule, string[]>;
}
export interface PromotionFile {
  format: typeof PROMOTION_FORMAT;
  note: string;
  amendedRule: { enabled: boolean; decision: string; status: "provisional" | "confirmed"; label: string; text: string };
  batches: Record<string, PromotionBatch>;
}

/** What a promoted vector records in `source.promotion` (the former tags are kept so a demotion is exact). */
export interface PromotionRecord {
  batch: string;
  rule: PromotionRule;
  /** True while the rule it relies on is provisional (D353). */
  provisional: boolean;
  decision?: string;
  was: { channel: string; profile?: string };
}

export function loadPromotions(root: string): PromotionFile {
  const f = JSON.parse(readFileSync(join(root, "vectors-src", "promotions.json"), "utf8")) as PromotionFile;
  const p = promotionProblems(f);
  if (p.length > 0) throw new Error(`vectors-src/promotions.json:\n  ${p.join("\n  ")}`);
  return f;
}

export function promotionProblems(f: PromotionFile): string[] {
  const p: string[] = [];
  if (f.format !== PROMOTION_FORMAT) p.push(`format must be ${PROMOTION_FORMAT}`);
  if (typeof f.amendedRule?.enabled !== "boolean" || typeof f.amendedRule.decision !== "string" || !["provisional", "confirmed"].includes(f.amendedRule.status)) p.push("amendedRule needs enabled (boolean), decision and status (provisional or confirmed)");
  const seen = new Map<string, string>();
  for (const [b, batch] of Object.entries(f.batches ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.date ?? "")) p.push(`${b}: date must be YYYY-MM-DD`);
    if (typeof batch.record !== "string" || batch.record === "") p.push(`${b}: record (path of the review record) required`);
    for (const rule of PROMOTION_RULES) {
      for (const id of batch.ids?.[rule] ?? []) {
        if (seen.has(id)) p.push(`${id}: listed in ${seen.get(id)} and ${b}`);
        seen.set(id, b);
      }
    }
  }
  return p;
}

/** id -> {batch, rule} for the vectors that are promoted under the file as it stands (amended-rule vectors drop out when the rule is off). */
export function activePromotions(f: PromotionFile): Map<string, { batch: string; rule: PromotionRule }> {
  const out = new Map<string, { batch: string; rule: PromotionRule }>();
  for (const [b, batch] of Object.entries(f.batches)) {
    for (const rule of PROMOTION_RULES) {
      if (rule === "single-implementer" && !f.amendedRule.enabled) continue;
      for (const id of batch.ids[rule] ?? []) out.set(id, { batch: b, rule });
    }
  }
  return out;
}

/**
 * Applies the promotions to the vectors of `files` (in place) and returns the ids it promoted. Refuses a listed id that is not in
 * `files` only when `strict` (a generator sees one family; the loader test sees them all), and a vector that is not advisory
 * (`proposed` or `candidate`) or has no `tfRef` or is CLARIFY, retired, excluded or synthetic: such a vector cannot gate (docs/04 18.9).
 */
export function applyPromotions(files: Iterable<VectorFile>, f: PromotionFile): string[] {
  const active = activePromotions(f);
  const done: string[] = [];
  for (const file of files) {
    file.vectors = file.vectors.map((v: Vector) => {
      const a = active.get(v.id);
      if (a === undefined) return v;
      const src = v.source as unknown as Record<string, unknown>;
      const channel = String(src.channel);
      const problems: string[] = [];
      if (channel !== "proposed" && channel !== "candidate") problems.push(`channel ${channel} (only proposed or candidate is promoted)`);
      if (src.tfRef === undefined) problems.push("no tfRef");
      if (v.clarify !== null) problems.push("CLARIFY");
      const raw = v as unknown as Record<string, unknown>;
      if (raw.excludedFromRun !== undefined || raw.synthetic === true || raw.retired !== undefined || raw.probe === true) problems.push("excluded, synthetic, retired or probe");
      if (problems.length > 0) throw new Error(`cannot promote ${v.id}: ${problems.join("; ")}`);
      const was: PromotionRecord["was"] = { channel, ...(typeof src.profile === "string" ? { profile: src.profile } : {}) };
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(src)) {
        if (k === "channel") out.channel = "registry";
        else if (k === "profile" || k === "candidate" || k === "promotion") continue;
        else if (k === "note") out.note = `${String(val)} Promoted to the registry channel in batch ${a.batch} (${a.rule === "single-implementer" ? `single implementer, ${f.amendedRule.status === "confirmed" ? "confirmed" : "provisional"} rule ${f.amendedRule.decision}` : "standard rule"}); see docs/33.`;
        else out[k] = val;
      }
      out.promotion = { batch: a.batch, rule: a.rule, provisional: a.rule === "single-implementer" && f.amendedRule.status === "provisional", ...(a.rule === "single-implementer" ? { decision: f.amendedRule.decision } : {}), was } satisfies PromotionRecord;
      done.push(v.id);
      return { ...v, source: out } as unknown as Vector;
    });
  }
  return done;
}
