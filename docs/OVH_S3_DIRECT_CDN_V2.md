# RINLU private browser-direct S3 and CDN v2

## Production scope
- Browser uploads MP3/JPEG directly to private OVH Object Storage using a short-lived, exact-key, exact-size SigV4 POST policy. The owner-bound completion ticket goes to RINLU Docker API without including the audio bytes.
- The canonical RINLU Cloudflare/D1 backend is still responsible for storage registration, user quota and MP3 validation. The OVH completion API currently copies the uploaded bytes from S3 to the canonical upload endpoint, then validates the matching object key in S3. **This is browser-direct to S3 with R2 compatibility dual-write; not yet S3-exclusive primary storage.**
- Playback requests still go through canonical authorization and moderation first. If a verified audio version exists in private OVH S3, the browser receives an expiring signed GET URL for OVH. Music bytes bypass the VPS. Missing objects fall back to the original RINLU media route.
- Direct client WebAudio requires strict-origin CORS and HTTP 206 Range. The deployment configures and verifies both against actual OVH S3 before it activates the new Docker features.
- 12 public songs were copied previously. Private originals, pending songs, covers, and all renditions need an explicit controlled migration before R2 can be removed.

## Release gate and rollback
GitHub Actions real S3 checks verify: private bucket CORS for https://rinlu.com, random signed browser POST, signed GET with Range, byte-for-byte integrity, and deletion of the temporary file. They run before deployment changes the running website.

The existing GitHub Secrets OVH_S3_ACCESS_KEY_ID and OVH_S3_SECRET_ACCESS_KEY are reused. No S3 secret is placed in JavaScript served to users.

Optional GitHub Variables OVH_S3_DIRECT_UPLOAD=0 and OVH_S3_DIRECT_PLAYBACK=0 disable either new feature on the next deployment; unset means enabled only if the real CORS + S3 smoke test passes. Existing website, Caddy, VPN and R2 files are not deleted.

For acceptance, use Chrome Network to see POST directly to the OVH S3 domain, followed by a small /music/api/storage/direct/complete request. The playback authorization response should show delivery=ovh-s3-direct, with a signed audio URL on the S3 domain. Check the audio response status 206 when dragging the progress bar.

## Optional private Cloudflare CDN
The CDN edge Worker implementation and deployment configuration are in services/ovh-s3/cdn-worker.mjs and services/ovh-s3/cdn-wrangler.toml. It validates a per-object HMAC token before any cache lookup; it contacts the RINLU server only for a fresh S3 origin signature on cache miss. Audio bytes flow Cloudflare edge -> OVH S3, not through the VPS.

To enable, the domain media.rinlu.com must be configured as a Cloudflare Worker custom domain in a Cloudflare account with access to the rinlu.com DNS zone. Configuring DNS or a CDN account is outside the GitHub repository connection.

Create GitHub Secrets CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, RINLU_CDN_SIGNING_KEY and RINLU_CDN_ORIGIN_TOKEN. The two RINLU secrets must be independent random values with at least 32 characters. Set GitHub Variables RINLU_CDN_BASE_URL=https://media.rinlu.com/ and RINLU_CDN_ENABLED=0 initially.

Run the GitHub Actions workflow "Provision private RINLU CDN edge"; it deploys the Worker, installs secrets, and verifies unsigned audio access is rejected. Only after successful authenticated playback testing set RINLU_CDN_ENABLED=1 and run the normal main branch website deployment.

## Requirements for true S3-only primary storage
The canonical platform source (ChatGPT Sites / Cloudflare Worker / D1) must implement authenticated S3 upload finalization and database asset creation directly, rather than the compatibility /api/upload R2 pathway. Its existing auditing, rights confirmation, processing jobs, limits and rollback behavior must be preserved. The connected GitHub repository currently deploys the OVH Docker mirror/gateway, not that canonical backend. Do not remove R2 or claim full primary-store cutover until that separate backend change is completed and verified.

## Performance validation
Compare actual initial audio byte TTFB, browser time-to-first-sound, upload completion p50/p95 and concurrent-playback throughput before claiming acceleration. Signed S3 direct access removes VPS audio relaying, but edge caching only becomes available after the Cloudflare Worker custom-domain deployment is complete.
