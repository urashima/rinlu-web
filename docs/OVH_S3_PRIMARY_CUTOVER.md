# RINLU OVH S3 as the single authoritative media storage — integration contract

**Release status: implementation branch only. NOT ENABLED IN PRODUCTION.**
The connected GitHub repository can change OVH Docker gateway and processor, but the canonical React/Cloudflare Worker + D1 database are independently hosted by ChatGPT Sites. No available connection modifies that canonical Worker. Do not present this branch as a completed storage cutover or merge it while GitHub Actions cannot allocate runners.

## S3-only workflow with D1 unchanged

1. Authenticated artist requests POST /music/api/storage/direct/init. The OVH gateway confirms the canonical storage backend advertises the exact S3-only readiness contract, then generates a one-use ticket with owner ID, unique asset ID, staged key and expiration.
2. The browser uses its five-minute SigV4 policy to POST the media bytes directly to the private OVH bucket. The VPS never handles the browser's upload payload.
3. Artist posts the small ticket to /music/api/storage/direct/complete. The OVH gateway verifies ownership and S3 HEAD size, performs S3 CopyObject **inside OVH** from a temporary upload key to a unique immutable originals/owner/asset-id key, and confirms the destination HEAD. No R2 PUT and no audio relay through VPS.
4. Gateway POSTs JSON metadata (asset ID, owner-bound session, storage provider/key, size, nonce, processing_state=pending_scan) to the canonical D1 endpoint /api/storage/s3/commit. No MP3/JPG body is sent to D1.
5. Canonical backend must atomically: verify current user role/quotas/idempotency and S3 object, create an asset row linked to that user and immutable S3 key, enqueue a storage-provider-aware scan job and append an audit entry. A duplicate call returns the exact same asset record without creating another job; conflicting duplicate keys fail.
6. Only after D1 acknowledges pending_scan does the gateway delete the temporary S3 object. A DB failure keeps original and staging objects for retry and recovery. No published/approved state may be returned by upload finalization.
7. The existing trusted processor claims an authenticated, leased job. For provider ovh-s3 it downloads the private original from OVH S3 using a fixed endpoint and a validated server-issued object key; runs fresh ClamAV signatures, ffprobe and ffmpeg; scans the generated rendition again; uploads the processed MP3 directly to the private S3 bucket; then submits **metadata-only** confirmation with original and rendition hashes. No R2 write or arbitrary remote fetch.
8. Canonical D1 validates the job lease, claimed asset ID, S3 destination, original and output SHA-256, keeps malware and processing status in the existing audit trail, then permits the normal manual review (or the existing explicitly configured automated review), publishing and analytics flow.
9. GET/HEAD /api/media/:track and /api/artwork/:asset must preserve access controls and return short-lived S3 or CDN URLs for the exact stored provider/version, including private/unlisted handling and HTTP Range. Rhythm game and waveform analysis jobs must resolve the provider and read the verified rendition from S3.
10. Historical R2 tracks and artwork stay available in **read-only fallback** until all originals, artwork versions, thumbnails, audio renditions and unpublished/private assets have been inventoried and migrated with checksum verification. Do not delete them during cutover.

## Required canonical endpoint contract (not yet implemented in the independent Sites backend)

GET /api/storage/s3/capabilities returns status 200 with:
{"contract":"rinlu-s3-primary-v1","provider":"ovh-s3","bucket":"<configured real bucket>","database":"ready","scanner":"ready","processing":"ready","quarantine":true,"r2_dual_write":false}

This must report ready ONLY if the real D1 migration has completed, required uniqueness constraints and foreign keys exist, the processor has a fresh malware-signature heartbeat and actual S3 GET/PUT capability, and no service path still writes new media to R2. It should not include credentials. A nonready or unavailable response is a hard failure for any S3-only upload.

POST /api/storage/s3/commit receives user-authenticated JSON:
{"asset_id":"UUID","kind":"audio|artwork","size":123456,"content_type":"audio/mpeg|image/jpeg","original_name":"song.mp3","storage_provider":"ovh-s3","storage_key":"originals/<owner-uuid>/<asset-uuid>","upload_ticket_nonce":"opaque","processing_state":"pending_scan"}

The canonical backend MUST verify the current authenticated owner, quotas and ownership, signed bridge attestation or direct private S3 HEAD, MIME policy, immutable key and size, idempotent nonce, and create rows + queued job + audit atomically. It must not accept storage provider or status from a client without validation. The successful result must confirm exact ID, storage key, provider, processing_state=pending_scan and a nonapproved review status. On failure it must not accept a draft referencing an unregistered object. Use the real deployed D1 schema; do not run guessed SQL.

Canonical processor claim jobs for S3 must include storage_provider=ovh-s3, input_storage_key=originals/owner/asset, output_storage_key=renditions/track-id/vN.mp3, lease token, job ID, and authenticated complete/fail URLs. The S3 processor POSTs only metadata; existing R2 jobs continue to use the old multipart completion endpoint. The canonical server MUST validate version/lease and stored S3 checksums before marking a job complete.

Important: the existing public Site's /api/upload currently writes to R2 and the original processor service endpoints expect R2. Changing only OVH gateway Docker code cannot make this single-primary. The canonical Worker, D1 schema/queries, media-service provider resolver and service processor contracts must first be updated and published there.

## Code supplied on the GitHub feature branch

- services/ovh-s3/primary-media.mjs: fail-closed canonical S3 capability and metadata-only registration; never calls the R2 upload API
- services/ovh-s3/direct-storage.mjs: opt-in S3 primary route; legacy R2 compatibility retained when feature flag is disabled
- services/ovh-s3/s3.mjs: server-side S3 CopyObject for final original promotion, no VPS audio payload
- services/media-worker/s3_io.py: signed fixed-endpoint private S3 GET/PUT with restricted object keys and byte limits
- services/media-worker/worker.py: opt-in S3 processing jobs, ClamAV/ffprobe/ffmpeg unchanged, metadata-only job completion and S3 rendition analysis
- services/media-worker/compose.yaml and deployment workflow: opt-in bucket credentials for the offline processor; no new inbound ports
- services/ovh-s3/tests/primary-media.test.mjs, services/media-worker/test_s3_io.py and .github/workflows/check-s3-primary.yml: synthetic tests, no production data or credentials

## Rollout and acceptance checklist

- [ ] GitHub Actions obtains actual runner and all test/build jobs pass. Since 2026-11-20, recent workflow jobs return runner_id=0 and zero steps; address the account/Actions scheduler issue before deployment.
- [ ] Canonical Sites backend has been independently updated and D1 schema migrated with backups, audit/permission/job contract and provider resolution.
- [ ] Fresh processor heartbeat with the S3 mode ready and ClamAV signatures <48h old.
- [ ] Confirm the bucket supports private CopyObject and immutable final writes with a temporary file, and verify after copy.
- [ ] One test artist uploads a 192k/320k MP3 from the browser straight to S3; D1 creates exactly one pending-scan asset and one queued job; no R2 new object is written.
- [ ] Scan a clean file end-to-end; verify S3 original and processed rendition hashes, manual review, private preview, release publication, signed playback 206 Range and rhythm-game chart extraction.
- [ ] Test EICAR/damaged MP3, duplicate ticket, expired ticket, wrong owner, revoked account, scanner offline, incorrect object size, D1 unavailability and S3 unavailability. Every case must fail closed without publication.
- [ ] Configure GitHub variable RINLU_S3_PROCESSOR_MODE=1 and verify processor launch with scoped S3 credentials.
- [ ] Only then set OVH_S3_PRIMARY_ONLY=1, run an explicit main production deployment and reverify live end-to-end behavior and absence of R2 writes.
- [ ] Keep R2 originals until reconciliation covers 100% of historical private/public objects and retention policy authorizes cleanup. Maintain a rollback to old provider reads per asset; disabling new writes alone is not sufficient for newly uploaded S3-only assets.

No credential values belong in commits, Actions logs, media URLs, or support screenshots.
