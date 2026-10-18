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

test('release: ~3% of holds nobody re-chose loosen; chosen holds never do', () => {
  const mother = canvas(cell(9, 9, 9, true));
  const inc = canvas(cell(9, 9, 9, true));
  const chosen = new Uint8Array(WT); for(let i = 0; i < 1000; i++) chosen[i] = 1;
  let s = 1; const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const r = M.mergeIntoMother({ mother, incoming: inc, chosen, release: 0.03, rand });
  const rate = r.stats.released / (WT - 1000);
  assert.ok(rate > 0.027 && rate < 0.033, 'rate ' + rate);
  for(let i = 0; i < 1000; i++) assert.ok(r.cells[i] & HELD);
  assert.equal(r.cells[5000] & 0x7FFF, cell(9, 9, 9, false), 'colour unchanged when released');
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
    for(const h of [undefined, 'pull', 'resonance', 'bogus']){
      const n = V.nsTheme(t, h);
      assert.ok(n.startsWith(V.NS), n); assert.ok(THEME_RE.test(n), n); assert.ok(n.length <= 40);
      assert.ok(H.HINT_NAMES.some(x => n.endsWith('-' + x)), n);
    }
  }
  assert.equal(V.nsTheme('love'), 'pb-love-attractors');
  assert.equal(V.nsTheme('love', 'pull'), 'pb-love-pull');
  assert.equal(V.nsTheme('pb-love-pull'), 'pb-love-pull');
  assert.equal(V.nsTheme('pb-love-pull', 'resonance'), 'pb-love-resonance');
  assert.deepEqual(V.parseNsTheme('pb-new-year 2027-pull'), { base: 'new-year 2027', hint: 'pull' });
});

test('hint registry: deterministic, every hint renders, love has three', () => {
  assert.deepEqual(H.hintsFor('love'), ['attractors', 'pull', 'resonance']);
  assert.equal(H.resolveHint('love', 'nope'), 'attractors');
  assert.equal(H.resolveHint('kites', 'nope'), 'pull');
  for(const h of H.HINT_NAMES){
    const a = H.hintCanvas('love', h);
    assert.equal(a.R.length, WT); assert.equal(a.hint, h);
    let lit = 0; for(let i = 0; i < WT; i++) if(a.R[i] + a.G[i] + a.B[i] > 120) lit++;
    assert.ok(lit > WT * 0.01 && lit < WT * 0.8, h + ' lit share ' + lit / WT);
  }
  // deterministic across fresh generation
  const a = H.HINTS.pull.gen({ rand: H.mulberry32(H.hashStr('hint:love|pull')), pal: H.paletteFor('love') });
  assert.deepEqual(a.R, H.hintCanvas('love', 'pull').R);
});
