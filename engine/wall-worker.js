// PREVIEW (live-wall compositor): module worker hosting the wall's engine + compositor.
import { WallCore } from '../lib/wall-core.js';
let core = null;
self.onmessage = e => {
  const { id, type, a = {} } = e.data || {};
  try{
    let out;
    if(type === 'boot'){ core = new WallCore(a.opts || {}); out = core.boot(a); }
    else if(type === 'patches') out = core.addPatches(a.list, a.now, true);
    else if(type === 'step') out = core.step(a.now);
    else throw new Error('unknown ' + type);
    self.postMessage({ id, ok: true, out }, [out.rgba.buffer]);
  }catch(err){ self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
