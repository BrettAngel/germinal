// Cloudflare Pages Function — GET /api/canvas-load/:id
import { createClient } from '@supabase/supabase-js';

export async function onRequestGet(context){
  const { params, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json',
  };
  const shareId = params.id;
  if(!shareId) return new Response(JSON.stringify({error:'No share id'}),{status:400,headers});
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('canvas_states').select('*').eq('short_id', shareId).single();
    if(error || !data) return new Response(JSON.stringify({error:'Canvas not found'}),{status:404,headers});
    try{ await supabase.from('canvas_states')
      .update({ view_count:(data.view_count||0)+1 }).eq('short_id', shareId); }catch(e){}
    return new Response(JSON.stringify({
      shareId,
      theme:data.theme, generation:data.generation, depth:data.depth,
      cellData:data.cell_data, stabMap:data.stab_map,
      parentId:data.parent_id, createdAt:data.created_at,
      contributorCount:data.view_count||0,
    }),{status:200,headers});
  }catch(err){
    return new Response(JSON.stringify({error:err.message}),{status:500,headers});
  }
}
