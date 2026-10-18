// PROTOTYPE (variant B branch) — "primordial hints": the starting canvas for
// an EMPTY live canvas. A riddle-like visual gesture that suggests a theme's
// potential without depicting it (no hearts, no suns): faint warm structure in
// the dark that the crowd may or may not decide to grow.
//
// Small registry: theme → which hints it offers and its default; hint name →
// generator. Generators are procedural, deterministic (seeded by theme+hint)
// and light (a few hundred thousand point splats + one small blur).
// To add a hint: write gen(ctx) below and add it to HINTS. To give a theme its
// own set: add an entry to THEME_HINTS (and a palette to PALETTES).
//
// Plain ES module, no dependencies: imported by app.html / live.html in the
// browser and by functions/api + tests in Node/Workers.
export const WC = 900, WR = 660, WT = WC * WR;

export function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function hashStr(s){
  let h = 2166136261 >>> 0;
  for(const ch of String(s)){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function hsl(h, s, l){
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

// Same palettes / "includes" matching as app.html PALS + themePal().
const PALETTES = {
  love: ['#cc0033','#dd1144','#ff3366','#ff6688','#ff99aa','#ffbbcc','#ffcc00','#ff8800','#aa1133','#660022'],
  grief:['#1a1a2e','#2a2a40','#334455','#556677','#778899','#aabbcc','#e0e8f0'],
  hope: ['#ffee88','#ffcc00','#88ccff','#ffffff','#aaffaa','#ff8800'],
  nature:['#1a5a08','#2a7a12','#338814','#55aa22','#aaccaa','#8b4513'],
  joy:  ['#ff6600','#ff8800','#ffcc00','#ff4499','#66ccff','#88eeff'],
};
function themeKey(theme){
  const t = String(theme || 'love').toLowerCase();
  for(const k of Object.keys(PALETTES)) if(t.includes(k)) return k;
  return null;
}
export function paletteFor(theme){
  const k = themeKey(theme);
  if(k) return PALETTES[k].map(hex);
  const hue = hashStr(theme) % 360;
  return Array.from({length:8}, (_, i) => hsl((hue + i * 18) % 360, 55 + i * 3, 30 + i * 6));
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ── helpers ────────────────────────────────────────────────────────────
function splat(acc, x, y, c, w){
  const xi = x | 0, yi = y | 0;
  if(xi < 0 || xi >= WC || yi < 0 || yi >= WR) return;
  const i = yi * WC + xi;
  acc.R[i] += c[0] * w; acc.G[i] += c[1] * w; acc.B[i] += c[2] * w; acc.N[i] += w;
}
function newAcc(){ return { R:new Float32Array(WT), G:new Float32Array(WT), B:new Float32Array(WT), N:new Float32Array(WT) }; }
export function blur(A, rad){ // box blur x3 ≈ gaussian
  const out = Float32Array.from(A), tmp = new Float32Array(WT);
  for(let pass = 0; pass < 3; pass++){
    for(let y = 0; y < WR; y++){ let s = 0, n = 0; for(let x = -rad; x < WC + rad; x++){ const xa = x + rad; if(xa < WC){ s += out[y * WC + xa]; n++; } const xr = x - rad - 1; if(xr >= 0){ s -= out[y * WC + xr]; n--; } if(x >= 0 && x < WC) tmp[y * WC + x] = s / n; } }
    for(let x = 0; x < WC; x++){ let s = 0, n = 0; for(let y = -rad; y < WR + rad; y++){ const ya = y + rad; if(ya < WR){ s += tmp[ya * WC + x]; n++; } const yr = y - rad - 1; if(yr >= 0){ s -= tmp[yr * WC + x]; n--; } if(y >= 0 && y < WR) out[y * WC + x] = s / n; } }
  }
  return out;
}
// Dark substrate like production seedCanvas(): near-black, ~5% faint full-spectrum hints.
function darkBase(rand){
  const DB = ['#080810','#09090f','#0a0a12','#0b0b14','#0c0c16','#08080e','#0a0910','#0c0b14','#0e0d16','#0d0c18'].map(hex);
  const R = new Float32Array(WT), G = new Float32Array(WT), B = new Float32Array(WT);
  for(let i = 0; i < WT; i++){
    let b = DB[(rand() * DB.length) | 0];
    if(rand() < 0.05) b = hsl(rand() * 360, 55, 6 + rand() * 8);
    const g = (rand() - .5) * 6;
    R[i] = b[0] + g; G[i] = b[1] + g; B[i] = b[2] + g;
  }
  return { R, G, B };
}
// Composite glow (accumulated colour/weight) over the dark base. `gain` sets
// how bright dense areas get; per-cell dither keeps it granular, like
// particles, never a clean shape.
function compose(rand, acc, { gain = 1, rad = 1, maxA = 0.7 } = {}){
  const base = darkBase(rand);
  const R = rad ? blur(acc.R, rad) : acc.R, G = rad ? blur(acc.G, rad) : acc.G;
  const B = rad ? blur(acc.B, rad) : acc.B, N = rad ? blur(acc.N, rad) : acc.N;
  const oR = new Uint8Array(WT), oG = new Uint8Array(WT), oB = new Uint8Array(WT);
  for(let i = 0; i < WT; i++){
    let r = base.R[i], g = base.G[i], b = base.B[i];
    const n = N[i];
    if(n > 1e-6){
      const a = Math.min(maxA, (1 - Math.exp(-n * gain)) * (0.55 + 0.45 * rand()));
      r = r * (1 - a) + (R[i] / n) * a; g = g * (1 - a) + (G[i] / n) * a; b = b * (1 - a) + (B[i] / n) * a;
    }
    oR[i] = Math.max(0, Math.min(255, Math.round(r)));
    oG[i] = Math.max(0, Math.min(255, Math.round(g)));
    oB[i] = Math.max(0, Math.min(255, Math.round(b)));
  }
  return { R:oR, G:oG, B:oB };
}

// ── hint generators: gen({ rand, pal }) → { R, G, B } (Uint8Array(WT)) ──
// Two strange-attractor clouds (Clifford maps with a spiral twist), apart,
// each trailing faint ghosts away from the other: drifting toward each other.
function genAttractors({ rand, pal }){
  const acc = newAcc();
  const warm = pal.slice().sort((a, b) => lum(b) - lum(a));
  const cols = [[warm[warm.length > 3 ? 3 : 0], warm[Math.min(warm.length - 1, 6)]], [warm[0], warm[Math.min(warm.length - 1, 2)]]];
  const bodies = [
    { cx: WC * 0.30, cy: WR * 0.55, s: WR * 0.19, p: [-1.4, 1.6, 1.0, 0.7], dir: -1, tw: 0.9 },
    { cx: WC * 0.70, cy: WR * 0.43, s: WR * 0.16, p: [1.7, 1.7, 0.6, 1.2], dir: 1, tw: -0.9 },
  ];
  bodies.forEach((bd, k) => {
    const [a, b, c, d] = bd.p, norm = 1 + Math.max(Math.abs(c), Math.abs(d));
    let x = 0.1, y = 0.1;
    for(let n = 0; n < 140000; n++){
      const nx = Math.sin(a * y) + c * Math.cos(a * x), ny = Math.sin(b * x) + d * Math.cos(b * y);
      x = nx; y = ny; if(n < 20) continue;
      let u = x / norm, v = y / norm; const r = Math.hypot(u, v), th = Math.atan2(v, u) + bd.tw * r;  // spiral twist
      u = r * Math.cos(th); v = r * Math.sin(th);
      const col = cols[k][r < 0.45 ? 1 : 0];
      // the body, then a fading smear trailing away from the other body
      splat(acc, bd.cx + u * bd.s, bd.cy + v * bd.s, col, 1);
      if(rand() < 0.6){
        const g = Math.pow(rand(), 1.6), off = g * WC * 0.16 * bd.dir;
        splat(acc, bd.cx + off + u * bd.s * (1 + g * 0.5), bd.cy + v * bd.s * (1 + g * 0.5) + (rand() - .5) * g * 30, col, 0.5 * (1 - g));
      }
    }
  });
  return compose(rand, acc, { gain: 0.12, rad: 1, maxA: 0.6 });
}
// Warm particles streaming inward along spiral paths toward an empty centre:
// a pull, with nothing (yet) at its heart.
function genPull({ rand, pal }){
  const acc = newAcc();
  const warm = pal.slice().sort((a, b) => lum(a) - lum(b)); // dark → bright
  const cx = WC * 0.5, cy = WR * 0.5, core = WR * 0.06, span = WR * 0.55;
  for(let n = 0; n < 20000; n++){
    let r = core + span * Math.pow(rand(), 0.85), th = rand() * Math.PI * 2;
    const steps = 6 + ((rand() * 10) | 0);
    for(let s = 0; s < steps && r > core; s++){
      const t = 1 - (r - core) / span;                    // 0 outside → 1 near the core
      // mostly deep reds/pinks; brighter colours become likelier near the core
      const pick = Math.min(warm.length - 1, (Math.pow(rand(), 2.2 - 1.6 * t) * warm.length) | 0);
      splat(acc, cx + r * Math.cos(th) * 1.25, cy + r * Math.sin(th), warm[pick], 0.15 + t * 0.6);
      const dr = 2.2 + rand() * 1.5; r -= dr; th += 0.9 * dr / Math.max(r, core);
    }
  }
  return compose(rand, acc, { gain: 1.8, rad: 1, maxA: 0.5 });
}
// Two unseen sources whose ripples interfere: faint warmth only where their
// waves agree. Two influences, meeting.
function genResonance({ rand, pal }){
  const acc = newAcc();
  const warm = pal.slice().sort((a, b) => lum(b) - lum(a));
  const s1 = [WC * 0.33, WR * 0.58], s2 = [WC * 0.70, WR * 0.40], k = 2 * Math.PI / 26;
  for(let y = 0; y < WR; y++) for(let x = 0; x < WC; x++){
    if(rand() > 0.7) continue;                           // granular
    const d1 = Math.hypot(x - s1[0], y - s1[1]), d2 = Math.hypot(x - s2[0], y - s2[1]);
    const f = (Math.cos(k * d1) * Math.exp(-d1 / 260) + Math.cos(k * d2) * Math.exp(-d2 / 260));
    if(f < 0.45) continue;
    const col = warm[Math.min(warm.length - 1, d1 < d2 ? 2 : 0)];
    splat(acc, x, y, col, (f - 0.45) * 2.2);
  }
  return compose(rand, acc, { gain: 1.4, rad: 2, maxA: 0.5 });
}

export const HINTS = {
  attractors: { label: 'Attractors', blurb: 'Two spiral attractors, apart, drifting toward each other.', gen: genAttractors },
  pull:       { label: 'Pull',       blurb: 'Warm particles drawn inward toward an empty centre.',      gen: genPull },
  resonance:  { label: 'Resonance',  blurb: 'Two unseen sources whose ripples agree only in places.',    gen: genResonance },
};
export const HINT_NAMES = Object.keys(HINTS);
// theme → offered hints (first = default). Themes not listed use FALLBACK.
export const THEME_HINTS = {
  love: ['attractors', 'pull', 'resonance'],
};
const FALLBACK = ['pull', 'attractors', 'resonance'];

export function hintsFor(theme){ const k = themeKey(theme); return (k && THEME_HINTS[k]) || FALLBACK; }
export function defaultHint(theme){ return hintsFor(theme)[0]; }
// A requested hint if this theme offers it, else the theme's default.
export function resolveHint(theme, requested){
  const r = String(requested || '').toLowerCase();
  return hintsFor(theme).includes(r) ? r : defaultHint(theme);
}
const cache = new Map();
// The starting canvas for an empty live canvas: { hint, R, G, B } (Uint8Array(WT)).
export function hintCanvas(theme, hint){
  const h = resolveHint(theme, hint), key = theme + '|' + h;
  if(cache.has(key)) return cache.get(key);
  const out = Object.assign({ hint: h }, HINTS[h].gen({ rand: mulberry32(hashStr('hint:' + key)), pal: paletteFor(theme) }));
  cache.set(key, out);
  return out;
}

// ── Colour quantisation for the 16-bit save format (1 hold bit + RGB555) ──
// Round to nearest and expand back over the full 0–255 range. The old code
// did v>>3 / q<<3: it truncated (each save/load trip lost up to 7 levels, so
// shared canvases drifted ~15% darker) and could never produce 255.
export function q5(v){ return Math.min(31, Math.max(0, Math.round(v * 31 / 255))); }
export function u5(q){ return Math.round((q & 31) * 255 / 31); }
