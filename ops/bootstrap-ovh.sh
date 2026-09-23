#!/usr/bin/env bash
# One-time OVH initialization; run ON THE SERVER after reviewing it.
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run: sudo bash ops/bootstrap-ovh.sh' >&2; exit 1; }
[[ -d /home/ubuntu && $(id -u ubuntu 2>/dev/null) ]] || { echo 'Expected deployment user ubuntu not found.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker Engine is required; not installing it automatically.' >&2; exit 1; }
docker info >/dev/null || { echo 'Docker Engine is not running.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required.' >&2; exit 1; }
command -v visudo >/dev/null || { echo 'visudo is required.' >&2; exit 1; }
if ! command -v rsync >/dev/null; then
  echo 'Installing rsync for website file sync.'
  apt-get update && apt-get install -y rsync
fi
if ss -H -ltn '( sport = :80 )' | grep -q . && ! docker ps --format '{{.Names}}' | grep -Fxq 'rinlu-web'; then
  echo 'TCP/80 is occupied; refusing to proceed. Existing service left untouched.' >&2
  ss -ltnp '( sport = :80 )' >&2 || true
  exit 1
fi
install -d -m 0700 -o ubuntu -g ubuntu /home/ubuntu/rinlu-staging
install -d -m 0755 /opt/rinlu
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
install -o root -g root -m 0755 "$SCRIPT_DIR/rinlu-publish" /usr/local/sbin/rinlu-publish
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
printf '%s\n' 'ubuntu ALL=(root) NOPASSWD: /usr/local/sbin/rinlu-publish' > "$TMP"
chmod 0440 "$TMP"
visudo -cf "$TMP"
install -o root -g root -m 0440 "$TMP" /etc/sudoers.d/rinlu-publish
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
fi
echo 'Bootstrap complete: site deploy user=ubuntu, staging directory ready, only rinlu-publish has passwordless sudo.'
echo 'Existing 443/943/1194/51820/51821 ports and VPN configuration were not modified.'
echo 'Next: run the GitHub Actions workflow after adding repository secrets.'
