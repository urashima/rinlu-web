# RINLU Docker platform deployment

The artist homepage stays at https://rinlu.com/. The complete music client runs at https://rinlu.com/music/ in the `rinlu-platform` Node container, behind the existing `rinlu-web` Nginx container and Caddy HTTPS terminator. There is no iframe. Both sites share the original D1/R2 business backend, accounts, songs, moderation, lyrics, games and sound presets.

`deploy.yml` obtains the canonical site's published AGPL corresponding-source archive, verifies archive and file hashes, builds the real React client at `/music/`, packages the Node gateway, and invokes the existing verified SSH publisher. Secrets stay in GitHub Actions. The gateway accepts only its own HttpOnly session cookie and never forwards browser-supplied identity headers. Sign-in uses short-lived, single-use PKCE codes issued by the original site; sessions honor current account roles and suspension.

Each push and manual workflow run publishes the website and current platform. A five-minute scheduled check compares the canonical source hash with `/music/_release.json` and deploys changes. GitHub may delay scheduled runs; final verification must compare hashes before reporting both sites current. Future platform work must include required files in the audited source archive, publish the GPT site, and verify the OVH workflow and release hash.

Docker deployment builds images before replacing containers, checks HTTP routing and the catalog, and restores previous images if checks fail. The platform runs without root, a writable root filesystem, host ports or Docker socket access. Caddy and VPN configuration are managed separately. Login states in memory are invalidated on container restart; listeners can restart sign-in.

Troubleshooting: inspect the Actions deployment run, `docker logs rinlu-platform`, `/music/healthz`, `/music/_release.json`. Never print or commit session cookies, SSH keys, or processor credentials.
