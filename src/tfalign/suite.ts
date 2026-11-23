// SPDX-License-Identifier: Apache-2.0
// Reads the suite side of the alignment: every vector and ceremony scenario under vectors/, the documents their steps send, the Trust Tasks
// files they cite, and the pins the generators recorded.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const TYPE_BASE = "https://trusttasks.org/spec/";
const MENTION = /https:\/\/trusttasks\.org\/spec\/([a-z0-9_/-]+)\/(\d+\.\d+)/g;
const PATH_MENTION = /\bspecs\/([a-z0-9_/-]+)\/(\d+\.\d+)\/([A-Za-z0-9._-]+)/g;
const CER_MENTION = /\bceremonies\/([a-z0-9_/-]+\/\d+\.\d+)\/ceremony\.json(?: \(sha256 ([0-9a-f]{64})\))?/g;

export type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

export interface DocUse { vectorId: string; file: string; typeUri: string; payload: unknown }
export interface VectorRef { id: string; file: string; kind: "vector" | "scenario"; text: string; tfPaths: string[]; /** the file the vector itself cites (tfRef.repoPath), the one its recorded hash belongs to */ ownPath: string | null; /** set when the vector cites a pull request or branch (tfRef.status "pr"): the head commit it follows */ prHead: string | null; tfCommit: string | null; specHash: string | null; schemaHash: string | null; fixture: string | null }
export interface SuiteFacts {
  files: string[];
  vectors: VectorRef[];
  docs: DocUse[];
  /** Task type URIs a step sends, emits or requires. */
  stepTypes: Set<string>;
  /** Task type URIs named anywhere in a vector or scenario (steps, citations, source). */
  mentioned: Set<string>;
  /** Trust Tasks file paths named in `source.tfRef`, `source.ref` or a citation: path to the vector ids that name it. */
  citedPaths: Map<string, Set<string>>;
  /** `ceremonies/<dir>/ceremony.json` mentions in scenarios: ceremony dir to the scenario ids and the sha256 each one quotes. */
  ceremonyMentions: Map<string, { scenarios: Set<string>; sha256: Set<string> }>;
  /** Fixture rows used: `<dir>/<name>` to the vector ids. */
  fixtureUse: Map<string, Set<string>>;
  /** Payload-from references (an invalid-example file read by index): `<file>` to the indices. */
  payloadFrom: Map<string, Set<number>>;
}

function listJson(dir: string, base: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "imported") listJson(p, `${base}${name}/`, out); } else if (name.endsWith(".json")) out.push(`${base}${name}`);
  }
}

function walkDocs(x: unknown, hit: (d: J) => void): void {
  if (Array.isArray(x)) { for (const e of x) walkDocs(e, hit); return; }
  if (!isObj(x)) return;
  hit(x);
  for (const v of Object.values(x)) walkDocs(v, hit);
}

export function loadSuiteFacts(suiteRoot: string): SuiteFacts {
  const vdir = join(suiteRoot, "vectors");
  const rel: string[] = [];
  listJson(vdir, "", rel);
  const f: SuiteFacts = { files: [], vectors: [], docs: [], stepTypes: new Set(), mentioned: new Set(), citedPaths: new Map(), ceremonyMentions: new Map(), fixtureUse: new Map(), payloadFrom: new Map() };
  const cite = (p: string, id: string): void => { let s = f.citedPaths.get(p); if (s === undefined) f.citedPaths.set(p, s = new Set()); s.add(id); };
  for (const r of rel) {
    const parsed = JSON.parse(readFileSync(join(vdir, r), "utf8")) as unknown;
    if (!isObj(parsed) || typeof parsed["format"] !== "string") continue;
    const fmt = parsed["format"];
    const kind = fmt.startsWith("tt-conformance-vectors") ? "vector" : fmt.startsWith("tt-ceremony-scenarios") ? "scenario" : null;
    if (kind === null) continue;
    const items = (kind === "vector" ? parsed["vectors"] : parsed["scenarios"]) as unknown;
    if (!Array.isArray(items)) continue;
    f.files.push(r);
    for (const it of items) {
      if (!isObj(it) || typeof it["id"] !== "string") continue;
      const id = it["id"];
      const text = JSON.stringify(it);
      const src = isObj(it["source"]) ? it["source"] : {};
      const tfRef = isObj(src["tfRef"]) ? src["tfRef"] : {};
      const origin = isObj(it["origin"]) ? it["origin"] : {};
      const tfPaths = new Set<string>();
      if (typeof tfRef["repoPath"] === "string") tfPaths.add(tfRef["repoPath"]);
      for (const m of text.matchAll(PATH_MENTION)) tfPaths.add(`specs/${m[1]}/${m[2]}/${m[3]}`);
      if (typeof src["ref"] === "string") { const m = /^kit:(specs\/.+\/\d+\.\d+)$/.exec(src["ref"]); if (m !== null) tfPaths.add(`${m[1]}/spec.md`); }
      for (const p of tfPaths) cite(p, id);
      for (const m of text.matchAll(MENTION)) f.mentioned.add(`${TYPE_BASE}${m[1]}/${m[2]}`);
      for (const m of text.matchAll(PATH_MENTION)) f.mentioned.add(`${TYPE_BASE}${m[1]}/${m[2]}`);
      if (typeof src["slug"] === "string" && typeof src["version"] === "string" && /^[a-z0-9_/-]+$/.test(src["slug"])) f.mentioned.add(`${TYPE_BASE}${src["slug"]}/${src["version"]}`);
      for (const m of text.matchAll(CER_MENTION)) {
        const e = f.ceremonyMentions.get(m[1]!) ?? { scenarios: new Set<string>(), sha256: new Set<string>() };
        e.scenarios.add(id); if (m[2] !== undefined) e.sha256.add(m[2]); f.ceremonyMentions.set(m[1]!, e);
      }
      if (typeof origin["fixture"] === "string") { const s = f.fixtureUse.get(origin["fixture"]) ?? new Set<string>(); s.add(id); f.fixtureUse.set(origin["fixture"], s); }
      walkDocs(it, (o) => {
        if (typeof o["type"] === "string" && o["type"].startsWith(TYPE_BASE) && "payload" in o) {
          const t = o["type"].split("#")[0]!;
          f.docs.push({ vectorId: id, file: r, typeUri: t, payload: o["payload"] }); f.stepTypes.add(t);
        }
        if (isObj(o["emit"]) && typeof o["emit"]["type"] === "string") f.stepTypes.add(o["emit"]["type"].split("#")[0]!);
        if (isObj(o["payloadFrom"]) && typeof o["payloadFrom"]["file"] === "string" && typeof o["payloadFrom"]["index"] === "number") {
          const k = o["payloadFrom"]["file"]; const s = f.payloadFrom.get(k) ?? new Set<number>(); s.add(o["payloadFrom"]["index"]); f.payloadFrom.set(k, s);
        }
      });
      for (const req of Array.isArray(it["requires"]) ? it["requires"] : []) if (typeof req === "string" && req.includes(TYPE_BASE)) f.stepTypes.add(req.slice(req.indexOf(TYPE_BASE)).split("#")[0]!);
      f.vectors.push({ id, file: r, kind, text, tfPaths: [...tfPaths].sort(), ownPath: typeof tfRef["repoPath"] === "string" ? tfRef["repoPath"] : null, prHead: tfRef["status"] === "pr" && typeof tfRef["head"] === "string" ? tfRef["head"] : null, tfCommit: typeof src["tfCommit"] === "string" ? src["tfCommit"] : null, specHash: typeof src["specHash"] === "string" ? src["specHash"] : null, schemaHash: typeof src["schemaHash"] === "string" ? src["schemaHash"] : null, fixture: typeof origin["fixture"] === "string" ? origin["fixture"] : null });
    }
  }
  f.files.sort();
  return f;
}

export interface PinFact { source: string; commit: string | null; note?: string }

/** The task-force commits the suite's own generators recorded, one per input, read from the committed files (never from the network). */
export function loadPins(suiteRoot: string): PinFact[] {
  const out: PinFact[] = [];
  const read = (p: string): J | null => { const f = join(suiteRoot, p); return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as J) : null; };
  const m = read("vectors/tf-manifest.json");
  if (m !== null && isObj(m["main"])) out.push({ source: "vectors/tf-manifest.json (main)", commit: String(m["main"]["commit"]) });
  if (m !== null && isObj(m["kit"])) out.push({ source: "vectors/tf-manifest.json (kit)", commit: String(m["kit"]["commit"]) });
  for (const p of ["vectors-src/gap/tf-snapshot.json", "vectors-src/complete/tf-extra.json"]) { const x = read(p); if (x !== null && typeof x["tfCommit"] === "string") out.push({ source: p, commit: x["tfCommit"] }); }
  const inv = read("vectors-src/coverage/tf-invalid-examples.json");
  if (inv !== null) { const c = /[0-9a-f]{40}/.exec(String(inv["kit"])); out.push({ source: "vectors-src/coverage/tf-invalid-examples.json", commit: c?.[0] ?? null }); }
  const ng = read("vectors/complete/not-generated.json");
  if (ng !== null && isObj(ng["scopeInputs"])) { const v = ng["scopeInputs"]["task force repository (origin/main)"]; if (typeof v === "string") out.push({ source: "vectors/complete/not-generated.json (scope input)", commit: v }); }
  const sh = read("vectors-src/spec-hashes.json");
  if (sh !== null && typeof sh["tfCommit"] === "string") out.push({ source: "vectors-src/spec-hashes.json", commit: sh["tfCommit"] });
  const pv = read("vectors/imported/PROVENANCE.json");
  if (pv !== null) out.push({ source: "vectors/imported/PROVENANCE.json", commit: typeof pv["commit"] === "string" ? pv["commit"] : null, note: `imported on ${String(pv["importedOn"])}${typeof pv["commit"] === "string" ? "" : "; the commit was not recorded"}` });
  return out;
}
