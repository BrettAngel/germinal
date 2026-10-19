// PROTOTYPE (variant B branch) — "Dream it": a short, labelled vision played
// on the visitor's ACTUAL canvas, then withdrawn. Pure helpers (shared by the
// app and the unit tests). Copy: /workspace/germinal/team/dream_copy.md.
//
// The vision runs the REAL mechanics on the visitor's canvas (real lassos,
// real engine generations), sped up; the app snapshots the canvas and its
// state first and restores them exactly at the end. snapshot/checksum/
// restore below prove that the real cells — colours, hold levels, loose
// flags — are exactly as they were. Nothing is saved to the server.

export const FORMS = ['heart', 'leaf', 'eye', 'wave', 'flower', 'sun', 'tree', 'fish'];   // dream_copy.md {form} + the multi-colour forms

// ── multi-colour forms (Oct 18): parts of different hues, by selection only ──
// Each part is grown by the pointer choosing REAL cells of that part's hue in
// that part's region (first the centre/core/trunk/body, then the petals/rays/
// crown/tail); the engine does the rest. No colour is ever set: a form is only
// offered when the theme's palette contains every part's hue (formEligible).
// hues: preferred hues in degrees, first one the palette has wins.
export const FORM_PARTS = {
  flower: [{ name: 'centre', hues: [48, 32] }, { name: 'petals', hues: [345, 330, 200, 285] }],
  sun:    [{ name: 'core', hues: [48, 32] },   { name: 'rays', hues: [355, 15] }],
  tree:   [{ name: 'trunk', hues: [25] },      { name: 'crown', hues: [105, 120, 90] }],
  fish:   [{ name: 'body', hues: [200, 190, 215, 224] }, { name: 'tail', hues: [28, 48] }],
};
const ring = (n, rad, a0, q) => Array.from({ length: n }, (_, k) => { const a = (a0 + k * 360 / n) * Math.PI / 180; return { dx: rad / 2 * Math.cos(a), dy: rad / 2 * Math.sin(a), ...q }; });
// where each part's first picks go (fractions of S from the box centre; win = window in cells)
export const PART_STARTS = {
  flower: [[{ dx: 0, dy: 0, n: 3, win: 9 }], ring(6, 0.63, -90, { n: 1, win: 7 })],
  sun:    [[{ dx: 0, dy: 0, n: 4, win: 10 }], ring(6, 0.7, -90, { n: 1, win: 6 })],
  tree:   [[{ dx: 0, dy: 0.22, n: 2, win: 6 }, { dx: 0, dy: 0.4, n: 1, win: 6 }], [{ dx: -0.14, dy: -0.12, n: 1, win: 7 }, { dx: 0.14, dy: -0.12, n: 1, win: 7 }, { dx: 0, dy: -0.3, n: 1, win: 7 }]],
  fish:   [[{ dx: -0.075, dy: 0, n: 3, win: 10 }], [{ dx: 0.4, dy: -0.09, n: 1, win: 6 }, { dx: 0.4, dy: 0.09, n: 1, win: 6 }, { dx: 0.33, dy: 0, n: 1, win: 6 }]],
};
// part labels in an S×S box: 0 outside, k+1 inside part k (single-colour forms: 1 = the form)
export function formLabels(form, S){
  if(!FORM_PARTS[form]){ const m = formMask(form, S), L = new Uint8Array(S * S); for(let i = 0; i < m.length; i++) L[i] = m[i] > 0.5 ? 1 : 0; return L; }
  const L = new Uint8Array(S * S);
  for(let y = 0; y < S; y++) for(let x = 0; x < S; x++){
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
    let l = 0;
    if(form === 'flower'){
      if(r < 0.28) l = 1;
      else for(let k = 0; k < 6; k++){ const b = (-90 + k * 60) * Math.PI / 180, cx = 0.63 * Math.cos(b), cy = 0.63 * Math.sin(b);
        const du = u - cx, dv = v - cy, pr = du * Math.cos(b) + dv * Math.sin(b), pt = -du * Math.sin(b) + dv * Math.cos(b);
        if((pr / 0.36) ** 2 + (pt / 0.2) ** 2 <= 1){ l = 2; break; } }
    } else if(form === 'sun'){
      if(r < 0.36) l = 1;
      else if(r >= 0.5 && r <= 0.97){ let d = 1e9; for(let k = 0; k < 6; k++){ const b = (-90 + k * 60) * Math.PI / 180; d = Math.min(d, Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))); }
        if(d * r <= 0.12) l = 2; }   // rays ~0.24 wide
    } else if(form === 'tree'){
      if(Math.hypot(u, (v + 0.25) * 1.05) < 0.56) l = 2;
      else if(Math.abs(u) < 0.12 && v > 0.15 && v < 0.96) l = 1;
    } else if(form === 'fish'){
      if(((u + 0.15) / 0.6) ** 2 + (v / 0.34) ** 2 <= 1) l = 1;
      else if(u >= 0.38 && u <= 0.95 && Math.abs(v) <= (u - 0.38) * 0.85) l = 2;
    }
    L[y * S + x] = l;
  }
  return L;
}
// Lobes: the connected pieces of each part (each petal, each ray; the centre;
// the trunk; the crown), so the pointer can share its loops between them and
// the form grows evenly instead of only where it started. Returns
// { id: Uint8Array(S*S) 0 = none, lobes: [{ part, cells, cx, cy }] } (box cells).
export function formLobes(form, S){
  const L = formLabels(form, S), id = new Uint8Array(S * S), lobes = [];
  for(let i0 = 0; i0 < S * S; i0++){
    if(!L[i0] || id[i0]) continue;
    const q = [i0], lab = L[i0], k = lobes.length + 1; id[i0] = k; let n = 0, sx = 0, sy = 0;
    while(q.length){ const i = q.pop(), x = i % S, y = (i / S) | 0; n++; sx += x; sy += y;
      for(const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const nx = x + dx, ny = y + dy; if(nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const j = ny * S + nx; if(L[j] === lab && !id[j]){ id[j] = k; q.push(j); } } }
    lobes.push({ part: lab - 1, cells: n, cx: sx / n, cy: sy / n });
  }
  return { id, lobes };
}
// the palette's hues: '#rrggbb' or 'hsl(h,s%,l%)' → [{ h, s, v }] (HSV, s and v 0..1)
export function paletteHues(pal){
  const out = [];
  for(const c of pal || []){
    let r, g, b; const m = /^hsl\((\d+(?:\.\d+)?),\s*(\d+)%,\s*(\d+)%\)$/.exec(c);
    if(m){ const h = +m[1], S = +m[2] / 100, L = +m[3] / 100, C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs((h / 60) % 2 - 1)), M = L - C / 2;
      const [a, bb, cc] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
      r = (a + M) * 255; g = (bb + M) * 255; b = (cc + M) * 255; }
    else if(/^#[0-9a-f]{6}$/i.test(c)){ r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16); }
    else continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if(!d){ out.push({ h: 0, s: 0, v: mx / 255 }); continue; }
    let h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    out.push({ h: h * 60, s: d / mx, v: mx / 255 });
  }
  return out;
}
const hueDist = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
export const paletteHas = (pal, hue, tol = 25) => paletteHues(pal).some(c => c.s >= 0.35 && c.v >= 0.25 && hueDist(c.h, hue) <= tol);
// The parts this play grows, each with the hue it selects for, or null when the
// palette lacks a part's hue (then the form is not offered on this theme).
// Single-colour forms: one part in the theme's family hue.
export function resolveParts(form, pal, familyHue = 355, prefer = null){   // prefer: { partName: [hues] } (tests / evaluation only)
  if(!FORM_PARTS[form]) return [{ name: form, hue: familyHue, label: 1, starts: formTuning(form).starts }];
  const out = [];
  for(const [k, p] of FORM_PARTS[form].entries()){
    const hue = ((prefer && prefer[p.name]) || p.hues).find(h => paletteHas(pal, h)); if(hue == null) return null;
    if(out.some(o => hueDist(o.hue, hue) < 40)) return null;   // two parts must be visibly different hues
    out.push({ name: p.name, hue, label: k + 1, starts: PART_STARTS[form][k] });
  }
  return out;
}
export const formEligible = (form, pal) => !FORM_PARTS[form] || !!resolveParts(form, pal);
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
  // multi-colour forms: caption 2 (the picks of the first part, then the second)
  dreamMulti: 'A few points of one colour are chosen, then points of another.',
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
  if(FORM_PARTS[form]){ const L = formLabels(form, S), m = new Float32Array(S * S); for(let i = 0; i < L.length; i++) m[i] = L[i] ? 1 : 0; return m; }
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
// Every cycle is: lasso (cycle 0: the first few scattered picks; then one
// loop in the grown zone of influence), the pointer travels to Evolve, taps
// it, and the engine runs one generation. The first `ease.length` Evolves
// ease the old canvas into the new over `ease[k]` s, so the gradient reads;
// later cycles accelerate (each shorter than the last).
export const DREAM_TIMING = {
  // Oct 18 evening: config C (DREAM_CONFIGS below): 28 Evolves, ~2.5x the loops, ~19.4 s
  normal: { zin: 2.0, cycles: [2.1, 1.9, 1.0, 0.9, 0.8, 0.72, 0.65, 0.6, 0.55, 0.5, 0.46, 0.43, 0.4, 0.37, 0.35, 0.33, 0.31, 0.3,
                               0.28, 0.26, 0.24, 0.22, 0.21, 0.2, 0.19, 0.18, 0.17, 0.16],
            loops: [0, 1, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], travel: [0.35, 0.3], ease: [0.65, 0.65], zout: 1.2, hold: 0.7, fade: 0.7 },
  reduced: { zin: 0, cycles: [1.6, 1.2, 0.9, 0.8, 0.7, 0.65, 0.6], loops: [0, 1, 1, 1, 1, 1, 1], travel: [], ease: [], zout: 0, hold: 1.4, fade: 0.5 },
};
// Oct 18 (Brett: "like B-cell affinity maturation, selection compounding over
// many generations"): configurations evaluated headless; see PR #6.
//   A: ~30 Evolves, the same picks per round   B: 18 Evolves, ~2.5x the loops per round
//   C: both (28 Evolves, more loops). Later Evolves are fast (down to 0.15 s).
const BASE18 = { cycles: [2.1, 1.9, 1.0, 0.9, 0.8, 0.72, 0.65, 0.6, 0.55, 0.5, 0.46, 0.43, 0.4, 0.37, 0.35, 0.33, 0.31, 0.3],
                 loops: [0, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2] };
const TAIL12 = [0.28, 0.26, 0.24, 0.22, 0.21, 0.2, 0.19, 0.18, 0.17, 0.16, 0.155, 0.15];
const MORE18 = [0, 1, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 6, 6, 5, 5, 5, 5];
export const DREAM_CONFIGS = {
  base: BASE18,
  A: { cycles: BASE18.cycles.concat(TAIL12), loops: BASE18.loops.concat(TAIL12.map(() => 2)) },
  B: { cycles: BASE18.cycles, loops: MORE18 },
  C: { cycles: BASE18.cycles.concat(TAIL12.slice(0, 10)), loops: MORE18.concat(TAIL12.slice(0, 10).map(() => 4)) },
};
export const TRAVEL_SHARE = 0.25, POST_SHARE = 0.15;   // later cycles: share of the cycle spent travelling to Evolve / after the tap
// loops: 0 = "the first picks" (as many as were found). A multi-colour form has
// one pick cycle per part (picks = [n0, n1]): its first colour, then the next.
export function dreamTimeline(reduced = false, picks = 4, parts = 1, config = null){   // config: a DREAM_CONFIGS key (evaluation / tests)
  const T = reduced ? DREAM_TIMING.reduced : (config && DREAM_CONFIGS[config] ? { ...DREAM_TIMING.normal, ...DREAM_CONFIGS[config] } : DREAM_TIMING.normal), pickN = k => Array.isArray(picks) ? (picks[k] ?? 1) : picks;
  let t = 0; const zin = [t, t += T.zin], cycles = [];
  T.cycles.forEach((dur, k) => { const t0 = t; t += dur;
    const easeS = T.ease[k] || 0, post = easeS || dur * POST_SHARE, travel = T.travel[k] ?? dur * (reduced ? 0.2 : TRAVEL_SHARE);
    const press = t - post, loopEnd = press - travel;
    const isPick = k < Math.max(1, parts) || !T.loops[k];
    cycles.push({ k, t0, t1: t, dur, loops: isPick ? pickN(k) : T.loops[k], phase: isPick ? 'pick' : 'cycle', part: isPick ? k : null, loopEnd, press, ease: easeS }); });
  const pick = [cycles[0].t0, cycles[0].loopEnd];
  const zout = [t, t += T.zout], hold = [t, t += T.hold], fade = [t, t += T.fade];
  return { zin, pick, cycles, zout, hold, fade, end: t };
}

// One loop per cycle after the picks, growing in screen px across the cycles
// while the view eases out from zD to zC; returns the radius in cells.
export const LOOP_PX = [22, 36];
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export function cycleLoopR(k, n, zD, zC, CS = 2){
  const u = n > 2 ? (k - 1) / (n - 2) : 1, zk = Math.exp(Math.log(zD) + (Math.log(zC) - Math.log(zD)) * easeIO(u));
  return Math.max(1.4, (LOOP_PX[0] + u * (LOOP_PX[1] - LOOP_PX[0])) / (zk * CS));
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
// Oct 18: the multi-colour forms join it, flower right after the heart; a form
// whose part hues the theme's palette lacks is skipped (eligible), so on love
// (reds, pinks, yellow, orange; no green, brown or blue) it is
// heart → flower → leaf → fish → wave (Oct 18 evening, config C: 28 Evolves,
// ~2.5x the loops, pure loops for every form with a graded fallback). The tree
// (crown 6–50% green across runs: sometimes it stalls) and the sun (its core and
// rays blur into one warm mass at 390) are drawable but out, like the eye.
export const ROTATION = ['heart', 'flower', 'leaf', 'fish', 'wave'];
export function nextForm({ last = null, theme = '', eligible = () => true } = {}){
  const ok = ROTATION.filter(f => !FORM_PARTS[f] || eligible(f));
  if(last && FORMS.includes(last)){
    let k = ROTATION.indexOf(last);
    if(k < 0) return ok[0];   // e.g. an old eye in storage
    do { k = (k + 1) % ROTATION.length; } while(!ok.includes(ROTATION[k]));
    return ROTATION[k]; }
  if(String(theme).toLowerCase() === 'love' || !theme) return 'heart';
  const multi = ok.find(f => FORM_PARTS[f]); if(multi) return multi;   // another theme: its first multi-colour form (nature → tree)
  let h = 0; for(const ch of String(theme)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ok[Math.abs(h) % ok.length];
}

// Cheap guard against a run that ends with almost no form: try a few
// regions (each far from the last dream) and keep the one with the most
// family-coloured cells around the start (dense) and over the form (sparse).
export function chooseDreamRegion({ rand, last = null, S, WC, WR, rgb, hue = 355, tries = 12, win = 16, margin = 40, parts = null }){
  let best = null;
  for(let k = 0; k < tries; k++){
    const g = chooseRegion({ rand, last, S: S + margin, WC, WR });
    if(parts && parts.length > 1){   // multi-colour: each part's hue around each of its start windows (the weakest part counts most)
      const fr = parts.map(p => { let n = 0, f = 0;
        for(const q of p.starts){ const sx = Math.round(g.fx + q.dx * S), sy = Math.round(g.fy + q.dy * S), wq = q.win || 8;
          for(let y = sy - (wq >> 1); y < sy - (wq >> 1) + wq; y++) for(let x = sx - (wq >> 1); x < sx - (wq >> 1) + wq; x++){
            if(x < 0 || y < 0 || x >= WC || y >= WR) continue; n++; if(familyScore(...rgb(y * WC + x), p.hue) > 0.3) f++; } }
        return n ? f / n : 0; });
      const score = 0.6 * Math.min(...fr) + 0.4 * fr.reduce((a, b) => a + b, 0) / fr.length;
      if(!best || score > best.score) best = { fx: g.fx, fy: g.fy, score: +score.toFixed(3), startFamily: +fr[0].toFixed(3), partFamily: fr.map(x => +x.toFixed(3)) };
      continue;
    }
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
  minSep = 3, rand = Math.random, bias = 1.2, noise = 0.3, fill = 0, hue = 355, hole = null, loopR = 0, strict = false, room = null, purity = 0 }){
  // strict: only targets inside this part's mask; room(i): cells from i to another part (its loop shrinks so it never reaches it)
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
        const f = inForm(i); if(strict && !f) continue;
        if(room){ const rm = (room(i) - 0.75) / 1.25; if(rm < 1.0) continue; if(rm < tr) tr = rm; }
        const [r, g, b] = rgb(i);
        // purity (multi-colour parts): how much of what this loop would hold is the part's hue, not just its centre cell
        let red = familyScore(r, g, b, hue);
        // the loop shrinks until what it would hold is mostly the part's hue (on a dark canvas a big loop holds mostly black)
        if(purity){ let ok = 0;
          for(let pr = Math.max(1, tr || loopR); pr >= 0.99; pr -= 0.75){ const R = Math.ceil(pr * 1.25); let sum = 0, n = 0;
            for(let oy = -R; oy <= R; oy++) for(let ox = -R; ox <= R; ox++){ if(ox * ox + oy * oy > pr * pr * 1.5) continue; const nx = x + ox, ny = y + oy;
              if(nx < 0 || ny < 0 || nx >= WC || ny >= WR) continue; n++; sum += familyScore(...rgb(ny * WC + nx), hue); }
            const m = n ? sum / n : 0; if(m >= purity){ ok = pr; red = m * (1 + 0.2 * pr); break; } }
          if(!ok) continue; tr = ok; }
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

// Pure loops, but never a stall: if fewer than half the loops find a spot that is
// mostly the part's hue, the rest are chosen with a looser purity (×0.6, ×0.3,
// then none), so the cluster always keeps growing outward.
export function chooseCycleTargetsGraded(args){
  const p = args.purity || 0; if(!p) return chooseCycleTargets(args);
  let out = [];
  for(const f of [1, 0.6, 0.3, 0]){
    const need = args.count - out.length; if(need <= 0) break;
    const taken = new Set(out.map(o => o.i)), sep = args.minSep ?? 3;
    const more = chooseCycleTargets({ ...args, purity: p * f, count: args.count * 3 }).filter(o => !taken.has(o.i) &&
      !out.some(q => Math.max(Math.abs(q.i % args.WC - o.i % args.WC), Math.abs(((q.i / args.WC) | 0) - ((o.i / args.WC) | 0))) < sep));
    for(const o of more){ if(out.length >= args.count) break;
      if(out.some(q => Math.max(Math.abs(q.i % args.WC - o.i % args.WC), Math.abs(((q.i / args.WC) | 0) - ((o.i / args.WC) | 0))) < sep)) continue; out.push(o); }
    if(out.length >= Math.ceil(args.count / 2)) break;
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
