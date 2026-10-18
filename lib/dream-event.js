// Validates one anonymous "Dream it" session summary (dream-ui.js rec) into
// a dream_events row. Unknown fields are dropped and no free text is kept,
// so nothing personal can be stored. Returns {ok, row} or {ok:false, error}.
const DREAMS = ['none','playing','completed','skipped','interrupted','preempted'];
const int = (x, lo, hi) => (Number.isInteger(x) && x >= lo && x <= hi) ? x : null;
const bool = x => x === true;
const tok = (x, max) => { if(typeof x !== 'string') return null; x = x.toLowerCase(); return (/^[a-z0-9-]+$/.test(x) && x.length <= max) ? x : null; };

export function validateDreamEvent(b){
  if(!b || typeof b !== 'object' || Array.isArray(b)) return { ok:false, error:'Body must be an object' };
  const variant = tok(b.variant, 16), hint = tok(b.hint, 24);
  if(!variant || !hint) return { ok:false, error:'Bad variant/hint' };
  if(!DREAMS.includes(b.dream)) return { ok:false, error:'Bad dream state' };
  return { ok:true, row:{
    v: int(b.v, 1, 99) ?? 1,
    variant, hint,
    kiosk: bool(b.kiosk), reduced_motion: bool(b.reducedMotion), is_returning: bool(b.returning),
    dream: b.dream,
    dream_ms: int(b.dreamMs, 0, 600000),
    replays: int(b.replays, 0, 1000) ?? 0,
    first_lasso_ms: int(b.firstLassoMs, 0, 86400000),
    lasso_within_30s: bool(b.lassoWithin30s),
    lassos: int(b.lassos, 0, 10000) ?? 0,
    evolved: bool(b.evolved), shared: bool(b.shared), used_technique: bool(b.usedTechnique),
  }};
}
