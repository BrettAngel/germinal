// PROTOTYPE (variant B branch) — "Dream it" onboarding (app.html).
// A labelled 8–12 s vision played on the visitor's ACTUAL current canvas:
//   (a) zoom into the noise  (b) a visible pointer lassos a few scattered
//   pixels of one colour  (c) it presses Evolve, they hold and spread
//   (d) zoom out: in this vision, a form — then it fades fully back.
// It never writes to `cells` or to the real canvas: the vision is painted into
// its own transparent layer (#dreamW, above #cvs in the world) over one
// region; the bloom is a CSS radial mask and the fade a CSS opacity, so the
// phone's compositor does the per-frame work. The real cells are checksummed
// before/after (and restored from a snapshot if ever different). It never blocks: the overlay ignores
// pointer events, Skip is visible from the first frame, and any tap, scroll or
// key (Esc = skip) ends it immediately and passes through to the canvas.
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
.dream-press{box-shadow:0 0 0 3px rgba(232,214,168,.9),0 0 18px rgba(232,214,168,.8)!important;transform:scale(.94);}
@media (prefers-reduced-motion: reduce){#dreamCoach,#dreamUI .dcap{transition:none;}}
`;
document.head.appendChild(css);
const vpEl=document.getElementById('vp');
const dc=document.createElement('canvas');dc.id='dreamC';dc.setAttribute('aria-hidden','true');vpEl.appendChild(dc);
const dctx=dc.getContext('2d');
const dw=document.createElement('canvas');dw.id='dreamW';dw.setAttribute('aria-hidden','true');
dw.style.cssText='position:absolute;left:0;top:0;display:none;pointer-events:none;image-rendering:pixelated;image-rendering:crisp-edges;';
document.getElementById('cvs').insertAdjacentElement('afterend',dw);const wctx=dw.getContext('2d');
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
let pending=false,playing=false,raf=0,T0=0,plan=null,snap=null,sumBefore='',view0=null,coachHidden=false,attractT=0;
const frames={dt:new Float32Array(4000),paint:new Float32Array(4000),t:new Float32Array(4000),n:0};
let img=null,imgS=0,orig=null,alpha=null,grow=null,mask=null,jit=null;   // reused buffers
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
function makePlan(){
  const G=D(),rnd=Math.random;
  let last=null;try{last=JSON.parse(ls.get(LS_LAST)||'null');}catch(e){}
  const S=340;
  const reg=G.chooseRegion({rand:rnd,last,S,WC,WR});
  const form=G.chooseForm(rnd,last&&last.form);
  ls.set(LS_LAST,JSON.stringify({fx:reg.fx,fy:reg.fy,form}));
  const X0=reg.fx-(S>>1),Y0=reg.fy-(S>>1);
  dw.style.left=(X0*CS)+'px';dw.style.top=(Y0*CS)+'px';dw.style.width=(S*CS)+'px';dw.style.height=(S*CS)+'px';
  // region buffers (reused across dreams)
  if(!orig||imgS!==S){orig=new Uint8Array(S*S*3);alpha=new Float32Array(S*S);grow=new Float32Array(S*S);jit=new Float32Array(S*S);
    img=wctx.createImageData(S*CS,S*CS);imgS=S;}
  dw.width=S*CS;dw.height=S*CS;img.data.fill(0);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const i=(Y0+y)*WC+X0+x,c=cells[i].c,k=(y*S+x)*3;orig[k]=hex2(c,1);orig[k+1]=hex2(c,3);orig[k+2]=hex2(c,5);
    const h=Math.imul((i+1)*2654435761,1597334677)>>>0;jit[y*S+x]=(h&1023)/1023;}
  mask=G.formMask(form,S);grow.fill(0);alpha.fill(0);
  // deep zoom: ~18 screen px per cell; picks inside the visible window
  const {w,h}=vpSize();const zD=Math.min(ZMAX,18/CS);const cw=Math.max(8,Math.floor(w/(zD*CS))),ch=Math.max(8,Math.floor(h/(zD*CS)));
  // picks in the middle of the view: clear of the caption / Skip at the top and the toolbar below
  const ww=Math.max(6,Math.min(cw-6,30)),wh=Math.max(6,Math.min(Math.floor(ch*0.5),30));
  const rgb=i=>{const lx=i%WC-X0,ly=((i/WC)|0)-Y0,k=(ly*S+lx)*3;return[orig[k],orig[k+1],orig[k+2]];};
  const pk=G.pickScattered({rgb,WC,x0:reg.fx-(ww>>1),y0:reg.fy-(wh>>1)+1,w:ww,h:wh,maxPicks:5,minGap:3});
  const colour=G.brighten(pk.colour.map(v=>Math.max(v,8)),215);
  const fv=fitView();
  return{S,X0,Y0,fx:reg.fx,fy:reg.fy,form,picks:pk.picks,colour,zD,fit:fv,
    caps:G.COPY.dream.map(c=>typeof c==='function'?c(form):c)};
}
// Timeline (seconds). Normal ≈ 11.6 s, 4 beats; reduced motion ≈ 6.5 s of still cuts.
const TL=RM?{zin:[0,0],pick:[0,2.2],evo:[2.2,3.6],zout:[3.6,5.6],fade:[5.6,6.5],end:6.5}
           :{zin:[0,2.4],pick:[2.4,5.6],evo:[5.6,7.8],zout:[7.8,10.4],fade:[10.4,11.6],end:11.6};
function capAt(t){
  if(t<TL.pick[0]) return t<TL.zin[1]*0.5?0:1;
  if(t<TL.evo[0]) return RM&&t<1.1?0:2;
  if(t<TL.zout[0]) return 3;
  if(t<TL.fade[0]) return 4;
  return 5;
}
const ph=(t,[a,b])=>b<=a?(t>=a?1:0):Math.min(1,Math.max(0,(t-a)/(b-a)));

// ── painting (only the vision region; only what changed) ──
function paint(rx0,ry0,rw,rh){
  const t0=performance.now(),S=plan.S,d=img.data,W=S*CS,[cr,cg,cb]=plan.colour;
  for(let y=ry0;y<ry0+rh;y++)for(let x=rx0;x<rx0+rw;x++){
    const li=y*S+x,a=alpha[li],j=0.62+0.38*jit[li];
    const r=cr*j,g=cg*j,b=cb*j,A=Math.round(Math.min(1,a)*255);   // source-over ⇒ lerp(real, vision, a)
    for(let yy=0;yy<CS;yy++){let p=((y*CS+yy)*W+x*CS)*4;for(let xx=0;xx<CS;xx++){d[p]=r;d[p+1]=g;d[p+2]=b;d[p+3]=A;p+=4;}}
  }
  wctx.putImageData(img,0,0,rx0*CS,ry0*CS,rw*CS,rh*CS);
  return performance.now()-t0;
}
let lastFull=0,growBox=null,formDone=false;
function setMask(r){const v=r>=140?'none':`radial-gradient(closest-side,#000 ${r.toFixed(1)}%,transparent ${(r+22).toFixed(1)}%)`;
  dw.style.webkitMaskImage=v;dw.style.maskImage=v;}
function frame(now){
  if(!playing)return;
  if(!T0){T0=now;}                      // the clock starts on the first frame (after the canvas has settled)
  const t=(now-T0)/1000,P=plan,S=P.S;
  if(frames.n<4000){frames.dt[frames.n]=now-(frame.prev||now);}
  frame.prev=now;let pms=0;
  // view
  const vc={x:vpSize().w/2,y:vpSize().h/2},fwx=(P.fx+.5)*CS,fwy=(P.fy+.5)*CS;
  if(t<TL.zin[1]||RM&&t<TL.zout[0]){
    const e=RM?1:ease(ph(t,TL.zin));const z=Math.exp(Math.log(view0.z)+(Math.log(P.zD)-Math.log(view0.z))*e);
    const s0x=fwx*view0.z+view0.px,s0y=fwy*view0.z+view0.py;const sx=s0x+(vc.x-s0x)*e,sy=s0y+(vc.y-s0y)*e;
    setView(z,sx-fwx*z,sy-fwy*z);
  } else if(t<TL.zout[0]) setView(P.zD,vc.x-fwx*P.zD,vc.y-fwy*P.zD);
  else {
    const e=RM?1:ease(ph(t,TL.zout));const z=Math.exp(Math.log(P.zD)+(Math.log(P.fit.z)-Math.log(P.zD))*e);
    const s1x=fwx*P.fit.z+P.fit.px,s1y=fwy*P.fit.z+P.fit.py;const sx=vc.x+(s1x-vc.x)*e,sy=vc.y+(s1y-vc.y)*e;
    setView(z,sx-fwx*z,sy-fwy*z);
  }
  // picks → highlighted (held) pixels
  const np=P.picks.length,pickDur=(TL.pick[1]-TL.pick[0])/Math.max(1,np);
  const picked=RM?(t>=TL.pick[0]?np:0):Math.min(np,Math.floor(Math.max(0,t-TL.pick[0])/pickDur+0.0001+(t>=TL.pick[1]?1:0)));
  // growth after each Evolve press (2 presses)
  const ev=ph(t,TL.evo),press1=0.28,press2=0.66;
  const gR=RM?(t>=TL.evo[0]?4.8:0):(ev<press1?0:ev<press2?2.4*sm(press1,press1+.25,ev):2.4+2.4*sm(press2,press2+.25,ev));
  const fz=t>=TL.zout[0]?(RM?1:ease(ph(t,TL.zout))):0;
  const fade=t>=TL.fade[0]?(RM?1:ease(ph(t,TL.fade))):0;
  // growth: repaint the small box around the picks each frame; the form is
  // painted ONCE, then revealed by a CSS mask and faded by CSS opacity.
  const needFull=t>=TL.zout[0];
  if(!needFull){
    if(!growBox){let a=1e9,b=1e9,c=-1,dd=-1;for(const p of P.picks){const lx=p%WC-P.X0,ly=((p/WC)|0)-P.Y0;a=Math.min(a,lx);b=Math.min(b,ly);c=Math.max(c,lx);dd=Math.max(dd,ly);}
      const m=7;growBox=[Math.max(0,a-m),Math.max(0,b-m),Math.min(S-1,c+m),Math.min(S-1,dd+m)];}
    const [a,b,c,dd]=growBox;
    for(let y=b;y<=dd;y++)for(let x=a;x<=c;x++){let g=0;
      for(let q=0;q<np;q++){const p=P.picks[q],dx=x-(p%WC-P.X0),dy=y-(((p/WC)|0)-P.Y0),dist=Math.hypot(dx,dy);
        if(q<picked&&dist<0.5)g=1;else if(gR>0&&q<picked)g=Math.max(g,sm(gR,gR-1.6,dist)*(jit[y*S+x]>0.2?0.95:0.35));}
      grow[y*S+x]=g;alpha[y*S+x]=g;}
    pms=paint(a,b,c-a+1,dd-b+1);
  } else {
    if(!formDone){formDone=true;
      for(let li=0;li<S*S;li++)alpha[li]=Math.max(grow[li],mask[li]*(0.55+0.45*jit[li]));
      pms=paint(0,0,S,S);}
    setMask(RM?200:fz*130-22);
    dw.style.opacity=String(1-fade);
  }
  if(frames.n<4000){frames.paint[frames.n]=pms;frames.t[frames.n]=t;frames.n++;}
  // overlay: rings, the pointer drawing each lasso, the Evolve press
  sizeCanvas();const {w,h}=vpSize();dctx.clearRect(0,0,w,h);
  const cellPx=zoom*CS;
  if(t<TL.zout[0]+0.4){
    dctx.lineWidth=2;
    for(let q=0;q<picked;q++){const s=cellScreen(P.picks[q]);dctx.strokeStyle='rgba(232,214,168,'+(0.9-0.5*fz)+')';
      dctx.beginPath();dctx.arc(s.x,s.y,Math.max(4,cellPx*0.95),0,Math.PI*2);dctx.stroke();}
  }
  let px=null,py=null;
  if(t>=TL.pick[0]&&t<TL.pick[1]&&np&&!RM){
    const q=Math.min(np-1,Math.floor((t-TL.pick[0])/pickDur)),u=((t-TL.pick[0])-q*pickDur)/pickDur;
    const s=cellScreen(P.picks[q]),prev=q?cellScreen(P.picks[q-1]):{x:s.x-60,y:s.y+70};
    const rr=Math.max(9,cellPx*1.35);
    if(u<0.4){const e=ease(u/0.4);px=prev.x+(s.x+rr-prev.x)*e;py=prev.y+(s.y-prev.y)*e;}
    else{const a=(u-0.4)/0.6*Math.PI*2;px=s.x+Math.cos(a)*rr;py=s.y+Math.sin(a)*rr;
      dctx.save();dctx.setLineDash([4,4]);dctx.strokeStyle='rgba(220,196,128,.95)';dctx.lineWidth=2;dctx.beginPath();dctx.arc(s.x,s.y,rr,0,a);dctx.stroke();dctx.restore();}
  }
  const et=evoTarget();
  if(t>=TL.evo[0]&&t<TL.zout[0]){
    if(!RM){const k=ev<0.2?ease(ev/0.2):1,from=np?cellScreen(P.picks[np-1]):{x:w/2,y:h/2};px=from.x+(et.x-from.x)*k;py=from.y+(et.y-from.y)*k;}
    else{px=et.x;py=et.y;}
    const pressed=(ev>=press1&&ev<press1+0.12)||(ev>=press2&&ev<press2+0.12)||RM;
    if(et.el)et.el.classList.toggle('dream-press',pressed);
    if(pressed){dctx.strokeStyle='rgba(232,214,168,.8)';dctx.lineWidth=2;dctx.beginPath();dctx.arc(et.x,et.y,22,0,Math.PI*2);dctx.stroke();}
  } else if(et.el)et.el.classList.remove('dream-press');
  if(px!==null)drawPointer(px,py);
  // captions
  const ci=capAt(t);if(uiCap.dataset.i!==String(ci)){uiCap.dataset.i=String(ci);uiCap.textContent=P.caps[ci];}
  if(t>=TL.end){end('completed',true);return;}
  raf=requestAnimationFrame(frame);
}
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
  snap=D().snapshotCells(cells);sumBefore=D().checksumCells(cells);
  view0={z:zoom,px:panX,py:panY};
  plan=makePlan();growBox=null;formDone=false;frames.n=0;frame.prev=0;lastFull=0;
  dw.style.opacity='1';setMask(200);dw.style.display='block';
  uiTag.textContent=D().COPY.tag;uiSkip.textContent=D().COPY.skip;uiSkip.setAttribute('aria-label',D().COPY.skip+' (Esc)');
  uiCap.dataset.i='';uiCap.textContent=plan.caps[0];ui.classList.add('on');
  playing=true;T0=0;
  if(opts.replay){rec.replays++;}
  if(rec.dream==='none')rec.dream='playing';
  window.__dreamLast={playing:true,form:plan.form,fx:plan.fx,fy:plan.fy,picks:plan.picks.length,colour:plan.colour,reducedMotion:RM,sumBefore};
  raf=requestAnimationFrame(frame);
  return true;
}
function end(reason,restoreView){
  if(!playing)return;
  playing=false;cancelAnimationFrame(raf);
  const ms=T0?performance.now()-T0:0;
  // withdraw the vision: the layer goes; the real canvas was never painted
  dw.style.display='none';wctx.clearRect(0,0,dw.width,dw.height);
  const et=evoTarget();if(et.el)et.el.classList.remove('dream-press');
  sizeCanvas();dctx.clearRect(0,0,dc.width,dc.height);ui.classList.remove('on');
  if(restoreView){const f=fitView();setView(f.z,f.px,f.py);} else if(typeof clamp==='function'){clamp();applyXform();}
  const sumAfter=D().checksumCells(cells);let restored=false;
  if(sumAfter!==sumBefore){D().restoreCells(cells,snap);restored=true;renderAll();console.warn('dream: canvas restored from snapshot');}
  const fr=stats();
  window.__dreamLast={...window.__dreamLast,playing:false,reason,ms:Math.round(ms),sumBefore,sumAfter:D().checksumCells(cells),equal:sumAfter===sumBefore,restored,frames:fr};
  snap=null;
  ls.set(LS_SEEN,'1');
  if(rec.dream==='playing'||rec.dream==='none'){rec.dream=reason;rec.dreamMs=Math.round(ms);}
  saveRec();
  handover(reason);
}
function stats(){
  const n=frames.n;if(n<3)return{n};
  const dt=Array.from(frames.dt.subarray(1,n)).sort((a,b)=>a-b),pt=Array.from(frames.paint.subarray(0,n)).sort((a,b)=>a-b);
  const q=(a,p)=>+a[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(1);
  return{n,fps:+(1000/(dt.reduce((s,v)=>s+v,0)/dt.length)).toFixed(1),dtP50:q(dt,.5),dtP95:q(dt,.95),dtMax:q(dt,1),paintP50:q(pt,.5),paintP95:q(pt,.95),paintMax:q(pt,1),
    over33ms:dt.filter(v=>v>33.4).length,
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
function runMini(start){   // a 2.6 s mini-clip: tap a few same-colour dots → Evolve → they grow
  const W=128,H=88;const dots=[[30,30],[52,58],[78,34],[96,62]];
  const step=now=>{const t=(now-start)/1000;mctx.clearRect(0,0,W,H);mctx.fillStyle='#07070d';mctx.fillRect(0,0,W,H);
    for(let k=0;k<70;k++){const x=(k*37)%W,y=(k*53)%H;mctx.fillStyle=k%5?'#1a1a28':'#262640';mctx.fillRect(x,y,3,3);}
    const n=Math.min(4,Math.floor(t/0.35));const g=t>1.8?Math.min(1,(t-1.8)/0.6):0;
    dots.forEach(([x,y],k)=>{mctx.fillStyle='#4fbf7a';if(g>0){mctx.globalAlpha=.55;mctx.beginPath();mctx.arc(x,y,3+9*g,0,7);mctx.fill();mctx.globalAlpha=1;}
      mctx.fillRect(x-2,y-2,4,4);if(k<n){mctx.strokeStyle='#e8d6a8';mctx.lineWidth=2;mctx.beginPath();mctx.arc(x,y,7,0,7);mctx.stroke();}});
    const pr=t>1.5&&t<1.8;mctx.fillStyle=pr?'#e8d6a8':'rgba(232,214,168,.25)';mctx.fillRect(W-40,H-20,34,14);
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
    const a=RM?0.6:Math.sin(Math.PI*t),cp=Math.max(3,zoom*CS);
    dctx.fillStyle=`rgba(${br|0},${bg|0},${bb|0},${(0.55*a).toFixed(3)})`;for(const i of fam){const s=cellScreen(i);dctx.beginPath();dctx.arc(s.x,s.y,cp*0.9,0,7);dctx.fill();}
    dctx.strokeStyle=`rgba(255,240,200,${(0.9*a).toFixed(3)})`;dctx.lineWidth=2;for(const i of pts.slice(0,120)){const s=cellScreen(i);dctx.beginPath();dctx.arc(s.x,s.y,cp*1.1,0,7);dctx.stroke();}
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
window.DREAM={play,skip:()=>end('skipped',true),afterIntro,onLasso,onEvolve,onShare,overCapLine,get playing(){return playing;},get t(){return playing&&T0?(performance.now()-T0)/1000:0;},stats,rec};
})();
