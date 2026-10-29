#!/usr/bin/env bash
# Run as root from the checked-out repository. The website/VPN ports are untouched.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run this deployment using an authorized root session.' >&2; exit 1; }
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
ENV_FILE=/etc/rinlu/worker.env
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo 'Missing /etc/rinlu/worker.env; no changes made.' >&2; exit 2; }
[[ $(stat -c %u "$ENV_FILE") == 0 ]] || { echo 'Configuration must be owned by root.' >&2; exit 2; }
[[ $(stat -c %a "$ENV_FILE") == 600 ]] || { echo 'Configuration must have mode 600.' >&2; exit 2; }
# Only selected non-secret state is printed; never inspect container env.
CONTAINER=rinlu-processor-media-worker-1
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker inspect --format 'processor status={{.State.Status}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$CONTAINER"
  docker logs --tail 12 "$CONTAINER" 2>&1 || true
  docker stats --no-stream --format 'processor memory={{.MemUsage}} cpu={{.CPUPerc}}' "$CONTAINER" || true
fi
AVAILABLE_MB=$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
if (( AVAILABLE_MB < 2300 )); then echo 'Less than 2300 MB available; refusing to compete with the existing website.' >&2; exit 3; fi
FREE_MB=$(df -Pm / | awk 'NR==2 {print $4}')
if (( FREE_MB < 6000 )); then echo 'Less than 6 GB free; deployment refused.' >&2; exit 3; fi
# Build before starting/replacing worker; Compose has no published ports.
docker compose --project-name rinlu-processor --env-file "$ENV_FILE" -f "$ROOT/services/media-worker/compose.yaml" build
# No other Compose projects, website container or system firewall are modified.
docker compose --project-name rinlu-processor --env-file "$ENV_FILE" -f "$ROOT/services/media-worker/compose.yaml" up -d --no-build
printf 'Worker launched. Check processor heartbeat and a real upload before enabling automatic-only review.\n'
