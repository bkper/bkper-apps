#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git_config() {
    git config user.email test@example.com
    git config user.name "Test User"
}

mkdir "$tmp_dir/origin.git"
git init --bare --initial-branch=main "$tmp_dir/origin.git" >/dev/null

git clone "$tmp_dir/origin.git" "$tmp_dir/seed" >/dev/null 2>&1
(
    cd "$tmp_dir/seed"
    git_config
    echo initial > app.txt
    git add app.txt
    git commit -m "initial" >/dev/null
    git push origin main >/dev/null 2>&1
    git switch -c dev >/dev/null 2>&1
    echo dev-one >> app.txt
    git commit -am "dev one" >/dev/null
    git push origin dev >/dev/null 2>&1
)

git clone "$tmp_dir/origin.git" "$tmp_dir/work" >/dev/null 2>&1
(
    cd "$tmp_dir/work"
    git_config
    git switch dev >/dev/null 2>&1
    echo dev-two >> app.txt
    git commit -am "dev two" >/dev/null
)

(
    cd "$tmp_dir/seed"
    git switch main >/dev/null 2>&1
    echo hotfix > hotfix.txt
    git add hotfix.txt
    git commit -m "main hotfix" >/dev/null
    git push origin main >/dev/null 2>&1
)

(
    cd "$tmp_dir/work"
    bash "$repo_root/scripts/gitmain.sh" >/dev/null
    [[ "$(git branch --show-current)" == "main" ]]
    git merge-base --is-ancestor origin/main main
    [[ "$(git rev-parse main)" != "$(git rev-parse origin/main)" ]]

    git push origin main >/dev/null 2>&1
    bash "$repo_root/scripts/gitdev.sh" >/dev/null
    [[ "$(git branch --show-current)" == "dev" ]]
    [[ "$(git rev-parse dev)" == "$(git rev-parse origin/main)" ]]

    echo dev-three >> app.txt
    git commit -am "dev three" >/dev/null
    bash "$repo_root/scripts/gitmain.sh" >/dev/null
    [[ "$(git branch --show-current)" == "main" ]]
)
