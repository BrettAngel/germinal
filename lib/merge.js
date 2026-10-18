// PROTOTYPE (variant branches) — server-side merge of a saved canvas into the
// shared live canvas (mother_display.cell_data), instead of overwriting it.
//
// Cell format (unchanged): Uint16 little-endian per cell, high bit = held,
// low 15 bits = RGB555 colour; base64 of 900*660*2 bytes.
// "Chosen" map (sent by the client in the existing stabMap field): 1 bit per
// cell, set for the cells this contributor lassoed in this session — that is
// how we know which holds were re-chosen, so the rest can loosen.
//
// Merge rule (follows the simulation's merged mode, sim/run.js):
//  - mode 'continue': nobody else saved since this contributor loaded the
//    live canvas (client baseGen === mother.generation). Their canvas is a
//    direct continuation of the live one, so it is taken whole: held AND
//    unheld cells, which carries their local evolution (held colours spreading,
//    noise / fade) into the shared canvas. Like the sim's "first person's
//    evolved canvas".
//  - mode 'held-only': the live canvas moved on (concurrent saves, share-link
//    lineages, older clients). Keep the live canvas and copy in only the
//    incoming HELD cells that this contributor chose, or that are not held in
//    the live canvas. Unheld live pixels are kept. Like the sim's other
//    batch members.
//  - Then release: every held cell that this contributor did not choose loses
//    its hold with probability `release` (sim: 3% per merged round).
//  The mother has no stab_map column, so hold LEVELS (1–3) cannot be stored:
//  held is 1 bit here, and a release drops it straight to free.
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
// Chosen bitmap: bit (i & 7) of byte (i >> 3). Returns Uint8Array(WT) of 0/1, or null.
export function decodeChosen(b64){
  if(typeof b64 !== 'string' || b64.length !== CHOSEN_B64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
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

// mother: Uint16Array|null, incoming: Uint16Array, chosen: Uint8Array|null.
// Returns { cells, mode, stats }.
export function mergeIntoMother({ mother, incoming, chosen = null, continuation = false, release = 0, rand = Math.random }){
  const stats = { taken: 0, kept: 0, released: 0, held: 0 };
  if(!mother){
    const cells = Uint16Array.from(incoming);
    for(let i = 0; i < WT; i++) if(cells[i] & HELD) stats.held++;
    stats.taken = WT;
    return { cells, mode: 'first', stats };
  }
  let cells, mode;
  if(continuation){
    cells = Uint16Array.from(incoming); mode = 'continue'; stats.taken = WT;
  } else {
    cells = Uint16Array.from(mother); mode = 'held-only';
    for(let i = 0; i < WT; i++){
      const inc = incoming[i];
      if(!(inc & HELD)) continue;
      if((chosen && chosen[i]) || !(mother[i] & HELD)){ cells[i] = inc; stats.taken++; }
      else stats.kept++;
    }
  }
  if(release > 0){
    for(let i = 0; i < WT; i++){
      if(!(cells[i] & HELD) || (chosen && chosen[i])) continue;
      if(rand() < release){ cells[i] &= 0x7FFF; stats.released++; }
    }
  }
  for(let i = 0; i < WT; i++) if(cells[i] & HELD) stats.held++;
  return { cells, mode, stats };
}
