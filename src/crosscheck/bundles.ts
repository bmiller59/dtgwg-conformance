// SPDX-License-Identifier: Apache-2.0
// Which of the Trust Task specification bundles VTI vendors (vti-specs-core/trust-tasks/**/*.bundle.json) an implementation serves.
// The bundles carry the task's schema, policy and error codes but no example documents, so they size the next step (policy probes)
// rather than run as cases.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface BundleInfo {
  slug: string;
  typeUri: string;
  version: string;
  policy: Record<string, unknown>;
  errorCodes: string[];
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".bundle.json")) out.push(p);
  }
}

export function loadBundles(vtiRoot: string): BundleInfo[] {
  const files: string[] = [];
  walk(join(vtiRoot, "vti-specs-core", "trust-tasks"), files);
  return files.map((f) => {
    const j = JSON.parse(readFileSync(f, "utf8")) as { slug: string; typeUri: string; version: string; policy?: Record<string, unknown>; errorCodes?: unknown[] };
    return { slug: j.slug, typeUri: j.typeUri, version: j.version, policy: j.policy ?? {}, errorCodes: (j.errorCodes ?? []).map((e) => (typeof e === "string" ? e : JSON.stringify(e))) };
  });
}

export interface Overlap {
  total: number;
  served: BundleInfo[];
  sameSlugOtherVersion: { bundle: BundleInfo; served: string }[];
}

const slugOf = (uri: string): string => uri.replace(/^https:\/\/trusttasks\.org\/spec\//, "").replace(/\/\d+\.\d+$/, "");

export function bundleOverlap(vtiRoot: string, supportedTypes: string[]): Overlap {
  const bundles = loadBundles(vtiRoot);
  const served = bundles.filter((b) => supportedTypes.includes(b.typeUri));
  const bySlug = new Map(supportedTypes.map((t) => [slugOf(t), t]));
  const other = bundles.filter((b) => !supportedTypes.includes(b.typeUri) && bySlug.has(b.slug)).map((b) => ({ bundle: b, served: bySlug.get(b.slug)! }));
  return { total: bundles.length, served, sameSlugOtherVersion: other };
}

export function bundleOverlapMarkdown(implementation: string, o: Overlap): string {
  const lines = [`## Bundle overlap: ${implementation}`, "", `VTI vendors ${o.total} specification bundles. ${o.served.length} are a type this implementation declares at the same version${o.served.length > 0 ? ": " + o.served.map((b) => b.typeUri.replace("https://trusttasks.org/spec/", "")).join(", ") : ""}. ${o.sameSlugOtherVersion.length} more name a type it declares at another version${o.sameSlugOtherVersion.length > 0 ? ": " + o.sameSlugOtherVersion.map((x) => `${x.bundle.typeUri.replace("https://trusttasks.org/spec/", "")} (it serves ${x.served.replace("https://trusttasks.org/spec/", "")})`).join(", ") : ""}.`, ""];
  return lines.join("\n") + "\n";
}
