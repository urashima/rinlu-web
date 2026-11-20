/** Map the two existing Site fonts surfaces to one Site Console page.
 * The canonical source archive is verified before this narrowly scoped overlay.
 * Preserve the existing /admin/site-fonts route and existing site-fonts API.
 */
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';

function replaceOnce(contents,before,after,file){
 const count=contents.split(before).length-1;
 if(count!==1)throw Error('RINLU Site Console source anchor changed: '+file+' ('+count+' matches)');
 return contents.replace(before,after);
}
export async function applyPlatformSite(root){
 const app=join(root,'app');
 const consolePath=join(app,'rinlu.tsx');
 let consoleSource=await readFile(consolePath,'utf8');
 consoleSource=replaceOnce(consoleSource,
  "['site-fonts',tr('Site fonts'),Settings]",
  "['site-fonts',tr('Site'),Settings]",'app/rinlu.tsx');
 await writeFile(consolePath,consoleSource);

 const componentPath=join(app,'site-font-admin.tsx');
 let source=await readFile(componentPath,'utf8');
 source=replaceOnce(source,
  "import {useTranslation} from './localization-provider';",
  "import {useTranslation} from './localization-provider';\nimport {SiteShareAdmin} from './site-share-admin';",
  'app/site-font-admin.tsx import');
 source=replaceOnce(source,
  "  return <section className=\"panel\">\n    <h2>{tr('Site fonts')}</h2>",
  "  return <div className=\"site-settings\">\n   <h2>{tr('Site')}</h2>\n   <section className=\"panel\">\n     <h3>{tr('Typography')}</h3>",
  'app/site-font-admin.tsx heading');
 source=replaceOnce(source,
  "  </section>;\n}",
  "  </section>\n  <SiteShareAdmin/>\n  </div>;\n}",
  'app/site-font-admin.tsx ending');
 await writeFile(componentPath,source);
 await copyFile('scripts/site-console/site-share-admin.tsx',join(app,'site-share-admin.tsx'));
 console.log('RINLU Site settings: font settings + S3 share image, original route unchanged');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyPlatformSite(process.argv[2]||'.platform-source/rinlu-player-source');
}
