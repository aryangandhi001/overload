"""One-time transform: artifact-sandbox overload.html -> standalone PWA index.html.

Every replacement is anchored on exact source text and asserts it matched, so a
drifted source fails loudly instead of silently producing a half-ported app.
After this has run, index.html is the source of truth; this script is kept only
as the record of what changed.

    python scripts/port-to-pwa.py
"""
import os, sys, io

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC  = os.path.join(ROOT, '_original-artifact.html')
DST  = os.path.join(ROOT, 'index.html')

src = io.open(SRC, encoding='utf-8').read()
edits = []


def sub(label, old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"anchor {label!r}: expected {count} match(es), found {n}"
    src = src.replace(old, new, count)
    edits.append(label)


# ---------------------------------------------------------------- 1. document head
sub('head', """<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>""", """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Overload</title>
<meta name="description" content="Personal progressive-overload training log.">
<meta name="theme-color" content="#14171C">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<!-- Fonts are vendored, not fetched. Airplane mode has to look identical. -->
<link rel="stylesheet" href="fonts/fonts.css">
<style>""")

# ------------------------------------------------------- 2. persistent-fault banner CSS
sub('banner css', """.sheet .inner{""", """.fault{position:fixed;left:0;right:0;top:0;z-index:60;background:#3A1B1D;border-bottom:1px solid var(--red);
  color:#FFC9C7;padding:10px 14px;font-size:13px;line-height:1.45;display:none}
.fault b{color:#FF7A76}
.fault button{float:right;color:#FF7A76;font-weight:600;margin-left:10px}
.sheet .inner{""")

# ------------------------------------------------------------- 3. open body element
sub('body open', """</style>
<div id="app">""", """</style>
</head>
<body>
<div class="fault" id="fault"></div>
<div id="app">""")

# ------------------------------------------------- 4. storage backend: window.storage -> IndexedDB
sub('storage', """const S = {
  mem:{}, pending:0,
  async get(k){ if(k in this.mem) return this.mem[k];
    try{ const r = await window.storage.get(k); const v = r? JSON.parse(r.value): null; this.mem[k]=v; return v; }
    catch(e){ this.mem[k]=null; return null; } },
  async set(k,v){ this.mem[k]=v; this.pending++; syncDot();
    try{ await window.storage.set(k, JSON.stringify(v)); }
    catch(e){ queueRetry(k); } finally{ this.pending--; syncDot(); } },
  async del(k){ delete this.mem[k];
    try{ await window.storage.delete(k); }catch(e){} }
};
const retryQ = new Set();
function queueRetry(k){ retryQ.add(k); syncDot(); }
setInterval(async()=>{ for(const k of [...retryQ]){
  try{ await window.storage.set(k, JSON.stringify(S.mem[k])); retryQ.delete(k); syncDot(); }catch(e){} } },5000);
function syncDot(){ const el=document.getElementById('syncdot'); if(!el)return;
  el.style.display = retryQ.size? 'inline':'none'; }""", """/* ---------- IndexedDB key-value store ----------
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
  document.body.style.paddingTop='0';
}
function clearFault(manual){
  if(!manual && retryQ.size) return;
  faultShown=''; const el=document.getElementById('fault');
  if(el){ el.style.display='none'; el.innerHTML=''; }
}""")

# ------------------------------------------------------------- 5. local-time dates
sub('today()', """const today = ()=> new Date().toISOString().slice(0,10);""",
    """/* Local time, deliberately. toISOString() is UTC: in IST that dates anything
   logged before 05:30 to the previous day. */
const today = (d=new Date())=> d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');""")

# ------------------------------------------------------- 6. rest timer -> background capable
sub('rest timer', """function startRest(sec){ TIMER={end:Date.now()+sec*1000,total:sec}; paintTimer(); }
function addRest(s){ if(TIMER){TIMER.end+=s*1000;TIMER.total+=s;paintTimer();} }
function stopRest(){ TIMER=null; const b=document.getElementById('tbar'); if(b)b.style.display='none'; }
setInterval(paintTimer,500);
function paintTimer(){
  const bar=document.getElementById('tbar'); if(!bar) return;
  if(!TIMER){ bar.style.display='none'; return; }
  const left=Math.max(0,Math.round((TIMER.end-Date.now())/1000));
  bar.style.display='block';
  document.getElementById('tval').textContent=Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
  document.getElementById('tfill').style.width=(left/TIMER.total*100)+'%';
  if(left<=0){ beep(); TIMER=null; setTimeout(()=>{const b=document.getElementById('tbar');if(b)b.style.display='none'},1200); }
}""", """function startRest(sec){ TIMER={end:Date.now()+sec*1000,total:sec}; schedRest(TIMER.end); paintTimer(); }
function addRest(s){ if(TIMER){TIMER.end+=s*1000;TIMER.total+=s;schedRest(TIMER.end);paintTimer();} }
function stopRest(){ TIMER=null; cancelRest(); const b=document.getElementById('tbar'); if(b)b.style.display='none'; }
setInterval(paintTimer,500);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) paintTimer(); });
function paintTimer(){
  const bar=document.getElementById('tbar'); if(!bar) return;
  if(!TIMER){ bar.style.display='none'; return; }
  const over=Date.now()-TIMER.end;
  const left=Math.max(0,Math.round(-over/1000));
  bar.style.display='block';
  document.getElementById('tval').textContent=Math.floor(left/60)+':'+String(left%60).padStart(2,'0');
  document.getElementById('tfill').style.width=(left/TIMER.total*100)+'%';
  if(left<=0){
    // Coming back to a timer that ran out while the screen was off: the
    // notification already did the alerting, so don't buzz again.
    if(over<3000) beep();
    TIMER=null; setTimeout(()=>{const b=document.getElementById('tbar');if(b)b.style.display='none'},1200);
  }
}""")

# ------------------------------------------------ 7. import: file picker + version tolerance
sub('import', """async function importData(){
  const txt=prompt('Paste an exported JSON backup. This replaces everything currently stored.');
  if(!txt) return;
  let d; try{ d=JSON.parse(txt); }catch(e){ return toast('That is not valid JSON.'); }
  if(!d.core) return toast('Backup is missing its core data.');
  DB=d.core; await save();
  for(const [id,s] of Object.entries(d.sessions||{})) if(s) await S.set('gym:session:'+id,s);
  for(const [id,l] of Object.entries(d.logs||{})){ EXLOG[id]=l; await S.set('gym:exlog:'+id,l); }
  toast('Backup restored.'); go('today');
}""", """/* Import accepts a file (the only workable route on a phone — a whole export
   will not fit through prompt()) and falls back to pasting. Both old and new
   envelope versions are accepted; unknown newer keys are carried through
   untouched rather than dropped. */
const IMPORT_MAX_V = 2;
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
  if(v > IMPORT_MAX_V && !confirm('This backup was written by a newer version (v'+v+'). Import anyway?')) return;
  const n = (d.core.index||[]).length;
  if(!confirm('Replace everything currently stored with this backup?\\n\\n'+
              n+' session'+(n===1?'':'s')+' · exported '+String(d.exportedAt||'unknown date').slice(0,10))) return;
  try{
    await IDB.clear();                    // a restore is a replace, not a merge
  }catch(e){ storageFault('clear',e); return toast('Could not clear existing data — nothing was changed.'); }
  S.mem={}; EXLOG={}; ACTIVE=null;
  DB = d.core;
  if(!DB.settings) DB.settings={unit:'kg',rest:120,useRir:false,sound:true};
  DB.prs = DB.prs||{}; DB.index = DB.index||[]; DB.routines = DB.routines||[];
  await save();
  for(const [id,s] of Object.entries(d.sessions||{})) if(s) await S.set('gym:session:'+id,s);
  for(const [id,l] of Object.entries(d.logs||{})){ if(Array.isArray(l)){ EXLOG[id]=l; await S.set('gym:exlog:'+id,l); } }
  toast('Restored '+n+' session'+(n===1?'':'s')+'.'); go('today');
}""")

# ---------------------------------------------------- 8. settings: storage + alerts rows
sub('settings rows', """    <h2>Your data</h2>
    <button class="btn" onclick="exportData()">Export everything as JSON</button>
    <button class="btn" style="margin-top:8px" onclick="importData()">Import from JSON</button>""",
"""    <div class="card"><div class="between"><div>Background rest alerts
      <div class="small dim" id="notestate">${esc(notifLabel())}</div></div>
      ${Notification_supported()? (Notification.permission==='granted'
        ? '<span class="pill up">On</span>'
        : Notification.permission==='denied'
          ? '<span class="pill">Blocked</span>'
          : '<button class="btn sm primary" onclick="askNotif()">Enable</button>')
        : '<span class="pill">N/A</span>'}</div></div>
    <h2>Your data</h2>
    <button class="btn" onclick="exportData()">Export everything as JSON</button>
    <button class="btn" style="margin-top:8px" onclick="importData()">Import from a file</button>
    <button class="btn ghost small" style="margin-top:8px" onclick="importPaste()">Import by pasting JSON</button>""")

# ------------------------------------------------------- 9. settings: storage footer note
sub('settings footer', """    <div class="tiny dim" style="margin-top:14px;line-height:1.6">Progression targets come from your own logged sets. They are app-generated suggestions, not coaching or medical advice.</div>""",
"""    <div class="tiny dim" id="storagenote" style="margin-top:14px;line-height:1.6">Stored on this device only.</div>
    <div class="tiny dim" style="margin-top:10px;line-height:1.6">Progression targets come from your own logged sets. They are app-generated suggestions, not coaching or medical advice.</div>""")

# ------------------------------------------------------- 10. PWA runtime + boot wiring
sub('boot', """async function boot(){
  DB = await S.get('gym:core');""", """/* ---------- service worker, notifications, storage durability ---------- */
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
function schedRest(at){
  if(!SWREG || !Notification_supported() || Notification.permission!=='granted') return;
  const name = (ACTIVE && cur() && cur().name) ? cur().name : '';
  (SWREG.active||SWREG.waiting||SWREG.installing)?.postMessage(
    {type:'rest:schedule', at, tag:'rest', body: name? 'Next set — '+name : 'Next set.'});
}
function cancelRest(){
  if(!SWREG) return;
  (SWREG.active||SWREG.waiting||SWREG.installing)?.postMessage({type:'rest:cancel', tag:'rest'});
}
let LAST_SW_MSG=null;
async function initPWA(){
  // Ask the browser not to evict the training log under storage pressure.
  try{ if(navigator.storage && navigator.storage.persist) await navigator.storage.persist(); }catch(e){}
  if(!('serviceWorker' in navigator)) return;
  try{
    SWREG = await navigator.serviceWorker.register('sw.js');
    navigator.serviceWorker.addEventListener('controllerchange',()=>{ /* new shell active on next load */ });
    navigator.serviceWorker.addEventListener('message',ev=>{
      const m=ev.data||{}; LAST_SW_MSG=m;
      // The worker alerted while we were in the background — don't leave a dead
      // countdown bar running when the app comes back.
      if(m.type==='rest:elapsed' && m.notified && TIMER) TIMER=null;
    });
  }catch(e){
    // file:// or a non-secure origin — the app still works, just not offline.
    console.warn('[overload] service worker unavailable:',e.message);
  }
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

async function boot(){
  await initPWA();
  DB = await S.get('gym:core');""")

# ----------------------------------------------- 11. refresh the storage note after render
sub('render hook', """  if(v==='workout') paintTimer();
  window.scrollTo(0, VIEW.scroll||0);""", """  if(v==='workout') paintTimer();
  if(v==='settings') storageNote();
  window.scrollTo(0, VIEW.scroll||0);""")

# ---------------------------------------------------- 12. ask for permission on first workout
sub('permission prompt', """async function startDay(rid,did){
  const r=DB.routines.find(x=>x.id===rid), d=r.days.find(x=>x.id===did);""",
"""async function startDay(rid,did){
  // Starting a workout is a user gesture — the only moment a permission prompt
  // is both allowed and relevant. Asked once; declining is remembered by the browser.
  if(Notification_supported() && Notification.permission==='default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
  const r=DB.routines.find(x=>x.id===rid), d=r.days.find(x=>x.id===did);""")

# ------------------------------------------------------------------ 13. close document
sub('body close', """window.addEventListener('beforeunload',()=>{ if(ACTIVE) S.set('gym:active',ACTIVE); });
boot();
</script>""", """window.addEventListener('beforeunload',()=>{ if(ACTIVE) S.set('gym:active',ACTIVE); });
boot();
</script>
</body>
</html>""")

io.open(DST, 'w', encoding='utf-8', newline='\n').write(src)
print(f"wrote {DST}  ({os.path.getsize(DST)} bytes)")
print(f"{len(edits)} anchored edits applied:")
for e in edits:
    print('  -', e)
