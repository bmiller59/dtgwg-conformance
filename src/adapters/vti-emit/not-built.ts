// SPDX-License-Identifier: Apache-2.0
// Evidence for every emit type VTI's client builders do not build (written by scripts/survey-vti-emit.ts from the pinned VTI checkout).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cited } from "../../adapter/contract.ts";

/** The VTI ref the survey read (scripts/survey-vti-emit.ts over the pinned checkout). */
const SURVEY_REF = "26d0da81";
/** Cited (docs/04 section 8): every entry comes from the source survey of VTI's client builders. */
export const NOT_BUILT = cited(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "not-built.json"), "utf8")) as Record<string, string>, `VTI ${SURVEY_REF}: survey of VTI's client builders and the type constants they use (scripts/survey-vti-emit.ts over the pinned checkout; src/adapters/vti-emit/not-built.json)`);
