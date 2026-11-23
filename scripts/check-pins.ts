// SPDX-License-Identifier: Apache-2.0
// Fails (exit 1) when the task-force commits the suite's generators recorded do not agree (src/vectors/pins-check.ts). Offline; reads committed files only.
//   npm run check:pins
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPins, formatPinReport } from "../src/vectors/pins-check.ts";

const r = checkPins(join(dirname(fileURLToPath(import.meta.url)), ".."));
console.log(formatPinReport(r));
process.exit(r.problems.length === 0 ? 0 : 1);
