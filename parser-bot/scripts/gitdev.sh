#!/usr/bin/env bash
set -euo pipefail

stash_name=""

if [[ -n "$(git status --porcelain)" ]]; then
    stash_name="auto-stash gitdev $(date +%s)"
    git stash push -u -m "$stash_name"
fi

on_error() {
    echo ""
    if git rebase --show-current-patch &>/dev/null; then
        echo "⚠️  Rebase conflict detected. To resolve:"
        echo "   1. Fix conflicts and run: git rebase --continue"
        echo "   2. Or abort with: git rebase --abort"
    else
        echo "❌ Command failed."
    fi
    if [[ -n "$stash_name" ]]; then
        echo "   Your changes are stashed. Restore with: git stash pop"
    fi
}
trap on_error ERR

git fetch origin
git switch dev

if git merge-base --is-ancestor origin/dev dev; then
    echo "✅ dev already contains origin/dev."
elif git merge-base --is-ancestor dev origin/dev; then
    git merge --ff-only origin/dev
elif [[ "$(git rev-parse dev)" == "$(git rev-parse origin/main)" ]] && ! git cherry origin/main origin/dev | grep -q '^+'; then
    echo "✅ origin/dev is stale after release; keeping dev aligned with origin/main."
else
    echo "⚠️  Cannot fast-forward dev to origin/dev. Branches have diverged."
    echo "   Resolve manually before continuing."
    exit 1
fi

git rebase origin/main

if [[ -n "$stash_name" ]]; then
    git stash pop
fi

echo "✅ dev is rebased onto origin/main. Ready for continued work."
