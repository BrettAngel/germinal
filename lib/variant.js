// ════════════════════════════════════════════════════════════════════════
// PROTOTYPE VARIANT CONFIG — DO NOT MERGE AS-IS.
// Every API read/write on this branch is forced into a namespaced theme,
// unconditionally: "love" + hint "pull" → "pb-love-pull". So testing a preview
// can never create or change rows for a real theme in mother_display or
// canvas_states, and each starting hint gets its own live canvas.
// Remove / rework this (and the nsTheme calls in functions/api, app.html and
// live.html) before any real merge.
// ════════════════════════════════════════════════════════════════════════
import { resolveHint, HINT_NAMES, HINT_ALIASES } from './hints.js';

export const VARIANT = 'B';
export const VARIANT_NAME = 'crowd finds detail';
export const VARIANT_BLURB = 'No target image. What people hold spreads along contours into similar colours; wide loops hold loosely; refined holds glow; neglected areas fade toward dark.';
export const NS = 'pb-';

// Tuned engine — /workspace/germinal/sim/TUNING_REPORT.md "Recommended parameter
// set" (+ the hints_sim.js base rules it was tuned on: HINTHL=30, GLOW=rstrong,
// LNS=1, ANISO, GFIX, FFIX).
export const PARAMS = {
  // free cells far from holds (recognition field ≤ 0.35)
  bgMut: 0.005,          // background change per Evolve (production: 0.02)…
  fadeP: 0.02,           // …otherwise 2% of them fade toward dark…
  fadeT: 0.02,           // …by 2% per Evolve
  // spreading along contours + similar colours (TUNING §1)
  hintHalfLife: 30,      // hint's share of the contour field: w = 0.5^(contributions/30)
  alignK: 3,             // source cost = manhattan × (1 + 3·align) + colourL1 / 8
  colourDiv: 8,
  pullDecay: 130,        // t = (0.3 + 0.45 f) · exp(−colourL1/130); 0 if colourL1 > 180
  pullMaxColour: 180,
  noiseAlignK: 2,        // near-hold noise: copy neighbour with min colourL1·(1+2·align) + 8·rand…
  noiseJitter: 8,
  noiseMaxCost: 70,      // …only if cost < 70, by lerp 0.5
  noiseT: 0.5,
  gradBlur: 3, gradPasses: 2, gradNorm: 1.5,
  // coarse loops (TUNING §3)
  looseCells: 1200,      // a loop covering > 1,200 cells makes LOOSE holds
  // glow on re-chosen holds (TUNING §4)
  glowP: 0.06,           // level ≥ 2: with p = 0.06·(level−1)…
  glowT: 0.06,           // …blend 0.06 toward own colour scaled to max channel 230
  glowTarget: 230,
  glowMinMax: 60,        // suggested guard (untested in sim): skip very dark cells…
  glowMinSat: 0.15,      // …and nearly grey ones ((max−min)/max < 0.15)
  // server, per save
  release: 0.0075,                         // ordinary hold not re-chosen: drop ONE level (sim: 3% per round of 4)
  releaseLoose: 1 - Math.pow(0.8, 1 / 4),  // loose hold not re-chosen: freed outright, ≈ 5.4% (sim: 20% per round of 4)
};

// "love" + "pull" → "pb-love-pull" (always fits ^[a-z0-9 \-]{1,40}$).
export function nsTheme(theme, hint){
  const { base, hint: h0 } = parseNsTheme(theme);
  const h = resolveHint(base, hint || h0);
  const room = 40 - NS.length - 1 - h.length;
  const b = base.slice(0, room).trim() || 'love';
  return NS + b + '-' + h;
}
// "pb-love-pull" → { base:'love', hint:'pull' }; "love" → { base:'love', hint:null }.
export function parseNsTheme(theme){
  let t = String(theme || '').toLowerCase().replace(/[^a-z0-9 \-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'love';
  if(!t.startsWith(NS)) return { base: t, hint: null };
  t = t.slice(NS.length);
  const names = HINT_NAMES.concat(Object.keys(HINT_ALIASES)).sort((a, b) => b.length - a.length);
  for(const h of names) if(t.endsWith('-' + h)) return { base: t.slice(0, -h.length - 1) || 'love', hint: HINT_ALIASES[h] || h };
  return { base: t || 'love', hint: null };
}
