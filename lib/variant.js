// ════════════════════════════════════════════════════════════════════════
// PROTOTYPE VARIANT CONFIG — DO NOT MERGE AS-IS.
// Every API read/write on this branch is forced into a namespaced theme,
// unconditionally: "love" + hint "pull" → "pb-love-pull". So testing a preview
// can never create or change rows for a real theme in mother_display or
// canvas_states, and each starting hint gets its own live canvas.
// Remove / rework this (and the nsTheme calls in functions/api, app.html and
// live.html) before any real merge.
// ════════════════════════════════════════════════════════════════════════
import { resolveHint, HINT_NAMES } from './hints.js';

export const VARIANT = 'B';
export const VARIANT_NAME = 'crowd finds detail';
export const VARIANT_BLURB = 'No target image. What people hold spreads; neglected areas fade toward dark.';
export const NS = 'pb-';

// Evolution parameters (sim/run.js "germ_fade" + release; SIM_REPORT §5).
export const PARAMS = {
  bgMut: 0.005,      // base chance per Evolve that a free cell far from holds changes (production: 0.02)
  unheld: 'fade',    // what that change is: 'fade' toward dark (production: random palette noise)
  fadeT: 0.16,       // fade step. Sim: 2% × 0.04; here 0.5% × 0.16 = same average fade per Evolve
  release: 0.03,     // server: chance per merge that a hold nobody re-chose loosens
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
  for(const h of HINT_NAMES) if(t.endsWith('-' + h)) return { base: t.slice(0, -h.length - 1) || 'love', hint: h };
  return { base: t || 'love', hint: null };
}
