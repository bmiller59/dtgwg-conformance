// SPDX-License-Identifier: Apache-2.0
// Appends every new vector id to vectors-src/id-ledger.json (src/vectors/ledger.ts). With --check writes nothing and exits 1 when the
// ledger is stale or an issued id has been deleted from vectors/.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEDGER_FILE, ledgerProblems, ledgerText, writeLedger } from "../src/vectors/ledger.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--check")) {
  const problems = ledgerProblems(root);
  let stale = false;
  try { stale = readFileSync(join(root, LEDGER_FILE), "utf8") !== ledgerText(root); } catch { stale = true; }
  for (const p of problems) console.error(p);
  process.exit(problems.length > 0 || stale ? 1 : 0);
}
writeLedger(root);
