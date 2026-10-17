// Shared input validation for the Cloudflare Pages Functions in functions/api.
// Kept outside functions/ so it is bundled as a module, not exposed as a route.

// World is 900 × 660 cells; each cell packs into one Uint16 (2 bytes), which the
// client (app.html encodeForServer) base64-encodes: 4 * ceil(900*660*2 / 3).
export const WC = 900, WR = 660;
export const CELL_BYTES = WC * WR * 2;                       // 1,188,000
export const CELL_DATA_LENGTH = 4 * Math.ceil(CELL_BYTES / 3); // 1,584,000

export const THEME_RE = /^[a-z0-9 \-]{1,40}$/;
export const SHARE_ID_RE = /^[a-z0-9]{1,12}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const MAX_GENERATION = 1_000_000;
export const MAX_BODY_BYTES = 2_500_000; // ~1.6 MB payload + headroom

export const DEFAULT_THEME = 'love';

// Lowercase, trim and collapse internal whitespace. Does not strip characters:
// anything outside THEME_RE is rejected by validateTheme.
export function normalizeTheme(raw){
  return String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Returns { ok:true, value } or { ok:false, error }. Missing/empty → default.
export function validateTheme(raw){
  if(raw === undefined || raw === null || String(raw).trim() === '') return { ok:true, value:DEFAULT_THEME };
  if(typeof raw !== 'string') return { ok:false, error:'theme must be a string' };
  const value = normalizeTheme(raw);
  if(!THEME_RE.test(value)) return { ok:false, error:'theme must be 1-40 characters: a-z, 0-9, space or hyphen' };
  return { ok:true, value };
}

export function validateShareId(raw){
  if(typeof raw !== 'string' || !SHARE_ID_RE.test(raw)) return { ok:false, error:'invalid share id' };
  return { ok:true, value:raw };
}

export function validateGeneration(raw){
  if(raw === undefined || raw === null) return { ok:true, value:1 };
  if(typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_GENERATION){
    return { ok:false, error:`generation must be an integer between 0 and ${MAX_GENERATION}` };
  }
  return { ok:true, value:raw };
}

export function validateCellData(raw){
  if(typeof raw !== 'string') return { ok:false, error:'cellData must be a base64 string' };
  if(raw.length !== CELL_DATA_LENGTH) return { ok:false, error:`cellData must be exactly ${CELL_DATA_LENGTH} characters` };
  if(!BASE64_RE.test(raw)) return { ok:false, error:'cellData must be base64' };
  return { ok:true, value:raw };
}

// Validates a full canvas-save body. Returns { ok:true, value:{...} } or { ok:false, error }.
export function validateSaveBody(body){
  if(!body || typeof body !== 'object' || Array.isArray(body)) return { ok:false, error:'body must be a JSON object' };

  const theme = validateTheme(body.theme);
  if(!theme.ok) return theme;
  const generation = validateGeneration(body.generation);
  if(!generation.ok) return generation;
  const cellData = validateCellData(body.cellData);
  if(!cellData.ok) return cellData;

  let parentId = null;
  if(body.parentId !== undefined && body.parentId !== null && body.parentId !== ''){
    const p = validateShareId(body.parentId);
    if(!p.ok) return { ok:false, error:'invalid parentId' };
    parentId = p.value;
  }

  let stabMap = null;
  if(body.stabMap !== undefined && body.stabMap !== null){
    if(typeof body.stabMap !== 'string' || body.stabMap.length > CELL_DATA_LENGTH){
      return { ok:false, error:'invalid stabMap' };
    }
    stabMap = body.stabMap;
  }

  let contributorId = 'anonymous';
  if(body.contributorId !== undefined && body.contributorId !== null){
    if(typeof body.contributorId !== 'string' || !/^[A-Za-z0-9_\-]{1,64}$/.test(body.contributorId)){
      return { ok:false, error:'invalid contributorId' };
    }
    contributorId = body.contributorId;
  }

  return { ok:true, value:{ theme:theme.value, generation:generation.value, cellData:cellData.value,
                            parentId, stabMap, contributorId } };
}
