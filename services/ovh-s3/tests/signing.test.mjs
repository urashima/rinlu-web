import test from 'node:test';
import assert from 'node:assert/strict';
import {createS3Signer,signedTicket,verifyTicket} from '../signing.mjs';
const fake={
 RINLU_S3_BUCKET:'rinlu-music-prod',RINLU_S3_REGION:'us-east-va',
 RINLU_S3_ENDPOINT:'https://s3.us-east-va.io.cloud.ovh.us',
 RINLU_S3_ACCESS_KEY_ID:'FAKE_TEST_KEY',RINLU_S3_SECRET_ACCESS_KEY:'FAKE_TEST_SECRET'
};
const now=new Date('2026-11-20T06:30:00.000Z');
const signer=createS3Signer(fake,()=>now);
test('generate canonical private SigV4 GET scoped to US Virginia',()=>{
 const url=new URL(signer.signedGet('playback/a/v1-s999.mp3',900));
 assert.equal(url.origin,'https://s3.us-east-va.io.cloud.ovh.us');
 assert.equal(url.pathname,'/rinlu-music-prod/playback/a/v1-s999.mp3');
 assert.equal(url.searchParams.get('X-Amz-Expires'),'900');
 assert.match(url.searchParams.get('X-Amz-Credential'),/^FAKE_TEST_KEY\/20261120\/us-east-va\/s3\/aws4_request$/);
 assert.match(url.searchParams.get('X-Amz-Signature'),/^[0-9a-f]{64}$/);
});
test('POST policy constrains exact object key, content-type, byte count and expiry',()=>{
 const form=signer.postPolicy('staging/owner/n123.mp3','audio/mpeg',123456);
 assert.equal(form.url,'https://s3.us-east-va.io.cloud.ovh.us/rinlu-music-prod');
 assert.equal(form.fields.key,'staging/owner/n123.mp3');
 const content=JSON.parse(Buffer.from(form.fields.policy,'base64').toString('utf8'));
 assert.ok(content.conditions.some(x=>x.key==='staging/owner/n123.mp3'));
 assert.ok(content.conditions.some(x=>Array.isArray(x)&&x[0]==='content-length-range'&&x[1]===123456&&x[2]===123456));
 assert.equal(content.expiration,'2026-11-20T06:35:00.000Z');
 assert.match(form.fields['x-amz-signature'],/^[0-9a-f]{64}$/);
});
test('no anonymous paths, unapproved endpoints, or large file policies',()=>{
 assert.throws(()=>signer.signedGet('../private'),/Unsafe/);
 assert.throws(()=>signer.postPolicy('staging/key.mp3','audio/mpeg',27*1024*1024),/Unsupported/);
 assert.throws(()=>createS3Signer({...fake,RINLU_S3_ENDPOINT:'https://attacker.example/'}),/Unsafe/);
});
test('session-bound upload tickets expire, reject edits and never contain S3 secrets',()=>{
 const payload={key:'staging/owner/k.mp3',owner:'owner',kind:'audio',size:2048,expires:Date.now()+60000};
 const ticket=signedTicket(fake.RINLU_S3_SECRET_ACCESS_KEY,payload);
 assert.deepEqual(verifyTicket(fake.RINLU_S3_SECRET_ACCESS_KEY,ticket),payload);
 assert.throws(()=>verifyTicket(fake.RINLU_S3_SECRET_ACCESS_KEY,ticket.slice(1)),/Invalid/);
 assert.throws(()=>verifyTicket(fake.RINLU_S3_SECRET_ACCESS_KEY,ticket,payload.expires+1),/expired/);
 assert.doesNotMatch(ticket,/FAKE_TEST_SECRET/);
});
