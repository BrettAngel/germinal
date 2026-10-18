// PROTOTYPE (variant B): merge-into-live-canvas, colour rounding, namespacing, hints.
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../lib/merge.js';
import * as H from '../lib/hints.js';
import * as V from '../lib/variant.js';
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

test('continuation: the whole incoming canvas (held + unheld) is taken', () => {
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
  assert.equal(V.nsTheme('love'), 'pb-love-pull', 'pull is the default');
  assert.equal(V.nsTheme('love', 'pull-dim'), 'pb-love-pull-dim');
  assert.equal(V.nsTheme('love', 'attractors'), 'pb-love-attractors');
  assert.equal(V.nsTheme('pb-love-pull'), 'pb-love-pull');
  assert.equal(V.nsTheme('pb-love-pull-dim'), 'pb-love-pull-dim', 'longest hint matched first');
  assert.equal(V.nsTheme('pb-love-pull', 'resonance'), 'pb-love-ripples', 'resonance is an alias of ripples');
  assert.deepEqual(V.parseNsTheme('pb-new-year 2027-pull'), { base: 'new-year 2027', hint: 'pull' });
  assert.deepEqual(V.parseNsTheme('pb-love-pull-dim'), { base: 'love', hint: 'pull-dim' });
  assert.deepEqual(V.parseNsTheme('pb-love-resonance'), { base: 'love', hint: 'ripples' });
});

test('hint registry: pull default, pull-dim, ripples (alias resonance), attractors', () => {
  assert.deepEqual(H.hintsFor('love'), ['pull', 'pull-dim', 'ripples', 'attractors']);
  assert.equal(H.defaultHint('love'), 'pull');
  assert.equal(H.resolveHint('love', 'nope'), 'pull');
  assert.equal(H.resolveHint('love', 'resonance'), 'ripples');
  assert.equal(H.resolveHint('love', 'RIPPLES'), 'ripples');
  assert.equal(H.resolveHint('kites', 'nope'), 'pull');
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
  const c = M.mergeIntoMother({ mother: { cells: mc, level: ml, loose: mo }, incoming: { cells: ic, level: il, loose: io }, continuation: true });
  assert.equal(c.mode, 'continue'); assert.deepEqual(c.level, il); assert.deepEqual(c.loose, io);
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
