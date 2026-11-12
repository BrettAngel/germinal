#!/usr/bin/env node
// PREVIEW (server-side live wall): ONE wall tick. The server is the single
// source of truth: every screen just shows the frame this writes.
//   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/wall-tick.mjs [--theme love] [--steps 2] [--state .wall-state]
// Each run: read the wall row (mother_display, theme "wall:<theme>") → restore
// the wall's state (engine cells + compositor, from --state; the GitHub
// workflow keeps it in the Actions cache) → land the contributions saved since
// the last tick (canvas_states "gp1." patches) → N real Evolves (main's
// stepGen via lib/wall-core.js; SIM4 N1, both flags on) → write the frame
// (lib/wall-frame.js) with a compare-and-set on generation, so two overlapping
// runs can't both write: the loser writes nothing and keeps no state.
// If the state is missing or belongs to another generation, the wall is
// rebuilt from the stored frame (its holds fade as one weak base patch).
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { WallCore } from '../lib/wall-core.js';
import { Compositor, FLAGS, MAX_AGE_H, WT } from '../lib/patch.js';
import { packFrame, unpackFrame, frameToSave } from '../lib/wall-frame.js';
import { nsTheme } from '../lib/variant.js';

export const wallKey = theme => 'wall:' + theme;
const enc = encodeURIComponent, PAGE = 200;

// ── a tiny PostgREST client (service key from the environment; never logged) ──
export function restClient(url, key, fetchImpl = globalThis.fetch){
  const base = String(url || '').replace(/\/+$/, '') + '/rest/v1/';
  const h = { apikey: key, 'Content-Type': 'application/json', ...(String(key).startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}) };
  async function call(method, p, body, prefer){
    const r = await fetchImpl(base + p, { method, headers: { ...h, ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if(r.status === 409) return { conflict: true };
    const t = await r.text();
    if(!r.ok) throw new Error(`${method} ${p.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  }
  return { get: p => call('GET', p), post: (p, b) => call('POST', p, b, 'return=representation'), patch: (p, b) => call('PATCH', p, b, 'return=representation') };
}

// ── the wall's state: engine cells (full 8-bit colour + hold level) + the compositor ──
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const unb64 = (s, T) => { const b = Buffer.from(s, 'base64'); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
export function snapshot(core, extra){
  const E = core.E, C = core.C, rgb = new Uint8Array(WT * 3), s = new Uint8Array(WT);
  for(let i = 0; i < WT; i++){ const c = E.cells[i].c || '#000000'; rgb[i * 3] = parseInt(c.slice(1, 3), 16); rgb[i * 3 + 1] = parseInt(c.slice(3, 5), 16); rgb[i * 3 + 2] = parseInt(c.slice(5, 7), 16); s[i] = E.cells[i].s; }
  const active = C.active.map(p => { const own = [], lv = [];
    p.cells.forEach((i, q) => { if(C.owner[i] === p.id){ own.push(i); lv.push(p.lvl[q]); } });
    return { id: p.id, base: !!p.base, cells: b64(Uint32Array.from(own)), lvl: b64(Uint8Array.from(lv)), C: p.C, F: p.F, T: p.T, birth: p.birth, fam: p.fam, mlum: p.mlum, device: p.device || null, src: p.src || null }; });
  return { v: 1, ...extra, engineGen: E.generation, rgb: b64(rgb), s: b64(s),
    comp: { nextId: C.nextId, lastSafe: Number.isFinite(C.lastSafe) ? C.lastSafe : null, stat: C.stat, active, devices: [...C.devices].map(([d, L]) => [d, L.map(p => p.id)]) } };
}
export function restore(st, theme){
  const core = new WallCore({ theme, flags: FLAGS }), E = core.E, rgb = unb64(st.rgb, Uint8Array), s = unb64(st.s, Uint8Array), hx = v => v.toString(16).padStart(2, '0');
  const cells = new Array(WT); for(let i = 0; i < WT; i++) cells[i] = { c: '#' + hx(rgb[i * 3]) + hx(rgb[i * 3 + 1]) + hx(rgb[i * 3 + 2]), s: s[i] };
  E.cells = cells; E.generation = st.engineGen;
  const C = core.C = new Compositor(E, core.opts);
  C.nextId = st.comp.nextId; C.lastSafe = st.comp.lastSafe == null ? -Infinity : st.comp.lastSafe; Object.assign(C.stat, st.comp.stat);
  for(const a of st.comp.active){ const p = { ...a, cells: [...unb64(a.cells, Uint32Array)], lvl: unb64(a.lvl, Uint8Array) };
    if(!p.base) delete p.base; C.byId.set(p.id, p); C.active.push(p); for(const i of p.cells) C.owner[i] = p.id; }
  for(const [d, ids] of st.comp.devices){ const L = ids.map(id => C.byId.get(id)).filter(Boolean); if(L.length) C.devices.set(d, L); }
  return core;
}
export function loadState(file){ try{ return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }catch(e){ return null; } }
export function saveState(file, st){ fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(st))); fs.renameSync(tmp, file); }

async function fetchPatches(rest, source, since){
  let out = [];
  for(let page = 0; page < 10; page++){
    const rows = await rest.get(`canvas_states?theme=eq.${enc(source)}&created_at=gt.${enc(since)}&stab_map=like.${enc('gp1.*')}&select=short_id,created_at,contributor_id,stab_map&order=created_at.asc&limit=${PAGE}`) || [];
    out = out.concat(rows.map(r => ({ id: r.short_id, created: r.created_at, device: r.contributor_id, data: r.stab_map })));
    if(rows.length < PAGE) break; since = rows[rows.length - 1].created_at;
  }
  return out;
}

export async function runTick({ rest, theme = 'love', source = nsTheme(theme), steps = 2, stateFile = null, now = Date.now(), log = () => {} }){
  const key = wallKey(theme);
  const row = (await rest.get(`mother_display?theme=eq.${enc(key)}&select=generation,updated_at,contributor_count`) || [])[0] || null;
  const st = stateFile ? loadState(stateFile) : null;
  let core, since, how;
  if(st && row && st.theme === theme && st.generation === row.generation){ core = restore(st, theme); since = st.since; how = 'state'; }
  else if(row){   // no state (new runner / cache evicted) or another writer moved on: rebuild from the stored frame
    const full = (await rest.get(`mother_display?theme=eq.${enc(key)}&select=cell_data,updated_at,generation`) || [])[0];
    const u16 = full && await unpackFrame(full.cell_data); if(!u16) throw new Error('wall frame unreadable');
    core = new WallCore({ theme, flags: FLAGS }); core.boot({ cellData: frameToSave(u16), lastUpdated: full.updated_at, patches: [], now });
    core.E.generation = full.generation; since = full.updated_at; how = 'rebuilt';
  }else{          // the first tick ever: start from the theme's live canvas (as the app does), replay the recent contributions
    const src = (await rest.get(`mother_display?theme=eq.${enc(source)}&select=cell_data,updated_at`) || [])[0] || null;
    const horizon = new Date(now - MAX_AGE_H * 3600e3).toISOString(), list = await fetchPatches(rest, source, horizon);
    core = new WallCore({ theme, flags: FLAGS }); core.boot({ cellData: src && src.cell_data || null, lastUpdated: src && src.updated_at, patches: list, now });
    core.E.generation = 0; since = list.length ? list[list.length - 1].created : new Date(now).toISOString(); how = 'new';
  }
  const fresh = how === 'new' ? [] : await fetchPatches(rest, source, since);
  const landed0 = core.C.stat.landed;
  if(fresh.length){ core.addPatches(fresh, now, true); since = fresh[fresh.length - 1].created; }
  for(let k = 0; k < steps; k++) core.step(now);
  const gen = core.E.generation, frame = await packFrame(core.E.encodeForServer()), landed = core.C.stat.landed - landed0;
  const body = { generation: gen, cell_data: frame, contributor_count: (row ? row.contributor_count || 0 : 0) + landed, updated_at: new Date(now).toISOString() };
  const res = row ? await rest.patch(`mother_display?theme=eq.${enc(key)}&generation=eq.${row.generation}`, body)
                  : await rest.post('mother_display', { theme: key, ...body });
  if(!res || res.conflict || (Array.isArray(res) && !res.length)){ log(`tick ${key}: another run wrote first (generation ${row ? row.generation : 'new'}); nothing written`); return { written: false, how, conflict: true }; }
  if(stateFile) saveState(stateFile, snapshot(core, { theme, generation: gen, since }));
  const sum = core.C.summary(), out = { written: true, how, key, generation: gen, landed, fresh: fresh.length, held: +sum.held.toFixed(4), patches: sum.patches, bytes: frame.length };
  log(`tick ${key}: ${JSON.stringify(out)}`);
  return out;
}

// CLI
if(import.meta.url === 'file://' + process.argv[1]){
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if(!url || !key){ console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set'); process.exit(2); }
  if(/zbupbejkjpdwrzulxydj/.test(url) && process.env.WALL_ALLOW_PRODUCTION !== '1'){ console.error('refusing the production project without WALL_ALLOW_PRODUCTION=1'); process.exit(2); }
  const theme = arg('theme', 'love'), steps = Math.max(1, Math.min(10, +arg('steps', 2) || 2));
  runTick({ rest: restClient(url, key), theme, steps, stateFile: path.join(arg('state', '.wall-state'), theme + '.json.gz'), log: console.log })
    .catch(e => { console.error('wall tick failed:', e.message); process.exit(1); });
}
