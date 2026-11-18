#!/usr/bin/env bash
set -Eeuo pipefail
# The existing Caddy HTTPS service and VPN remain managed independently.
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ "$EUID" -eq 0 ]] || { echo 'Run using the existing root publisher.' >&2; exit 1; }
for tool in docker curl ss; do command -v "$tool" >/dev/null; done
if ss -H -ltn '( sport = :80 )' | grep -q . && ! docker ps --format '{{.Names}}' | grep -Fxq rinlu-web; then
 echo 'ABORT: another service owns TCP/80.' >&2; exit 1
fi
[[ -f "$DIR/platform-runtime/public/_release.json" ]] || { echo 'Missing verified platform release.' >&2; exit 1; }
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
OLD_WEB=''; OLD_PLATFORM=''
if docker inspect rinlu-web >/dev/null 2>&1; then OLD_WEB="$(docker inspect -f '{{.Image}}' rinlu-web)"; fi
if docker inspect rinlu-platform >/dev/null 2>&1; then OLD_PLATFORM="$(docker inspect -f '{{.Image}}' rinlu-platform)"; fi
# Build both images before altering running containers.
docker build -t "rinlu-platform:$RELEASE" "$DIR/platform-runtime"
docker build -t "rinlu-web:$RELEASE" "$DIR"
docker network inspect rinlu-music >/dev/null 2>&1 || docker network create rinlu-music >/dev/null
install -d -m 700 /etc/rinlu
google_env=/home/ubuntu/rinlu-google.env
if [[ -f "$google_env" && ! -L "$google_env" ]]; then
 install -o root -g root -m 600 "$google_env" /etc/rinlu/google.env.new
 mv /etc/rinlu/google.env.new /etc/rinlu/google.env
 rm -f "$google_env"
fi
[[ -s /etc/rinlu/google.env ]]
start_platform(){ docker run -d --name rinlu-platform --network rinlu-music --restart unless-stopped --read-only --tmpfs /tmp:size=16m --memory 256m --cpus 1 --pids-limit 100 --cap-drop ALL --security-opt no-new-privileges --env-file /etc/rinlu/google.env -e NODE_ENV=production "$1" >/dev/null; }
start_web(){ docker run -d --name rinlu-web --network rinlu-music --restart unless-stopped --memory 256m --cpus 0.5 --security-opt no-new-privileges -p 0.0.0.0:80:80 "$1" >/dev/null; }
rollback(){
 echo 'Deployment failed; restoring the previous containers.' >&2
 docker logs --tail 30 rinlu-platform >&2 || true
 docker logs --tail 30 rinlu-web >&2 || true
 docker rm -f rinlu-web rinlu-platform >/dev/null 2>&1 || true
 if [[ -n "$OLD_PLATFORM" ]]; then start_platform "$OLD_PLATFORM" || true; fi
 if [[ -n "$OLD_WEB" ]]; then start_web "$OLD_WEB" || true; fi
}
trap rollback ERR
docker rm -f rinlu-web rinlu-platform >/dev/null 2>&1 || true
start_platform "rinlu-platform:$RELEASE"
start_web "rinlu-web:$RELEASE"
healthy=0
for i in $(seq 1 30); do
 if curl -fsS --max-time 2 http://127.0.0.1/healthz >/dev/null && curl -fsS --max-time 2 http://127.0.0.1/music/healthz >/dev/null && curl -fsS --max-time 2 http://127.0.0.1/music/ >/dev/null; then healthy=1; break; fi
 sleep 1
done
[[ "$healthy" -eq 1 ]]
curl -fsS --max-time 20 http://127.0.0.1/music/api/catalog | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("tracks"),list)'
docker tag "rinlu-platform:$RELEASE" rinlu-platform:current
docker tag "rinlu-web:$RELEASE" rinlu-web:current
trap - ERR
echo 'RINLU website and Docker platform /music/ are healthy.'
docker ps --filter network=rinlu-music --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
# Preserve a running processor when its source and configuration did not change.
if [[ -f /home/ubuntu/rinlu-worker.env && ! -L /home/ubuntu/rinlu-worker.env ]]; then
 install -d -m 700 /etc/rinlu
 install -o root -g root -m 600 /home/ubuntu/rinlu-worker.env /etc/rinlu/worker.env
 PROCESSOR_HASH="$(find "$DIR/services/media-worker" "$DIR/services/ovh" -type f ! -path '*/__pycache__/*' ! -name '*.pyc' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
 PREVIOUS_HASH="$(cat /etc/rinlu/processor-release.sha256 2>/dev/null || true)"
 if [[ "$(docker inspect -f '{{.State.Running}}' rinlu-processor-media-worker-1 2>/dev/null || true)" == true && ( -z "$PREVIOUS_HASH" || "$PREVIOUS_HASH" == "$PROCESSOR_HASH" ) ]]; then
   echo 'Preserving the running processor; this release does not change it.'
 else
   bash "$DIR/services/ovh/deploy-worker.sh"
 fi
 printf '%s\n' "$PROCESSOR_HASH" > /etc/rinlu/processor-release.sha256
 chmod 600 /etc/rinlu/processor-release.sha256
fi
