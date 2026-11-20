/**
 * RINLU OVH publishing overlay: apply the genuine Madimi One lowercase
 * wordmark to the verified, extracted canonical Sites source before Vite.
 *
 * The canonical archive remains byte-for-byte intact; this additional
 * corresponding source is published beside it under /music/source/.
 * Fail closed if a future Sites release changes our exact component anchors.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function applyPlatformBrand(root){
 const changes=[
  ['app/rinlu.tsx',[
   ['<span className="brand-name">RINLU</span>','<span className="brand-name">rinlu</span>'],
   ['<A href="/" className="mobile-wordmark" aria-label={tr("RINLU home")}>RINLU</A>',
    '<A href="/" className="mobile-wordmark" aria-label={tr("RINLU home")}>rinlu</A>']
  ]],
  ['app/guest-access.tsx',[
   ['<div className="access-wordmark"><AudioLines size={22} aria-hidden/>RINLU</div>',
    '<div className="access-wordmark"><AudioLines size={22} aria-hidden/>rinlu</div>']
  ]]
 ];
 let wordmarks=0;
 for(const [file,replacements] of changes){
  const path=join(root,file);
  let body=await readFile(path,'utf8');
  for(const [before,after] of replacements){
   const occurrences=body.split(before).length-1;
   if(occurrences!==1)throw Error('RINLU wordmark anchor changed: '+file+' ('+occurrences+' matches)');
   body=body.replace(before,after);
   wordmarks++;
  }
  await writeFile(path,body);
 }
 const path=join(root,'app/aura-ui.css');
 let css=await readFile(path,'utf8');
 if(css.includes('RINLU-MADIMI-WORDMARK'))throw Error('Wordmark overlay already applied');
 // Only brand-wordmark elements receive the display font; other text retains
 // the canonical platform's chosen typographic system.
 css="@import url('https://fonts.googleapis.com/css2?family=Madimi+One&display=swap');\n"+css+
  '\n/* RINLU-MADIMI-WORDMARK — branding only, desktop/mobile/auth */\n'+
  '.brand-name, .mobile-wordmark, .access-wordmark {\n'+
  "  font-family: 'Madimi One', sans-serif !important;\n"+
  '  font-weight: 400 !important;\n'+
  '  letter-spacing: -.035em !important;\n'+
  '  text-transform: none !important;\n'+
  '}\n';
 await writeFile(path,css);
 console.log('RINLU brand overlay applied:',wordmarks,'lowercase wordmarks + Madimi One font');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 await applyPlatformBrand(process.argv[2]||'.platform-source/rinlu-player-source');
}
