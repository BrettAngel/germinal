// PROTOTYPE (variant B branch) — "Dream it": a short, labelled vision played
// on the visitor's ACTUAL canvas, then withdrawn. Pure helpers (shared by the
// app and the unit tests). Copy: /workspace/germinal/team/dream_copy.md.
//
// The vision runs the REAL mechanics on the visitor's canvas (real lassos,
// real engine generations), sped up; the app snapshots the canvas and its
// state first and restores them exactly at the end. snapshot/checksum/
// restore below prove that the real cells — colours, hold levels, loose
// flags — are exactly as they were. Nothing is saved to the server.

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
// The vision never draws a shape: this mask only softly biases WHICH real
// neighbouring cells the dream lassoes next (chooseCycleTargets).
export const EYE_ALMOND = 0.34, EYE_PUPIL = 0.17;   // eye: almond half-height, pupil radius (in −1..1 units)
// A hole the dream must keep open (never lassoed): the eye's pupil, as a
// circle in box-cell units (centre at S/2, S/2, like the mask's u = v = 0).
export function formHole(form, S){ return form === 'eye' ? { cx: S / 2, cy: S / 2, r: EYE_PUPIL * S / 2 } : null; }
// Per-form tuning of the same real growth:
//   starts: where the first lassos go (fractions of S from the centre) and how many;
//           the eye starts on both sides of the pupil so it grows around it
//   fill:   pull toward unreached parts of the form (the eye's thin almond needs more)
export function formTuning(form){
  // eye: just outside the pupil's keep-out (±0.135·S ≈ 10 cells), small windows, so the first picks stay in the deep-zoom view on a phone
  return form === 'eye' ? { starts: [{ dx: -0.135, dy: 0, n: 2, win: 6 }, { dx: 0.135, dy: 0, n: 2, win: 6 }], fill: 1.6 }
                        : { starts: [{ dx: 0, dy: 0, n: 4 }], fill: 1.0 };
}

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
      // a wide, flat almond (half-height 0.34 at the centre) with an open pupil (EYE_PUPIL)
      const inAlmond = Math.abs(u) < 0.98 && Math.abs(v) <= EYE_ALMOND * (1 - u * u);
      a = inAlmond && !(Math.hypot(u, v) < EYE_PUPIL) ? 1 : 0;
    } else {                                                                     // wave: the sea under a crest
      a = (v >= 0.15 * Math.sin(u * 3.2) - 0.05 && v <= 0.55 && Math.abs(u) <= 0.92) ? 1 : 0;
    }
    m[y * S + x] = a;
  }
  return m;
}

// ── the dream's own moves: real selection + real Evolve, sped up ──
// The vision never paints a picture. It lassoes REAL cells on the canvas
// (the app's applyLasso: real holds) and presses the REAL Evolve (nextGen:
// one engine generation) a few times, faster each time; a cluster of
// red-ish pixels grows outward, cycle by cycle, into a rough form. Afterwards
// the app restores the canvas and its state exactly (snapshot below).

// Timeline (seconds; the dream clock pauses while an engine generation runs,
// so on a slow phone the wall-clock length grows by the generation time).
// Normal: zoom in → lasso a few scattered red-ish pixels → 6 accelerating
// cycles of (lasso a few more neighbours → Evolve) → step back → fade.
// Reduced motion: still cuts, 4 cycles, ~7 s.
export const DREAM_TIMING = {
  normal: { zin: 2.2, picks: 2.6, cycles: [1.5, 1.25, 1.05, 0.88, 0.74, 0.62], loops: [2, 3, 3, 4, 5, 6], zout: 1.3, hold: 0.8, fade: 1.0 },
  reduced: { zin: 0, picks: 1.6, cycles: [1.0, 0.9, 0.8, 0.7], loops: [3, 3, 3, 4], zout: 0, hold: 1.4, fade: 0.5 },
};
export const LOOP_SHARE = 0.72;   // of each cycle: lassos first, then the pointer goes to Evolve and presses
export function dreamTimeline(reduced = false){
  const T = reduced ? DREAM_TIMING.reduced : DREAM_TIMING.normal;
  let t = 0; const zin = [t, t += T.zin], pick = [t, t += T.picks], cycles = [];
  T.cycles.forEach((dur, k) => { const t0 = t; t += dur;
    cycles.push({ k, t0, t1: t, dur, loops: T.loops[k], loopEnd: t0 + dur * LOOP_SHARE, press: t0 + dur * (reduced ? 0.8 : 0.86) }); });
  const zout = [t, t += T.zout], hold = [t, t += T.hold], fade = [t, t += T.fade];
  return { zin, pick, cycles, zout, hold, fade, end: t };
}

// How close a pixel is to a colour family, 0..1: hue within 40° of `hc`,
// saturated, not too dark. The love theme's family is red (hc 355°).
export function familyScore(r, g, b, hc = 355){
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if(mx < 28 || d < 14) return 0;
  let h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  const off = Math.min(Math.abs(h - hc), 360 - Math.abs(h - hc));
  return Math.max(0, 1 - off / 40) * (d / mx) * Math.min(1, mx / 120);
}
export const redness = (r, g, b) => familyScore(r, g, b, 355);
// the 4 hue bins (of 12) nearest a family hue, nearest first
export function binsNear(hc){
  const dist = k => { const c = k * 30 + 15, x = Math.abs(c - hc) % 360; return Math.min(x, 360 - x); };
  return Array.from({ length: 12 }, (_, k) => k).sort((a, b) => dist(a) - dist(b)).slice(0, 4);
}
// The theme's colour family on this canvas: red for love, otherwise the
// commonest saturated hue (sampled sparsely).
export function themeFamilyHue({ theme, rgb, WT, step = 97 }){
  if(String(theme || '').toLowerCase() === 'love') return 355;
  const bins = new Float64Array(12);
  for(let i = 0; i < WT; i += step){ const [r, g, b] = rgb(i), k = hueBin(r, g, b); if(k >= 0){ const mx = Math.max(r, g, b); bins[k] += (mx - Math.min(r, g, b)) / mx; } }
  let bi = 0; for(let k = 1; k < 12; k++) if(bins[k] > bins[bi]) bi = k;
  return bins[bi] > 0 ? bi * 30 + 15 : 355;
}

// Box size per form so every form has about as many cells as a 44-cell
// heart (~1,140): a leaf or wave in the same box is half the size and the
// growth would swamp it.
const _sizeCache = new Map();
export function formSize(form, base = 44){
  const key = form + ':' + base; if(_sizeCache.has(key)) return _sizeCache.get(key);
  const area = f => { let n = 0; for(const v of formMask(f, base)) n += v; return n; };
  const S = Math.round(base * Math.sqrt(area('heart') / Math.max(1, area(form))));
  _sizeCache.set(key, S); return S;
}

// Which form this play grows: heart first for love (the first visit),
// then each later play / "Dream again" rotates heart → leaf → wave (ROTATION).
// The eye is out of the rotation: after two attempts (open pupil, wide flat
// almond, two- and four-sided starts, rim pull) its real growth still read as
// two lumps beside a dark gap, not an eye. It stays drawable (tests, opts.form).
export const ROTATION = ['heart', 'leaf', 'wave'];
export function nextForm({ last = null, theme = '' } = {}){
  if(last && FORMS.includes(last)){ let k = FORMS.indexOf(last);
    do { k = (k + 1) % FORMS.length; } while(!ROTATION.includes(FORMS[k]));
    return FORMS[k]; }
  if(String(theme).toLowerCase() === 'love' || !theme) return 'heart';
  let h = 0; for(const ch of String(theme)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ROTATION[Math.abs(h) % ROTATION.length];
}

// Cheap guard against a run that ends with almost no form: try a few
// regions (each far from the last dream) and keep the one with the most
// family-coloured cells around the start (dense) and over the form (sparse).
export function chooseDreamRegion({ rand, last = null, S, WC, WR, rgb, hue = 355, tries = 12, win = 16, margin = 40 }){
  let best = null;
  for(let k = 0; k < tries; k++){
    const g = chooseRegion({ rand, last, S: S + margin, WC, WR });
    let nw = 0, fw = 0, nb = 0, fb = 0;
    for(let y = g.fy - (win >> 1); y < g.fy + (win >> 1); y++) for(let x = g.fx - (win >> 1); x < g.fx + (win >> 1); x++){ nw++; if(familyScore(...rgb(y * WC + x), hue) > 0.3) fw++; }
    for(let y = g.fy - (S >> 1); y < g.fy + (S >> 1); y += 4) for(let x = g.fx - (S >> 1); x < g.fx + (S >> 1); x += 4){ nb++; if(familyScore(...rgb(y * WC + x), hue) > 0.3) fb++; }
    const score = 0.6 * fw / nw + 0.4 * fb / nb;
    if(!best || score > best.score) best = { fx: g.fx, fy: g.fy, score: +score.toFixed(3), startFamily: +(fw / nw).toFixed(3) };
  }
  return { ...best, tries };
}
export const RED_BINS = [11, 0, 10, 1];   // hue bins nearest red, best first

// Where the next few lassos go: unheld REAL cells within `ring` cells of the
// cluster's edge, scored by family colour (red for love) × a soft form bias plus noise (so the
// growth is imperfect and lopsided), spread at least `minSep` apart.
//   cluster: cell indices held by the dream so far; isHeld(i): real hold now
//   mask/S/fx/fy: the form silhouette (S×S) centred on cell (fx, fy)
export function chooseCycleTargets({ rgb, isHeld, cluster, WC, WR, mask, S, fx, fy, ring = 3, count = 3,
  minSep = 3, rand = Math.random, bias = 1.2, noise = 0.3, fill = 0, hue = 355, hole = null, loopR = 0 }){
  const inC = new Set(cluster), seen = new Set(), cand = [];
  const X0 = fx - (S >> 1), Y0 = fy - (S >> 1);
  // hole (box-cell units): no loop of radius loopR (with its wobble, ≤ 1.25·r) around a target may reach it
  const hx = hole ? X0 + hole.cx : 0, hy = hole ? Y0 + hole.cy : 0;
  const inForm = i => { const x = i % WC - X0, y = ((i / WC) | 0) - Y0; return x >= 0 && y >= 0 && x < S && y < S ? mask[y * S + x] : 0; };
  for(const c of cluster){
    const cx = c % WC, cy = (c / WC) | 0;
    // only edge cells of the cluster seed candidates
    if(inC.has(c - 1) && inC.has(c + 1) && inC.has(c - WC) && inC.has(c + WC)) continue;
    for(let dy = -ring; dy <= ring; dy++){ const y = cy + dy; if(y < 0 || y >= WR) continue;
      for(let dx = -ring; dx <= ring; dx++){ const x = cx + dx; if(x < 0 || x >= WC) continue;
        const i = y * WC + x; if(seen.has(i)) continue; seen.add(i);
        if(isHeld(i)) continue;
        // near the hole the loop shrinks so it can't reach it (wobble ≤ 1.25·r); too close: not a target
        let tr = loopR;
        if(hole){ const room = (Math.hypot(x + 0.5 - hx, y + 0.5 - hy) - hole.r - 0.75) / 1.25; if(room < 1.2) continue; if(room < tr) tr = room; }
        const [r, g, b] = rgb(i), red = familyScore(r, g, b, hue), f = inForm(i);
        // fill: a pull toward parts of the form nobody has reached yet (open form cells around it)
        let need = 0;
        if(fill) for(let oy = -2; oy <= 2; oy++) for(let ox = -2; ox <= 2; ox++){ const nx = x + ox * ring, ny = y + oy * ring;
          if(nx < 0 || ny < 0 || nx >= WC || ny >= WR) continue; const j = ny * WC + nx; if(inForm(j) && !isHeld(j)) need++; }
        cand.push({ i, red, inForm: f, r: tr, score: red * (1 + bias * f) + fill * need / 25 + noise * rand() + 0.08 * f });
      } }
  }
  cand.sort((a, b) => b.score - a.score);
  const out = [];
  for(const c of cand){
    if(out.length >= count) break;
    const x = c.i % WC, y = (c.i / WC) | 0;
    if(out.some(o => Math.max(Math.abs(o.i % WC - x), Math.abs(((o.i / WC) | 0) - y)) < minSep)) continue;
    out.push(c);
  }
  return out;
}

// A hand-drawn closed loop around cell (cx, cy): radius r cells, wobbly and a
// bit squashed, in world-cell coordinates (cell centres at .5).
export function loopPoints(cx, cy, r, rand = Math.random, n = 26){
  const ph = rand() * Math.PI * 2, sq = 0.82 + rand() * 0.3, rot = rand() * Math.PI, out = [];
  for(let k = 0; k <= n; k++){
    const a = ph + (k / n) * Math.PI * 2 * 1.04;              // overshoots a little, like a hand
    const rr = r * (1 + 0.14 * Math.sin(3 * a + rot) + 0.08 * (rand() - 0.5));
    const ux = Math.cos(a) * rr, uy = Math.sin(a) * rr * sq;
    out.push({ x: cx + 0.5 + ux * Math.cos(rot) - uy * Math.sin(rot), y: cy + 0.5 + ux * Math.sin(rot) + uy * Math.cos(rot) });
  }
  return out;
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
export function pickScattered({ rgb, WC, x0, y0, w, h, maxPicks = 5, minGap = 3, prefer = null, exclude = null }){
  const bins = Array.from({ length: 12 }, () => []);
  for(let y = y0; y < y0 + h; y++) for(let x = x0; x < x0 + w; x++){
    const i = y * WC + x; if(exclude && exclude(i)) continue;
    const [r, g, b] = rgb(i), k = hueBin(r, g, b);
    if(k >= 0) bins[k].push(i);
  }
  let bi = 0; for(let k = 1; k < 12; k++) if(bins[k].length > bins[bi].length) bi = k;
  // prefer: hue bins to use first (e.g. RED_BINS), the most common of them that has ≥ 2 pixels
  if(prefer){ let pb = -1; for(const k of prefer) if(bins[k].length >= 2 && (pb < 0 || bins[k].length > bins[pb].length)) pb = k; if(pb >= 0) bi = pb; }
  let pool = bins[bi];
  if(pool.length < 2){                      // nothing coloured here: brightest pixels instead
    pool = [];
    for(let y = y0; y < y0 + h; y++) for(let x = x0; x < x0 + w; x++){ const i = y * WC + x; if(!(exclude && exclude(i))) pool.push(i); }
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
