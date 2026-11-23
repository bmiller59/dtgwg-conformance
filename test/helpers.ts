// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasRuns, resultsDir } from "../src/results-dir.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VECTORS = join(ROOT, "vectors");
export const FIXTURES = join(VECTORS, "imported");

/** A temporary directory under the OS temp dir; tests never touch the real HOME or the repository tree. */
export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "ttc-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * The results directory (src/results-dir.ts) and whether it holds run folders. Run records are kept outside this repository
 * (docs/04 section 21): a test that reads them passes `NEEDS_RUNS` as its options, so it skips with a clear message when
 * SUITE_RESULTS_DIR is unset or empty and runs against the named directory when it is set.
 */
export const RESULTS = resultsDir(ROOT);
export const HAVE_RUNS = hasRuns(RESULTS);
export const NEEDS_RUNS: { skip?: string } = HAVE_RUNS ? {} : { skip: `no run folders at ${RESULTS}/runs; set SUITE_RESULTS_DIR to a results directory to run this` };
