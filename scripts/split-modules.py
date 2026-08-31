"""Split the single inline <script> in index.html into core.js + workout.js.

Why: the nutrition module must be addable without the workout module ever
referring to it. That means the view router, the bottom nav, the storage layer
and the export/import envelope all have to become registries that any module
can register into. Workout and nutrition then both depend on core, and neither
depends on the other.

These stay classic (non-module) scripts on purpose. The existing UI is built on
inline onclick handlers, which need functions in global scope; converting to ES
modules would mean rewriting every view to use event delegation for no benefit
the brief asks for.

Run once. After this, core.js / workout.js are the source of truth.

    python scripts/split-modules.py
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
IDX = os.path.join(ROOT, 'index.html')

html = io.open(IDX, encoding='utf-8').read()
m = re.search(r'(?s)<script>\n(.*)\n</script>', html)
if not m:
    sys.exit('could not find the inline <script> block')
body = m.group(1)
orig_len = len(body)


def cut(pattern, label):
    """Remove a block from `body` and return it."""
    global body
    mm = re.search(pattern, body, re.S)
    if not mm:
        sys.exit(f'anchor not found: {label}')
    text = mm.group(0)
    body = body[:mm.start()] + body[mm.end():]
    return text


# ---------------------------------------------------------------- blocks -> core
storage = cut(r'/\* ---------- IndexedDB key-value store ----------.*?\n(?=const uid = )', 'storage')
helpers = cut(r'const uid = .*?\nconst daysBetween = .*?\n', 'helpers')
toast_fn = cut(r'function toast\(msg,pr=false\)\{.*?\n\}\n', 'toast')
ui_router = cut(r'/\* =+ UI =+ \*/\n.*?(?=/\* ---------------- TODAY)', 'router')
pwa = cut(r'/\* ---------- service worker.*?\n(?=async function boot)', 'pwa')
boot_old = cut(r'async function boot\(\)\{.*?\n\}\n', 'boot')
state = cut(r'/\* ---------- app state ---------- \*/\nlet DB=null.*?\n', 'app state')
old_header = cut(r'/\* =+\n   OVERLOAD — personal progressive-overload log.*?=+ \*/\n', 'header')
data_fns = cut(r'async function exportData\(\)\{.*?\n\}\n(?=/\* Import accepts)', 'exportData')
import_fns = cut(r'/\* Import accepts a file.*?\n(?=async function wipe)', 'importData')
wipe_fn = cut(r'async function wipe\(\)\{.*?\n\}\n', 'wipe')
boot_call = cut(r'\nboot\(\);\s*$', 'boot call')

# --------------------------------------------------------- patch what remains
def patch(old, new, label):
    global body
    if body.count(old) != 1:
        sys.exit(f'patch {label}: expected 1 match, found {body.count(old)}')
    body = body.replace(old, new)


# workout keeps its own state; VIEW belongs to the router in core
patch("""const save = ()=> S.set('gym:core',DB);""",
      """let DB=null, ACTIVE=null, EXLOG={}, TIMER=null;
const save = ()=> S.set('gym:core',DB);""", 'workout state')

# the rest timer asks core to schedule; core knows nothing about exercises
patch("""function startRest(sec){ TIMER={end:Date.now()+sec*1000,total:sec}; schedRest(TIMER.end); paintTimer(); }
function addRest(s){ if(TIMER){TIMER.end+=s*1000;TIMER.total+=s;schedRest(TIMER.end);paintTimer();} }
function stopRest(){ TIMER=null; cancelRest(); const b=document.getElementById('tbar'); if(b)b.style.display='none'; }""",
      """const restLabel = ()=> (ACTIVE && cur() && cur().name) ? 'Next set — '+cur().name : 'Next set.';
function startRest(sec){ TIMER={end:Date.now()+sec*1000,total:sec}; restNotify(TIMER.end,restLabel()); paintTimer(); }
function addRest(s){ if(TIMER){TIMER.end+=s*1000;TIMER.total+=s;restNotify(TIMER.end,restLabel());paintTimer();} }
function stopRest(){ TIMER=null; restCancel(); const b=document.getElementById('tbar'); if(b)b.style.display='none'; }""",
      'rest timer')

# The settings view keeps its Export/Import buttons; those functions now live in
# core.js instead of alongside it, which needs no change at the call site.

workout_tail = """

/* ---------------------------------------------------------------- register */
registerView('today',     viewToday);
registerView('workout',   viewWorkout, { chrome:false, after:paintTimer });
registerView('history',   viewHistory);
registerView('session',   viewSession);
registerView('exercises', viewExercises);
registerView('exercise',  viewExercise);
registerView('plans',     viewPlans);
registerView('plan',      viewPlan);
registerView('settings',  viewSettings, { after:storageNote });

registerTab({ key:'today',     label:'Today',   order:10, owns:['workout'] });
registerTab({ key:'history',   label:'History', order:20, owns:['session'] });
registerTab({ key:'exercises', label:'Lifts',   order:30, owns:['exercise'] });
registerTab({ key:'plans',     label:'Plans',   order:40, owns:['plan'] });

/* What this module contributes to an export, and how it takes it back. */
registerData({
  async collect(){
    const sessions={}; for(const s of DB.index) sessions[s.id]=await S.get('gym:session:'+s.id);
    const logs={}; for(const e of DB.exercises){ const l=await S.get('gym:exlog:'+e.id); if(l&&l.length) logs[e.id]=l; }
    return { core:DB, sessions, logs };
  },
  async restore(d){
    if(!d.core || !Array.isArray(d.core.exercises)) throw new Error('backup has no workout data');
    DB = d.core;
    if(!DB.settings) DB.settings={unit:'kg',rest:120,useRir:false,sound:true};
    DB.prs=DB.prs||{}; DB.index=DB.index||[]; DB.routines=DB.routines||[];
    EXLOG={}; ACTIVE=null;
    await save();
    for(const [id,s] of Object.entries(d.sessions||{})) if(s) await S.set('gym:session:'+id,s);
    for(const [id,l] of Object.entries(d.logs||{})) if(Array.isArray(l)){ EXLOG[id]=l; await S.set('gym:exlog:'+id,l); }
    return (d.core.index||[]).length + ' session' + ((d.core.index||[]).length===1?'':'s');
  },
  async keys(){
    const k=['gym:core','gym:active'];
    for(const s of (DB?DB.index:[])) k.push('gym:session:'+s.id);
    for(const e of (DB?DB.exercises:[])) k.push('gym:exlog:'+e.id);
    return k;
  }
});

registerBoot(async ()=>{
  DB = await S.get('gym:core');
  if(!DB) DB = {settings:{unit:'kg',rest:120,useRir:false,sound:true},exercises:[...SEED_EX],routines:[],prs:{},index:[],seedV:0};
  if(DB.seedV !== SEED_V){ applySeed(); DB.seedV = SEED_V; await S.set('gym:core',DB); }
  ACTIVE = await S.get('gym:active');
  if(ACTIVE) await loadExlogs(ACTIVE.exercises.map(x=>x.exerciseId));
});

window.addEventListener('beforeunload',()=>{ if(ACTIVE) S.set('gym:active',ACTIVE); });
"""

# the old beforeunload line is now in workout_tail
patch("""window.addEventListener('beforeunload',()=>{ if(ACTIVE) S.set('gym:active',ACTIVE); });""", '', 'beforeunload')

workout_js = """/* ============================================================
   OVERLOAD — workout module.
   Progressive-overload log: routines, workout mode, PR detection.

   Depends on core.js only. Must never reference the nutrition module —
   scripts/check-separation.mjs enforces this.

   Storage keys:
     gym:core            {settings, exercises, routines, prs, index}
     gym:session:<id>    full session record
     gym:exlog:<exId>    [{sessionId,date,sets:[{w,r,rir}]}]  newest last
     gym:active          in-progress session (deleted on finish)
   ============================================================ */

""" + body.strip() + workout_tail

io.open(os.path.join(ROOT, 'workout.js'), 'w', encoding='utf-8', newline='\n').write(workout_js)

print(f'original script  {orig_len:,} chars')
print(f'workout.js       {len(workout_js):,} chars')
for name, blk in [('storage', storage), ('helpers', helpers), ('toast', toast_fn),
                  ('router', ui_router), ('pwa', pwa), ('boot', boot_old),
                  ('export', data_fns), ('import', import_fns), ('wipe', wipe_fn)]:
    print(f'  moved to core: {name:9s} {len(blk):>6,} chars')

# stash the moved blocks so build-core.py can compose them
io.open(os.path.join(HERE, '.cache/_moved.json'), 'w', encoding='utf-8').write(
    __import__('json').dumps({
        'storage': storage, 'helpers': helpers, 'toast': toast_fn,
        'router': ui_router, 'pwa': pwa, 'export': data_fns,
        'import': import_fns, 'wipe': wipe_fn
    }))
print('\nmoved blocks written to scripts/.cache/_moved.json')
