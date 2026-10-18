// Variant B tests: save isolation, lineage depth, the "Dream it" UI, the dream-event
// endpoint, and the proof that the colour/evolution engine is origin/main's, unchanged.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import crypto from 'node:crypto';
import * as V from '../lib/variant.js';
import * as D from '../lib/dream.js';
import { resolveLineage } from '../lib/lineage.js';
import { THEME_RE } from '../lib/validate.js';
import { validateDreamEvent } from '../lib/dream-event.js';

const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// a synthetic dark canvas with red-ish, warm and cool speckle
function speckle(WC, WR, seed){ const r = mulberry32(seed), c = new Uint8Array(WC * WR * 3);
  for(let i = 0; i < WC * WR; i++){ const k = r(), v = 40 + r() * 140;
    const col = k < 0.35 ? [v, v * 0.18, v * 0.25] : k < 0.55 ? [v, v * 0.5, v * 0.2] : k < 0.8 ? [v * 0.2, v * 0.4, v] : [v * 0.15, v * 0.15, v * 0.2];
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  return i => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]; }
const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');

// ── the engine is origin/main's (Oct 18 engine audit) ──
// The colour helpers, start canvas, palettes, recognition field, every
// generation step and the RGB555 save encoding, byte for byte. The only line
// allowed in between is the glow rule's overlay reset at the top of stepGen
// (pendingSel.clear(): what is highlighted, not what colour anything is).
const SPANS = [['// ── Color helpers ──', '// ═══'], ['function seedCanvas(){', '// ── No paintSun()'], ['function initCells(){', '// ── Stats ──'],
  ['const PALS={', 'function buildPool(){'], ['function buildPool(){', 'function nextGen(){'], ['// ── Encode current canvas state for server ──', 'async function saveToServer(){']];
function engineText(s){ return SPANS.map(([a, b]) => { const i = s.indexOf(a); assert.ok(i >= 0, 'missing ' + a); return s.slice(i, s.indexOf(b, i + a.length)); }).join('\n@@\n')
  .replace(/^  pendingSel\.clear\(\);[^\n]*\n/m, '').replace('userOwnedCells=new Set();pendingSel.clear();\n', 'userOwnedCells=new Set();\n'); }
const MAIN_ENGINE_SHA256 = '86f763594a31999d0cf165e54451d3f143547c565be58fce1cdb1b29aeb28487';   // engineText(origin/main b70c892 app.html)
test('engine: colour helpers, start canvas, pool, recognition field, stepGen/stepGenFast and encoding are byte-identical to origin/main', () => {
  assert.equal(crypto.createHash('sha256').update(engineText(app)).digest('hex'), MAIN_ENGINE_SHA256);
});
test('engine: none of the removed tunings remain (tuned engine, gradient, hints, loose holds, SM2 map, glow guard)', () => {
  for(const gone of ['stepGenTuned', 'tunedOn', 'GERM.I', 'GERM.H', 'influence.js', 'hints.js', 'gradientStep', 'hintCanvas', 'encodeStab', 'looseCells', 'glowMinSat', 'startFromLive', 'stab64', 'chosenCells'])
    assert.ok(!app.includes(gone), gone + ' gone from app.html');
  const live = fs.readFileSync(new URL('../live.html', import.meta.url), 'utf8');
  for(const gone of ['hints.js', 'hintCanvas', "'#0a0a14', 0.12"]) assert.ok(!live.includes(gone), gone + ' gone from live.html');
  for(const f of ['hints.js', 'influence.js', 'merge.js']) assert.ok(!fs.existsSync(new URL('../lib/' + f, import.meta.url)), 'lib/' + f + ' removed');
  assert.equal(V.PARAMS, undefined, 'no tuned parameters');
  const quick = app.slice(app.indexOf('async function quickStart(){'), app.indexOf('// Kiosk: return to a fresh canvas'));
  assert.match(quick, /for\(let k=0;k<30;k\+\+\)\{stepGenFast\(\)/, "main's start canvas when there is no live canvas");
});
test('glow rule: only the selection since the last Evolve is highlighted (overlay only)', () => {
  const sg = app.slice(app.indexOf('function stepGen(){'), app.indexOf('function nextGen(){'));
  assert.match(sg.split('\n')[1], /pendingSel\.clear\(\)/, 'Evolve clears the highlight');
  const ov = app.slice(app.indexOf('function renderOvl(){'), app.indexOf('function refreshAffinityHud(){'));
  assert.ok(ov.includes('pendingSel.size > 0') && !ov.includes('userOwnedCells.has'), 'overlay draws the pending selection only');
});

// ── save isolation ──
test('namespacing: always pb-<theme>, fits the theme regex, never a real theme', () => {
  for(const t of ['love', 'Love', 'pb-love', 'grief', 'x'.repeat(40), 'new-year 2027', 'pb-pb-x']){
    const n = V.nsTheme(t); assert.ok(n.startsWith(V.NS), n); assert.ok(THEME_RE.test(n), n); assert.ok(n.length <= 40, n);
  }
  assert.equal(V.nsTheme('love'), 'pb-love'); assert.equal(V.nsTheme('pb-love'), 'pb-love', 'idempotent');
  assert.deepEqual(V.parseNsTheme('pb-new-year 2027'), { base: 'new-year 2027' });
  for(const f of ['canvas-save.js', 'display-live.js']){ const s = fs.readFileSync(new URL('../functions/api/' + f, import.meta.url), 'utf8'); assert.match(s, /const theme = nsTheme\(/, f + ' forces the namespace'); }
  const load = fs.readFileSync(new URL('../functions/api/canvas-load/[id].js', import.meta.url), 'utf8');
  assert.match(load, /startsWith\(NS\)/); assert.doesNotMatch(load, /\.update\(/, 'preview never writes on load (no view_count bump)');
});

test('lineage: live saves chain onto the theme\'s latest save; share links keep their parent', async () => {
  const rows = [];
  const db = { lookupById: async id => rows.find(r => r.short_id === id) || null,
               lookupLatest: async th => rows.filter(r => r.theme === th).slice(-1)[0] || null };
  const save = async (theme, parentId) => { const l = await resolveLineage({ parentId, theme, ...db }); const id = 's' + rows.length; rows.push({ short_id: id, theme, depth: l.depth, parent_id: l.parentId }); return { id, ...l }; };
  const a = await save('pb-love', null);   assert.deepEqual([a.depth, a.parentId, a.via], [0, null, 'first']);
  const b = await save('pb-love', null);   assert.deepEqual([b.depth, b.parentId, b.via], [1, a.id, 'live']);
  const c = await save('pb-love', null);   assert.deepEqual([c.depth, c.parentId], [2, b.id]);
  const o = await save('pb-grief', null); assert.equal(o.depth, 0, 'per theme');
  const s1 = await save('pb-love', a.id);  assert.deepEqual([s1.depth, s1.parentId, s1.via], [1, a.id, 'share'], 'share link: parent depth + 1');
  const s2 = await save('pb-love', s1.id); assert.equal(s2.depth, 2);
  const m = await save('pb-love', 'zzzzzz'); assert.deepEqual([m.depth, m.via], [0, 'share-missing']);
});


// ── Dream it ──
test('dream forms: each is a visible, bounded shape; regions and forms vary', () => {
  for(const f of D.FORMS){ const m = D.formMask(f, 120); let on = 0; for(const v of m) if(v > 0.5) on++;
    assert.ok(on > 120 * 120 * 0.03 && on < 120 * 120 * 0.6, f + ' coverage ' + on / 14400); }
  assert.equal(D.formWithArticle('eye'), 'an eye'); assert.equal(D.formWithArticle('heart'), 'a heart');
  assert.ok(!D.FORMS.includes('sun'), 'copy lists heart, leaf, eye, wave');
  const r = mulberry32(5); let last = null, lastF = null;
  for(let k = 0; k < 20; k++){
    const g = D.chooseRegion({ rand: r, last, S: 300, WC: 900, WR: 660 });
    assert.ok(g.fx >= 156 && g.fx <= 744 && g.fy >= 156 && g.fy <= 504, JSON.stringify(g));
    if(last) assert.ok(Math.hypot(g.fx - last.fx, g.fy - last.fy) / 900 >= 0.28 - 1e-9, 'a different region each time');
    const f = D.chooseForm(r, lastF); assert.notEqual(f, lastF); last = g; lastF = f;
  }
});
test('dream picks: scattered, one colour, the most common hue at the spot, far under the 8% cap', () => {
  const rgb = speckle(900, 660, 3);
  for(const [x0, y0] of [[100, 100], [500, 300], [700, 520]]){
    const p = D.pickScattered({ rgb, WC: 900, x0, y0, w: 24, h: 40 });
    assert.ok(p.picks.length >= 3, 'picks ' + p.picks.length);
    for(let i = 0; i < p.picks.length; i++) for(let j = i + 1; j < p.picks.length; j++){
      const A = p.picks[i], B = p.picks[j];
      assert.ok(Math.max(Math.abs(A % 900 - B % 900), Math.abs(((A / 900) | 0) - ((B / 900) | 0))) >= 3, 'clear gaps');
    }
    for(const q of p.picks) assert.equal(D.hueBin(...rgb(q)), p.hue, 'one colour');
    const lassoCells = p.picks.length * 9;          // each tiny loop ≤ 3×3 cells
    assert.ok(lassoCells / (900 * 660) < 0.08 / 100, 'under the cap by a wide margin');
  }
});
test('dream restore is exact: snapshot → (vision mutates) → restore gives identical cells + checksum', () => {
  const cells = []; const r = mulberry32(9);
  for(let i = 0; i < 5000; i++) cells.push({ c: '#' + ((r() * 0xffffff) | 0).toString(16).padStart(6, '0'), s: (r() * 4) | 0, w: r() < 0.2 ? 1 : 0 });
  const before = D.checksumCells(cells), snap = D.snapshotCells(cells), copy = cells.map(x => ({ ...x }));
  for(let i = 0; i < 5000; i += 3){ cells[i].c = '#ffffff'; cells[i].s = 1; cells[i].w = 0; }
  assert.notEqual(D.checksumCells(cells), before, 'checksum sees changes');
  D.restoreCells(cells, snap);
  assert.equal(D.checksumCells(cells), before);
  assert.deepEqual(cells.map(x => [x.c, x.s, x.w]), copy.map(x => [x.c, x.s, x.w ? 1 : 0]));
});
test('used the technique: deep zoom + ≥2 small scattered one-colour lassos + Evolve', () => {
  const L = (cx, cy, hue, cells = 6, cellPx = 12, colour = [40, 160, 60]) => ({ cells, cx, cy, hue, colour, cellPx });
  assert.equal(D.usedTechnique([L(10, 10, 4), L(20, 14, 5)], true).used, true, 'adjacent hue bins count as one colour');
  assert.equal(D.usedTechnique([L(10, 10, 0), L(20, 14, 11)], true).used, true, 'hue wraps around');
  assert.equal(D.usedTechnique([L(10, 10, 4), L(20, 14, 4)], false).used, false, 'needs Evolve');
  assert.equal(D.usedTechnique([L(10, 10, 4, 6, 3), L(20, 14, 4, 6, 3)], true).used, false, 'not zoomed deep');
  assert.equal(D.usedTechnique([L(10, 10, 4), L(11, 11, 4)], true).used, false, 'not scattered');
  assert.equal(D.usedTechnique([L(10, 10, 4), L(20, 14, 8)], true).used, false, 'two colours');
  assert.equal(D.usedTechnique([L(10, 10, 4), L(20, 14, -1)], true).used, false, 'one coloured, one dark');
  assert.equal(D.usedTechnique([L(10, 10, 4, 900)], true).used, false, 'one big lasso');
  assert.equal(D.usedTechnique([L(10, 10, -1, 6, 12, [10, 10, 20]), L(30, 10, -1, 6, 12, [12, 11, 22])], true).used, true, 'dark pixels of one shade');
});

// ── dream-event validation (endpoint disabled by default) ──
test('dream-event: whitelists fields, drops anything personal', () => {
  const r = validateDreamEvent({ v:1, variant:'B', hint:'noise', dream:'completed', dreamMs:11600, lassos:3,
    usedTechnique:true, evolved:true, ip:'1.2.3.4', contributorId:'abc', ua:'x' });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.row).sort(), ['dream','dream_ms','evolved','first_lasso_ms','hint','kiosk','lasso_within_30s','lassos','reduced_motion','replays','is_returning','shared','used_technique','v','variant'].sort());
  assert.equal(r.row.used_technique, true);
  assert.equal(validateDreamEvent({ variant:'b', hint:'<script>', dream:'completed' }).ok, false);
  assert.equal(validateDreamEvent({ variant:'b', hint:'noise', dream:'hacked' }).ok, false);
});
test("dream-event endpoint is off unless DREAM_EVENTS_ENABLED is '1' or 'true' (any case)", async () => {
  const { onRequestPost, eventsEnabled } = await import('../functions/api/dream-event.js');
  for(const f of ['1','true','TRUE','True',' true ']) assert.equal(eventsEnabled({ DREAM_EVENTS_ENABLED:f }), true, f);
  for(const f of [undefined,'','0','false','yes','on','2']) assert.equal(eventsEnabled({ DREAM_EVENTS_ENABLED:f }), false, String(f));
  const req = () => new Request('http://x/api/dream-event',{method:'POST',body:'{}'});
  assert.equal((await onRequestPost({ request:req(), env:{} })).status, 404);
  assert.equal((await onRequestPost({ request:req(), env:{ DREAM_EVENTS_ENABLED:'false' } })).status, 404);
  // enabled but no DB configured → 503 (never reaches Supabase in tests)
  assert.equal((await onRequestPost({ request:req(), env:{ DREAM_EVENTS_ENABLED:'True' } })).status, 503);
});

// ── Dream it: the form is grown from canvas pixels, coarse → fine ──
test('dream form masks are filled silhouettes (binary, no outline-only shapes)', () => {
  for(const f of D.FORMS){ const S = 120, m = D.formMask(f, S);
    for(const v of m) assert.ok(v === 0 || v === 1, f + ' mask is binary');
    // filled: most inside cells have all 4 neighbours inside too (an outline would fail this)
    let inside = 0, interior = 0;
    for(let y = 1; y < S - 1; y++) for(let x = 1; x < S - 1; x++){ const i = y * S + x; if(!m[i]) continue; inside++;
      if(m[i - 1] && m[i + 1] && m[i - S] && m[i + S]) interior++; }
    assert.ok(interior / inside > 0.85, f + ' is filled: interior share ' + (interior / inside).toFixed(2));
  }
});
// ── Dream it: real selection + real Evolve, sped up (no mask reveal) ──
test('dream timeline: many lasso → tap-Evolve cycles, each faster than the last; ~13–16 s; reduced motion ~8 s', () => {
  for(const rm of [false, true]){
    const T = D.dreamTimeline(rm, 4), d = T.cycles.map(c => c.dur);
    assert.ok(d.length >= (rm ? 6 : 10), 'many cycles: ' + d.length);
    for(let k = 1; k < d.length; k++) assert.ok(d[k] < d[k - 1], `cycle ${k} faster: ${d[k - 1]} → ${d[k]}`);
    assert.equal(T.cycles[0].phase, 'pick'); assert.equal(T.cycles[0].loops, 4, 'cycle 0: the first scattered picks');
    for(const c of T.cycles.slice(1)){ assert.equal(c.phase, 'cycle'); assert.ok(c.loops >= 1); }
    for(const c of T.cycles){
      assert.ok(c.t0 < c.loopEnd && c.loopEnd < c.press && c.press < c.t1, 'lasso, then travel to Evolve, tap, then the change, inside every cycle');
      assert.ok(c.press - c.loopEnd >= 0.05, 'time to move to the button: ' + (c.press - c.loopEnd).toFixed(2)); }
    for(let k = 1; k < T.cycles.length; k++) assert.ok(Math.abs(T.cycles[k].t0 - T.cycles[k - 1].t1) < 1e-9, 'back to back');
    assert.ok(Math.abs(T.cycles[0].t0 - T.zin[1]) < 1e-9 && T.zout[0] >= T.cycles.at(-1).t1 - 1e-9 && T.fade[1] === T.end, 'order: zoom → cycles → step back → fade');
    if(rm){ assert.ok(T.end >= 6 && T.end <= 9, 'reduced ' + T.end); assert.ok(T.cycles.every(c => !c.ease), 'reduced motion: no eased transitions'); }
    else { assert.ok(T.end >= 13 && T.end <= 15.5, 'normal (nominal; engine pauses add a little) ' + T.end); assert.equal(T.zin[1], 2.2, 'opening zoom unchanged');
      assert.ok(T.cycles[0].ease >= 0.55 && T.cycles[0].ease <= 0.7 && T.cycles[1].ease >= 0.55 && T.cycles[1].ease <= 0.7, 'the first 2 Evolves ease over ~600 ms');
      assert.ok(T.cycles.slice(2).every(c => !c.ease), 'later Evolves are instant');
      for(const c of T.cycles.slice(0, 2)) assert.ok(c.t1 - c.press >= c.ease - 1e-9, 'the eased change fits before the next lasso'); }
  }
});
test('dream picks prefer red-ish pixels when the spot has them', () => {
  const W = 40, rgb = i => (i % 7 === 0 ? [170, 40, 50] : [40, 150, 60]);   // mostly green, some red
  const plain = D.pickScattered({ rgb, WC: W, x0: 0, y0: 0, w: 30, h: 30, maxPicks: 4 });
  const red = D.pickScattered({ rgb, WC: W, x0: 0, y0: 0, w: 30, h: 30, maxPicks: 4, prefer: D.RED_BINS });
  assert.notEqual(D.hueBin(...rgb(plain.picks[0])), D.hueBin(170, 40, 50), 'without a preference: the commonest colour');
  for(const p of red.picks) assert.ok(D.redness(...rgb(p)) > 0.5, 'with RED_BINS: red pixels');
  assert.ok(D.redness(200, 30, 40) > 0.7 && D.redness(40, 200, 60) === 0 && D.redness(12, 4, 4) === 0 && D.redness(120, 120, 124) === 0);
});
// hold the cells inside a loop (as applyLasso does: cell centres in the polygon)
function holdLoop(pts, WC, held){ const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  for(let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) for(let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++){
    let inside = false; const px = x + 0.5, py = y + 0.5;
    for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){ const a = pts[i], b = pts[j];
      if(((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x)) inside = !inside; }
    if(inside) held.add(y * WC + x); } }
test('dream selection: real unheld cells next to the held cluster, red-ish, softly biased toward the form — and imperfect', () => {
  const WC = 200, WR = 160, rgb = speckle(WC, WR, 3), S = 44, fx = 100, fy = 80, mask = D.formMask('heart', S);
  const held = new Set([fy * WC + fx, fy * WC + fx + 3, (fy + 3) * WC + fx]);
  const cluster = [...held];
  let outside = 0, inForm = 0, n = 0, redSum = 0, all = 0;
  for(let seed = 1; seed <= 40; seed++){
    const tg = D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster, WC, WR, mask, S, fx, fy, ring: 3, count: 3, rand: mulberry32(seed) });
    assert.ok(tg.length === 3, 'three targets');
    for(const o of tg){ n++; assert.ok(!held.has(o.i), 'never an already-held cell');
      const d = Math.min(...cluster.map(c => Math.max(Math.abs(c % WC - o.i % WC), Math.abs(((c / WC) | 0) - ((o.i / WC) | 0)))));
      assert.ok(d >= 1 && d <= 3, 'adjacent to the cluster (≤ 3 cells): ' + d);
      redSum += D.redness(...rgb(o.i)); if(o.inForm) inForm++; else outside++; }
    for(let i = 0; i < 400; i++){ const x = fx - 3 + (i % 20) * 0.3 | 0, y = fy - 3 + ((i / 20) | 0) * 0.3 | 0; all += D.redness(...rgb(y * WC + x)); }
  }
  assert.ok(redSum / n > 2 * all / (40 * 400), `picked cells are red-ish: ${(redSum / n).toFixed(2)} vs local mean ${(all / 16000).toFixed(2)}`);
  assert.ok(new Set(Array.from({ length: 5 }, (_, s) => D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster, WC, WR, mask, S, fx, fy, rand: mulberry32(s + 1) }).map(o => o.i).join())).size > 1, 'noise: not the same cells every time');
});
test('dream cluster grows across cycles, for every form: outward, mostly into the form, rough (gaps and strays)', () => {
  for(const form of D.FORMS){
  const WC = 260, WR = 220, rgb = speckle(WC, WR, 11), S = D.formSize(form), fx = 130, fy = 110, mask = D.formMask(form, S), rand = mulberry32(4);
  const T = D.dreamTimeline(false, 4), held = new Set();
  const tune = D.formTuning(form), hole = D.formHole(form, S), X0 = fx - (S >> 1), Y0 = fy - (S >> 1);
  const HX = X0 + (hole ? hole.cx : 0), HY = Y0 + (hole ? hole.cy : 0), inHole = i => hole && Math.hypot(i % WC + .5 - HX, ((i / WC) | 0) + .5 - HY) < hole.r;
  for(const q of tune.starts){ const sx = Math.round(fx + q.dx * S), w = q.win || 16;
    const pk = D.pickScattered({ rgb, WC, x0: sx - (w >> 1), y0: Math.round(fy + (q.dy || 0) * S) - (w >> 1), w, h: w, maxPicks: q.n, minGap: 3, prefer: D.RED_BINS,
      exclude: hole ? (i => Math.hypot(i % WC + .5 - HX, ((i / WC) | 0) + .5 - HY) < hole.r + 1.25 * 1.35 + .75) : null });
    assert.equal(pk.picks.length, q.n, form + ' first picks');
    for(const p of pk.picks) holdLoop(D.loopPoints(p % WC, (p / WC) | 0, 1.35, rand), WC, held); }
  const inF = i => { const x = i % WC - X0, y = ((i / WC) | 0) - Y0; return x >= 0 && y >= 0 && x < S && y < S && mask[y * S + x]; };
  let formN = 0; for(const v of mask) formN += v;
  const sizes = [held.size], cover = [], spread = [];
  T.cycles.forEach((c, k) => {
    if(c.phase === 'pick') return;
    const r = D.cycleLoopR(k, T.cycles.length, 9, 3.6);
    const tg = D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster: [...held], WC, WR, mask, S, fx, fy, ring: Math.max(2, Math.round(r * 0.9)), count: c.loops, minSep: Math.max(3, Math.round(r * 1.3)), bias: 1 + k * 0.25, fill: tune.fill, hole, loopR: r, rand });
    for(const o of tg){ assert.ok(o.r <= r + 1e-9, 'loops only shrink'); holdLoop(D.loopPoints(o.i % WC, (o.i / WC) | 0, o.r, rand), WC, held); }
    sizes.push(held.size); let f = 0, mx = 0; for(const i of held){ if(inF(i)) f++; mx = Math.max(mx, Math.hypot(i % WC - fx, ((i / WC) | 0) - fy)); }
    cover.push(f / formN); spread.push(mx);
  });
  for(let k = 1; k < sizes.length; k++) assert.ok(sizes[k] > sizes[k - 1], `${form} grows every cycle: ${sizes.join(' → ')}`);
  for(let k = 1; k < spread.length; k++) assert.ok(spread[k] >= spread[k - 1], form + ' outward');
  let inside = 0; for(const i of held) if(inF(i)) inside++;
  assert.ok(inside / held.size > 0.6, form + ' mostly inside the form: ' + (inside / held.size).toFixed(2));
  assert.ok(cover.at(-1) < 0.9 && (inside / held.size < 0.995 || cover.at(-1) < 0.8), `${form} rough (gaps, or strays), not the clean form: in ${(inside / held.size).toFixed(2)}, cover ${cover.at(-1).toFixed(2)}`);
  if(D.ROTATION.includes(form)) assert.ok(cover.at(-1) > 0.35, form + ' but enough to read as one: cover ' + cover.at(-1).toFixed(2));   // (the eye is out of the rotation; its pupil rules still checked)
  assert.ok(held.size / (900 * 660) < 0.08, 'far under the 8% cap');
  if(hole){ assert.equal([...held].filter(inHole).length, 0, form + ': the pupil is never lassoed');
    let left = 0, right = 0; for(const i of held) if(inF(i)) (i % WC < HX ? left++ : right++);
    assert.ok(Math.min(left, right) > 0.3 * (left + right), `${form} grows on both sides of the pupil: ${left} / ${right}`); }
  }
});
test('dream eye: a wide, flat almond with an open pupil that the selection keeps clear of', () => {
  const S = D.formSize('eye'), m = D.formMask('eye', S), h = D.formHole('eye', S);
  let x0 = S, x1 = 0, y0 = S, y1 = 0, inPupil = 0;
  for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ if(m[y * S + x]){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if(Math.hypot(x + .5 - h.cx, y + .5 - h.cy) < h.r && m[y * S + x]) inPupil++; }
  assert.ok((x1 - x0 + 1) / (y1 - y0 + 1) > 2.6, 'wide and flat: aspect ' + ((x1 - x0 + 1) / (y1 - y0 + 1)).toFixed(2));
  assert.equal(inPupil, 0, 'the pupil is outside the form: no soft bias pulls into it');
  assert.ok(h.r >= 5, 'a pupil big enough to read as a hole: r ' + h.r.toFixed(1));
  // targets near the pupil get smaller loops that still clear it
  const WC = 200, WR = 160, rgb = speckle(WC, WR, 5), fx = 100, fy = 80, X0 = fx - (S >> 1), Y0 = fy - (S >> 1), HX = X0 + h.cx, HY = Y0 + h.cy;
  const held = new Set([fy * WC + fx - 12, fy * WC + fx + 12]);
  for(let seed = 1; seed < 20; seed++){
    const tg = D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster: [...held], WC, WR, mask: m, S, fx, fy, ring: 5, count: 4, hole: h, loopR: 5, rand: mulberry32(seed) });
    for(const o of tg){ const d = Math.hypot(o.i % WC + .5 - HX, ((o.i / WC) | 0) + .5 - HY);
      assert.ok(d - 1.25 * o.r - 0.5 >= h.r, `loop around ${o.i} (r ${o.r.toFixed(2)}, ${d.toFixed(1)} from the pupil) clears it`); }
  }
});
test('dream forms rotate: heart first for love, then leaf → wave → heart (the eye is out); all sized alike', () => {
  assert.equal(D.nextForm({ theme: 'love' }), 'heart', 'first visit on love: a heart');
  assert.equal(D.nextForm({ theme: 'Love' }), 'heart');
  const seq = []; let last = null; for(let k = 0; k < 6; k++){ last = D.nextForm({ last, theme: 'love' }); seq.push(last); }
  assert.deepEqual(seq, ['heart', 'leaf', 'wave', 'heart', 'leaf', 'wave'], 'later plays and Dream again rotate');
  assert.equal(D.nextForm({ last: 'eye', theme: 'love' }), 'wave', 'an old eye in storage moves on');
  assert.deepEqual(D.ROTATION, ['heart', 'leaf', 'wave']); assert.ok(D.FORMS.includes('eye'), 'the eye is still drawable');
  assert.equal(D.nextForm({ last: 'wave', theme: 'sea' }), 'heart', 'rotation is the same on any theme');
  assert.ok(D.ROTATION.includes(D.nextForm({ theme: 'sea' })));
  const n = f => { let c = 0; for(const v of D.formMask(f, D.formSize(f))) c += v; return c; };
  for(const f of D.FORMS) assert.ok(Math.abs(n(f) - n('heart')) / n('heart') < 0.06, `${f} has about as many cells as the heart: ${n(f)} vs ${n('heart')}`);
});
test('dream region guard: picks a start rich in the theme family (red for love), far from the last dream', () => {
  const WC = 900, WR = 660, r = mulberry32(8);
  // dark canvas with red only in a few patches
  const red = new Uint8Array(WC * WR); for(const [cx, cy] of [[150, 500], [700, 150], [450, 330]]) for(let y = cy - 60; y < cy + 60; y++) for(let x = cx - 60; x < cx + 60; x++) if(x >= 0 && y >= 0 && x < WC && y < WR) red[y * WC + x] = 1;
  const rgb = i => red[i] ? [170 + (i % 50), 30, 45] : [14 + (i % 9), 12, 20];
  let hits = 0, lucky = 0;
  for(let k = 0; k < 30; k++){
    const rand = mulberry32(100 + k), g = D.chooseDreamRegion({ rand, S: 44, WC, WR, rgb, hue: 355 });
    const one = D.chooseRegion({ rand: mulberry32(100 + k), S: 84, WC, WR });
    if(red[g.fy * WC + g.fx] || g.startFamily > 0.2) hits++;
    if(red[one.fy * WC + one.fx]) lucky++;
  }
  assert.ok(hits > lucky * 2 && hits >= 10, `guarded ${hits}/30 start in red vs unguarded ${lucky}/30`);
  const last = { fx: 450, fy: 330 }, g = D.chooseDreamRegion({ rand: r, last, S: 44, WC, WR, rgb });
  assert.ok(Math.hypot(g.fx - last.fx, g.fy - last.fy) / WC >= 0.28 - 1e-9, 'still somewhere else than last time');
  assert.equal(D.themeFamilyHue({ theme: 'love', rgb, WT: WC * WR }), 355);
  const green = D.themeFamilyHue({ theme: 'forest', rgb: () => [30, 160, 50], WT: 5000 });
  assert.ok(green > 90 && green < 150, 'other themes: the canvas\'s commonest hue ' + green);
});
test('dream freezes the counters: HUD writers return while the vision plays', async () => {
  const fs = await import('node:fs'), app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const body = name => { const i = app.indexOf('function ' + name + '('); return app.slice(i, app.indexOf('\n}', i)); };
  for(const f of ['updateStats', 'refreshAffinityHud']) assert.match(body(f).split('\n')[1], /DREAM\.playing\)return/, f + ' frozen');
  const sg = body('scoreGeneration'); assert.ok(sg.indexOf('DREAM.playing)return') > 0 && sg.indexOf('DREAM.playing)return') < sg.indexOf("getElementById('hudA')"), 'score HUD frozen (scoring itself still runs)');
  const ui = fs.readFileSync(new URL('../dream-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /playing=false[\s\S]*updateStats\(\);refreshAffinityHud\(\);/, 'live again after the vision');
});
test('dream uses the real mechanics: applyLasso + nextGen, no stored image or mask reveal', async () => {
  const fs = await import('node:fs');
  for(const gone of ['GROW_LEVELS', 'blockForm', 'jitterMask', 'scatterEdge', 'familyPalette', 'levelColour', 'levelTable', 'levelColourFast', 'blockColour', 'formContrast', 'vividness'])
    assert.equal(D[gone], undefined, gone + ' removed');
  const ui = fs.readFileSync(new URL('../dream-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /applyLasso\(false\)/, 'real lassos'); assert.match(ui, /nextGen\(\)/, 'real Evolve');
  assert.doesNotMatch(ui, /putImageData|createImageData|formMask\([^)]*\)[^;]*fill/, 'never paints an image of the form');
  assert.doesNotMatch(ui, /saveToServer|fetch\(/, 'nothing saved to the server');
});

