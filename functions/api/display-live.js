// Cloudflare Pages Function — GET /api/display-live?theme=love
import { createClient } from '@supabase/supabase-js';

export async function onRequestGet(context){
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin':'*',
    'Content-Type':'application/json',
    'Cache-Control':'public, max-age=30',
  };
  const url = new URL(request.url);
  const theme = url.searchParams.get('theme') || 'love';
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase
      .from('mother_display').select('*').eq('theme', theme).single();
    if(error || !data) return new Response(JSON.stringify({error:'No display data yet'}),{status:404,headers});
    return new Response(JSON.stringify({
      theme:data.theme, generation:data.generation,
      cellData:data.cell_data, contributorCount:data.contributor_count,
      lastUpdated:data.updated_at,
    }),{status:200,headers});
  }catch(err){
    return new Response(JSON.stringify({error:err.message}),{status:500,headers});
  }
}
