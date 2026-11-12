// PREVIEW (server-side live wall): the wall frame as stored in mother_display
// (theme "wall:<theme>") and served by /api/display-live?wall=1.
// Format: "wz1." + base64(deflate-raw(the save codec's Uint16 array)), i.e. the
// app's own encodeForServer() output (RGB555 + held bit), compressed ~3x so the
// free tiers' egress stays small. Plain (uncompressed) save base64 is accepted
// too, so the old mother row still displays. Browser + Node (Compression
// Streams); no engine code here.
export const FRAME_TAG = 'wz1.';
export const WC = 900, WR = 660, WT = WC * WR;
const b64e = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = s => { const bin = atob(s), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function through(u8, stream){ return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
// saveB64: encodeForServer() output → packed frame string
export async function packFrame(saveB64){ return FRAME_TAG + b64e(await through(b64d(saveB64), new CompressionStream('deflate-raw'))); }
// packed (or plain) frame string → Uint16Array(WT), or null if it isn't a frame
export async function unpackFrame(str){
  try{
    if(typeof str !== 'string' || !str) return null;
    const u8 = str.startsWith(FRAME_TAG) ? await through(b64d(str.slice(FRAME_TAG.length)), new DecompressionStream('deflate-raw')) : b64d(str);
    if(u8.byteLength < WT * 2) return null;
    return new Uint16Array(u8.buffer, u8.byteOffset, WT);
  }catch(e){ return null; }
}
// Uint16Array → the save base64 (what WallCore.boot / decodeFromServer take)
export function frameToSave(u16){ return b64e(new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength)); }
// the codec's decode (app.html x5: 5-bit → 8-bit, top level → 255), into RGBA
const x5 = q => (q << 3) | (q >> 2);
export function frameToRGBA(u16, out = new Uint8ClampedArray(WT * 4)){
  for(let i = 0, o = 0; i < WT; i++, o += 4){ const q = u16[i] & 0x7FFF; out[o] = x5((q >> 10) & 31); out[o + 1] = x5((q >> 5) & 31); out[o + 2] = x5(q & 31); out[o + 3] = 255; }
  return out;
}
