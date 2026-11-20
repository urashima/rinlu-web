# RINLU Upload MP3 >=192 kbps: CBR and VBR

## Acceptance policy

Only standard MPEG-1 Layer III MP3. The **duration-weighted average audio-frame bitrate** must be at least 192 kbps. Accept 192, 224, 256, and 320 kbps CBR, plus VBR with a valid actual average >=192. Individual VBR frames may be below 192. Standard MP3 tops out at 320 kbps.

Reject damaged or non-MP3 files, <192kbps averages, invalid/truncated frames, changing sample rates, files beyond current 25MiB limit, or audio outside the existing permitted duration. Continue to enforce copyright declarations, access control, ClamAV/ffprobe processing and manual review.

## Changes

- services/mp3-policy/mp3-upload-policy.ts: strict frame-level duration-weighted bitrate calculation; excludes ID3 album artwork bytes.
- scripts/apply-platform-mp3-upload.mjs: creator UI pre-validates before upload, explains the revised policy and displays average bitrate and CBR/VBR status.
- scripts/apply-canonical-mp3-policy.mjs: changes the original D1 / Cloudflare Worker inspectMp3(upload=true) logic so 224, 256 and >=192 VBR no longer get rejected by legacy CBR-only conditions; adjusts HTTP 415 explanation.
- Tests verify synthetically structured MP3s, original canonical inspectMp3 parser and official website/Docker packaging.

## Production activation boundary

This GitHub repository deploys the OVH Docker frontend, but **does not deploy the independent RINLU ChatGPT Sites / Cloudflare Worker backend**. The original canonical /api/upload endpoint still enforces 192-or-320-only CBR until its source is separately updated and published.

Publish the backend patch in the original Site workspace first. Do not merge and advertise the new uploader text on production before it works on the canonical server. Then merge the UI changes and deploy main. The in-progress S3-only primary-storage PR #20 must also include the new parser before that cutover.

Run creator account end-to-end verification with 256kbps CBR and >=192 average VBR, including S3 original, D1 asset registration, scan, moderation and playback. Confirm that 128kbps and <192 average VBR fail before transfer and create no draft asset. Do not delete original files or disable malware scanning.

## Rollback

Rollback the canonical parser and the frontend hint together. Existing R2/S3 media files do not need to change.
