// PROTOTYPE (variant B branch) — "Dream it" onboarding (app.html).
// A labelled ~14 s vision played on the visitor's ACTUAL current canvas with
// the REAL mechanics, sped up:
//   (a) zoom into the noise  (b) a visible pointer lassoes a few scattered
//   red-ish pixels (real applyLasso → real holds)  (c) 6 quick, accelerating
//   cycles: lasso a few more red-ish cells next to what is held, then press
//   Evolve (real nextGen → one engine generation)  (d) step back: a rough,
//   crowd-made form (a heart, or something)  (e) rewind.
// No stored image, no mask reveal: the form only softly biases which real
// neighbouring cells get lassoed next (lib/dream.js chooseCycleTargets).
// Before it starts, the canvas and its state (cells, generation, holds,
// chosen set, affinity, score log, history, archive) are snapshotted; at the
// end they are restored exactly (verified; checksum fallback) while the last
// frame fades out on top. Nothing is saved to the server. It never blocks:
// the overlay ignores pointer events, Skip is visible from the first frame,
// and any tap, scroll or key (Esc = skip) ends it immediately and passes
// through to the canvas.
// Copy: /workspace/germinal/team/dream_copy.md (via lib/dream.js COPY).
(function(){
'use strict';
const LS_SEEN='germ_dream_seen', LS_LAST='germ_dream_last', LS_LOG='germ_dream_log', LS_STATS='germ_dream_stats';
const RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE=window.matchMedia&&matchMedia('(pointer: coarse)').matches;
const IS_KIOSK=typeof KIOSK!=='undefined'&&!!KIOSK;
const QD=new URLSearchParams(location.search).get('dream');   // ?dream=1 force autoplay, ?dream=0 never
const D=()=>window.GERM&&GERM.D;
const ls={get:k=>{try{return localStorage.getItem(k);}catch(e){return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}}};

// ── DOM (built once) ──
const css=document.createElement('style');
css.textContent=`
#dreamC{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;}
#dreamUI{position:absolute;left:0;right:0;top:8px;z-index:7;display:none;pointer-events:none;
  flex-direction:column;align-items:center;gap:6px;padding:0 10px;}
#dreamUI.on{display:flex;}
#dreamUI .dtag{font:500 10px/1.2 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#e8d6a8;
  background:rgba(10,10,20,.72);border:1px solid rgba(200,169,110,.45);border-radius:999px;padding:5px 10px;}
#dreamUI .dcap{font:italic 400 17px/1.35 'Cormorant Garamond',Georgia,serif;color:#f4ead2;text-align:center;max-width:30em;
  text-shadow:0 1px 6px #000,0 0 2px #000;min-height:1.4em;transition:opacity .25s;}
#dreamUI .dskip{pointer-events:auto;font:500 12px/1 'DM Mono',monospace;letter-spacing:.06em;color:#0a0a14;background:#e8d6a8;
  border:0;border-radius:999px;padding:9px 14px;cursor:pointer;min-height:36px;}
#dreamUI .dskip:focus-visible,#dreamCoach button:focus-visible{outline:2px solid #fff;outline-offset:2px;}
#dreamCoach{position:fixed;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 86px);z-index:61;display:none;
  max-width:min(300px,calc(100vw - 20px));background:rgba(10,10,20,.86);border:1px solid rgba(200,169,110,.35);border-radius:12px;
  padding:8px 10px;gap:8px;align-items:center;color:#efe3c4;font:400 13px/1.35 'DM Mono',monospace;transition:box-shadow .4s,border-color .4s;}
#dreamCoach.on{display:flex;}
#dreamCoach.pulse{border-color:rgba(232,214,168,.95);box-shadow:0 0 0 3px rgba(232,214,168,.25),0 0 22px rgba(232,214,168,.35);}
#dreamCoach canvas{width:64px;height:44px;flex:none;border-radius:6px;background:#07070d;}
#dreamCoach .dtxt{flex:1;min-width:0;}
#dreamCoach .drow{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}
#dreamCoach button{font:500 11px/1 'DM Mono',monospace;color:#e8d6a8;background:transparent;border:1px solid rgba(200,169,110,.5);
  border-radius:999px;padding:7px 10px;cursor:pointer;min-height:32px;}
#dreamCoach .dx{border:0;padding:4px 6px;font-size:14px;color:#a99;}
body.kiosk #dreamUI .dcap{font-size:24px;} body.kiosk #dreamUI .dtag{font-size:13px;} body.kiosk #dreamUI .dskip{font-size:16px;min-height:52px;padding:14px 20px;}
body.dreaming #scoreFlash,body.dreaming #toast{visibility:hidden!important;}
.dream-press{box-shadow:0 0 0 3px rgba(232,214,168,.9),0 0 18px rgba(232,214,168,.8)!important;transform:scale(.94);}
@media (prefers-reduced-motion: reduce){#dreamCoach,#dreamUI .dcap{transition:none;}}
`;
document.head.appendChild(css);
const vpEl=document.getElementById('vp');
const dc=document.createElement('canvas');dc.id='dreamC';dc.setAttribute('aria-hidden','true');vpEl.appendChild(dc);
const dctx=dc.getContext('2d');
const dw=document.createElement('canvas');dw.id='dreamW';dw.setAttribute('aria-hidden','true');
dw.style.cssText='position:absolute;left:0;top:0;display:none;pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges;';
document.getElementById('ovl').insertAdjacentElement('afterend',dw);const wctx=dw.getContext('2d');
const ui=document.createElement('div');ui.id='dreamUI';ui.setAttribute('role','region');ui.setAttribute('aria-label','Vision · a demonstration');
ui.innerHTML='<div class="dtag"></div><div class="dcap" aria-live="polite"></div><button type="button" class="dskip"></button>';
vpEl.appendChild(ui);
const uiTag=ui.querySelector('.dtag'),uiCap=ui.querySelector('.dcap'),uiSkip=ui.querySelector('.dskip');
const coach=document.createElement('div');coach.id='dreamCoach';coach.setAttribute('role','status');coach.setAttribute('aria-live','polite');
coach.innerHTML='<canvas width="128" height="88" aria-hidden="true"></canvas><div class="dtxt"><div class="dline"></div><div class="drow"><button type="button" class="dagain"></button><button type="button" class="dx" aria-label="Hide hint">×</button></div></div>';
document.body.appendChild(coach);
const coachLine=coach.querySelector('.dline'),coachAgain=coach.querySelector('.dagain'),coachX=coach.querySelector('.dx'),mini=coach.querySelector('canvas'),mctx=mini.getContext('2d');
uiSkip.addEventListener('click',e=>{e.stopPropagation();end('skipped',true);});
coachAgain.addEventListener('click',e=>{e.stopPropagation();play({replay:true});});
coachX.addEventListener('click',e=>{e.stopPropagation();coach.classList.remove('on');coachHidden=true;});

// ── state ──
let pending=false,playing=false,raf=0,T0=0,plan=null,sumBefore='',view0=null,coachHidden=false,attractT=0;
const frames={dt:new Float32Array(4000),paint:new Float32Array(4000),t:new Float32Array(4000),n:0};
const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
const ease=t=>t<0?0:t>1?1:t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const hex2=(c,k)=>parseInt(c.substr(k,2),16);

// ── session measurement (local only; no ids, no personal data) ──
const rec={v:1,day:new Date().toISOString().slice(0,10),variant:'B',hint:'',kiosk:!!IS_KIOSK,reducedMotion:!!RM,
  returning:!!ls.get(LS_SEEN),dream:'none',dreamMs:0,replays:0,handoverAt:0,firstLassoMs:null,lassoWithin30s:false,
  lassos:[],evolved:false,shared:false,usedTechnique:false,technique:null};
let recIdx=-1;
function saveRec(){
  try{
    const log=JSON.parse(ls.get(LS_LOG)||'[]');
    const out={...rec,lassos:rec.lassos.length};
    if(recIdx<0){log.push(out);recIdx=log.length-1;}else log[recIdx]=out;
    while(log.length>200){log.shift();recIdx--;}
    ls.set(LS_LOG,JSON.stringify(log));
    const st={sessions:0,played:0,completed:0,skipped:0,interrupted:0,replays:0,lassoWithin30s:0,evolved:0,shared:0,usedTechnique:0};
    for(const r of log){st.sessions++;if(r.dream!=='none')st.played++;if(st[r.dream]!==undefined&&r.dream!=='none')st[r.dream]++;
      st.replays+=r.replays||0;if(r.lassoWithin30s)st.lassoWithin30s++;if(r.evolved)st.evolved++;if(r.shared)st.shared++;if(r.usedTechnique)st.usedTechnique++;}
    st.adoptionRate=st.played?+(st.usedTechnique/st.played).toFixed(3):null;
    ls.set(LS_STATS,JSON.stringify(st));
  }catch(e){}
}
// Anonymous per-session summary to the PREVIEW DB (approved by Brett, preview
// only): sent only from preview deployments (*.pages.dev). Never from
// germinal.studio; on localhost only with ?events=1 for testing. The server
// endpoint is also off unless DREAM_EVENTS_ENABLED is set (preview env only).
const SEND_EVENTS=(()=>{try{const h=location.hostname.toLowerCase();
  if(h.endsWith('.pages.dev')&&h!=='germinal.pages.dev')return true;   // not the bare project host: that's production's alias
  if((h==='localhost'||h==='127.0.0.1'||h==='[::1]')&&new URLSearchParams(location.search).get('events')==='1')return true;
}catch(e){}return false;})();
// One summary per page load, sent when the page is hidden/left (so skipped and
// watched-only sessions count too). Only the fields the server keeps.
let eventSent=false;
function eventBody(){return {v:rec.v,variant:rec.variant,hint:rec.hint,kiosk:rec.kiosk,reducedMotion:rec.reducedMotion,returning:rec.returning,
  dream:rec.dream,dreamMs:Math.round(rec.dreamMs||0),replays:rec.replays,firstLassoMs:rec.firstLassoMs==null?null:Math.round(rec.firstLassoMs),
  lassoWithin30s:rec.lassoWithin30s,lassos:rec.lassos.length,evolved:rec.evolved,shared:rec.shared,usedTechnique:rec.usedTechnique};}
function sendEvent(){
  if(!SEND_EVENTS||eventSent||!rec.hint)return;       // rec.hint is set once the visitor reaches the canvas
  eventSent=true;
  try{navigator.sendBeacon('/api/dream-event',new Blob([JSON.stringify(eventBody())],{type:'application/json'}));}catch(e){}
}
addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')sendEvent();});
addEventListener('pagehide',sendEvent);

// ── geometry helpers ──
function vpSize(){return{w:vpEl.clientWidth,h:vpEl.clientHeight};}
function fitView(){const {w,h}=vpSize();const z=Math.min(w/WW,h/WH)*0.98;return{z,px:(w-WW*z)/2,py:(h-WH*z)/2};}
function setView(z,px,py){zoom=z;panX=px;panY=py;applyXform();}
function cellScreen(i){const x=(i%WC+.5)*CS,y=(((i/WC)|0)+.5)*CS;return{x:x*zoom+panX,y:y*zoom+panY};}
function evoTarget(){
  const vr=vpEl.getBoundingClientRect();
  for(const id of ['evoBtn','t-evo']){const b=document.getElementById(id);if(!b)continue;const r=b.getBoundingClientRect();
    if(r.width>0&&r.height>0&&getComputedStyle(b).display!=='none'&&getComputedStyle(b).visibility!=='hidden')return{el:b,x:r.left+r.width/2-vr.left,y:r.top+r.height/2-vr.top};}
  return{el:null,x:vr.width-40,y:vr.height-30};
}
function sizeCanvas(){const dpr=Math.min(2,window.devicePixelRatio||1);const {w,h}=vpSize();
  if(dc.width!==Math.round(w*dpr)||dc.height!==Math.round(h*dpr)){dc.width=Math.round(w*dpr);dc.height=Math.round(h*dpr);}
  dctx.setTransform(dpr,0,0,dpr,0,0);}

// ── plan a dream on the current canvas ──
// Everything the vision does is the real thing, sped up: real lassos
// (applyLasso → real holds), real Evolve presses (nextGen → one engine
// generation each). The form only softly biases WHICH neighbouring red-ish
// cells get lassoed next; it is never painted.
const cellRGB=i=>{const c=cells[i].c;return[hex2(c,1),hex2(c,3),hex2(c,5)];};
const hueCache={};
function makePlan(opts={}){
  const G=D(),rnd=Math.random;
  let last=null;try{last=JSON.parse(ls.get(LS_LAST)||'null');}catch(e){}
  const theme=typeof themeNow==='function'?themeNow():'';
  // heart first for love (first visit); later plays and "Dream again" rotate heart → leaf → wave
  const form=(opts.form&&G.FORMS.includes(opts.form))?opts.form:G.nextForm({last:last&&last.form,theme});   // opts.form: tests only
  const S=G.formSize(form);
  const hue=hueCache[theme]!=null?hueCache[theme]:(hueCache[theme]=G.themeFamilyHue({theme,rgb:cellRGB,WT}));
  // guard: of a few regions far from the last dream, the one with the most family-coloured cells near the start
  const reg=G.chooseDreamRegion({rand:rnd,last,S,WC,WR,rgb:cellRGB,hue});
  ls.set(LS_LAST,JSON.stringify({fx:reg.fx,fy:reg.fy,form}));
  const mask=G.formMask(form,S);
  const {w,h}=vpSize();const zD=Math.min(ZMAX,18/CS),fv=fitView();
  const zF=Math.max(fv.z*1.5,Math.min(w,h*0.62)*0.5/(S*CS));     // step back: the form ~half the view
  const zC=Math.min(zD,zF*1.9);                                    // cycles end here (zooming out as it grows)
  // loop sizes follow the heart's scale for every form, so each form gets about as many holds (bigger
  // boxes zoom out further; at their own zoom the loops would swamp the form into a blob)
  const zC44=Math.min(zD,Math.max(fv.z*1.5,Math.min(w,h*0.62)*0.5/(44*CS))*1.9);
  // first picks: a few scattered red-ish pixels near the form's centre, in view
  const cw=Math.floor(w/(zD*CS)),ch=Math.floor(h/(zD*CS));
  const ww=Math.max(6,Math.min(cw-6,16)),wh=Math.max(6,Math.min(Math.floor(ch*0.45),16));
  // the eye's pupil stays open: no lasso ever reaches it (formHole), loops near it shrink
  const tune=G.formTuning(form),hb=G.formHole(form,S),hole=hb?{cx:hb.cx,cy:hb.cy,r:hb.r}:null;
  const HX=reg.fx-(S>>1)+(hole?hole.cx:0),HY=reg.fy-(S>>1)+(hole?hole.cy:0);
  const pickR=1.35,exclude=hole?(i=>Math.hypot(i%WC+.5-HX,((i/WC)|0)+.5-HY)<hole.r+1.25*pickR+0.75):null;
  const pk={picks:[],hue:-1,colour:[0,0,0]};
  for(const q of tune.starts){const sx=Math.round(reg.fx+q.dx*S),sy=Math.round(reg.fy+q.dy*S);
    const qw=q.win||ww,qh=q.win||wh,pq=G.pickScattered({rgb:cellRGB,WC,x0:sx-(qw>>1),y0:sy-(qh>>1)+(q.win?0:2),w:qw,h:qh,maxPicks:q.n,minGap:3,prefer:G.binsNear(hue),exclude});
    pk.picks.push(...pq.picks);if(pk.hue<0){pk.hue=pq.hue;pk.colour=pq.colour;}}
  const tl=G.dreamTimeline(RM);
  // strokes: every lasso and every Evolve press, in order, with its time slot
  const strokes=[];
  const np=pk.picks.length,pd=(tl.pick[1]-tl.pick[0])/Math.max(1,np);
  pk.picks.forEach((p,q)=>strokes.push({kind:'loop',phase:'pick',t0:tl.pick[0]+q*pd,t1:tl.pick[0]+(q+1)*pd,centre:p,r:pickR}));
  const nC=tl.cycles.length;
  tl.cycles.forEach((c,k)=>{
    const L=(c.loopEnd-c.t0)/c.loops,u=nC>1?k/(nC-1):1;
    const zk=Math.exp(Math.log(zD)+(Math.log(zC44)-Math.log(zD))*ease(u));
    const rPx=26+u*16;                                             // loops ~26→42 screen px across the cycles
    for(let j=0;j<c.loops;j++)strokes.push({kind:'loop',phase:'cycle',cycle:k,j,t0:c.t0+j*L,t1:c.t0+(j+1)*L,r:Math.max(1.4,rPx/(zk*CS)),centre:null});
    strokes.push({kind:'evo',cycle:k,t0:c.loopEnd,t1:c.press});
  });
  return{S,fx:reg.fx,fy:reg.fy,form,hue,region:reg,mask,tune,hole,HX,HY,picks:pk.picks,pickBin:pk.hue,colour:pk.colour,zD,zC,zF,fit:fv,tl,strokes,si:0,
    cyc:[],ptr:null,pressUntil:-1,frozen:false,genMs:[],lassosApplied:0,evolves:0,
    caps:G.COPY.dream.map(c=>typeof c==='function'?c(form):c),
    pauseAt:Array.isArray(opts.pauseAt)?opts.pauseAt.slice().sort((a,b)=>a-b):null};   // opts.pauseAt: tests only
}
function capAt(t){const T=plan.tl;
  if(t<T.pick[0]) return t<T.zin[1]*0.5?0:1;
  if(t<T.cycles[0].t0) return RM&&t<T.pick[0]+0.6?0:2;
  if(t<T.zout[0]) return 3;
  if(t<T.fade[0]) return 4;
  return 5;
}
const ph=(t,[a,b])=>b<=a?(t>=a?1:0):Math.min(1,Math.max(0,(t-a)/(b-a)));

// ── state of the real canvas: snapshot at play, exact restore at the end ──
let S0=null;
function snapshotState(){
  const G=D(),fill=document.getElementById('affinFill'),ap=document.getElementById('affinPts');
  S0={cells:G.snapshotCells(cells),sum:G.checksumCells(cells),generation,owned:new Set(userOwnedCells),chosen:new Set(chosenCells),
    aff:affinityPerCell.slice(),score:userScore,log:generationLog.slice(),hist:historyLayers.length,arch:archive.length,recog:recogField.slice(),
    tool,fillBg:fill?fill.style.background:'',apColor:ap?ap.style.color:'',done:false};
}
function restoreState(){
  if(!S0||S0.done)return false;S0.done=true;
  const G=D();
  G.restoreCells(cells,S0.cells);
  generation=S0.generation;userOwnedCells=new Set(S0.owned);
  chosenCells.clear();for(const i of S0.chosen)chosenCells.add(i);
  affinityPerCell=S0.aff.slice();userScore=S0.score;generationLog=S0.log.slice();
  historyLayers.length=S0.hist;archive.length=S0.arch;recogField=S0.recog.slice();
  tool=S0.tool;lassoActive=false;lassoPts=[];lctx.clearRect(0,0,lassoC.width,lassoC.height);
  renderAll();updateStats();refreshAffinityHud();
  const fill=document.getElementById('affinFill'),ap=document.getElementById('affinPts');
  if(fill)fill.style.background=S0.fillBg;if(ap)ap.style.color=S0.apColor;
  const sf=document.getElementById('scoreFlash');if(sf){clearTimeout(sf._t);sf.className='';}
  return true;
}
function stateMatches(){
  if(!S0)return null;
  let aff=affinityPerCell.length===S0.aff.length;for(let i=0;aff&&i<S0.aff.length;i++)if(affinityPerCell[i]!==S0.aff[i])aff=false;
  const setEq=(a,b)=>{if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true;};
  return{cells:D().checksumCells(cells)===S0.sum,generation:generation===S0.generation,owned:setEq(userOwnedCells,S0.owned),chosen:setEq(chosenCells,S0.chosen),
    affinity:aff,score:userScore===S0.score,log:generationLog.length===S0.log.length,history:historyLayers.length===S0.hist,archive:archive.length===S0.arch,
    hudGen:document.getElementById('hudG').textContent===S0.generation.toLocaleString()};
}
// the cluster the dream holds now (real holds it added; not the visitor's own)
function dreamCluster(){
  const P=plan,M=P.S+24,x0=Math.max(0,P.fx-(M>>1)),y0=Math.max(0,P.fy-(M>>1)),x1=Math.min(WC,x0+M),y1=Math.min(WR,y0+M),out=[];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*WC+x;if(cells[i].s>0&&!S0.owned.has(i))out.push(i);}
  return out;
}
function formStats(cl){
  const P=plan,S=P.S,X0=P.fx-(S>>1),Y0=P.fy-(S>>1);let inF=0,red=0;
  for(const i of cl){const x=i%WC-X0,y=((i/WC)|0)-Y0;if(x>=0&&y>=0&&x<S&&y<S&&P.mask[y*S+x])inF++;}
  let formN=0;for(let y=0;y<S;y++)for(let x=0;x<S;x++){if(!P.mask[y*S+x])continue;formN++;const [r,g,b]=cellRGB((Y0+y)*WC+X0+x);if(D().familyScore(r,g,b,P.hue)>0.25)red++;}
  let inHole=0;if(P.hole)for(const i of cl)if(Math.hypot(i%WC+.5-P.HX,((i/WC)|0)+.5-P.HY)<P.hole.r)inHole++;
  return{held:cl.length,inForm:inF,outForm:cl.length-inF,inHole,formCover:+(inF/formN).toFixed(3),redInForm:+(red/formN).toFixed(3)};
}
function cycleTargets(k){
  const P=plan;if(P.cyc[k])return P.cyc[k];
  const cl=dreamCluster(),c=P.tl.cycles[k],st=P.strokes.filter(s=>s.cycle===k&&s.kind==='loop');
  const r=st.length?st[0].r:2;
  const tg=D().chooseCycleTargets({rgb:cellRGB,isHeld:i=>cells[i].s>0,cluster:cl.length?cl:P.picks,WC,WR,mask:P.mask,S:P.S,fx:P.fx,fy:P.fy,
    ring:Math.max(2,Math.round(r*0.9)),count:c.loops,minSep:Math.max(3,Math.round(r*1.3)),bias:1.0+k*0.25,fill:P.tune.fill,hue:P.hue,hole:P.hole,loopR:r});
  P.cyc[k]={k,dur:+c.dur.toFixed(3),loops:c.loops,targets:tg.map(o=>o.i),targetRed:+(tg.reduce((s,o)=>s+o.red,0)/Math.max(1,tg.length)).toFixed(3),
    targetsInForm:tg.filter(o=>o.inForm).length,before:formStats(cl),genBefore:generation};
  tg.forEach((o,j)=>{if(st[j]){st[j].centre=o.i;if(o.r)st[j].r=o.r;}});   // near the pupil a loop is smaller
  return P.cyc[k];
}
// What is held glows: each REAL held cell of the dream, lit in its own
// current colour (cell-aligned fills only, as the first-lasso glow does).
// Read from the live cells every frame, so the engine's changes show.
function litHeld(list,t){
  const t1=performance.now(),cp=zoom*CS,{w,h}=vpSize(),a=0.62;
  dctx.globalAlpha=a;let last='';
  for(const i of list){
    const x=(i%WC)*cp+panX,y=((i/WC)|0)*cp+panY;if(x<-cp||y<-cp||x>w||y>h)continue;
    const c=cells[i].c;if(c!==last){const [r,g,b]=D().brighten([hex2(c,1),hex2(c,3),hex2(c,5)],215);dctx.fillStyle=`rgb(${r|0},${g|0},${b|0})`;last=c;}
    dctx.fillRect(x,y,Math.max(1,cp),Math.max(1,cp));
  }
  dctx.globalAlpha=1;
  return performance.now()-t1;
}
const toScreen=p=>({x:p.x*CS*zoom+panX,y:p.y*CS*zoom+panY});
function strokePts(s){
  if(!s.pts){if(s.centre==null)return null;s.pts=D().loopPoints(s.centre%WC,(s.centre/WC)|0,s.r);}
  return s.pts;
}
function applyStroke(s){   // the real thing: a lasso through the app's own applyLasso, or one engine generation
  const P=plan;
  if(s.kind==='loop'){
    if(s.phase==='cycle')cycleTargets(s.cycle);
    const pts=strokePts(s);if(!pts)return 0;
    const t1=performance.now();
    lassoPts=pts.map(toScreen);applyLasso(false);lassoPts=[];P.lassosApplied++;P.lit=dreamCluster();
    return performance.now()-t1;
  }
  cycleTargets(s.cycle);
  const t1=performance.now();nextGen();const ms=performance.now()-t1;P.evolves++;P.genMs.push(+ms.toFixed(1));
  P.lit=dreamCluster();const c=P.cyc[s.cycle];c.genAfter=generation;c.after=formStats(P.lit);c.genMs=+ms.toFixed(1);
  P.pressUntil=(performance.now()-T0)/1000+0.16;
  window.__dreamLast.cycles=P.cyc.map(x=>({...x,targets:x.targets.length}));
  return ms;
}
function freeze(){   // the rewind: the last frame of the vision fades out over the restored canvas
  const P=plan;if(P.frozen)return;P.frozen=true;
  const t1=performance.now();
  if(dw.width!==WW||dw.height!==WH){dw.width=WW;dw.height=WH;}
  dw.style.left='0px';dw.style.top='0px';dw.style.width=WW+'px';dw.style.height=WH+'px';
  wctx.clearRect(0,0,WW,WH);wctx.drawImage(cvs,0,0);wctx.drawImage(ovl,0,0);
  if(P.lit){wctx.globalAlpha=0.62;for(const i of P.lit){const c=cells[i].c,[r,g,b]=D().brighten([hex2(c,1),hex2(c,3),hex2(c,5)],215);   // the lit held cells too
    wctx.fillStyle=`rgb(${r|0},${g|0},${b|0})`;wctx.fillRect((i%WC)*CS,((i/WC)|0)*CS,CS,CS);}wctx.globalAlpha=1;}
  dw.style.opacity='1';dw.style.display='block';
  window.__dreamLast.final=formStats(dreamCluster());
  restoreState();
  window.__dreamLast.restoredAt=+((performance.now()-T0)/1000).toFixed(2);
  return performance.now()-t1;
}
function frame(now){
  if(!playing)return;
  if(!T0){T0=now;frame.start=now;}      // the clock starts on the first frame (after the canvas has settled)
  let t=(now-T0)/1000;const P=plan,T=P.tl;
  if(P.pauseAt&&P.pauseAt.length&&t>=P.pauseAt[0]){t=P.pauseAt[0];T0=now-t*1000;window.__dreamLast.pausedAt=t;}   // tests only: hold a frame for a screenshot
  else if(window.__dreamLast.pausedAt!=null)window.__dreamLast.pausedAt=null;
  if(frames.n<4000){frames.dt[frames.n]=now-(frame.prev||now);}
  frame.prev=now;let pms=0;
  // 1. finish every stroke whose slot has passed (real lasso / real Evolve)
  while(P.si<P.strokes.length&&P.strokes[P.si].t1<=t){
    const s=P.strokes[P.si++],ms=applyStroke(s);pms+=ms;
    if(s.kind==='evo'){const c=T.cycles[s.cycle],slack=(c.t1-c.press)*1000,pause=Math.max(0,ms-slack);   // the engine first uses the rest after the press,
      T0+=pause;t=(now-T0)/1000;P.pauseMs=(P.pauseMs||0)+pause;dbg('gen'+s.cycle,ms);}                  // then the clock pauses (cadence kept on slow phones)
  }
  if(t>=T.fade[0]&&!P.frozen){pms+=freeze();}
  // 2. view: zoom in → hold deep for the picks → ease out as the cycles run → step back
  const {w,h}=vpSize(),vc={x:w/2,y:h/2},fwx=(P.fx+.5)*CS,fwy=(P.fy+.5)*CS;
  const C0=T.cycles[0].t0,C1=T.cycles[T.cycles.length-1].t1;
  let z;
  if(t<T.zin[1]&&!RM){
    const e=ease(ph(t,T.zin));z=Math.exp(Math.log(view0.z)+(Math.log(P.zD)-Math.log(view0.z))*e);
    const s0x=fwx*view0.z+view0.px,s0y=fwy*view0.z+view0.py;const sx=s0x+(vc.x-s0x)*e,sy=s0y+(vc.y-s0y)*e;
    setView(z,sx-fwx*z,sy-fwy*z);
  } else if(t<T.zout[0]){
    let u;
    if(RM){u=0;for(const c of T.cycles)if(t>=c.t0)u=c.k/Math.max(1,T.cycles.length-1);}   // cuts, one per cycle
    else u=ease(ph(t,[C0,C1]));
    z=Math.exp(Math.log(P.zD)+(Math.log(P.zC)-Math.log(P.zD))*u);setView(z,vc.x-fwx*z,vc.y-fwy*z);
  } else if(t<T.fade[0]){
    const e=RM?1:ease(ph(t,T.zout));z=Math.exp(Math.log(P.zC)+(Math.log(P.zF)-Math.log(P.zC))*e);setView(z,vc.x-fwx*z,vc.y-fwy*z);
  } else {
    const e=RM?0:ease(ph(t,T.fade));z=Math.exp(Math.log(P.zF)+(Math.log(P.fit.z)-Math.log(P.zF))*e);
    const s1x=fwx*P.fit.z+P.fit.px,s1y=fwy*P.fit.z+P.fit.py;const sx=vc.x+(s1x-vc.x)*e,sy=vc.y+(s1y-vc.y)*e;
    setView(z,sx-fwx*z,sy-fwy*z);
  }
  if(P.frozen)dw.style.opacity=String(1-(RM?ph(t,T.fade):ease(ph(t,T.fade))));
  // 3. the pointer and the lasso it is drawing (the app's own dashed lasso)
  sizeCanvas();dctx.clearRect(0,0,w,h);
  if(P.lit&&P.lit.length&&!P.frozen)pms+=litHeld(P.lit,t);
  let px=null,py=null,showL=false;const et=evoTarget();
  const s=P.si<P.strokes.length?P.strokes[P.si]:null;
  if(s&&t>=s.t0&&t<T.zout[0]){
    const u=(t-s.t0)/(s.t1-s.t0);
    if(s.kind==='loop'){
      if(s.phase==='cycle')cycleTargets(s.cycle);
      const pts=strokePts(s);
      if(pts){const sp=pts.map(toScreen);
        const tr=RM?0:0.28;              // travel to the loop, then draw it
        if(u<tr){const from=P.ptr||{x:sp[0].x-60,y:sp[0].y+70},e=ease(u/tr);px=from.x+(sp[0].x-from.x)*e;py=from.y+(sp[0].y-from.y)*e;}
        else{const f=RM?1:Math.min(1,(u-tr)/(1-tr)),n=Math.max(2,Math.ceil(f*sp.length));lassoPts=sp.slice(0,n);
          px=lassoPts[n-1].x;py=lassoPts[n-1].y;showL=true;}
      }
    } else {                              // to Evolve and press it
      const from=P.ptr||{x:w/2,y:h/2},e=RM?1:ease(Math.min(1,u/0.8));px=from.x+(et.x-from.x)*e;py=from.y+(et.y-from.y)*e;
    }
  } else if(P.pressUntil>t){px=et.x;py=et.y;}
  if(et.el)et.el.classList.toggle('dream-press',P.pressUntil>t||(s&&s.kind==='evo'&&t>=s.t0+(s.t1-s.t0)*0.82&&t<T.zout[0]));
  if(showL){const was=lassoActive;lassoActive=true;drawLasso();lassoActive=was;lassoPts=[];P.lassoShown=true;}
  else if(P.lassoShown){lctx.clearRect(0,0,lassoC.width,lassoC.height);P.lassoShown=false;}
  if(px!==null){drawPointer(px,py);P.ptr={x:px,y:py};}
  if(frames.n<4000){frames.paint[frames.n]=pms;frames.t[frames.n]=t;frames.n++;}
  // captions
  const ci=capAt(t);if(uiCap.dataset.i!==String(ci)){uiCap.dataset.i=String(ci);uiCap.textContent=P.caps[ci];}
  window.__dreamLast.t=+t.toFixed(2);
  if(t>=T.end){end('completed',true);return;}
  raf=requestAnimationFrame(frame);
}
const dbg=(w,ms)=>{if(ms>6&&window.__dreamDbg)__dreamDbg.push([+(T0?(performance.now()-T0)/1000:0).toFixed(2),w,+ms.toFixed(1)]);};
function drawPointer(x,y){
  dctx.save();
  if(COARSE){dctx.fillStyle='rgba(255,255,255,.28)';dctx.strokeStyle='rgba(255,255,255,.85)';dctx.lineWidth=2;
    dctx.beginPath();dctx.arc(x,y,13,0,Math.PI*2);dctx.fill();dctx.stroke();}
  else{dctx.translate(x,y);dctx.fillStyle='#fff';dctx.strokeStyle='#000';dctx.lineWidth=1.4;dctx.beginPath();
    dctx.moveTo(0,0);dctx.lineTo(0,17);dctx.lineTo(4.5,13);dctx.lineTo(8,20);dctx.lineTo(10.5,19);dctx.lineTo(7,12);dctx.lineTo(13,12);dctx.closePath();dctx.fill();dctx.stroke();}
  dctx.restore();
}

// ── play / end ──
function play(opts={}){
  if(playing||!D()||!(typeof userEra!=='undefined'&&userEra))return false;
  coach.classList.remove('on');
  if(typeof autoOn!=='undefined'&&autoOn)toggleAuto();
  stopCoachPulse();
  if(typeof lassoActive!=='undefined'&&lassoActive){lassoActive=false;lassoPts=[];stopAnim();}
  snapshotState();sumBefore=S0.sum;
  view0={z:zoom,px:panX,py:panY};
  plan=makePlan(opts);frames.n=0;frame.prev=0;frame.start=0;
  tool='lasso';
  dw.style.display='none';dw.style.opacity='1';
  document.body.classList.add('dreaming');
  uiTag.textContent=D().COPY.tag;uiSkip.textContent=D().COPY.skip;uiSkip.setAttribute('aria-label',D().COPY.skip+' (Esc)');
  uiCap.dataset.i='';uiCap.textContent=plan.caps[0];ui.classList.add('on');
  playing=true;T0=0;
  if(opts.replay){rec.replays++;}
  if(rec.dream==='none')rec.dream='playing';
  const T=plan.tl;
  window.__dreamLast={playing:true,mode:'engine',usedEngine:true,maskReveal:false,form:plan.form,S:plan.S,hue:plan.hue,region:plan.region,fx:plan.fx,fy:plan.fy,picks:plan.picks.length,pickBin:plan.pickBin,colour:plan.colour,
    reducedMotion:RM,sumBefore,genBefore:generation,
    timeline:{picks:[+T.pick[0].toFixed(2),+T.pick[1].toFixed(2)],cycles:T.cycles.map(c=>+c.dur.toFixed(2)),loops:T.cycles.map(c=>c.loops),
      zout:[+T.zout[0].toFixed(2),+T.zout[1].toFixed(2)],fade:[+T.fade[0].toFixed(2),+T.fade[1].toFixed(2)],end:+T.end.toFixed(2)},cycles:[]};
  raf=requestAnimationFrame(frame);
  return true;
}
function end(reason,restoreView){
  if(!playing)return;
  playing=false;cancelAnimationFrame(raf);
  const ms=T0?performance.now()-T0:0,wall=T0&&frame.start?performance.now()-frame.start:0;
  const P=plan;
  // put the real canvas back exactly as it was (cells + generation + holds + score + history)
  const fin=P&&!P.frozen?formStats(dreamCluster()):null;
  const restoredNow=restoreState();
  dw.style.display='none';wctx.clearRect(0,0,dw.width,dw.height);
  const et=evoTarget();if(et.el)et.el.classList.remove('dream-press');
  sizeCanvas();dctx.clearRect(0,0,dc.width,dc.height);ui.classList.remove('on');document.body.classList.remove('dreaming');
  updateStats();refreshAffinityHud();   // counters were frozen during the vision: live again (restored values)
  if(restoreView){const f=fitView();setView(f.z,f.px,f.py);} else if(typeof clamp==='function'){clamp();applyXform();}
  let sumAfter=D().checksumCells(cells),restored=false;
  if(sumAfter!==sumBefore){D().restoreCells(cells,S0.cells);restored=true;renderAll();sumAfter=D().checksumCells(cells);console.warn('dream: canvas restored from snapshot (fallback)');}
  const fr=stats(),match=stateMatches();
  window.__dreamLast={...window.__dreamLast,playing:false,reason,ms:Math.round(ms),wallMs:Math.round(wall),genMs:P?P.genMs:[],clockPauseMs:P?Math.round(P.pauseMs||0):0,genTotalMs:P?Math.round(P.genMs.reduce((a,b)=>a+b,0)):0,
    lassosApplied:P?P.lassosApplied:0,evolves:P?P.evolves:0,genPeak:P?(S0.generation+P.evolves):0,
    cycles:P?P.cyc.map(x=>({...x,targets:x.targets.length})):[],...(fin?{final:fin}:{}),
    sumBefore,sumAfter,equal:sumAfter===sumBefore,restored,restoreMatch:match,exact:!!match&&Object.values(match).every(Boolean),frames:fr};
  S0=null;
  ls.set(LS_SEEN,'1');
  if(rec.dream==='playing'||rec.dream==='none'){rec.dream=reason;rec.dreamMs=Math.round(wall);}
  saveRec();
  handover(reason);
}
function stats(){
  const n=frames.n;if(n<3)return{n};
  const dt=Array.from(frames.dt.subarray(1,n)).sort((a,b)=>a-b),pt=Array.from(frames.paint.subarray(0,n)).sort((a,b)=>a-b);
  const q=(a,p)=>+a[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(1);
  return{n,fps:+(1000/(dt.reduce((s,v)=>s+v,0)/dt.length)).toFixed(1),dtP50:q(dt,.5),dtP95:q(dt,.95),dtMax:q(dt,1),paintP50:q(pt,.5),paintP95:q(pt,.95),paintMax:q(pt,1),
    over33ms:dt.filter(v=>v>33.4).length,slowAt:Array.from(frames.dt.subarray(1,n)).map((v,i)=>[v,+frames.t[i+1].toFixed(2),+frames.paint[i+1].toFixed(1)]).filter(a=>a[0]>33.4).map(a=>[+a[0].toFixed(0),a[1],a[2]]).slice(0,40),
    worst:Array.from(frames.dt.subarray(0,n)).map((v,i)=>[+v.toFixed(0),+frames.t[i].toFixed(2)]).sort((a,b)=>b[0]-a[0]).slice(0,4)};
}

// ── interrupts: never block; any input ends it and passes through ──
function onInput(e){
  lastInput=performance.now();
  if(pending&&e.type!=='keydown'){pending=false;rec.dream='preempted';saveRec();handover('interrupted');return;}
  if(!playing){ if(attractT){clearTimeout(attractT);attractT=0;} return; }
  if(e.type==='keydown'){
    if(e.key==='Escape'){e.preventDefault();end('skipped',true);return;}
    if(e.key==='Tab'||(document.activeElement===uiSkip&&(e.key==='Enter'||e.key===' ')))return;
  }
  if(e.target&&(e.target===uiSkip||coach.contains(e.target)))return;
  end('interrupted',false);   // keep the view the visitor is in; the event continues to the canvas
}
['pointerdown','wheel','keydown','touchstart'].forEach(ev=>window.addEventListener(ev,onInput,{capture:true,passive:ev!=='keydown'}));

// ── hand-over: small corner hint, pulses only while idle ──
let lastInput=performance.now(),lastPulse=0,coachState='',pulseUntil=0,miniRAF=0,handAt=0,lassosAfter=0,firstGlowDone=false,evolvesAfter=0;
function setCoach(state,text){if(playing||pending)return;coachState=state;coachLine.textContent=text;if(!coachHidden)coach.classList.add('on');}
function handover(reason){
  coachAgain.textContent=D().COPY.replay;coachAgain.setAttribute('aria-label',D().COPY.replay);
  handAt=performance.now();rec.handoverAt=Date.now();
  if(IS_KIOSK){scheduleAttract();}
  if(rec.returning&&!IS_KIOSK&&lassosAfter>0){setCoach('quiet','');return;}
  if(reason==='interrupted'){setCoach('lasso',D().COPY.try.lasso);}
  else{setCoach('invite',D().COPY.try.invite);setTimeout(()=>{if(coachState==='invite')setCoach('lasso',D().COPY.try.lasso);},2600);}
}
function stopCoachPulse(){coach.classList.remove('pulse');pulseUntil=0;cancelAnimationFrame(miniRAF);}
setInterval(()=>{
  const now=performance.now();
  if(playing||!coach.classList.contains('on'))return;
  if(pulseUntil&&now>pulseUntil)stopCoachPulse();
  const lassoing=typeof lassoActive!=='undefined'&&lassoActive;
  if(!pulseUntil&&!lassoing&&coachState!=='quiet'&&now-lastInput>8000&&now-lastPulse>30000){lastPulse=now;pulseUntil=now+2800;coach.classList.add('pulse');runMini(now);}
},500);
function runMini(start){   // a 2.6 s mini-clip: a few same-colour pixels lassoed → Evolve → more neighbours → a patch grows, unevenly
  const W=128,H=88,C=4;const dots=[[13,10],[17,12],[14,14]];   // in 4-px cells
  const grow=[];for(let k=0;k<60;k++){const a=k*2.399,r=1+Math.sqrt(k)*0.9;grow.push([Math.round(15+Math.cos(a)*r*1.2),Math.round(12+Math.sin(a)*r*0.8)]);}
  const step=now=>{const t=(now-start)/1000;mctx.clearRect(0,0,W,H);mctx.fillStyle='#07070d';mctx.fillRect(0,0,W,H);
    for(let k=0;k<70;k++){const x=((k*37)%32)*C,y=((k*53)%22)*C;mctx.fillStyle=k%5?'#1a1a28':'#262640';mctx.fillRect(x,y,C,C);}
    const n=Math.min(3,Math.floor(t/0.3)),g=t<1.0?0:Math.min(grow.length,Math.floor((t-1.0)*(t-1.0)*26));   // faster each press
    mctx.fillStyle='#b23a48';for(let k=0;k<g;k++)if((k*7)%5)mctx.fillRect(grow[k][0]*C,grow[k][1]*C,C,C);
    dots.forEach(([x,y],k)=>{mctx.fillStyle=k<n?'#ff6f7d':'#8a3540';mctx.fillRect(x*C,y*C,C,C);});
    const pr=(t>1.0&&t<1.15)||(t>1.6&&t<1.72)||(t>2.05&&t<2.15);mctx.fillStyle=pr?'#e8d6a8':'rgba(232,214,168,.25)';mctx.fillRect(W-40,H-20,34,14);
    mctx.fillStyle=pr?'#0a0a14':'#e8d6a8';mctx.font='9px monospace';mctx.fillText('▶',W-27,H-9);
    if(t<2.8)miniRAF=requestAnimationFrame(step);};
  miniRAF=requestAnimationFrame(step);
}
function scheduleAttract(){   // kiosk: the vision is the attract loop, whenever the screen is idle
  clearTimeout(attractT);
  attractT=setTimeout(function again(){
    const lassoing=typeof lassoActive!=='undefined'&&lassoActive;
    if(!playing&&!lassoing&&performance.now()-lastInput>=20000)play({attract:true});
    else attractT=setTimeout(again,5000);
  },20000);
}

// ── hooks from app.html ──
function onLasso(era,idx){
  if(playing||era||!idx||!idx.length)return;
  lassosAfter++;
  const now=performance.now();
  if(rec.firstLassoMs===null&&rec.handoverAt){rec.firstLassoMs=Math.round(Date.now()-rec.handoverAt);rec.lassoWithin30s=rec.firstLassoMs<=30000;}
  // dominant hue of the COLOURED cells in the loop (tiny loops also catch dark neighbours)
  const bins=new Array(13).fill(0),sum=Array.from({length:13},()=>[0,0,0]);let sx=0,sy=0;
  for(const i of idx){const c=cells[i].c,r=hex2(c,1),g=hex2(c,3),b=hex2(c,5),k=D().hueBin(r,g,b)+1;bins[k]++;sum[k][0]+=r;sum[k][1]+=g;sum[k][2]+=b;sx+=i%WC;sy+=(i/WC)|0;}
  let hk=0;for(let k=1;k<13;k++)if(bins[k]>bins[hk]||(hk===0&&bins[k]>0))hk=k;
  const n=idx.length,nk=Math.max(1,bins[hk]),col=[sum[hk][0]/nk,sum[hk][1]/nk,sum[hk][2]/nk];
  const r=col[0],g=col[1],b=col[2];
  if(!rec.evolved&&rec.lassos.length<50)rec.lassos.push({cells:n,cx:sx/n,cy:sy/n,hue:hk-1,colour:col,cellPx:+(zoom*CS).toFixed(2)});
  if(!firstGlowDone){firstGlowDone=true;glowFamily(idx,[r,g,b]);}
  if(coachState==='lasso'||coachState==='invite')setCoach('evolve',D().COPY.try.evolve);
  saveRec();
}
function glowFamily(idx,col){   // first touch: the picked pixels glow and their colour family softly lights up
  const pts=idx.slice(0,400);
  const vr=vpSize(),x0=Math.max(0,Math.floor(-panX/(zoom*CS))),y0=Math.max(0,Math.floor(-panY/(zoom*CS)));
  const x1=Math.min(WC,Math.ceil((vr.w-panX)/(zoom*CS))),y1=Math.min(WR,Math.ceil((vr.h-panY)/(zoom*CS)));
  const stride=Math.max(1,Math.floor(Math.sqrt((x1-x0)*(y1-y0)/40000)));
  const fam=[];const own=new Set(pts);
  for(let y=y0;y<y1&&fam.length<300;y+=stride)for(let x=x0;x<x1&&fam.length<300;x+=stride){const i=y*WC+x;if(own.has(i))continue;const c=cells[i].c;
    const r=hex2(c,1),g=hex2(c,3),b=hex2(c,5);if(Math.max(r,g,b)<28)continue;if(Math.abs(r-col[0])+Math.abs(g-col[1])+Math.abs(b-col[2])<60)fam.push(i);}
  const start=performance.now(),dur=RM?700:1400,[br,bg,bb]=D().brighten(col,230);
  const step=now=>{if(playing)return;const t=(now-start)/dur;sizeCanvas();const {w,h}=vpSize();dctx.clearRect(0,0,w,h);if(t>=1)return;
    // cell-aligned fills only (the canvas's own grid), no circles or outlines
    const a=RM?0.6:Math.sin(Math.PI*t),cp=zoom*CS,sq=(i,al)=>{const x=(i%WC)*CS*zoom+panX,y=((i/WC)|0)*CS*zoom+panY;
      dctx.globalAlpha=al;dctx.fillRect(x,y,Math.max(1,cp),Math.max(1,cp));};
    dctx.fillStyle=`rgb(${br|0},${bg|0},${bb|0})`;for(const i of fam)sq(i,0.5*a);
    for(const i of pts.slice(0,400))sq(i,0.85*a);
    dctx.globalAlpha=1;
    requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
function onEvolve(){
  if(playing)return;
  evolvesAfter++;
  if(!rec.evolved&&rec.handoverAt){
    rec.evolved=true;
    const tq=D().usedTechnique(rec.lassos,true);rec.technique=tq;rec.usedTechnique=tq.used;saveRec();
  }
  if(evolvesAfter===1&&userOwnedCells&&userOwnedCells.size>0){   // first Evolve: step back to see the patch at a distance
    const f=fitView(),z0=zoom,p0x=panX,p0y=panY;
    if(RM||Math.abs(z0-f.z)<1e-3)setView(f.z,f.px,f.py);
    else{const st=performance.now(),dur=1100;const step=now=>{const e=ease(Math.min(1,(now-st)/dur));const z=Math.exp(Math.log(z0)+(Math.log(f.z)-Math.log(z0))*e);
      setView(z,p0x+(f.px-p0x)*e,p0y+(f.py-p0y)*e);if(e<1)requestAnimationFrame(step);else window.__dreamZoomedOut=true;};requestAnimationFrame(step);}
    if(RM)window.__dreamZoomedOut=true;
    if(coachState&&coachState!=='quiet')setCoach('held',D().COPY.try.held);
  } else if(evolvesAfter>=2&&coachState==='held'&&!IS_KIOSK){setCoach('pass',D().COPY.try.pass);}
}
function onShare(){rec.shared=true;saveRec();}
function overCapLine(){return D()?D().COPY.try.overCap:null;}
// After the intro / on load: first visit → the vision; returning → just the quiet replay control.
function afterIntro(){
  // The vision replaces the text onboarding panel (it would cover the canvas).
  const ob=document.getElementById('onboard');if(ob){ob.classList.add('done');ob.style.display='none';}
  rec.hint=typeof hintNow==='function'?hintNow():'';
  coachAgain.textContent=D()?D().COPY.replay:'See the vision again';
  const auto=QD==='1'||IS_KIOSK||(QD!=='0'&&!rec.returning);
  if(auto&&D()){
    // start once the page has settled after the intro (no first-frame stall);
    // if the visitor touches the canvas first, they've begun — no vision.
    const t0=performance.now();pending=true;
    const go=()=>{if(!pending)return;pending=false;if(!play({auto:true}))setCoach('quiet','');};
    setTimeout(()=>{(window.requestIdleCallback||(f=>setTimeout(f,0)))(go,{timeout:1200});},450);
    return true;
  }
  setCoach('quiet','');saveRec();return false;
}
window.addEventListener('pagehide',()=>{if(playing)end('interrupted',false);saveRec();});
window.DREAM={play,skip:()=>end('skipped',true),resume:()=>{if(plan&&plan.pauseAt)plan.pauseAt.shift();},afterIntro,onLasso,onEvolve,onShare,overCapLine,get playing(){return playing;},get t(){return playing&&T0?(performance.now()-T0)/1000:0;},stats,rec};
})();
