// PREVIEW (live-wall compositor, branch live-wall-compositor). Pure helpers
// shared by the app (what a visitor contributes), the live wall (which held
// patches exist, where, at what hold level, for how long) and the tests.
//
// The compositor NEVER recolours a pixel except once, when a patch lands
// with its contributor's own saved colours. After that main's engine acts on
// it (stepGen), and when it is released (s = 0) the engine's own randomness
// takes it back. Parameters: SIM4 config "N1" (/workspace/germinal/sim4).
//
// Storage: a contribution rides in the save body's existing, unused
// `stabMap` text column, versioned "gp1.<base64>". No schema change; old
// clients/rows (stabMap null) are simply not patches.
import { hueBin } from './dream.js';

export const WC = 900, WR = 660, WT = WC * WR;
const HOUR = 3600e3;

// SIM4 N1 (times in hours). wallRate: Evolves per wall-hour.
export const N1 = Object.freeze({
  Tmin: 0.25, Tmax: 96, gamma: 2, Cref: 0.25, k: 0.35, S0: 100, Fcap: 1.75,
  theta: 0.2, Hmax: 0.25, patchCap: 0.0035, devCap: 2, blackC: 0.4,
  wallRate: 12, baseC: 0.1, baseT: 6,            // the wall's starting holds: one weak 6-hour patch
  refreshOverlap: 0.3, roundsCap: 50, ringCap: 4000, maxEntries: 60000,
});
export const FLAGS = Object.freeze({ confLevel: true, refresh: true });   // Brett: both default ON (preview)
// release horizon: a patch is gone once h < theta, i.e. age > T·log2(1/theta)
export const MAX_AGE_H = N1.Tmax * N1.Fcap * Math.log2(1 / N1.theta) + 1;

const hex2 = v => v.toString(16).padStart(2, '0');
export const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
export const fromHex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const fam12 = (r, g, b) => { const k = hueBin(r, g, b); return k >= 0 && Math.max(r, g, b) >= 50 ? k : 255; };   // SIM4's "counts as a colour family"

// ── geometry (8-neighbour components, densest-first trim) — SIM4's ──
export function components(cells){
  const set = new Set(cells), seen = new Set(), out = [];
  for(const i0 of cells){ if(seen.has(i0)) continue; const st = [i0], cc = []; seen.add(i0);
    while(st.length){ const i = st.pop(); cc.push(i); const x = i % WC, y = (i / WC) | 0;
      for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){ if(!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if(nx < 0 || ny < 0 || nx >= WC || ny >= WR) continue; const j = ny * WC + nx; if(set.has(j) && !seen.has(j)){ seen.add(j); st.push(j); } } }
    out.push(cc); }
  return out;
}
function bboxArea(cc){ let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1; for(const i of cc){ const x = i % WC, y = (i / WC) | 0; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; } return (x1 - x0 + 1) * (y1 - y0 + 1); }
export function trimPatch(cells, cap){
  if(cells.length <= cap) return cells;
  const comps = components(cells).map(cc => ({ cc, d: cc.length / bboxArea(cc) })).sort((a, b) => b.d - a.d || b.cc.length - a.cc.length);
  const out = [];
  for(const { cc } of comps){ if(out.length + cc.length <= cap){ out.push(...cc); continue; }
    if(!out.length){ let sx = 0, sy = 0; for(const i of cc){ sx += i % WC; sy += (i / WC) | 0; } sx /= cc.length; sy /= cc.length;
      const s = cc.map(i => [Math.hypot(i % WC - sx, ((i / WC) | 0) - sy), i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); for(let q = 0; q < cap; q++) out.push(s[q][1]); }
    break; }
  return out;
}

// ── the payload ("gp1."): version, rounds, held cells (index, level, rgb888), ring (index, family) ──
export function encodePatch({ cells, ring = [], rounds = 1 }){
  const n = cells.length, m = ring.length, b = new Uint8Array(9 + 6 * n + 4 * m);
  const dv = new DataView(b.buffer); dv.setUint8(0, 1); dv.setUint16(1, Math.min(65535, rounds | 0)); dv.setUint32(3, n); dv.setUint16(7, Math.min(65535, m));
  let o = 9;
  for(const c of cells){ const v = (c.i << 2) | (c.l & 3); b[o] = v >>> 16; b[o + 1] = (v >>> 8) & 255; b[o + 2] = v & 255; b[o + 3] = c.r; b[o + 4] = c.g; b[o + 5] = c.b; o += 6; }
  for(const r of ring.slice(0, 65535)){ b[o] = r.i >>> 16; b[o + 1] = (r.i >>> 8) & 255; b[o + 2] = r.i & 255; b[o + 3] = r.f; o += 4; }
  let s = ''; for(let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return 'gp1.' + btoa(s);
}
// Never trusts the payload: bounds, levels, duplicates and sizes are checked; anything odd → null.
export function decodePatch(str){
  try{
    if(typeof str !== 'string' || !str.startsWith('gp1.')) return null;
    const bin = atob(str.slice(4)), b = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    if(b.length < 9 || b[0] !== 1) return null;
    const dv = new DataView(b.buffer), rounds = dv.getUint16(1), n = dv.getUint32(3), m = dv.getUint16(7);
    if(n < 1 || n > N1.maxEntries || b.length !== 9 + 6 * n + 4 * m) return null;
    const cells = [], ring = [], seen = new Set(); let o = 9;
    for(let q = 0; q < n; q++, o += 6){ const v = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2], i = v >>> 2, l = v & 3;
      if(i >= WT || l < 1 || seen.has(i)) continue; seen.add(i); cells.push({ i, l, r: b[o + 3], g: b[o + 4], b: b[o + 5] }); }
    for(let q = 0; q < m; q++, o += 4){ const i = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2], f = b[o + 3];
      if(i < WT && !seen.has(i) && (f < 12 || f === 255)) ring.push({ i, f }); }
    return cells.length ? { rounds: Math.min(rounds, N1.roundsCap), cells, ring } : null;
  }catch(e){ return null; }
}

// What a visitor contributes: the cells they newly held or refined this
// session (hold level above the level the canvas had when their session
// began), trimmed to the per-patch cap, with their own colours (8-bit) and
// levels, plus a sample of the UNCHOSEN cells within 3 px (for Sel).
export function extractPatch({ cells, base = null, owned = null, rounds = 1, P = N1 }){
  let idx = [];
  for(let i = 0; i < cells.length; i++){ const s = cells[i].s; if(s > 0 && (base ? s > base[i] : owned && owned.has(i))) idx.push(i); }
  if(!idx.length) return null;
  idx = trimPatch(idx, Math.round(P.patchCap * WT));
  const inP = new Set(idx), ringAll = [], seen = new Set();
  for(const i of idx){ const x = i % WC, y = (i / WC) | 0;
    for(let dy = -3; dy <= 3; dy++) for(let dx = -3; dx <= 3; dx++){ const nx = x + dx, ny = y + dy; if(nx < 0 || ny < 0 || nx >= WC || ny >= WR) continue;
      const j = ny * WC + nx; if(inP.has(j) || seen.has(j)) continue; seen.add(j); ringAll.push(j); } }
  const step = Math.max(1, Math.ceil(ringAll.length / P.ringCap));
  const ring = []; for(let q = 0; q < ringAll.length; q += step){ const j = ringAll[q], [r, g, b] = fromHex(cells[j].c); ring.push({ i: j, f: fam12(r, g, b) }); }
  return { rounds: Math.max(1, Math.min(P.roundsCap, rounds | 0)), ring,
    cells: idx.map(i => { const [r, g, b] = fromHex(cells[i].c); return { i, l: Math.min(3, cells[i].s), r, g, b }; }) };
}

// Confidence, SIM4 "focus" variant: C = Sf·K·Q·R·(0.15 + 0.85·Sel), black guard; then F, Cn, T.
export function confidence(patch, P = N1){
  const cs = patch.cells, n = cs.length, idx = cs.map(c => c.i);
  let K = 0; for(const cc of components(idx)) K += cc.length * (cc.length / bboxArea(cc)); K /= n;
  const med = k => { const a = cs.map(c => c[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
  const mr = med('r'), mg = med('g'), mb = med('b');
  const d = cs.map(c => Math.hypot(c.r - mr, c.g - mg, c.b - mb)).sort((x, y) => x - y);
  const Q = Math.max(0, 1 - d[d.length >> 1] / 120);
  let lv = 0; for(const c of cs) lv += c.l - 1; const R = 1 + 0.3 * lv / n;
  const hb = new Float64Array(12), hf = new Float64Array(12);
  for(const c of cs){ const f = fam12(c.r, c.g, c.b); if(f < 12) hb[f]++; const k = hueBin(c.r, c.g, c.b); if(k >= 0) hf[k]++; }
  let m = 0; for(let q = 1; q < 12; q++) if(hb[q] > hb[m]) m = q;
  const cohIn = hb[m] / n, ringM = patch.ring.length ? patch.ring.filter(r => r.f === m).length / patch.ring.length : 0;
  const Sel = Math.max(0, Math.min(1, (cohIn - ringM) / 0.6)), Sf = 1 / (1 + n / 300);
  let C = Math.min(1, Math.max(0, Sf * K * Q * R * (0.15 + 0.85 * Sel)));
  let dark = 0; for(const c of cs) if(Math.max(c.r, c.g, c.b) < 28) dark++;
  const mlum = LUM(mr, mg, mb) / 255, black = mlum < 0.08 || dark / n > 0.5; if(black) C *= P.blackC;
  let fam = 0; for(let q = 1; q < 12; q++) if(hf[q] > hf[fam]) fam = q; if(!hf[fam]) fam = -1;
  const score = 100 * C * (patch.rounds || 1), F = Math.min(P.Fcap, 1 + P.k * Math.log(1 + Math.max(0, score) / P.S0));
  const Cn = Math.min(1, C / P.Cref), T = P.Tmin + (P.Tmax - P.Tmin) * Math.pow(Cn, P.gamma) * F;
  return { C, Cn, F, T, K, Q, R, Sel, Sf, black, mlum, fam };
}

// ── the compositor: works on the engine's own cells ({c:'#rrggbb', s}) ──
export class Compositor{
  constructor(engine, { params = {}, flags = {} } = {}){
    this.E = engine; this.P = Object.assign({}, N1, params); this.flags = Object.assign({}, FLAGS, flags);
    this.owner = new Int32Array(WT).fill(-1); this.active = []; this.byId = new Map(); this.nextId = 1;
    this.devices = new Map(); this.seen = new Set(); this.lastSafe = -Infinity;
    this.stat = { landed: 0, refreshes: 0, released: 0, capHits: 0, blackHits: 0, divHits: 0, rejected: 0 };
  }
  W(p, t){ return p.C * p.F * Math.pow(2, -(t - p.birth) / (p.T * HOUR)); }
  h(p, t){ return Math.pow(2, -(t - p.birth) / (p.T * HOUR)); }
  _add(p){ p.id = this.nextId++; this.byId.set(p.id, p); this.active.push(p); return p; }
  // the canvas the wall starts from: its holds become one weak patch, so they fade like anything else
  addBase(birth){
    const cells = this.E.cells, idx = [], lvl = [];
    for(let i = 0; i < WT; i++) if(cells[i].s > 0){ idx.push(i); lvl.push(Math.min(3, cells[i].s)); }
    const p = this._add({ base: true, cells: idx, lvl: Uint8Array.from(lvl), C: this.P.baseC, F: 1, T: this.P.baseT, birth, fam: -1, device: null, mlum: 0.5 });
    for(const i of idx) this.owner[i] = p.id;
    return p;
  }
  // a contribution lands at time t (ms). rec: { id, device, data }
  land(rec, t){
    if(!rec || this.seen.has(rec.id)) return null; this.seen.add(rec.id);
    const patch = decodePatch(rec.data); if(!patch){ this.stat.rejected++; return null; }
    const cap = Math.round(this.P.patchCap * WT);
    if(patch.cells.length > cap){ const keep = new Set(trimPatch(patch.cells.map(c => c.i), cap)); patch.cells = patch.cells.filter(c => keep.has(c.i)); }
    const cf = confidence(patch, this.P);
    // flag (b): re-selection refreshes a visible patch — a new patch that overlaps an existing one of the same hue family restarts its fade
    if(this.flags.refresh && cf.fam >= 0){
      const hits = new Map(); for(const c of patch.cells){ const o = this.owner[c.i]; if(o > 0) hits.set(o, (hits.get(o) || 0) + 1); }
      for(const [o, k] of hits){ const q = this.byId.get(o); if(q && !q.base && q.fam === cf.fam && k >= this.P.refreshOverlap * patch.cells.length){ q.birth = t; this.stat.refreshes++; } }
    }
    // flag (a): confident patches land at hold level 2+ (strength still steps them down as they fade)
    const lift = this.flags.confLevel ? (cf.Cn >= 0.75 ? 3 : cf.Cn >= 0.5 ? 2 : 1) : 1;
    const p = this._add({ cells: [], lvl: null, C: cf.C, F: cf.F, T: cf.T, birth: t, fam: cf.fam, mlum: cf.mlum, device: rec.device || null, conf: cf, src: rec.id });
    const Wn = cf.C * cf.F, lv = [], cells = this.E.cells;
    for(const c of patch.cells){ const o = this.owner[c.i];
      if(o > 0){ const q = this.byId.get(o); if(q && this.W(q, t) > Wn) continue; }   // the stronger patch wins outright; ties → newest
      this.owner[c.i] = p.id; const l = Math.max(c.l, lift);
      cells[c.i].c = toHex(c.r, c.g, c.b); cells[c.i].s = l;                         // the ONE write of colour: the contributor's own
      p.cells.push(c.i); lv.push(l); }
    p.lvl = Uint8Array.from(lv); this.stat.landed++;
    if(p.device){ const L = this.devices.get(p.device) || []; L.push(p); while(L.length > this.P.devCap) this._releaseAll(L.shift()); this.devices.set(p.device, L); }
    return p;
  }
  _release(p, i){ if(this.owner[i] === p.id){ this.owner[i] = -1; this.E.cells[i].s = 0; this.stat.released++; } }
  _releaseAll(p){ for(const i of p.cells) this._release(p, i); }
  // strength steps down the engine's own hold levels; released below theta
  decay(t){
    const keep = [], cells = this.E.cells;
    for(const p of this.active){ const h = this.h(p, t), L = h > 0.75 ? 3 : h > 0.5 ? 2 : h > this.P.theta ? 1 : 0; let any = false;
      for(let q = 0; q < p.cells.length; q++){ const i = p.cells[q]; if(this.owner[i] !== p.id) continue;
        if(!L){ this._release(p, i); continue; } const lv = Math.min(p.lvl[q], L); if(cells[i].s !== lv) cells[i].s = lv; any = true; }
      if(any) keep.push(p); else this.byId.delete(p.id); }
    this.active = keep;
  }
  heldCount(){ let n = 0; const cells = this.E.cells; for(let i = 0; i < WT; i++) if(cells[i].s > 0) n++; return n; }
  // held cap, black guard, diversity floor — all act only by speeding decay (T × 0.5), at most once per wall-hour
  safeguards(t){
    if(t - this.lastSafe < HOUR) return; this.lastSafe = t;
    const cells = this.E.cells, halve = p => { const h = this.h(p, t); p.T *= 0.5; p.birth = t + Math.log2(h) * p.T * HOUR; };
    const held = this.heldCount();
    if(held > this.P.Hmax * WT){ let ex = held - this.P.Hmax * WT;
      for(const p of this.active.filter(p => p.birth < t).sort((a, b) => this.W(a, t) - this.W(b, t))){ if(ex <= 0) break;
        const n = p.cells.reduce((a, i) => a + (this.owner[i] === p.id ? 1 : 0), 0); if(!n) continue; halve(p); ex -= n; this.stat.capHits++; } }
    let dark = 0, hn = 0; const hb = new Float64Array(12);
    for(let i = 0; i < WT; i++) if(cells[i].s > 0){ const [r, g, b] = fromHex(cells[i].c); if(Math.max(r, g, b) < 28) dark++; const k = hueBin(r, g, b); if(k >= 0){ hb[k]++; hn++; } }
    if(held && dark / held > 0.07){ for(const p of this.active.slice().sort((a, b) => a.mlum - b.mlum).slice(0, 3)) halve(p); this.stat.blackHits++; }
    let fams = 0; for(const b of hb) if(hn && b > hn * 0.03) fams++;
    if(hn > 200 && fams < 6){ let km = 0; for(let k = 1; k < 12; k++) if(hb[k] > hb[km]) km = k; for(const p of this.active) if(p.fam === km) halve(p); this.stat.divHits++; }
  }
  summary(){ const held = this.heldCount(); return { held: held / WT, patches: this.active.filter(p => !p.base).length, base: this.active.some(p => p.base), ...this.stat }; }
}
