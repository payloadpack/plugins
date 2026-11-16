#!/bin/bash
# Prints whether the change since <base> can alter what a demo runs, as `e2e=true|false` and
# `visual=true|false`, so CI runs the demo's suites only when they can catch something.
#
#   scripts/demo-tests.sh @apps/theme-demo [base, default origin/main]
#
# A change counts when it reaches the demo or a workspace package it builds from: a file other
# than docs, unit tests or the license, a package.json change beyond its metadata, a lockfile
# change to their dependencies or a global config file. A screenshot-only change counts for the
# visual suite alone.
set -euo pipefail

demo=$1
base=${2:-origin/main}

closure=$(bunx turbo ls "--filter=$demo..." --output=json)
paths=()
while read -r path; do paths+=("$path"); done < <(jq -r '.packages.items[].path' <<<"$closure")

# Turbo's reason for each changed package the demo builds from. Any reason but a changed file in
# the package or in one it depends on means its dependencies or the global config changed.
reasons=$(
  bunx turbo query "query { affectedPackages(base: \"$base\", head: \"HEAD\") { items { name reason { __typename } } } }" |
    jq -r --argjson closure "$closure" \
      '.data.affectedPackages.items[] | select(.name as $name | $closure.packages.items | any(.name == $name)) | .reason.__typename'
)

manifest() {
  git show "$1:$2/package.json" 2>/dev/null |
    jq -S 'del(.version, .description, .keywords, .homepage, .bugs, .repository, .author, .license)' || true
}

e2e=false
visual=false
if [[ -z $reasons ]]; then
  :
elif grep -qvxE 'FileChanged|DependencyChanged' <<<"$reasons"; then
  e2e=true
  visual=true
else
  pathspec=("${paths[@]}" ':!*.md' ':!*/LICENSE' ':!*/test/*' ':!*/vitest.config.ts' ':!*/package.json')
  git diff --quiet "$base" HEAD -- "${pathspec[@]}" ':!*.png' || e2e=true
  git diff --quiet "$base" HEAD -- "${pathspec[@]}" || visual=true
  for path in "${paths[@]}"; do
    if [[ $(manifest "$base" "$path") != "$(manifest HEAD "$path")" ]]; then
      e2e=true
      visual=true
    fi
  done
fi

echo "e2e=$e2e"
echo "visual=$visual"
