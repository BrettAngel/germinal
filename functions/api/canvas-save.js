// Cloudflare Pages Function — POST /api/canvas-save
// Saves a canvas state, returns a short share id, and MERGES it into the
// shared live canvas for its theme (prototype: see lib/merge.js).
//
// PROTOTYPE (variant B): the theme is always forced into this branch's
// namespace (lib/variant.js, e.g. "love" → "pb-love-attractors"), so this
// code can never write a real theme's rows. Must be reworked before merging.
import { createClient } from '@supabase/supabase-js';
import { validateSaveBody, MAX_BODY_BYTES } from '../../lib/validate.js';
import { resolveLineage } from '../../lib/lineage.js';
import { decodeCells, decodeChosen, decodeStab, levelsFromCells, unpackMother, packMother, mergeIntoMother } from '../../lib/merge.js';
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

  const incCells = decodeCells(cellData);
  if(!incCells) return bad('cellData could not be decoded');
  // Hold levels / loose / chosen travel in stabMap (SM2, lib/merge.js). Older
  // clients sent a 1-bit chosen map; anything else → levels from the held bit.
  const sm2 = decodeStab(stabMap);
  const incoming = sm2
    ? { cells: incCells, level: sm2.level, loose: sm2.loose }
    : { cells: incCells, level: levelsFromCells(incCells), loose: new Uint8Array(incCells.length) };
  const chosen = sm2 ? sm2.chosen : decodeChosen(stabMap);

  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY){
    return bad('Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)', 503);
  }
  try{
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

    // PROTOTYPE: saves that start from the live canvas get the theme's latest
    // save as parent (lib/lineage.js); share-link saves keep their parent.
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
      cell_data:cellData, stab_map:(sm2 || chosen) ? stabMap : null,
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
          const first = mergeIntoMother({ mother:null, incoming });
          const { error:iErr } = await supabase.from('mother_display').insert({
            theme, generation:1, cell_data:packMother(first), contributor_count:1 });
          if(!iErr) merge = { ok:true, mode:'first', motherGeneration:1, contributorCount:1, released:0, ...first.stats };
          continue; // unique(theme) conflict → someone created it first; merge into theirs
        }
        const motherState = unpackMother(mother.cell_data);   // null if undecodable → treated as first
        const res = mergeIntoMother({
          mother: motherState, incoming, chosen,
          continuation: motherState !== null && baseGen !== null && baseGen === mother.generation,
          release: PARAMS.release, releaseLoose: PARAMS.releaseLoose,
        });
        const nextGen = mother.generation + 1;
        const { data:upd, error:uErr } = await supabase.from('mother_display').update({
          contributor_count:(mother.contributor_count||0)+1,
          generation:nextGen,
          cell_data:packMother(res),
          updated_at:new Date().toISOString()
        }).eq('theme', theme).eq('generation', mother.generation).select('generation');
        if(uErr) throw uErr;
        if(upd && upd.length) merge = { ok:true, mode:res.mode, motherGeneration:nextGen, contributorCount:(mother.contributor_count||0)+1, ...res.stats };
      }
    }catch(e){ merge = { ok:false, error:e.message }; }

    const origin = new URL(request.url).origin;
    return new Response(JSON.stringify({
      shareId:id, shareUrl:`${origin}/app.html?c=${id}`, depth, parentId:lin.parentId, lineage:lin.via, theme, merge
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
