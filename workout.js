/* ============================================================
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

const e1rm = (w,r)=> (!w||!r||r>12)? null : round1(w*(1+r/30));

/* ---------- seed data ---------- */
const SEED_EX = [
 ['Barbell Bench Press','Chest','Barbell',2.5],['Incline Barbell Press','Chest','Barbell',2.5],
 ['Dumbbell Bench Press','Chest','Dumbbell',2],['Incline Dumbbell Press','Chest','Dumbbell',2],
 ['Cable Fly','Chest','Cable',2.5],['Chest Dip','Chest','Bodyweight',2.5],['Machine Chest Press','Chest','Machine',5],
 ['Overhead Press','Shoulders','Barbell',2.5],['Seated Dumbbell Press','Shoulders','Dumbbell',2],
 ['Lateral Raise','Shoulders','Dumbbell',1],['Cable Lateral Raise','Shoulders','Cable',2.5],
 ['Rear Delt Fly','Shoulders','Dumbbell',1],['Face Pull','Shoulders','Cable',2.5],
 ['Pull-Up','Back','Bodyweight',2.5],['Lat Pulldown','Back','Machine',5],
 ['Barbell Row','Back','Barbell',2.5],['Dumbbell Row','Back','Dumbbell',2],
 ['Seated Cable Row','Back','Cable',5],['Chest-Supported Row','Back','Machine',5],
 ['Deadlift','Back','Barbell',5],['Romanian Deadlift','Hamstrings','Barbell',2.5],
 ['Straight-Arm Pulldown','Back','Cable',2.5],['Shrug','Back','Barbell',2.5],
 ['Back Squat','Quads','Barbell',2.5],['Front Squat','Quads','Barbell',2.5],
 ['Hack Squat','Quads','Machine',5],['Leg Press','Quads','Machine',5],
 ['Bulgarian Split Squat','Quads','Dumbbell',2],['Walking Lunge','Quads','Dumbbell',2],
 ['Leg Extension','Quads','Machine',5],['Lying Leg Curl','Hamstrings','Machine',5],
 ['Seated Leg Curl','Hamstrings','Machine',5],['Hip Thrust','Glutes','Barbell',5],
 ['Standing Calf Raise','Calves','Machine',5],['Seated Calf Raise','Calves','Machine',2.5],
 ['Barbell Curl','Biceps','Barbell',2.5],['Dumbbell Curl','Biceps','Dumbbell',1],
 ['Incline Dumbbell Curl','Biceps','Dumbbell',1],['Hammer Curl','Biceps','Dumbbell',1],
 ['Cable Curl','Biceps','Cable',2.5],['Preacher Curl','Biceps','Machine',2.5],
 ['Triceps Pushdown','Triceps','Cable',2.5],['Overhead Cable Extension','Triceps','Cable',2.5],
 ['Skullcrusher','Triceps','Barbell',2.5],['Close-Grip Bench Press','Triceps','Barbell',2.5],
 ['Triceps Dip','Triceps','Bodyweight',2.5],
 ['Cable Crunch','Core','Cable',2.5],['Hanging Leg Raise','Core','Bodyweight',2.5],['Plank','Core','Bodyweight',0],
 ['Close-Grip Cable Row','Back','Cable',5],['Wide-Grip Cable Row','Back','Cable',5],
 ['Close-Grip Lat Pulldown','Back','Machine',5],['V-Bar Pushdown','Triceps','Cable',2.5],
 ['Overhead Dumbbell Extension','Triceps','Dumbbell',2],['Hip Adductor Machine','Adductors','Machine',5],
 ['Front Raise','Shoulders','Dumbbell',1],['Pec Deck','Chest','Machine',5],
 ['Low-to-High Dumbbell Fly','Chest','Dumbbell',1],['Smith Machine Incline Press','Chest','Machine',2.5],
 ['Incline Cable Press','Chest','Cable',2.5],['Standing Cable Chest Press','Chest','Cable',2.5],
 ['Bayesian Cable Curl','Biceps','Cable',2.5],['Sumo Squat','Quads','Dumbbell',2]
].map(([name,muscle,equipment,inc])=>({id:uid(),name,muscle,equipment,inc,custom:false}));

/* AG's split. [exercise, working sets, min reps, max reps, rest sec, warm-up sets] */
const MY_PLAN = {name:'My 6-day split', days:[
 ['Mon · Chest & Bicep',[
   ['Incline Dumbbell Press',3,6,10,150,2],['Machine Chest Press',3,8,12,120,0],
   ['Cable Fly',3,12,15,90,0],['Cable Curl',3,10,15,75,0],['Preacher Curl',3,10,12,75,0]]],
 ['Tue · Back & Tricep',[
   ['Lat Pulldown',3,8,12,120,1],['Chest-Supported Row',3,8,12,120,0],
   ['Barbell Row',3,6,10,150,1],['V-Bar Pushdown',3,10,15,75,0],
   ['Overhead Cable Extension',3,10,15,75,0],['Overhead Dumbbell Extension',2,10,15,75,0]]],
 ['Wed · Shoulders & Hamstrings',[
   ['Romanian Deadlift',3,6,10,180,2],['Lying Leg Curl',2,10,15,90,0],
   ['Hip Adductor Machine',2,12,20,60,0],['Shrug',3,10,15,90,0],
   ['Lateral Raise',3,12,20,60,0],['Overhead Press',3,6,10,150,1],['Front Raise',2,12,15,60,0]]],
 ['Thu · Chest & Bicep',[
   ['Overhead Press',3,12,15,90,0],['Pec Deck',3,12,15,90,0],
   ['Low-to-High Dumbbell Fly',2,12,15,75,0],['Smith Machine Incline Press',3,8,12,120,0],
   ['Bayesian Cable Curl',3,10,15,75,0],['Hammer Curl',3,10,12,75,0]]],
 ['Fri · Back & Tricep',[
   ['Wide-Grip Cable Row',3,8,12,120,1],['Rear Delt Fly',3,12,20,60,0],
   ['Dumbbell Row',3,8,12,120,0],['Close-Grip Lat Pulldown',3,8,12,120,0],
   ['Overhead Cable Extension',3,10,15,75,0],['V-Bar Pushdown',3,10,15,75,0]]],
 ['Sat · Legs (quad focus)',[
   ['Back Squat',4,5,8,210,3],['Leg Extension',3,10,15,90,0],
   ['Sumo Squat',3,8,12,150,0],['Leg Press',3,10,15,150,0],
   ['Standing Calf Raise',4,10,15,60,0]]]
]};
const norm = s => String(s).toLowerCase().replace(/[^a-z]/g,'');
function buildMyPlan(){
  const f = n => (DB.exercises.find(e=>norm(e.name)===norm(n))||{}).id;
  return {id:uid(),name:MY_PLAN.name,days:MY_PLAN.days.map(([name,list])=>({id:uid(),name,
    exercises:list.map(([n,sets,lo,hi,rest,warm])=>({id:uid(),exerciseId:f(n),sets,repMin:lo,repMax:hi,rest,warm,rir:2,notes:''}))
      .filter(pe=>pe.exerciseId)}))};
}
const SEED_V = 2;
function applySeed(){
  for(const e of SEED_EX) if(!DB.exercises.some(x=>norm(x.name)===norm(e.name))) DB.exercises.push(e);
  if(!DB.routines.some(r=>r.name===MY_PLAN.name)) DB.routines.unshift(buildMyPlan());
  // drop the old sample routine only if it was never trained
  DB.routines = DB.routines.filter(r=>r.name!=='Push / Pull / Legs' || DB.index.some(s=>s.routineId===r.id));
}


let DB=null, ACTIVE=null, EXLOG={}, TIMER=null;
const save = ()=> S.set('gym:core',DB);
const exById = id => DB.exercises.find(e=>e.id===id) || {name:'Deleted exercise',muscle:'',equipment:'',inc:2.5};

async function loadExlogs(ids){
  await Promise.all([...new Set(ids)].map(async id=>{ EXLOG[id] = (await S.get('gym:exlog:'+id))||[]; }));
}

/* ============================================================
   PROGRESSION ENGINE — pure. (history, config) -> suggestion
   App-generated suggestion from your own logged data. Not coaching advice.
   ============================================================ */
function roundTo(w,inc){ if(!inc) return round1(w); return round1(Math.round(w/inc)*inc); }
const working = s => s.filter(x=>!x.warm && x.done && x.r>0);

function suggest(cfg, log){
  const inc = cfg.inc ?? 2.5, lo = cfg.repMin, hi = cfg.repMax;
  const hist = (log||[]).filter(h=>working(h.sets).length);
  if(!hist.length) return {weight:cfg.weight??null, lo, hi, sets:cfg.sets, tag:'start',
    why:'No history yet. Pick a weight you can control for '+lo+'–'+hi+' reps.'};

  const last = hist[hist.length-1], ls = working(last.sets);
  const topW = Math.max(...ls.map(s=>s.w));
  const atTop = ls.filter(s=>s.w===topW);
  const gap = daysBetween(last.date, today());

  if(gap>21) return {weight:roundTo(topW*0.9,inc), lo, hi, sets:cfg.sets, tag:'return',
    why:gap+' days since you last did this. Starting ~10% under '+fmtW(topW)+' to rebuild.'};

  const allHit = atTop.length>=Math.min(cfg.sets,atTop.length) && atTop.every(s=>s.r>=hi) && atTop.length>=cfg.sets;
  const rirs = atTop.map(s=>s.rir).filter(v=>v!=null);
  const easy = rirs.length===atTop.length && rirs.every(v=>v>=3);

  if(allHit){
    const step = easy? inc*2 : inc;
    return {weight:roundTo(topW+step,inc), lo, hi, sets:cfg.sets, tag:'up',
      why:'You hit '+hi+' on every set at '+fmtW(topW)+(easy?' with 3+ reps in reserve':'')+'. Add '+fmtW(step)+' and reset to '+lo+'.'};
  }

  // stall check: same top weight and no total-rep gain across last 3 sessions
  const recent = hist.slice(-3);
  const stalled = recent.length===3 && recent.every(h=>Math.max(...working(h.sets).map(s=>s.w))===topW)
    && recent[2].sets.reduce((a,s)=>a+(s.done&&!s.warm?s.r:0),0) <= recent[0].sets.reduce((a,s)=>a+(s.done&&!s.warm?s.r:0),0);
  const deload = hist.length>=4 && stalled && daysBetween(hist[hist.length-4].date,today())<40
    && Math.max(...working(hist[hist.length-4].sets).map(s=>s.w))===topW;

  if(deload) return {weight:roundTo(topW*0.9,inc), lo, hi, sets:cfg.sets, tag:'deload',
    why:'Four sessions stuck at '+fmtW(topW)+'. Drop ~10% and build back — that usually breaks it faster than grinding.'};
  if(stalled) return {weight:topW, lo, hi, sets:cfg.sets, tag:'stall',
    why:'Third session at '+fmtW(topW)+' without progress. Hold the weight and chase one extra rep.'};

  const targets = atTop.map(s=>Math.min(s.r+1,hi));
  return {weight:topW, lo:Math.min(...targets), hi, sets:cfg.sets, tag:'hold',
    why:'Stay at '+fmtW(topW)+' and beat '+ls.map(s=>s.r).join('/')+' by at least one rep.'};
}

/* ---------- PR detection ---------- */
function checkPRs(exId, sets){
  const pr = DB.prs[exId] || {w:0,e:0,vol:0,reps:{}};
  const log = EXLOG[exId]||[];
  const found=[];
  if(log.length<2) return {found:[],pr};           // suppress noise on first sessions
  let vol=0;
  for(const s of working(sets)){
    vol += s.w*s.r;
    if(s.w>pr.w){ pr.w=s.w; found.push({t:'Heaviest weight',v:fmtW(s.w)+' × '+s.r}); }
    const k=String(s.w);
    if(s.r>(pr.reps[k]||0)){ if(pr.reps[k]) found.push({t:'Rep record at '+fmtW(s.w),v:s.r+' reps'}); pr.reps[k]=s.r; }
    const e=e1rm(s.w,s.r);
    if(e&&e>pr.e){ pr.e=e; found.push({t:'Estimated 1RM',v:fmtW(e)}); }
  }
  if(vol>pr.vol){ if(pr.vol) found.push({t:'Best session volume',v:Math.round(vol)+' '+DB.settings.unit}); pr.vol=vol; }
  DB.prs[exId]=pr;
  const seen=new Set(); return {found:found.filter(f=>!seen.has(f.t)&&seen.add(f.t)),pr};
}

/* ---------------- TODAY ---------------- */
function viewToday(){
  const r = DB.routines[0];
  const idx = DB.index;
  let body='';
  if(ACTIVE){
    const doneSets = ACTIVE.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.done).length,0);
    body += `<div class="card" style="border-color:var(--blue)">
      <div class="between"><div><span class="eyebrow" style="color:var(--blue)">In progress</span>
      <div class="exname">${esc(ACTIVE.dayName)}</div><div class="small mute">${doneSets} sets logged</div></div></div>
      <div style="height:12px"></div><button class="btn primary" onclick="go('workout')">Resume workout</button>
      <button class="btn ghost small" style="margin-top:8px;color:var(--dim)" onclick="discardActive()">Discard this session</button></div>`;
  } else if(r && r.days.length){
    const next = nextDay(r);
    body += `<div class="card">
      <span class="eyebrow">Up next</span>
      <div class="exname" style="margin:3px 0 8px">${esc(next.name)}</div>
      <div class="small mute">${next.exercises.length} exercises · ${next.exercises.reduce((a,e)=>a+e.sets,0)} working sets</div>
      <div style="height:12px"></div>
      <button class="btn primary" onclick="startDay('${r.id}','${next.id}')">Start ${esc(next.name)}</button></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">${r.days.filter(d=>d.id!==next.id).map(d=>
        `<button class="btn sm" onclick="startDay('${r.id}','${d.id}')">${esc(d.name)}</button>`).join('')}</div>`;
  } else {
    body += `<div class="empty">No routine yet.<div style="height:12px"></div><button class="btn primary" onclick="go('plans')">Build a routine</button></div>`;
  }

  body += homeExtras();

  const wk = idx.filter(s=>daysBetween(s.date,today())<7).length;
  const vol = idx.filter(s=>daysBetween(s.date,today())<7).reduce((a,s)=>a+s.volume,0);
  body += `<div class="grid3">
    <div class="card stat"><div class="k num">${streak()}</div><div class="l">Week streak</div></div>
    <div class="card stat"><div class="k num">${wk}</div><div class="l">Last 7 days</div></div>
    <div class="card stat"><div class="k num">${vol>=1000?round1(vol/1000)+'k':Math.round(vol)}</div><div class="l">Volume ${DB.settings.unit}</div></div></div>`;

  if(idx.length){
    body += `<h2>Recent sessions</h2>` + idx.slice(-4).reverse().map(s=>sessionRow(s)).join('');
  }
  return head('Overload', new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}),
    `<button class="btn sm" onclick="go('settings')">⚙</button>`) + `<div class="wrap">${body}</div>`;
}
function nextDay(r){
  const last = [...DB.index].reverse().find(s=>s.routineId===r.id);
  if(!last) return r.days[0];
  const i = r.days.findIndex(d=>d.id===last.dayId);
  return r.days[(i+1)%r.days.length] || r.days[0];
}
function streak(){
  const weeks=new Set(DB.index.map(s=>{const d=new Date(s.date);const o=new Date(d.getFullYear(),0,1);return Math.floor((d-o)/6048e5);}));
  let n=0,d=new Date(); let cur=Math.floor((d-new Date(d.getFullYear(),0,1))/6048e5);
  while(weeks.has(cur)){n++;cur--;} return n;
}
function sessionRow(s){
  return `<button class="item card" onclick="openSession('${s.id}')"><div class="between">
    <div><div style="font-weight:600">${esc(s.dayName)}</div>
    <div class="small dim">${dLabel(s.date)} · ${s.sets} sets · ${Math.round(s.volume)} ${DB.settings.unit}</div></div>
    ${s.prs?`<span class="pill pr">${s.prs} PR</span>`:''}</div></button>`;
}

/* ---------------- START / WORKOUT ---------------- */
async function startDay(rid,did){
  // Starting a workout is a user gesture — the only moment a permission prompt
  // is both allowed and relevant. Asked once; declining is remembered by the browser.
  if(Notification_supported() && Notification.permission==='default'){
    try{ await Notification.requestPermission(); }catch(e){}
  }
  const r=DB.routines.find(x=>x.id===rid), d=r.days.find(x=>x.id===did);
  await loadExlogs(d.exercises.map(e=>e.exerciseId));
  ACTIVE={id:uid(),date:today(),startedAt:Date.now(),routineId:r.id,dayId:d.id,dayName:d.name,notes:'',
    exercises:d.exercises.map(pe=>{
      const ex=exById(pe.exerciseId);
      const cfg={...pe,inc:ex.inc};
      const sg=suggest(cfg,EXLOG[pe.exerciseId]);
      const sets=[];
      for(let i=0;i<pe.warm;i++) sets.push({w:sg.weight?roundTo(sg.weight*(i===0?.5:.7),ex.inc):null,r:5,rir:null,warm:true,done:false});
      for(let i=0;i<pe.sets;i++) sets.push({w:sg.weight,r:sg.hi,rir:null,warm:false,done:false});
      return {exerciseId:pe.exerciseId,name:ex.name,rest:pe.rest,target:sg,notes:'',sets};
    })};
  VIEW={name:'workout',i:0};
  await S.set('gym:active',ACTIVE); render();
}
async function discardActive(){ if(!confirm('Discard this session? Logged sets will be lost.'))return;
  ACTIVE=null; await S.del('gym:active'); go('today'); }

function viewWorkout(){
  if(!ACTIVE) return viewToday();
  const i=Math.min(VIEW.i||0,ACTIVE.exercises.length-1), e=ACTIVE.exercises[i];
  const log=EXLOG[e.exerciseId]||[], last=log[log.length-1];
  const u=DB.settings.unit;

  const prev = last? working(last.sets).map(s=>fmtW(s.w)+' × '+s.r).join('  ·  ') : 'First time logging this';
  const tagClass = {up:'up',deload:'hold',stall:'hold',return:'hold'}[e.target.tag]||'';
  const tagText = {up:'Add weight',hold:'Beat last time',stall:'Stalled',deload:'Deload',return:'Returning',start:'New lift'}[e.target.tag];

  const rows = e.sets.map((s,k)=>{
    const ref = last? working(last.sets)[e.sets.slice(0,k).filter(x=>!x.warm).length] : null;
    const better = s.done && ref && (s.w>ref.w || (s.w===ref.w && s.r>ref.r));
    return `<div class="setrow ${s.warm?'warm':''} ${s.done?'done':''} ${better?'better':''}" id="row${k}">
      <div class="setno num">${s.warm?'W':e.sets.slice(0,k).filter(x=>!x.warm).length+1}</div>
      <div><div class="ghost">${s.warm?'warm-up':(ref?'was '+fmtW(ref.w):'&nbsp;')}</div>
        <div class="step"><button onclick="bump(${k},'w',-1)">−</button>
        <input inputmode="decimal" value="${s.w??''}" onchange="setVal(${k},'w',this.value)"><button onclick="bump(${k},'w',1)">+</button></div></div>
      <div><div class="ghost">${ref?'× '+ref.r+(ref.rir!=null?' @'+ref.rir:''):'&nbsp;'}</div>
        <div class="step"><button onclick="bump(${k},'r',-1)">−</button>
        <input inputmode="numeric" value="${s.r??''}" onchange="setVal(${k},'r',this.value)"><button onclick="bump(${k},'r',1)">+</button></div></div>
      <div><div class="ghost">${DB.settings.useRir?`<button class="rirbtn" onclick="cycleRir(${k})">RIR ${s.rir??'–'}</button>`:'&nbsp;'}</div>
        <button class="tick" onclick="logSet(${k})">${s.done?'✓':'○'}</button></div></div>`;
  }).join('');

  const dots = ACTIVE.exercises.map((x,k)=>`<div class="dot ${k===i?'on':''} ${x.sets.filter(s=>!s.warm).every(s=>s.done)?'fin':''}"></div>`).join('');
  const doneAll = ACTIVE.exercises.every(x=>x.sets.filter(s=>!s.warm).every(s=>s.done));

  return `<header class="top"><div class="wrap"><div class="between">
      <button class="btn sm ghost" onclick="pauseWorkout()">Pause</button>
      <span class="eyebrow">${esc(ACTIVE.dayName)} · ${i+1}/${ACTIVE.exercises.length}<span id="syncdot" style="display:none;color:var(--yellow)"> • saving</span></span>
      <button class="btn sm" onclick="finishWorkout()" style="${doneAll?'background:var(--green);border-color:var(--green);color:#08160E;font-weight:600':''}">Finish</button>
    </div></div></header>
    <div class="wrap">
      <div class="card">
        <div class="exhead"><div class="exname">${esc(e.name)}</div>${tagText?`<span class="pill ${tagClass}">${tagText}</span>`:''}</div>
        <div class="refbar">
          <div style="flex:1"><span class="lab">Last time${last?' · '+dLabel(last.date):''}</span><span class="v num">${prev}</span></div>
          <div class="tgt" style="flex:1"><span class="lab">Today's target</span><span class="v num">${fmtW(e.target.weight)}${e.target.weight?' '+u:''} × ${e.target.lo}${e.target.hi>e.target.lo?'–'+e.target.hi:''} × ${e.target.sets}</span></div>
        </div>
        <div class="tiny dim" style="margin:6px 0 12px;line-height:1.5">${esc(e.target.why)} <span style="opacity:.6">Suggested from your logged data — not coaching advice.</span></div>
        ${rows}
        <div class="row" style="margin-top:12px;gap:8px">
          <button class="btn sm" onclick="addSet()">+ Set</button>
          <button class="btn sm" onclick="addSet(true)">+ Warm-up</button>
          <button class="btn sm" onclick="removeSet()">− Set</button>
          <button class="btn sm" onclick="startRest(${e.rest||DB.settings.rest})">Rest ${e.rest||DB.settings.rest}s</button>
        </div>
        <input style="margin-top:10px" placeholder="Note for this exercise" value="${esc(e.notes)}" onchange="ACTIVE.exercises[${i}].notes=this.value;persistActive()">
      </div>
      <div class="dots">${dots}</div>
      <div class="pager">
        <button class="btn" onclick="nav(-1)" ${i===0?'disabled style=opacity:.4':''}>← Previous</button>
        <button class="btn" onclick="nav(1)" ${i===ACTIVE.exercises.length-1?'disabled style=opacity:.4':''}>Next →</button>
      </div>
      <div style="height:70px"></div>
    </div>
    <div class="timerbar" id="tbar" style="display:none"><div class="fill" id="tfill"></div>
      <div class="in"><span class="small mute">Rest</span><span class="t num" id="tval">0:00</span>
      <div class="row"><button class="btn sm" onclick="addRest(30)">+30s</button><button class="btn sm" onclick="stopRest()">Skip</button></div></div></div>`;
}

const cur = ()=> ACTIVE.exercises[Math.min(VIEW.i||0,ACTIVE.exercises.length-1)];
function persistActive(){ S.set('gym:active',ACTIVE); }
function nav(d){ VIEW.i=Math.max(0,Math.min(ACTIVE.exercises.length-1,(VIEW.i||0)+d)); VIEW.scroll=0; render(); }
function bump(k,f,dir){
  const e=cur(), s=e.sets[k];
  if(f==='w'){ const inc=exById(e.exerciseId).inc||2.5; s.w=round1(Math.max(0,(+s.w||0)+dir*inc)); }
  else s.r=Math.max(0,(+s.r||0)+dir);
  persistActive(); softUpdate(k);
}
function setVal(k,f,v){ const s=cur().sets[k]; s[f]= v===''?null:Math.max(0,+v); persistActive(); }
function cycleRir(k){ const s=cur().sets[k]; const seq=[null,4,3,2,1,0]; s.rir=seq[(seq.indexOf(s.rir)+1)%seq.length]; persistActive(); render(); }
function softUpdate(k){ const row=document.getElementById('row'+k); if(!row)return;
  const s=cur().sets[k]; const ins=row.querySelectorAll('input'); ins[0].value=s.w??''; ins[1].value=s.r??''; }
function addSet(warm=false){ const e=cur(); const t=e.target;
  const base=e.sets.filter(x=>x.warm===warm).slice(-1)[0] || e.sets.slice(-1)[0] || {w:t.weight,r:t.hi};
  const s={w:base.w,r:warm?5:base.r,rir:null,warm,done:false};
  if(warm) e.sets.splice(e.sets.filter(x=>x.warm).length,0,s); else e.sets.push(s);
  persistActive(); render(); }
function removeSet(){ const e=cur(); const i=[...e.sets].reverse().findIndex(s=>!s.done);
  if(i<0) return toast('Nothing to remove — all sets are logged.');
  e.sets.splice(e.sets.length-1-i,1); persistActive(); render(); }

function logSet(k){
  const e=cur(), s=e.sets[k];
  if(s.done){ s.done=false; persistActive(); render(); return; }
  if(!s.r || s.w==null) return toast('Add a weight and reps first.');
  s.done=true; s.ts=Date.now();
  persistActive();
  render();
  const row=document.getElementById('row'+k); if(row) row.classList.add('flash');
  if(!s.warm){
    const log=EXLOG[e.exerciseId]||[], last=log[log.length-1];
    const ref=last? working(last.sets)[e.sets.slice(0,k).filter(x=>!x.warm).length]:null;
    if(ref){ const d=(s.w*s.r)-(ref.w*ref.r);
      if(s.w>ref.w) toast('Heavier than last time — '+fmtW(ref.w)+' → '+fmtW(s.w));
      else if(s.r>ref.r) toast('+'+(s.r-ref.r)+' rep'+(s.r-ref.r>1?'s':'')+' vs last time');
      else if(d<0) toast('Below last time ('+fmtW(ref.w)+' × '+ref.r+')');
    }
  }
  if(e.rest||DB.settings.rest) startRest(e.rest||DB.settings.rest);
  // auto-advance when the last set of this exercise is done
  const allDone=e.sets.filter(x=>!x.warm).every(x=>x.done);
  if(allDone && (VIEW.i||0)<ACTIVE.exercises.length-1) setTimeout(()=>nav(1),700);
}

/* ---------- rest timer (timestamp-based; survives screen lock) ---------- */
const restLabel = ()=> (ACTIVE && cur() && cur().name) ? 'Next set — '+cur().name : 'Next set.';
function startRest(sec){ TIMER={end:Date.now()+sec*1000,total:sec}; restNotify(TIMER.end,restLabel()); paintTimer(); }
function addRest(s){ if(TIMER){TIMER.end+=s*1000;TIMER.total+=s;restNotify(TIMER.end,restLabel());paintTimer();} }
function stopRest(){ TIMER=null; restCancel(); const b=document.getElementById('tbar'); if(b)b.style.display='none'; }
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
}
function beep(){ try{ if(navigator.vibrate) navigator.vibrate([200,80,200]);
  if(!DB.settings.sound) return;
  const c=new (window.AudioContext||window.webkitAudioContext)(); const o=c.createOscillator(),g=c.createGain();
  o.connect(g);g.connect(c.destination);o.frequency.value=740;g.gain.setValueAtTime(.18,c.currentTime);
  g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.6);o.start();o.stop(c.currentTime+.6);}catch(e){} }

function pauseWorkout(){ go('today'); }

async function finishWorkout(){
  const logged=ACTIVE.exercises.reduce((a,e)=>a+e.sets.filter(s=>s.done&&!s.warm).length,0);
  if(!logged){ if(!confirm('No sets logged. Discard this session?')) return; return discardActive(); }
  const sess={...ACTIVE,endedAt:Date.now(),
    exercises:ACTIVE.exercises.map(e=>({...e,sets:e.sets.filter(s=>s.done)}))
      .filter(e=>e.sets.length)};
  let vol=0,sets=0,allPRs=[];
  for(const e of sess.exercises){
    const log=EXLOG[e.exerciseId]||[];
    log.push({sessionId:sess.id,date:sess.date,sets:e.sets.map(s=>({w:s.w,r:s.r,rir:s.rir,warm:s.warm}))});
    EXLOG[e.exerciseId]=log;
    const {found}=checkPRs(e.exerciseId,e.sets);
    allPRs.push(...found.map(f=>({...f,ex:e.name})));
    for(const s of working(e.sets)){ vol+=s.w*s.r; sets++; }
  }
  await Promise.all(sess.exercises.map(e=>S.set('gym:exlog:'+e.exerciseId,EXLOG[e.exerciseId])));
  await S.set('gym:session:'+sess.id,sess);
  DB.index.push({id:sess.id,date:sess.date,dayName:sess.dayName,routineId:sess.routineId,dayId:sess.dayId,
    volume:vol,sets,prs:allPRs.length,mins:Math.round((sess.endedAt-sess.startedAt)/6e4)});
  await save();
  ACTIVE=null; await S.del('gym:active'); stopRest();
  VIEW={name:'session',id:sess.id,prs:allPRs,fresh:true};
  render();
}

/* ---------------- HISTORY ---------------- */
function viewHistory(){
  if(!DB.index.length) return head('History','Sessions')+`<div class="wrap"><div class="empty">Nothing logged yet. Your sessions will stack up here.</div></div>`;
  const byMonth={};
  [...DB.index].reverse().forEach(s=>{const m=new Date(s.date+'T00:00').toLocaleDateString(undefined,{month:'long',year:'numeric'});(byMonth[m]=byMonth[m]||[]).push(s);});
  return head('History','Sessions')+`<div class="wrap">`+Object.entries(byMonth).map(([m,list])=>
    `<h2>${m}</h2>`+list.map(sessionRow).join('')).join('')+`</div>`;
}
async function openSession(id){ const s=await S.get('gym:session:'+id); VIEW={name:'session',id,data:s}; render(); }
function viewSession(){
  const s=VIEW.data||S.mem['gym:session:'+VIEW.id];
  if(!s) return head('Session','Loading…')+'<div class="wrap"></div>';
  const prs=VIEW.prs||[];
  const idx=DB.index.find(x=>x.id===s.id)||{};
  let body='';
  if(VIEW.fresh){
    body+=`<div class="card" style="border-color:var(--green)">
      <span class="eyebrow" style="color:var(--green)">Session complete</span>
      <div class="grid3" style="margin-top:10px">
        <div class="stat"><div class="k num">${idx.sets||0}</div><div class="l">Sets</div></div>
        <div class="stat"><div class="k num">${Math.round(idx.volume||0)}</div><div class="l">Volume</div></div>
        <div class="stat"><div class="k num">${idx.mins||0}</div><div class="l">Minutes</div></div></div></div>`;
  }
  if(prs.length) body+=`<div class="card" style="border-color:var(--red)"><span class="eyebrow" style="color:var(--red)">New records</span>
    ${prs.map(p=>`<div class="between" style="margin-top:9px"><div><div style="font-weight:600">${esc(p.ex)}</div><div class="small dim">${esc(p.t)}</div></div><div class="num" style="font-size:20px">${esc(p.v)}</div></div>`).join('')}</div>`;

  body+=s.exercises.map(e=>{
    const w=working(e.sets);
    return `<div class="card"><div class="between"><div class="exname" style="font-size:20px">${esc(e.name)}</div>
      <button class="btn sm ghost" onclick="openExercise('${e.exerciseId}')">History</button></div>
      <div class="num mute" style="margin-top:6px;line-height:1.7">${w.map(x=>fmtW(x.w)+' × '+x.r+(x.rir!=null?' @'+x.rir:'')).join('<br>')||'—'}</div>
      ${e.notes?`<div class="small dim" style="margin-top:8px">${esc(e.notes)}</div>`:''}</div>`;
  }).join('');
  body+=`<button class="btn danger" style="margin-top:6px" onclick="deleteSession('${s.id}')">Delete session</button><div style="height:20px"></div>`;
  return head(dLabel(s.date),s.dayName,`<button class="btn sm" onclick="go('history')">Close</button>`)+`<div class="wrap">${body}</div>`;
}
async function deleteSession(id){
  if(!confirm('Delete this session permanently? Records that came from it are not recalculated.'))return;
  const s=await S.get('gym:session:'+id);
  for(const e of (s?.exercises||[])){
    const log=(EXLOG[e.exerciseId]||await S.get('gym:exlog:'+e.exerciseId)||[]).filter(h=>h.sessionId!==id);
    EXLOG[e.exerciseId]=log; await S.set('gym:exlog:'+e.exerciseId,log);
  }
  DB.index=DB.index.filter(x=>x.id!==id); await save(); await S.del('gym:session:'+id);
  go('history');
}

/* ---------------- EXERCISES ---------------- */
function viewExercises(){
  const q=(VIEW.q||'').toLowerCase(), f=VIEW.f||'';
  const muscles=[...new Set(DB.exercises.map(e=>e.muscle))];
  const list=DB.exercises.filter(e=>(!q||e.name.toLowerCase().includes(q))&&(!f||e.muscle===f));
  return head('Library',DB.exercises.length+' lifts',`<button class="btn sm" onclick="newExercise()">+ New</button>`)+
  `<div class="wrap">
    <input placeholder="Search lifts" value="${esc(VIEW.q||'')}" oninput="VIEW.q=this.value;renderList()">
    <div style="margin:10px 0 4px">${muscles.map(m=>`<button class="chip ${f===m?'on':''}" onclick="VIEW.f='${f===m?'':m}';render()">${esc(m)}</button>`).join('')}</div>
    <div id="exlist">${list.map(exRow).join('')||'<div class="empty">No match.</div>'}</div><div style="height:20px"></div></div>`;
}
function exRow(e){
  const pr=DB.prs[e.id];
  return `<button class="item card" onclick="openExercise('${e.id}')"><div class="between">
    <div><div style="font-weight:600">${esc(e.name)}</div><div class="small dim">${esc(e.muscle)} · ${esc(e.equipment)} · +${e.inc}${DB.settings.unit}</div></div>
    ${pr?.w?`<div class="num" style="font-size:19px">${fmtW(pr.w)}</div>`:''}</div></button>`;
}
function renderList(){ const q=(VIEW.q||'').toLowerCase(),f=VIEW.f||'';
  document.getElementById('exlist').innerHTML=DB.exercises.filter(e=>(!q||e.name.toLowerCase().includes(q))&&(!f||e.muscle===f)).map(exRow).join('')||'<div class="empty">No match.</div>'; }
function newExercise(){
  const name=prompt('Exercise name'); if(!name) return;
  const dup=DB.exercises.find(e=>e.name.toLowerCase().replace(/[^a-z]/g,'')===name.toLowerCase().replace(/[^a-z]/g,''));
  if(dup&&!confirm('"'+dup.name+'" already exists. Create a second one anyway? Your history will be split between them.')) return;
  const muscle=prompt('Muscle group','Chest')||'Other';
  const equipment=prompt('Equipment (Barbell / Dumbbell / Machine / Cable / Bodyweight)','Barbell')||'Other';
  const inc=+(prompt('Smallest weight jump available in your gym ('+DB.settings.unit+')','2.5')||2.5);
  DB.exercises.push({id:uid(),name,muscle,equipment,inc,custom:true}); save(); render();
}
async function openExercise(id){ if(!EXLOG[id]) await loadExlogs([id]); VIEW={name:'exercise',id}; render(); }
function viewExercise(){
  const e=exById(VIEW.id), log=EXLOG[VIEW.id]||[], pr=DB.prs[VIEW.id]||{};
  let body='';
  if(!log.length) body+=`<div class="empty">No sessions logged for this lift yet.</div>`;
  else{
    const pts=log.map(h=>{const w=working(h.sets); const best=Math.max(...w.map(s=>e1rm(s.w,s.r)||s.w)); return {d:h.date,v:best};}).filter(p=>isFinite(p.v));
    body+=chart(pts);
    body+=`<div class="grid2">
      <div class="card stat"><div class="k num">${fmtW(pr.w||0)}</div><div class="l">Heaviest</div></div>
      <div class="card stat"><div class="k num">${fmtW(pr.e||0)}</div><div class="l">Est. 1RM</div></div></div>`;
    body+=`<h2>Sessions</h2>`+[...log].reverse().map(h=>{
      const w=working(h.sets);
      return `<div class="card"><div class="between"><span class="small mute">${dLabel(h.date)}</span>
        <span class="tiny dim">${Math.round(w.reduce((a,s)=>a+s.w*s.r,0))} ${DB.settings.unit}</span></div>
        <div class="num" style="line-height:1.7;margin-top:4px">${w.map(s=>fmtW(s.w)+' × '+s.r+(s.rir!=null?' @'+s.rir:'')).join('<br>')}</div></div>`;
    }).join('');
  }
  return head(e.muscle+' · '+e.equipment,e.name,`<button class="btn sm" onclick="go('exercises')">Close</button>`)+
    `<div class="wrap">${body}<div style="height:20px"></div></div>`;
}
function chart(pts){
  if(pts.length<2) return '';
  const W=480,H=140,P=14;
  const min=Math.min(...pts.map(p=>p.v)),max=Math.max(...pts.map(p=>p.v)),span=(max-min)||1;
  const x=i=>P+i*(W-2*P)/(pts.length-1), y=v=>H-P-((v-min)/span)*(H-2*P-10);
  const d=pts.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p.v).toFixed(1)).join(' ');
  return `<div class="card"><span class="eyebrow">Estimated 1RM trend</span>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:6px" role="img" aria-label="Estimated one-rep-max trend">
      <path d="${d}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round"/>
      ${pts.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="var(--blue)"/>`).join('')}
      <text x="${P}" y="12" fill="#5D6673" font-size="11">${fmtW(max)}</text>
      <text x="${P}" y="${H-2}" fill="#5D6673" font-size="11">${fmtW(min)}</text>
    </svg>
    <div class="tiny dim">Epley estimate from your top set. Rough above 10 reps — use it as a trend, not a number.</div></div>`;
}

/* ---------------- PLANS ---------------- */
function viewPlans(){
  return head('Plans','Routines',`<button class="btn sm" onclick="newRoutine()">+ New</button>`)+`<div class="wrap">`+
    DB.routines.map(r=>`<div class="card"><div class="between"><div>
      <div style="font-weight:600">${esc(r.name)}</div><div class="small dim">${r.days.map(d=>esc(d.name)).join(' · ')||'No days yet'}</div></div>
      <button class="btn sm" onclick="go('plan',{id:'${r.id}'})">Edit</button></div></div>`).join('')+
    `<div style="height:20px"></div></div>`;
}
function newRoutine(){ const n=prompt('Routine name','My split'); if(!n)return;
  DB.routines.push({id:uid(),name:n,days:[]}); save(); render(); }
function viewPlan(){
  const r=DB.routines.find(x=>x.id===VIEW.id); if(!r) return viewPlans();
  return head('Routine',r.name,`<button class="btn sm" onclick="go('plans')">Done</button>`)+`<div class="wrap">`+
    r.days.map((d,di)=>`<div class="card">
      <div class="between"><div class="exname" style="font-size:19px">${esc(d.name)}</div>
        <div class="row"><button class="btn sm" onclick="renameDay('${r.id}','${d.id}')">Rename</button>
        <button class="btn sm danger" onclick="delDay('${r.id}','${d.id}')">Delete</button></div></div>
      <div class="sep"></div>
      ${d.exercises.map((pe,i)=>{const ex=exById(pe.exerciseId);return `
        <div class="between" style="padding:7px 0">
          <div style="flex:1"><div style="font-weight:500">${esc(ex.name)}</div>
            <div class="small dim">${pe.sets} × ${pe.repMin}–${pe.repMax} · ${pe.rest}s rest${pe.warm?' · '+pe.warm+' warm-up':''}</div></div>
          <div class="row">
            <button class="btn sm" onclick="moveEx('${r.id}','${d.id}',${i},-1)" ${i===0?'disabled style=opacity:.3':''}>↑</button>
            <button class="btn sm" onclick="moveEx('${r.id}','${d.id}',${i},1)" ${i===d.exercises.length-1?'disabled style=opacity:.3':''}>↓</button>
            <button class="btn sm" onclick="editEx('${r.id}','${d.id}','${pe.id}')">Edit</button>
          </div></div>`}).join('')||'<div class="small dim" style="padding:6px 0">No exercises yet.</div>'}
      <button class="btn sm" style="margin-top:8px" onclick="pickExercise('${r.id}','${d.id}')">+ Add exercise</button>
    </div>`).join('')+
    `<button class="btn" onclick="addDay('${r.id}')">+ Add training day</button>
     <button class="btn danger" style="margin-top:8px" onclick="delRoutine('${r.id}')">Delete routine</button><div style="height:20px"></div></div>`;
}
const R=id=>DB.routines.find(x=>x.id===id);
function addDay(rid){ const n=prompt('Day name','Push'); if(!n)return; R(rid).days.push({id:uid(),name:n,exercises:[]}); save(); render(); }
function renameDay(rid,did){ const d=R(rid).days.find(x=>x.id===did); const n=prompt('Day name',d.name); if(!n)return; d.name=n; save(); render(); }
function delDay(rid,did){ if(!confirm('Delete this day? Past sessions stay in your history.'))return;
  const r=R(rid); r.days=r.days.filter(d=>d.id!==did); save(); render(); }
function delRoutine(rid){ if(!confirm('Delete this routine? Past sessions stay in your history.'))return;
  DB.routines=DB.routines.filter(r=>r.id!==rid); save(); go('plans'); }
function moveEx(rid,did,i,dir){ const list=R(rid).days.find(d=>d.id===did).exercises;
  const j=i+dir; if(j<0||j>=list.length)return; [list[i],list[j]]=[list[j],list[i]]; save(); render(); }
function pickExercise(rid,did){
  const html=`<div class="sheet" onclick="if(event.target===this)closeSheet()"><div class="inner">
    <h2 style="margin-top:0">Add exercise</h2>
    <input id="pq" placeholder="Search" oninput="filterPick()">
    <div id="pl" style="margin-top:10px">${DB.exercises.map(e=>`<button class="item card" onclick="addExTo('${rid}','${did}','${e.id}')">
      <div style="font-weight:500">${esc(e.name)}</div><div class="small dim">${esc(e.muscle)} · ${esc(e.equipment)}</div></button>`).join('')}</div>
    <button class="btn ghost" onclick="closeSheet()">Cancel</button></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html); document.getElementById('pq').focus();
}
function filterPick(){ const q=document.getElementById('pq').value.toLowerCase();
  [...document.querySelectorAll('#pl .item')].forEach(b=>{b.style.display=b.textContent.toLowerCase().includes(q)?'block':'none'}); }
function addExTo(rid,did,exId){
  R(rid).days.find(d=>d.id===did).exercises.push({id:uid(),exerciseId:exId,sets:3,repMin:8,repMax:12,rest:120,warm:0,rir:2,notes:''});
  save(); closeSheet(); render();
}
function editEx(rid,did,peId){
  const d=R(rid).days.find(x=>x.id===did), pe=d.exercises.find(x=>x.id===peId), ex=exById(pe.exerciseId);
  const html=`<div class="sheet" onclick="if(event.target===this)closeSheet()"><div class="inner">
    <h2 style="margin-top:0">${esc(ex.name)}</h2>
    <div class="grid2">
      <label class="small dim">Working sets<input id="f_sets" inputmode="numeric" value="${pe.sets}"></label>
      <label class="small dim">Warm-up sets<input id="f_warm" inputmode="numeric" value="${pe.warm||0}"></label>
      <label class="small dim">Min reps<input id="f_lo" inputmode="numeric" value="${pe.repMin}"></label>
      <label class="small dim">Max reps<input id="f_hi" inputmode="numeric" value="${pe.repMax}"></label>
      <label class="small dim">Rest (sec)<input id="f_rest" inputmode="numeric" value="${pe.rest}"></label>
      <label class="small dim">Weight jump (${DB.settings.unit})<input id="f_inc" inputmode="decimal" value="${ex.inc}"></label>
    </div>
    <div style="height:12px"></div>
    <button class="btn primary" onclick="saveEx('${rid}','${did}','${peId}')">Save</button>
    <button class="btn danger" style="margin-top:8px" onclick="rmEx('${rid}','${did}','${peId}')">Remove from day</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet()">Cancel</button></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function saveEx(rid,did,peId){
  const g=id=>+document.getElementById(id).value;
  const d=R(rid).days.find(x=>x.id===did), pe=d.exercises.find(x=>x.id===peId);
  const lo=Math.max(1,g('f_lo')), hi=Math.max(lo,g('f_hi'));
  Object.assign(pe,{sets:Math.max(1,g('f_sets')),warm:Math.max(0,g('f_warm')),repMin:lo,repMax:hi,rest:Math.max(0,g('f_rest'))});
  const ex=DB.exercises.find(e=>e.id===pe.exerciseId); if(ex) ex.inc=Math.max(0,g('f_inc'));
  save(); closeSheet(); render();
}
function rmEx(rid,did,peId){ const d=R(rid).days.find(x=>x.id===did);
  d.exercises=d.exercises.filter(x=>x.id!==peId); save(); closeSheet(); render(); }

/* ---------------- SETTINGS / DATA ---------------- */
function viewSettings(){
  return head('Settings','Preferences',`<button class="btn sm" onclick="go('today')">Close</button>`)+`<div class="wrap">
    <div class="card"><div class="between"><div>Units</div>
      <div class="row"><button class="btn sm ${DB.settings.unit==='kg'?'primary':''}" onclick="setUnit('kg')">kg</button>
      <button class="btn sm ${DB.settings.unit==='lb'?'primary':''}" onclick="setUnit('lb')">lb</button></div></div></div>
    <div class="card"><div class="between"><div>Track RIR<div class="small dim">Reps left in the tank</div></div>
      <button class="btn sm ${DB.settings.useRir?'primary':''}" onclick="DB.settings.useRir=!DB.settings.useRir;save();render()">${DB.settings.useRir?'On':'Off'}</button></div></div>
    <div class="card"><div class="between"><div>Rest timer sound</div>
      <button class="btn sm ${DB.settings.sound?'primary':''}" onclick="DB.settings.sound=!DB.settings.sound;save();render()">${DB.settings.sound?'On':'Off'}</button></div></div>
    <div class="card"><div class="between"><div>Default rest<div class="small dim">Used when a lift has none set</div></div>
      <input style="width:90px" inputmode="numeric" value="${DB.settings.rest}" onchange="DB.settings.rest=+this.value||120;save()"></div></div>
    <div class="card"><div class="between"><div>Background rest alerts
      <div class="small dim" id="notestate">${esc(notifLabel())}</div></div>
      ${Notification_supported()? (Notification.permission==='granted'
        ? '<span class="pill up">On</span>'
        : Notification.permission==='denied'
          ? '<span class="pill">Blocked</span>'
          : '<button class="btn sm primary" onclick="askNotif()">Enable</button>')
        : '<span class="pill">N/A</span>'}</div></div>
    ${settingsExtras()}
    <h2>Your data</h2>
    <button class="btn" onclick="exportData()">Export everything as JSON</button>
    <button class="btn" style="margin-top:8px" onclick="importData()">Import from a file</button>
    <button class="btn ghost small" style="margin-top:8px" onclick="importPaste()">Import by pasting JSON</button>
    <button class="btn danger" style="margin-top:8px" onclick="wipe()">Delete all data</button>
    <div class="tiny dim" id="storagenote" style="margin-top:14px;line-height:1.6">Stored on this device only.</div>
    <div class="tiny dim" style="margin-top:10px;line-height:1.6">Progression targets come from your own logged sets. They are app-generated suggestions, not coaching or medical advice.</div>
    <div style="height:20px"></div></div>`;
}
function setUnit(u){ DB.settings.unit=u; save(); render(); toast('Unit changed. Existing numbers are not converted.'); }

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
