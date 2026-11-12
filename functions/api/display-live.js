// Cloudflare Pages Function — GET /api/display-live?theme=love
//
// Returns the current "mother" canvas for a theme. Source order:
//   1. mother_display row for the theme (written by /api/canvas-save)
//   2. newest canvas_states row for the theme (if mother_display is empty)
//   3. 200 { empty:true } so the live display can run its local simulation
//
// Previously this returned 404 whenever mother_display had no row for the
// theme (which is the case until someone saves a canvas), so live.html sat on
// "The canvas is waking…". It also used .single(), which errors on 0 rows.
import { createClient } from '@supabase/supabase-js';
import { validateTheme } from '../../lib/validate.js';
import { nsTheme } from '../../lib/variant.js';

const PATCH_LIMIT = 200;
const PATCH_MAX_AGE_MS = 17 * 24 * 3600e3;   // lib/patch.js MAX_AGE_H (≈ 16.3 days) rounded up

export async function onRequestGet(context){
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json',
    'Cache-Control':'public, max-age=30',
  };
  const url = new URL(request.url);
  const json = (obj, status=200) => new Response(JSON.stringify(obj), { status, headers });
  const t = validateTheme(url.searchParams.get('theme'));
  if(!t.ok) return json({ empty:true, error:t.error }, 400);
  // PROTOTYPE (variant B): always read this branch's namespaced theme
  // (?theme=love → "pb-love"). Never a real theme's rows.
  const theme = nsTheme(t.value);

  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY){
    return json({ theme, empty:true, error:'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)' }, 503);
  }
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // PREVIEW (live-wall compositor): ?patches=1&since=ISO → the contributions
    // ("gp1." payloads in canvas_states.stab_map, see lib/patch.js) newer than
    // `since`, oldest first, PATCH_LIMIT per page, plus the mother row's
    // counters. Small JSON, no cell_data, no per-pixel work. No schema change.
    if(url.searchParams.get('patches') === '1'){
      const raw = Date.parse(url.searchParams.get('since') || '');
      const floor = Date.now() - PATCH_MAX_AGE_MS;
      const since = new Date(Number.isFinite(raw) ? Math.max(raw, floor) : floor).toISOString();
      const { data:rows, error:pErr } = await supabase.from('canvas_states')
        .select('short_id,created_at,contributor_id,stab_map')
        .eq('theme', theme).gt('created_at', since).like('stab_map', 'gp1.%')
        .order('created_at', { ascending:true }).limit(PATCH_LIMIT);
      if(pErr) throw pErr;
      const { data:m } = await supabase.from('mother_display')
        .select('generation,contributor_count,updated_at').eq('theme', theme).maybeSingle();
      return json({
        theme, since, limit:PATCH_LIMIT,
        generation:m ? m.generation : 0, contributorCount:m ? m.contributor_count : 0, lastUpdated:m ? m.updated_at : null,
        patches:(rows || []).map(r => ({ id:r.short_id, created:r.created_at, device:r.contributor_id, data:r.stab_map })),
      });
    }

    // PREVIEW (server-side live wall): ?wall=1[&have=<generation>] → the frame the
    // wall tick wrote (mother_display theme "wall:<theme>", tools/wall-tick.mjs).
    // Every screen shows the same frame. A screen that already has this
    // generation gets a tiny {same:true}; the frame itself (~0.5 MB, "wz1."
    // compressed, lib/wall-frame.js) is cached at the edge per generation. No
    // wall row yet → the behaviour below (the theme's live canvas).
    if(url.searchParams.get('wall') === '1'){
      const key = 'wall:' + t.value;
      const { data:w, error:wErr } = await supabase.from('mother_display')
        .select('generation,contributor_count,updated_at').eq('theme', key).maybeSingle();
      if(wErr) console.warn('wall query failed:', wErr.message);
      if(w){
        const meta = { theme:t.value, wall:true, source:'wall', generation:w.generation, contributorCount:w.contributor_count, lastUpdated:w.updated_at };
        if(String(w.generation) === url.searchParams.get('have')) return json({ ...meta, same:true });
        const cache = typeof caches !== 'undefined' ? caches.default : null;
        const ck = new Request(`${url.origin}/__wall/${encodeURIComponent(key)}/${w.generation}`);
        const hit = cache && await cache.match(ck).catch(() => null);
        if(hit) return new Response(hit.body, { status:200, headers });
        const { data:f, error:fErr } = await supabase.from('mother_display')
          .select('cell_data').eq('theme', key).eq('generation', w.generation).maybeSingle();
        if(fErr) throw fErr;
        if(f && f.cell_data){
          const body = JSON.stringify({ ...meta, cellData:f.cell_data });
          if(cache) context.waitUntil?.(cache.put(ck, new Response(body, { headers:{ 'Content-Type':'application/json', 'Cache-Control':'public, max-age=3600' } })).catch(() => {}));
          return new Response(body, { status:200, headers });
        }
        // the tick moved on between the two reads: the screen asks again next poll
        return json({ ...meta, same:true, raced:true });
      }
    }

    const { data:mother, error:mErr } = await supabase
      .from('mother_display').select('*').eq('theme', theme).maybeSingle();
    if(mErr) console.warn('mother_display query failed:', mErr.message);
    if(mother && mother.cell_data){
      return json({
        theme:mother.theme, generation:mother.generation,
        cellData:mother.cell_data, contributorCount:mother.contributor_count,
        lastUpdated:mother.updated_at, source:'mother_display',
      });
    }

    const { data:latest, error:lErr } = await supabase
      .from('canvas_states')
      .select('theme,generation,cell_data,created_at')
      .eq('theme', theme).order('created_at', { ascending:false }).limit(1).maybeSingle();
    if(lErr) console.warn('canvas_states query failed:', lErr.message);
    if(latest && latest.cell_data){
      const { count } = await supabase.from('canvas_states')
        .select('contributor_id', { count:'exact', head:true }).eq('theme', theme);
      return json({
        theme:latest.theme, generation:latest.generation,
        cellData:latest.cell_data, contributorCount:count ?? null,
        lastUpdated:latest.created_at, source:'canvas_states',
      });
    }

    return json({ theme, empty:true, generation:0, cellData:null, contributorCount:0 });
  }catch(err){
    return json({ theme, empty:true, error:err.message }, 500);
  }
}
