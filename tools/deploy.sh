#!/usr/bin/env bash
#
# deploy.sh — build, test, publish, and then PROVE the publish landed.
#
# The house rule this script exists to keep is that a deploy must be VISIBLE. A
# client-rendered site can be deployed perfectly and still show a visitor the old
# page, and a shell with no cache header is how that happens. So this does not
# stop when rsync returns 0: it fetches the live bundle back and compares it with
# the one it just built, byte for byte, and refuses to call the deploy done if
# they differ.
#
#   bash tools/deploy.sh
#
# Nothing calls this automatically. The site is built and tested locally; a deploy
# is a separate instruction.

set -euo pipefail

HOST="dvs-sites"
ROOT="/srv/hominin-atlas"
DOMAIN="hominin-atlas.nodejavascript.com"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$HERE"

echo "== 1/5  build"
npm run build

echo "== 2/5  tests"
npm run test:all

echo "== 3/5  publish"
rsync -a --delete --exclude '.DS_Store' site/ "${HOST}:${ROOT}/"

echo "== 4/5  prove the deploy is real"
local_hash="$(shasum -a 256 site/app.js | cut -d' ' -f1)"
remote_hash="$(ssh "$HOST" "sha256sum ${ROOT}/app.js" | cut -d' ' -f1)"
if [ "$local_hash" != "$remote_hash" ]; then
  echo "FAIL: the served app.js is not the one that was built" >&2
  echo "  built  $local_hash" >&2
  echo "  served $remote_hash" >&2
  exit 1
fi
echo "  app.js matches  $local_hash"

for file in favicon-180.png apple-touch-icon.png favicon.svg favicon.ico; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/${file}")"
  [ "$code" = "200" ] || { echo "FAIL: ${file} returned ${code}" >&2; exit 1; }
  echo "  ${file} 200"
done

# The shell must not be cacheable, or a returning visitor keeps the old bundle and
# a correct deploy looks like no deploy at all (house part 7).
cache="$(curl -sI "https://${DOMAIN}/" | tr -d '\r' | awk 'tolower($1)=="cache-control:" {print $2}')"
case "$cache" in
  *no-store*) echo "  shell is no-store" ;;
  *) echo "FAIL: the shell is cacheable (${cache:-no header}), so a deploy can be invisible" >&2; exit 1 ;;
esac

echo "== 5/5  site audit"
"$HOME/Documents/git/gitlab.com/datavisionstudios/docker-compose-master/.venv/bin/python3" \
  ~/.seo_audit.py --site "$DOMAIN" || true

echo
echo "deployed: https://${DOMAIN}/"
echo

# The first-deploy set is CHECKED here, not asserted. This list used to print
# unconditionally, so on 2026-10-01 it was naming the Analytics property and Search
# Console as outstanding two deploys after both had been done — and a list that
# survives the work teaches the reader to ignore it. The two the repo can answer are
# read; the rest are named with the command that answers them. Record: DEPLOY-DAY.md.
todo=()

if grep -qE 'data-ga-id=""' site/index.html; then
  todo+=("Analytics — the page carries no measurement id: create the property, fill data-ga-id in site/index.html, then redeploy")
fi

if ! grep -q 'Sitemap:' site/robots.txt; then
  todo+=("robots.txt declares no Sitemap: line")
fi

if [ "${#todo[@]}" -eq 0 ]; then
  echo "first-deploy set — the two the repo can answer:"
  echo "  the measurement id is in the page   ·   robots.txt declares the sitemap"
  echo "the rest are answered by their own command, never by a list here:"
  echo "  Search Console, both kinds    python3 ~/.searchconsole_setup.py"
  echo "  the theme register, clashes   python3 ~/.nodejs_theme_register.py"
  echo "  the compliance check          python3 ~/.nodejs_compliance.py --save"
  echo "  the card on the apex          cd ../nodejavascript.com && node tools/projects.mjs"
else
  echo "Still to do before this is a finished site:"
  for item in "${todo[@]}"; do
    echo "  - ${item}"
  done
  echo
  echo "  and once those pass — see DEPLOY-DAY.md for the full set."
fi
