// SPDX-License-Identifier: Apache-2.0
// Usage: node --experimental-strip-types src/crosscheck/cli.ts --adapter <spec> [--adapter <spec> ...] [--vti <checkout>] [--out <dir>] [--timeout <ms>]
// Adapter specs are the suite's (stdio:<command>, http:<url>, reference). --vti names a VTI checkout at the pinned commit: the console fixture is then checked byte for byte against the copy in cases.ts.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rpcAdapterFromSpec } from "../adapter/client.ts";
import type { Adapter } from "../adapter/contract.ts";
import { ReferenceAdapter } from "../adapters/reference/reference.ts";
import { CONSOLE_FIXTURE_FILE, CONSOLE_FIXTURE_SHA256, VTI_REF } from "./cases.ts";
import { markdown, runCrossCheck, summary } from "./run.ts";
import { bundleOverlap, bundleOverlapMarkdown } from "./bundles.ts";
import { buildToolProvenance } from "../runner/provenance.ts";

const args = process.argv.slice(2);
const take = (flag: string): string[] => args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));
const specs = take("--adapter");
const vti = take("--vti")[0];
const out = take("--out")[0];
const timeoutMs = Number(take("--timeout")[0] ?? 60000);
if (specs.length === 0) {
  console.error("need at least one --adapter");
  process.exit(2);
}
if (vti !== undefined) {
  const sha = createHash("sha256").update(readFileSync(join(vti, CONSOLE_FIXTURE_FILE))).digest("hex");
  if (sha !== CONSOLE_FIXTURE_SHA256) {
    console.error(`the VTI checkout's ${CONSOLE_FIXTURE_FILE} differs from the pinned copy (expected ${CONSOLE_FIXTURE_SHA256} at ${VTI_REF}, got ${sha})`);
    process.exit(2);
  }
}
const runs = [];
let overlap = "";
for (const spec of specs) {
  const adapter: Adapter = spec === "reference" ? new ReferenceAdapter() : rpcAdapterFromSpec(spec, { timeoutMs });
  try {
    const run = await runCrossCheck(adapter);
    runs.push(run);
    const s = summary(run);
    console.log(`${run.implementation}: agree ${s.agree}, disagree ${s.disagree}, not run ${s.notRun}`);
    for (const r of run.results) if (r.verdict !== "AGREE") console.log(`  ${r.verdict} ${r.id}: VTI expects ${r.vtiExpects}, implementation ${r.got} (${r.detail})`);
    if (vti !== undefined) overlap += bundleOverlapMarkdown(run.implementation, bundleOverlap(vti, (await adapter.capabilities()).supportedTypes));
  } finally {
    await (adapter as { close?: () => Promise<void> }).close?.();
  }
}
if (out !== undefined) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "crosscheck.json"), JSON.stringify(runs, null, 2) + "\n");
  writeFileSync(join(out, "crosscheck.md"), markdown(runs) + (overlap === "" ? "" : "\n" + overlap));
  const root = fileURLToPath(new URL("../..", import.meta.url));
  writeFileSync(join(out, "run.json"), JSON.stringify(buildToolProvenance({ root, tool: "crosscheck", argv: args }), null, 2) + "\n");
}
