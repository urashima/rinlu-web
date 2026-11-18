/**
 * RINLU mobile API overlay for the OVH /music gateway.
 *
 * Read-only composition of the existing canonical RINLU APIs.
 * It NEVER accesses D1 directly, never mints sessions, and never forwards
 * client-supplied identity headers. All authentication is derived from the
 * gateway's already-validated HttpOnly account cookie.
 *
 * AGPL-3.0-or-later, RINLU, 2026.
 */
const API_PREFIX = '/music/api/mobile/v1/';
const MAX_BODY = 3 * 1024 * 1024;

function error(status, message) {
  return {status, body:{error: message}};
}
function safeTrack(t) {
  if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') return null;
  const fields = ['id','title','artist_id','artist_name','cover','genre','duration','status','version'];
  return Object.fromEntries(fields.filter(k => Object.hasOwn(t,k)).map(k => [k,t[k]]));
}
function normalize(q) { return String(q || '').normalize('NFKC').toLocaleLowerCase().trim(); }

export function createMobileApiHandler({backendOrigin, fetchImpl=fetch}) {
  const upstream=new URL(backendOrigin);
  if (upstream.protocol!=='https:') throw Error('Mobile API requires HTTPS backend');
  async function readUpstream(path, bearer) {
    const h=new Headers({'Accept':'application/json'});
    if (bearer) h.set('Authorization',bearer);
    const r=await fetchImpl(new URL(path,upstream), {
      method:'GET',headers:h,redirect:'error',signal:AbortSignal.timeout(12000)
    });
    if (r.status===401||r.status===403) throw Object.assign(Error('Access denied'),{status:r.status});
    if (!r.ok) throw Error('RINLU upstream unavailable: '+r.status);
    if (!r.headers.get('content-type')?.includes('application/json')) throw Error('Unexpected upstream format');
    const len=Number(r.headers.get('content-length')||0);
    if (len>MAX_BODY) throw Error('Upstream response is too large');
    const reader=r.body?.getReader();
    if(!reader) throw Error('Empty upstream response');
    let n=0;
    const chunks=[];
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      n+=value.byteLength;
      if(n>MAX_BODY) { await reader.cancel();throw Error('Upstream response is too large'); }
      chunks.push(value);
    }
    const bytes=new Uint8Array(n);
    let offset=0;
    for(const chunk of chunks){ bytes.set(chunk,offset);offset+=chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return async function mobileApi(req,res,url,bearer,send) {
    const path=url.pathname;
    if(!path.startsWith(API_PREFIX)) return send(res,404,{error:'Unknown endpoint'});
    if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
    const sub=path.slice(API_PREFIX.length);
    if(sub.includes('/')) return send(res,404,{error:'Unknown endpoint'});
    let result;
    if(sub==='capabilities') {
      result={version:1,platform:'RINLU',implementation:'OVH gateway',
        native_login:['email-password'],api:{
          catalog:'/music/api/catalog',
          track:'/music/api/track/{id}',
          library:'/music/api/library',
          authorize:'/music/api/playback/authorize',
          playback_state:'/music/api/playback/state',
          playback_event:'/music/api/playback/event',
          favorites:'/music/api/favorites',
          playlist:'/music/api/playlists',
          studio:'/music/api/studio',
          games:'/music/api/games/highway/{id}',
          dsp_listener:'/music/api/sound/policy',
          dsp_admin:'/music/api/admin/sound'
        },constraints:{media_auth_url_ttl_seconds:300,dsp_core:'rinludsp/3',
          search_scope:'latest_300_public_songs'}};
    } else if(sub==='bootstrap'||sub==='search') {
      const q=url.searchParams.get('q')||'';
      const limit=Number(url.searchParams.get('limit')||30);
      if(sub==='search'&&(!Number.isInteger(limit)||limit<1||limit>60||q.length>80)) {
        return send(res,400,{error:'Invalid search arguments'});
      }
      try {
        if(sub==='bootstrap') {
          const [catalog, policy, me]=await Promise.all([
            readUpstream('/api/catalog',bearer),
            readUpstream('/api/sound/policy',bearer),
            readUpstream('/api/me',bearer)
          ]);
          const tracks=Array.isArray(catalog?.tracks) ?
            catalog.tracks.map(safeTrack).filter(Boolean).slice(0,300):[];
          const user=me?.user && typeof me.user.id==='string'?
            {id:me.user.id,name:me.user.name,role:me.user.role,status:me.user.status}:null;
          result={version:1,user,tracks,artists:catalog?.artists||[],
            releases:catalog?.releases||[],dsp:policy,
            limits:{catalog_page_size:300}};
        } else {
          if(!q.trim()) result={items:[],count:0};
          else {
            const catalog=await readUpstream('/api/catalog',bearer);
            const needle=normalize(q);
            const songs=Array.isArray(catalog?.tracks)?catalog.tracks:[];
            const items=songs.filter(t=>[t.title,t.artist_name,t.genre].some(v=>normalize(v).includes(needle)))
              .slice(0,limit).map(safeTrack).filter(Boolean);
            result={items,count:items.length,scope:'latest_300_public_songs'};
          }
        }
      } catch(e) {
        return send(res,e?.status===401||e?.status===403?e.status:502,
          {error:e?.status?'RINLU account unavailable':'RINLU data service unavailable'});
      }
    } else return send(res,404,{error:'Unknown endpoint'});
    return send(res,200,result);
  };
}
