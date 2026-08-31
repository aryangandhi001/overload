/* ============================================================
   OVERLOAD — nutrition module.
   Indian home food logging. Measured numbers only: no targets, no scores,
   no warnings, no advice.

   Depends on core.js only. The workout module has no idea this exists.

   Storage keys:
     nut:day:<YYYY-MM-DD>  { entries:[…] } for that local day
     nut:recent            [foodId] most-recently-used first
     nut:freq              { foodId: {n, slots:{…}} } usage counts by meal slot
     nut:meals             [ {id,name,slot,items,uses} ] saved meal templates
     nut:custom            { foodId: {…} } my own foods and edited recipes
     nut:units             { "foodId|label": grams } piece weights I've corrected
   ============================================================ */

const NL = String.fromCharCode(10);
const NUT_SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
const NUT_SLOT_LABEL = { breakfast:'Breakfast', lunch:'Lunch', snack:'Snack', dinner:'Dinner' };

/* Macros shown up top, minerals behind a fold. Labels are units-explicit so a
   number is never ambiguous. */
const NUT_MACROS   = [['kcal','Calories',''],['protein_g','Protein','g'],
                      ['carb_g','Carbs','g'],['fat_g','Fat','g'],['fiber_g','Fibre','g']];
const NUT_MINERALS = [['iron_mg','Iron','mg'],['calcium_mg','Calcium','mg'],['zinc_mg','Zinc','mg'],
                      ['magnesium_mg','Magnesium','mg'],['sodium_mg','Sodium','mg'],['potassium_mg','Potassium','mg']];

/* Ingredient units as they appear in INDB's recipe lines. Only used when
   re-costing an edited recipe. */
const NUT_ING_G = { g:1, ml:1, tsp:5, tbsp:15, C:240, cup:240, sprig:1, nos:30, pinch:0.5, drops:0.05, sheet:5 };

/* INDB names servings in household language already ("parantha", "chapati",
   "bowl"). These fold its bowl-family words onto the one Aryan uses. This is a
   relabelling, never a re-weighing — each dish keeps its own gram weight. */
const NUT_UNIT_ALIAS = {
  'bowl':'katori', 'small bowl':'small katori', 'soup bowl':'soup katori',
  'curry bowl':'curry katori', 'cup':'katori', 'tea cup':'small katori',
  'tall glass':'tall glass', 'tablespoon':'tbsp', 'teaspoon':'tsp'
};

let FOODS = null;          // the bundle, once fetched
let FOODIX = null;         // id -> food
let NUTIX = {};            // nutrient key -> position in the value arrays
let PORTIONS = {};         // USDA piece geometry, keyed by food-name fragment
let NUT = { day:{}, date:null, recent:[], freq:{}, meals:[], custom:{}, units:{}, open:{} };

/* ------------------------------------------------------------------ helpers */
const fmtN = (v, dp=0) => (v===null || v===undefined || !Number.isFinite(+v)) ? '—'
  : (dp ? (Math.round(v*10**dp)/10**dp).toFixed(dp) : String(Math.round(v)));

/** Sum nutrient arrays. null + null stays null; null + number is the number,
    with the total marked partial so the UI can say so rather than imply the
    missing food contributed zero. */
function nutSum(list){
  const acc = FOODS ? FOODS.nutrients.map(()=>null) : [];
  for(const e of list){
    if(!e.n) continue;
    for(let i=0;i<e.n.length;i++){
      if(e.n[i]===null || e.n[i]===undefined) continue;
      acc[i] = (acc[i]===null? 0 : acc[i]) + e.n[i];
    }
  }
  return acc;
}
const nv = (arr, key) => (arr && NUTIX[key]!==undefined) ? arr[NUTIX[key]] : null;

function nutSlotForNow(d=new Date()){
  const h = d.getHours();
  if(h < 11) return 'breakfast';
  if(h < 16) return 'lunch';
  if(h < 19) return 'snack';
  return 'dinner';
}

/* ------------------------------------------------------- the food database */
/* Where the database comes from, in order:
     1. IndexedDB, if it has been loaded on this device before
     2. data/foods.json next to the app, when running locally
     3. nowhere — the app asks for the file
   Step 2 is absent on the hosted copy on purpose: IFCT 2017 forbids electronic
   reproduction for a product without NIN's written permission, so the data is
   never published. It is loaded once from a file and lives on the device. */
async function nutLoadFoods(){
  if(FOODS) return FOODS;
  let bundle = await S.get('nut:db');
  if(!bundle){
    try{
      const res = await fetch('data/foods.json');
      if(res.ok) bundle = await res.json();
    }catch(e){ /* not served here — that is expected on the hosted copy */ }
  }
  if(!bundle) return null;                 // the UI will ask for the file
  FOODS = bundle;
  PORTIONS = bundle.portions || {};
  NUTIX = Object.fromEntries(FOODS.nutrients.map((n,i)=>[n,i]));
  FOODIX = new Map();
  for(const f of FOODS.foods){
    f._s = (f.name + ' ' + (f.alt||'')).toLowerCase();
    FOODIX.set(f.id, f);
  }
  // Personal variants shadow the source rows they were based on.
  for(const [id,c] of Object.entries(NUT.custom||{})){
    c._s = (c.name+' '+(c.alt||'')).toLowerCase();
    FOODIX.set(id, c);
  }
  return FOODS;
}

/** Load the database from a file the user picks, and keep it on the device. */
function nutLoadDBFile(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='application/json,.json';
  inp.onchange=async()=>{
    const f=inp.files&&inp.files[0]; if(!f) return;
    toast('Reading '+f.name+' …');
    let b; try{ b=JSON.parse(await f.text()); }catch(e){ return toast('That is not valid JSON.'); }
    if(!b || !Array.isArray(b.foods) || !Array.isArray(b.nutrients))
      return toast('That is not the Overload food database.');
    try{ await S.set('nut:db', b); }
    catch(e){ storageFault('write',e); return; }
    FOODS=null; FOODIX=null;
    await nutLoadFoods();
    toast(b.foods.length.toLocaleString()+' foods loaded.');
    render();
  };
  inp.click();
}

const nutFood = id => FOODIX && FOODIX.get(id);

/* Units a given food can be logged in. The dish's own serving comes first and
   carries its exact measured weight; grams is always available as the escape
   hatch. Nothing here is a guessed weight. */
/** The USDA portion entry that matches a raw food, if any. Longest key wins so
    "sweet potato" beats "potato". */
function nutPortionKey(f){
  if(f.src !== 'IFCT2017') return null;
  const n = f.name.toLowerCase();
  let best = null;
  for(const k of Object.keys(PORTIONS)) if(n.includes(k) && (!best || k.length > best.length)) best = k;
  return best;
}
function nutUnits(f){
  const out = [];
  if(f.serve && f.serve.g > 0){
    let raw = (f.serve.unit||'serving').toLowerCase().trim();
    /* Open Food Facts stores serving_size as free text — "100 g", "2 slices
       (40g)". A unit that is really just a weight would render as "1 100 g",
       so call it what it is. */
    if(/^[0-9.,  ]*(g|gm|gram|grams|ml)$/.test(raw) || !/[a-z]/.test(raw)) raw = 'serving';
    raw = raw.replace(/\s*\([^)]*\)/g,'').trim() || 'serving';
    out.push({ key:'serve', label: NUT_UNIT_ALIAS[raw] || raw, g: f.serve.g, native:true });
  }
  /* Raw fruit and veg have no serving in IFCT at all. Without these you could
     only log "118 g of banana", never "1 banana". */
  const pk = nutPortionKey(f);
  if(pk){
    for(const p of PORTIONS[pk].portions){
      const key = 'p:'+p.label;
      const override = NUT.units[f.id+'|'+p.label];
      out.push({ key, label:p.label, g: override || p.g, ref: override? null : 'USDA', mine: !!override });
    }
  }
  /* Grams goes ahead of the spoons for anything with no serving of its own.
     The first unit is the default, and "1 tbsp of rice" is not a thing anyone
     logs — whereas grams is always at least honest. */
  if(!out.length) out.push({ key:'g', label:'grams', g:1, raw:true });
  out.push({ key:'tbsp', label:'tbsp', g:15 });
  out.push({ key:'tsp',  label:'tsp',  g:5 });
  if(out[0].key !== 'g') out.push({ key:'g', label:'grams', g:1, raw:true });
  return out;
}
/** Correcting a weight replaces the reference figure with a measured one. */
async function nutSetUnitG(){
  const p = NUT.pick, f = nutFood(p.fid);
  const u = nutUnits(f).find(x=>x.key===p.unit); if(!u || u.raw || u.native) return;
  const v = prompt('How many grams is 1 '+u.label+'?' + NL + NL + 'Weigh it once and this becomes your number.', u.g);
  if(v===null) return;
  const g = Number(v);
  if(!Number.isFinite(g) || g <= 0) return toast('That is not a weight.');
  NUT.units[f.id+'|'+u.label] = Math.round(g);
  await S.set('nut:units', NUT.units);
  const s2=document.querySelector('.sheet .inner'); if(s2) s2.innerHTML = nutQtyHTML();
  toast('1 '+u.label+' = '+Math.round(g)+' g for you.');
}

/** Nutrients for a quantity. Uses the source's own per-serving figures when
    logging in the native serving — those are what INDB actually published —
    and scales per-100 g otherwise. */
function nutFor(f, qty, unit){
  const u = nutUnits(f).find(x=>x.key===unit) || nutUnits(f)[0];
  if(u.native && f.serve && f.serve.n) return { g: Math.round(f.serve.g*qty), n: f.serve.n.map(v=> v===null? null : v*qty) };
  const grams = u.raw ? qty : qty*u.g;
  return { g: Math.round(grams), n: f.p100.map(v=> v===null? null : v*grams/100) };
}

/* ------------------------------------------------------------ day storage */
const nutDayKey = d => 'nut:day:'+d;
async function nutLoadDay(d){
  NUT.date = d;
  NUT.day = (await S.get(nutDayKey(d))) || { entries: [] };
  if(!Array.isArray(NUT.day.entries)) NUT.day.entries = [];
  return NUT.day;
}
async function nutSaveDay(){
  if(NUT.day.entries.length) await S.set(nutDayKey(NUT.date), NUT.day);
  else await S.del(nutDayKey(NUT.date));       // don't leave empty days behind
}

async function nutBumpUse(fid, slot){
  const r = NUT.recent.filter(x=>x!==fid); r.unshift(fid);
  NUT.recent = r.slice(0,40);
  const f = NUT.freq[fid] || (NUT.freq[fid] = { n:0, slots:{} });
  f.n++; f.slots[slot] = (f.slots[slot]||0)+1;
  await S.set('nut:recent', NUT.recent);
  await S.set('nut:freq', NUT.freq);
}

/* ------------------------------------------------------------- add / edit */
function nutValidQty(q){
  const n = Number(q);
  if(!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, 9999);
}

async function nutAdd(fid, qty, unit, slot){
  const f = nutFood(fid);
  if(!f) return toast('That food is no longer in the database.');
  const q = nutValidQty(qty);
  if(q===null) return toast('Quantity must be more than zero.');
  const { g, n } = nutFor(f, q, unit);
  if(!Number.isFinite(g) || g <= 0) return toast('That quantity does not work out to a weight.');
  NUT.day.entries.push({ id:uid(), fid, name:f.name, meal:slot, qty:q, unit, g, n, at:Date.now() });
  await nutSaveDay();
  await nutBumpUse(fid, slot);
  closeSheet();
  render();
  toast(f.name.split('(')[0].trim().slice(0,28)+' · '+fmtN(nv(n,'kcal'))+' kcal');
}

async function nutDelete(eid){
  NUT.day.entries = NUT.day.entries.filter(e=>e.id!==eid);
  await nutSaveDay(); render();
}

async function nutSetQty(eid, qty){
  const e = NUT.day.entries.find(x=>x.id===eid); if(!e) return;
  const q = nutValidQty(qty); if(q===null) return toast('Quantity must be more than zero.');
  const f = nutFood(e.fid); if(!f) return toast('That food is no longer in the database.');
  const { g, n } = nutFor(f, q, e.unit);
  Object.assign(e, { qty:q, g, n });
  await nutSaveDay(); closeSheet(); render();
}

/* ================================ search ================================
   Ranked: recently used, then frequently used, then name-prefix, then a word
   boundary, then anywhere. No fuzzy edit distance — on 1,556 rows exact
   substring ranking is faster to reason about and never produces a surprise. */
/* Words neither source uses for a thing everyone else does. Expanded into the
   query, not into the data, so the source rows stay exactly as published. */
const NUT_SYNONYM = {
  chole:'bengal gram', chhole:'bengal gram', chana:'bengal gram', kabuli:'bengal gram',
  moong:'green gram', mung:'green gram', masoor:'lentil', toor:'red gram', arhar:'red gram',
  urad:'black gram', rajma:'rajmah', dahi:'curd', chaas:'buttermilk',
  sabji:'curry', sabzi:'curry', bhaji:'curry', aata:'atta', maida:'wheat flour, refined',
  jeera:'cumin', haldi:'turmeric', dhania:'coriander', mirchi:'chilli', mirch:'chilli',
  bhindi:'okra', baingan:'brinjal', gobhi:'cauliflower', gobi:'cauliflower',
  palak:'spinach', methi:'fenugreek', lauki:'bottle gourd', karela:'bitter gourd',
  aloo:'potato', pyaz:'onion', tamatar:'tomato', adrak:'ginger', lehsun:'garlic',
  nimbu:'lemon', kela:'banana', seb:'apple', angoor:'grape', anar:'pomegranate'
};

/* For the words typed every single day, ranking heuristics are not good enough
   — the answer has to be exactly right. These pin a bare query to one row by
   name; anything not listed still goes through normal ranking.
   Verified by scripts/check-search.mjs. */
const NUT_CANONICAL = {
  /* Cooked, not raw, wherever the thing is eaten cooked. IFCT's "Rice, raw,
     milled" is uncooked grain — logging a meal against it would overstate the
     day by roughly three times, since boiling triples the weight. */
  'rice':     'Boiled rice (Uble chawal)',
  'chawal':   'Boiled rice (Uble chawal)',
  'dal':      'Washed moong dal (Dhuli moong ki dal)',
  'moong dal':'Washed moong dal (Dhuli moong ki dal)',
  'chana dal':'Split bengal gram dal (Channa dal)',
  'tea':      'Hot tea (Garam Chai)',
  'egg':      'Egg, poultry, whole, raw',
  'milk':     'Milk, whole, Cow',
  /* Open Food Facts carries a duplicate "Amul Taaza Milky Milk" row with every
     value halved. It is internally consistent, so the Atwater check cannot
     catch it — pin the correct rows rather than leave it to ranking. */
  'amul milk':'Amul Taaza Homogenised Toned Milk',
  'amul gold':'Amul Gold Milky Milk',
  'taaza':    'Amul Taaza Homogenised Toned Milk',
  'roti':     'Chapati/Roti',
  'chapati':  'Chapati/Roti',
  'atta':     'Wheat flour, atta',
  'curd':     'Curd (Dahi)',
  'dahi':     'Curd (Dahi)',
  'paneer':   'Paneer',
  'ghee':     'Ghee',
  'potato':   'Potato, brown skin, big',
  'aloo':     'Potato, brown skin, big',
  'onion':    'Onion, big',
  'tomato':   'Tomato, ripe, local',
  'banana':   'Banana, ripe, robusta',
  'apple':    'Apple, big',
  'paratha':  'Plain parantha/paratha',
  'parantha': 'Plain parantha/paratha',
  'dosa':     'Plain dosa',
  'sugar':    'Sugar, white',
  'cheeni':   'Sugar, white',
  'salt':     'Salt',
  'namak':    'Salt',
  'oil':      'Sunflower oil',
  'chai':     'Hot tea (Garam Chai)',
  'bread':    'Bread, white',
  'butter':   'Butter, salted',
  'honey':    'Honey'
};

/** Everything a food can be found by: its own name, and the regional names IFCT
    lists ("H. Bajra; Tam. Kambu"), split into individually matchable tokens. */
function nutHeads(f){
  if(f._h) return f._h;
  const base = f.name.split('(')[0].trim().toLowerCase();
  const heads = base.split(/[,/]/).map(x=>x.trim()).filter(Boolean);
  // "A. Moricha guti; H. Ramdana; Tam. Keerai vidai." -> the names themselves
  for(const part of String(f.alt||'').split(';')){
    const t = part.replace(/^[^.]{1,18}\.\s*/,'').replace(/\.$/,'').trim().toLowerCase();
    for(const bit of t.split(',')) if(bit.trim()) heads.push(bit.trim());
  }
  f._b = base;
  f._w = new Set(heads.flatMap(h=>h.split(/\s+/)).filter(Boolean));
  return (f._h = [...new Set(heads)]);
}

function nutSearch(q){
  if(!FOODS) return [];
  q = q.trim().toLowerCase();
  const recent = new Map(NUT.recent.map((id,i)=>[id,i]));
  if(!q){
    return NUT.recent.map(id=>nutFood(id)).filter(Boolean).slice(0,25);
  }
  /* Every word must appear somewhere, in any order: "aloo sabji" has to find
     "Potato curry" even though that exact string occurs nowhere. */
  const words = q.split(/\s+/).filter(Boolean)
    .map(w => [w, NUT_SYNONYM[w]].filter(Boolean));
  const qWords = new Set(words.map(w => w[0]));
  const out = [];
  for(const f of FOODIX.values()){
    const s = f._s || (f._s = (f.name+' '+(f.alt||'')).toLowerCase());
    let missing = false, at = 0;
    for(const forms of words){
      const hit = forms.map(w=>s.indexOf(w)).filter(i=>i>=0);
      if(!hit.length){ missing = true; break; }
      at += Math.min(...hit);
    }
    if(missing) continue;
    at = Math.round(at / words.length);
    // The name without its parenthetical translation — "Boiled rice" out of
    // "Boiled rice (Uble chawal)". This is what a query is really aimed at.
    const heads = nutHeads(f), base = f._b;
    let score = 0;
    if(recent.has(f.id)) score -= 1000 - recent.get(f.id);
    score -= ((NUT.freq[f.id] && NUT.freq[f.id].n) || 0) * 10;
    const qForms = words.length===1 ? words[0] : [q, ...words.map(w=>w[0])];
    if(qForms.some(x=> base===x || heads.includes(x))) score -= 5000;   // "banana" wants Banana
    /* A whole word beats a prefix: "dosa" must find Plain dosa, not Cucumber,
       whose Telugu name "dosakaya" merely starts with the same four letters. */
    else if(qForms.some(x=> f._w.has(x))) score -= 2000;
    else if(qForms.some(x=> heads.some(h=>h.startsWith(x)))) score -= 800;
    else if(s.startsWith(q)) score -= 300;
    else if(/[\s,]/.test(s[at-1]||' ')) score -= 200;
    score += at;
    /* Every extra word beyond the query is a reason to rank lower: "Banana"
       beats "Banana appam" beats "Banana groundnut paste". */
    score += Math.max(0, base.length - q.length) * 1.5;
    if(f.src === 'INDB') score -= 5;           // a cooked dish, all else equal
    /* Prefer the unprepared entry: "paratha" lands on the plain one, not the
       dal-stuffed one. Tested against the tokenised word set rather than a
       regex, so it matches whole words without needing escapes.
       "whole" is withheld when the query asks for dal, or "moong dal" returns
       the whole bean instead of the split one it means. */
    if(f._w.has('raw') || f._w.has('plain') || (f._w.has('whole') && !qWords.has('dal'))) score -= 400;
    if(qWords.has('dal') && f._w.has('dal')) score -= 400;
    // Chicken and cow are what "egg" and "milk" mean unless told otherwise.
    if(f._w.has('poultry') || f._w.has('cow')) score -= 120;
    if(NUT_CANONICAL[q] && f.name === NUT_CANONICAL[q]) score -= 100000;
    if(f.src === 'REF') score -= 40;          // promoted staples (curd, chaas)
    out.push([score, f]);
  }
  out.sort((a,b)=>a[0]-b[0]);
  return out.slice(0,40).map(x=>x[1]);
}

/* ================================== views ================================== */
function viewFood(){
  const d = NUT.date || today();
  const isToday = d === today();
  const entries = NUT.day.entries || [];
  const totals = nutSum(entries);

  if(!FOODS){
    return head('Food','Set up') + `<div class="wrap"><div class="empty" style="text-align:left">
      <div style="font-weight:600;margin-bottom:8px">One-time setup</div>
      <div class="small mute" style="line-height:1.6">The food database is not published with the app —
      IFCT 2017 allows personal use but not electronic reproduction. Load
      <b>foods.json</b> once and it stays on this device.</div>
      <div style="height:14px"></div>
      <button class="btn primary" onclick="nutLoadDBFile()">Load foods.json</button>
      </div></div>`;
  }

  const nav = `<div class="row" style="gap:8px;margin-bottom:12px">
      <button class="btn sm" onclick="nutGo('${shiftDay(d,-1)}')">‹</button>
      <div style="flex:1;text-align:center" class="small mute">${isToday?'Today':new Date(d+'T00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'})}</div>
      <button class="btn sm" onclick="nutGo('${shiftDay(d,1)}')" ${isToday?'disabled style=opacity:.3':''}>›</button>
    </div>`;

  let body = nav;

  body += `<div class="grid2">
    <div class="card stat"><div class="k num" style="font-size:34px">${fmtN(nv(totals,'kcal'))}</div><div class="l">Calories</div></div>
    <div class="card stat"><div class="k num" style="font-size:34px">${fmtN(nv(totals,'protein_g'))}</div><div class="l">Protein g</div></div>
  </div>
  <div class="grid3">
    <div class="card stat"><div class="k num">${fmtN(nv(totals,'carb_g'))}</div><div class="l">Carbs g</div></div>
    <div class="card stat"><div class="k num">${fmtN(nv(totals,'fat_g'))}</div><div class="l">Fat g</div></div>
    <div class="card stat"><div class="k num">${fmtN(nv(totals,'fiber_g'))}</div><div class="l">Fibre g</div></div>
  </div>`;

  const openMin = !!NUT.open.min;
  body += `<div class="card" style="margin-top:2px">
    <button class="between" style="width:100%;text-align:left" onclick="nutToggle('min')">
      <span style="font-weight:600">Minerals</span>
      <span class="dim">${openMin?'▲':'▼'}</span></button>
    ${openMin? `<div class="sep"></div>` + NUT_MINERALS.map(([k,label,unit])=>
      `<div class="between" style="padding:5px 0"><span class="small mute">${label}</span>
       <span class="num">${fmtN(nv(totals,k), k==='zinc_mg'||k==='iron_mg'?1:0)} <span class="tiny dim">${unit}</span></span></div>`).join('') : ''}
  </div>`;

  if(!entries.length){
    body += `<div class="empty" style="margin-top:14px">Nothing logged for this day.
      <div style="height:12px"></div>
      <button class="btn primary" onclick="nutOpenAdd()">Log something</button></div>`;
    body += nutAgain();
  } else {
    for(const slot of NUT_SLOTS){
      const rows = entries.filter(e=>e.meal===slot);
      if(!rows.length) continue;
      const sub = nutSum(rows);
      body += `<div class="between" style="margin:18px 0 6px">
        <h2 style="margin:0">${NUT_SLOT_LABEL[slot]}</h2>
        <span class="small dim num">${fmtN(nv(sub,'kcal'))} kcal · ${fmtN(nv(sub,'protein_g'))} g P</span></div>`;
      body += rows.map(nutRow).join('');
      body += `<button class="btn sm" style="margin-top:6px" onclick="nutOpenAdd('${slot}')">+ Add to ${NUT_SLOT_LABEL[slot].toLowerCase()}</button>`;
    }
    body += `<div style="height:14px"></div>
      <button class="btn" onclick="nutOpenAdd()">+ Add food</button>
      <button class="btn ghost small" style="margin-top:8px" onclick="nutSaveMealPrompt()">Save this day's food as a meal</button>`;
    body += nutAgain();
  }

  body += `<div style="height:24px"></div>`;
  return head('Food', isToday? 'Today' : dLabel(d),
    `<button class="btn sm" onclick="nutOpenAdd()">+ Add</button>`) + `<div class="wrap">${body}</div>`;
}

/* The 2-tap path: what he actually eats at this hour, ready to re-log. */
function nutAgain(){
  const slot = nutSlotForNow();
  const meals = (NUT.meals||[])
    .map(m=>[ (m.uses||0) + (m.slot===slot? 100:0), m ])
    .sort((a,b)=>b[0]-a[0]).slice(0,4).map(x=>x[1]);
  const foods = Object.entries(NUT.freq||{})
    .map(([id,f])=>[ (f.slots&&f.slots[slot]||0)*10 + f.n, id ])
    .sort((a,b)=>b[0]-a[0]).slice(0,6)
    .map(x=>nutFood(x[1])).filter(Boolean);
  if(!meals.length && !foods.length) return '';
  return `<h2>Again · ${NUT_SLOT_LABEL[slot].toLowerCase()}</h2>
    ${meals.map(m=>`<button class="item card" onclick="nutConfirmMeal('${m.id}')"><div class="between">
      <div><div style="font-weight:600">${esc(m.name)}</div>
      <div class="small dim">${m.items.length} item${m.items.length===1?'':'s'} · ${fmtN(nv(nutSum(m.items),'kcal'))} kcal</div></div>
      <span class="pill up">Meal</span></div></button>`).join('')}
    <div style="margin-top:4px">${foods.map(f=>
      `<button class="chip" onclick="nutOpenQty('${f.id}')">${esc(f.name.split('(')[0].trim().slice(0,26))}</button>`).join('')}</div>`;
}

function nutRow(e){
  const kcal = fmtN(nv(e.n,'kcal'));
  const unitLabel = e.unit==='g' ? 'g' : (nutUnits(nutFood(e.fid)||{p100:[]}).find(u=>u.key===e.unit)||{label:e.unit}).label;
  const qty = e.unit==='g' ? e.g+' g' : (Number.isInteger(e.qty)? e.qty : e.qty)+' '+unitLabel+(e.g? ` · ${e.g} g`:'');
  return `<div class="swipe" data-eid="${e.id}">
    <div class="swipe-bg">Delete</div>
    <button class="swipe-fg item card" onclick="nutOpenEdit('${e.id}')"><div class="between">
      <div style="min-width:0"><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name.split('(')[0].trim())}</div>
        <div class="small dim">${esc(qty)}</div></div>
      <div class="num" style="font-size:19px;white-space:nowrap">${kcal} <span class="tiny dim">kcal</span></div>
    </div></button></div>`;
}

function nutToggle(k){ NUT.open[k] = !NUT.open[k]; render(); }
async function nutGo(d){
  if(d > today()) return;
  await nutLoadDay(d); render();
}

/* ------------------------------------------------------------ add / search */
function nutOpenAdd(slot){
  NUT.addSlot = slot || nutSlotForNow();
  NUT.q = '';
  nutSheet(nutAddHTML());
  setTimeout(()=>document.getElementById('nq')?.focus(), 30);
}
function nutAddHTML(){
  const list = nutSearch(NUT.q||'');
  return `<h2 style="margin-top:0">Add food</h2>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">${NUT_SLOTS.map(s=>
      `<button class="chip ${NUT.addSlot===s?'on':''}" onclick="NUT.addSlot='${s}';nutRefreshAdd()">${NUT_SLOT_LABEL[s]}</button>`).join('')}</div>
    <input id="nq" placeholder="Search food — dal, roti, paneer…" value="${esc(NUT.q||'')}" oninput="NUT.q=this.value;nutRefreshList()">
    <div id="nlist" style="margin-top:10px">${nutListHTML(list)}</div>
    <button class="btn ghost" style="margin-top:10px" onclick="closeSheet()">Cancel</button>`;
}
function nutListHTML(list){
  if(!list.length) return `<div class="empty">No match. Try a shorter word.</div>`;
  return list.map(f=>{
    const u = nutUnits(f)[0];
    const per = f.serve && f.serve.n ? `${fmtN(nv(f.serve.n,'kcal'))} kcal / ${u.label}` : `${fmtN(nv(f.p100,'kcal'))} kcal / 100 g`;
    return `<button class="item card" onclick="nutOpenQty('${f.id}')"><div class="between">
      <div style="min-width:0"><div style="font-weight:500">${esc(f.name.slice(0,52))}</div>
        <div class="small dim">${esc(per)}${f.custom?' · my version':''}</div></div>
      ${f.src==='IFCT2017'?'<span class="pill">Raw</span>':''}${f.src==='OFF'?'<span class="pill hold">Label</span>':''}</div></button>`;
  }).join('');
}
function nutRefreshList(){
  const el=document.getElementById('nlist'); if(el) el.innerHTML = nutListHTML(nutSearch(NUT.q||''));
}
function nutRefreshAdd(){
  const s=document.querySelector('.sheet .inner'); if(s){ s.innerHTML = nutAddHTML();
    const i=document.getElementById('nq'); if(i){ i.value=NUT.q||''; } }
}

/* --------------------------------------------------------- quantity picker */
function nutOpenQty(fid, eid){
  const f = nutFood(fid); if(!f) return toast('Food not found.');
  const e = eid ? NUT.day.entries.find(x=>x.id===eid) : null;
  const units = nutUnits(f);
  NUT.pick = { fid, eid, unit: e? e.unit : units[0].key, qty: e? e.qty : 1, slot: e? e.meal : (NUT.addSlot||nutSlotForNow()) };
  nutSheet(nutQtyHTML());
}
function nutOpenEdit(eid){
  const e = NUT.day.entries.find(x=>x.id===eid); if(!e) return;
  nutOpenQty(e.fid, eid);
}
function nutQtyHTML(){
  const p = NUT.pick, f = nutFood(p.fid);
  const units = nutUnits(f);
  const u = units.find(x=>x.key===p.unit) || units[0];
  const preview = nutFor(f, nutValidQty(p.qty)||0, p.unit);
  const step = u.raw ? 10 : 0.5;
  return `<h2 style="margin-top:0">${esc(f.name.slice(0,54))}</h2>
    ${f.src==='OFF'? `<div class="tiny dim" style="margin:-6px 0 10px;line-height:1.5">
      From the pack label via Open Food Facts — transcribed by volunteers, not laboratory-measured.</div>` : ''}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:12px">${units.map(x=>
      `<button class="chip ${p.unit===x.key?'on':''}" onclick="nutPick('unit','${x.key}')">${esc(x.label)}</button>`).join('')}</div>
    <div class="step" style="max-width:220px;margin-bottom:6px">
      <button onclick="nutPick('qty',${-step})">−</button>
      <input inputmode="decimal" value="${p.qty}" onchange="nutPick('qty=',this.value)">
      <button onclick="nutPick('qty',${step})">+</button></div>
    <div class="small dim" style="margin-bottom:14px">
      ${u.raw? 'grams' : esc(u.label)+' · 1 = '+u.g+' g'} → ${preview.g} g
      ${u.ref? ` <span class="tiny" style="color:var(--yellow)">USDA reference weight</span>` : ''}
      ${u.mine? ` <span class="tiny" style="color:var(--green)">your weight</span>` : ''}
      ${(!u.raw && !u.native)? ` · <button class="tiny" style="color:var(--blue);text-decoration:underline" onclick="nutSetUnitG()">correct it</button>` : ''}
    </div>

    <div class="grid3">
      <div class="card stat"><div class="k num">${fmtN(nv(preview.n,'kcal'))}</div><div class="l">kcal</div></div>
      <div class="card stat"><div class="k num">${fmtN(nv(preview.n,'protein_g'),1)}</div><div class="l">Protein g</div></div>
      <div class="card stat"><div class="k num">${fmtN(nv(preview.n,'fat_g'),1)}</div><div class="l">Fat g</div></div>
    </div>
    ${p.eid? '' : `<div class="row" style="gap:6px;flex-wrap:wrap;margin:6px 0 12px">${NUT_SLOTS.map(s=>
      `<button class="chip ${p.slot===s?'on':''}" onclick="nutPick('slot','${s}')">${NUT_SLOT_LABEL[s]}</button>`).join('')}</div>`}
    <button class="btn primary" style="margin-top:8px" onclick="${p.eid? `nutSetQty('${p.eid}',NUT.pick.qty)` : `nutAdd('${p.fid}',NUT.pick.qty,NUT.pick.unit,NUT.pick.slot)`}">
      ${p.eid? 'Save' : 'Add'}</button>
    ${f.ing && f.ing.length ? `<button class="btn" style="margin-top:8px" onclick="nutOpenRecipe('${p.fid}')">Adjust the recipe</button>` : ''}
    ${p.eid? `<button class="btn danger" style="margin-top:8px" onclick="nutDelete('${p.eid}');closeSheet()">Remove</button>`:''}
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet()">Cancel</button>`;
}
function nutPick(what, val){
  const p = NUT.pick;
  if(what==='unit'){
    p.unit = val;
    const u = nutUnits(nutFood(p.fid)).find(x=>x.key===val);
    p.qty = u && u.raw ? 100 : 1;                 // grams start at 100, servings at 1
  }
  else if(what==='slot') p.slot = val;
  else if(what==='qty')  p.qty = Math.max(0.5, Math.round((Number(p.qty)+val)*100)/100);
  else if(what==='qty='){ const q = nutValidQty(val); if(q===null){ toast('Quantity must be more than zero.'); } else p.qty = q; }
  const s=document.querySelector('.sheet .inner'); if(s) s.innerHTML = nutQtyHTML();
}

/* ------------------------------------------------------------ recipe editor
   The dish's published numbers stay the baseline; only the *difference* made by
   changing an ingredient is applied on top. Every error in rebuilding a recipe
   from scratch — frying oil counted whole, serving-count mismatches — appears
   on both sides of that subtraction and cancels. */
function nutOpenRecipe(fid){
  const f = nutFood(fid); if(!f || !f.ing) return;
  NUT.recipe = { fid, base: f, amounts: f.ing.map(i=>i[2]) };
  nutSheet(nutRecipeHTML());
}
function nutRecipeHTML(){
  const r = NUT.recipe, f = r.base;
  const delta = nutRecipeDelta();
  const rows = f.ing.map(([name,code,amt,unit],i)=>{
    const changed = r.amounts[i] !== amt;
    const stepSize = unit==='g'||unit==='ml' ? 5 : 0.5;
    return `<div class="between" style="padding:7px 0;border-bottom:1px solid var(--line)">
      <div style="flex:1;min-width:0"><div class="small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</div>
        <div class="tiny dim">${code? 'was '+amt+' '+(unit||'') : 'no nutrient data — not adjustable'}</div></div>
      ${code? `<div class="step" style="width:130px">
        <button onclick="nutRecipeAdj(${i},${-stepSize})">−</button>
        <input inputmode="decimal" value="${r.amounts[i]}" onchange="nutRecipeSet(${i},this.value)">
        <button onclick="nutRecipeAdj(${i},${stepSize})">+</button></div>`
        : `<span class="tiny dim">${amt} ${esc(unit||'')}</span>`}
      </div>`;
  }).join('');
  const per = f.serve ? `per ${(nutUnits(f)[0]||{}).label}` : 'per 100 g';
  const baseN = f.serve && f.serve.n ? f.serve.n : f.p100;
  const scale = f.serve && f.serve.g ? f.serve.g/ (nutRecipeTotalG()||1) : 100/(nutRecipeTotalG()||1);
  return `<h2 style="margin-top:0">${esc(f.name.slice(0,50))}</h2>
    <div class="small dim" style="margin-bottom:10px">Change what your house actually uses. Oil is usually the difference that matters.</div>
    ${rows}
    <div class="grid3" style="margin-top:14px">
      <div class="card stat"><div class="k num">${fmtN(nv(baseN,'kcal') + delta.kcal*scale)}</div><div class="l">kcal ${esc(per)}</div></div>
      <div class="card stat"><div class="k num">${fmtN(nv(baseN,'fat_g') + delta.fat*scale,1)}</div><div class="l">Fat g</div></div>
      <div class="card stat"><div class="k num" style="color:${delta.kcal?'var(--yellow)':'var(--dim)'}">${delta.kcal>0?'+':''}${fmtN(delta.kcal*scale)}</div><div class="l">Change</div></div>
    </div>
    <button class="btn primary" style="margin-top:12px" onclick="nutRecipeSave()">Save as my version</button>
    <button class="btn ghost" style="margin-top:8px" onclick="nutOpenQty('${r.fid}')">Back</button>`;
}
function nutRecipeTotalG(){
  const r = NUT.recipe;
  return r.base.ing.reduce((a,[,code,amt,unit],i)=> a + (NUT_ING_G[unit]||0)*r.amounts[i], 0);
}
/** Nutrient change caused by the edits, for the whole recipe. */
function nutRecipeDelta(){
  const r = NUT.recipe;
  const out = { kcal:0, fat:0, all: FOODS.nutrients.map(()=>0) };
  r.base.ing.forEach(([name,code,amt,unit],i)=>{
    if(!code) return;
    const ref = FOODS.ingredients[code]; if(!ref) return;
    const gPer = NUT_ING_G[unit]; if(gPer===undefined) return;
    const dG = (r.amounts[i]-amt)*gPer;
    if(!dG) return;
    for(let k=0;k<ref.length;k++) if(ref[k]!==null) out.all[k] += ref[k]*dG/100;
  });
  out.kcal = out.all[NUTIX.kcal]; out.fat = out.all[NUTIX.fat_g];
  return out;
}
function nutRecipeAdj(i,d){
  const r=NUT.recipe; r.amounts[i] = Math.max(0, Math.round((r.amounts[i]+d)*100)/100);
  const s=document.querySelector('.sheet .inner'); if(s) s.innerHTML = nutRecipeHTML();
}
function nutRecipeSet(i,v){
  const n = Number(v);
  if(!Number.isFinite(n) || n < 0) return toast('Amount cannot be negative.');
  NUT.recipe.amounts[i] = n;
  const s=document.querySelector('.sheet .inner'); if(s) s.innerHTML = nutRecipeHTML();
}
async function nutRecipeSave(){
  const r = NUT.recipe, f = r.base, delta = nutRecipeDelta();
  const totG = nutRecipeTotalG() || 1;
  const id = 'MY:'+f.sid;
  const per100 = f.p100.map((v,k)=> v===null? null : v + delta.all[k]*100/totG);
  const serve = f.serve ? { ...f.serve, n: f.serve.n.map((v,k)=> v===null? null : v + delta.all[k]*f.serve.g/totG) } : null;
  const custom = {
    id, name: f.name.replace(/\s*\(.*$/,'') + ' (my version)',
    src:'CUSTOM', sid:f.sid, basedOn:f.id, custom:true,
    p100: per100, serve,
    ing: f.ing.map(([n2,c,,u],i)=>[n2,c,r.amounts[i],u])
  };
  NUT.custom[id] = custom;
  FOODIX.set(id, custom);
  await S.set('nut:custom', NUT.custom);
  toast('Saved as your version.');
  nutOpenQty(id);
}

/* ------------------------------------------------------------ meal templates */
async function nutSaveMealPrompt(){
  const items = NUT.day.entries;
  if(!items.length) return toast('Nothing to save.');
  const slot = items[0].meal;
  const only = items.filter(e=>e.meal===slot);
  const name = prompt('Name this meal', NUT_SLOT_LABEL[slot]+' — '+only.map(e=>e.name.split('(')[0].trim()).slice(0,2).join(', '));
  if(!name) return;
  NUT.meals.push({ id:uid(), name:name.slice(0,60), slot,
    items: only.map(e=>({ fid:e.fid, name:e.name, qty:e.qty, unit:e.unit, g:e.g, n:e.n })), uses:0 });
  await S.set('nut:meals', NUT.meals);
  toast('Meal saved. It will show under "Again".');
  render();
}
function nutConfirmMeal(mid){
  const m = (NUT.meals||[]).find(x=>x.id===mid); if(!m) return;
  const t = nutSum(m.items);
  nutSheet(`<h2 style="margin-top:0">${esc(m.name)}</h2>
    ${m.items.map(i=>`<div class="between" style="padding:5px 0"><span class="small">${esc(i.name.split('(')[0].trim().slice(0,34))}</span>
      <span class="small dim num">${i.qty} · ${fmtN(nv(i.n,'kcal'))} kcal</span></div>`).join('')}
    <div class="sep"></div>
    <div class="grid2"><div class="card stat"><div class="k num">${fmtN(nv(t,'kcal'))}</div><div class="l">kcal</div></div>
    <div class="card stat"><div class="k num">${fmtN(nv(t,'protein_g'),1)}</div><div class="l">Protein g</div></div></div>
    <button class="btn primary" style="margin-top:12px" onclick="nutAddMeal('${mid}')">Add to ${NUT_SLOT_LABEL[nutSlotForNow()].toLowerCase()}</button>
    <button class="btn ghost" style="margin-top:8px" onclick="closeSheet()">Cancel</button>`);
}
async function nutAddMeal(mid){
  const m = (NUT.meals||[]).find(x=>x.id===mid); if(!m) return;
  const slot = nutSlotForNow();
  for(const i of m.items){
    NUT.day.entries.push({ id:uid(), fid:i.fid, name:i.name, meal:slot, qty:i.qty, unit:i.unit, g:i.g, n:i.n, at:Date.now() });
    await nutBumpUse(i.fid, slot);
  }
  m.uses = (m.uses||0)+1;
  await S.set('nut:meals', NUT.meals);
  await nutSaveDay();
  closeSheet(); render();
  toast(m.name.slice(0,28)+' · '+fmtN(nv(nutSum(m.items),'kcal'))+' kcal');
}

/* ----------------------------------------------------------------- sheets */
function nutSheet(inner){
  closeSheet();
  document.body.insertAdjacentHTML('beforeend',
    `<div class="sheet" onclick="if(event.target===this)closeSheet()"><div class="inner">${inner}</div></div>`);
}

/* --------------------------------------------------------- swipe to delete */
document.addEventListener('touchstart', e=>{
  const el = e.target.closest && e.target.closest('.swipe'); if(!el) return;
  NUT.swipe = { el, x:e.touches[0].clientX, y:e.touches[0].clientY, dx:0, lock:null };
}, {passive:true});
document.addEventListener('touchmove', e=>{
  const s = NUT.swipe; if(!s) return;
  const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
  if(s.lock===null) s.lock = Math.abs(dx) > Math.abs(dy)+4 ? 'x' : 'y';
  if(s.lock!=='x') return;
  s.dx = Math.min(0, dx);
  s.el.querySelector('.swipe-fg').style.transform = `translateX(${s.dx}px)`;
}, {passive:true});
document.addEventListener('touchend', ()=>{
  const s = NUT.swipe; if(!s) return; NUT.swipe = null;
  const fg = s.el.querySelector('.swipe-fg');
  if(s.dx < -90){ fg.style.transform='translateX(-100%)'; nutDelete(s.el.dataset.eid); }
  else fg.style.transform='';
}, {passive:true});

/* ================================ registration ============================= */
registerSettingsCard(()=>`
  <h2>Food data</h2>
  <button class="btn" onclick="nutLoadDBFile()">${FOODS? 'Replace' : 'Load'} the food database file</button>
  <div class="tiny dim" style="margin:6px 0 12px">${FOODS? FOODS.foods.length.toLocaleString()+' foods on this device.' : 'Not loaded yet.'}</div>
  <div class="card"><div class="small mute" style="line-height:1.6">
    Cooked dishes from the <b>Indian Nutrient Databank (INDB)</b>, open access.
    Raw ingredients from <b>IFCT 2017</b> — Longvah T et al., <i>Indian Food Composition
    Tables</i>, National Institute of Nutrition, ICMR, Hyderabad.
    <div style="height:8px"></div>
    IFCT 2017 permits personal use with acknowledgment, but forbids electronic
    reproduction for a product without the written permission of the Director, NIN.
    This app is for personal use only and is not distributed.
    <div style="height:8px"></div>
    Packaged and branded products (MuscleBlaze, Pintola, Amul, Maggi) come from
    <b>Open Food Facts</b>, licensed ODbL. Those are pack labels transcribed by
    volunteers, not laboratory measurements, and are marked "Label" in search.
    <div style="height:8px"></div>
    Piece weights for raw fruit and veg (1 medium banana = 118 g) come from
    <b>USDA FoodData Central</b> — geometry only, never nutrition, since Indian
    produce differs in size. Tap "correct it" on any of them to replace the
    reference figure with your own weighed number.
    <div style="height:8px"></div>
    A dash (—) means the source has no value for that nutrient. It is never
    treated as zero.
  </div></div>`);

registerView('food', viewFood);
registerTab({ key:'food', label:'Food', order:15 });

registerData({
  async collect(){
    const days={};
    for(const k of (await IDB.keys())) if(typeof k==='string' && k.startsWith('nut:day:')) days[k.slice(8)] = await S.get(k);
    return { nutrition:{ days, recent:NUT.recent, freq:NUT.freq, meals:NUT.meals, custom:NUT.custom, units:NUT.units } };
  },
  async restore(d){
    const n = d.nutrition;
    if(!n) return '';                        // a v1 backup simply has no food data
    for(const [date,day] of Object.entries(n.days||{})) if(day) await S.set('nut:day:'+date, day);
    NUT.recent = Array.isArray(n.recent)? n.recent : [];
    NUT.freq   = n.freq   || {};
    NUT.meals  = Array.isArray(n.meals)? n.meals : [];
    NUT.custom = n.custom || {};
    NUT.units  = n.units  || {};
    await S.set('nut:units',  NUT.units);
    await S.set('nut:recent', NUT.recent);
    await S.set('nut:freq',   NUT.freq);
    await S.set('nut:meals',  NUT.meals);
    await S.set('nut:custom', NUT.custom);
    await nutLoadDay(today());
    const c = Object.keys(n.days||{}).length;
    return c ? c+' day'+(c===1?'':'s')+' of food' : '';
  }
});

registerBoot(async ()=>{
  NUT.recent = (await S.get('nut:recent')) || [];
  NUT.freq   = (await S.get('nut:freq'))   || {};
  NUT.meals  = (await S.get('nut:meals'))  || [];
  NUT.custom = (await S.get('nut:custom')) || {};
  NUT.units  = (await S.get('nut:units'))  || {};
  await nutLoadDay(today());
  try{ await nutLoadFoods(); }
  catch(e){ console.warn('[overload] food database unavailable:', e.message); }
});
