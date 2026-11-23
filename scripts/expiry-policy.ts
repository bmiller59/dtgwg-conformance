// SPDX-License-Identifier: Apache-2.0
// Applies exceptions/expiry-policy.json to exceptions/exceptions.json: every entry's `expires` becomes the date the policy gives its
// implementation key. Run by npm run regen.
// Usage: node --experimental-strip-types scripts/expiry-policy.ts [--check]
//   --check  writes nothing and exits 1 when an entry's expiry differs from the policy.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expiryMismatches, loadExpiryPolicy, policyExpiry } from "../src/vectors/expiry-policy.ts";
import type { ExceptionsFile } from "../src/vectors/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "exceptions", "exceptions.json");
const file = JSON.parse(readFileSync(path, "utf8")) as ExceptionsFile;
const policy = loadExpiryPolicy(root);
if (process.argv.includes("--check")) {
  const bad = expiryMismatches(policy, file.exceptions);
  if (bad.length > 0) { console.error(`exceptions differ from exceptions/expiry-policy.json (run npm run regen):\n  ${bad.join("\n  ")}`); process.exit(1); }
} else {
  for (const e of file.exceptions) e.expires = policyExpiry(policy, e.impl);
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}
