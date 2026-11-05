# RINLU publishing contract

Keep the artist homepage free of the music-platform preview entrance. The actual platform is mounted at `/music/`. Deployments use Docker through the existing OVH publisher. Preserve Caddy, VPN and processor configuration. Reuse encrypted GitHub Actions credentials.

Every platform feature release must update the canonical GPT site and OVH `/music/` from the same audited source archive. Verify matching `/source/manifest.json.sha256` and `/music/_release.json.source_sha256` before reporting both deployments complete. The scheduled workflow is a fallback, not proof that a release is already synchronized. See DOCKER_MUSIC.md.
