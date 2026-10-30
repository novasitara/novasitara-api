#!/usr/bin/env bash
# Deploys the committed code of this repo (HEAD) to the VPS: upload, install, build, migrate, restart.
# Run from the novasitara-api folder after deploy/setup-server.sh has been run once:
#   SERVER=root@103.135.230.42 SSH_PORT=7576 SSH_KEY=~/.ssh/novasitara_vps bash deploy/deploy.sh
set -euo pipefail

: "${SERVER:?Set SERVER, e.g. SERVER=root@103.135.230.42}"
SSH_OPTS=(-p "${SSH_PORT:-22}")
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY")
APP_DIR=/var/www/novasitara-api

[ -z "$(git status --porcelain)" ] || echo "Note: uncommitted changes are not deployed, only the last commit is."

echo "Uploading $(git rev-parse --short HEAD)..."
git archive HEAD | ssh "${SSH_OPTS[@]}" "$SERVER" "tar -x -C $APP_DIR && chown -R novasitara:novasitara $APP_DIR"

REMOTE=$(cat <<'EOF'
set -euo pipefail
cd /var/www/novasitara-api
as_app() { sudo -H -u novasitara "$@"; }
as_app npm ci --no-audit --no-fund
as_app npm run build
as_app npm run db:deploy
systemctl restart novasitara-api
for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3000/api/jobs >/dev/null 2>&1 && { echo "API is up."; exit 0; }
  sleep 1
done
echo "API did not come up. See: journalctl -u novasitara-api -n 50" >&2
exit 1
EOF
)
ssh "${SSH_OPTS[@]}" "$SERVER" "$REMOTE"
