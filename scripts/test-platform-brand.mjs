import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source';
const file=async name=>readFile(root+'/'+name,'utf8');
test('RINLU visible wordmarks are lowercase and only those elements changed',async()=>{
 const shell=await file('app/rinlu.tsx');
 const access=await file('app/guest-access.tsx');
 assert.match(shell,/<span className="brand-name">rinlu<\/span>/);
 assert.match(shell,/className="mobile-wordmark"[^>]*>rinlu<\/A>/);
 assert.match(access,/className="access-wordmark"><AudioLines[^>]*\/>rinlu<\/div>/);
 assert.doesNotMatch(shell,/<span className="brand-name">RINLU<\/span>/);
 assert.doesNotMatch(shell,/className="mobile-wordmark"[^>]*>RINLU<\/A>/);
 assert.match(shell,/aria-label="RINLU"/);
 assert.match(shell,/<h3>RINLU<\/h3>/);
});
test('Madimi One typography applies only to the three wordmarks',async()=>{
 const css=await file('app/aura-ui.css');
 assert.match(css,/fonts\.googleapis\.com\/css2\?family=Madimi\+One/);
 assert.match(css,/RINLU-MADIMI-WORDMARK/);
 assert.match(css,/\.brand-name, \.mobile-wordmark, \.access-wordmark \{/);
 assert.match(css,/font-weight: 400 !important/);
 assert.doesNotMatch(css,/(body|\*)\s*\{\s*font-family:\s*'Madimi One'/);
});