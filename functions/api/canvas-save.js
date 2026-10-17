// Cloudflare Pages Function — POST /api/canvas-save
// Saves a canvas state, returns a short share id.
import { createClient } from '@supabase/supabase-js';
import { validateSaveBody, MAX_BODY_BYTES } from '../../lib/validate.js';

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
  const { theme, generation, parentId, cellData, stabMap, contributorId } = v.value;

  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    let depth = 0;
    if(parentId){
      const { data:p } = await supabase.from('canvas_states')
        .select('depth').eq('short_id', parentId).single();
      if(p) depth = p.depth + 1;
    }

    let id, attempts = 0;
    while(attempts++ < 10){
      id = shortId();
      const { data:ex } = await supabase.from('canvas_states')
        .select('short_id').eq('short_id', id).single();
      if(!ex) break;
    }

    const { error } = await supabase.from('canvas_states').insert({
      short_id:id, theme, generation,
      parent_id:parentId||null, depth,
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

    return new Response(JSON.stringify({
      shareId:id, shareUrl:`https://germinal.studio/app.html?c=${id}`, depth
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
