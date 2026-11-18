# RINLU on existing OVH

## Verified capacity

Read-only Actions run `40816036504`, job `123257194012`: 2 CPU cores, 3814 MiB RAM, 2577 MiB available, 26813 MiB disk free, Docker 29.1.3, Compose 2.40.3, existing website `/healthz` = `ok`. SSH deploy user cannot access Docker directly; the root-owned `rinlu-publish` entry point is authorized. These are a point-in-time capacity check, not an operational scanner/load test.

Existing `rinlu-web` publishes HTTP 80. Repository documentation records OpenVPN using 443; its current configuration and HTTPS must be inspected by the server owner before changing domain termination. This project does not modify VPN or 443.

## Worker deployment

1. Use an authorized server administration session. Keep source outside `/opt/rinlu`, which the existing website publisher replaces with `rsync --delete`.
2. Place this repository under `/opt/rinlu-platform`.
3. Prepare root-owned mode-600 `/etc/rinlu/worker.env` using the worker configuration below. Supply secrets through a secure administration surface, never commit them.
4. Run `bash services/ovh/preflight.sh`, then `sudo bash services/ovh/deploy-worker.sh`.
5. Verify the scanner heartbeat in the platform admin, upload an authorized real recording, wait for scan and transcode, review it, play and unpublish it. Do not disable manual beta or mark S01/P21 complete before this succeeds.

The container has no inbound ports, drops capabilities, runs as a non-root user and is bounded to 1 CPU / 2 GiB, with read-only filesystem, temporary job storage, and persistent signature volume. The memory cap must be validated against the current signature set; if the scanner cannot fit, stop it and reassess available memory before increasing limits.

Required environment names:

```
RINLU_ORIGIN=https://sonora-independent-music.kai-ma.chatgpt.site
RINLU_PROCESSOR_TOKEN=<same configured PROCESSOR_TOKEN in the hosted platform>
RINLU_SITES_ACCESS_TOKEN=<supported private Site service credential when required>
```

The legacy SONORA_* names remain accepted for existing installations. Renaming the public brand does not rotate or invalidate service authentication.

To stop only this processor: `docker compose --project-name rinlu-processor --env-file /etc/rinlu/worker.env -f services/media-worker/compose.yaml stop`. No website or VPN container is stopped.

## F-002b media worker rehearsal and acceptance

From the reviewed checkout on OVH, run during a quiet window:

```bash
sudo bash services/ovh/rehearse-media.sh 6
```

This starts a disposable container from the image used by the existing processor and reads its ClamAV signature volume. The runner waits for FFmpeg to start, kills only its disposable process group with SIGKILL, then starts a new process and checks the MP3 it produces. The command records the scanner version, recovery time, queue wait, batch time and peak container memory. Keep the final JSON and the checked-out commit SHA in the acceptance record. Six 30-second samples give a baseline. Increase to 12 jobs for the next measurement if the first run fits the host's normal operating budget, and record the workload with the result.

For the separate hosted acceptance, use an independent creator account to upload a short audio file it has permission to publish. Record the asset ID, the scanner result and attempt count in Operations. Have a reviewer approve the clean rendition. Publish as unlisted, obtain playback in an unauthenticated session and confirm a byte-range request returns 206. Withdraw the recording, then verify both new playback authorization and the previously signed URL are denied. Record the action times and HTTP statuses. Keep account credentials and signed URL values out of the acceptance record.

## Domain and identity

The OVH public landing page may link to the private platform; it must identify the preview as requiring authorization. Copying the Worker bundle to Nginx will not migrate D1/R2 or trusted ChatGPT identity. A custom-domain binding or an explicit identity/data migration must be completed before treating rinlu.com as the full authenticated application.

## Secrets and mail

Processor and operations tokens have different permissions. SMTP credentials, sending domain and recipient verification are separate prerequisites. Existing deployment SSH secrets authorize the known website deployment; they do not establish that the worker's runtime secrets have been installed.
