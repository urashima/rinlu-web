/** Render a root-only Docker env-file from GitHub Actions Secrets and Variables.
 * Nothing is written to disk or logged by this command; pipe stdout to a trusted SSH host.
 */
const fields = {
  OVH_S3_BUCKET: process.env.OVH_S3_BUCKET || '',
  OVH_S3_REGION: process.env.OVH_S3_REGION || '',
  OVH_S3_ENDPOINT: process.env.OVH_S3_ENDPOINT || '',
  OVH_S3_ACCESS_KEY_ID: process.env.OVH_S3_ACCESS_KEY_ID || '',
  OVH_S3_SECRET_ACCESS_KEY: process.env.OVH_S3_SECRET_ACCESS_KEY || '',
};
const missing = Object.entries(fields).filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  // Names only; never print credential values.
  process.stderr.write('Incomplete OVH S3 configuration. Missing: ' + missing.join(', ') + '\n');
  process.exit(1);
}
for (const [name, value] of Object.entries(fields)) {
  if (/[\r\n\0]/.test(value)) {
    process.stderr.write('Invalid line break or NUL in ' + name + '\n');
    process.exit(1);
  }
}
const {OVH_S3_BUCKET: bucket, OVH_S3_REGION: region, OVH_S3_ENDPOINT: endpoint} = fields;
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || /\.\.|\.-|-\./.test(bucket)) {
  process.stderr.write('OVH_S3_BUCKET must be a valid lowercase S3 container name.\n');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{1,40}$/.test(region)) {
  process.stderr.write('OVH_S3_REGION must be the lowercase OVH region identifier.\n');
  process.exit(1);
}
let url;
try { url = new URL(endpoint); } catch { /* handled below */ }
const expected = 's3.' + region + '.io.cloud.ovh.' + (region.startsWith('us-') ? 'us' : 'net');
if (!url || url.protocol !== 'https:' || url.hostname !== expected || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
  process.stderr.write('OVH_S3_ENDPOINT must be the HTTPS OVH S3 endpoint matching OVH_S3_REGION.\n');
  process.exit(1);
}
// OVH-issued S3 credentials use a printable single-line value. Avoid Docker env-file ambiguity.
for (const name of ['OVH_S3_ACCESS_KEY_ID', 'OVH_S3_SECRET_ACCESS_KEY']) {
  if (!/^[\x21-\x7e]+$/.test(fields[name])) {
    process.stderr.write('Invalid ' + name + ' format.\n');
    process.exit(1);
  }
}
process.stdout.write([
  'RINLU_STORAGE_PROVIDER=s3',
  'RINLU_S3_UPLOAD_MIRROR=' + (process.env.OVH_S3_UPLOAD_MIRROR === '0' ? '0' : '1'),
  'RINLU_S3_PLAYBACK_CACHE=' + (process.env.OVH_S3_PLAYBACK_CACHE === '0' ? '0' : '1'),
  'RINLU_S3_BUCKET=' + bucket,
  'RINLU_S3_REGION=' + region,
  'RINLU_S3_ENDPOINT=' + url.origin,
  'RINLU_S3_ACCESS_KEY_ID=' + fields.OVH_S3_ACCESS_KEY_ID,
  'RINLU_S3_SECRET_ACCESS_KEY=' + fields.OVH_S3_SECRET_ACCESS_KEY,
  '',
].join('\n'));
