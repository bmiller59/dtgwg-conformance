// SPDX-License-Identifier: Apache-2.0
// Seed the harness actors into the VTC's ACL (see src/adapters/vti/seed.ts for why). Run from anywhere:
//   node --experimental-strip-types scripts/vti-seed-acl.ts <compose-project-dir> [--dry-run]
import { spawnSync } from "node:child_process";
import { seedSteps } from "../src/adapters/vti/seed.ts";

const [dir, flag] = process.argv.slice(2);
if (dir === undefined || (flag !== undefined && flag !== "--dry-run")) {
  console.error("usage: vti-seed-acl.ts <compose-project-dir> [--dry-run]");
  process.exit(2);
}
for (const step of seedSteps()) {
  console.log(`${step.cmd} ${step.args.join(" ")}`);
  if (flag === "--dry-run") continue;
  const r = spawnSync(step.cmd, step.args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`failed (exit ${String(r.status)})`);
    process.exit(1);
  }
}
