// SPDX-License-Identifier: Apache-2.0
// Vector completeness over the VTI and keyring-wallet scope (src/coverage/completeness.ts). Read-only; runs no platform.
//   node scripts/vector-completeness.ts scope <coverage-matrix dir> <out scope.json>     (matrix.json and kw-participation.json from `npm run coverage-matrix`)
//   node scripts/vector-completeness.ts report <scope.json> <matrix.json> [--out file.md] [--json file.json] [--exclude-set complete] [--after]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyse, deriveScope, loadVecRows, renderReport, type CeremonyStepInfo, type Scope } from "../src/coverage/completeness.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, a, b] = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
if (cmd === "scope" && a && b) {
  const m = JSON.parse(readFileSync(join(a, "matrix.json"), "utf8"));
  const k = JSON.parse(readFileSync(join(a, "kw-participation.json"), "utf8"));
  writeFileSync(b, JSON.stringify(deriveScope(m.tasks, k.rows, m.inputs as Record<string, string>), null, 1) + "\n");
} else if (cmd === "report" && a && b) {
  const scope = JSON.parse(readFileSync(a, "utf8")) as Scope;
  const m = JSON.parse(readFileSync(b, "utf8")) as { inputs?: Record<string, string>; ceremonies: { id: string; steps: { id: string; type: string; covered: boolean }[] }[] };
  const steps: CeremonyStepInfo[] = m.ceremonies.flatMap((c) => c.steps.map((s) => ({ ceremony: c.id, step: s.id, type: s.type.replace(/#.*$/, ""), covered: s.covered })));
  const rep = analyse(scope, loadVecRows(root, flag("exclude-set") ? [flag("exclude-set")!] : []), steps, m.ceremonies.map((c) => c.id));
  if (flag("json")) writeFileSync(flag("json")!, JSON.stringify(rep, null, 1) + "\n");
  // the footer names the inputs of the scope AND of the matrix the ceremony figures were read from (F-14)
  const md = renderReport(rep, null, { ...scope.inputs, ...Object.fromEntries(Object.entries(m.inputs ?? {}).map(([k, v]) => [`ceremony matrix: ${k}`, v])) });
  if (flag("out")) writeFileSync(flag("out")!, md); else process.stdout.write(md);
} else { console.error("usage: see the header of this file"); process.exit(2); }
