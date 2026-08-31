/* ============================================================================
   build-food-db.mjs — downloads, normalises and emits the offline food bundle.

   Runs on a laptop, never in the app. Output:
     data/foods.json    the bundle the app ships
     data/units.json    ingredient unit -> gram conversions (for recipe editing)
     data/SOURCES.md    citations and licence terms

   Design rules, in order of importance:
     1. Never invent a number. A value the source does not carry stays null.
        Nulls render as "—" in the app; a zero would silently understate totals.
     2. Never guess a schema. Every column this script reads is asserted to
        exist first, and a missing one is a hard stop with the actual header
        printed, not a silent fallback.
     3. Every row is traceable. src + sid on every food, back to the source row.

     node scripts/build-food-db.mjs
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CACHE = path.join(HERE, '.cache');
const OUT = path.join(ROOT, 'data');

/* The eleven nutrients the app displays. Vitamins are deliberately excluded:
   INDB carries no B12 at all, and its vitamin A is retinol only, which reads as
   zero for virtually every vegetarian dish. Rather than show a column that is
   structurally blank or misleading, the set is macros plus the six minerals
   that both sources actually measure. */
const NUTRIENTS = [
  'kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g',
  'iron_mg', 'calcium_mg', 'zinc_mg', 'magnesium_mg', 'sodium_mg', 'potassium_mg'
];

const SOURCES = {
  INDB: {
    files: {
      'INDB.xlsx': 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/INDB.xlsx',
      'recipes.xlsx': 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/recipes.xlsx',
      'Units.xlsx': 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/Units.xlsx',
      'UK_fct.xlsx': 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/UK_fct.xlsx',
      'US_fct.xlsx': 'https://raw.githubusercontent.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-/main/US_fct.xlsx'
    }
  }
};

/* -------------------------------------------------------------- small helpers */
const log = (...a) => console.log(...a);
const NL = String.fromCharCode(10);
const die = msg => { console.error('\n✗ ' + msg + '\n'); process.exit(1); };

/** A number, or null. Never 0-as-a-stand-in-for-unknown. */
function num(v, dp = 2) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') {
    const t = String(v).trim();
    // '' would coerce to 0; 'Tr' (trace) and 'N'/'NA' (not measured) are not
    // numbers and must not become zeros.
    if (t === '') return null;
    v = Number(t);
  }
  const n = v;
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Hard-stop if the source no longer has the columns this script reads. */
function assertColumns(label, header, required) {
  const have = new Set(header);
  const missing = required.filter(c => !have.has(c));
  if (missing.length) {
    die(`${label}: expected column(s) not found: ${missing.join(', ')}\n` +
        `  The source layout has changed — the transform must be revisited, not guessed.\n` +
        `  Columns actually present (${header.length}): ${header.join(', ')}`);
  }
}

async function fetchCached(name, url) {
  fs.mkdirSync(CACHE, { recursive: true });
  const dest = path.join(CACHE, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`  cached  ${name} (${fs.statSync(dest).size.toLocaleString()} B)`);
    return dest;
  }
  log(`  fetch   ${name} …`);
  const res = await fetch(url);
  if (!res.ok) die(`download failed for ${name}: HTTP ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  log(`          ${fs.statSync(dest).size.toLocaleString()} B`);
  return dest;
}

function readSheet(file, sheetName) {
  const wb = XLSX.readFile(file, { cellDates: false });
  const sn = sheetName || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null, raw: true });
  if (!rows.length) die(`${path.basename(file)} :: ${sn} is empty`);
  return { rows, header: Object.keys(rows[0]), sheet: sn };
}

/* ============================================================ 1. INDB recipes */
async function loadINDB() {
  log('\nINDB — Indian Nutrient Databank');
  const f = await fetchCached('INDB.xlsx', SOURCES.INDB.files['INDB.xlsx']);
  const { rows, header, sheet } = readSheet(f);
  log(`  sheet "${sheet}": ${rows.length} rows × ${header.length} cols`);

  // per-100 g column -> our nutrient key
  const P100 = {
    kcal: 'energy_kcal', protein_g: 'protein_g', carb_g: 'carb_g', fat_g: 'fat_g',
    fiber_g: 'fibre_g', iron_mg: 'iron_mg', calcium_mg: 'calcium_mg', zinc_mg: 'zinc_mg',
    magnesium_mg: 'magnesium_mg', sodium_mg: 'sodium_mg', potassium_mg: 'potassium_mg'
  };
  const need = ['food_code', 'food_name', 'primarysource', 'servings_unit',
    ...Object.values(P100), ...Object.values(P100).map(c => 'unit_serving_' + c)];
  assertColumns('INDB.xlsx', header, need);

  const foods = [];
  let noServing = 0;
  for (const r of rows) {
    if (!r.food_code || !r.food_name) continue;

    const p100 = NUTRIENTS.map(k => num(r[P100[k]], k === 'kcal' ? 1 : 2));
    const ps = NUTRIENTS.map(k => num(r['unit_serving_' + P100[k]], k === 'kcal' ? 1 : 2));

    /* INDB gives per-serving nutrients but never the serving's mass. Because the
       per-serving figures are the per-100 g figures scaled, the mass falls out of
       the ratio exactly. Derived, not assumed — and null when either side is
       missing rather than defaulted to 100 g. */
    let serve = null;
    const kc100 = p100[0], kcServe = ps[0];
    if (kc100 && kcServe && kc100 > 0) {
      serve = {
        g: Math.round(kcServe / kc100 * 100),
        unit: (r.servings_unit || '').trim() || null,
        n: ps
      };
    } else {
      noServing++;
    }

    foods.push({
      id: 'INDB:' + r.food_code,
      name: String(r.food_name).trim(),
      src: 'INDB',
      sid: String(r.food_code).trim(),
      origin: (r.primarysource || '').trim() || null,
      p100,
      serve
    });
  }
  log(`  → ${foods.length} dishes  (${noServing} without per-serving values — grams only)`);
  return foods;
}

/* ==================================================== 2. INDB recipe ingredients */
async function loadIngredients(byId) {
  log('\nINDB — recipe ingredient lines');
  const f = await fetchCached('recipes.xlsx', SOURCES.INDB.files['recipes.xlsx']);
  const { rows, header } = readSheet(f);
  assertColumns('recipes.xlsx', header,
    ['recipe_code', 'ingredient_name_org', 'food_code', 'food_name', 'amount', 'unit']);

  let attached = 0, orphanRecipe = 0, noCode = 0;
  for (const r of rows) {
    const food = byId.get('INDB:' + r.recipe_code);
    if (!food) { orphanRecipe++; continue; }
    const amount = num(r.amount, 3);
    if (amount === null) continue;
    if (!r.food_code) noCode++;
    (food.ing || (food.ing = [])).push([
      String(r.ingredient_name_org || r.food_name || '').trim(),
      r.food_code ? String(r.food_code).trim() : null,   // IFCT code, when mapped
      amount,
      String(r.unit || '').trim() || null
    ]);
    attached++;
  }
  const withIng = [...byId.values()].filter(f => f.ing && f.ing.length).length;
  log(`  → ${attached} ingredient lines across ${withIng} dishes`);
  log(`     ${noCode} lines have no IFCT code (not re-costable), ${orphanRecipe} reference an unknown recipe`);
  return { attached, withIng, noCode };
}

/* ================================================== 3. IFCT 2017 raw ingredients */
function loadIFCT() {
  log('\nIFCT 2017 — raw ingredients');
  const csvPath = require.resolve('@ifct2017/compositions/index.csv');
  const text = fs.readFileSync(csvPath, 'utf8');

  // Minimal RFC4180 parse — the file has quoted fields containing commas.
  const table = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); table.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); table.push(row); }

  const rawHeader = table[0];
  // Headers look like "Calcium (Ca); ca" — the short code after the semicolon.
  const header = rawHeader.map(h => h.split(';').pop().trim());
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));

  /* Unit traps, both verified against known values before trusting them:
       enerc is kJ (amaranth 1490 kJ = 356 kcal)
       minerals are g/100 g (amaranth ca 0.181 g = 181 mg)  */
  const MAP = {
    kcal:         ['enerc',    v => v / 4.184],
    protein_g:    ['protcnt',  v => v],
    carb_g:       ['choavldf', v => v],
    fat_g:        ['fatce',    v => v],
    fiber_g:      ['fibtg',    v => v],
    iron_mg:      ['fe',       v => v * 1000],
    calcium_mg:   ['ca',       v => v * 1000],
    zinc_mg:      ['zn',       v => v * 1000],
    magnesium_mg: ['mg',       v => v * 1000],
    sodium_mg:    ['na',       v => v * 1000],
    potassium_mg: ['k',        v => v * 1000]
  };
  assertColumns('IFCT index.csv', header,
    ['code', 'name', 'lang', 'grup', ...Object.values(MAP).map(m => m[0])]);

  const foods = [];
  for (const r of table.slice(1)) {
    if (!r[ix.code] || !r[ix.name]) continue;
    const p100 = NUTRIENTS.map(k => {
      const [col, conv] = MAP[k];
      const raw = num(r[ix[col]], 6);
      return raw === null ? null : num(conv(raw), k === 'kcal' ? 1 : 2);
    });
    foods.push({
      id: 'IFCT:' + r[ix.code].trim(),
      name: r[ix.name].trim(),
      // Regional names — the reason "jau" or "sajje" finds barley and bajra.
      alt: (r[ix.lang] || '').trim() || null,
      group: (r[ix.grup] || '').trim() || null,
      src: 'IFCT2017',
      sid: r[ix.code].trim(),
      p100,
      serve: null           // IFCT is per 100 g only; it carries no serving sizes.
    });
  }
  log(`  → ${foods.length} raw ingredients (per 100 g only)`);
  return foods;
}

/* ============================== 3b. ingredient nutrient table (for re-costing)

   INDB's recipes reference ingredients by code, and roughly half of those codes
   are a 500-series that IFCT 2017 does not contain — INDB extended IFCT with
   entries drawn from the UK and USDA tables, shipped alongside it in the same
   repository. Without them, half of every recipe is invisible and an edited
   recipe would silently under-count.

   These are NOT added to the searchable food list: they are reference rows for
   rebuilding a recipe, not dishes worth logging. */
async function loadIngredientTable(ifctFoods) {
  log(NL + 'Ingredient nutrient table');
  const table = {}, names = {};
  for (const f of ifctFoods) table[f.sid] = f.p100;   // IFCT first; it is the primary
  let added = 0;

  const COLS = {
    kcal: 'energy_kcal', protein_g: 'protein_g', carb_g: 'carb_g', fat_g: 'fat_g',
    fiber_g: 'fibre_g', iron_mg: 'iron_mg', calcium_mg: 'calcium_mg', zinc_mg: 'zinc_mg',
    magnesium_mg: 'magnesium_mg', sodium_mg: 'sodium_mg', potassium_mg: 'potassium_mg'
  };

  for (const name of ['UK_fct.xlsx', 'US_fct.xlsx']) {
    const f = await fetchCached(name, SOURCES.INDB.files[name]);
    const { rows, header } = readSheet(f, 'Sheet1');
    assertColumns(name, header, ['food_code', 'food_name', ...Object.values(COLS)]);
    let n = 0;
    for (const r of rows) {
      const code = r.food_code && String(r.food_code).trim();
      if (!code || table[code]) continue;          // never overwrite an IFCT row
      table[code] = NUTRIENTS.map(k => num(r[COLS[k]], k === 'kcal' ? 1 : 2));
      names[code] = String(r.food_name || '').trim();
      n++; added++;
    }
    log(`  ${name.padEnd(13)} +${n} ingredient rows`);
  }
  log(`  → ${Object.keys(table).length} codes total (${added} beyond IFCT)`);
  return { table, names };
}

/* =========================== 3c. promoted staples ===========================
   IFCT 2017 has exactly four dairy rows and no curd at all — which is absurd for
   a log of Indian home food, where dahi is daily. These staples exist in the
   UK/USDA tables INDB already ships, so they are promoted into the searchable
   food list under the name they are actually called, rather than left as
   invisible recipe references. Explicit allowlist only: nothing is bulk-imported.
   [ code, name shown, search aliases ] */
const PROMOTE = [
  ['L520', 'Curd (Dahi)',            'curd dahi yoghurt yogurt'],
  ['L521', 'Buttermilk (Chaas)',     'chaas mattha buttermilk'],
  ['L502', 'Cottage cheese, plain',  'cottage cheese'],
  ['L500', 'Cheese, cheddar',        'cheese'],
  ['L519', 'Cream, fresh, single',   'cream malai'],
  ['I502', 'Sugar, white',           'sugar cheeni chini'],
  ['I503', 'Sugar, brown',           'brown sugar'],
  ['I507', 'Honey',                  'honey shahad'],
  ['T500', 'Butter, salted',         'butter makhan'],
  ['U511', 'Bread, white',           'bread pav'],
  ['U501', 'Bread, brown',           'brown bread'],
  ['G528', 'Salt',                   'salt namak'],
  ['V510', 'Tea, black, infusion',   'tea chai'],
  ['V502', 'Coffee, powder, instant','coffee']
];

function promoteStaples(table, names){
  const out = [];
  for(const [code, name, alias] of PROMOTE){
    const p100 = table[code];
    if(!p100){ log(`  ! promote: ${code} (${name}) not in the ingredient table — skipped`); continue; }
    out.push({
      id:'REF:'+code, name, alt:alias, group:'Staples',
      src:'REF', sid:code, srcName: names[code] || null,
      p100, serve:null
    });
  }
  log(`  → ${out.length} staples promoted into the food list`);
  return out;
}

/* ================================================= 4. ingredient unit conversions */
async function loadUnits() {
  log('\nINDB — ingredient unit conversions');
  const f = await fetchCached('Units.xlsx', SOURCES.INDB.files['Units.xlsx']);
  const wb = XLSX.readFile(f);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });

  /* The sheet uses merged cells: a blank food name means "same as the row
     above". Forward-fill, or every conversion below the first row of a block
     is orphaned. */
  const out = {};
  let currentFood = null, n = 0;
  for (const r of rows.slice(1)) {
    if (!r) continue;
    const [food, unit, value] = [r[0], r[1], r[2]];
    if (food && String(food).trim()) currentFood = String(food).trim();
    if (!unit || !value) continue;
    const key = currentFood || '*';
    (out[key] || (out[key] = {}))[String(unit).trim()] = String(value).trim();
    n++;
  }
  log(`  → ${n} conversions across ${Object.keys(out).length} ingredients`);
  return out;
}

/* ============================================================ 5. emit + report */
function gzipSize(buf) { return zlib.gzipSync(buf, { level: 9 }).length; }
const kb = n => (n / 1024).toFixed(0) + ' KB';
const mb = n => (n / 1048576).toFixed(2) + ' MB';

async function main() {
  log('Building the offline food bundle.');
  log('Nutrients kept: ' + NUTRIENTS.join(', '));

  const indb = await loadINDB();
  const byId = new Map(indb.map(f => [f.id, f]));
  const ingStats = await loadIngredients(byId);
  const ifct = loadIFCT();
  const { table: ingredients, names: ingNames } = await loadIngredientTable(ifct);
  const promoted = promoteStaples(ingredients, ingNames);
  const units = await loadUnits();

  /* Branded packaged products, if scripts/build-branded.mjs has been run.
     Kept a separate build step because it depends on a live web service, so a
     rebuild of the core bundle never blocks on Open Food Facts being up. */
  let branded = [];
  const brandedPath = path.join(OUT, 'branded.json');
  if(fs.existsSync(brandedPath)){
    branded = JSON.parse(fs.readFileSync(brandedPath,'utf8'));
    log(NL + `Branded products` + NL + `  → ${branded.length} from data/branded.json (Open Food Facts)`);
  } else {
    log(NL + 'Branded products' + NL + '  → none; run `node scripts/build-branded.mjs` to add them');
  }

  const foods = [...indb, ...ifct, ...promoted, ...branded];

  const bundle = {
    v: 1,
    built: new Date().toISOString().slice(0, 10),
    /* Nutrient values are positional arrays against this key list — it roughly
       halves the bundle versus repeating eleven property names 1,556 times.
       null means the source has no value; it must render as "—", never 0. */
    nutrients: NUTRIENTS,
    counts: { total: foods.length, indb: indb.length, ifct: ifct.length,
              promoted: promoted.length, branded: branded.length },
    foods,
    /* code -> per-100 g values, for rebuilding a recipe after an ingredient is
       edited. Reference data, not searchable foods. */
    ingredients,
    /* Piece weights, folded in so the whole database is a single file the app
       can be handed once. */
    portions: fs.existsSync(path.join(OUT,'portions.json'))
      ? JSON.parse(fs.readFileSync(path.join(OUT,'portions.json'),'utf8')) : {}
  };

  fs.mkdirSync(OUT, { recursive: true });
  const json = JSON.stringify(bundle);
  fs.writeFileSync(path.join(OUT, 'foods.json'), json);
  fs.writeFileSync(path.join(OUT, 'units.json'), JSON.stringify(units, null, 1));

  const raw = Buffer.byteLength(json), gz = gzipSize(json);
  log('\n' + '─'.repeat(64));
  log(`data/foods.json   ${mb(raw)} raw   ${kb(gz)} gzipped   ${foods.length} foods`);
  log(`data/units.json   ${kb(fs.statSync(path.join(OUT, 'units.json')).size)}`);
  if (raw > 3 * 1048576) {
    log(`\n!  Over the 3 MB budget — split into foods-core.json + a lazy remainder`);
    log(`   rather than dropping nutrients.`);
  } else {
    log(`   Within the 3 MB budget; no split needed.`);
  }

  writeSources({ indb: indb.length, ifct: ifct.length, ing: ingStats });
  log(`data/SOURCES.md   written`);
  log('─'.repeat(64));

  // Sanity: the dishes the brief says to grep for.
  log('\nSpot check:');
  for (const q of ['khichdi', 'aloo', 'dal', 'roti', 'paneer']) {
    const hit = foods.find(f => f.name.toLowerCase().includes(q));
    if (!hit) { log(`  ${q.padEnd(8)} NOT FOUND`); continue; }
    const s = hit.serve;
    log(`  ${q.padEnd(8)} ${hit.name.slice(0, 42).padEnd(44)} ` +
        (s ? `${String(s.n[0]).padStart(6)} kcal / ${s.g} g ${s.unit}`
           : `${String(hit.p100[0]).padStart(6)} kcal / 100 g`));
  }
}

function writeSources({ indb, ifct, ing }) {
  fs.writeFileSync(path.join(OUT, 'SOURCES.md'), `# Food data — sources and terms

Generated by \`scripts/build-food-db.mjs\` on ${new Date().toISOString().slice(0, 10)}.
Every row in \`foods.json\` carries \`src\` and \`sid\`, so any number can be traced
back to the row it came from.

## 1. INDB — Indian Nutrient Databank (${indb} cooked dishes)

Jaacks LM et al., *Indian Nutrient Databank (INDB)*. Open access.
Code and input files: <https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB->
Project page: <https://www.anuvaad.org.in/indian-nutrient-databank/>

The only source here covering cooked composite dishes — sabji, dal, khichdi,
parantha. Values are given per 100 g and per serving; the serving's mass in
grams is *not* in the source and is derived here from the ratio of the two
energy figures. ${ing.attached.toLocaleString()} ingredient lines across
${ing.withIng} dishes are carried through so recipes can be re-costed to how a
particular household actually cooks them.

## 2. IFCT 2017 — Indian Food Composition Tables (${ifct} raw ingredients)

Longvah T, Ananthan R, Bhaskarachary K, Venkaiah K. *Indian Food Composition
Tables*. National Institute of Nutrition (NIN), Indian Council of Medical
Research, Hyderabad, 2017.

Accessed in machine-readable form via the \`@ifct2017/compositions\` package
(<https://www.npmjs.com/package/@ifct2017/compositions>), an MIT-licensed
transcription. The underlying data is NIN's.

Two unit conversions are applied: energy from kJ to kcal (÷ 4.184), and minerals
from g to mg (× 1000).

> **IFCT 2017 permits personal use with acknowledgment, but forbids electronic
> reproduction for a product without the written permission of the Director,
> National Institute of Nutrition.**
>
> This application is for personal use only and must not be distributed.

## 3. Supplementary ingredient references (198 rows, not searchable)

About half of INDB's recipe ingredient lines reference a 500-series code that
IFCT 2017 does not contain; INDB extended IFCT using the UK and USDA tables,
shipped alongside it in the same repository as \`UK_fct.xlsx\` and \`US_fct.xlsx\`.

- Finglas PM et al., *McCance and Widdowson's The Composition of Foods*, 7th
  summary edition. Royal Society of Chemistry / Public Health England.
- U.S. Department of Agriculture, Agricultural Research Service. *FoodData
  Central.* <https://fdc.nal.usda.gov>

These rows exist only so a recipe can be rebuilt when one of its ingredients is
edited. They are **not** added to the searchable food list — this app logs Indian
dishes and raw Indian ingredients, not USDA product entries.

## 4. Open Food Facts — packaged and branded products

Open Food Facts contributors. *Open Food Facts database.* <https://world.openfoodfacts.org>
Product data licensed under the Open Database License (ODbL).

Covers what no food composition table does: MuscleBlaze, Pintola, Amul, Maggi,
Quaker, and the rest of the packet shelf.

> Unlike IFCT and INDB, these are **not laboratory measurements**. They are pack
> labels transcribed by volunteers, and some are wrong or out of date.

Two filters are applied before a row is accepted: an Atwater cross-check
(macros must be able to produce the stated energy, within ±35%) and a rejection
of any macro above 100 g per 100 g. Rows that fail are dropped and listed by the
build. Branded rows are tagged in the app so they read as a different class of
number from the measured ones.

## Nutrients retained

\`${NUTRIENTS.join('`, `')}\`

Vitamins are deliberately excluded. INDB carries no vitamin B12 at all, and
neither does IFCT 2017; INDB's vitamin A is retinol only, which is legitimately
near-zero in almost every vegetarian dish, and would read as missing data rather
than as the measurement it is.

## Missing values

A nutrient the source does not carry is \`null\`, and must render as "—". It is
never imputed and never zero-filled, because a zero would silently pull weekly
totals down.

One caveat that cannot be fixed downstream: **INDB itself contains no nulls.**
Where a value was not measured it has already been written as 0 at source, and
that is indistinguishable from a true zero. Nulls in this bundle therefore come
from genuinely absent columns and from rows lacking per-serving data, not from
INDB's own gaps.
`);
}

main().catch(e => die(e.stack || String(e)));
