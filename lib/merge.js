// PROTOTYPE (variant B branch) — server-side merge of a saved canvas into the
// shared live canvas (mother_display.cell_data), instead of overwriting it.
//
// ── Formats ────────────────────────────────────────────────────────────
// cellData (unchanged, production format): Uint16 LE per cell, bit 15 = held,
//   bits 0–14 = RGB555 colour; base64 of 900*660*2 bytes (1,584,000 chars).
//   All 16 bits are used, so there is no room for hold levels in it.
// Stab map v2 ("SM2"): one 4-bit nibble per cell, two cells per byte (cell i
//   in the low nibble of byte i>>1 when i is even, high nibble when odd):
//     bits 0–1 = hold level 0–3 (0 free, 1 held, 2 refined, 3 crystallised)
//     bit  2   = loose (hold made by a coarse loop > 1,200 cells)
//     bit  3   = chosen by this contributor this session (client → server only)
//   297,000 bytes → 396,000 base64 chars. Sent in the existing `stabMap` field;
//   stored in canvas_states.stab_map (existing column).
// Live canvas storage (no schema change): mother_display.cell_data =
//   <1,584,000-char cellData> + ":v2:" + <396,000-char SM2 without chosen bits>.
//   Rows without the suffix (older saves) read as level 1 for held cells.
//   This only ever applies to this branch's pb-* rows; production never sees it.
//
// ── Merge rule (sim/hints_sim.js merged mode, TUNING_REPORT.md) ────────
//  - 'continue': nobody else saved since this contributor loaded the live
//    canvas (client baseGen === mother.generation): take their canvas whole,
//    colours + levels + loose (carries their local evolution).
//  - 'held-only': otherwise keep the live canvas; for every incoming held cell
//    that this contributor chose, or that is free on the live canvas, take its
//    colour (and its loose flag if chosen); hold level = max(live, incoming).
//  - Release, for held cells this contributor did not choose:
//      loose  → freed outright with p = releaseLoose (≈ 5.4% per save)
//      normal → drops ONE level with p = release (0.75% per save)
import { WC, WR, CELL_BYTES, CELL_DATA_LENGTH } from './validate.js';

export const WT = WC * WR;
export const HELD = 0x8000;
export const CHOSEN_BYTES = Math.ceil(WT / 8);                     // 74,250
export const CHOSEN_B64_LENGTH = 4 * Math.ceil(CHOSEN_BYTES / 3);  // 99,000

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LUT = new Uint8Array(128).fill(255);
for(let i = 0; i < 64; i++) LUT[ALPHA.charCodeAt(i)] = i;
const ENC = new Uint8Array(64);
for(let i = 0; i < 64; i++) ENC[i] = ALPHA.charCodeAt(i);

export function b64ToBytes(b64){
  let len = b64.length, pad = 0;
  if(b64[len - 1] === '=') pad++;
  if(b64[len - 2] === '=') pad++;
  const out = new Uint8Array((len * 3 >> 2) - pad);
  let o = 0;
  for(let i = 0; i < len; i += 4){
    const a = LUT[b64.charCodeAt(i)], b = LUT[b64.charCodeAt(i + 1)];
    const c = LUT[b64.charCodeAt(i + 2)] & 63, d = LUT[b64.charCodeAt(i + 3)] & 63;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if(o < out.length) out[o++] = n >> 16;
    if(o < out.length) out[o++] = (n >> 8) & 255;
    if(o < out.length) out[o++] = n & 255;
  }
  return out;
}
export function bytesToB64(bytes){
  // Write ASCII into a byte buffer and decode once: much faster than string
  // concatenation for 1.2 MB, which matters for Workers' CPU-time limits.
  const n = bytes.length, out = new Uint8Array(4 * Math.ceil(n / 3));
  let o = 0;
  for(let i = 0; i < n; i += 3){
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    out[o++] = ENC[v >> 18]; out[o++] = ENC[(v >> 12) & 63];
    out[o++] = i + 1 < n ? ENC[(v >> 6) & 63] : 61;
    out[o++] = i + 2 < n ? ENC[v & 63] : 61;
  }
  return new TextDecoder().decode(out);
}
// Little-endian, like the browser's Uint16Array on every platform we target.
export function decodeCells(b64){
  if(typeof b64 !== 'string' || b64.length !== CELL_DATA_LENGTH) return null;
  const bytes = b64ToBytes(b64);
  if(bytes.length !== CELL_BYTES) return null;
  const out = new Uint16Array(WT);
  for(let i = 0, j = 0; i < WT; i++, j += 2) out[i] = bytes[j] | (bytes[j + 1] << 8);
  return out;
}
export function encodeCells(cells){
  const bytes = new Uint8Array(CELL_BYTES);
  for(let i = 0, j = 0; i < WT; i++, j += 2){ bytes[j] = cells[i] & 255; bytes[j + 1] = cells[i] >> 8; }
  return bytesToB64(bytes);
}
export const SM2_BYTES = Math.ceil(WT / 2);                       // 297,000
export const SM2_B64_LENGTH = 4 * Math.ceil(SM2_BYTES / 3);        // 396,000
export const MOTHER_SEP = ':v2:';
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Legacy 1-bit chosen map (earlier build of this branch). Uint8Array(WT) of 0/1, or null.
export function decodeChosen(b64){
  if(typeof b64 !== 'string' || b64.length !== CHOSEN_B64_LENGTH || !B64_RE.test(b64)) return null;
  const bytes = b64ToBytes(b64);
  if(bytes.length !== CHOSEN_BYTES) return null;
  const out = new Uint8Array(WT);
  for(let i = 0; i < WT; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}
export function encodeChosen(flags){
  const bytes = new Uint8Array(CHOSEN_BYTES);
  for(let i = 0; i < WT; i++) if(flags[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytesToB64(bytes);
}
// SM2 → { level, loose, chosen } (Uint8Array(WT) each), or null.
export function decodeStab(b64){
  if(typeof b64 !== 'string' || b64.length !== SM2_B64_LENGTH || !B64_RE.test(b64)) return null;
  const bytes = b64ToBytes(b64);
  if(bytes.length !== SM2_BYTES) return null;
  const level = new Uint8Array(WT), loose = new Uint8Array(WT), chosen = new Uint8Array(WT);
  for(let i = 0; i < WT; i++){
    const n = (bytes[i >> 1] >> ((i & 1) << 2)) & 15;
    level[i] = n & 3; loose[i] = (n >> 2) & 1; chosen[i] = (n >> 3) & 1;
  }
  return { level, loose, chosen };
}
export function encodeStab(level, loose, chosen = null){
  const bytes = new Uint8Array(SM2_BYTES);
  for(let i = 0; i < WT; i++){
    const n = (level[i] & 3) | ((loose && loose[i] ? 1 : 0) << 2) | ((chosen && chosen[i] ? 1 : 0) << 3);
    bytes[i >> 1] |= n << ((i & 1) << 2);
  }
  return bytesToB64(bytes);
}
// Levels implied by the held bit alone (no stab map available).
export function levelsFromCells(cells){
  const level = new Uint8Array(WT);
  for(let i = 0; i < WT; i++) level[i] = (cells[i] & HELD) ? 1 : 0;
  return level;
}
// Split a stored live canvas into its parts without decoding (cheap; for display-live).
export function splitMotherData(str){
  if(typeof str !== 'string') return { cellData: null, stabMap: null };
  const k = str.indexOf(MOTHER_SEP);
  if(k < 0) return { cellData: str, stabMap: null };
  return { cellData: str.slice(0, k), stabMap: str.slice(k + MOTHER_SEP.length) };
}
// Stored live canvas → { cells, level, loose } (or null if undecodable).
export function unpackMother(str){
  const { cellData, stabMap } = splitMotherData(str);
  const cells = decodeCells(cellData);
  if(!cells) return null;
  const st = decodeStab(stabMap);
  if(st){
    for(let i = 0; i < WT; i++){ if(!(cells[i] & HELD)){ st.level[i] = 0; st.loose[i] = 0; } else if(!st.level[i]) st.level[i] = 1; }
    return { cells, level: st.level, loose: st.loose };
  }
  return { cells, level: levelsFromCells(cells), loose: new Uint8Array(WT) };
}
export function packMother({ cells, level, loose }){
  return encodeCells(cells) + MOTHER_SEP + encodeStab(level, loose);
}

// mother / incoming: { cells:Uint16Array, level:Uint8Array, loose:Uint8Array }; mother may be null.
// chosen: Uint8Array(WT)|null. Returns { cells, level, loose, mode, stats }.
export function mergeIntoMother({ mother, incoming, chosen = null, continuation = false,
                                 release = 0, releaseLoose = 0, rand = Math.random }){
  const stats = { taken: 0, kept: 0, released: 0, looseReleased: 0, held: 0, loose: 0, refined: 0 };
  const inc = normalise(incoming);
  let cells, level, loose, mode;
  if(!mother){
    cells = Uint16Array.from(inc.cells); level = Uint8Array.from(inc.level); loose = Uint8Array.from(inc.loose);
    mode = 'first'; stats.taken = WT;
  } else if(continuation){
    cells = Uint16Array.from(inc.cells); level = Uint8Array.from(inc.level); loose = Uint8Array.from(inc.loose);
    mode = 'continue'; stats.taken = WT;
  } else {
    const m = normalise(mother);
    cells = Uint16Array.from(m.cells); level = Uint8Array.from(m.level); loose = Uint8Array.from(m.loose);
    mode = 'held-only';
    for(let i = 0; i < WT; i++){
      const li = inc.level[i];
      if(!li) continue;
      const ch = chosen ? chosen[i] : 0;
      if(ch || !level[i]){ cells[i] = (inc.cells[i] & 0x7FFF) | HELD; loose[i] = inc.loose[i]; stats.taken++; }
      else stats.kept++;
      if(li > level[i]) level[i] = li;
    }
  }
  if(mother && (release > 0 || releaseLoose > 0)){   // no release on the very first save
    for(let i = 0; i < WT; i++){
      if(!level[i] || (chosen && chosen[i])) continue;
      if(loose[i]){ if(rand() < releaseLoose){ level[i] = 0; loose[i] = 0; stats.looseReleased++; } }
      else if(rand() < release){ level[i]--; stats.released++; }
    }
  }
  for(let i = 0; i < WT; i++){
    if(level[i]){ cells[i] |= HELD; stats.held++; if(loose[i]) stats.loose++; if(level[i] >= 2) stats.refined++; }
    else { cells[i] &= 0x7FFF; loose[i] = 0; }
  }
  return { cells, level, loose, mode, stats };
}
// Accept a bare Uint16Array (levels from the held bit) or a full { cells, level, loose }.
function normalise(x){
  if(x instanceof Uint16Array) return { cells: x, level: levelsFromCells(x), loose: new Uint8Array(WT) };
  const level = x.level || levelsFromCells(x.cells);
  const lv = Uint8Array.from(level);
  for(let i = 0; i < WT; i++){ if(!(x.cells[i] & HELD)) lv[i] = 0; else if(!lv[i]) lv[i] = 1; }
  return { cells: x.cells, level: lv, loose: x.loose || new Uint8Array(WT) };
}
