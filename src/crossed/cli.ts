// SPDX-License-Identifier: Apache-2.0
// Artifact-crossed replay (docs/14 section 7): feed the documents one implementation emitted into another implementation's receiver.
// Usage: node --experimental-strip-types src/crossed/cli.ts (--producer <spec> | --producer-run <dir>) --receiver <spec> --out <dir>
//   --producer <spec>      live: ask this adapter (optional capability `emit`) for one document of each Type URI it emits, addressed to
//                          the receiver (on real time when the receiver's clock cannot be set); the documents are written to <out>/produced.json so the replay can be repeated from the record
//   --producer-run <dir>   recorded: replay <dir>/produced.json (written by an earlier --producer run)
//   --receiver <spec>      the receiver adapter (any `--adapter` spec of src/runner/cli.ts)
//   --types <uri,uri>      only these Type URIs
//   --vectors <dir>        emit vector sets used to link each type to its emit vectors (repeatable; default vectors/emit and vectors/emit-more)
//   --timeout <ms>         per-call timeout for out-of-process adapters
//   --run <name>           the same as --out <results dir>/runs/<name> (src/results-dir.ts)
//   --results-dir <dir>    the results directory for --run (default $SUITE_RESULTS_DIR, else results-local/, which is git-ignored)
// Writes <out>/crossed.json, <out>/crossed.md and <out>/run.json. The exit code is 0 whatever the verdicts (nothing is judged), 2 on error.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_DIR_ENV, resultsDir, runName, runsDir } from "../results-dir.ts";
import { closeAdapter, makeAdapter } from "../runner/adapters.ts";
import { buildToolProvenance, redactDeep } from "../runner/provenance.ts";
import { loadSuite } from "../vectors/load.ts";
import { crossedMarkdown, emitVectorIndex, parseProduced, produceLive, receiverClockSettable, receiverVid, replay } from "./crossed.ts";
import type { Produced } from "./crossed.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function main(argv: string[]): Promise<number> {
  let producerSpec: string | undefined;
  let producerRun: string | undefined;
  let receiverSpec: string | undefined;
  let out: string | undefined;
  let runArg: string | undefined;
  let types: string[] | undefined;
  let timeoutMs: number | undefined;
  const vectorDirs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--producer") producerSpec = next();
    else if (a === "--producer-run") producerRun = resolve(next());
    else if (a === "--receiver") receiverSpec = next();
    else if (a === "--out") out = resolve(next());
    else if (a === "--run") runArg = runName(next());
    else if (a === "--results-dir") process.env[RESULTS_DIR_ENV] = resolve(next());
    else if (a === "--types") types = next().split(",").filter((t) => t !== "");
    else if (a === "--vectors") vectorDirs.push(resolve(next()));
    else if (a === "--timeout") timeoutMs = Number(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (runArg !== undefined) out = join(runsDir(resultsDir()), runArg);
  if ((producerSpec === undefined) === (producerRun === undefined)) throw new Error("give exactly one of --producer <spec> and --producer-run <dir>");
  if (receiverSpec === undefined || out === undefined) throw new Error("--receiver and one of --out and --run are required");
  const dirs = vectorDirs.length > 0 ? vectorDirs : [join(root, "vectors", "emit"), join(root, "vectors", "emit-more")];
  const emitIndex = emitVectorIndex(dirs.filter((d) => existsSync(join(d, "manifest.json"))).map((d) => loadSuite(d)));
  const receiver = await makeAdapter(receiverSpec, timeoutMs);
  try {
    let produced: Produced;
    if (producerRun !== undefined) {
      produced = parseProduced(JSON.parse(readFileSync(join(producerRun, "produced.json"), "utf8")));
      if (types !== undefined) produced = { ...produced, documents: produced.documents.filter((d) => types!.includes(d.type)) };
    } else {
      const to = await receiverVid(receiver);
      const realTime = !(await receiverClockSettable(receiver));
      const producer = await makeAdapter(producerSpec!, timeoutMs);
      try { produced = await produceLive(producerSpec!, producer, to, { ...(types === undefined ? {} : { types }), emitIndex, realTime }); } finally { await closeAdapter(producer); }
    }
    const result = await replay(receiverSpec, receiver, produced, producerRun === undefined ? "live" : "recorded");
    mkdirSync(out, { recursive: true });
    if (producerRun === undefined) writeFileSync(join(out, "produced.json"), JSON.stringify(redactDeep(produced, root), null, 2) + "\n");
    writeFileSync(join(out, "crossed.json"), JSON.stringify(redactDeep(result, root), null, 2) + "\n");
    writeFileSync(join(out, "crossed.md"), crossedMarkdown(result, produced.failed ?? []));
    writeFileSync(join(out, "run.json"), JSON.stringify({ ...buildToolProvenance({ root, tool: "crossed", argv }), evidence: result.evidence, producer: result.producer, receiver: result.receiver }, null, 2) + "\n");
    console.log(`${result.producer.name} -> ${result.receiver.name} (${result.evidence}, not demonstrated interoperation): ${JSON.stringify(result.totals)}${result.sameParty ? " [same party]" : ""}`);
    return 0;
  } finally {
    await closeAdapter(receiver);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e: unknown) => { console.error((e as Error).message); process.exit(2); });
}
