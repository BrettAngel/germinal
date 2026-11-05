// ════════════════════════════════════════════════════════════════════════
// PROTOTYPE VARIANT CONFIG — DO NOT MERGE AS-IS.
// Save isolation: every API read/write on this branch is forced into a
// namespaced theme, unconditionally: "love" → "pb-love". So testing a preview
// can never create or change rows for a real theme in mother_display or
// canvas_states. Remove / rework this (and the nsTheme calls in functions/api
// and app.html) before any real merge.
//
// Colour behaviour is origin/main's engine, unchanged (no tuned parameters
// here any more: the Oct 18 engine audit restored main's stepGen exactly).
// ════════════════════════════════════════════════════════════════════════
export const VARIANT = 'B';
export const VARIANT_NAME = 'original engine + Dream it';
export const VARIANT_BLURB = "The production engine, unchanged: what you hold stays, nearby pixels are pulled toward it (fading with distance), the rest keeps drifting. Plus the 'Dream it' intro.";
export const NS = 'pb-';

// "love" → "pb-love"; already namespaced themes are kept (always fits ^[a-z0-9 \-]{1,40}$).
export function nsTheme(theme){
  const { base } = parseNsTheme(theme);
  const b = base.slice(0, 40 - NS.length).trim() || 'love';
  return NS + b;
}
// "pb-love" → { base:'love' }; "love" → { base:'love' }.
export function parseNsTheme(theme){
  let t = String(theme || '').toLowerCase().replace(/[^a-z0-9 \-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'love';
  if(t.startsWith(NS)) t = t.slice(NS.length).trim() || 'love';
  return { base: t };
}
