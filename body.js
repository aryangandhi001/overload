/* ============================================================
   OVERLOAD — bodyweight.

   Its own module on purpose. Bodyweight belongs to neither the training log
   nor the food log; it is the measurement that makes sense of both, and Phase 3
   joins it against intake. Depends on core.js only.

   Numbers only. No target weight, no goal, no "on track", no commentary.

   Storage key:
     bw:log   { "YYYY-MM-DD": kg }  one reading per local day, latest wins
   ============================================================ */

let BW = {};

const BW_MIN = 20, BW_MAX = 400;

/** A weight, or null. Rejects NaN, negatives and anything off a human scale. */
function bwValid(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return null;
  if(n < BW_MIN || n > BW_MAX) return null;
  return Math.round(n * 10) / 10;
}

const bwDates = ()=> Object.keys(BW).sort();
const bwLatest = ()=>{ const d = bwDates(); return d.length ? { date:d[d.length-1], kg:BW[d[d.length-1]] } : null; };

/** Mean of the readings in the n days ending at `end`, or null if none.
    Gaps are skipped rather than interpolated — an unweighed day is not a
    measurement and must not be invented. */
function bwAverage(end, days){
  let sum = 0, n = 0;
  for(let i = 0; i < days; i++){
    const d = shiftDay(end, -i);
    if(BW[d] != null){ sum += BW[d]; n++; }
  }
  return n ? { kg: Math.round(sum / n * 10) / 10, n } : null;
}

async function bwSet(date, kg){
  const v = bwValid(kg);
  if(v === null) return toast('Enter a weight between '+BW_MIN+' and '+BW_MAX+' kg.');
  BW[date] = v;
  await S.set('bw:log', BW);
  render();
  return v;
}
async function bwDelete(date){
  delete BW[date];
  await S.set('bw:log', BW);
  render();
}

/* ------------------------------------------------------------------- entry */
function bwPrompt(date){
  date = date || today();
  const cur = BW[date] ?? (bwLatest() ? bwLatest().kg : 70);
  BW.__draft = cur;
  nutlessSheet(bwSheetHTML(date));
}
function bwSheetHTML(date){
  const v = BW.__draft;
  const isToday = date === today();
  const prev = bwLatest();
  return `<h2 style="margin-top:0">Weight${isToday ? '' : ' · ' + dLabel(date)}</h2>
    <div class="small dim" style="margin-bottom:14px">Same time each day is what makes the trend readable — most people use first thing, after the loo, before eating.</div>
    <div class="step" style="max-width:240px;margin-bottom:8px">
      <button onclick="bwNudge(-0.1)">−</button>
      <input inputmode="decimal" value="${v}" onchange="bwDraft(this.value)">
      <button onclick="bwNudge(0.1)">+</button>
    </div>
    <div class="row" style="gap:6px;margin-bottom:16px">
      <button class="btn sm" onclick="bwNudge(-1)">−1</button>
      <button class="btn sm" onclick="bwNudge(-0.5)">−0.5</button>
      <button class="btn sm" onclick="bwNudge(0.5)">+0.5</button>
      <button class="btn sm" onclick="bwNudge(1)">+1</button>
      <span class="small dim" style="margin-left:auto;align-self:center">kg</span>
    </div>
    ${prev ? `<div class="small dim" style="margin-bottom:12px">Last reading ${fmtW(prev.kg)} kg on ${dLabel(prev.date)}.</div>` : ''}
    <button class="btn primary" onclick="bwSave('${date}')">Save</button>
    ${BW[date] != null ? `<button class="btn danger" style="margin-top:8px" onclick="bwDelete('${date}');closeSheet()">Remove this reading</button>` : ''}
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet()">Cancel</button>`;
}
function bwDraft(v){
  const n = bwValid(v);
  if(n === null){ toast('Enter a weight between '+BW_MIN+' and '+BW_MAX+' kg.'); return; }
  BW.__draft = n;
}
function bwNudge(d){
  BW.__draft = Math.round(Math.min(BW_MAX, Math.max(BW_MIN, (Number(BW.__draft)||70) + d)) * 10) / 10;
  const s = document.querySelector('.sheet .inner');
  if(s) s.innerHTML = bwSheetHTML(BW.__date || today());
}
async function bwSave(date){
  const v = await bwSet(date, BW.__draft);
  if(v == null) return;
  delete BW.__draft;
  closeSheet();
  toast(fmtW(v) + ' kg logged.');
}
/** A sheet, without borrowing the nutrition module's helper. */
function nutlessSheet(inner){
  closeSheet();
  document.body.insertAdjacentHTML('beforeend',
    `<div class="sheet" onclick="if(event.target===this)closeSheet()"><div class="inner">${inner}</div></div>`);
}

/* -------------------------------------------------------------- home card */
registerHomeCard(()=>{
  const t = today();
  const logged = BW[t];
  const latest = bwLatest();
  const avg = bwAverage(t, 7);
  const prevAvg = bwAverage(shiftDay(t, -7), 7);

  if(!latest){
    return `<div class="card"><div class="between">
      <div><div style="font-weight:600">Bodyweight</div>
      <div class="small dim">Not logged yet.</div></div>
      <button class="btn sm primary" onclick="bwPrompt()">Log</button></div></div>`;
  }

  /* The 7-day average against the previous 7 days. Stated as a measured change
     over a stated window — no target, no verdict. */
  let delta = '';
  if(avg && prevAvg && avg.n >= 2 && prevAvg.n >= 2){
    const d = Math.round((avg.kg - prevAvg.kg) * 10) / 10;
    const sign = d > 0 ? '+' : '';
    delta = `<div class="small dim">7-day avg ${fmtW(avg.kg)} · ${sign}${fmtW(d)} kg vs the week before</div>`;
  } else if(avg){
    delta = `<div class="small dim">7-day avg ${fmtW(avg.kg)} kg from ${avg.n} reading${avg.n===1?'':'s'}</div>`;
  }

  return `<div class="card"><div class="between">
    <div><div style="font-weight:600">Bodyweight</div>
      ${delta || `<div class="small dim">${dLabel(latest.date)}</div>`}</div>
    <div class="row" style="gap:10px">
      <div class="num" style="font-size:26px;font-weight:700">${fmtW(latest.kg)}<span class="tiny dim"> kg</span></div>
      <button class="btn sm ${logged ? '' : 'primary'}" onclick="bwPrompt()">${logged ? 'Edit' : 'Log'}</button>
    </div></div></div>`;
});

/* ------------------------------------------------------------ registration */
registerData({
  async collect(){ return { body:{ weight: BW } }; },
  async restore(d){
    const w = d.body && d.body.weight;
    if(!w) return '';                      // a v1/v2 backup has no weight data
    BW = {};
    for(const [date,kg] of Object.entries(w)){
      const v = bwValid(kg);
      if(v !== null && /^\d{4}-\d{2}-\d{2}$/.test(date)) BW[date] = v;
    }
    await S.set('bw:log', BW);
    const n = Object.keys(BW).length;
    return n ? n + ' weigh-in' + (n===1?'':'s') : '';
  }
});

registerBoot(async ()=>{
  BW = (await S.get('bw:log')) || {};
  // Guard against a corrupted record rather than rendering NaN.
  for(const k of Object.keys(BW)) if(bwValid(BW[k]) === null) delete BW[k];
});
