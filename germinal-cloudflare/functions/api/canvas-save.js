// Cloudflare Pages Function — POST /api/canvas-save
// Saves a canvas state, returns a short share id.
import { createClient } from '@supabase/supabase-js';

function shortId(){ return Math.random().toString(36).slice(2,8); }

export async function onRequestPost(context){
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Content-Type':'application/json',
  };
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const body = await request.json();
    const { theme='love', generation=1, parentId=null,
            cellData, stabMap, contributorId } = body;

    if(!cellData) return new Response(JSON.stringify({error:'Missing cellData'}),{status:400,headers});

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
      cell_data:cellData, stab_map:stabMap||null,
      contributor_id:contributorId||'anonymous'
    });
    if(error) throw error;

    // Merge into mother display (best-effort)
    try{
      const { data:mother } = await supabase.from('mother_display')
        .select('*').eq('theme', theme).single();
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
      shareId:id, shareUrl:`https://germinal.studio/c/${id}`, depth
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
