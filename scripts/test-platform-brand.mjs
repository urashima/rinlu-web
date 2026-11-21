import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root='.platform-source/rinlu-player-source';
const file=async name=>readFile(root+'/'+name,'utf8');
test('original SVG logo replaces desktop, compact and account branding',async()=>{
 const shell=await file('app/rinlu.tsx');
 const access=await file('app/guest-access.tsx');
 for(const slot of ['full','compact'])assert.match(shell,new RegExp('data-rinlu-brand="'+slot+'"'));
 assert.match(shell,/className="brand-name rinlu-svg-wide"/);
 assert.match(shell,/className="brand-mark rinlu-svg-compact"/);
 assert.match(shell,/className="mobile-wordmark"[^>]*><img[^>]*data-rinlu-brand="compact"/);
 assert.match(access,/className="access-wordmark"><img[^>]*data-rinlu-brand="account"/);
 assert.doesNotMatch(shell,/<span className="brand-name">rinlu<\/span>/);
 assert.doesNotMatch(shell,/<span className="brand-name">RINLU<\/span>/);
 assert.match(shell,/aria-label="RINLU"/);
 assert.match(shell,/<h3>RINLU<\/h3>/);
});
test('light and dark theme CSS applies only to original SVG logo images',async()=>{
 const css=await file('app/aura-ui.css');
 assert.match(css,/RINLU ORIGINAL-SVG-LOGO/);
 assert.match(css,/\.rinlu-svg-image/);
 assert.match(css,/filter:invert\(1\)/);
 assert.match(css,/@container \(max-width:126px\)/);
 assert.doesNotMatch(css,/Madimi One.*!important/);
});
test('Platform Console Site includes administrator logo selector',async()=>{
 const admin=await file('app/site-font-admin.tsx');
 const ui=await file('app/site-logo-admin.tsx');
 assert.match(admin,/<SiteLogoAdmin\/>/);
 assert.match(ui,/\/api\/admin\/logo/);
 assert.match(ui,/rinlu-symbol-only/);
});
