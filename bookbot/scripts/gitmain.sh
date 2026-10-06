#!/usr/bin/env bash
set -euo pipefail

stash_name=""

if [[ -n "$(git status --porcelain)" ]]; then
    stash_name="auto-stash gitmain $(date +%s)"
    git stash push -u -m "$stash_name"
fi

on_error() {
    echo ""
    echo "❌ Command failed."
    if [[ -n "$stash_name" ]]; then
        echo "   Your changes are stashed. Restore with: git stash pop"
    fi
}
trap on_error ERR

git fetch origin

git switch main

if ! git merge --ff-only origin/main; then
    echo "⚠️  Cannot fast-forward main to origin/main. Branches have diverged."
    echo "   Resolve main manually before continuing."
    exit 1
fi

git switch dev

if git merge-base --is-ancestor origin/dev dev; then
    echo "✅ dev already contains origin/dev."
elif git merge-base --is-ancestor dev origin/dev; then
    git merge --ff-only origin/dev
elif ! git cherry main origin/dev | grep -q '^+'; then
    echo "✅ origin/dev is stale after release; continuing with local dev."
else
    echo "⚠️  Cannot fast-forward dev to origin/dev. Branches have diverged."
    echo "   Resolve dev manually before continuing."
    exit 1
fi

git rebase main

if git rev-list --merges main..dev | grep -q .; then
    echo "❌ Error: dev contains merge commits since main."
    exit 1
fi

git switch main

if ! git merge --ff-only dev; then
    echo "⚠️  Cannot fast-forward main to dev after rebasing."
    echo "   Resolve manually before continuing."
    exit 1
fi

if [[ -n "$stash_name" ]]; then
    git stash pop
fi

echo "✅ main is fast-forwarded to dev. Review and push when ready."
