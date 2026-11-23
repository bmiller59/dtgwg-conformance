// SPDX-License-Identifier: Apache-2.0
// Refreshes vectors-src/gap/tf-snapshot.json: what the gap generator (scripts/generate-gap.ts) reads from the Trust Tasks task-force
// repository, so that generation and the tests run offline. Read-only against the clone (`git archive` of one revision, never a checkout).
//
//   node --experimental-strip-types scripts/gap-snapshot.ts --tf <task-force clone> [--rev origin/main] --families vta,vtc[,rooms,...] [--out vectors-src/gap/tf-snapshot.json]
//        [--only <json file of Type URIs> --full vta,vtc,...]   keep, for every family NOT named in --full, only the listed versions (the versions no other
//                                       vector set covers): a family snapshotted in full would make `loadTask` serve versions the plain, emit and 2L
//                                       generators must not pick up
//        [--extra <label>=<rev>,...]   versions that exist only on a pull request or branch (not on --rev): read from that revision and
//                                       tagged with `origin` (label, revision), so a vector cites the revision it follows (e.g. pr#904=origin/understanding-rebased)
//
// Per task version of the named families it records: the spec status, the request and response policy (read from the front matter the way
// the task force's own binding generator reads it: proof, recipient and issuedAt requirements), the spec's declared error codes, every
// entry of `payload.invalid-examples.json`, and every request example in spec.md. The bundled payload and response schemas are stored
// only for versions the pinned @openvtc/trust-tasks package does not ship (it is older than the repository); for the others the package
// is the schema source, as in the plain-task family.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageHas, TYPE_BASE } from "../src/plain/catalog.ts";
import { digestPath } from "../src/vectors/source.ts";
import { jsonHashOfText, specHashOfText } from "../src/vectors/spec-hash.ts";

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------------------------------------------------------------- schema bundling (mirrors the task force's inlineCrossFileRefs)

const splitExternal = (s: string): { filePath: string; defName: string } | null => {
  const hash = s.indexOf("#");
  if (hash < 0) return null;
  const filePath = s.slice(0, hash);
  const defName = s.slice(hash + 1).replace(/^\/\$defs\//, "");
  if (!filePath || !defName || defName.includes("/") || defName === s.slice(hash + 1)) return null;
  return { filePath, defName };
};
function collectRefs(node: unknown, pred: (r: string) => boolean, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const i of node) collectRefs(i, pred, out);
  else if (isObj(node)) {
    if (typeof node["$ref"] === "string" && pred(node["$ref"])) out.push(node["$ref"]);
    for (const v of Object.values(node)) collectRefs(v, pred, out);
  }
  return out;
}
function localize(node: unknown): void {
  if (Array.isArray(node)) node.forEach(localize);
  else if (isObj(node)) {
    if (typeof node["$ref"] === "string" && !node["$ref"].startsWith("#")) {
      const s = splitExternal(node["$ref"]);
      if (s) node["$ref"] = `#/$defs/${s.defName}`;
    }
    for (const v of Object.values(node)) localize(v);
  }
}
function bundle(schema: J, baseDir: string): J {
  const external = (r: string): boolean => !r.startsWith("#");
  const frontier = collectRefs(schema, external).map((ref) => ({ ref, ownerDir: baseDir }));
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const { ref, ownerDir } = frontier.pop()!;
    const s = splitExternal(ref);
    if (!s) throw new Error(`external $ref ${ref} is not <path>#/$defs/<name>`);
    const abs = resolve(ownerDir, s.filePath);
    const key = `${abs}#${s.defName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const doc = JSON.parse(readFileSync(abs, "utf8")) as J;
    const fragment = (doc["$defs"] as J | undefined)?.[s.defName];
    if (fragment === undefined) throw new Error(`${abs} has no $defs/${s.defName}`);
    const defs = (schema["$defs"] ??= {}) as J;
    if (defs[s.defName] !== undefined) {
      if (JSON.stringify(defs[s.defName]) !== JSON.stringify(fragment)) throw new Error(`$defs/${s.defName} defined twice with different shapes`);
    } else defs[s.defName] = structuredClone(fragment);
    const fdir = dirname(abs);
    for (const r of collectRefs(fragment, external)) frontier.push({ ref: r, ownerDir: fdir });
    for (const r of collectRefs(fragment, (x) => x.startsWith("#"))) frontier.push({ ref: `${s.filePath}${r}`, ownerDir });
  }
  localize(schema);
  return schema;
}

// ---------------------------------------------------------------- main

const tf = arg("tf");
if (tf === undefined) { console.error("--tf <task-force clone> is required"); process.exit(2); }
const rev = arg("rev") ?? "origin/main";
const families = (arg("families") ?? "vta,vtc").split(",");
const here = dirname(fileURLToPath(import.meta.url));
const onlyList = arg("only") === undefined ? undefined : new Set(JSON.parse(readFileSync(resolve(arg("only")!), "utf8")) as string[]);
const fullFamilies = (arg("full") ?? "").split(",").filter((x) => x !== "");
const extras = (arg("extra") ?? "").split(",").filter((x) => x !== "").map((x) => { const i = x.indexOf("="); return { label: x.slice(0, i), rev: x.slice(i + 1) }; });
const out = resolve(arg("out") ?? join(here, "..", "vectors-src", "gap", "tf-snapshot.json"));

const commit = execFileSync("git", ["-C", tf, "rev-parse", rev], { encoding: "utf8" }).trim();
const commitDate = execFileSync("git", ["-C", tf, "show", "-s", "--format=%cs", commit], { encoding: "utf8" }).trim();
const work = mkdtempSync(join(tmpdir(), "tt-gap-snap-"));
try {
  const tar = execFileSync("git", ["-C", tf, "archive", commit, "specs"], { maxBuffer: 1024 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", work], { input: tar });
  const req = createRequire(join(tf, "package.json"));
  const YAML = req("yaml") as { parse(s: string): unknown };

  const tasks: J[] = [];
  const walk = (dir: string, rel: string, origin?: J, skip?: (typeUri: string, slug: string, version: string) => boolean): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = `${rel}/${e.name}`;
      if (/^\d+\.\d+$/.test(e.name) && existsSync(join(dir, e.name, "spec.md"))) {
        const slug = rel.replace(/^\//, "");
        if (!families.includes(slug.split("/")[0]!)) continue;
        if (skip?.(`${TYPE_BASE}${slug}/${e.name}`, slug, e.name)) continue;
        if (onlyList !== undefined && origin === undefined && !fullFamilies.includes(slug.split("/")[0]!) && !onlyList.has(`${TYPE_BASE}${slug}/${e.name}`)) continue;
        const t = read(slug, e.name, join(dir, e.name));
        if (origin !== undefined) t["origin"] = origin;
        tasks.push(t);
      } else walk(join(dir, e.name), r, origin, skip);
    }
  };
  walk(join(work, "specs"), "");
  // versions only on a pull request or branch: read from that revision, never from main
  for (const x of extras) {
    const sha = execFileSync("git", ["-C", tf, "rev-parse", x.rev], { encoding: "utf8" }).trim();
    const w2 = mkdtempSync(join(tmpdir(), "tt-gap-snap-x-"));
    try {
      execFileSync("tar", ["-x", "-C", w2], { input: execFileSync("git", ["-C", tf, "archive", sha, "specs"], { maxBuffer: 1024 * 1024 * 1024 }) });
      walk(join(w2, "specs"), "", { label: x.label, rev: x.rev, sha }, (u, slug, version) => existsSync(join(work, "specs", slug, version, "spec.md")) || tasks.some((t) => t["typeUri"] === u));
    } finally { /* the schema bundle and digests are computed inside read(); the directory is not needed afterwards */ rmSync(w2, { recursive: true, force: true }); }
  }

  function read(slugWithSlash: string, version: string, dir: string): J {
    const slug = slugWithSlash.replace(/^\//, "");
    const spec = readFileSync(join(dir, "spec.md"), "utf8");
    const fm = /^---\n([\s\S]*?)\n---/.exec(spec);
    const meta = (fm === null ? {} : YAML.parse(fm[1]!)) as J;
    const parties = Array.isArray(meta["parties"]) ? (meta["parties"] as J[]) : [];
    const partyReq = (member: string): boolean => parties.find((p) => isObj(p) && p["member"] === member)?.["requirement"] === "REQUIRED";
    const per = (x: unknown): { request: boolean; response: boolean } => {
      const o = isObj(x) ? x : {};
      return typeof o["requirement"] === "string" ? { request: o["requirement"] === "REQUIRED", response: o["requirement"] === "REQUIRED" } : { request: o["request"] === "REQUIRED", response: (o["response"] ?? o["request"]) === "REQUIRED" };
    };
    const proof = per(meta["proofRequirement"]);
    const issued = per(meta["issuedAtRequirement"]);
    const typeUri = `${TYPE_BASE}${slug}/${version}`;
    const schemaPath = join(dir, "payload.schema.json");
    const hasSchema = existsSync(schemaPath);
    const raw = hasSchema ? (JSON.parse(readFileSync(schemaPath, "utf8")) as J) : undefined;
    const inPackage = packageHas(typeUri);
    let payloadSchema: J | undefined;
    let responseSchema: J | undefined;
    if (raw !== undefined && !inPackage) {
      payloadSchema = bundle(structuredClone(raw), dir);
      if (isObj((payloadSchema["$defs"] as J | undefined)?.["Response"])) responseSchema = { ...(payloadSchema["$schema"] === undefined ? {} : { $schema: payloadSchema["$schema"] }), $ref: "#/$defs/Response", $defs: payloadSchema["$defs"] };
    }
    const hasResponse = raw !== undefined && isObj((raw["$defs"] as J | undefined)?.["Response"]);
    const invalidFile = join(dir, "payload.invalid-examples.json");
    const invalid = existsSync(invalidFile) ? (JSON.parse(readFileSync(invalidFile, "utf8")) as J[]) : [];
    // request examples: fenced json blocks whose document `type` is this task's `#request`
    const examples: { payload: unknown }[] = [];
    for (const m of spec.matchAll(/```json\n([\s\S]*?)\n```/g)) {
      try {
        const doc = JSON.parse(m[1]!) as J;
        if (isObj(doc) && doc["type"] === `${typeUri}#request` && isObj(doc["payload"])) examples.push({ payload: doc["payload"] });
      } catch { /* not a whole JSON document */ }
    }
    const errorCodes = Array.isArray(meta["errorCodes"]) ? (meta["errorCodes"] as J[]).map((e) => String(e["code"])) : [];
    return {
      typeUri, slug, version, family: slug.split("/")[0], title: meta["title"] ?? slug, status: meta["status"] ?? "unspecified",
      tfPath: `specs/${slug}/${version}/spec.md`,
      ...(meta["status"] === "retired" ? { supersededBy: typeof meta["supersededBy"] === "string" ? meta["supersededBy"] : "unknown" } : {}),
      // the digests the vector's `source` records: the version directory (pinnedDigest of a `kit:` ref), the normalised spec text and the canonical schema (docs/23)
      dirDigest: digestPath(dir), specHash: specHashOfText(spec), schemaHash: hasSchema ? jsonHashOfText(readFileSync(schemaPath, "utf8")) : null,
      inPackage, hasPayloadSchema: hasSchema, hasResponse,
      requestPolicy: { isBearer: meta["bearer"] === true, isProofRequired: proof.request, isRecipientRequired: partyReq("recipient"), isIssuedAtRequired: issued.request },
      responsePolicy: hasResponse ? { isBearer: meta["bearer"] === true, isProofRequired: proof.response, isRecipientRequired: partyReq("issuer"), isIssuedAtRequired: issued.response } : null,
      errorCodes,
      invalidExamples: invalid.filter((i) => isObj(i) && "payload" in i).map((i) => ({ note: String(i["note"] ?? ""), payload: i["payload"] })),
      examples,
      ...(payloadSchema === undefined ? {} : { payloadSchema }),
      ...(responseSchema === undefined ? {} : { responseSchema }),
    };
  }
  // remote branches whose spec files differ from main for a task of these families: the vectors follow main, and say so
  const branchOf = new Map<string, { name: string; sha: string }[]>();
  const branches = execFileSync("git", ["-C", tf, "for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], { encoding: "utf8" }).split("\n").filter((b) => b !== "" && b !== "origin" && b !== "origin/HEAD" && b !== "origin/main" && !b.startsWith("origin/dependabot/"));
  for (const b of branches) {
    const sha = execFileSync("git", ["-C", tf, "rev-parse", b], { encoding: "utf8" }).trim();
    for (const f of execFileSync("git", ["-C", tf, "diff", "--name-only", `${commit}...${b}`, "--", "specs"], { encoding: "utf8" }).split("\n")) {
      const m = /^specs\/(.+)\/(\d+\.\d+)\/[^/]+$/.exec(f);
      if (m === null || !families.includes(m[1]!.split("/")[0]!)) continue;
      const k = `${TYPE_BASE}${m[1]}/${m[2]}`;
      const list = branchOf.get(k) ?? [];
      if (!list.some((x) => x.name === b)) list.push({ name: b, sha });
      branchOf.set(k, list);
    }
  }
  for (const t of tasks) { const bs = branchOf.get(String(t["typeUri"])); if (bs !== undefined && t["origin"] === undefined) t["branches"] = bs; }
  tasks.sort((a, b) => String(a["typeUri"]).localeCompare(String(b["typeUri"]), "en", { numeric: true }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ format: "tt-gap-snapshot/0.1", about: "Task-force specification facts the gap generator reads (scripts/gap-snapshot.ts). Schemas are stored only for versions the pinned package does not ship.", tfCommit: commit, tfDate: commitDate, families, tasks }, null, 1) + "\n");
  console.log(`${tasks.length} task versions of ${families.join(", ")} at ${commit.slice(0, 9)}; ${tasks.filter((t) => t["payloadSchema"] !== undefined).length} with a stored schema; ${statSync(out).size} bytes`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
