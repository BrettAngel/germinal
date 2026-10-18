// Cloudflare Pages Function: POST /api/dream-event
// Anonymous "Dream it" onboarding session summary (variant B prototype).
//
// DISABLED BY DEFAULT. It answers 404 unless the env var DREAM_EVENTS_ENABLED
// is '1' or 'true' (case-insensitive), set in the Cloudflare Pages PREVIEW env
// only, and it needs the table from supabase/preview-migration-events.sql
// (preview project, approved by Brett). Production has no flag, so it is 404.
// The client (dream-ui.js) only sends from *.pages.dev hosts.
import { createClient } from '@supabase/supabase-js';
import { validateDreamEvent } from '../../lib/dream-event.js';

const MAX = 2048;

export function eventsEnabled(env){
  const f = String((env && env.DREAM_EVENTS_ENABLED) ?? '').trim().toLowerCase();
  return f === '1' || f === 'true';
}

export async function onRequestPost({ request, env }){
  const headers = { 'Content-Type':'application/json' };
  const out = (o, status=200) => new Response(JSON.stringify(o), { status, headers });
  if(!eventsEnabled(env)) return out({ error:'Not enabled' }, 404);
  if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return out({ error:'Not configured' }, 503);
  if(Number(request.headers.get('Content-Length') || 0) > MAX) return out({ error:'Payload too large' }, 413);
  let body;
  try{
    const text = await request.text();
    if(text.length > MAX) return out({ error:'Payload too large' }, 413);
    body = JSON.parse(text);
  }catch(e){ return out({ error:'Invalid JSON body' }, 400); }
  const v = validateDreamEvent(body);
  if(!v.ok) return out({ error:v.error }, 400);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const { error } = await supabase.from('dream_events').insert(v.row);
  if(error) return out({ error:'Store failed' }, 500);
  return out({ ok:true }, 201);
}

export async function onRequest({ request }){
  if(request.method === 'POST') return onRequestPost(arguments[0]);
  return new Response(null, { status:405, headers:{ Allow:'POST' } });
}
