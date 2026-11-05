// Cloudflare Pages Function — GET /api/canvas-load/:id
import { createClient } from '@supabase/supabase-js';
import { validateShareId } from '../../../lib/validate.js';
import { NS } from '../../../lib/variant.js';

export async function onRequestGet(context){
  const { params, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json',
  };
  const shareId = params.id;
  if(!shareId) return new Response(JSON.stringify({error:'No share id'}),{status:400,headers});
  if(!validateShareId(shareId).ok) return new Response(JSON.stringify({error:'Invalid share id'}),{status:400,headers});
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('canvas_states').select('*').eq('short_id', shareId).single();
    // PROTOTYPE (variant B): only canvases saved under this branch's namespace
    // are visible here, and the view_count bump is skipped, so production
    // share rows are never read into, or written by, the preview.
    if(error || !data || !String(data.theme||'').startsWith(NS))
      return new Response(JSON.stringify({error:'Canvas not found'}),{status:404,headers});
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
