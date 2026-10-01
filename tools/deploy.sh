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
echo "Still to do if this was the FIRST deploy — see DEPLOY-DAY.md:"
echo "  - the GA4 property, then fill data-ga-id in site/index.html and redeploy"
echo "  - Search Console, both property kinds, sitemap submitted to both"
echo "  - the card on nodejavascript.com"
echo "  - the theme register and the compliance check"
