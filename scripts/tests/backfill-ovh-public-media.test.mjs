import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Public OVH import uses canonical playback authorization endpoint',()=>{
 const source=readFileSync(new URL('../backfill-ovh-public-media.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("base+'/playback/authorize'"));
 assert.ok(!source.includes("base+'/authorize'"));
 assert.ok(source.includes("attempted>0&&copied+skipped===0"));
 assert.ok(source.includes("s3.verifiedPut(key,bytes,'audio/mpeg')"));
});
