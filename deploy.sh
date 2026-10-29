#!/usr/bin/env bash
set -Eeuo pipefail
# Safe deployment of RINLU on TCP/80 only. Never touches 443/943/1194/51820/51821.
NAME='rinlu-web'; IMAGE='rinlu-web'; DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$EUID" -ne 0 ]]; then echo 'Run: sudo bash deploy.sh' >&2; exit 1; fi
command -v docker >/dev/null || { echo 'Docker missing; install Docker Engine first.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl missing; sudo apt-get install -y curl' >&2; exit 1; }
if ss -H -ltn '( sport = :80 )' | grep -q . && ! docker ps --format '{{.Names}}' | grep -Fxq "$NAME"; then
  echo 'ABORT: TCP/80 is already occupied by another service. Existing services left unchanged.' >&2
  ss -ltnp '( sport = :80 )' >&2 || true; exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -Fxq "$NAME"; then
  OLD_ID="$(docker inspect -f '{{.Image}}' "$NAME")"; docker tag "$OLD_ID" "$IMAGE:rollback"
else OLD_ID=''; fi
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
echo "Building $IMAGE:$RELEASE ..."
docker build -t "$IMAGE:$RELEASE" "$DIR"
if [[ -n "$OLD_ID" ]]; then docker rm -f "$NAME" >/dev/null; fi
start_container(){ docker run -d --name "$NAME" --restart unless-stopped --memory 256m --cpus 0.5 --security-opt no-new-privileges -p 0.0.0.0:80:80 "$1" >/dev/null; }
if ! start_container "$IMAGE:$RELEASE"; then
  echo 'New container could not start.' >&2
  if [[ -n "$OLD_ID" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; start_container "$IMAGE:rollback" || true; fi
  exit 1
fi
healthy=0
for i in $(seq 1 20); do if curl -fsS --max-time 2 http://127.0.0.1/healthz >/dev/null; then healthy=1; break; fi; sleep 1; done
if [[ "$healthy" -ne 1 ]]; then
  echo 'Health check FAILED; restoring prior image when available.' >&2
  docker logs --tail 80 "$NAME" >&2 || true; docker rm -f "$NAME" >/dev/null || true
  if [[ -n "$OLD_ID" ]]; then start_container "$IMAGE:rollback" || true; fi
  exit 1
fi
docker tag "$IMAGE:$RELEASE" "$IMAGE:current"
echo 'SUCCESS: RINLU is healthy on http://127.0.0.1:80/ and public TCP/80 (if firewall permits).'
docker ps --filter "name=^/${NAME}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo 'VPN ports were not changed. HTTPS/443 is intentionally not configured.'

# Optional processor: configured separately from the website; no incoming ports.
if [[ -f /home/ubuntu/rinlu-worker.env && ! -L /home/ubuntu/rinlu-worker.env ]]; then
  install -d -m 700 /etc/rinlu
  install -o root -g root -m 600 /home/ubuntu/rinlu-worker.env /etc/rinlu/worker.env
  bash "$DIR/services/ovh/deploy-worker.sh"
fi
