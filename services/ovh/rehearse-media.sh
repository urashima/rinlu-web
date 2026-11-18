#!/usr/bin/env bash
# Run on the OVH host as an operator with Docker access.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
jobs=${1:-6}
if (( $# > 1 )) || [[ ! "$jobs" =~ ^([2-9]|1[0-2])$ ]]; then
  printf 'Usage: bash services/ovh/rehearse-media.sh [2-12 jobs]\n' >&2
  exit 2
fi

# Keep enough headroom for the existing site and processor. Match the worker cap.
available_mib=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)
if (( available_mib < 2300 )); then
  printf 'Available memory is %s MiB. Run the rehearsal during a quieter window.\n' "$available_mib" >&2
  exit 3
fi

# Resolve the image belonging to the running worker, including an untagged image
# after a rebuild. Mount only the source and scanner database, both read-only.
image=$(docker container inspect --format '{{.Image}}' rinlu-processor-media-worker-1)
docker volume inspect rinlu-processor_signatures >/dev/null
exec docker run --rm --init --name rinlu-media-rehearsal --pull=never \
  --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 2g --cpus 1 --pids-limit 64 --tmpfs /tmp:size=256m,mode=1777 \
  --mount type=volume,src=rinlu-processor_signatures,dst=/var/lib/clamav,readonly \
  --mount "type=bind,src=$repo_root/services/media-worker,dst=/qa,readonly" \
  --entrypoint python3 "$image" /qa/rehearse.py --jobs "$jobs"
