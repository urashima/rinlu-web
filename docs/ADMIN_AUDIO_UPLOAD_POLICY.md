# RINLU Platform Console — live upload format policy

## Administrator interface

Open **Platform Console → Site** (the current /admin/site-fonts route).
A new Audio upload formats & bitrate section sits beside Typography and Share image.

The current scanner and publishing pipeline supports **MP3 only**. Initial policy is
MP3 enabled with **minimum 128 kbps, maximum 320 kbps, and CBR/VBR enabled**.

The interface exposes:
- MP3 enabled/disabled toggle
- MP3 minimum and maximum average bitrate selectors
- VBR allowed toggle
- revision number, reload button, save-and-apply button and success/error feedback
- future-format rows: WAV (PCM), M4V (video), Dolby Atmos, Lossless (FLAC/ALAC/PCM)
- unavailable formats are visibly disabled in both UI and server validator, **not silently admitted**.

M4V is a *video container*, not a substitute for M4A. Dolby Atmos and lossless are families of delivery profiles/codecs rather than one universal bitrate switch. Those formats need dedicated validation, scanning, audio/video processing and playback support before activation.

## Immediate server-side enforcement

The original canonical RINLU Site/D1 backend adds:
- GET /api/upload-policy (public, Cache-Control: no-store)
- GET /api/admin/audio-upload-policy (administrator only)
- PUT /api/admin/audio-upload-policy (administrator only)

Settings live in the **existing D1 settings table** under audio_upload_policy_v1.
The PUT request includes expected_revision, a strictly validated formats object,
and an audit reason. It uses a compare-and-swap update and appends an audit log.
Stale concurrent edits return HTTP 409 instead of silently overwriting another admin's policy.
Every new /api/upload audio request reads the current D1 row; there is no 30-minute
cache or deployment-time variable. Old published songs remain readable.

The backend MP3 parser inspects actual MPEG audio frames rather than the entire
file size (ID3 artwork does not inflate bitrate). A duration-weighted average
must fall in the administrator's allowed range. CBR/VBR are separately enforced.
Malformed, truncated and unsupported formats still fail, and existing size,
duration, user rights, ClamAV scan and manual review stay unchanged.

The creator UI fetches /api/upload-policy with no-store on **every new file
selection**, checks the MPEG frames before sending bytes, and shows the actual
average bitrate and whether the recording is CBR or VBR. On finalization,
the canonical server checks the live D1 policy again, even if an upload
started under an older policy.

## Deployment constraint

This GitHub repo manages the OVH Docker mirror/front-end, NOT the original
independently published canonical RINLU ChatGPT Site / Cloudflare Worker or D1.

**DO NOT MERGE the UI change to production before applying and publishing the canonical
backend patch**, otherwise the browser may accept 128 kbps while the original
server still rejects it with the old 192/320 CBR-only restriction.

Site release:
1. Back up current Site source and D1.
2. Apply scripts/apply-canonical-audio-policy.mjs to the **original Site project**.
3. Deploy backend first. Verify /api/upload-policy defaults to MP3 min128 max320 allowVbr=true.
4. Verify GET/PUT /api/admin/audio-upload-policy with an admin session; reject non-admin and revision conflicts.
5. Upload 128 kbps CBR and 128 average VBR; verify the original file is processed and audited.
6. Reject WAV/M4V/Atmos/FLAC attempts (currently unsupported) and damaged MP3.
7. Merge this UI branch and deploy OVH Docker. Recheck a live admin edit immediately
   affects the creator uploader and canonical POST /api/upload without redeploy.
8. Retain existing R2/S3 backup files; this feature does not migrate or delete media.

The future S3-only primary branch must integrate the same D1 audio upload policy
when its independent backend cutover is ready.

## Test coverage

GitHub Actions workflow check-live-audio-policy.yml:
- Synthetic CBR 128/160/192/224/256/320, VBR average 128, below-minimum,
  upper-limit and disabled-policy rejection
- MP3 ID3 artwork excluded from bitrate
- canonical published-source patch anchors, real inspectMp3 tests and admin routing
- native RINLU Site frontend compilation / OVH gateway packaging
- scoped new TypeScript errors

Default policy changes *only* future upload admission; it never retroactively
deletes or makes published media unavailable.
