// PREVIEW (live-wall compositor): the wall runs main's real engine; the
// compositor (lib/patch.js) and the save payload ("gp1." in stabMap).
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import crypto from 'node:crypto'; import vm from 'node:vm';
import { generate, SPANS as GEN_SPANS } from '../tools/build-engine.mjs';
import { createGerminalEngine } from '../engine/germinal-engine.js';
import * as P from '../lib/patch.js';
import { WallCore } from '../lib/wall-core.js';
import * as V from '../lib/validate.js';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const app = read('app.html'), bundle = read('engine/germinal-engine.js'), live = read('live.html');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
function mulberry32(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const seeded = s => { const M = Object.create(Math); M.random = mulberry32(s); return M; };

// ── the same span definitions and fingerprints as tests/variant.test.mjs ──
const SPANS = [['// ── Color helpers ──', '// ═══'], ['function seedCanvas(){', '// ── No paintSun()'], ['function initCells(){', '// ── Stats ──'],
  ['const PALS={', 'function buildPool(){'], ['function buildPool(){', 'function nextGen(){'], ['// ── Encode current canvas state for server ──', 'async function saveToServer(){']];
const span = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, 'missing ' + a); return s.slice(i, s.indexOf(b, i + a.length)); };
function engineText(s, blankPalette = false){ return SPANS.map(([a, b]) => blankPalette && a === 'const PALS={' ? '<<palette table>>' : span(s, a, b)).join('\n@@\n')
  .replace(/^  pendingSel\.clear\(\);[^\n]*\n/m, '').replace('userOwnedCells=new Set();pendingSel.clear();\n', 'userOwnedCells=new Set();\n'); }
function mainCodec(t){
  const a = t.indexOf('// PROTOTYPE (option A, Brett-approved 2026-10-19)'), z = 'function x5(q){return (q<<3)|(q>>2);}\n';
  t = t.slice(0, a) + t.slice(t.indexOf(z) + z.length);
  for(const [k, c] of [['r', '1,3'], ['g', '3,5'], ['b', '5,7']]) t = t.replace(`const ${k}=q5(parseInt(c.slice(${c}),16));`, `const ${k}=parseInt(c.slice(${c}),16)>>3;`);
  return t.replace('const r=x5((q>>10)&31);', 'const r=((q>>10)&31)<<3;').replace('const g=x5((q>>5)&31);', 'const g=((q>>5)&31)<<3;').replace('const b=x5(q&31);', 'const b=(q&31)<<3;');
}
const evolveText = s => engineText(s, true).split('\n@@\n').slice(0, -1).join('\n@@\n');
const MAIN_EVOLVE_NOPAL_SHA256 = '17d7d017d3e1dfadc73a81b8e5a9959f5f02b152a37eb4440807c5e86b3fd2c7';
const MAIN_ENGINE_NOPAL_SHA256 = 'a530f17b1ba2892836146aaa03f739e9c40ebdb523c46f7946313c5c6ec41334';

test('engine bundle: engine/germinal-engine.js is exactly what tools/build-engine.mjs generates from app.html (no drift)', () => {
  assert.deepEqual(GEN_SPANS, SPANS, 'the generator copies the fingerprinted spans');
  assert.equal(bundle, generate(app), 'run: node tools/build-engine.mjs');
});
test('engine bundle: its spans carry main\'s fingerprints (17d7d017 evolve code; a530f17b with the whitelisted codec), same as app.html', () => {
  for(const [name, s] of [['app.html', app], ['bundle', bundle]]){
    assert.equal(sha(evolveText(s)), MAIN_EVOLVE_NOPAL_SHA256, name + ' evolve');
    const t = engineText(s, true), k = t.lastIndexOf('\n@@\n') + 4;
    assert.equal(sha(t.slice(0, k) + mainCodec(t.slice(k))), MAIN_ENGINE_NOPAL_SHA256, name + ' engine');
  }
  assert.equal(engineText(bundle), engineText(app), 'every span, including the palette table, byte for byte');
  assert.ok(bundle.includes(span(app, 'function stabCount(){', '\n\n')), 'the stats helpers verbatim');
});
test('engine bundle: behaves exactly like app.html\'s spans (same seed → same cells after start canvas + real stepGen)', () => {
  const prelude = `const CS=2,WC=900,WR=660,WW=WC*CS,WH=WR*CS,WT=WC*WR;let cells=[],generation=1,recogField=new Float32Array(WT);
    let affinityPerCell=null,userOwnedCells=new Set(),userScore=0,generationLog=[],historyLayers=[];const pendingSel={clear(){}};function scoreGeneration(){}
    const document={getElementById:()=>({value:'love'})};`;
  const src = prelude + SPANS.map(([a, b]) => span(app, a, b)).join('\n') + span(app, 'function stabCount(){', '\n\n') +
    '\nthis.run=()=>{initCells();for(let k=0;k<30;k++)stepGenFast();for(let i=0;i<WT;i+=97)cells[i].s=1+(i%3);for(let k=0;k<3;k++)stepGen();return cells.map(c=>c.c+c.s).join();};';
  const ctx = vm.createContext({ Math: seeded(7), Float32Array, Uint16Array, Uint8Array, Set, Array, Object, String, parseInt, btoa, atob, console });
  vm.runInContext(src, ctx);
  const E = createGerminalEngine({ theme: 'love', Math: seeded(7) });
  E.initCells(); for(let k = 0; k < 30; k++) E.stepGenFast(); for(let i = 0; i < E.WT; i += 97) E.cells[i].s = 1 + (i % 3); for(let k = 0; k < 3; k++) E.stepGen();
  assert.equal(E.cells.map(c => c.c + c.s).join(), ctx.run());
});

// ── payload ──
const mk = (list, ring = [], rounds = 3) => ({ cells: list.map(([i, l, r, g, b]) => ({ i, l, r, g, b })), ring, rounds });
test('patch payload: "gp1." round trip; garbage, bad levels and out-of-range cells are rejected', () => {
  const p = mk([[0, 1, 255, 0, 0], [P.WT - 1, 3, 1, 2, 3], [5000, 2, 10, 20, 30]], [{ i: 7, f: 3 }, { i: 9, f: 255 }]);
  const s = P.encodePatch(p); assert.match(s, /^gp1\.[A-Za-z0-9+/]+={0,2}$/);
  assert.deepEqual(P.decodePatch(s), p);
  for(const bad of [null, '', 'gp2.AAAA', 'gp1.!!!!', 'gp1.' + btoa('\x01\x00\x01'), s.slice(0, -4)]) assert.equal(P.decodePatch(bad), null, String(bad));
  const lvl0 = P.encodePatch(mk([[3, 0, 1, 1, 1]])); assert.equal(P.decodePatch(lvl0), null, 'level 0 is not a hold');
  assert.ok(V.validateSaveBody({ cellData: 'A'.repeat(V.CELL_DATA_LENGTH), stabMap: s }).ok, 'the save accepts it');
  for(const bad of ['hello', 'gp1.<x>', 'gp1.' + 'A'.repeat(V.PATCH_MAX_CHARS)]) assert.equal(V.validateSaveBody({ cellData: 'A'.repeat(V.CELL_DATA_LENGTH), stabMap: bad }).ok, false);
});
const canvas = (fill = '#202020') => Array.from({ length: P.WT }, () => ({ c: fill, s: 0 }));
test('extractPatch: only the cells this session raised (above the session\'s start levels), own colours + levels, capped; ring for Sel', () => {
  const cells = canvas(); const base = new Uint8Array(P.WT);
  cells[10].s = 1; base[10] = 1;                    // held before the session: not the visitor's
  cells[11].s = 2; base[11] = 1;                    // refined this session: theirs
  cells[12].s = 1; cells[12].c = '#ff0000';          // newly held
  const p = P.extractPatch({ cells, base, rounds: 4 });
  assert.deepEqual(p.cells.map(c => [c.i, c.l]), [[11, 2], [12, 1]]); assert.deepEqual(p.cells[1], { i: 12, l: 1, r: 255, g: 0, b: 0 });
  assert.equal(p.rounds, 4); assert.ok(p.ring.length > 0 && p.ring.every(r => r.i !== 11 && r.i !== 12));
  const big = canvas(); for(let i = 0; i < 20000; i++) big[i].s = 1;
  const q = P.extractPatch({ cells: big, base: new Uint8Array(P.WT) });
  assert.equal(q.cells.length, Math.round(P.N1.patchCap * P.WT), 'trimmed to 0.35%'); assert.ok(q.ring.length <= P.N1.ringCap);
  assert.ok(P.encodePatch(q).length < V.PATCH_MAX_CHARS, 'a full-size patch fits the save');
});
// a 12×12 block at (x0,y0): `pick` = only the red cells of a red/green checkerboard (selective), or the whole block (flood)
// (the surroundings are the same checkerboard, so a flood takes "everything there", a pick takes one colour)
function scene(x0, y0, mode){
  const cells = canvas();
  for(let y = y0 - 8; y < y0 + 20; y++) for(let x = x0 - 8; x < x0 + 20; x++){ const i = y * P.WC + x, red = (x + y) % 2 === 0;
    cells[i].c = red ? '#ee2233' : '#22aa44'; if(x >= x0 && x < x0 + 12 && y >= y0 && y < y0 + 12 && (mode === 'flood' || red)) cells[i].s = 1; }
  return P.extractPatch({ cells, base: new Uint8Array(P.WT), rounds: 5 });
}
test('confidence (SIM4 focus): a selective pick scores far above a flood lasso of the same spot', () => {
  const sel = P.confidence(scene(100, 100, 'pick')), flood = P.confidence(scene(100, 100, 'flood'));
  assert.ok(sel.Sel > 0.8, 'Sel ' + sel.Sel); assert.ok(flood.Sel < 0.2, 'flood Sel ' + flood.Sel);
  assert.ok(sel.C > 2 * flood.C, `${sel.C} vs ${flood.C}`);
  assert.ok(sel.T > flood.T && flood.T >= P.N1.Tmin && sel.T <= P.N1.Tmin + (P.N1.Tmax - P.N1.Tmin) * P.N1.Fcap);
});

// ── compositor ──
const HOUR = 3600e3;
function rig(flags){ const E = createGerminalEngine({ theme: 'love', Math: seeded(3) }); E.cells = canvas('#101010'); return { E, C: new P.Compositor(E, { flags }) }; }
const solid = (x0, y0, w, hex, l = 1) => { const [r, g, b] = P.fromHex(hex), cs = []; for(let y = y0; y < y0 + w; y++) for(let x = x0; x < x0 + w; x++) cs.push({ i: y * P.WC + x, l, r, g, b }); return cs; };
// a "confident" patch: single hue, compact, small, selective against a different-hued ring
const confident = (x0, y0, hex) => P.encodePatch({ cells: solid(x0, y0, 6, hex), ring: Array.from({ length: 40 }, (_, k) => ({ i: (y0 + 8) * P.WC + x0 + k, f: 6 })), rounds: 20 });
test('compositor: a patch lands once with its own colours; flag (a) lifts a confident patch to level 2+, off keeps its saved level', () => {
  const on = rig({ confLevel: true, refresh: false }), off = rig({ confLevel: false, refresh: false });
  const pOn = on.C.land({ id: 'a', device: 'd1', data: confident(50, 50, '#ee2233') }, 0);
  const pOff = off.C.land({ id: 'a', device: 'd1', data: confident(50, 50, '#ee2233') }, 0);
  assert.ok(pOn.conf.Cn >= 0.5, 'confident: Cn ' + pOn.conf.Cn);
  const i = 50 * P.WC + 50; assert.equal(on.E.cells[i].c, '#ee2233'); assert.ok(on.E.cells[i].s >= 2); assert.equal(off.E.cells[i].s, 1);
  assert.equal(on.C.land({ id: 'a', data: confident(50, 50, '#ee2233') }, 1), null, 'each contribution lands once');
});
test('compositor: strength steps the engine\'s hold levels down and releases below θ (s = 0, colour left to the engine)', () => {
  const { E, C } = rig({ confLevel: true }); const p = C.land({ id: 'a', data: confident(50, 50, '#ee2233') }, 0), i = 50 * P.WC + 50, T = p.T * HOUR;
  const at = h => -Math.log2(h) * T;
  C.decay(at(0.8)); assert.equal(E.cells[i].s, Math.min(3, p.lvl[0]));
  C.decay(at(0.6)); assert.equal(E.cells[i].s, Math.min(2, p.lvl[0]));
  C.decay(at(0.3)); assert.equal(E.cells[i].s, 1);
  C.decay(at(0.1)); assert.equal(E.cells[i].s, 0); assert.equal(E.cells[i].c, '#ee2233', 'released, not recoloured'); assert.equal(C.active.length, 0);
});
test('compositor: overlaps — the stronger patch keeps its cells, no blending', () => {
  const { E, C } = rig({ refresh: false });
  C.land({ id: 'strong', data: confident(50, 50, '#ee2233') }, 0);
  const weak = P.encodePatch({ cells: solid(50, 50, 6, '#3366ee'), ring: [], rounds: 1 });   // a flood-like patch, no ring contrast
  const q = C.land({ id: 'weak', data: weak }, 1000);
  assert.ok(q.C * q.F < C.active[0].C * C.active[0].F); assert.equal(q.cells.length, 0); assert.equal(E.cells[50 * P.WC + 50].c, '#ee2233');
});
test('compositor: flag (b) — a new patch of the same hue over a visible patch restarts its fade; off, or another hue, does not', () => {
  for(const [flag, hex, expect] of [[true, '#dd1144', true], [false, '#dd1144', false], [true, '#3366ee', false]]){
    const { C } = rig({ refresh: flag }); const p = C.land({ id: 'a', data: confident(50, 50, '#ee2233') }, 0);
    C.land({ id: 'b', data: P.encodePatch({ cells: solid(51, 51, 4, hex), ring: [], rounds: 1 }) }, 5 * HOUR);
    assert.equal(p.birth === 5 * HOUR, expect, `${flag} ${hex}`);
  }
});
test('compositor: per-device cap (2 live patches; a third releases the oldest) and the held cap halves the weakest half-lives', () => {
  const { E, C } = rig({});
  for(const [k, x] of [[1, 10], [2, 40], [3, 70]]) C.land({ id: 'p' + k, device: 'dev', data: confident(x, 10, '#ee2233') }, k);
  assert.equal(E.cells[10 * P.WC + 10].s, 0, 'oldest released'); assert.ok(E.cells[10 * P.WC + 70].s > 0);
  const H = rig({}); for(let i = 0; i < P.WT * 0.3; i++){ H.E.cells[i].s = 1; H.E.cells[i].c = ['#ee2233', '#3366ee', '#22aa44', '#ffcc00', '#8844dd', '#22bbaa'][i % 6]; } const base = H.C.addBase(0), T0 = base.T;
  H.C.safeguards(HOUR); assert.equal(base.T, T0 / 2); assert.equal(H.C.stat.capHits, 1);
  H.C.safeguards(HOUR + 60e3); assert.equal(base.T, T0 / 2, 'at most once per wall-hour');
});
test('wall core: boots (no data → main\'s start canvas), replays patches, and each step is one real stepGen; frames are the cells\' own colours', () => {
  const W = new WallCore({ theme: 'love', Math: seeded(11) }), now = Date.parse('2026-10-25T12:00:00Z');
  const rec = { id: 'x1', device: 'd', created: new Date(now - HOUR).toISOString(), data: confident(300, 300, '#ee2233') };
  const old = { id: 'x0', device: 'd', created: new Date(now - 40 * 24 * HOUR).toISOString(), data: confident(500, 300, '#3366ee') };
  const f0 = W.boot({ patches: [rec, old], now });
  assert.equal(f0.stats.patches, 1, 'the 40-day-old patch is past the release horizon'); assert.equal(f0.rgba.length, P.WT * 4);
  const g = W.E.generation, f1 = W.step(now + 5 * 60e3);
  assert.equal(W.E.generation, g + 1);
  const i = 3000, c = W.E.cells[i].c; assert.deepEqual([...f1.rgba.slice(4 * i, 4 * i + 3)], P.fromHex(c));
});
test('live.html: a thin viewer of the server frame — no engine, no local stepping, no drift; dissolve, no glow; offline keeps the last frame', () => {
  for(const gone of ['stepLocal', 'RAINBOW', 'lerpH(', 'function unq(', 'decodeCanvas', 'seedDemo', 'shadowBlur', 'pendingSel', 'Worker(', 'wall-core', 'germinal-engine', 'stepGen', 'setInterval(']) assert.ok(!live.includes(gone), gone);
  assert.match(live, /import \{ unpackFrame, frameToRGBA, WC, WR, WT \} from '\/lib\/wall-frame\.js';/);
  assert.match(live, /\/api\/display-live\?theme=\$\{encodeURIComponent\(theme\)\}&wall=1/); assert.match(live, /const POLL_MS=45000;/);
  assert.match(live, /backoff=Math\.min\(600000/); assert.match(live, /localStorage\.setItem\(CACHE_KEY/);
  assert.match(live, /image-rendering:pixelated/); assert.match(live, /box-shadow:0 0 80px rgba\(0,0,0,\.6\)/, 'the existing shadow stays');
  assert.ok(!fs.existsSync(new URL('../engine/wall-worker.js', import.meta.url)), 'no wall worker any more');
  assert.equal((live.match(/<\/script>/g) || []).length, (live.match(/<script/g) || []).length, 'balanced script tags');
  assert.match(read('lib/wall-core.js'), /from '\.\.\/engine\/germinal-engine\.js'/);
  assert.match(app, /stabMap: gpPayload\(\),/); assert.match(app, /import \* as P from '\/lib\/patch\.js';/);
});


// ── the server-side wall (tools/wall-tick.mjs, lib/wall-frame.js, display-live ?wall=1) ──
import * as WF from '../lib/wall-frame.js';
import * as TK from '../tools/wall-tick.mjs';
import os from 'node:os'; import path from 'node:path';
// an in-memory PostgREST (just the queries the tick makes); patch honours the generation=eq. compare-and-set
function fakeRest(){
  const db = { mother_display: [], canvas_states: [] }, calls = [];
  const parse = p => { const [t, q] = p.split('?'); const f = {}; for(const kv of (q || '').split('&')){ const [k, v] = kv.split('='); if(k) f[k] = decodeURIComponent(v || ''); } return { t, f }; };
  const match = (r, f) => Object.entries(f).every(([k, v]) => ['select', 'order', 'limit'].includes(k) ? true
    : v.startsWith('eq.') ? String(r[k]) === v.slice(3) : v.startsWith('gt.') ? r[k] > v.slice(3) : v.startsWith('like.') ? String(r[k] || '').startsWith(v.slice(5).replace('*', '')) : true);
  const tick = () => new Promise(r => setImmediate(r));
  return { db, calls,
    async get(p){ calls.push('GET ' + p.split('?')[0]); await tick(); const { t, f } = parse(p); let rows = db[t].filter(r => match(r, f));
      if(f.order) rows = rows.slice().sort((a, b) => a.created_at < b.created_at ? -1 : 1); if(f.limit) rows = rows.slice(0, +f.limit); return rows.map(r => ({ ...r })); },
    async post(p, b){ calls.push('POST ' + p); await tick(); if(db[p].some(r => r.theme === b.theme)) return { conflict: true }; db[p].push({ ...b }); return [{ ...b }]; },
    async patch(p, b){ calls.push('PATCH ' + p.split('?')[0]); await tick(); const { t, f } = parse(p); const rows = db[t].filter(r => match(r, f)); rows.forEach(r => Object.assign(r, b)); return rows.map(r => ({ ...r })); } };
}
const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wall-')), 'love.json.gz');
test('wall frame: pack → unpack round trip is the save codec exactly (colours + held bit); plain saves accepted; garbage → null; ~3x smaller', async () => {
  const E = createGerminalEngine({ theme: 'love', Math: seeded(5) }); E.initCells(); for(let k = 0; k < 5; k++) E.stepGenFast(); E.cells[7].s = 2;
  const save = E.encodeForServer(), packed = await WF.packFrame(save);
  assert.ok(packed.startsWith('wz1.') && packed.length < save.length / 2, `packed ${packed.length} vs ${save.length}`);
  const u = await WF.unpackFrame(packed), plain = await WF.unpackFrame(save);
  assert.deepEqual([...u], [...plain]); assert.equal(WF.frameToSave(u), save); assert.ok(u[7] & 0x8000, 'held bit kept');
  const E2 = createGerminalEngine({ theme: 'love' }); E2.initCells(); assert.ok(E2.decodeFromServer(save));
  const rgba = WF.frameToRGBA(u); for(const i of [0, 123, 4567, P.WT - 1]) assert.deepEqual([...rgba.slice(4 * i, 4 * i + 3)], P.fromHex(E2.cells[i].c), 'viewer colour = app decode, cell ' + i);
  for(const bad of [null, '', 'wz1.!!!', 'wz1.' + btoa('nope'), btoa('short')]) assert.equal(await WF.unpackFrame(bad), null);
});
test('wall tick: first tick creates wall:love; next ticks continue from the saved state, land each new patch once; lost state → rebuilt from the frame', async () => {
  const rest = fakeRest(), file = tmpState(), now = Date.parse('2026-11-12T12:00:00Z');
  const t1 = await TK.runTick({ rest, theme: 'love', steps: 2, stateFile: file, now });
  assert.deepEqual([t1.written, t1.how, t1.generation], [true, 'new', 2]);
  const row = () => rest.db.mother_display.find(r => r.theme === 'wall:love');
  assert.ok(row().cell_data.startsWith('wz1.')); assert.ok(await WF.unpackFrame(row().cell_data));
  rest.db.canvas_states.push({ theme: 'pb-love', short_id: 'p1', contributor_id: 'dev1', created_at: new Date(now + 60e3).toISOString(), stab_map: confident(300, 300, '#ee2233') });
  const f1 = row().cell_data, t2 = await TK.runTick({ rest, theme: 'love', steps: 2, stateFile: file, now: now + 600e3 });
  assert.deepEqual([t2.how, t2.generation, t2.landed, row().contributor_count], ['state', 4, 1, 1]);
  assert.notEqual(row().cell_data, f1, 'the frame evolved');
  const t3 = await TK.runTick({ rest, theme: 'love', steps: 2, stateFile: file, now: now + 1200e3 });
  assert.deepEqual([t3.how, t3.landed, t3.generation], ['state', 0, 6], 'a patch lands once');
  fs.rmSync(file);
  const t4 = await TK.runTick({ rest, theme: 'love', steps: 2, stateFile: file, now: now + 1800e3 });
  assert.deepEqual([t4.how, t4.generation], ['rebuilt', 8]);
  assert.ok(rest.db.mother_display.every(r => r.theme === 'wall:love'), 'writes only the wall row');
  assert.ok(!rest.calls.some(c => /PATCH|POST/.test(c) && !/mother_display/.test(c)), 'never writes canvas_states');
});
test('wall tick: two overlapping runs → exactly one writes (compare-and-set on generation); the loser keeps no state', async () => {
  const rest = fakeRest(), now = Date.parse('2026-11-12T12:00:00Z');
  await TK.runTick({ rest, theme: 'love', steps: 1, stateFile: null, now });
  const fa = tmpState(), fb = tmpState();
  const [a, b] = await Promise.all([TK.runTick({ rest, theme: 'love', steps: 2, stateFile: fa, now: now + 600e3 }), TK.runTick({ rest, theme: 'love', steps: 2, stateFile: fb, now: now + 600e3 })]);
  assert.equal([a, b].filter(r => r.written).length, 1, JSON.stringify([a, b]));
  assert.equal(rest.db.mother_display.find(r => r.theme === 'wall:love').generation, 3, 'advanced once');
  assert.equal([fa, fb].filter(f => fs.existsSync(f)).length, 1, 'only the winner saved state');
  // two first-ever runs: the insert conflicts for one of them
  const r2 = fakeRest(), [c, d] = await Promise.all([TK.runTick({ rest: r2, now }), TK.runTick({ rest: r2, now })]);
  assert.equal([c, d].filter(r => r.written).length, 1); assert.equal(r2.db.mother_display.length, 1);
});
test('wall tick: state snapshot → restore keeps cells, hold levels and patch ownership exactly', async () => {
  const W = new WallCore({ theme: 'love', Math: seeded(3) }), now = Date.parse('2026-11-12T12:00:00Z');
  W.boot({ patches: [{ id: 'a', device: 'd', created: new Date(now - 3600e3).toISOString(), data: confident(300, 300, '#ee2233') }], now }); W.step(now);
  const st = TK.snapshot(W, { theme: 'love', generation: 1, since: 'x' }), R = TK.restore(JSON.parse(JSON.stringify(st)), 'love');
  for(let i = 0; i < P.WT; i += 997) assert.deepEqual(R.E.cells[i], W.E.cells[i]);
  assert.deepEqual([...R.C.owner].filter(o => o > 0).length, [...W.C.owner].filter(o => o > 0).length);
  assert.deepEqual(R.C.summary(), W.C.summary());
  const tk = read('tools/wall-tick.mjs'); assert.match(tk, /zbupbejkjpdwrzulxydj/, 'refuses the production project unless explicitly allowed');
  const wf = read('ops/workflows/wall-tick.yml'); assert.match(wf, /cron: '\*\/10 \* \* \* \*'/); assert.match(wf, /PREVIEW_SUPABASE_SERVICE_KEY/); assert.match(wf, /group: wall-tick/);
  assert.match(read('ops/workflows/keepalive.yml'), /cron: '0 9 \* \* 1,4'/);
  const dl = read('functions/api/display-live.js'); assert.match(dl, /'wall:' \+ t\.value/); assert.match(dl, /same:true/);
});
