/**
 * Mobile-native read model for RINLU's verified corresponding source.
 * AGPL-3.0-or-later. Does not read secrets or write account data.
 * Install through scripts/apply-mobile-overlay.mjs into lib/mobile-api.ts.
 */
import {all, json, Row} from './backend';
import {publishedRecording} from './catalog-visibility';
import {readSoundPolicy} from './sound-policy-server';
import {listenerSoundPolicy} from './sound-policy';

const projections = 'SELECT t.id,t.title,t.artist_id,t.cover,t.genre,t.duration,t.status,t.ai_type,t.version,a.name artist_name ';
const tables = 'FROM tracks t JOIN artists a ON a.id=t.artist_id ';

export async function mobileAPI(req: Request, p: string[], u: Row | null): Promise<Response> {
  if (p[0] !== 'mobile' || p[1] !== 'v1' || req.method !== 'GET') {
    return json({error: 'Unsupported mobile request.'}, 405);
  }
  const endpoint = p[2] || '';
  const url = new URL(req.url);
  const headers = {'Cache-Control': 'private, no-store', 'Vary': 'Cookie'};

  if (endpoint === 'capabilities') {
    return Response.json({
      version: 1,
      platform: 'RINLU',
      native_login: ['email-password'],
      api: {
        catalog: '/api/catalog',
        track: '/api/track/{id}',
        library: '/api/library',
        authorize: '/api/playback/authorize',
        playback_state: '/api/playback/state',
        playback_event: '/api/playback/event',
        favorites: '/api/favorites',
        playlist: '/api/playlists',
        studio: '/api/studio',
        games: '/api/games/highway/{id}',
        dsp_listener: '/api/sound/policy',
        dsp_admin: '/api/admin/sound'
      },
      constraints: {media_auth_url_ttl_seconds: 300, dsp_core: 'rinludsp/3'},
    }, {headers});
  }

  if (endpoint === 'bootstrap') {
    const [songs, {policy}] = await Promise.all([
      all(projections + tables + 'WHERE ' + publishedRecording +
          ' ORDER BY t.created_at DESC LIMIT 300'),
      readSoundPolicy()
    ]);
    return Response.json({
      version: 1,
      user: u ? {id:u.id,name:u.name,role:u.role,status:u.status} : null,
      tracks: songs,
      dsp: listenerSoundPolicy(policy),
      limits: {catalog_page_size:300},
    }, {headers});
  }

  if (endpoint === 'search') {
    const q = (url.searchParams.get('q') || '').trim();
    const count = Number(url.searchParams.get('limit') || 30);
    if (!Number.isInteger(count) || count < 1 || count > 60 || q.length > 80) {
      return json({error: 'Invalid search arguments.'}, 400);
    }
    if (!q) return Response.json({items: [], count:0}, {headers});
    const results = await all(
      projections + tables +
      'WHERE ' + publishedRecording +
      ' AND (instr(lower(t.title),lower(?))>0 OR instr(lower(a.name),lower(?))>0' +
      ' OR instr(lower(t.genre),lower(?))>0) ORDER BY t.created_at DESC LIMIT ?',
      q, q, q, count
    );
    return Response.json({items: results, count: results.length}, {headers});
  }

  return json({error: 'Unsupported mobile endpoint.'}, 404);
}
