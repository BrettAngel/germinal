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
// ── Dream it: real selection + real Evolve, sped up (no mask reveal) ──
test('dream timeline: 4–6 select+Evolve cycles, each faster than the last; ~12–15 s; reduced motion ~7 s', () => {
  for(const rm of [false, true]){
    const T = D.dreamTimeline(rm), d = T.cycles.map(c => c.dur);
    assert.ok(d.length >= 4 && d.length <= 6, 'cycles ' + d.length);
    for(let k = 1; k < d.length; k++) assert.ok(d[k] < d[k - 1], `cycle ${k} faster: ${d[k - 1]} → ${d[k]}`);
    for(const c of T.cycles){ assert.ok(c.loops >= 2, 'a few lassos each cycle');
      assert.ok(c.t0 < c.loopEnd && c.loopEnd <= c.press && c.press <= c.t1, 'lassos, then Evolve, inside the cycle'); }
    for(let k = 1; k < T.cycles.length; k++) assert.ok(Math.abs(T.cycles[k].t0 - T.cycles[k - 1].t1) < 1e-9, 'back to back');
    assert.ok(T.cycles[0].t0 >= T.pick[1] - 1e-9 && T.zout[0] >= T.cycles.at(-1).t1 - 1e-9 && T.fade[1] === T.end, 'order: picks → cycles → step back → fade');
    if(rm) assert.ok(T.end >= 5 && T.end <= 8, 'reduced ' + T.end);
    else { assert.ok(T.end >= 12 && T.end <= 15, 'normal ' + T.end); assert.equal(T.zin[1], 2.2, 'opening zoom unchanged');
      assert.deepEqual(T.pick, [2.2, 4.8].map((v, i) => T.pick[i]), 'first lassos right after the zoom'); assert.ok(Math.abs(T.pick[1] - 4.8) < 1e-9); }
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
// a synthetic dark canvas with red-ish, warm and cool speckle (like the noise hint)
function speckle(WC, WR, seed){ const r = H.mulberry32(seed), c = new Uint8Array(WC * WR * 3);
  for(let i = 0; i < WC * WR; i++){ const k = r(), v = 40 + r() * 140;
    const col = k < 0.35 ? [v, v * 0.18, v * 0.25] : k < 0.55 ? [v, v * 0.5, v * 0.2] : k < 0.8 ? [v * 0.2, v * 0.4, v] : [v * 0.15, v * 0.15, v * 0.2];
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  return i => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]; }
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
    const tg = D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster, WC, WR, mask, S, fx, fy, ring: 3, count: 3, rand: H.mulberry32(seed) });
    assert.ok(tg.length === 3, 'three targets');
    for(const o of tg){ n++; assert.ok(!held.has(o.i), 'never an already-held cell');
      const d = Math.min(...cluster.map(c => Math.max(Math.abs(c % WC - o.i % WC), Math.abs(((c / WC) | 0) - ((o.i / WC) | 0)))));
      assert.ok(d >= 1 && d <= 3, 'adjacent to the cluster (≤ 3 cells): ' + d);
      redSum += D.redness(...rgb(o.i)); if(o.inForm) inForm++; else outside++; }
    for(let i = 0; i < 400; i++){ const x = fx - 3 + (i % 20) * 0.3 | 0, y = fy - 3 + ((i / 20) | 0) * 0.3 | 0; all += D.redness(...rgb(y * WC + x)); }
  }
  assert.ok(redSum / n > 2 * all / (40 * 400), `picked cells are red-ish: ${(redSum / n).toFixed(2)} vs local mean ${(all / 16000).toFixed(2)}`);
  assert.ok(new Set(Array.from({ length: 5 }, (_, s) => D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster, WC, WR, mask, S, fx, fy, rand: H.mulberry32(s + 1) }).map(o => o.i).join())).size > 1, 'noise: not the same cells every time');
});
test('dream cluster grows across cycles, for every form: outward, mostly into the form, rough (gaps and strays)', () => {
  for(const form of D.FORMS){
  const WC = 260, WR = 220, rgb = speckle(WC, WR, 11), S = D.formSize(form), fx = 130, fy = 110, mask = D.formMask(form, S), rand = H.mulberry32(4);
  const T = D.dreamTimeline(false), held = new Set();
  for(const p of [fy * WC + fx, fy * WC + fx + 4, (fy + 3) * WC + fx - 2, (fy - 3) * WC + fx + 2]) holdLoop(D.loopPoints(p % WC, (p / WC) | 0, 1.35, rand), WC, held);
  const X0 = fx - (S >> 1), Y0 = fy - (S >> 1), inF = i => { const x = i % WC - X0, y = ((i / WC) | 0) - Y0; return x >= 0 && y >= 0 && x < S && y < S && mask[y * S + x]; };
  let formN = 0; for(const v of mask) formN += v;
  const sizes = [held.size], cover = [], spread = [];
  T.cycles.forEach((c, k) => {
    const u = k / (T.cycles.length - 1), r = Math.max(1.4, (26 + 16 * u) / (9 * Math.pow(0.45, u) * 2));
    const tg = D.chooseCycleTargets({ rgb, isHeld: i => held.has(i), cluster: [...held], WC, WR, mask, S, fx, fy, ring: Math.max(2, Math.round(r * 0.9)), count: c.loops, minSep: Math.max(3, Math.round(r * 1.3)), bias: 1 + k * 0.25, fill: 1, rand });
    for(const o of tg) holdLoop(D.loopPoints(o.i % WC, (o.i / WC) | 0, r, rand), WC, held);
    sizes.push(held.size); let f = 0, mx = 0; for(const i of held){ if(inF(i)) f++; mx = Math.max(mx, Math.hypot(i % WC - fx, ((i / WC) | 0) - fy)); }
    cover.push(f / formN); spread.push(mx);
  });
  for(let k = 1; k < sizes.length; k++) assert.ok(sizes[k] > sizes[k - 1], `${form} grows every cycle: ${sizes.join(' → ')}`);
  for(let k = 1; k < spread.length; k++) assert.ok(spread[k] >= spread[k - 1], form + ' outward');
  let inside = 0; for(const i of held) if(inF(i)) inside++;
  assert.ok(inside / held.size > 0.6, form + ' mostly inside the form: ' + (inside / held.size).toFixed(2));
  assert.ok(inside / held.size < 0.995 && cover.at(-1) < 0.9, `${form} rough, not the clean form: in ${(inside / held.size).toFixed(2)}, cover ${cover.at(-1).toFixed(2)}`);
  assert.ok(cover.at(-1) > 0.35, form + ' but enough to read as one: cover ' + cover.at(-1).toFixed(2));
  assert.ok(held.size / (900 * 660) < 0.08, 'far under the 8% cap');
  }
});
test('dream forms rotate: heart first for love, then leaf → eye → wave → heart; all sized alike', () => {
  assert.equal(D.nextForm({ theme: 'love' }), 'heart', 'first visit on love: a heart');
  assert.equal(D.nextForm({ theme: 'Love' }), 'heart');
  const seq = []; let last = null; for(let k = 0; k < 6; k++){ last = D.nextForm({ last, theme: 'love' }); seq.push(last); }
  assert.deepEqual(seq, ['heart', 'leaf', 'eye', 'wave', 'heart', 'leaf'], 'later plays and Dream again rotate');
  assert.equal(D.nextForm({ last: 'wave', theme: 'sea' }), 'heart', 'rotation is the same on any theme');
  assert.ok(D.FORMS.includes(D.nextForm({ theme: 'sea' })));
  const n = f => { let c = 0; for(const v of D.formMask(f, D.formSize(f))) c += v; return c; };
  for(const f of D.FORMS) assert.ok(Math.abs(n(f) - n('heart')) / n('heart') < 0.06, `${f} has about as many cells as the heart: ${n(f)} vs ${n('heart')}`);
});
test('dream region guard: picks a start rich in the theme family (red for love), far from the last dream', () => {
  const WC = 900, WR = 660, r = H.mulberry32(8);
  // dark canvas with red only in a few patches
  const red = new Uint8Array(WC * WR); for(const [cx, cy] of [[150, 500], [700, 150], [450, 330]]) for(let y = cy - 60; y < cy + 60; y++) for(let x = cx - 60; x < cx + 60; x++) if(x >= 0 && y >= 0 && x < WC && y < WR) red[y * WC + x] = 1;
  const rgb = i => red[i] ? [170 + (i % 50), 30, 45] : [14 + (i % 9), 12, 20];
  let hits = 0, lucky = 0;
  for(let k = 0; k < 30; k++){
    const rand = H.mulberry32(100 + k), g = D.chooseDreamRegion({ rand, S: 44, WC, WR, rgb, hue: 355 });
    const one = D.chooseRegion({ rand: H.mulberry32(100 + k), S: 84, WC, WR });
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
