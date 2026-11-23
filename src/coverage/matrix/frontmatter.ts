// SPDX-License-Identifier: Apache-2.0
// Minimal reader for the YAML front matter of a spec.md (top-level scalar keys only).

export function parseFrontMatter(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === "---") break;
    const m = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] as string).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1] as string] = v;
  }
  return out;
}

/** Maturity value of a spec: the `status` field, or `unspecified` (never guessed). */
export function maturityOf(fm: Record<string, string>): string {
  const s = fm["status"];
  return s && s.length > 0 ? s : "unspecified";
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
