# RINLU | GitHub Actions → OVH Docker

Status: This folder is a **prepared deployment project**, not a deployed website. Do not modify `rinlu.com` DNS until `http://15.204.93.44/` is verified from outside OVH.

## Architecture

Private GitHub repo (`rinlu-web`) → push `main` → GitHub-hosted Actions runner → SSH `ubuntu@15.204.93.44` → staging `/home/ubuntu/rinlu-staging` → root-owned `/usr/local/sbin/rinlu-publish` → Docker `rinlu-web` bound only on TCP/80. Existing OpenVPN/WireGuard ports are not changed. This is an independent reconstruction of the ChatGPT Sites project, not an export of its original HTML/CSS/JS.

## 1. Create and populate private GitHub repo

Create an **empty PRIVATE** repository named `rinlu-web` on https://github.com/new with default branch `main`. Do not initialize it with a README. Upload/commit the **contents of this folder** including hidden `.github/workflows/deploy.yml` and `site/assets/*.webp`. Uploading just the ZIP file does NOT populate the source repository. Alternatively use standard `git init`, `git add`, `git commit`, `git remote add origin`, and `git push` to upload this folder.

Do not put SSH private keys, VPN client profiles, credentials, or `.env` secrets into this repository.

## 2. Create one dedicated SSH identity on your own trusted terminal

Do NOT copy an existing personal SSH private key into GitHub Actions. Generate a unique, deploy-only Ed25519 key:

    ssh-keygen -t ed25519 -f ~/.ssh/rinlu_ovh_actions -C rinlu-actions -N ''

Install its PUBLIC half on the server (`ubuntu` user), by using an existing authenticated SSH session. Example on macOS/Linux:

    cat ~/.ssh/rinlu_ovh_actions.pub | ssh ubuntu@15.204.93.44 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'

For Windows use PowerShell to copy the public key to the VPS with an authenticated session, or the OVH web console; do not post the private key in ChatGPT. Verify key-based authentication with `ssh -i ~/.ssh/rinlu_ovh_actions ubuntu@15.204.93.44`.

## 3. Pin verified host identity

Obtain OVH's SSH server public-host-key fingerprint through an already trusted SSH session/OVH console and compare it to the `ssh-keyscan -p 22 15.204.93.44` result. Store the verified `ssh-ed25519` (or actual enabled type) known_hosts line, not a blindly accepted key. Your trusted computer's already verified `~/.ssh/known_hosts` entry is also suitable. For non-default SSH port, known_hosts host format is `[15.204.93.44]:PORT`.

## 4. One-time server bootstrap (trusted SSH or OVH console)

Copy this project to OVH once, for example with `scp -r`, or `git clone` after authorizing your private GitHub repo. Then from the project directory on the server:

    bash check-server.sh
    sudo bash ops/bootstrap-ovh.sh

The bootstrap installs `rsync` if missing, creates staging, installs the root-owned publish command, grants `ubuntu` passwordless permission for **that command only**, and opens TCP/80 in UFW only if UFW is active. It does not touch TCP/443, 943, UDP/1194, UDP/51820 or TCP/51821. Inspect all scripts before running them. Docker Engine must already work. Review OVH network firewall for TCP/80 separately.

Note: Anyone able to push code to the trusted deployment branch controls website Docker build inputs; secure repo access and enable branch protection. Do not enable pull-request workflow execution using production secrets.

## 5. Add four repository secrets (do not send values in ChatGPT)

GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

* `OVH_HOST`: `15.204.93.44`
* `OVH_USER`: `ubuntu`
* `OVH_SSH_KEY`: full contents of dedicated `~/.ssh/rinlu_ovh_actions` PRIVATE key.
* `OVH_KNOWN_HOSTS`: VERIFIED known_hosts entry for this server.

Optional repository variable `OVH_SSH_PORT` (default `22`). The private key is stored only in GitHub Actions Secrets, not repo code or this chat.

## 6. Deploy and test

GitHub repo → Actions → **Deploy RINLU to OVH (HTTP 80)** → Run workflow. The workflow also runs automatically on future pushes to `main`. Verify both logs and `http://15.204.93.44/`, and check Docker/VPN status on the server. Only after HTTP validation should you change the site's DNS. HTTPS and OpenVPN TCP/443 remapping are a separate controlled change.

## After setup

Keep GitHub as canonical website source. Changes inside ChatGPT Sites alone do NOT sync to GitHub automatically. ChatGPT can update the GitHub repository when it is visible to the connected GitHub app, then GitHub Actions publishes it to OVH.
