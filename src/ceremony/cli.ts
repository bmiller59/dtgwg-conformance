// SPDX-License-Identifier: Apache-2.0
// The ceremony-scenario runner's own command line (docs/25). Not part of `npm run suite`; its exit code is its own and never the suite's.
//   npm run ceremony -- --participant P=reference --participant R=reference-peer [--scenarios <dir>] [--scenario FC-VRC-001] [--out <run folder>]
// Writes, with --out: scenario-result.json (every result, with the label), transcript.jsonl (every document as built, delivered and answered, with
// its SHA-256) and run.json (the participants, their capabilities and the suite revision). Exit code 0 when every scenario completed, ended as
// specified or was skipped; 1 when one failed, was incomplete or inconclusive; 2 on a usage error.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAdapter } from "../runner/adapters.ts";
import { loadScenarios } from "./scenario.ts";
import { carrierOf, runScenarios } from "./runner.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const specs: Record<string, string> = {};
const only: string[] = [];
let dir = join(root, "vectors", "ceremony-scenarios");
let out: string | undefined;
let today = new Date().toISOString().slice(0, 10);
let reuse = false;
const adapterTimeoutMs = Number(process.env.CEREMONY_ADAPTER_TIMEOUT_MS ?? 120000);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  const v = argv[i + 1];
  if (a === "--participant" && v !== undefined) { const m = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/.exec(v); if (m === null) { console.error("--participant NAME=<adapter spec>"); process.exit(2); } specs[m[1]!] = m[2]!; i++; }
  else if (a === "--scenarios" && v !== undefined) { dir = resolve(v); i++; }
  else if (a === "--scenario" && v !== undefined) { only.push(v); i++; }
  else if (a === "--out" && v !== undefined) { out = resolve(v); i++; }
  else if (a === "--reuse") { reuse = true; }
  else if (a === "--date" && v !== undefined) { today = v; i++; }
  else if (a === "--reuse") { reuse = true; }
  else { console.error(`unknown or incomplete argument ${a}`); process.exit(2); }
}
if (Object.keys(specs).length === 0) { console.error("usage: npm run ceremony -- --participant P=<adapter spec> --participant R=<adapter spec> [--scenarios dir] [--scenario id] [--out dir] [--date YYYY-MM-DD] [--reuse]"); process.exit(2); }

const loaded = loadScenarios(dir);
// --reuse: one adapter process per participant for the whole run (a wallet's jest host takes a minute to start); each scenario still begins with the adapter's own `reset`.
const pool = new Map<string, Awaited<ReturnType<typeof makeAdapter>>>();
const make = async (slot: string) => {
  if (!reuse) return makeAdapter(specs[slot]!, adapterTimeoutMs);
  let a = pool.get(slot);
  if (a === undefined) { a = await makeAdapter(specs[slot]!, adapterTimeoutMs); pool.set(slot, a); }
  return new Proxy(a, { get: (t, k) => { const v = (t as unknown as Record<string | symbol, unknown>)[k]; return k === "close" ? undefined : typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v; } });
};
const run = await runScenarios(loaded.files.map((f) => f.file), { make, specs, today, ...(only.length === 0 ? {} : { only }) });
for (const a of pool.values()) { const c = (a as { close?: () => Promise<void> }).close; if (typeof c === "function") await c.call(a); }
for (const r of run.results) console.log(`${r.id}\t${r.status}${r.terminal === null ? "" : ` (${r.terminal})`}\t${r.reason}`);
console.log("These are outcomes of ceremonies run together, not conformance results: nothing here is counted.");
if (out !== undefined) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "scenario-result.json"), JSON.stringify({ format: "tt-ceremony-scenario-result/0.1", evidence: "complete-ceremony", countedAsConformance: false, date: today, participants: specs, results: run.results }, null, 2) + "\n");
  writeFileSync(join(out, "transcript.jsonl"), run.transcript.map((t) => JSON.stringify(t)).join("\n") + (run.transcript.length === 0 ? "" : "\n"));
  let rev = "unknown";
  try { rev = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  const caps: Record<string, unknown> = {};
  for (const [slot, spec] of Object.entries(specs)) { const a = await makeAdapter(spec, adapterTimeoutMs); try { caps[slot] = { spec, ...(await a.capabilities()) }; } finally { const c = (a as { close?: () => Promise<void> }).close; if (typeof c === "function") await c.call(a); } }
  writeFileSync(join(out, "run.json"), JSON.stringify({ format: "tt-ceremony-run/0.1", date: today, suiteRevision: rev, scenarioDir: "vectors/ceremony-scenarios", carrier: carrierOf(Object.values(caps).map((c) => (c as { mode?: string }).mode)), participants: caps }, null, 2) + "\n");
}
process.exit(run.results.some((r) => r.status === "failed" || r.status === "incomplete" || r.status === "inconclusive") ? 1 : 0);
