// SPDX-License-Identifier: Apache-2.0
// Command line: node --experimental-strip-types src/governance/cli.ts [options]   (npm run governance -- ...)
//   --adapter <spec>   reference | reference-governance | governance-mutant:<id>[,<id>] | module:<path> | stdio:<command> | http:<url>. Repeatable.
//   --probes <dir>     default ./vectors/governance
//   --out <dir>        write governance-advisory.json and governance-advisory.md here (default: print)
//   --salt <s>         run salt for the nonce names (default random; give one to reproduce a run)
//   --evidence <file>  static evidence data to append (default ./results/governance-evidence.json when it exists)
//   --timeout <ms>     per-call timeout for out-of-process adapters (default 30000)
// The exit code is 0 whatever the findings are: governance findings are advisory and never gate.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rpcAdapterFromSpec } from "../adapter/client.ts";
import type { Adapter } from "../adapter/contract.ts";
import { ReferenceAdapter } from "../adapters/reference/reference.ts";
import { loadProbes, runGovernance } from "./probes.ts";
import type { GovRun } from "./probes.ts";
import { governanceJson, governanceMarkdown } from "./report.ts";
import type { EvidenceFile } from "./report.ts";
import { buildToolProvenance } from "../runner/provenance.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function makeAdapter(spec: string, timeoutMs?: number): Promise<Adapter> {
  if (/^(stdio|https?):/.test(spec)) return rpcAdapterFromSpec(spec, timeoutMs === undefined ? {} : { timeoutMs });
  if (spec === "reference") return new ReferenceAdapter();
  if (spec === "reference-governance") return new ReferenceAdapter({ governance: true });
  if (spec.startsWith("governance-mutant:")) return new ReferenceAdapter({ governanceMutants: spec.slice(18).split(",") });
  if (spec.startsWith("module:")) {
    const mod = (await import(pathToFileURL(resolve(spec.slice(7))).href)) as { createAdapter?: () => Adapter | Promise<Adapter> };
    if (typeof mod.createAdapter !== "function") throw new Error("module must export createAdapter()");
    return mod.createAdapter();
  }
  throw new Error(`unknown adapter spec ${spec}`);
}

async function main(argv: string[]): Promise<number> {
  const adapters: string[] = [];
  let probesDir = join(root, "vectors", "governance");
  let out: string | undefined;
  let salt: string | undefined;
  let evidencePath = join(root, "results", "governance-evidence.json");
  let timeoutMs: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--adapter") adapters.push(next());
    else if (a === "--probes") probesDir = resolve(next());
    else if (a === "--out") out = resolve(next());
    else if (a === "--salt") salt = next();
    else if (a === "--evidence") evidencePath = resolve(next());
    else if (a === "--timeout") timeoutMs = Number(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (adapters.length === 0) adapters.push("reference", "reference-governance");
  const probes = loadProbes(probesDir);
  const runs: GovRun[] = [];
  for (const spec of adapters) {
    const adapter = await makeAdapter(spec, timeoutMs);
    try {
      runs.push(await runGovernance({ adapter, probes, ...(salt === undefined ? {} : { salt }) }));
    } finally {
      const c = (adapter as { close?: () => Promise<void> }).close;
      if (typeof c === "function") await c.call(adapter);
    }
  }
  for (const r of runs) {
    for (const f of r.findings) console.log(`ADVISORY ${r.platform} ${f.probe} ${f.kind}: ${f.kind === "GOV-NOT-PROBED" ? f.reason ?? "" : f.observed}`);
  }
  const evidence = existsSync(evidencePath) ? (JSON.parse(readFileSync(evidencePath, "utf8")) as EvidenceFile) : undefined;
  const md = governanceMarkdown(runs, evidence);
  if (out === undefined) console.log("\n" + md);
  else {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "governance-advisory.json"), JSON.stringify(governanceJson(runs), null, 2) + "\n");
    writeFileSync(join(out, "governance-advisory.md"), md);
    writeFileSync(join(out, "run.json"), JSON.stringify(buildToolProvenance({ root, tool: "governance", argv }), null, 2) + "\n");
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error((err as Error).message);
    process.exit(2);
  },
);
