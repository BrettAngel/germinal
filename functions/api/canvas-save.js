// Cloudflare Pages Function — POST /api/canvas-save
// Saves a canvas state, returns a short share id.
//
// PROTOTYPE (variant B): the theme is always forced into this branch's
// namespace (lib/variant.js, "love" → "pb-love"), so this code can never
// write a real theme's rows. Otherwise main's save (the live canvas is the
// latest save, no merge), plus lineage depth (lib/lineage.js). Must be
// reworked before merging.
import { createClient } from '@supabase/supabase-js';
import { validateSaveBody, MAX_BODY_BYTES } from '../../lib/validate.js';
import { resolveLineage } from '../../lib/lineage.js';
import { nsTheme } from '../../lib/variant.js';

function shortId(){ return Math.random().toString(36).slice(2,8); }

export async function onRequestPost(context){
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Content-Type':'application/json',
  };
  const bad = (error, status=400) => new Response(JSON.stringify({error}),{status,headers});

  const declared = Number(request.headers.get('Content-Length') || 0);
  if(declared > MAX_BODY_BYTES) return bad('Payload too large', 413);

  let body;
  try{
    const text = await request.text();
    if(text.length > MAX_BODY_BYTES) return bad('Payload too large', 413);
    body = JSON.parse(text);
  }catch(e){
    return bad('Invalid JSON body');
  }
  const v = validateSaveBody(body);
  if(!v.ok) return bad(v.error);
  const { generation, parentId, cellData, stabMap, contributorId } = v.value;
  const theme = nsTheme(v.value.theme);              // PROTOTYPE: unconditional namespace

  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY){
    return bad('Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)', 503);
  }
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // PROTOTYPE (lineage depth, approved): saves that start from the live
    // canvas get the theme's latest save as parent (lib/lineage.js);
    // share-link saves keep their parent.
    const lin = await resolveLineage({
      parentId, theme,
      lookupById: async id => (await supabase.from('canvas_states').select('short_id,depth').eq('short_id', id).maybeSingle()).data || null,
      lookupLatest: async th => (await supabase.from('canvas_states').select('short_id,depth').eq('theme', th)
                                   .order('created_at', { ascending:false }).limit(1).maybeSingle()).data || null,
    });
    const depth = lin.depth;

    let id, attempts = 0;
    while(attempts++ < 10){
      id = shortId();
      const { data:ex } = await supabase.from('canvas_states')
        .select('short_id').eq('short_id', id).maybeSingle();
      if(!ex) break;
    }

    const { error } = await supabase.from('canvas_states').insert({
      short_id:id, theme, generation,
      parent_id:lin.parentId, depth,
      cell_data:cellData, stab_map:stabMap,
      contributor_id:contributorId
    });
    if(error) throw error;

    // Merge into mother display (best-effort)
    try{
      const { data:mother } = await supabase.from('mother_display')
        .select('*').eq('theme', theme).maybeSingle();
      if(!mother){
        await supabase.from('mother_display').insert({
          theme, generation:1, cell_data:cellData, contributor_count:1 });
      } else {
        await supabase.from('mother_display').update({
          contributor_count:mother.contributor_count+1,
          generation:mother.generation+1,
          cell_data:cellData,
          updated_at:new Date().toISOString()
        }).eq('theme', theme);
      }
    }catch(e){ /* non-fatal */ }

    const origin = new URL(request.url).origin;   // PROTOTYPE: links point at the preview they were made on
    return new Response(JSON.stringify({
      shareId:id, shareUrl:`${origin}/app.html?c=${id}`, depth, parentId:lin.parentId, lineage:lin.via, theme
    }),{status:200,headers});
  }catch(err){
    return new Response(JSON.stringify({error:err.message}),{status:500,headers});
  }
}

export async function onRequestOptions(){
  return new Response(null,{status:200,headers:{
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
  }});
}
