#!/usr/bin/env bash
# Called by .github/workflows/deploy-production.yml as the deploy user.
# Usage: rollout.sh ghcr.io/<owner>/crewflow-web:<sha>
set -euo pipefail

image="${1:?image reference required}"
cd /opt/crewflow360

printf 'CREWFLOW_WEB_IMAGE=%s\n' "$image" > deploy.env
compose=(docker compose --env-file deploy.env)

trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
"${compose[@]}" pull web
"${compose[@]}" up -d --remove-orphans web

for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null http://127.0.0.1:3100/pricing; then
    echo "CrewFlow360 web is healthy on $image"
    docker image prune -af --filter 'until=168h' >/dev/null || true
    exit 0
  fi
  sleep 2
done

"${compose[@]}" logs --tail 100 web
echo "CrewFlow360 web did not become healthy" >&2
exit 1
