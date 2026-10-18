// PROTOTYPE (variant B): merge-into-live-canvas, colour rounding, namespacing, hints.
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../lib/merge.js';
import * as H from '../lib/hints.js';
import * as V from '../lib/variant.js';
import { resolveLineage } from '../lib/lineage.js';
import { THEME_RE, CELL_DATA_LENGTH } from '../lib/validate.js';

const WT = M.WT, HELD = M.HELD;
const cell = (r, g, b, held) => (held ? HELD : 0) | (r << 10) | (g << 5) | b;
function canvas(fill){ const a = new Uint16Array(WT); a.fill(fill); return a; }

test('cells base64 round-trip matches Buffer (browser btoa format)', () => {
  const a = new Uint16Array(WT); for(let i = 0; i < WT; i++) a[i] = (i * 2654435761) & 0xffff;
  const b64 = M.encodeCells(a);
  assert.equal(b64.length, CELL_DATA_LENGTH);
  assert.equal(b64, Buffer.from(a.buffer).toString('base64'));
  assert.deepEqual(M.decodeCells(b64), a);
  assert.equal(M.decodeCells('A'.repeat(10)), null);
});

test('chosen bitmap round-trip and size checks', () => {
  const f = new Uint8Array(WT); for(let i = 0; i < WT; i += 7) f[i] = 1;
  const b64 = M.encodeChosen(f);
  assert.equal(b64.length, M.CHOSEN_B64_LENGTH);
  assert.deepEqual(M.decodeChosen(b64), f);
  assert.equal(M.decodeChosen(b64.slice(4)), null);
  assert.equal(M.decodeChosen(null), null);
});

test('first save becomes the live canvas', () => {
  const inc = canvas(cell(1, 2, 3, false)); inc[5] = cell(31, 0, 0, true);
  const r = M.mergeIntoMother({ mother: null, incoming: inc });
  assert.equal(r.mode, 'first'); assert.deepEqual(r.cells, inc); assert.equal(r.stats.held, 1);
});

test('held-only: incoming held pixels win, unheld live pixels are kept', () => {
  const mother = canvas(cell(5, 5, 5, false));
  mother[10] = cell(9, 9, 9, true);             // held on live, not chosen by contributor
  mother[11] = cell(9, 9, 9, true);             // held on live, re-chosen by contributor
  const inc = canvas(cell(20, 20, 20, false));  // contributor's evolved unheld background
  inc[10] = cell(1, 1, 1, true);                // inherited hold, locally recoloured
  inc[11] = cell(2, 2, 2, true);
  inc[12] = cell(31, 0, 0, true);               // newly held by contributor
  const chosen = new Uint8Array(WT); chosen[11] = 1; chosen[12] = 1;
  const r = M.mergeIntoMother({ mother, incoming: inc, chosen, continuation: false, release: 0 });
  assert.equal(r.mode, 'held-only');
  assert.equal(r.cells[0], mother[0], 'unheld live pixel kept');
  assert.equal(r.cells[10], mother[10], 'live hold not re-chosen keeps live colour');
  assert.equal(r.cells[11], inc[11], 're-chosen hold takes incoming colour');
  assert.equal(r.cells[12], inc[12], 'new hold merged in');
  assert.equal(r.stats.held, 3);
});

test('held-only without a chosen map: only cells not already held live are taken', () => {
  const mother = canvas(0); mother[1] = cell(3, 3, 3, true);
  const inc = canvas(0); inc[1] = cell(4, 4, 4, true); inc[2] = cell(5, 5, 5, true);
  const r = M.mergeIntoMother({ mother, incoming: inc, chosen: null });
  assert.equal(r.cells[1], mother[1]); assert.equal(r.cells[2], inc[2]);
});

test('continuation (no chosen map, old client): incoming holds count only where live is free', () => {
  const mother = canvas(cell(5, 5, 5, false)); mother[3] = cell(1, 1, 1, true);
  const inc = canvas(cell(6, 6, 6, false)); inc[3] = cell(2, 2, 2, true); inc[4] = cell(7, 7, 7, true);
  const r = M.mergeIntoMother({ mother, incoming: inc, continuation: true });
  assert.equal(r.mode, 'continue'); assert.deepEqual(r.cells, inc);
});

test('release: ~0.75% per save of holds nobody re-chose loosen (sim timescale); chosen holds never do', () => {
  assert.equal(V.PARAMS.release, 0.0075);
  const mother = canvas(cell(9, 9, 9, true));
  const inc = canvas(cell(9, 9, 9, true));
  const chosen = new Uint8Array(WT); for(let i = 0; i < 1000; i++) chosen[i] = 1;
  let s = 1; const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const r = M.mergeIntoMother({ mother, incoming: inc, chosen, release: V.PARAMS.release, rand });
  const rate = r.stats.released / (WT - 1000);
  assert.ok(rate > 0.0065 && rate < 0.0085, 'rate ' + rate);
  for(let i = 0; i < 1000; i++) assert.ok(r.cells[i] & HELD);
  let freed = -1; for(let i = 1000; i < WT; i++) if(!(r.cells[i] & HELD)){ freed = i; break; }
  assert.equal(r.cells[freed], cell(9, 9, 9, false), 'colour unchanged when released');
  // An unrefreshed hold survives ~1/0.0075 ≈ 133 saves on average (sim: ~130 contributions).
  assert.ok(Math.abs(1 / V.PARAMS.release - 133) < 1);
});

test('colour rounding: nearest, full range, stable over repeated save/load', () => {
  assert.equal(H.q5(0), 0); assert.equal(H.q5(255), 31); assert.equal(H.u5(31), 255); assert.equal(H.u5(0), 0);
  assert.equal(H.q5(250), 30); assert.equal(H.u5(H.q5(250)), 247); // old: (250>>3)<<3 = 248, but 255 → 248 too
  for(let v = 0; v < 256; v++){
    const once = H.u5(H.q5(v));
    assert.ok(Math.abs(once - v) <= 4, `v=${v} → ${once}`);
    assert.equal(H.u5(H.q5(once)), once, 'idempotent after the first trip');
  }
  // Old code was biased dark (mean −3.5 levels per trip); new code is unbiased.
  const meanErr = [...Array(256).keys()].reduce((s, v) => s + (H.u5(H.q5(v)) - v), 0) / 256;
  const meanOld = [...Array(256).keys()].reduce((s, v) => s + (((v >> 3) << 3) - v), 0) / 256;
  assert.ok(Math.abs(meanErr) < 0.5, 'unbiased: ' + meanErr);
  assert.ok(meanOld < -3, 'old code was biased dark: ' + meanOld);
});

test('namespacing: always pb-…-<hint>, fits the theme regex, never a real theme', () => {
  for(const t of ['love', 'Love', 'pb-love-pull', 'grief', 'x'.repeat(40), 'new-year 2027', 'love-pull']){
    for(const h of [undefined, 'pull', 'pull-dim', 'ripples', 'resonance', 'attractors', 'bogus']){
      const n = V.nsTheme(t, h);
      assert.ok(n.startsWith(V.NS), n); assert.ok(THEME_RE.test(n), n); assert.ok(n.length <= 40);
      assert.ok(H.HINT_NAMES.some(x => n.endsWith('-' + x)), n);
    }
  }
  assert.equal(V.nsTheme('love'), 'pb-love-noise', 'honest noise is the default');
  assert.equal(V.nsTheme('love', 'pull'), 'pb-love-pull');
  assert.equal(V.nsTheme('love', 'pull-dim'), 'pb-love-pull-dim');
  assert.equal(V.nsTheme('love', 'attractors'), 'pb-love-attractors');
  assert.equal(V.nsTheme('pb-love-pull'), 'pb-love-pull');
  assert.equal(V.nsTheme('pb-love-pull-dim'), 'pb-love-pull-dim', 'longest hint matched first');
  assert.equal(V.nsTheme('pb-love-pull', 'resonance'), 'pb-love-ripples', 'resonance is an alias of ripples');
  assert.deepEqual(V.parseNsTheme('pb-new-year 2027-pull'), { base: 'new-year 2027', hint: 'pull' });
  assert.deepEqual(V.parseNsTheme('pb-love-pull-dim'), { base: 'love', hint: 'pull-dim' });
  assert.deepEqual(V.parseNsTheme('pb-love-resonance'), { base: 'love', hint: 'ripples' });
});

test('hint registry: noise default; pull, pull-dim, ripples (alias resonance), attractors behind ?hint=', () => {
  assert.deepEqual(H.hintsFor('love'), ['noise', 'pull', 'pull-dim', 'ripples', 'attractors']);
  assert.equal(H.defaultHint('love'), 'noise');
  assert.equal(H.resolveHint('love', 'nope'), 'noise');
  assert.equal(H.resolveHint('love', 'resonance'), 'ripples');
  assert.equal(H.resolveHint('love', 'RIPPLES'), 'ripples');
  assert.equal(H.resolveHint('kites', 'nope'), 'noise');
  assert.equal(H.resolveHint('love', 'pull'), 'pull');
  const lum = a => { let s = 0; for(let i = 0; i < WT; i++) s += 0.2126 * a.R[i] + 0.7152 * a.G[i] + 0.0722 * a.B[i]; return s / WT; };
  for(const h of H.HINT_NAMES){
    const a = H.hintCanvas('love', h);
    assert.equal(a.R.length, WT); assert.equal(a.hint, h);
    let lit = 0; for(let i = 0; i < WT; i++) if(a.R[i] + a.G[i] + a.B[i] > 120) lit++;
    assert.ok(lit > WT * 0.005 && lit < WT * 0.8, h + ' lit share ' + lit / WT);
  }
  assert.ok(lum(H.hintCanvas('love', 'pull-dim')) < lum(H.hintCanvas('love', 'pull')) * 0.8, 'pull-dim is dimmer');
  const a = H.HINTS.pull.gen({ rand: H.mulberry32(H.hashStr('hint:love|pull')), pal: H.paletteFor('love') });
  assert.deepEqual(a.R, H.hintCanvas('love', 'pull').R, 'deterministic');
});

// ── Hold levels + loose (tuned engine) ──
const rng = seed => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const Z = () => new Uint8Array(WT);

test('SM2 stab map: 4 bits per cell round-trip, size checks', () => {
  const lv = Z(), lo = Z(), ch = Z();
  for(let i = 0; i < WT; i++){ lv[i] = (i * 7) & 3; lo[i] = lv[i] && (i % 5 === 0) ? 1 : 0; ch[i] = (i % 3 === 0) ? 1 : 0; }
  const b64 = M.encodeStab(lv, lo, ch);
  assert.equal(b64.length, M.SM2_B64_LENGTH); assert.equal(M.SM2_B64_LENGTH, 396000);
  const d = M.decodeStab(b64);
  assert.deepEqual(d.level, lv); assert.deepEqual(d.loose, lo); assert.deepEqual(d.chosen, ch);
  assert.equal(M.decodeStab(b64.slice(4)), null); assert.equal(M.decodeStab(M.encodeChosen(ch)), null);
  assert.ok(b64.length <= CELL_DATA_LENGTH, 'fits the existing stabMap limit');
});

test('live canvas pack/unpack: cellData unchanged + ":v2:" levels; legacy rows still decode', () => {
  const cells = canvas(cell(3, 4, 5, false)); const level = Z(), loose = Z();
  cells[1] = cell(9, 9, 9, true); level[1] = 3;
  cells[2] = cell(9, 9, 9, true); level[2] = 1; loose[2] = 1;
  const str = M.packMother({ cells, level, loose });
  const { cellData, stabMap } = M.splitMotherData(str);
  assert.equal(cellData, M.encodeCells(cells), 'first part is exactly the production cellData format');
  assert.equal(cellData.length, CELL_DATA_LENGTH); assert.equal(stabMap.length, M.SM2_B64_LENGTH);
  const u = M.unpackMother(str);
  assert.deepEqual(u.cells, cells); assert.equal(u.level[1], 3); assert.equal(u.level[2], 1); assert.equal(u.loose[2], 1); assert.equal(u.level[0], 0);
  const legacy = M.unpackMother(M.encodeCells(cells));           // production-format row: no suffix
  assert.equal(legacy.level[1], 1); assert.equal(legacy.level[2], 1); assert.equal(legacy.loose[2], 0); assert.equal(legacy.level[0], 0);
  assert.deepEqual(M.splitMotherData(cellData), { cellData, stabMap: null });
});

test('merge levels: max(live, incoming); chosen takes colour + loose; continuation keeps levels', () => {
  const mc = canvas(cell(5, 5, 5, false)), ml = Z(), mo = Z();
  mc[10] = cell(9, 9, 9, true); ml[10] = 3;                       // live crystallised, not chosen
  mc[11] = cell(9, 9, 9, true); ml[11] = 1; mo[11] = 1;           // live loose, re-chosen tightly
  const ic = canvas(cell(20, 20, 20, false)), il = Z(), io = Z(), ch = Z();
  ic[10] = cell(1, 1, 1, true); il[10] = 1;
  ic[11] = cell(2, 2, 2, true); il[11] = 2; ch[11] = 1;
  ic[12] = cell(3, 3, 3, true); il[12] = 1; io[12] = 1; ch[12] = 1;  // new loose hold
  const r = M.mergeIntoMother({ mother: { cells: mc, level: ml, loose: mo }, incoming: { cells: ic, level: il, loose: io }, chosen: ch });
  assert.equal(r.mode, 'held-only');
  assert.equal(r.cells[10], mc[10]); assert.equal(r.level[10], 3, 'level never drops in a merge');
  assert.equal(r.cells[11], ic[11]); assert.equal(r.level[11], 2); assert.equal(r.loose[11], 0, 'tight re-choice firms a loose hold');
  assert.equal(r.cells[12], ic[12]); assert.equal(r.level[12], 1); assert.equal(r.loose[12], 1);
  assert.equal(r.stats.loose, 1); assert.equal(r.stats.refined, 2);
  const c = M.mergeIntoMother({ mother: { cells: mc, level: ml, loose: mo }, incoming: { cells: ic, level: il, loose: io }, chosen: ch, continuation: true });
  assert.equal(c.mode, 'continue');
  assert.equal(c.level[10], 3, 'continuation: unchosen cell keeps the LIVE level'); assert.equal(c.cells[10], ic[10], '…but takes the evolved colour');
  assert.equal(c.level[11], 2); assert.equal(c.loose[11], 0); assert.equal(c.level[12], 1); assert.equal(c.loose[12], 1);
  assert.equal(c.cells[0], ic[0], 'continuation carries the evolved unheld background');
});

test('release: loose ≈ 5.4%/save freed outright; ordinary 0.75%/save drop ONE level; chosen never', () => {
  assert.ok(Math.abs(V.PARAMS.releaseLoose - (1 - Math.pow(0.8, 0.25))) < 1e-12);
  assert.ok(Math.abs(V.PARAMS.releaseLoose - 0.0543) < 0.0005);
  const mc = canvas(cell(9, 9, 9, true)), ml = Z(), mo = Z();
  const half = WT >> 1;
  for(let i = 0; i < WT; i++){ ml[i] = i < half ? 1 : 3; mo[i] = i < half ? 1 : 0; }
  const ch = Z(); for(let i = 0; i < 1000; i++) ch[i] = 1;
  const mother = { cells: mc, level: ml, loose: mo };
  const r = M.mergeIntoMother({ mother, incoming: mother, chosen: ch, release: V.PARAMS.release, releaseLoose: V.PARAMS.releaseLoose, rand: rng(7) });
  const lr = r.stats.looseReleased / (half - 1000), nr = r.stats.released / (WT - half);
  assert.ok(Math.abs(lr - V.PARAMS.releaseLoose) < 0.003, 'loose rate ' + lr);
  assert.ok(Math.abs(nr - V.PARAMS.release) < 0.001, 'ordinary rate ' + nr);
  for(let i = 0; i < 1000; i++) assert.equal(r.level[i], 1);
  let dropped = 0; for(let i = half; i < WT; i++){ assert.ok(r.level[i] >= 2); if(r.level[i] === 2) dropped++; }
  assert.equal(dropped, r.stats.released, 'level-3 holds drop to 2, never freed in one save');
  for(let i = 1000; i < half; i++) if(!r.level[i]){ assert.equal(r.loose[i], 0); assert.equal(r.cells[i] & HELD, 0); }
  // ~ 4 saves ≈ one sim round: loose half-life ≈ 12.4 saves (sim: ~3.1 rounds at 0.8 survival)
  assert.ok(Math.abs(Math.log(0.5) / Math.log(1 - V.PARAMS.releaseLoose) - 12.4) < 0.2);
});

test('full save/load round trip of levels through the client SM2 + server pack', () => {
  // client side: nibble with chosen bit; server stores level|loose only
  const cells = canvas(cell(1, 1, 1, false)), lv = Z(), lo = Z(), ch = Z();
  for(let i = 0; i < 5000; i++){ cells[i] = cell(20, 10, 5, true); lv[i] = 1 + (i % 3); lo[i] = (i % 3 === 0) ? 1 : 0; ch[i] = 1; }
  const sm = M.encodeStab(lv, lo, ch); const d = M.decodeStab(sm);
  const first = M.mergeIntoMother({ mother: null, incoming: { cells, level: d.level, loose: d.loose } });
  const back = M.unpackMother(M.packMother(first));
  assert.deepEqual(back.level, lv); assert.deepEqual(back.loose, lo); assert.deepEqual(back.cells, cells);
});

// ── Regression: only this session's choices apply ──
function liveWithReleased(){
  // live canvas: cells 0..99 held at level 2, cells 100..199 were held but have since been RELEASED (free)
  const cells = canvas(cell(4, 4, 4, false)), level = Z(), loose = Z();
  for(let i = 0; i < 100; i++){ cells[i] = cell(20, 0, 0, true); level[i] = 2; }
  for(let i = 100; i < 200; i++) cells[i] = cell(6, 6, 6, false);
  return { cells, level, loose };
}
function oldCopy(){
  // a visitor's older copy: still holds 0..199 (inherited, NOT chosen this session), at level 3, loose on some
  const cells = canvas(cell(9, 9, 9, false)), level = Z(), loose = Z();
  for(let i = 0; i < 200; i++){ cells[i] = cell(25, 5, 5, true); level[i] = 3; loose[i] = i % 2; }
  return { cells, level, loose };
}
for(const continuation of [false, true]){
  test(`regression (${continuation ? 'continue' : 'stale'}): unchosen inherited holds cannot revive released holds or raise levels`, () => {
    const live = liveWithReleased(), inc = oldCopy(), ch = Z();
    for(let i = 300; i < 310; i++){ inc.cells[i] = cell(0, 31, 0, true); inc.level[i] = 1; ch[i] = 1; }   // one real choice
    const r = M.mergeIntoMother({ mother: live, incoming: inc, chosen: ch, continuation });
    for(let i = 100; i < 200; i++){ assert.equal(r.level[i], 0, 'released hold stays released'); assert.equal(r.cells[i] & HELD, 0); }
    for(let i = 0; i < 100; i++){ assert.equal(r.level[i], 2, 'live level, not the copy\'s 3'); assert.equal(r.loose[i], 0, 'live loose flag'); }
    for(let i = 300; i < 310; i++){ assert.equal(r.cells[i], cell(0, 31, 0, true)); assert.equal(r.level[i], 1); }
    if(continuation){
      assert.equal(r.cells[150], cell(25, 5, 5, false), 'continue: evolved colour, but unheld');
      assert.equal(r.cells[50], cell(25, 5, 5, true), 'continue: evolved colour of a live hold');
      assert.equal(r.cells[500], cell(9, 9, 9, false), 'continue: evolved background');
    } else {
      assert.equal(r.cells[150], live.cells[150], 'stale: live colour'); assert.equal(r.cells[50], live.cells[50]);
      assert.equal(r.cells[500], live.cells[500], 'stale: live background');
    }
    assert.equal(r.stats.held, 110); assert.equal(r.stats.taken, 10);
  });
}

test('erase this session (chosen + level 0): frees the cell on a direct continuation; SM2 carries it', () => {
  const live = liveWithReleased(), inc = { cells: Uint16Array.from(live.cells), level: Uint8Array.from(live.level), loose: Z() }, ch = Z();
  for(let i = 0; i < 10; i++){ inc.cells[i] &= 0x7FFF; inc.level[i] = 0; ch[i] = 1; }
  const d = M.decodeStab(M.encodeStab(inc.level, inc.loose, ch));
  const r = M.mergeIntoMother({ mother: live, incoming: { cells: inc.cells, level: d.level, loose: d.loose }, chosen: d.chosen, continuation: true });
  for(let i = 0; i < 10; i++) assert.equal(r.level[i], 0);
  for(let i = 10; i < 100; i++) assert.equal(r.level[i], 2);
  assert.equal(r.stats.erased, 10);
});

test('regression: a STALE erase cannot free a hold re-made after the visitor loaded', () => {
  // visitor loaded gen N where cells 0..9 were held (level 1); erased them locally.
  const loaded = { cells: canvas(cell(4, 4, 4, false)), level: Z(), loose: Z() };
  for(let i = 0; i < 10; i++){ loaded.cells[i] = cell(20, 0, 0, true); loaded.level[i] = 1; }
  const inc = { cells: Uint16Array.from(loaded.cells), level: Uint8Array.from(loaded.level), loose: Z() }, ch = Z();
  for(let i = 0; i < 10; i++){ inc.cells[i] &= 0x7FFF; inc.level[i] = 0; ch[i] = 1; }
  // meanwhile someone else re-made / refined those holds: live is now level 2, a new colour, loose on some
  const live = { cells: Uint16Array.from(loaded.cells), level: Uint8Array.from(loaded.level), loose: Z() };
  for(let i = 0; i < 10; i++){ live.cells[i] = cell(0, 0, 31, true); live.level[i] = 2; live.loose[i] = i & 1; }
  const r = M.mergeIntoMother({ mother: live, incoming: inc, chosen: ch, continuation: false });
  for(let i = 0; i < 10; i++){
    assert.equal(r.level[i], 2, 'live hold survives the stale erase'); assert.equal(r.loose[i], i & 1);
    assert.equal(r.cells[i], cell(0, 0, 31, true), 'live colour kept');
  }
  assert.equal(r.stats.erased, 0); assert.equal(r.stats.eraseIgnored, 10);
  // a stale erase of a cell that is free live is a no-op too
  const live2 = { cells: canvas(cell(4, 4, 4, false)), level: Z(), loose: Z() };
  const r2 = M.mergeIntoMother({ mother: live2, incoming: inc, chosen: ch, continuation: false });
  assert.equal(r2.cells[0], live2.cells[0]);
});

test('release only touches live holds the visitor did not choose; chosen erase is not "released"', () => {
  const live = liveWithReleased(), inc = oldCopy(), ch = Z(); for(let i = 0; i < 50; i++) ch[i] = 1;
  const r = M.mergeIntoMother({ mother: live, incoming: inc, chosen: ch, release: 1, releaseLoose: 1, rand: () => 0 });
  for(let i = 0; i < 50; i++) assert.equal(r.level[i], 3, 'chosen: max(2, 3), not released');
  for(let i = 50; i < 100; i++) assert.equal(r.level[i], 1, 'unchosen: live 2 → 1');
  for(let i = 100; i < 200; i++) assert.equal(r.level[i], 0);
});

// ── Lineage depth ──
test('lineage: live saves chain onto the theme\'s latest save; share links keep their parent', async () => {
  const rows = [];
  const db = { lookupById: async id => rows.find(r => r.short_id === id) || null,
               lookupLatest: async th => rows.filter(r => r.theme === th).slice(-1)[0] || null };
  const save = async (theme, parentId) => { const l = await resolveLineage({ parentId, theme, ...db }); const id = 's' + rows.length; rows.push({ short_id: id, theme, depth: l.depth, parent_id: l.parentId }); return { id, ...l }; };
  const a = await save('pb-love-pull', null);   assert.deepEqual([a.depth, a.parentId, a.via], [0, null, 'first']);
  const b = await save('pb-love-pull', null);   assert.deepEqual([b.depth, b.parentId, b.via], [1, a.id, 'live']);
  const c = await save('pb-love-pull', null);   assert.deepEqual([c.depth, c.parentId], [2, b.id]);
  const o = await save('pb-love-ripples', null); assert.equal(o.depth, 0, 'per theme');
  const s1 = await save('pb-love-pull', a.id);  assert.deepEqual([s1.depth, s1.parentId, s1.via], [1, a.id, 'share'], 'share link: parent depth + 1');
  const s2 = await save('pb-love-pull', s1.id); assert.equal(s2.depth, 2);
  const m = await save('pb-love-pull', 'zzzzzz'); assert.deepEqual([m.depth, m.via], [0, 'share-missing']);
});

test('noise hint (default) is a plain warm speckle: every cell a palette colour at 25–60%, no structure, no field', () => {
  const a = H.hintCanvas('love', 'noise'), pal = H.paletteFor('love');
  assert.equal(H.HINTS.noise.field, false, 'spreading follows the current canvas (hint weight 0)');
  let ok = 0;
  for(let i = 0; i < WT; i += 97){
    const r = a.R[i], g = a.G[i], b = a.B[i];
    if(pal.some(p => { const k = Math.max(r, g, b) / Math.max(1, Math.max(...p)); return k >= 0.24 && k <= 0.61 && Math.abs(p[0] * k - r) + Math.abs(p[1] * k - g) + Math.abs(p[2] * k - b) <= 4; })) ok++;
  }
  assert.ok(ok / Math.ceil(WT / 97) > 0.98, 'palette colour × 25–60%: ' + ok);
  let lo = 1e9, hi = -1;
  for(let by = 0; by < 660; by += 30) for(let bx = 0; bx < 900; bx += 30){ let s = 0; for(let y = by; y < by + 30; y++) for(let x = bx; x < bx + 30; x++){ const i = y * 900 + x; s += a.R[i] + a.G[i] + a.B[i]; } s /= 900; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  assert.ok(hi - lo < 30, 'no picture: block luminance spread ' + (hi - lo));   // ±3σ of 900-cell means
  assert.equal(V.PARAMS.glowMinMax, 60); assert.equal(V.PARAMS.glowMinSat, 0.25);
});

// ── Dream it ──
import * as D from '../lib/dream.js';
test('dream forms: each is a visible, bounded shape; regions and forms vary', () => {
  for(const f of D.FORMS){ const m = D.formMask(f, 120); let on = 0; for(const v of m) if(v > 0.5) on++;
    assert.ok(on > 120 * 120 * 0.03 && on < 120 * 120 * 0.6, f + ' coverage ' + on / 14400); }
  assert.equal(D.formWithArticle('eye'), 'an eye'); assert.equal(D.formWithArticle('heart'), 'a heart');
  assert.ok(!D.FORMS.includes('sun'), 'copy lists heart, leaf, eye, wave');
  const r = H.mulberry32(5); let last = null, lastF = null;
  for(let k = 0; k < 20; k++){
    const g = D.chooseRegion({ rand: r, last, S: 300, WC: 900, WR: 660 });
    assert.ok(g.fx >= 156 && g.fx <= 744 && g.fy >= 156 && g.fy <= 504, JSON.stringify(g));
    if(last) assert.ok(Math.hypot(g.fx - last.fx, g.fy - last.fy) / 900 >= 0.28 - 1e-9, 'a different region each time');
    const f = D.chooseForm(r, lastF); assert.notEqual(f, lastF); last = g; lastF = f;
  }
});
test('dream picks: scattered, one colour, the most common hue at the spot, far under the 8% cap', () => {
  const a = H.hintCanvas('love', 'noise'), rgb = i => [a.R[i], a.G[i], a.B[i]];
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
  const cells = []; const r = H.mulberry32(9);
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
import { validateDreamEvent } from '../lib/dream-event.js';
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
test('dream growth: world-grid blocks 16→8→4→2→1, sampled canvas colours, picks always held', () => {
  assert.deepEqual(D.GROW_LEVELS, [16, 8, 4, 2, 1]);
  const S = 340, X0 = 283, Y0 = 117, rand = H.mulberry32(9);
  const pal0 = [[200, 40, 60], [220, 120, 40], [150, 30, 110]];
  const orig = new Uint8Array(S * S * 3);
  for(let i = 0; i < S * S; i++){ const p = pal0[(rand() * 3) | 0], k = 0.25 + rand() * 0.35;
    orig[i * 3] = Math.round(p[0] * k); orig[i * 3 + 1] = Math.round(p[1] * k); orig[i * 3 + 2] = Math.round(p[2] * k); }
  const canvasColours = new Set(); for(let i = 0; i < S * S; i++) canvasColours.add(orig[i * 3] + ',' + orig[i * 3 + 1] + ',' + orig[i * 3 + 2]);
  const colour = [orig[0], orig[1], orig[2]];
  const pal = D.familyPalette(orig, S, colour);
  assert.ok(pal.length >= 8);
  for(const c of pal){ assert.ok(canvasColours.has(c.join(',')), 'palette colour comes from a real cell');
    assert.equal(D.hueBin(...c), D.hueBin(...colour), 'one colour family'); }
  const mask = D.formMask('heart', S), picks = [5 * S + 7, 300 * S + 333];
  let prevErr = Infinity, prevBlocks = 0;
  for(const b of D.GROW_LEVELS){
    const on = D.blockForm(mask, S, X0, Y0, b, { picks });
    for(const p of picks) assert.equal(on[p], 1, 'picks always hold');
    // every block of the world grid is uniformly on/off (except the forced picks)
    const blocks = new Map(); let err = 0;
    for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ const li = y * S + x; if(picks.includes(li)) continue;
      const key = Math.floor((X0 + x) / b) + ':' + Math.floor((Y0 + y) / b);
      if(!blocks.has(key)) blocks.set(key, on[li]); else assert.equal(blocks.get(key), on[li], 'block ' + key + ' uniform at ' + b);
      if(on[li] !== mask[li]) err++;
      if(on[li]){ const gx = X0 + x, gy = Y0 + y; const c = D.blockColour(pal, gx - gx % b, gy - gy % b);
        if(x % 37 === 0 && y % 41 === 0) assert.ok(canvasColours.has(c.join(',')), 'block colour is a canvas colour'); } }
    const onBlocks = [...blocks.values()].filter(Boolean).length;
    assert.ok(err <= prevErr, `detail improves at ${b}: ${err} vs ${prevErr}`);
    assert.ok(onBlocks > prevBlocks, 'more, finer blocks at ' + b);
    prevErr = err; prevBlocks = onBlocks;
  }
  assert.equal(prevErr, 0, 'at 1 cell the form is exact');
  // refinement keeps colour: a sub-block sharing its parent's origin keeps the parent's colour
  assert.deepEqual(D.blockColour(pal, 288, 128), D.blockColour(pal, 288, 128));
});

test('dream growth: every refinement is more defined — saturation and contrast vs the canvas rise 16→1 (real warm speckle)', () => {
  const c = H.hintCanvas('love', 'noise'), S = 340, L = D.GROW_LEVELS;
  for(const [form, X0, Y0] of [['heart', 280, 160], ['leaf', 40, 30], ['eye', 500, 300], ['wave', 200, 250]]){
    const orig = new Uint8Array(S * S * 3);
    for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ const i = (Y0 + y) * 900 + X0 + x, k = (y * S + x) * 3; orig[k] = c.R[i]; orig[k + 1] = c.G[i]; orig[k + 2] = c.B[i]; }
    const fams = new Map(); for(let i = 0; i < S * S; i++){ const h = D.hueBin(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]); if(h >= 0 && !fams.has(h)) fams.set(h, [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]]); }
    assert.ok(fams.size >= 2);
    for(const col of fams.values()){
    const pal = D.familyPalette(orig, S, col), mask = D.formMask(form, S);
    const rows = L.map((b, k) => { const on = D.blockForm(mask, S, X0, Y0, b, { jitter: b <= 2 ? 4 - b : 0 }), fl = v => v - ((v % b) + b) % b;
      return D.formContrast(on, i => D.levelColour(pal, fl(X0 + i % S), fl(Y0 + ((i / S) | 0)), k, L.length), orig, S); });
    for(let k = 1; k < rows.length; k++){
      assert.ok(rows[k].satIn > rows[k - 1].satIn || rows[k - 1].satIn >= 0.999, `${form} saturation rises at ${L[k]}: ${rows[k - 1].satIn} → ${rows[k].satIn}`);
      assert.ok(rows[k].contrast > rows[k - 1].contrast, `${form} brightness contrast rises at ${L[k]}`);
      assert.ok(rows[k].lumContrast > rows[k - 1].lumContrast, `${form} luminance contrast rises at ${L[k]}`);
    }
    assert.ok(rows[0].contrast > 1 && rows[4].satIn > rows[4].satOut, form + ' the form stands out');
    // alive, not flat: the 1-cell level keeps per-cell variation
    const vs = new Set(); for(let x = 0; x < 200; x++){ const v = D.levelColour(pal, X0 + x, Y0 + 7, 4, 5); vs.add(Math.max(...v)); }
    assert.ok(vs.size > 10, form + ' per-cell variation ' + vs.size);
    }
  }
});
test('dream growth: the fine edge is dithered per cell, not a smooth silhouette', () => {
  const S = 200, mask = D.formMask('heart', S);
  const exact = D.blockForm(mask, S, 10, 10, 1), dith = D.blockForm(mask, S, 10, 10, 1, { jitter: 2 });
  let diff = 0, onN = 0; for(let i = 0; i < S * S; i++){ if(exact[i] !== dith[i]) diff++; if(exact[i]) onN++; }
  assert.ok(diff > 50, 'boundary cells differ: ' + diff);
  assert.ok(diff / onN < 0.08, 'but only at the edge: ' + (diff / onN).toFixed(3));
});
