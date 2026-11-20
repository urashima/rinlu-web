# RINLU Site backend deployment for S3-only primary storage

Status: Canonical backend source patch verified against the publicly published RINLU Site source. **Not yet deployed into the independent Site runtime.**

## Why the GitHub PR alone cannot switch production

The OVH Docker deployment retrieves an AGPL corresponding-source archive from the separately hosted RINLU Site. It updates the frontend and gateway, **not** the original Cloudflare Worker routes or D1 environment. The Worker still owns the original upload, scanner, media, artwork, user, and review APIs.

This branch adds the following canonical Site source changes:
- canonical-patch/lib/s3-primary.ts: authenticated user, contributor consent, quotas, exact S3 keys, 192/320 kbps MP3 and JPEG validation, SHA-256, idempotent D1 asset + pending scan + audit, readiness checking.
- canonical-patch/lib/s3-primary-service.ts: leased processing jobs, checksum-verified S3 rendition, metadata-only completion, clean malware scan, and verified normalized artwork.
- canonical-patch/lib/media-storage.ts: private US OVH .ovh.us SigV4, per-key S3-only read, legacy R2 read fallback, refusal to write new R2 data.
- scripts/apply-canonical-s3-primary.mjs: applies these changes to the genuine Site lib/server.ts and lib/media-service.ts, blocks legacy uploads and unscanned beta approval, preserves all user/rights/review routes.

The existing D1 schema is reused: assets.metadata contains provider and nonce; media_jobs has a unique asset_id, lease, and scan/output state.

## Site release sequence (independent from Docker)

1. Open the real RINLU Site source project, **not** the OVH deployment mirror. Backup D1 data and record published source hash.
2. Retrieve the GitHub feature branch. Apply it to the genuine Site source directory with the command:
   node scripts/apply-canonical-s3-primary.mjs /path/to/original/site-source
   It fails closed if any source anchor has changed.
3. Publish the patched Site backend with RINLU_S3_ONLY=0 first. Confirm public and private songs, OAuth, upload compatibility, contributor rights, manual review and R2 legacy reads still work.
4. In the **Site Worker** environment, set OVH_S3_ENABLED=1, OVH_S3_REGION=us-east-va, OVH_S3_ENDPOINT=https://s3.us-east-va.io.cloud.ovh.us, and the existing bucket's OVH_S3_BUCKET. Supply bucket-scoped OVH_S3_ACCESS_KEY_ID and OVH_S3_SECRET_ACCESS_KEY privately. Keep RINLU_S3_ONLY=0 until the cutover window. Do not expose these credentials to a browser or HTML.
5. Publish the trusted OVH scanner Worker with RINLU_S3_PROCESSOR_MODE=1, verify fresh ClamAV signatures and a current s3_primary=ready heartbeat in canonical D1.
6. Drain the historical R2 processing queue to zero pending/processing jobs; keep all old R2 objects readable.
7. In a short controlled maintenance window set the Site Worker RINLU_S3_ONLY=1 and publish. The canonical GET /api/storage/s3/capabilities must now return contract rinlu-s3-primary-v1, provider ovh-s3, the exact bucket, database ready, scanner ready, processing ready, quarantine true and r2_dual_write false.
8. Only after this live verification, set GitHub Action variable OVH_S3_PRIMARY_ONLY=1 on OVH and publish the Docker gateway/worker.
9. Verify a real signed-in creator upload: browser POST directly to private S3; S3 CopyObject; metadata-only D1 commit; one pending malware scan; ClamAV, ffprobe and ffmpeg; S3 rendition; manual review; signed playback and HTTP 206 Range; no new R2 PUT.
10. Repeat for JPEG artwork, malformed MP3, malware detection, expired session, revoked owner, duplicated ticket, D1 outage and scanner outage. Nothing unscanned may publish.
11. Reconcile historical public/private/unlisted originals and their variants before planning a read-only R2 data purge. Never delete originals during the initial cutover.

## Rollback

Before any S3-only assets exist, return RINLU_S3_ONLY=0 on Site and OVH_S3_PRIMARY_ONLY=0 on GitHub and redeploy.

After an S3-only asset exists, preserve provider-aware S3 reads. If needed pause further uploads while reverting only the *write admission* mode. Switching all reads back to R2 will make newly uploaded S3-only media inaccessible. No S3 original should be overwritten, and no existing R2 data should be purged during this recovery.

## Verification status / current blocker

- Original S3-only D1, scanner and gateway safety tests: GitHub Actions CI.
- Backend source patch applied against the true publicly published Site source and frontend compilation: GitHub Actions.
- Real private OVH S3 CopyObject and SHA-256 test: GitHub Actions.
- Remaining hard blocker: available connectors can edit the GitHub/OVH Docker repository but **cannot publish into the independent ChatGPT Site / Cloudflare Worker or its D1 configuration**. Site ownership/workspace publishing access is required.
- Do not set either S3-only primary production switch until the live canonical Worker and scanner are verified.
