// Cloudflare Pages Function — POST /api/canvas-save
// Saves a canvas state, returns a short share id, and MERGES it into the
// shared live canvas for its theme (prototype: see lib/merge.js).
//
// PROTOTYPE (variant B): the theme is always forced into this branch's
// namespace (lib/variant.js, e.g. "love" → "pb-love-attractors"), so this
// code can never write a real theme's rows. Must be reworked before merging.
import { createClient } from '@supabase/supabase-js';
import { validateSaveBody, MAX_BODY_BYTES } from '../../lib/validate.js';
import { decodeCells, encodeCells, decodeChosen, mergeIntoMother } from '../../lib/merge.js';
import { nsTheme, PARAMS } from '../../lib/variant.js';

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
  const { generation, parentId, cellData, stabMap, contributorId, baseGen } = v.value;
  const theme = nsTheme(v.value.theme);              // PROTOTYPE: unconditional namespace

  const incoming = decodeCells(cellData);
  if(!incoming) return bad('cellData could not be decoded');
  const chosen = decodeChosen(stabMap);              // null if absent / wrong size

  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY){
    return bad('Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)', 503);
  }
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    let depth = 0;
    if(parentId){
      const { data:p } = await supabase.from('canvas_states')
        .select('depth').eq('short_id', parentId).maybeSingle();
      if(p) depth = p.depth + 1;
    }

    let id, attempts = 0;
    while(attempts++ < 10){
      id = shortId();
      const { data:ex } = await supabase.from('canvas_states')
        .select('short_id').eq('short_id', id).maybeSingle();
      if(!ex) break;
    }

    const { error } = await supabase.from('canvas_states').insert({
      short_id:id, theme, generation,
      parent_id:parentId||null, depth,
      cell_data:cellData, stab_map:chosen ? stabMap : null,
      contributor_id:contributorId
    });
    if(error) throw error;

    // Merge into the live canvas. Optimistic concurrency: the update only
    // applies if mother.generation is still what we read; otherwise someone
    // else saved in between, so re-read and merge again (as 'held-only').
    let merge = { ok:false };
    try{
      for(let attempt = 0; attempt < 4 && !merge.ok; attempt++){
        const { data:mother, error:mErr } = await supabase.from('mother_display')
          .select('generation,cell_data,contributor_count').eq('theme', theme).maybeSingle();
        if(mErr) throw mErr;
        if(!mother){
          const { error:iErr } = await supabase.from('mother_display').insert({
            theme, generation:1, cell_data:cellData, contributor_count:1 });
          if(!iErr) merge = { ok:true, mode:'first', motherGeneration:1, released:0 };
          continue; // unique(theme) conflict → someone created it first; merge into theirs
        }
        const motherCells = decodeCells(mother.cell_data);
        const res = mergeIntoMother({
          mother: motherCells, incoming, chosen,
          continuation: motherCells !== null && baseGen !== null && baseGen === mother.generation,
          release: PARAMS.release,
        });
        const nextGen = mother.generation + 1;
        const { data:upd, error:uErr } = await supabase.from('mother_display').update({
          contributor_count:(mother.contributor_count||0)+1,
          generation:nextGen,
          cell_data:encodeCells(res.cells),
          updated_at:new Date().toISOString()
        }).eq('theme', theme).eq('generation', mother.generation).select('generation');
        if(uErr) throw uErr;
        if(upd && upd.length) merge = { ok:true, mode:res.mode, motherGeneration:nextGen, released:res.stats.released, held:res.stats.held };
      }
    }catch(e){ merge = { ok:false, error:e.message }; }

    const origin = new URL(request.url).origin;
    return new Response(JSON.stringify({
      shareId:id, shareUrl:`${origin}/app.html?c=${id}`, depth, theme, merge
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
