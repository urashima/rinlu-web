# RINLU | Music — OVH Docker deployment

GitHub Actions deploys two experiences to OVH. The static artist website serves Chinese, English, and Japanese pages at the root domain. The Docker music platform at `/music/` builds from the canonical ChatGPT Sites release.

## Scope and safety

- Target: `15.204.93.44`, OVH VPS, SSH user `ubuntu`.
- Deploys one Docker container `rinlu-web` on **TCP 80 only**. It does **not** edit any existing container, VPN configuration, Nginx instance, 443, 943, 1194, 51820, or 51821.
- Before initial deployment, `deploy.sh` aborts if TCP 80 is occupied by something other than `rinlu-web`.
- Docker image is built before the existing `rinlu-web` container is replaced. If the new version fails its local HTTP health check, the script attempts to restore the previous image. Keep the package directory intact.
- `rinlu.com` DNS should stay unchanged until the IP-based HTTP site is verified. The root-domain A records can then be updated to OVH when ready; platform-specific TXT records can be removed later only after retiring the ChatGPT Sites binding.
- On initial deployment, **HTTPS is not configured**. Most browsers will need `http://15.204.93.44/` explicitly. Do not move OpenVPN 443 yet.

## First deployment: Windows PowerShell / macOS Terminal

Download `RINLU_OVH_Docker.tar.gz` to your computer. In a terminal from its download folder:

```sh
scp RINLU_OVH_Docker.tar.gz ubuntu@15.204.93.44:/tmp/
ssh ubuntu@15.204.93.44
```

Then, on OVH server, run:

```sh
# Non-destructive preflight (sends no changes to VPN)
tar -xzf /tmp/RINLU_OVH_Docker.tar.gz -C /tmp/
cd /tmp/RINLU_OVH_Docker
bash check-server.sh

# Abort if 80 is used by an unrelated service; inspect the output first.
# Existing /opt/rinlu is used only for this website.
sudo mkdir -p /opt/rinlu
sudo cp -a /tmp/RINLU_OVH_Docker/. /opt/rinlu/
cd /opt/rinlu
sudo bash deploy.sh
sudo ufw allow 80/tcp
curl -fsSI http://127.0.0.1/ | head
curl -fsS http://127.0.0.1/healthz
```

Check `http://15.204.93.44/` **with the explicit `http://` prefix** on a separate device. If unavailable despite local health success, verify OVH network firewall inbound TCP 80, Ubuntu UFW rules, and public IP. If the VPS is shared with other sites, inspect and coordinate port use; do not force-kill port 80.

**Important:** `scp` may need your existing SSH authentication and host-key confirmation. Do not paste passwords or private SSH keys into ChatGPT.

## Updating the site

Update `site/` assets and text then rerun:

```sh
cd /opt/rinlu
sudo bash deploy.sh
```

To upload a newer release from your computer, use `scp` for the new tarball, extract it under `/tmp`, and copy its contents to `/opt/rinlu` as above, then run `deploy.sh`. Keep the previous package if you want to restore an older release manually. Docker preserves the previous image as `rinlu-web:rollback` upon successful redeployment.

## Site updates and deployment

For music-platform releases, publish the canonical ChatGPT Site first. The existing `.github/workflows/deploy.yml` downloads and verifies its corresponding-source release, builds the Docker platform, and checks the deployed hash at `https://rinlu.com/music/_release.json`. The workflow can run after a push to `main`, through a manual dispatch, or on its hourly schedule. The artist website assets remain in `site/`. To verify a rollout, compare `source_sha256` on OVH with `sha256` in the canonical `/source/manifest.json`.

## HTTPS / 443 phase (separate change)

Current `openvpn-as` was last known to publish TCP 443, TCP 943, UDP 1194; `wg-easy` uses 51820/UDP and 51821/TCP. Do not publish Docker website port 443 on this host yet. HTTPS needs either a deliberate OpenVPN TCP port migration (including server and client profiles and testing), or a correctly designed reverse-proxy/SNI plan. A naïve `443:443` mapping conflicts with OpenVPN-AS. Keep VPN usable until separate HTTPS cutover is ready.

## Helpful checks

```sh
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo ss -ltnp '( sport = :80 or sport = :443 )'
curl -I http://127.0.0.1/
curl -I http://127.0.0.1/favicon.ico
sudo docker logs --tail=100 rinlu-web
```

## Content notes

- Chinese links point to NetEase Cloud Music, and English and Japanese links point to Spotify.
- The site has Chinese, English, and Japanese language pages.
- Artwork files in `site/assets/` are optimized WebP exports from the current site.