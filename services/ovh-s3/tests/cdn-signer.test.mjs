import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createCdnSigner,immutableCdnKey,assertCdnOriginToken} from '../cdn-signer.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('CDN token only signs immutable versioned audio paths',()=>{
 const now=1763620200000,secret='not-production-secret-is-long-enough-0123456789';
 const sign=createCdnSigner({RINLU_CDN_BASE_URL:'https://media.rinlu.com/',RINLU_CDN_SIGNING_KEY:secret},()=>now);
 const u=new URL(sign(id,2,4096,600));
 assert.equal(u.hostname,'media.rinlu.com');
 assert.equal(u.pathname,'/v1/audio/'+id+'/v2-s4096.mp3');
 assert.equal(u.searchParams.get('sig'),createHmac('sha256',secret).update(u.pathname+'\n'+u.searchParams.get('exp')).digest('hex'));
 assert.equal(immutableCdnKey(id,2,4096).key,'playback/'+id+'/v2-s4096.mp3');
 assert.throws(()=>sign(id,2,4096,4000),/TTL/);
});
test('CDN origin authorization tokens require constant-time matching',()=>{
 assert.equal(assertCdnOriginToken('a'.repeat(40),'a'.repeat(40)),true);
 assert.throws(()=>assertCdnOriginToken('a'.repeat(40),'b'.repeat(40)),/failed/);
 assert.throws(()=>createCdnSigner({RINLU_CDN_BASE_URL:'https://evil.test/',RINLU_CDN_SIGNING_KEY:'a'.repeat(40)}),/host/);
});
