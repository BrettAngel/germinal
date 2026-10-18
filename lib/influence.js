// PROTOTYPE (variant B branch) — Evolve as a readable GRADIENT around what is
// held (Brett, Oct 18):
//   • held cells: maximally stabilised (the engine's own slow held-cell drift
//     only; no glow)
//   • free cells near holds: pulled toward a related shade of the SELECTED
//     colour there — the dominant hue of the nearest firm holds over ±selR
//     cells (a loop holds every cell inside it, dark and other-coloured ones
//     too; the colour people chose is the commonest vivid hue) — with an
//     influence weight that fades with distance
//       w(d) = exp(−d / inflLambda) for d ≤ inflR, else 0
//   • free cells far from holds: fully re-randomised each Evolve, i.e. drawn
//     afresh from the starting canvas (the hint) at a random spot within
//     ±farJitter cells. For the default "noise" hint that is fresh noise; for
//     a patterned hint the coarse pattern survives, its detail does not.
//   Between the two, a cell is re-randomised with p = farRandomP·(1 − w)^randomPow
//   and otherwise pulled by t = inflT·w, so change grows with distance.
// Pure and DOM-free: app.html (stepGenTuned), the unit tests and the sim
// (/workspace/germinal/sim/hints_sim.js GRAD=1) all run this same code.
// Bounded: every parameter is clamped (gradParams) so a bad value can't blow up.

export const GRAD_DEFAULTS = {
  inflR: 16,        // influence radius, cells
  inflLambda: 4.5,  // influence fall-off length, cells
  inflT: 0.65,      // pull toward the shade per Evolve at w = 1
  selR: 5,          // the selected colour: vividness-weighted mean of firm holds within ±5 cells
  shadeMin: 0.85,   // related shades: 85–140% of the selected colour's brightness (fixed per cell)…
  shadeMax: 1.4,
  shadeFar: 0.7,    // …dimmed with distance, to 70% at the edge of the influence
  farRandomP: 1,    // far cells: re-randomised every Evolve (1 = fully)
  randomPow: 3,     // re-randomise p = farRandomP·(1−w)^3
  farJitter: 3,     // a re-randomised cell takes the starting canvas's colour within ±3 cells
};
const clampN = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
export function gradParams(P = {}){
  const g = GRAD_DEFAULTS;
  return {
    inflR: clampN(P.inflR ?? g.inflR, 0, 40, g.inflR),
    inflLambda: clampN(P.inflLambda ?? g.inflLambda, 0.5, 20, g.inflLambda),
    inflT: clampN(P.inflT ?? g.inflT, 0, 0.9, g.inflT),
    selR: Math.round(clampN(P.selR ?? g.selR, 0, 12, g.selR)),
    shadeMin: clampN(P.shadeMin ?? g.shadeMin, 0, 2, g.shadeMin),
    shadeMax: clampN(P.shadeMax ?? g.shadeMax, 0, 2, g.shadeMax),
    shadeFar: clampN(P.shadeFar ?? g.shadeFar, 0, 1, g.shadeFar),
    farRandomP: clampN(P.farRandomP ?? g.farRandomP, 0, 1, g.farRandomP),
    randomPow: clampN(P.randomPow ?? g.randomPow, 0.5, 6, g.randomPow),
    farJitter: Math.round(clampN(P.farJitter ?? g.farJitter, 0, 8, g.farJitter)),
  };
}
export function influenceWeight(d, P){ return d <= P.inflR ? Math.exp(-d / P.inflLambda) : 0; }

// Distance (cells, ~Euclidean) from every cell to the nearest source cell, and
// that source's index (shared buffers: valid until the next call). Two-pass propagation of nearest-source coordinates
// (8-neighbour sequential EDT approximation). Only the box around the sources
// widened by `reach` is scanned (cells further out stay at Infinity / −1),
// so a few holds cost little; O(cells) at worst.
let BUF = null;   // reused between Evolves (no 7 MB of garbage per generation)
export function nearestSource(isSrc, WC, WR, reach = Infinity){
  const N = WC * WR;
  if(!BUF || BUF.N !== N) BUF = { N, src: new Int32Array(N), dist: new Float32Array(N), SX: new Int16Array(N), SY: new Int16Array(N), D2: new Float64Array(N) };
  const { src, dist, SX, SY, D2 } = BUF; src.fill(-1); dist.fill(Infinity); D2.fill(Infinity);
  let x0 = WC, y0 = WR, x1 = -1, y1 = -1;
  for(let i = 0; i < N; i++) if(isSrc[i]){ const x = i % WC, y = (i / WC) | 0; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  if(x1 < 0) return { dist, src, any: false };
  const m = Number.isFinite(reach) ? Math.ceil(reach) + 1 : Math.max(WC, WR);
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(WC - 1, x1 + m); y1 = Math.min(WR - 1, y1 + m);
  for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++){ const i = y * WC + x; if(isSrc[i]){ src[i] = i; SX[i] = x; SY[i] = y; D2[i] = 0; } }
  const T = (i, x, y, j) => { if(src[j] < 0) return; const dx = x - SX[j], dy = y - SY[j], d = dx * dx + dy * dy;
    if(d < D2[i]){ D2[i] = d; src[i] = src[j]; SX[i] = SX[j]; SY[i] = SY[j]; } };
  for(let y = y0; y <= y1; y++){
    for(let x = x0; x <= x1; x++){ const i = y * WC + x;
      if(x > x0) T(i, x, y, i - 1);
      if(y > y0){ T(i, x, y, i - WC); if(x > x0) T(i, x, y, i - WC - 1); if(x < x1) T(i, x, y, i - WC + 1); } }
    for(let x = x1 - 1; x >= x0; x--){ const i = y * WC + x; T(i, x, y, i + 1); }
  }
  for(let y = y1; y >= y0; y--){
    for(let x = x1; x >= x0; x--){ const i = y * WC + x;
      if(x < x1) T(i, x, y, i + 1);
      if(y < y1){ T(i, x, y, i + WC); if(x < x1) T(i, x, y, i + WC + 1); if(x > x0) T(i, x, y, i + WC - 1); } }
    for(let x = x0 + 1; x <= x1; x++){ const i = y * WC + x; T(i, x, y, i - 1); }
  }
  for(let y = y0; y <= y1; y++) for(let x = x0; x <= x1; x++){ const i = y * WC + x; if(src[i] >= 0) dist[i] = Math.sqrt(D2[i]); }
  return { dist, src, any: true };
}

// a fixed per-cell value in [0,1): the cell's own shade within the family
const cellHash = i => (Math.imul(i ^ (i >>> 15), 2654435761) >>> 0) / 4294967296;

// One Evolve for the FREE cells (level 0). R,G,B: current colours (mutated);
// level: hold level per cell; spreads: 1 where a hold may spread (firm holds;
// loose holds protect their pixels but don't spread); H0: starting canvas
// {R,G,B}. onSet(i, j) is called for every cell whose colour changed; j ≥ 0
// when it was re-randomised to the starting canvas's cell j (else −1).
// The selected colour around each firm hold: the DOMINANT HUE of the firm
// holds within ±r cells (12 hue bins; the commonest by saturation, as the app
// reads a lasso's colour) and that bin's mean colour weighted by saturation ×
// brightness² (its vivid pixels lead: the ones people circled). A loop
// holds every cell inside it; the colour people chose is the commonest vivid
// hue in it. No saturated holds nearby → the plain mean. Sampled on a stride-2
// grid; computed once per spot (holds with the same window share it).
let SB_ = null;
export function hueBin12(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if(mx < 28 || d < 14) return -1;
  let h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.min(11, (h * 2) | 0);
}
export function selectedColour(R, G, B, spreads, WC, WR, r){
  const N = WC * WR;
  if(!SB_ || SB_.N !== N) SB_ = { N, SR: new Float32Array(N), SG: new Float32Array(N), SB: new Float32Array(N) };
  const { SR, SG, SB } = SB_, w = new Float64Array(12), wc = new Float64Array(12), cr = new Float64Array(12), cg = new Float64Array(12), cb = new Float64Array(12);
  for(let i = 0; i < N; i++){ if(!spreads[i]) continue;
    const x = i % WC, y = (i / WC) | 0;
    w.fill(0); wc.fill(0); cr.fill(0); cg.fill(0); cb.fill(0); let ar = 0, ag = 0, ab = 0, an = 0;
    for(let dy = -r; dy <= r; dy += 2){ const yy = y + dy; if(yy < 0 || yy >= WR) continue;
      for(let dx = -r; dx <= r; dx += 2){ const xx = x + dx; if(xx < 0 || xx >= WC) continue; const j = yy * WC + xx; if(!spreads[j]) continue;
        const rj = R[j], gj = G[j], bj = B[j]; ar += rj; ag += gj; ab += bj; an++;
        const k = hueBin12(rj, gj, bj); if(k < 0) continue;
        const mx = Math.max(rj, gj, bj), q = (mx - Math.min(rj, gj, bj)) / mx, v = q * mx * mx / 65025;
        w[k] += q;                                                   // which hue: the commonest saturated one…
        wc[k] += v; cr[k] += v * rj; cg[k] += v * gj; cb[k] += v * bj; } }   // …its colour: led by its vivid pixels (saturation × brightness²)
    let bk = -1; for(let k = 0; k < 12; k++) if(w[k] > 0 && (bk < 0 || w[k] > w[bk])) bk = k;
    if(bk >= 0){ SR[i] = cr[bk] / wc[bk]; SG[i] = cg[bk] / wc[bk]; SB[i] = cb[bk] / wc[bk]; }
    else if(an){ SR[i] = ar / an; SG[i] = ag / an; SB[i] = ab / an; }
    else { SR[i] = R[i]; SG[i] = G[i]; SB[i] = B[i]; }
  }
  return SB_;
}

export function gradientStep({ R, G, B, level, spreads, H0, WC, WR, P: P0, rand = Math.random, onSet }){
  const P = gradParams(P0);
  const { dist, src } = nearestSource(spreads, WC, WR, P.inflR);
  const { SR, SG, SB } = selectedColour(R, G, B, spreads, WC, WR, P.selR);
  const J = P.farJitter, cl = v => v < 0 ? 0 : v > 255 ? 255 : v;
  // jitter offsets for re-randomising, drawn from one table (one rand() per cell)
  const K = 256, OX = new Int8Array(K), OY = new Int8Array(K);
  for(let k = 0; k < K; k++){ OX[k] = Math.round((rand() * 2 - 1) * J); OY[k] = Math.round((rand() * 2 - 1) * J); }
  let randomised = 0, pulled = 0;
  for(let y = 0, i = 0; y < WR; y++) for(let x = 0; x < WC; x++, i++){
    if(level[i]) continue;
    const di = dist[i], w = di <= P.inflR ? Math.exp(-di / P.inflLambda) : 0;
    const u = rand(), pr = w > 0 ? P.farRandomP * Math.pow(1 - w, P.randomPow) : P.farRandomP;
    if(u < pr){   // re-randomise from the starting canvas, within ±farJitter
      const k = (u / pr * K) | 0;
      let jx = x + OX[k], jy = y + OY[k]; jx = jx < 0 ? 0 : jx >= WC ? WC - 1 : jx; jy = jy < 0 ? 0 : jy >= WR ? WR - 1 : jy;
      const j = jy * WC + jx;
      if(R[i] !== H0.R[j] || G[i] !== H0.G[j] || B[i] !== H0.B[j]){ R[i] = H0.R[j]; G[i] = H0.G[j]; B[i] = H0.B[j]; if(onSet) onSet(i, j); }
      randomised++; continue;
    }
    if(w <= 0) continue;
    const s = src[i], k = (P.shadeMin + (P.shadeMax - P.shadeMin) * cellHash(i)) * (P.shadeFar + (1 - P.shadeFar) * w), t = P.inflT * w;
    const nr = cl(Math.round(R[i] + (SR[s] * k - R[i]) * t)), ng = cl(Math.round(G[i] + (SG[s] * k - G[i]) * t)), nb = cl(Math.round(B[i] + (SB[s] * k - B[i]) * t));
    if(nr !== R[i] || ng !== G[i] || nb !== B[i]){ R[i] = nr; G[i] = ng; B[i] = nb; if(onSet) onSet(i, -1); }
    pulled++;
  }
  return { randomised, pulled, dist };
}
