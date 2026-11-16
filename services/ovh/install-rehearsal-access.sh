#!/usr/bin/env bash
# Install the reviewed rehearsal under root ownership before granting one sudo command.
set -euo pipefail

if (( EUID != 0 )); then
  echo 'Run this installer from an OVH administrator session using sudo.' >&2
  exit 2
fi

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
target=/opt/rinlu-media-rehearsal
rule=/etc/sudoers.d/rinlu-media-rehearsal
if [[ -e "$target" || -L "$target" || -e "$rule" || -L "$rule" ]]; then
  echo 'A rehearsal installation already exists. Review it before replacing it.' >&2
  exit 3
fi
id ubuntu >/dev/null

install -o root -g root -m 0755 -d "$target/services/ovh" "$target/services/media-worker"
install -o root -g root -m 0755 "$repo_root/services/ovh/rehearse-media.sh" "$target/services/ovh/rehearse-media.sh"
for file in rehearse.py worker.py media_validation.py audio_analysis.py mail_delivery.py; do
  install -o root -g root -m 0644 "$repo_root/services/media-worker/$file" "$target/services/media-worker/$file"
done

staged=$(mktemp /etc/sudoers.d/.rinlu-media-rehearsal.XXXXXX)
trap 'rm -f -- "$staged"' EXIT
printf '%s\n' 'ubuntu ALL=(root) NOPASSWD: /opt/rinlu-media-rehearsal/services/ovh/rehearse-media.sh 6' > "$staged"
chmod 0440 "$staged"
visudo -cf "$staged"
mv -T -- "$staged" "$rule"
printf 'Installed the fixed six-job rehearsal command for ubuntu.\n'
