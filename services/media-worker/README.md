# RINLU processing service

Run this service on an independently provisioned Docker host (2 CPU / 2 GB minimum starting point). It requires outbound HTTPS and receives no inbound connections. The existing OVH host runs the worker through the reviewed GitHub Actions deployment. This directory also provides configuration for independently provisioned hosts.

1. Set `SONORA_ORIGIN` to the actual production HTTPS origin.
2. Generate a random processor secret in your secret manager. Set the same value as the Site runtime secret `PROCESSOR_TOKEN` and the host secret `SONORA_PROCESSOR_TOKEN`. Never enter it in source or a command argument.
3. While the Site is private, supply its supported service access token as `SONORA_SITES_ACCESS_TOKEN` using the host's secret environment injection.
4. Optionally configure a staffed HTTPS alert receiver with `SONORA_ALERT_WEBHOOK`; configure `ALERT_WEBHOOK_URL` in Sites for the console test.
5. From this directory run `docker compose up --build -d`. The container downloads fresh ClamAV signatures, performs a scanner probe, sends a heartbeat, and pulls leased jobs.
6. Check `/admin/operations`: scanner heartbeat must be recent; complete a real upload and confirm its job completes before independent review and publication.

The worker restricts FFmpeg protocols, rejects video/multistream uploads, scans both input and output, strips metadata, normalizes loudness, and produces 128 kbps stereo MP3. HLS and multiple bitrate output are not implemented. Compose caps resources, drops capabilities, uses a read-only root filesystem, and runs as a non-root user. Benchmark your actual recordings and concurrency before launch. The 32 MB rendition limit means long recordings may fail and require a shorter upload.

The maintenance call runs every minute, publishes due releases, expires rate limits, and initiates/advances daily database-and-media snapshots. These snapshots are in the same R2 bucket: independently provision offsite replication and retention. A stalled worker also stalls this schedule, so monitor it independently.

To rehearse recovery, download a completed database snapshot and its protected media prefix, then run `python3 scripts/operations/restore.py snapshot.json /new/isolated.db --media /downloaded/media`. Existing destination files are refused. Verify application behavior in an isolated deployment before recording recovery evidence. No production restore endpoint is exposed.

## SMTP notification adapter

The worker supports verified STARTTLS (default port 587) and implicit TLS (465) SMTP with `RINLU_SMTP_HOST`, `RINLU_SMTP_PORT` (default 587), `RINLU_SMTP_USER`, `RINLU_SMTP_PASSWORD` and `RINLU_MAIL_FROM`. Validate the sending domain and transport with your mail provider, then set Site `MAIL_ENABLED=1` and deploy. Until that setting is enabled, no notification emails are queued or sent. Only in-app notifications from the preceding day are eligible when enabling the service.

Outbox items have exclusive expiring leases, at most three delivery attempts and a stable Message-ID. Delivery is at-least-once: a worker crash after SMTP accepts the message but before acknowledgement can duplicate a notification. The API clears extra recipient/message copies after acknowledgement. Actual provider acceptance, inbox receipt and bounce handling still need an operator-run test; a simulated API acknowledgement does not prove external delivery.

Maintenance and mail attempts run before scanner initialization so a signature refresh failure cannot prevent the daily-backup/maintenance attempt indefinitely. External monitoring must still detect a stopped or repeatedly failing worker. `render.yaml` is a source blueprint based on Render's official Blueprint specification; it creates no resource by itself. The Git source must be made accessible to the verified Render account before deploying it there. [Blueprint reference](https://render.com/docs/blueprint-spec).

Legacy SONORA-prefixed environment variables remain supported. Plain SMTP is rejected; authentication occurs only after verified TLS. Retryable delivery failures wait at least one minute, then two minutes, with at most three attempts. SMTP permanent 5xx failures stop immediately and remain visible to administrators. Provider webhooks for asynchronous bounces and actual inbox receipt are still unconfigured.
