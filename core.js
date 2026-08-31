/* ============================================================
   OVERLOAD — core.
   Everything both feature modules stand on: storage, the view router, the
   bottom nav, the export envelope, and the PWA shell.

   Feature modules register into core; core knows about none of them by name.
   That is what lets the nutrition module exist without the workout module
   ever referring to it.
   ============================================================ */

/* ---------- IndexedDB key-value store ----------
   Replaces the artifact sandbox's window.storage. Values are stored as live
   objects (structured clone) rather than JSON strings — one less serialise
   round-trip, and the browser handles the cloning. S.get/set/del keep their
   original signatures; no call site changed. */
const IDB = (()=>{
  const NAME='overload', STORE='kv', VER=1;
  let dbp=null;
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((res,rej)=>{
      let req;
      if(!self.indexedDB) return rej(new Error('IndexedDB unavailable (private window?)'));
      try{ req = indexedDB.open(NAME,VER); }catch(e){ return rej(e); }
      req.onupgradeneeded = ()=>{ const db=req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess = ()=>{ const db=req.result;
        db.onversionchange = ()=>{ db.close(); dbp=null; };
        res(db); };
      req.onerror   = ()=> rej(req.error || new Error('IndexedDB open failed'));
      req.onblocked = ()=> rej(new DOMException('Another tab is holding an older version of the database open.','InvalidStateError'));
    });
    dbp.catch(()=>{ dbp=null; });   // let the next call retry a failed open
    return dbp;
  }
  const run = async (mode, fn)=>{
    const db = await open();
    return new Promise((res,rej)=>{
      let t; try{ t = db.transaction(STORE,mode); }catch(e){ return rej(e); }
      let rq; try{ rq = fn(t.objectStore(STORE)); }catch(e){ return rej(e); }
      t.oncomplete = ()=> res(rq ? rq.result : undefined);
      t.onerror    = ()=> rej(t.error);
      t.onabort    = ()=> rej(t.error);
    });
  };
  return {
    get : k     => run('readonly',  st=>st.get(k)),
    set : (k,v) => run('readwrite', st=>st.put(v,k)),
    del : k     => run('readwrite', st=>st.delete(k)),
    keys: ()    => run('readonly',  st=>st.getAllKeys()),
    clear:()    => run('readwrite', st=>st.clear())
  };
})();

const S = {
  mem:{}, pending:0,
  async get(k){ if(k in this.mem) return this.mem[k];
    try{ const v = await IDB.get(k); this.mem[k] = (v===undefined? null : v); return this.mem[k]; }
    catch(e){ storageFault('read',e); this.mem[k]=null; return null; } },
  async set(k,v){ this.mem[k]=v; this.pending++; syncDot();
    try{ await IDB.set(k,v); retryQ.delete(k); clearFault(); }
    catch(e){ storageFault('write',e); queueRetry(k); }
    finally{ this.pending--; syncDot(); } },
  async del(k){ delete this.mem[k]; retryQ.delete(k);
    try{ await IDB.del(k); }catch(e){ storageFault('delete',e); } }
};

/* A failed write is never silent: the retry queue keeps trying, and anything
   the queue cannot fix (quota, blocked upgrade, private browsing) puts a
   banner on screen that stays until a write succeeds. */
const retryQ = new Set();
function queueRetry(k){ retryQ.add(k); syncDot(); }
setInterval(async()=>{ if(!retryQ.size) return;
  for(const k of [...retryQ]){
    try{ await IDB.set(k,S.mem[k]); retryQ.delete(k); }catch(e){}
  }
  syncDot(); if(!retryQ.size) clearFault(); },5000);
function syncDot(){ const el=document.getElementById('syncdot'); if(!el)return;
  el.style.display = retryQ.size? 'inline':'none'; }

let faultShown='';
function storageFault(op,err){
  const name = (err && (err.name||err.message)) || 'Unknown error';
  const quota = /quota/i.test(name) || name==='QuotaExceededError';
  const blocked = name==='InvalidStateError' || /blocked/i.test(String(err&&err.message));
  const msg = quota
    ? '<b>Storage full.</b> This device will not accept more data. Export your log from Settings, then delete old sessions to free space.'
    : blocked
      ? '<b>Database blocked.</b> Overload is open in another tab with a different version. Close the other tab and reload.'
      : '<b>Could not '+op+' your data.</b> '+esc(name)+' — retrying every 5s. Do not clear the app until this clears.';
  if(msg===faultShown) return;
  faultShown = msg;
  const el=document.getElementById('fault'); if(!el) return;
  el.innerHTML = '<button onclick="clearFault(true)">Dismiss</button>'+msg;
  el.style.display='block';
}
function clearFault(manual){
  if(!manual && retryQ.size) return;
  faultShown=''; const el=document.getElementById('fault');
  if(el){ el.style.display='none'; el.innerHTML=''; }
}

/* ------------------------------------------------------------------ helpers */
const uid = ()=> Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round1 = n => Math.round(n*10)/10;
const fmtW = n => (n==null||n==='')?'—':(Number.isInteger(+n)? ''+n : round1(+n));
/* Local time, deliberately. toISOString() is UTC: in IST that dates anything
   logged before 05:30 to the previous day. */
const today = (d=new Date())=> d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const dLabel = d => new Date(d+'T00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'});
const daysBetween = (a,b)=> Math.round((new Date(b)-new Date(a))/864e5);
const shiftDay = (d,n)=>{ const x=new Date(d+'T00:00'); x.setDate(x.getDate()+n); return today(x); };

function toast(msg,pr=false){
  document.querySelector('.toast')?.remove();
  const d=document.createElement('div'); d.className='toast'+(pr?' pr':''); d.textContent=msg;
  document.body.appendChild(d); setTimeout(()=>d.remove(),2600);
}

/* ============================== view router ==============================
   Modules call registerView / registerTab. Core never names a view itself. */
const ROUTES = {};
const TABS = [];
let VIEW = { name:null };

function registerView(name, fn, opts={}){ ROUTES[name] = { fn, opts }; }
function registerTab(t){ TABS.push(t); TABS.sort((a,b)=>a.order-b.order); }
const homeView = ()=> (TABS[0] && TABS[0].key) || Object.keys(ROUTES)[0];

function render(){
  if(!VIEW.name) VIEW.name = homeView();
  const r = ROUTES[VIEW.name] || ROUTES[homeView()];
  if(!r){ document.getElementById('app').innerHTML=''; return; }
  document.getElementById('app').innerHTML = r.fn() + (r.opts.chrome===false ? '' : tabs());
  if(r.opts.after) r.opts.after();
  window.scrollTo(0, VIEW.scroll||0);
}
const go = (name,p={})=>{ VIEW={name,...p}; render(); };

function tabs(){
  const cells = TABS.map(t=>{
    const on = VIEW.name===t.key || (t.owns||[]).includes(VIEW.name);
    return `<button class="${on?'on':''}" onclick="go('${t.key}')">${esc(t.label)}</button>`;
  }).join('');
  return `<nav class="tabs"><div class="in" style="grid-template-columns:repeat(${TABS.length},1fr)">${cells}</div></nav>`;
}

function closeSheet(){ document.querySelector('.sheet')?.remove(); }

/* Modules add their own cards to the Settings screen without Settings knowing
   who they are. */
const SETTINGS_CARDS = [];
function registerSettingsCard(fn){ SETTINGS_CARDS.push(fn); }
const settingsExtras = ()=> SETTINGS_CARDS.map(f=>{ try{ return f(); }catch(e){ return ''; } }).join('');

/* Same idea for the home screen. Bodyweight belongs to neither training nor
   food — it is the one measurement that judges both — so it lives in its own
   module and registers a card here rather than being wired into either. */
const HOME_CARDS = [];
function registerHomeCard(fn){ HOME_CARDS.push(fn); }
const homeExtras = ()=> HOME_CARDS.map(f=>{ try{ return f(); }catch(e){ return ''; } }).join('');

function head(eyebrow,title,right=''){
  return `<header class="top"><div class="wrap"><div class="between"><div>
    <span class="eyebrow">${esc(eyebrow)}<span id="syncdot" style="display:none;color:var(--yellow)"> • saving</span></span>
    <h1>${esc(title)}</h1></div>${right}</div></div></header>`;
}

/* ========================= export / import envelope =========================
   Each module contributes its own slice and takes it back. Core owns only the
   envelope, so adding a module does not touch any existing module's code. */
const EXPORT_V = 3;      // v1 workout only; v2 adds `nutrition`; v3 adds `body`.
const DATA = [];
function registerData(c){ DATA.push(c); }

async function exportData(){
  const out = { v:EXPORT_V, exportedAt:new Date().toISOString() };
  for(const c of DATA) Object.assign(out, await c.collect());
  const blob = JSON.stringify(out,null,1);
  try{ await navigator.clipboard.writeText(blob); toast('Copied to clipboard.'); }catch(e){}
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([blob],{type:'application/json'}));
  a.download='overload-'+today()+'.json'; a.click();
}

/* Import accepts a file (the only workable route on a phone — a whole export
   will not fit through prompt()) and falls back to pasting. Both old and new
   envelope versions are accepted. */
function importData(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='application/json,.json';
  inp.onchange=async()=>{ const f=inp.files&&inp.files[0]; if(!f) return;
    try{ await applyImport(await f.text()); }catch(e){ toast('Could not read that file.'); } };
  inp.click();
  toast('Pick your overload-….json backup.');
}
function importPaste(){
  const txt=prompt('Paste an exported JSON backup. This replaces everything currently stored.');
  if(txt) applyImport(txt);
}
async function applyImport(txt){
  let d; try{ d=JSON.parse(txt); }catch(e){ return toast('That is not valid JSON.'); }
  if(!d || typeof d!=='object' || !d.core || !Array.isArray(d.core.exercises))
    return toast('That file is not an Overload backup.');
  const v = +d.v || 1;
  if(v > EXPORT_V && !confirm('This backup was written by a newer version (v'+v+'). Import anyway?')) return;
  const n = (d.core.index||[]).length;
  const nDays = Object.keys((d.nutrition&&d.nutrition.days)||{}).length;
  if(!confirm('Replace everything currently stored with this backup?\n\n'+
              n+' session'+(n===1?'':'s')+
              (nDays? ' · '+nDays+' day'+(nDays===1?'':'s')+' of food' : '')+
              ' · exported '+String(d.exportedAt||'unknown date').slice(0,10))) return;
  try{
    await IDB.clear();                    // a restore is a replace, not a merge
  }catch(e){ storageFault('clear',e); return toast('Could not clear existing data — nothing was changed.'); }
  S.mem={};
  const notes=[];
  for(const c of DATA){
    try{ const note = await c.restore(d); if(note) notes.push(note); }
    catch(e){ toast('Partial restore: '+e.message); }
  }
  toast('Restored '+(notes.join(' · ')||'backup')+'.');
  go(homeView());
}

async function wipe(){
  if(!confirm('Delete every session, routine, record and food entry? This cannot be undone.'))return;
  if(prompt('Type DELETE to confirm')!=='DELETE') return;
  try{ await IDB.clear(); }catch(e){ return storageFault('clear',e); }
  S.mem={};
  location.reload();
}

/* ================= service worker, notifications, durability ================= */
let SWREG=null;
const Notification_supported = ()=> (typeof Notification!=='undefined') && ('serviceWorker' in navigator);
function notifLabel(){
  if(!Notification_supported()) return 'Not supported by this browser.';
  if(Notification.permission==='granted') return 'Alerts you with the screen locked.';
  if(Notification.permission==='denied')  return 'Blocked in browser settings. The in-app timer still runs.';
  return 'Off — the timer only runs while the app is open.';
}
async function askNotif(){
  if(!Notification_supported()) return;
  try{ await Notification.requestPermission(); }catch(e){}
  render();
}
/* Core schedules a timed alert; it is told the text, and knows nothing about
   what is being timed. */
function restNotify(at, body){
  if(!SWREG || !Notification_supported() || Notification.permission!=='granted') return;
  (SWREG.active||SWREG.waiting||SWREG.installing)?.postMessage(
    {type:'rest:schedule', at, tag:'rest', body: body || 'Time.'});
}
function restCancel(){
  if(!SWREG) return;
  (SWREG.active||SWREG.waiting||SWREG.installing)?.postMessage({type:'rest:cancel', tag:'rest'});
}

let LAST_SW_MSG=null;
async function initPWA(){
  // Ask the browser not to evict the log under storage pressure.
  try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  if(!('serviceWorker' in navigator)) return;
  try{
    SWREG = await navigator.serviceWorker.register('sw.js');
    /* Assets are served from cache first, so a new build lands on the *next*
       open. Say so, rather than leaving a phone quietly running old code. */
    SWREG.addEventListener('updatefound', ()=>{
      const w = SWREG.installing; if(!w) return;
      w.addEventListener('statechange', ()=>{
        if(w.state === 'installed' && navigator.serviceWorker.controller) updateBanner();
      });
    });
    // A worker that installed on a previous visit is already sitting ready.
    if(SWREG.waiting && navigator.serviceWorker.controller) updateBanner();
    /* Ask for a fresh check on every open, and again when the app is brought
       back to the foreground. An installed PWA resumes rather than navigates,
       so without this it can sit on an old build for a long time. */
    const check = ()=>{ try{ SWREG.update(); }catch(e){} };
    check();
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) check(); });
    navigator.serviceWorker.addEventListener('message',ev=>{
      const m=ev.data||{}; LAST_SW_MSG=m;
      // The worker alerted while we were in the background — don't leave a dead
      // countdown bar running when the app comes back.
      if(m.type==='rest:elapsed' && m.notified && typeof TIMER!=='undefined' && TIMER) TIMER=null;
    });
  }catch(e){
    // file:// or a non-secure origin — the app still works, just not offline.
    console.warn('[overload] service worker unavailable:',e.message);
  }
}
function updateBanner(){
  const el = document.getElementById('fault'); if(!el || el.style.display==='block') return;
  el.style.background = '#173226'; el.style.borderBottomColor = 'var(--green)'; el.style.color = '#9BE7BE';
  el.innerHTML = '<button onclick="location.reload()" style="color:#63D394">Reload</button>' +
                 '<b>A new version is ready.</b> Reload to use it.';
  el.style.display = 'block';
}

async function storageNote(){
  const el=document.getElementById('storagenote'); if(!el) return;
  let bits=['Stored on this device only.'];
  try{
    if(navigator.storage){
      if(navigator.storage.persisted && await navigator.storage.persisted()) bits.push('Marked persistent.');
      if(navigator.storage.estimate){
        const e=await navigator.storage.estimate();
        if(e && e.usage!=null) bits.push('Using '+(e.usage<1048576? Math.round(e.usage/1024)+' KB' : (e.usage/1048576).toFixed(1)+' MB')+'.');
      }
    }
  }catch(e){}
  el.textContent = bits.join(' ');
}

/* ------------------------------------------------------------------- boot */
const BOOTS = [];
function registerBoot(fn){ BOOTS.push(fn); }
async function boot(){
  await initPWA();
  for(const b of BOOTS){
    try{ await b(); }catch(e){ console.error('[overload] boot step failed',e); }
  }
  render();
}
