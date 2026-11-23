// SPDX-License-Identifier: Apache-2.0
// Which recorded results a vector change makes stale (older-sets fixes, D890). Compares every vector of the working tree with the same vector at a base commit, classifies the
// change, and joins the changed ids to the recorded results of each platform's run folders (platform run map). Read-only on the repository and on the run records: it writes
// only the file named by --out.
//   node --experimental-strip-types scripts/older-sets-rerun.ts --base <commit> --results <results dir> --out <file.json> [--tip <label>]
// A change is `widened` (the vector now accepts more: an old PASS stays valid, a recorded FAIL, KNOWN-FAIL or CLARIFY may flip), `structural` (requires, steps, sent documents,
// triggers or captures changed: every recorded result is stale), `excluded` (the vector is no longer run: nothing to re-run, the recorded results stop counting) or `none`
// (title, citations, labels, mutants only).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export type ChangeKind = "none" | "widened" | "structural" | "excluded";

const codes = (x: unknown): string[] => (x === undefined ? [] : Array.isArray(x) ? (x as string[]) : [String(x)]);
const subset = (a: string[], b: string[]): boolean => a.every((c) => b.includes(c));

/** Whether `next` accepts everything `prev` accepted (same step otherwise): an added errorReply, more codes, a hard status made advisory, a refusal made any-refusal. */
export function widens(prev: J, next: J): boolean {
  const { errorReply: _a, httpStatus: hs, httpStatusShould: hsn, code: pc, orRefusal: po, disposition: pd, ...p } = prev;
  const { errorReply: _b, httpStatus: hs2, httpStatusShould: hsn2, code: nc, orRefusal: no, disposition: nd, ...n } = next;
  void _a; void _b; void hs; void hsn; void hs2; void hsn2;
  if (!same(p, n)) return false;
  if (pd !== nd && !(pd === "error" && nd === "any-refusal")) return false;
  if (pd === "error" && nd === "error" && !subset(codes(pc), codes(nc))) return false;
  if (!subset(codes(po), codes(no))) return false;
  // a status that was asserted may become advisory, never the other way round
  if (hs2 !== undefined && !same(hs, hs2)) return false;
  if (hsn2 !== undefined && hsn !== undefined && !same(hsn, hsn2)) return false;
  return true;
}

/** The kind of change between two versions of one vector. */
export function classifyChange(prev: J, next: J): ChangeKind {
  if (isObj(next["excludedFromRun"]) !== isObj(prev["excludedFromRun"]) || (next["retired"] !== undefined) !== (prev["retired"] !== undefined)) return isObj(next["excludedFromRun"]) || next["retired"] !== undefined ? "excluded" : "structural";
  if (!same(prev["requires"], next["requires"]) || !same(prev["clarify"] === null, next["clarify"] === null)) return "structural";
  const ps = (Array.isArray(prev["steps"]) ? prev["steps"] : []) as J[];
  const ns = (Array.isArray(next["steps"]) ? next["steps"] : []) as J[];
  if (ps.length !== ns.length) return "structural";
  let widened = false;
  for (let i = 0; i < ps.length; i++) {
    const { expect: pe, ...pr } = ps[i]!;
    const { expect: ne, ...nr } = ns[i]!;
    if (!same(pr, nr)) return "structural";
    if (same(pe, ne)) continue;
    if (!isObj(pe) || !isObj(ne) || !widens(pe, ne)) return "structural";
    widened = true;
  }
  return widened ? "widened" : "none";
}

const SKIP_DIRS = new Set(["imported", "ceremony-scenarios", "governance"]);
const NOT_VECTORS = /(^|\/)(manifest|pins|tf-manifest|not-generated|clarify-classes|scenarios-manifest)\.json$/;
function walk(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir).sort()) {
    const rel = base === "" ? n : `${base}/${n}`;
    if (SKIP_DIRS.has(n) && base === "") continue;
    if (statSync(join(dir, n)).isDirectory()) out.push(...walk(join(dir, n), rel));
    else if (n.endsWith(".json") && !NOT_VECTORS.test(rel)) out.push(rel);
  }
  return out;
}

export interface VecRec { set: string; channel: string; vector: J }
function loadTree(read: (rel: string) => string | undefined, files: string[]): Map<string, VecRec> {
  const out = new Map<string, VecRec>();
  for (const f of files) {
    const t = read(f);
    if (t === undefined) continue;
    let j: unknown;
    try { j = JSON.parse(t); } catch { continue; }
    if (!isObj(j) || !Array.isArray(j["vectors"])) continue;
    const set = f.includes("/") ? f.split("/")[0]! : ".";
    for (const v of j["vectors"] as J[]) if (typeof v["id"] === "string") out.set(v["id"], { set, channel: isObj(v["source"]) && typeof v["source"]["channel"] === "string" ? v["source"]["channel"] : "registry", vector: v });
  }
  return out;
}

export interface ChangedVector { id: string; set: string; channel: string; kind: ChangeKind }

export function compare(root: string, base: string): { changed: ChangedVector[]; perSet: Record<string, { total: number; changed: number; widened: number; structural: number; excluded: number }>; current: Map<string, VecRec> } {
  const vdir = join(root, "vectors");
  const files = walk(vdir);
  const baseFiles = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", base, "vectors"], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter((f) => f.endsWith(".json")).map((f) => f.slice("vectors/".length)).filter((f) => !SKIP_DIRS.has(f.split("/")[0]!) && !NOT_VECTORS.test(f));
  const cur = loadTree((rel) => (existsSync(join(vdir, rel)) ? readFileSync(join(vdir, rel), "utf8") : undefined), files);
  const old = loadTree((rel) => { try { return execFileSync("git", ["-C", root, "show", `${base}:vectors/${rel}`], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); } catch { return undefined; } }, baseFiles);
  const perSet: Record<string, { total: number; changed: number; widened: number; structural: number; excluded: number }> = {};
  const changed: ChangedVector[] = [];
  for (const [id, c] of cur) {
    const s = (perSet[c.set] ??= { total: 0, changed: 0, widened: 0, structural: 0, excluded: 0 });
    s.total++;
    const o = old.get(id);
    if (o === undefined) continue;
    const kind = classifyChange(o.vector, c.vector);
    if (kind === "none") continue;
    s.changed++; s[kind]++;
    changed.push({ id, set: c.set, channel: c.channel, kind });
  }
  return { changed, perSet, current: cur };
}

interface RunMapRun { folder: string; platform: string; surface: string }
interface ResultRec { id: string; status: string; reason?: string; failures?: string[] }

/** Every results.json under a run folder (a run folder may hold sub-runs: nonattested, core-advisory, 2l ...), relative to the folder. */
export function resultFiles(resultsDir: string, folder: string): string[] {
  const root = join(resultsDir, folder);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walkDir = (d: string, rel: string): void => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walkDir(p, rel === "" ? n : `${rel}/${n}`);
      else if (n === "results.json") out.push(rel === "" ? "." : rel);
    }
  };
  walkDir(root, "");
  return out;
}

/** The recorded tier 1 results of one results.json (a block of tier 1; a block with no tier counts). */
export function recordsOf(resultsDir: string, folder: string, sub = "."): ResultRec[] {
  const p = join(resultsDir, folder, sub === "." ? "" : sub, "results.json");
  if (!existsSync(p)) return [];
  let j: unknown;
  try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return []; }
  const blocks = (Array.isArray(j) ? j : [j]) as J[];
  return blocks.filter((b) => b["tier"] === 1 || b["tier"] === undefined).flatMap((b) => (Array.isArray(b["results"]) ? (b["results"] as ResultRec[]) : []));
}

/**
 * Whether a recorded failure message of a vector is explained by the OLD wording alone (class B): the platform answered a code the new vector accepts at that step
 * (`step N: expected code ..., got <code>`), or answered nothing at a step that is now `errorReply: "should"`.
 */
export function causedByOldWording(failures: string[], next: J): boolean {
  const steps = (Array.isArray(next["steps"]) ? next["steps"] : []) as J[];
  if (failures.length === 0) return false;
  return failures.every((f) => {
    const m = /^\^?step (\d+): (?:expected code .+?, got (.+?)|expected (?:one error|a trust-task-error), got (?:0 replies|.*))\$?$/.exec(f.replace(/\\\|/g, "|"));
    if (m === null) return false;
    const ex = isObj(steps[Number(m[1]) - 1]?.["expect"]) ? (steps[Number(m[1]) - 1]!["expect"] as J) : undefined;
    if (ex === undefined) return false;
    if (m[2] !== undefined) return codes(ex["code"]).includes(m[2]);
    return ex["errorReply"] === "should" && /0 replies/.test(f);
  });
}

/** Whether a recorded result of a changed vector is stale: structural changes make every result stale, a widening only a result that was not a PASS or a SKIP. */
export function isStale(kind: ChangeKind, status: string): boolean {
  if (kind === "structural") return true;
  if (kind === "widened") return status !== "PASS" && status !== "SKIP";
  return false;
}

function main(argv: string[]): void {
  const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const base = arg("--base"), results = arg("--results"), out = arg("--out");
  if (base === undefined || results === undefined || out === undefined) throw new Error("usage: older-sets-rerun.ts --base <commit> --results <results dir> --out <file> [--tip <label>]");
  const { changed, perSet, current } = compare(root, base);
  const kindOf = new Map(changed.map((c) => [c.id, c.kind]));
  const runMap = JSON.parse(readFileSync(join(root, "results", "platform-run-map.json"), "utf8")) as { runs: RunMapRun[]; notPlatform?: string[] };
  const platforms: Record<string, unknown> = {};
  const classB: { platform: string; folder: string; vector: string; status: string }[] = [];
  const groups = new Map<string, RunMapRun[]>();
  for (const r of runMap.runs) { const k = `${r.platform}/${r.surface}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  // folders of the roll-up that are no platform (the reference adapter, the witness server): each is its own row
  for (const f of runMap.notPlatform ?? []) groups.set(`not-a-platform/${f.replace(/^runs\//, "")}`, [{ folder: f, platform: "not-a-platform", surface: f }]);
  for (const [key, runs] of [...groups].sort()) {
    let gating = 0, advisory = 0;
    const stale: Record<string, { gating: Record<string, string[]>; advisory: Record<string, string[]> }> = {};
    for (const r of runs) for (const sub of resultFiles(results, r.folder)) {
      const where = sub === "." ? r.folder : `${r.folder}/${sub}`;
      for (const rec of recordsOf(results, r.folder, sub)) {
        const v = current.get(rec.id);
        if (v === undefined) continue;
        const isGating = v.channel === "registry";
        if (isGating) gating++; else advisory++;
        const kind = kindOf.get(rec.id);
        if (kind === undefined || kind === "excluded" || !isStale(kind, rec.status)) continue;
        const bucket = (stale[where] ??= { gating: {}, advisory: {} });
        (isGating ? bucket.gating : bucket.advisory)[rec.id] = [kind, rec.status, v.set, (rec.reason ?? "").slice(0, 160)];
        if (rec.status !== "PASS" && rec.status !== "SKIP" && causedByOldWording(rec.failures ?? [], v.vector)) classB.push({ platform: key, folder: where, vector: rec.id, status: rec.status });
      }
    }
    const flat = (g: "gating" | "advisory"): string[] => [...new Set(Object.values(stale).flatMap((b) => Object.keys(b[g])))].sort();
    const gatingStale = Object.values(stale).reduce((n, b) => n + Object.keys(b.gating).length, 0);
    const advisoryStale = Object.values(stale).reduce((n, b) => n + Object.keys(b.advisory).length, 0);
    platforms[key] = { folders: runs.map((r) => r.folder), gatingRecords: gating, advisoryRecords: advisory, gatingStaleRecords: gatingStale, gatingStalePercent: gating === 0 ? 0 : Math.round((1000 * gatingStale) / gating) / 10, advisoryStaleRecords: advisoryStale, advisoryStalePercent: advisory === 0 ? 0 : Math.round((1000 * advisoryStale) / advisory) / 10, vectorsGating: flat("gating"), vectorsAdvisory: flat("advisory"), byFolder: stale };
  }
  const exc = (JSON.parse(readFileSync(join(root, "exceptions", "exceptions.json"), "utf8")) as { exceptions: { impl: string; vector: string; class?: string; expectFailure?: { failures: string[] } }[] }).exceptions;
  const exceptions = exc.filter((e) => kindOf.has(e.vector) && kindOf.get(e.vector) !== "excluded").map((e) => ({ impl: e.impl, vector: e.vector, kind: kindOf.get(e.vector), class: e.class ?? null, oldWordingOnly: causedByOldWording(e.expectFailure?.failures ?? [], current.get(e.vector)!.vector) }));
  const bySetPct = Object.fromEntries(Object.entries(perSet).map(([s, v]) => [s, { ...v, changedPercent: Math.round((1000 * v.changed) / v.total) / 10 }]));
  writeFileSync(out, JSON.stringify({ format: "tt-older-sets-rerun/0.1", about: "Recorded results made stale by the older-sets fixes (D890). Read-only comparison; no run record was edited. A `widened` vector keeps its recorded PASS and SKIP results (the vector now accepts more); a `structural` one needs every recorded result re-run; an `excluded` one is no longer run.", base, tip: arg("--tip") ?? null, changed: changed.sort((a, b) => a.id.localeCompare(b.id)), bySet: bySetPct, exceptions, classBFromRecords: classB, platforms }, null, 1) + "\n");
  console.log(`${changed.length} changed vectors; ${Object.keys(platforms).length} platform surfaces`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
