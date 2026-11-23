// SPDX-License-Identifier: Apache-2.0
// Reads task specifications (specs/<slug>/<version>/spec.md) and ceremony definitions from a file set.
import { maturityOf, parseFrontMatter } from "./frontmatter.ts";
import type { FileSet } from "./git.ts";
import type { SpecSource } from "./types.ts";

export const TYPE_BASE = "https://trusttasks.org/spec/";

export interface SpecRecord {
  slug: string;
  version: string;
  title: string;
  status: string;
  /** True when the file declares a `status` field; false when `unspecified` was filled in. */
  statusDeclared: boolean;
  typeUri: string;
  /** The `supersededBy` front-matter field (a slug, or a slug and version), or null when absent. */
  supersededBy: string | null;
}

const SPEC_RE = /^specs\/(.+)\/(\d+\.\d+)\/spec\.md$/;
export const isSpecPath = (p: string): boolean => SPEC_RE.test(p);
export const isCeremonyPath = (p: string): boolean => /^ceremonies\/.+\/ceremony\.json$/.test(p);

export function readSpecs(fs: FileSet): SpecRecord[] {
  const out: SpecRecord[] = [];
  for (const p of fs.files()) {
    const m = SPEC_RE.exec(p);
    if (!m) continue;
    const slug = m[1] as string;
    const version = m[2] as string;
    const fm = parseFrontMatter(fs.read(p));
    out.push({
      slug,
      version,
      title: fm["title"] ?? slug,
      status: maturityOf(fm),
      statusDeclared: Boolean(fm["status"]),
      typeUri: `${TYPE_BASE}${slug}/${version}`,
      supersededBy: fm["supersededBy"] ? fm["supersededBy"] : null,
    });
  }
  return out;
}

export interface CeremonyRecord {
  id: string;
  title: string;
  status: string;
  steps: { id: string; type: string }[];
}

export function readCeremonies(fs: FileSet): CeremonyRecord[] {
  const out: CeremonyRecord[] = [];
  for (const p of fs.files()) {
    if (!/^ceremonies\/(.+)\/ceremony\.json$/.test(p)) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(fs.read(p)) as Record<string, unknown>;
    } catch {
      continue;
    }
    const steps: { id: string; type: string }[] = [];
    const raw = j["steps"];
    if (raw && typeof raw === "object") {
      for (const [id, s] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
        if (typeof s?.["type"] === "string") steps.push({ id, type: (s["type"] as string).replace(/#response$/, "") });
      }
    }
    out.push({
      id: `${String(j["slug"] ?? p)}@${String(j["version"] ?? "?")}`,
      title: String(j["title"] ?? ""),
      status: typeof j["status"] === "string" ? (j["status"] as string) : "unspecified",
      steps,
    });
  }
  return out;
}

export const mkSource = (kind: SpecSource["kind"], ref: string, status: string, draft: boolean | null = null): SpecSource => ({
  kind,
  ref,
  status,
  draft,
});
