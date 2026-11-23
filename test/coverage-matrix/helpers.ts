// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const tmp = (): string => mkdtempSync(join(tmpdir(), "covmx-"));
export function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
/** A throwaway repository: its own empty git config, so nothing of the machine's settings is read or changed. */
export function gitIn(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
}
export const spec = (slug: string, version: string, status?: string, title = "T"): string =>
  `---\nslug: ${slug}\nversion: "${version}"\ntitle: ${title}\n${status ? `status: ${status}\n` : ""}---\nbody\n`;
