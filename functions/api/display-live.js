// Cloudflare Pages Function — GET /api/display-live?theme=love[&hint=pull]
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
  // PROTOTYPE (variant B): always read this branch's namespaced theme, e.g.
  // ?theme=love&hint=pull → "pb-love-pull". Never a real theme's rows.
  const theme = nsTheme(t.value, url.searchParams.get('hint'));

  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY){
    return json({ theme, empty:true, error:'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)' }, 503);
  }
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

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
