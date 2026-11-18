import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileApiHandler} from './mobile-api.mjs';

const publicSongs=[
 {id:'t1',title:'Morning Light',artist_name:'RINLU',genre:'Pop',status:'published',duration:130,owner_id:'secret'},
 {id:'t2',title:'银河之声',artist_name:'XUERA',genre:'Electronic',status:'published',duration:110}
];
function harness({upstreamFail=null}={}) {
 const calls=[];
 const fetchImpl=async (url,opts)=>{
   calls.push({path:new URL(url).pathname,opts});
   const route=new URL(url).pathname;
   if(upstreamFail===route)return Response.json({error:'Denied'},{status:403});
   if(route==='/api/catalog') return Response.json({tracks:publicSongs,artists:[],releases:[]});
   if(route==='/api/sound/policy')return Response.json({revision:5,enabled:true,
     default_on:true,active:{id:'balanced',name:'Balanced'}});
   if(route==='/api/me')return Response.json({user:{id:'u1',name:'Listener',role:'listener',status:'active',
     email:'should-not-be-returned@example.org'}});
   return Response.json({error:'Not found'},{status:404});
 };
 const handler=createMobileApiHandler({backendOrigin:'https://canonical.example.org',fetchImpl});
 async function get(suffix,bearer='Bearer RINLU_ACCOUNT_test') {
   let response;
   await handler({method:'GET'},{},new URL('https://rinlu.com/music/api/mobile/v1/'+suffix),
       bearer,(_res,status,body)=>{response={status,body};});
   return response;
 }
 return {get,calls,handler};
}
test('capabilities publishes real gateway-prefixed API paths without contacting backend',async()=>{
 const h=harness(),r=await h.get('capabilities');
 assert.equal(r.status,200);
 assert.equal(r.body.version,1);
 assert.equal(r.body.api.authorize,'/music/api/playback/authorize');
 assert.equal(h.calls.length,0);
});
test('bootstrap uses upstream catalog and listener policy, not client identity headers',async()=>{
 const h=harness(),r=await h.get('bootstrap');
 assert.equal(r.status,200);
 assert.deepEqual(r.body.tracks.map(x=>x.id),['t1','t2']);
 assert.equal(r.body.tracks[0].owner_id,undefined);
 assert.equal(r.body.user.email,undefined);
 assert.equal(r.body.dsp.revision,5);
 assert.deepEqual(h.calls.map(x=>x.path).sort(),['/api/catalog','/api/me','/api/sound/policy']);
 for(const call of h.calls) {
   assert.equal(call.opts.headers.get('authorization'),'Bearer RINLU_ACCOUNT_test');
   assert.equal(call.opts.headers.get('oai-authenticated-user-id'),null);
   assert.equal(call.opts.headers.get('cookie'),null);
 }
});
test('search filters public catalog and normalizes Chinese',async()=>{
 const h=harness(),r=await h.get('search?q=银河&limit=10');
 assert.equal(r.status,200);assert.deepEqual(r.body.items.map(x=>x.id),['t2']);
});
test('search rejects invalid or overlong queries',async()=>{
 const h=harness();assert.equal((await h.get('search?limit=0&q=aa')).status,400);
 assert.equal((await h.get('search?q='+encodeURIComponent('z'.repeat(81)))).status,400);
});
test('writes and unknown endpoints fail closed',async()=>{
 const h=harness();let out;
 await h.handler({method:'POST'},{},new URL('https://rinlu.com/music/api/mobile/v1/bootstrap'),
   '',(_res,status,body)=>out={status,body});
 assert.equal(out.status,405);
 assert.equal((await h.get('not-existing')).status,404);
});
test('upstream auth problems preserve denial',async()=>{
 const h=harness({upstreamFail:'/api/me'});
 const r=await h.get('bootstrap');
 assert.equal(r.status,403);
});
