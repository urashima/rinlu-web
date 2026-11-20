import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const valid = {
  OVH_S3_BUCKET: 'rinlu-music-prod',
  OVH_S3_REGION: 'us-east-va',
  OVH_S3_ENDPOINT: 'https://s3.us-east-va.io.cloud.ovh.us',
  OVH_S3_ACCESS_KEY_ID: 'TEST_ACCESS_KEY',
  OVH_S3_SECRET_ACCESS_KEY: 'TEST_SECRET_KEY/+=',
};
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('OVH_S3_')));
function run(overrides = {}) {
  return spawnSync(process.execPath, [new URL('../render-ovh-s3-env.mjs', import.meta.url).pathname], {
    env: {...clean, ...valid, ...overrides}, encoding: 'utf8',
  });
}
test('renders private env-file for Docker with a matching endpoint', () => {
  const result = run();
  assert.equal(result.status, 0);
  assert.match(result.stdout, /RINLU_S3_BUCKET=rinlu-music-prod/);
  assert.match(result.stdout, /RINLU_S3_SECRET_ACCESS_KEY=TEST_SECRET_KEY\/\+=/);
  assert.equal(result.stderr, '');
});
test('fails closed on incomplete credentials without leaking keys', () => {
  const result = run({OVH_S3_SECRET_ACCESS_KEY: ''});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing: OVH_S3_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(result.stderr, /TEST_ACCESS_KEY/);
  assert.equal(result.stdout, '');
});
test('rejects endpoint from an unrelated host', () => {
  const result = run({OVH_S3_ENDPOINT: 'https://example.com'});
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});
test('rejects line breaks in credentials', () => {
  const result = run({OVH_S3_SECRET_ACCESS_KEY: 'test\nINJECTED=1'});
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
});
test('supports OVH US Oregon location', () => {
  const result = run({OVH_S3_REGION: 'us-west-or', OVH_S3_ENDPOINT: 'https://s3.us-west-or.io.cloud.ovh.us'});
  assert.equal(result.status, 0);
});
