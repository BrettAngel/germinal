// PROTOTYPE (variant B branch) — "Dream it": a short, labelled vision played
// on the visitor's ACTUAL canvas, then withdrawn. Pure helpers (shared by the
// app and the unit tests). Copy: /workspace/germinal/team/dream_copy.md.
//
// Nothing here writes to the visitor's canvas. The app paints the vision from
// a private buffer, and snapshot/checksum/restore below prove (and if ever
// needed, force) that the real cells — colours, hold levels, loose flags —
// are exactly as they were when the vision ends.

export const FORMS = ['heart', 'leaf', 'eye', 'wave'];          // dream_copy.md {form}
export const formWithArticle = f => (/^[aeiou]/.test(f) ? 'an ' : 'a ') + f;

// Copy (dream_copy.md primary lines; controls; persistent tag)
export const COPY = {
  tag: 'Vision · a demonstration',
  skip: 'Skip the vision',
  replay: 'See the vision again',
  dream: [
    'A vision, not made by visitors. Just what’s possible.',
    'In the beginning, darkness. Look closer.',
    'A few scattered points of one colour are chosen.',
    'What was chosen holds. Everything else keeps changing.',
    f => `Step back. In this vision, ${formWithArticle(f)}.`,
    'The vision lets go. The canvas is yours.',
  ],
  try: {
    invite: 'Your turn. What do you see in the dark?',
    lasso: 'Zoom in. Lasso a few pixels that belong together.',
    overCap: 'Too much at once. Over 8% this session scores nothing.',
    evolve: 'Press Evolve. What you chose will hold.',
    held: 'It held. Select it again to refine it.',
    pass: 'Pass it on. They’ll never see which parts you chose.',
  },
};

// Soft mask for a form in an S×S box: Float32Array(S*S), 0..1.
// Filled silhouettes only (no outlines, lids, rings or ribs): 1 inside, 0 outside.
// The vision never draws a shape: this mask only decides WHICH canvas-grid
// blocks are held at each growth level (see blockForm / blockColour).
export function formMask(form, S){
  const m = new Float32Array(S * S);
  for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;   // −1..1, v down
    let a = 0;
    if(form === 'heart'){
      const X = u * 1.25, Y = -(v * 1.25) + 0.15;
      a = (Math.pow(X * X + Y * Y - 1, 3) - X * X * Y * Y * Y) <= 0 ? 1 : 0;
    } else if(form === 'leaf'){
      const c = Math.cos(-0.6), s = Math.sin(-0.6), X = u * c - v * s, Y = u * s + v * c;
      a = (Math.abs(X) < 0.95 && Math.abs(Y) <= 0.42 * (1 - X * X)) ? 1 : 0;   // almond blade
      if(Math.abs(Y) < 0.035 && X >= 0.9 && X < 1.05) a = 1;                    // stem (part of the fill)
    } else if(form === 'eye'){
      const inAlmond = Math.abs(u) < 0.98 && Math.abs(v) <= 0.5 * (1 - u * u);
      const r = Math.hypot(u, v);
      a = inAlmond && !(r < 0.16) ? 1 : 0;                                       // almond with an open pupil
    } else {                                                                     // wave: the sea under a crest
      a = (v >= 0.15 * Math.sin(u * 3.2) - 0.05 && v <= 0.55 && Math.abs(u) <= 0.92) ? 1 : 0;
    }
    m[y * S + x] = a;
  }
  return m;
}

// Per-cell dither of a mask's boundary: each cell samples the mask at a hashed
// offset of up to ±j cells. Only cells within j of the boundary can change, so
// the rest are copied (cheap enough to run mid-animation on a phone).
export function jitterMask(mask, S, X0, Y0, j){
  const jm = new Float32Array(mask), J = Math.ceil(j);
  for(let y = 0; y < S; y++){ const row = y * S;
    for(let x = 0; x < S; x++){ const i = row + x, v = mask[i];
      const xl = x >= J ? i - J : row, xr = x + J < S ? i + J : row + S - 1, yu = y >= J ? i - J * S : x, yd = y + J < S ? i + J * S : (S - 1) * S + x;
      if(mask[xl] === v && mask[xr] === v && mask[yu] === v && mask[yd] === v) continue;   // far from the edge
      const h = cellHash(X0 + x, Y0 + y), dx = Math.round(((h & 255) / 255 * 2 - 1) * j), dy = Math.round((((h >>> 8) & 255) / 255 * 2 - 1) * j);
      const sx = Math.min(S - 1, Math.max(0, x + dx)), sy = Math.min(S - 1, Math.max(0, y + dy));
      jm[i] = mask[sy * S + sx];
    }
  }
  return jm;
}

// ── growth by subdivision: coarse blocks → fine, on the canvas's own grid ──
export const GROW_LEVELS = [16, 8, 4, 2, 1];   // block size in cells, one level per Evolve press

// Which cells of the S×S region (top-left X0,Y0 in world cells) are held at
// block size b: blocks are aligned to the WORLD grid, and a block is held when
// ≥ minFill of its in-region cells are inside the mask. Picks always hold.
export function blockForm(mask, S, X0, Y0, b, { minFill = 0.5, picks = [], jitter = 0, scatter = null } = {}){
  const on = new Uint8Array(S * S);
  // jitter > 0: each cell samples the mask at a hashed offset of up to ±jitter
  // cells, so the boundary is dithered per cell, never a perfectly smooth silhouette
  if(jitter > 0) mask = jitterMask(mask, S, X0, Y0, jitter);
  const ox = ((X0 % b) + b) % b, oy = ((Y0 % b) + b) % b;      // region offset inside the world block grid
  for(let by = -oy; by < S; by += b) for(let bx = -ox; bx < S; bx += b){
    let n = 0, inside = 0;
    const y0 = Math.max(0, by), y1 = Math.min(S, by + b), x0 = Math.max(0, bx), x1 = Math.min(S, bx + b);
    for(let y = y0; y < y1; y++) for(let x = x0; x < x1; x++){ n++; if(mask[y * S + x] > 0.5) inside++; }
    if(n && inside / n >= minFill) for(let y = y0; y < y1; y++) for(let x = x0; x < x1; x++) on[y * S + x] = 1;
  }
  // scatter (fine levels): near the boundary a few form cells sit just outside
  // and a few canvas cells just inside, falling off with distance, so the edge
  // reads as grown at phone scale (cells only, never a line)
  if(scatter) scatterEdge(on, S, X0, Y0, scatter);
  for(const li of picks) if(li >= 0 && li < S * S) on[li] = 1;
  return on;
}
// Chebyshev distance (in cells, capped at cap) from each cell to the nearest cell
// whose state differs: two-pass chamfer, O(S²), cheap enough per growth level.
function edgeDistance(on, S, cap){
  const d = new Uint8Array(S * S).fill(cap);
  for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ const i = y * S + x, v = on[i];
    if((x > 0 && on[i - 1] !== v) || (x < S - 1 && on[i + 1] !== v) || (y > 0 && on[i - S] !== v) || (y < S - 1 && on[i + S] !== v)) d[i] = 1; }
  for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){ const i = y * S + x; let m = d[i];
    if(x > 0) m = Math.min(m, d[i - 1] + 1); if(y > 0){ m = Math.min(m, d[i - S] + 1); if(x > 0) m = Math.min(m, d[i - S - 1] + 1); if(x < S - 1) m = Math.min(m, d[i - S + 1] + 1); } d[i] = m; }
  for(let y = S - 1; y >= 0; y--) for(let x = S - 1; x >= 0; x--){ const i = y * S + x; let m = d[i];
    if(x < S - 1) m = Math.min(m, d[i + 1] + 1); if(y < S - 1){ m = Math.min(m, d[i + S] + 1); if(x < S - 1) m = Math.min(m, d[i + S + 1] + 1); if(x > 0) m = Math.min(m, d[i + S - 1] + 1); } d[i] = m; }
  return d;
}
export function scatterEdge(on, S, X0, Y0, { R = 5, pOut = 0.22, pIn = 0.16 } = {}){
  const dist = edgeDistance(on, S, R + 1);
  for(let i = 0; i < S * S; i++){
    const dd = dist[i]; if(dd > R) continue;
    const x = i % S, y = (i / S) | 0, h = cellHash(X0 + x + 7919, Y0 + y + 104729), u = (h & 65535) / 65535, fall = 1 - (dd - 1) / R;
    if(on[i] ? u < pIn * fall * fall : u < pOut * fall * fall) on[i] = on[i] ? 0 : 1;
  }
  return on;
}

// The vision's colours start from real canvas colours of the picked colour
// family, sampled from the region's actual cells and sorted most vivid first
// (saturation × brightness). No blending: each block/cell takes ONE sampled cell.
export const vividness = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx * mx : 0; };
export function familyPalette(orig, S, colour, { max = 512 } = {}){
  const hb = hueBin(colour[0], colour[1], colour[2]);
  const fam = [];
  for(let li = 0; li < S * S; li++){
    const r = orig[li * 3], g = orig[li * 3 + 1], b = orig[li * 3 + 2];
    if(hb >= 0 ? hueBin(r, g, b) === hb : Math.abs(r - colour[0]) + Math.abs(g - colour[1]) + Math.abs(b - colour[2]) < 40) fam.push([r, g, b]);
  }
  if(fam.length < 8) return [colour.map(v => Math.round(v))];
  fam.sort((p, q) => vividness(q) - vividness(p));
  const step = Math.max(1, Math.floor(fam.length / max)), out = [];
  for(let k = 0; k < fam.length && out.length < max; k += step) out.push(fam[k]);
  return out;
}
export function cellHash(gx, gy){ return Math.imul((gx + 1) * 73856093 ^ (gy + 1) * 19349663, 0x9E3779B1) >>> 0; }

// Index of the sampled cell for the block whose world origin is (gx,gy). A
// sub-block that shares its parent's origin keeps the parent's sample.
export function blockColour(pal, gx, gy){ return pal[cellHash(gx, gy) % pal.length]; }

// Level k of n (0 = coarse 16-cell blocks … n−1 = single cells): more defined
// each step, but always PIXELS. The sample pool narrows to the family's most
// vivid cells, the hue is pulled toward the family hue, saturation rises to a
// cap (~0.92, never a flat pure colour) and brightness rises. Every cell keeps
// its own jitter: hue ±HUE_J°, saturation ±0.03 and brightness up to −VAR, so
// individual pixels stay readable on a phone. One sampled cell each, no blending.
export const LEVEL_TUNE = { sat0: 0.78, sat1: 0.92, T0: 120, T1: 110, hueJ: 5, satJ: 0.03, variation: 0.3 };
const rgb2hsv = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if(d){ h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if(h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx]; };
function hsv2rgb(h, s, v, out){
  h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b; if(h < 60){ r = c; g = x; b = 0; } else if(h < 120){ r = x; g = c; b = 0; } else if(h < 180){ r = 0; g = c; b = x; }
  else if(h < 240){ r = 0; g = x; b = c; } else if(h < 300){ r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  out[0] = Math.min(255, Math.round(r + m)); out[1] = Math.min(255, Math.round(g + m)); out[2] = Math.min(255, Math.round(b + m)); return out;
}
const hueLerp = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };
// the level's base (hue, saturation) for one sampled cell
function levelBase(c, famHue, s, tune){
  const [h, sat] = rgb2hsv(c);
  return [hueLerp(h, famHue, s), Math.min(sat, tune.sat0) + (tune.sat1 - Math.min(sat, tune.sat0)) * s];
}
function cellColour(h, sat, s, tune, hash, out){
  const u1 = ((hash >>> 16) & 255) / 255, u2 = ((hash >>> 8) & 255) / 255, u3 = (hash & 255) / 255;
  const v = (tune.T0 + tune.T1 * s) * (1 - tune.variation * u1);
  return hsv2rgb(h + (u2 * 2 - 1) * tune.hueJ, Math.min(0.96, Math.max(0, sat + (u3 * 2 - 1) * tune.satJ)), v, out);
}
const poolSize = (n, s) => Math.max(1, Math.floor(n * (0.6 - 0.5 * s)));     // 60% → 10% most vivid
export function levelColour(pal, gx, gy, k, n, { own = null, tune = LEVEL_TUNE } = {}){
  const s = n > 1 ? k / (n - 1) : 1, h = cellHash(gx, gy);
  const c = own || pal[h % poolSize(pal.length, s)];
  const [bh, bs] = levelBase(c, rgb2hsv(pal[0])[0], s, tune);
  return cellColour(bh, bs, s, tune, Math.imul(h, 2654435761) >>> 0, [0, 0, 0]);
}
// Fast path for the UI: the same colours from a per-level table of the pool.
export function levelTable(pal, k, n, { tune = LEVEL_TUNE } = {}){
  const s = n > 1 ? k / (n - 1) : 1, pool = poolSize(pal.length, s), fh = rgb2hsv(pal[0])[0];
  const H = new Float32Array(pool), Sa = new Float32Array(pool);
  for(let q = 0; q < pool; q++){ const [bh, bs] = levelBase(pal[q], fh, s, tune); H[q] = bh; Sa[q] = bs; }
  return { pool, H, Sa, s, tune };
}
export function levelColourFast(tb, gx, gy, out){
  const h = cellHash(gx, gy), q = h % tb.pool;
  return cellColour(tb.H[q], tb.Sa[q], tb.s, tb.tune, Math.imul(h, 2654435761) >>> 0, out);
}

// Numbers for "better means more defined": mean HSV saturation and luminance
// of the form's cells vs the surrounding canvas; contrast = mean brightness
// (HSV value, the max channel) inside ÷ outside, lumContrast = luminance ratio.
export function formContrast(on, colourAt, orig, S){
  let si = 0, li = 0, ni = 0, lo = 0, no = 0, so = 0, vi = 0, vo = 0;
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b, sat = (r, g, b) => { const mx = Math.max(r, g, b); return mx ? (mx - Math.min(r, g, b)) / mx : 0; };
  for(let i = 0; i < S * S; i++){
    if(on[i]){ const c = colourAt(i); si += sat(c[0], c[1], c[2]); li += lum(c[0], c[1], c[2]); vi += Math.max(c[0], c[1], c[2]); ni++; }
    else { const r = orig[i * 3], g = orig[i * 3 + 1], b = orig[i * 3 + 2]; so += sat(r, g, b); lo += lum(r, g, b); vo += Math.max(r, g, b); no++; }
  }
  const satIn = si / Math.max(1, ni), lumIn = li / Math.max(1, ni), lumOut = lo / Math.max(1, no), satOut = so / Math.max(1, no);
  return { satIn: +satIn.toFixed(3), satOut: +satOut.toFixed(3), lumIn: +lumIn.toFixed(1), lumOut: +lumOut.toFixed(1),
    vIn: +(vi / Math.max(1, ni)).toFixed(1), vOut: +(vo / Math.max(1, no)).toFixed(1),
    contrast: +((vi / Math.max(1, ni)) / Math.max(1, vo / Math.max(1, no))).toFixed(3),        // brightness (HSV value) in ÷ out
    lumContrast: +(lumIn / Math.max(1, lumOut)).toFixed(3), cells: ni };
}

// A centre for the form, far from the previous one (so each dream is elsewhere).
export function chooseRegion({ rand, last = null, S, WC, WR, minDist = 0.28 }){
  const mx = Math.ceil(S / 2) + 6, my = Math.ceil(S / 2) + 6;
  let best = null, bestD = -1;
  for(let k = 0; k < 40; k++){
    const fx = mx + Math.floor(rand() * Math.max(1, WC - 2 * mx)), fy = my + Math.floor(rand() * Math.max(1, WR - 2 * my));
    const d = last ? Math.hypot(fx - last.fx, fy - last.fy) / WC : 1;
    if(d >= minDist) return { fx, fy };
    if(d > bestD){ bestD = d; best = { fx, fy }; }
  }
  return best;
}
export function chooseForm(rand, lastForm = null){
  const opts = FORMS.filter(f => f !== lastForm);
  return opts[Math.floor(rand() * opts.length) % opts.length];
}

// Hue bin (12 bins) of a coloured pixel, or −1 for near-black / grey.
export function hueBin(r, g, b){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if(mx < 28 || mx - mn < 14) return -1;
  let h; const d = mx - mn;
  if(mx === r) h = ((g - b) / d + 6) % 6; else if(mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return Math.floor(h * 2) % 12;
}
// Scattered pixels of ONE colour in a window: the most common hue at that
// spot (the visitor's own colour there), with clear gaps (≥ minGap cells,
// Chebyshev) between picks; ordered as a short path from the window centre.
export function pickScattered({ rgb, WC, x0, y0, w, h, maxPicks = 5, minGap = 3 }){
  const bins = Array.from({ length: 12 }, () => []);
  for(let y = y0; y < y0 + h; y++) for(let x = x0; x < x0 + w; x++){
    const i = y * WC + x, [r, g, b] = rgb(i), k = hueBin(r, g, b);
    if(k >= 0) bins[k].push(i);
  }
  let bi = 0; for(let k = 1; k < 12; k++) if(bins[k].length > bins[bi].length) bi = k;
  let pool = bins[bi];
  if(pool.length < 2){                      // nothing coloured here: brightest pixels instead
    pool = [];
    for(let y = y0; y < y0 + h; y++) for(let x = x0; x < x0 + w; x++) pool.push(y * WC + x);
    pool.sort((a, b) => { const A = rgb(a), B = rgb(b); return (B[0] + B[1] + B[2]) - (A[0] + A[1] + A[2]); });
    pool = pool.slice(0, 60); bi = -1;
  }
  const cx = x0 + w / 2, cy = y0 + h / 2, picks = [];
  const left = pool.slice();
  let px = cx, py = cy;
  while(picks.length < maxPicks && left.length){
    let bj = -1, bd = 1e9;
    for(let j = 0; j < left.length; j++){
      const x = left[j] % WC, y = (left[j] / WC) | 0;
      if(picks.some(p => Math.max(Math.abs(p % WC - x), Math.abs(((p / WC) | 0) - y)) < minGap)) continue;
      const d = Math.hypot(x - px, y - py) + (picks.length === 0 ? 0 : 0);
      if(d < bd){ bd = d; bj = j; }
    }
    if(bj < 0) break;
    const p = left.splice(bj, 1)[0]; picks.push(p); px = p % WC; py = (p / WC) | 0;
  }
  let R = 0, G = 0, B = 0; for(const p of picks){ const c = rgb(p); R += c[0]; G += c[1]; B += c[2]; }
  const n = Math.max(1, picks.length);
  return { picks, hue: bi, colour: [R / n, G / n, B / n] };
}
// Brighten a colour hue-preservingly to max channel `target` (glow, as in the engine).
export function brighten([r, g, b], target = 210){
  const mx = Math.max(r, g, b, 1), k = target / mx;
  return [Math.min(255, r * k), Math.min(255, g * k), Math.min(255, b * k)];
}

// ── exact snapshot / restore of the visitor's canvas ({c, s, w} cells) ──
export function snapshotCells(cells){
  const n = cells.length, c = new Array(n), s = new Uint8Array(n), w = new Uint8Array(n);
  for(let i = 0; i < n; i++){ const x = cells[i]; c[i] = x.c; s[i] = x.s | 0; w[i] = x.w ? 1 : 0; }
  return { c, s, w };
}
export function restoreCells(cells, snap){
  for(let i = 0; i < snap.c.length; i++) cells[i] = { c: snap.c[i], s: snap.s[i], w: snap.w[i] };
}
export function checksumCells(cells){
  let h1 = 0x811c9dc5 | 0, h2 = 0;
  for(let i = 0; i < cells.length; i++){
    const x = cells[i], c = x.c;
    for(let k = 1; k < 7; k++) h1 = Math.imul(h1 ^ c.charCodeAt(k), 16777619);
    h1 = Math.imul(h1 ^ ((x.s | 0) * 2 + (x.w ? 1 : 0)), 16777619);
    h2 = (h2 + (x.s | 0) * 3 + (x.w ? 1 : 0)) | 0;
  }
  return (h1 >>> 0).toString(16) + ':' + (h2 >>> 0).toString(16);
}

// ── "used the technique" (local adoption measure; see PR #6) ──
// lassos: [{ cells, cx, cy, hue, colour:[r,g,b], cellPx }] — non-erase lassos
// made after the hand-over, up to the first Evolve. hue = dominant hueBin of
// the loop's coloured cells (−1 if none); colour = their mean.
//   used = deepZoom && scattered && oneColour && evolved, where
//   small     = loops of ≤ 60 cells made at ≥ 8 screen px per cell (zoom ≥ 4)
//   deepZoom  = at least one loop made at ≥ 8 px per cell
//   scattered = ≥ 2 small loops whose centres are ≥ 4 cells apart (max pair)
//   oneColour = all small loops share a hue bin (±1 of 12, i.e. ±30°), or —
//               if none of them caught a coloured pixel — mean colours within L1 40
//   evolved   = Evolve pressed after those loops
export const TECH = { smallMax: 60, deepPx: 8, minSpread: 4, hueTol: 1, greyL1: 40, minSmall: 2 };
export function usedTechnique(lassos, evolved){
  const small = lassos.filter(l => l.cells > 0 && l.cells <= TECH.smallMax && l.cellPx >= TECH.deepPx);
  let scattered = false, oneColour = false;
  if(small.length >= TECH.minSmall){
    let spread = 0;
    for(let a = 0; a < small.length; a++) for(let b = a + 1; b < small.length; b++)
      spread = Math.max(spread, Math.hypot(small[a].cx - small[b].cx, small[a].cy - small[b].cy));
    scattered = spread >= TECH.minSpread;
    const hues = small.map(l => l.hue === undefined ? -1 : l.hue);
    if(hues.every(h => h >= 0)){
      const d = (a, b) => { const x = Math.abs(a - b) % 12; return Math.min(x, 12 - x); };
      oneColour = hues.every(h => hues.every(k => d(h, k) <= TECH.hueTol));
    } else if(hues.every(h => h < 0)){
      const ref = small[0].colour;
      oneColour = small.every(l => Math.abs(l.colour[0] - ref[0]) + Math.abs(l.colour[1] - ref[1]) + Math.abs(l.colour[2] - ref[2]) <= TECH.greyL1);
    }
  }
  const deepZoom = lassos.some(l => l.cellPx >= TECH.deepPx);
  return { deepZoom, smallLassos: small.length, scattered, oneColour, evolved: !!evolved,
           used: deepZoom && scattered && oneColour && !!evolved };
}
