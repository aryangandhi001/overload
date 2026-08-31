/* ============================================================================
   build-portions.mjs — piece weights for raw fruit and veg.

   The problem this solves: IFCT 2017 measures nutrients per 100 g and carries
   no serving sizes at all. Without this every fruit and vegetable can only be
   logged in grams — "1 banana" is impossible, which kills daily use.

   Where the numbers come from: USDA FoodData Central (SR Legacy) food_portions,
   used ONLY for the geometry of a piece — how many grams is one medium banana.
   Never for nutrition. All nutrition still comes from IFCT, measured on Indian
   produce.

   The caveat, carried into the UI: an Indian robusta banana is not a US banana
   and an Indian mango is definitely not a US mango. These are reference weights,
   labelled as such, and editable — the moment one is adjusted in the app it
   becomes a measured number and USDA is out of it.

   Reads the bulk CSV rather than the API: no key, no rate limit, complete data.

     node scripts/build-portions.mjs
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unzipSync, strFromU8 } = require('fflate');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache');
const OUT = path.join(HERE, '..', 'data');
const ZIP_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';

/* Hand-written, deliberately. Fuzzy-matching IFCT names to USDA ones would
   silently pair the wrong foods, and the entire point is that these are right.
   [ key matched against IFCT food names, exact USDA SR Legacy description ] */
const WANTED = [
  ['banana',       'Bananas, raw'],
  ['apple',        'Apples, raw, golden delicious, with skin'],
  ['mango',        'Mangos, raw'],
  ['papaya',       'Papayas, raw'],
  ['guava',        'Guavas, common, raw'],
  ['orange',       'Oranges, raw, all commercial varieties'],
  ['grape',        'Grapes, red or green (European type, such as Thompson seedless), raw'],
  ['pomegranate',  'Pomegranates, raw'],
  ['watermelon',   'Watermelon, raw'],
  ['pineapple',    'Pineapple, raw, all varieties'],
  ['pear',         'Pears, raw'],
  ['sapota',       'Sapodilla, raw'],
  ['litchi',       'Litchis, raw'],
  ['jackfruit',    'Jackfruit, raw'],
  ['dates',        'Dates, medjool'],
  ['fig',          'Figs, raw'],
  ['plum',         'Plums, raw'],
  ['peach',        'Peaches, yellow, raw'],
  ['muskmelon',    'Melons, cantaloupe, raw'],
  ['potato',       'Potatoes, flesh and skin, raw'],
  ['onion',        'Onions, raw'],
  ['tomato',       'Tomatoes, red, ripe, raw, year round average'],
  ['brinjal',      'Eggplant, raw'],
  ['ladies finger','Okra, raw'],
  ['cauliflower',  'Cauliflower, raw'],
  ['cabbage',      'Cabbage, raw'],
  ['carrot',       'Carrots, raw'],
  ['cucumber',     'Cucumber, with peel, raw'],
  ['radish',       'Radishes, raw'],
  ['beetroot',     'Beets, raw'],
  ['capsicum',     'Peppers, sweet, green, raw'],
  ['bottle gourd', 'Gourd, white-flowered (calabash), raw'],
  ['bitter gourd', 'Balsam-pear (bitter gourd), pods, raw'],
  ['pumpkin',      'Pumpkin, raw'],
  ['sweet potato', 'Sweet potato, raw, unprepared'],
  ['garlic',       'Garlic, raw'],
  ['ginger',       'Ginger root, raw'],
  ['lemon',        'Lemons, raw, without peel'],
  ['mushroom',     'Mushrooms, white, raw'],
  ['drumstick',    'Drumstick pods, raw'],
  ['spinach',      'Spinach, raw'],
  ['green peas',   'Peas, green, raw'],
  ['egg',          'Egg, whole, raw, fresh']
];

/* A "medium" or a "cup, chopped" is something a person eats by. An
   "NLEA serving" is a food-labelling artefact. */
const KEEP = /^(small|medium|large|extra large|extra small|cup|fruit|piece|slice|clove|tbsp|tsp|date|potato|sweetpotato|onion|tomato|banana|egg)/i;
const DROP = /NLEA|package|container|yields|without refuse|, seeded/i;

/* ------------------------------------------------------------ csv + zip io */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function getZip() {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, 'sr_legacy.zip');
  if (!fs.existsSync(f)) {
    console.log('  downloading USDA SR Legacy bulk CSV …');
    const res = await fetch(ZIP_URL);
    if (!res.ok) throw new Error('download failed: HTTP ' + res.status);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  console.log(`  ${(fs.statSync(f).size / 1048576).toFixed(1)} MB archive`);
  return unzipSync(new Uint8Array(fs.readFileSync(f)));
}

/* --------------------------------------------------------------------- run */
const zip = await getZip();
const pick = name => {
  const k = Object.keys(zip).find(x => x.endsWith('/' + name));
  if (!k) throw new Error('not in archive: ' + name);
  return parseCSV(strFromU8(zip[k]));
};

const foods = pick('food.csv');
const portions = pick('food_portion.csv');
const units = Object.fromEntries(pick('measure_unit.csv').map(u => [u.id, u.name]));
console.log(`  ${foods.length} foods, ${portions.length} portions\n`);

const byId = new Map();
for (const p of portions) (byId.get(p.fdc_id) || byId.set(p.fdc_id, []).get(p.fdc_id)).push(p);

/* Many USDA descriptions carry a trailing parenthetical ("… (Includes foods
   for USDA's Food Distribution Program)"). Match on the prefix so those still
   resolve, but keep it anchored so it can never pair the wrong food. */
const findFood = desc => byDesc.get(desc) || foods.find(f => f.description.startsWith(desc));
const byDesc = new Map(foods.map(f => [f.description, f]));

const table = {};
let hits = 0, misses = [];
for (const [key, desc] of WANTED) {
  const f = findFood(desc);
  if (!f) { misses.push(`${key} (no USDA row "${desc}")`); continue; }
  const list = [];
  const seen = new Set();
  for (const p of (byId.get(f.fdc_id) || [])) {
    const unit = units[p.measure_unit_id];
    let label = [p.modifier || '', (unit && unit !== 'undetermined') ? unit : ''].join(' ').trim();
    if (!label) label = p.portion_description || '';
    label = label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const g = Math.round(Number(p.gram_weight));
    if (!label || !g || DROP.test(label) || !KEEP.test(label)) continue;
    const amount = Number(p.amount) || 1;
    const perOne = Math.round(g / amount);
    if (seen.has(label) || !perOne) continue;
    seen.add(label);
    list.push({ label, g: perOne });
  }
  if (!list.length) { misses.push(`${key} (no usable portions)`); continue; }
  // Prefer a plain "medium" first — it is the one anyone means by "one".
  list.sort((a, b) => (/^medium/i.test(b.label) ? 1 : 0) - (/^medium/i.test(a.label) ? 1 : 0));
  table[key] = { usda: f.description, fdcId: f.fdc_id, portions: list.slice(0, 4) };
  hits++;
  console.log(`  ${key.padEnd(14)} ${list.slice(0, 4).map(p => p.label + ' ' + p.g + 'g').join(' · ')}`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'portions.json'), JSON.stringify(table, null, 1));
console.log(`\ndata/portions.json  ${hits}/${WANTED.length} foods  ${fs.statSync(path.join(OUT, 'portions.json')).size} B`);
if (misses.length) { console.log('\nnot matched:'); misses.forEach(m => console.log('  - ' + m)); }
