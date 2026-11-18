#!/usr/bin/env node
/**
 * Apply mobile API source patch ONLY in an isolated, verified canonical checkout.
 * This script never uploads, deploys, or writes to the production service.
 */
import {readFile, writeFile, copyFile, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';

const root = resolve(process.argv[2] || '.platform-source/rinlu-player-source');
const target = join(root, 'lib/server.ts');
const mobileTarget = join(root, 'lib/mobile-api.ts');
const source = resolve('services/mobile-api/mobile-api.ts');

const before = await readFile(target, 'utf8');
const importLine = "import {mobileAPI} from './mobile-api';";
const anchorImport = "import {soundPolicyEndpoint} from './sound-policy-server';";
const anchorRoute = "  if(resource==='games') {";
const injectRoute = "  if(resource==='mobile'&&p[1]==='v1')return await mobileAPI(req,p,u);";

let patched = before;
if (!patched.includes(importLine)) {
  if (!patched.includes(anchorImport)) throw Error('Upstream import anchor changed; reconcile first');
  patched = patched.replace(anchorImport, anchorImport + '\n' + importLine);
}
if (!patched.includes(injectRoute)) {
  if (!patched.includes(anchorRoute)) throw Error('Upstream route anchor changed; reconcile first');
  patched = patched.replace(anchorRoute, injectRoute + '\n' + anchorRoute);
}
if (patched === before && (await readFile(mobileTarget, 'utf8').catch(() => '')) === await readFile(source, 'utf8')) {
  console.log('RINLU mobile API overlay already applied');
  process.exit(0);
}
await mkdir(join(root, 'lib'), {recursive: true});
await copyFile(source, mobileTarget);
await writeFile(target, patched);
console.log('Native mobile API overlay applied to isolated canonical source:', root);
