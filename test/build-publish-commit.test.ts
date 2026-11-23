// SPDX-License-Identifier: Apache-2.0
// scripts/build-publish-commit.sh against a throwaway repository: dry run writes nothing, --execute builds one signed root commit with the
// source tree, and the refusals (existing branch, signing off, run records in the tree, attribution in the message) hold. Never touches this repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/build-publish-commit.sh", import.meta.url).pathname;
const haveTools = spawnSync("ssh-keygen", ["-V"]).error === undefined && spawnSync("git", ["--version"]).error === undefined;

function setup(): { dir: string; env: NodeJS.ProcessEnv; git: (...a: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "publish-"));
  const home = join(dir, "home"), repo = join(dir, "repo");
  mkdirSync(home); mkdirSync(repo);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(home, "key")]);
  const env = { PATH: process.env["PATH"] ?? "", HOME: home, GIT_CONFIG_GLOBAL: join(home, "gitconfig"), GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...a: string[]): string => execFileSync("git", a, { cwd: repo, env, encoding: "utf8" });
  git("init", "-q", "-b", "src");
  git("config", "user.name", "Test Person"); git("config", "user.email", "test@example.org");
  git("config", "gpg.format", "ssh"); git("config", "user.signingkey", join(home, "key.pub")); git("config", "commit.gpgsign", "true");
  writeFileSync(join(repo, "a.txt"), "one"); git("add", "."); git("commit", "-q", "-m", "work 1");
  writeFileSync(join(repo, "b.txt"), "two"); git("add", "."); git("commit", "-q", "-m", "work 2");
  return { dir, env, git };
}
const run = (env: NodeJS.ProcessEnv, dir: string, ...args: string[]) => spawnSync("bash", [script, "--source", "src", ...args], { cwd: join(dir, "repo"), env, encoding: "utf8" });

test("dry run prints the plan and writes nothing", { skip: !haveTools }, () => {
  const { dir, env, git } = setup();
  try {
    const r = run(env, dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /DRY RUN: nothing written/);
    assert.equal(git("branch", "--list", "publish/initial-commit-v6").trim(), "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--execute builds one signed signed-off root commit with the source tree; a second run refuses", { skip: !haveTools }, () => {
  const { dir, env, git } = setup();
  try {
    const r = run(env, dir, "--execute");
    assert.equal(r.status, 0, r.stderr);
    const b = "publish/initial-commit-v6";
    assert.equal(git("rev-list", "--count", b).trim(), "1");
    assert.equal(git("rev-parse", `${b}^{tree}`), git("rev-parse", "src^{tree}"));
    assert.match(git("cat-file", "-p", b), /gpgsig/);
    assert.match(git("log", "-1", "--format=%B", b), /Signed-off-by: Test Person <test@example.org>/);
    const again = run(env, dir, "--execute");
    assert.equal(again.status, 1);
    assert.match(again.stderr, /branch exists/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refuses attribution in the message, signing off, and run records in the tree", { skip: !haveTools }, () => {
  const { dir, env, git } = setup();
  try {
    const mf = join(dir, "msg.txt");
    writeFileSync(mf, "Initial commit\n\nCo-Authored-By: someone\n");
    const a = run(env, dir, "--message-file", mf);
    assert.equal(a.status, 1); assert.match(a.stderr, /attribution/);
    git("config", "commit.gpgsign", "false");
    const b = run(env, dir);
    assert.equal(b.status, 1); assert.match(b.stderr, /gpgsign/);
    git("config", "commit.gpgsign", "true");
    mkdirSync(join(dir, "repo", "runs"));
    writeFileSync(join(dir, "repo", "runs", "x.json"), "{}"); git("add", "."); git("commit", "-q", "-m", "runs");
    const c = run(env, dir);
    assert.equal(c.status, 1); assert.match(c.stderr, /must not be published/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLAUDE.md (any depth) stays on the source branch but is left out of the published tree; its content is not checked", { skip: !haveTools }, () => {
  const { dir, env, git } = setup();
  try {
    mkdirSync(join(dir, "repo", "sub"));
    // A rule file that quotes a private path is fine on the working branch because it is never published.
    const sl = "/";
    writeFileSync(join(dir, "repo", "CLAUDE.md"), `agent guide, mentions ${sl}home${sl}someone\n`);
    writeFileSync(join(dir, "repo", "sub", "CLAUDE.md"), "nested guide\n");
    writeFileSync(join(dir, "repo", "sub", "keep.txt"), "kept\n");
    git("add", "."); git("commit", "-q", "-m", "guide");
    const dry = run(env, dir);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /excluded: CLAUDE\.md sub\/CLAUDE\.md/);
    const r = run(env, dir, "--execute");
    assert.equal(r.status, 0, r.stderr);
    const b = "publish/initial-commit-v6";
    const published = git("ls-tree", "-r", "--name-only", b).trim().split("\n");
    assert.deepEqual(published, ["a.txt", "b.txt", "sub/keep.txt"]);
    assert.notEqual(git("rev-parse", `${b}^{tree}`), git("rev-parse", "src^{tree}"));
    assert.ok(git("ls-tree", "-r", "--name-only", "src").includes("CLAUDE.md"), "still on the source branch");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
