// SPDX-License-Identifier: Apache-2.0
// Per-vector comparison of two runs of the same vectors: the shim adapter row and the real-DIDComm row.
//   node --experimental-strip-types src/adapters/keyring-wallet-didcomm/compare.ts <shim results.json> <didcomm results.json> <tier> <out dir>
// KNOWN-FAIL (a failure the exceptions file explains; the DIDComm row declares platform keyring-wallet, so the same exceptions apply to it; runs recorded before that merge showed it as FAIL)  and FAIL
// are one class, "FAIL-class". A difference is a different class, or the same FAIL-class with different failing steps.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface R {
  id: string;
  status: string;
  reason?: string;
  failures?: string[];
  channel?: string;
}
type Run = { tier: number; results: R[] };

const [shimPath, dcPath, tierArg, outDir] = process.argv.slice(2);
if (shimPath === undefined || dcPath === undefined || tierArg === undefined || outDir === undefined) throw new Error("usage: compare.ts <shim> <didcomm> <tier> <out dir>");
const tier = Number(tierArg);
const pick = (p: string): Map<string, R> => {
  const runs = JSON.parse(readFileSync(p, "utf8")) as Run[];
  const run = runs.find((r) => r.tier === tier);
  if (run === undefined) throw new Error(`no tier ${tier} in ${p}`);
  return new Map(run.results.map((r) => [r.id, r]));
};
const cls = (s: string): string => (s === "KNOWN-FAIL" || s === "FAIL" ? "FAIL-class" : s);
const shim = pick(shimPath);
const dc = pick(dcPath);
const ids = [...new Set([...shim.keys(), ...dc.keys()])].sort();
const rows = ids.map((id) => {
  const a = shim.get(id);
  const b = dc.get(id);
  const sa = a?.status ?? "absent";
  const sb = b?.status ?? "absent";
  const norm = (f: string[]): string => f.join(" | ").replace(/urn:uuid:[0-9a-f-]+/g, "<id>").replace(/\bz[1-9A-HJ-NP-Za-km-z]{30,}/g, "<digest>");
  const failsA = norm(a?.failures ?? []);
  const failsB = norm(b?.failures ?? []);
  const kind = cls(sa) !== cls(sb) ? "class" : cls(sa) === "FAIL-class" && failsA !== failsB ? "failure-detail" : "same";
  return { id, shim: sa, didcomm: sb, kind, shimFailures: a?.failures ?? [], didcommFailures: b?.failures ?? [], shimReason: a?.reason ?? "", didcommReason: b?.reason ?? "" };
});
const count = (m: Map<string, R>): Record<string, number> => {
  const c: Record<string, number> = {};
  for (const r of m.values()) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
};
mkdirSync(outDir, { recursive: true });
const summary = { tier, vectors: ids.length, shimCounts: count(shim), didcommCounts: count(dc), differ: rows.filter((r) => r.kind === "class").length, differDetail: rows.filter((r) => r.kind === "failure-detail").length, same: rows.filter((r) => r.kind === "same").length };
writeFileSync(join(outDir, `diff-tier${tier}.json`), JSON.stringify({ summary, rows }, null, 2) + "\n");
const trans = new Map<string, string[]>();
for (const r of rows.filter((x) => x.kind === "class")) {
  const k = `${r.shim} -> ${r.didcomm}`;
  trans.set(k, [...(trans.get(k) ?? []), r.id]);
}
const md: string[] = [`# Tier ${tier}: shim vs real DIDComm, per vector`, "", `${ids.length} vectors. Same verdict class: ${summary.same}. Different class: ${summary.differ}. Same FAIL-class, different failing steps: ${summary.differDetail}.`, "", `Shim counts: ${JSON.stringify(summary.shimCounts)}. DIDComm counts: ${JSON.stringify(summary.didcommCounts)}.`, "", "## Class transitions (shim -> DIDComm)", ""];
for (const [k, v] of [...trans.entries()].sort((x, y) => y[1].length - x[1].length)) md.push(`- ${k}: ${v.length}`);
md.push("", "## Vectors whose verdict class differs", "", "| Vector | Shim | DIDComm | DIDComm failing steps |", "|---|---|---|---|");
for (const r of rows.filter((x) => x.kind === "class")) md.push(`| ${r.id} | ${r.shim} | ${r.didcomm} | ${(r.didcommFailures.join("; ") || r.didcommReason).replace(/\|/g, "/").slice(0, 200)} |`);
md.push("", "## Same FAIL-class, different failing steps", "", "| Vector | Shim failing steps | DIDComm failing steps |", "|---|---|---|");
for (const r of rows.filter((x) => x.kind === "failure-detail")) md.push(`| ${r.id} | ${r.shimFailures.join("; ").replace(/\|/g, "/").slice(0, 160)} | ${r.didcommFailures.join("; ").replace(/\|/g, "/").slice(0, 160)} |`);
writeFileSync(join(outDir, `diff-tier${tier}.md`), md.join("\n") + "\n");
console.log(JSON.stringify(summary));
