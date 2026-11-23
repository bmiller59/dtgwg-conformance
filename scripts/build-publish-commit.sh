#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# build-publish-commit.sh: squash the final line of the suite into ONE signed commit on a fresh orphan branch.
#
# The branch (default publish/initial-commit-v6) holds a single root commit whose tree is the tree of the source branch
# (default conformance/full-coverage-final5) minus the working-branch-only files matched by PUBLISH_EXCLUDE_RE below (CLAUDE.md, the
# agent guide: it stays on the working branch but is never published), so nothing of the working history is carried over. It is built with plumbing
# (git commit-tree), so no checkout, no index and no working tree are touched. Nothing is pushed, ever: this script has no
# remote operation and the branch is local until a person decides otherwise.
#
# Usage:
#   scripts/build-publish-commit.sh [--source <branch>] [--branch <name>] [--message-file <file>] [--execute]
#
#   --source        the branch whose tree (without the excluded files) becomes the commit (default conformance/full-coverage-final5)
#   --branch        the orphan branch to create (default publish/initial-commit-v6); refused when it already exists
#   --message-file  the commit message (default: the standard initial-commit message below); it must carry a
#                   Signed-off-by trailer, which is added from git config when missing
#   --execute       build the commit. WITHOUT this flag the script is a DRY RUN: it prints what it would do, writes nothing.
#
# Checks (both modes; any failure exits 1):
#   - the published tree holds no file matched by PUBLISH_EXCLUDE_RE (they are removed from it before every check below);
#   - the source branch exists and the working tree of the repository it is checked out in has no uncommitted tracked change
#     (an untracked .keep-until file is fine; it is not in the tree);
#   - the branch to create does not exist;
#   - the tree holds no run records (runs/, results-local/), no node_modules and no .keep-until;
#   - the tree holds no local filesystem path (home, shared working tree or temporary directories; the one allowlisted line of
#     CLAUDE.md is the hygiene rule quoting itself) and no AI or tool attribution trailer or byline (Co-Authored-By, Generated with);
#   - the message has no AI or tool attribution line (a repository rule);
#   - commit signing is configured (commit.gpgsign=true) and the script never disables it.
# After --execute: verify with `git log --show-signature -1 <branch>` and run `npm test` from a checkout of that branch.
# Run the suite's own checks (typecheck, check:docs, npm test, with and without run records) on the SOURCE first.
set -euo pipefail

source_branch="conformance/full-coverage-final5"
branch="publish/initial-commit-v6"
msg_file=""
execute=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source_branch="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    --message-file) msg_file="$2"; shift 2 ;;
    --execute) execute=1; shift ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "build-publish-commit: $*" >&2; exit 1; }
umask 002

git rev-parse --git-dir >/dev/null 2>&1 || fail "not inside a git repository"
git rev-parse --verify --quiet "refs/heads/$source_branch" >/dev/null || fail "no such source branch: $source_branch"
git check-ref-format "refs/heads/$branch" || fail "bad branch name: $branch"
if git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then fail "branch exists, not overwriting: $branch"; fi
[ "$(git config --get commit.gpgsign || true)" = "true" ] || fail "commit.gpgsign is not true; signing must stay on"

# Dirty check: only for the worktree that has the source branch checked out (if any).
wt="$(git worktree list --porcelain | awk -v b="refs/heads/$source_branch" '/^worktree /{p=$2} $0=="branch " b {print p}')"
if [ -n "$wt" ] && [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ]; then fail "uncommitted tracked changes in $wt"; fi

src_commit="$(git rev-parse "refs/heads/$source_branch^{commit}")"
src_tree="$(git rev-parse "$src_commit^{tree}")"

# Files that live on the working branch only and are never published (matched by base name at any depth).
PUBLISH_EXCLUDE_RE='(^|/)CLAUDE\.md$'
excluded="$(git ls-tree -r --name-only "$src_tree" | grep -E "$PUBLISH_EXCLUDE_RE" || true)"
if [ -n "$excluded" ]; then
  # Build the published tree in a throwaway index (plumbing only: no checkout, no index of the repository, no working tree).
  idx="$(mktemp -u)"; trap 'rm -f "$idx"' EXIT
  tree="$(export GIT_INDEX_FILE="$idx"; git read-tree "$src_tree" && printf '%s\n' "$excluded" | git update-index --force-remove --stdin && git write-tree)"
  rm -f "$idx"
else
  tree="$src_tree"
fi
[ -z "$(git ls-tree -r --name-only "$tree" | grep -E "$PUBLISH_EXCLUDE_RE" || true)" ] || fail "an excluded file is still in the published tree"

bad="$(git ls-tree -r --name-only "$tree" | grep -E '(^|/)(runs|results-local|node_modules)/|(^|/)\.keep-until$' || true)"
[ -z "$bad" ] || fail "the tree holds files that must not be published: $(echo "$bad" | head -5 | tr '\n' ' ')"

# Content checks on the tree itself (the same rule as test/hygiene.test.ts, which runs on the source first).
s="/"
paths="${s}home${s}|${s}srv${s}|${s}var${s}tmp${s}|(^|[[:space:]'\"\`(=:])${s}tmp${s}"
badpaths="$(git grep -I -n -E "$paths" "$tree" -- . | grep -v 'CLAUDE.md:.*Scan before committing' || true)"
[ -z "$badpaths" ] || fail "the tree holds local filesystem paths: $(echo "$badpaths" | head -3 | cut -c1-120 | tr '\n' ' ')"
badattr="$(git grep -I -n -i -E '^[[:space:]>*-]*co-authored-by:|generated with \[?claude' "$tree" -- . || true)"
[ -z "$badattr" ] || fail "the tree carries an AI or tool attribution: $(echo "$badattr" | head -3 | cut -c1-120 | tr '\n' ' ')"

default_message() {
  cat <<'MSG'
Initial commit: draft trust-task conformance suite for DTGWG review

Draft proposal for discussion and review by the DTGWG. Black-box JSON
vectors, JSON-RPC adapters, tiered results, ceremony scenarios and dated
decisions. Run records are kept outside the repository. Apache-2.0.
MSG
}
msg="$(mktemp)"; trap 'rm -f "$msg" "${idx:-}"' EXIT
if [ -n "$msg_file" ]; then cat "$msg_file" > "$msg"; else default_message > "$msg"; fi
if grep -qiE 'co-authored-by|generated with|claude|anthropic' "$msg"; then fail "the message carries an AI or tool attribution; remove it"; fi
if ! grep -q '^Signed-off-by: ' "$msg"; then
  printf '\nSigned-off-by: %s <%s>\n' "$(git config user.name)" "$(git config user.email)" >> "$msg"
fi

files="$(git ls-tree -r --name-only "$tree" | wc -l | tr -d ' ')"
echo "source:   $source_branch ($src_commit)"
echo "tree:     $tree ($files files; source tree $src_tree, excluded: $(printf '%s' "${excluded:-none}" | tr '\n' ' '))"
echo "new:      orphan branch $branch, one root commit, signed (commit.gpgsign=true), signed-off"
echo "message:"; sed 's/^/  | /' "$msg"

if [ "$execute" -ne 1 ]; then
  echo "DRY RUN: nothing written. Would run:"
  echo "  commit=\$(git commit-tree -S $tree -F <message>)"
  echo "  git update-ref refs/heads/$branch \$commit"
  echo "Nothing is pushed by this script. Add --execute to build the commit."
  exit 0
fi

commit="$(git commit-tree -S "$tree" -F "$msg")"
git update-ref "refs/heads/$branch" "$commit" ""   # the empty old value makes the update fail if the branch appeared meanwhile
echo "created $branch at $commit (local only; nothing pushed)"
git log -1 --format='%h %G? %s' "$branch"
