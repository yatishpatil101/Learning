#!/usr/bin/env bash
# apply_patches.sh — Apply migration patches 01-24 in sequence.
# Handles:
#   - "corrupt patch" errors (space-only context lines) by fixing .git/rebase-apply/patch
#   - "no changes" (already applied) by skipping
#   - Raw diff patches (migration 16, 22, 23) via git apply + manual commit
# Usage: bash scripts/apply_patches.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

fix_inflight_patch() {
  local patch_file=".git/rebase-apply/patch"
  if [[ -f "$patch_file" ]]; then
    python3 -c "
import sys
with open('$patch_file', 'rb') as f:
    data = f.read()
fixed = data.replace(b'\n \n', b'\n\n')
if fixed.startswith(b' \n'):
    fixed = b'\n' + fixed[2:]
count = data.count(b'\n \n')
with open('$patch_file', 'wb') as f:
    f.write(fixed)
print(f'  [fix] {count} space-only context lines normalized')
"
  fi
}

apply_mailbox_patch() {
  local patch="$1"
  local name="$(basename "$patch")"
  echo ">>> Applying mailbox patch: $name"

  local attempt=0
  local max_attempts=50

  # Start the am session
  git am --3way --ignore-whitespace "$patch" 2>&1 || true

  while git rev-parse --git-dir &>/dev/null && [[ -d ".git/rebase-apply" ]]; do
    attempt=$((attempt + 1))
    if [[ $attempt -gt $max_attempts ]]; then
      echo "  [ERROR] Too many iterations on $name — aborting"
      git am --abort 2>&1 || true
      return 1
    fi

    local status_out
    status_out=$(git status 2>&1)

    # Check for "nothing to commit" (already-applied patch)
    if echo "$status_out" | grep -q "nothing to commit"; then
      echo "  [skip] Patch already applied, skipping commit"
      git am --skip 2>&1 || true
      continue
    fi

    # Fix corrupt patch and retry
    if [[ -f ".git/rebase-apply/patch" ]]; then
      fix_inflight_patch
      git am --continue 2>&1 || true
    else
      break
    fi
  done

  echo "  [done] $name"
}

apply_raw_diff_patch() {
  local patch="$1"
  local name="$(basename "$patch")"
  local subject="$2"
  echo ">>> Applying raw diff patch: $name"

  local fixed_patch="${patch%.patch}.fixed.patch"
  # Fix space-only context lines
  python3 -c "
with open('$patch', 'rb') as f:
    data = f.read()
fixed = data.replace(b'\n \n', b'\n\n')
if fixed.startswith(b' \n'):
    fixed = b'\n' + fixed[2:]
with open('$fixed_patch', 'wb') as f:
    f.write(fixed)
count = data.count(b'\n \n')
print(f'  [fix] {count} space-only context lines')
"

  if git apply --whitespace=nowarn "$fixed_patch" 2>&1; then
    git add -A
    git commit -m "$subject" 2>&1 || echo "  [skip] Nothing to commit"
  else
    echo "  [warn] git apply failed for $name, trying with --reject"
    git apply --reject --whitespace=nowarn "$fixed_patch" 2>&1 || true
    git add -A
    git commit -m "$subject [partial]" 2>&1 || echo "  [skip] Nothing to commit"
  fi

  rm -f "$fixed_patch"
  echo "  [done] $name"
}

echo "=== Starting patch application ==="
echo ""

# Migration 01-15, 17-21, 24: mailbox format (git am)
for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 17 18 19 20 21 24; do
  patch_file="migration $n.patch"
  if [[ -f "$patch_file" ]]; then
    apply_mailbox_patch "$patch_file"
  else
    echo "  [missing] $patch_file"
  fi
  echo ""
done

# Migration 16: raw diff (no From: header)
if [[ -f "migration 16.patch" ]]; then
  apply_raw_diff_patch "migration 16.patch" "refactor: migration 16 — e2e and frontend refactoring"
fi
echo ""

# Migration 22: raw diff
if [[ -f "migration 22.patch" ]]; then
  apply_raw_diff_patch "migration 22.patch" "refactor: migration 22 — rename PuneNest to Draazy (partial)"
fi
echo ""

# Migration 23: raw diff
if [[ -f "migration 23.patch" ]]; then
  apply_raw_diff_patch "migration 23.patch" "refactor: migration 23 — rename PuneNest to Draazy (continued)"
fi
echo ""

echo "=== All patches processed ==="
echo ""
git log --oneline -10
