// SPDX-License-Identifier: Apache-2.0
// Run provenance (run.json): what was run, from which suite tree, vectors and exceptions, against which implementation version, on
// which date. Written by the command line beside results.json, so a run record does not rest on hand-written prose.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Capabilities } from "../adapter/contract.ts";
import type { EssentialRecord } from "./essential.ts";
import type { EssentialProbe } from "./honesty.ts";
import type { QuietPeriod } from "./quiet.ts";
import type { LoadedSuite } from "../vectors/load.ts";

export const RUN_FORMAT = "tt-conformance-run/0.2";

export interface RunProvenance {
  format: typeof RUN_FORMAT;
  /** The date exception expiry was judged against (YYYY-MM-DD), and whether it was pinned with `--today` or taken from the clock. */
  today: string;
  todaySource: "pinned" | "clock";
  /**
   * The suite tree the run came from: `HEAD` commit id (never a branch name), whether tracked files differed from it, and the suite
   * version from package.json (docs/04 section 20). A recorded run cites vector ids as `<version>/<id>`.
   */
  suite: { commit: string | null; dirty: boolean | null; version: string | null };
  /** One digest over every vector file the run loaded (sorted relative path and sha256 of each), plus the per-file digests. */
  vectors: { dir: string; digest: string; files: Record<string, string> };
  exceptions: { file: string; sha256: string } | null;
  /** The quarantine file of flaky vectors (docs/04 section 18.9), when one was read. */
  quarantine?: { file: string; sha256: string } | null;
  /** The adapters' own capabilities answers (name, version, pins, optional capabilities ...), one per `--adapter`. */
  /**
   * The adapters' own capabilities answers (and the essential governance E each declares, as resolved: source, authority set,
   * minApprovals, single-party; decision 39), with the adapter honesty check's outcome (src/runner/honesty.ts; from the first tier
   * run). Runs recorded before E was recorded have no `essentialGovernance`, and runs before the honesty check no `essentialProbe`.
   * `quietPeriod` is the minimum quiet period no-reply verdicts were held to (docs/04 section 3.3); absent on runs before the rule.
   */
  implementations: { spec: string; capabilities: Capabilities; essentialGovernance?: EssentialRecord; essentialProbe?: EssentialProbe; quietPeriod?: QuietPeriod }[];
  node: string;
  /** Command-line arguments, with absolute paths outside the suite tree replaced by `<path>`. */
  argv: string[];
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** `HEAD` of the suite tree and whether the tracked tree differs from it; null when the tree is not a git checkout. */
export function suiteCommit(root: string): Omit<RunProvenance["suite"], "version"> {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (head.status !== 0) return { commit: null, dirty: null };
  const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
  return { commit: head.stdout.trim(), dirty: st.status === 0 ? st.stdout.trim() !== "" : null };
}

/** The suite version (package.json `version`, semver); null when it cannot be read. */
export function suiteVersion(root: string): string | null {
  try {
    const v = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof v === "string" && v !== "" ? v : null;
  } catch {
    return null;
  }
}

/** A path for the record: relative when inside the suite tree, `<path>` otherwise (no local filesystem path is recorded). */
export function recordPath(p: string, root: string): string {
  if (!isAbsolute(p)) return p;
  const r = relative(root, p);
  return r === "" ? "." : r.startsWith("..") || isAbsolute(r) ? "<path>" : r;
}

/** Arguments with absolute paths (whole arguments, or embedded after `:` or `=` or a space) replaced. */
export function redactArgv(argv: string[], root: string): string[] {
  return argv.map((a) => a.replace(/(^|[\s:=])(\/(?!\/)[^\s:=]+)/g, (_m, pre: string, p: string) => `${pre}${recordPath(p, root)}`));
}

/** Every string in a JSON value passed through `redactArgv`'s path rule (adapters may report local paths in their capabilities). */
export function redactDeep<T>(v: T, root: string): T {
  return JSON.parse(JSON.stringify(v), (_k, x: unknown) => (typeof x === "string" ? redactArgv([x], root)[0] : x)) as T;
}

export function vectorDigest(suite: LoadedSuite, dir: string): RunProvenance["vectors"]["files"] {
  const files: Record<string, string> = {};
  for (const { path } of suite.files) files[relative(dir, path)] = sha256(readFileSync(path));
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function buildProvenance(opts: {
  root: string;
  today: string;
  pinned: boolean;
  suite: LoadedSuite;
  vectorsDir: string;
  exceptionsFile: string;
  quarantineFile?: string;
  implementations: RunProvenance["implementations"];
  argv: string[];
}): RunProvenance {
  const files = vectorDigest(opts.suite, opts.vectorsDir);
  const digest = sha256(Object.entries(files).map(([p, h]) => `${h}  ${p}\n`).join(""));
  return {
    format: RUN_FORMAT,
    today: opts.today,
    todaySource: opts.pinned ? "pinned" : "clock",
    suite: { ...suiteCommit(opts.root), version: suiteVersion(opts.root) },
    vectors: { dir: recordPath(opts.vectorsDir, opts.root), digest: `sha256:${digest}`, files },
    exceptions: existsSync(opts.exceptionsFile) ? { file: recordPath(opts.exceptionsFile, opts.root), sha256: sha256(readFileSync(opts.exceptionsFile)) } : null,
    ...(opts.quarantineFile === undefined ? {} : { quarantine: existsSync(opts.quarantineFile) ? { file: recordPath(opts.quarantineFile, opts.root), sha256: sha256(readFileSync(opts.quarantineFile)) } : null }),
    implementations: redactDeep(opts.implementations, opts.root),
    node: process.version,
    argv: redactArgv(opts.argv, opts.root),
  };
}

/**
 * The run.json of a run folder written by a tool other than the suite runner (the governance probes, the VTI cross-check): the same
 * suite, node and argv fields, with the tool's name and the date, so every recorded run folder cites the suite commit it came from.
 */
export interface ToolRunProvenance {
  format: typeof RUN_FORMAT;
  tool: string;
  today: string;
  suite: RunProvenance["suite"];
  node: string;
  argv: string[];
}

export function buildToolProvenance(opts: { root: string; tool: string; argv: string[] }): ToolRunProvenance {
  return {
    format: RUN_FORMAT,
    tool: opts.tool,
    today: new Date().toISOString().slice(0, 10),
    suite: { ...suiteCommit(opts.root), version: suiteVersion(opts.root) },
    node: process.version,
    argv: redactArgv(opts.argv, opts.root),
  };
}

/** `--today` must be a calendar date. */
export function parseToday(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Error(`--today needs a date YYYY-MM-DD, got ${v}`);
  return v;
}
