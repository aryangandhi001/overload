/* ============================================================================
   build-branded.mjs — packaged and branded products.

   Neither INDB nor IFCT covers a jar of Pintola or a MuscleBlaze tub, and
   typing numbers off a packet by hand is exactly the invented data this project
   refuses. Open Food Facts is the open, citable database for packaged food
   (ODbL), it has good Indian brand coverage, and it needs no key.

   The honest caveat, carried into the UI: Open Food Facts is crowd-sourced.
   Entries are transcribed from packs by volunteers and are occasionally wrong
   or out of date, unlike IFCT and INDB which are laboratory-measured. Branded
   rows are tagged so they are visibly a different class of number, and any of
   them can be corrected in the app.

   Responses are cached per query, so a re-run after a rate-limit resumes.

     node scripts/build-branded.mjs
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'off');
const OUT = path.join(HERE, '..', 'data');
const UA = 'Overload/1.0 (personal food log; contact via github.com/aryangandhi001)';

/* [ query, how many to keep, an optional name filter ]
   Curated rather than bulk-imported: a search for "protein" would drag in
   thousands of products from everywhere. */
const QUERIES = [
  ['muscleblaze whey protein', 3, /protein/i],
  ['muscleblaze oats', 2, null],
  ['pintola peanut butter', 3, /peanut/i],
  ['peanut butter india', 3, /peanut/i],
  ['amul cheese', 3, /cheese/i],
  ['amul cheese slice', 2, /cheese/i],
  ['amul milk', 3, /milk/i],
  ['amul butter', 2, /butter/i],
  ['amul paneer', 2, /paneer/i],
  ['amul curd dahi', 2, null],
  ['maggi noodles', 3, /noodle|maggi/i],
  ['maggi masala', 2, /maggi/i],
  ['britannia brown bread', 2, /bread/i],
  ['harvest brown bread', 2, /bread/i],
  ['quaker oats', 3, /oat/i],
  ['saffola oats', 2, /oat/i],
  ['kelloggs corn flakes', 2, null],
  ['burger king whopper', 2, /burger|whopper/i],
  ['mcdonalds burger', 3, /burger|mc/i],
  ['dominos pizza', 3, /pizza/i],
  ['pasta penne', 2, /pasta|penne/i],
  ['almonds badam', 2, /almond/i],
  ['cashew kaju', 2, /cashew/i],
  ['walnut akhrot', 2, /walnut/i],
  ['dates khajoor', 2, /date/i],
  ['greek yogurt india', 2, /yog|curd/i],
  ['protein bar india', 2, /bar/i],
  ['soya chunks nutrela', 2, /soya|chunk/i],
  ['pintola chocolate peanut butter', 3, /pintola|choco/i],
  ['pintola oats', 2, /oat|pintola/i],
  ['chocolate protein oats', 3, /oat/i],
  ['muscleblaze chocolate', 2, /muscleblaze/i],
  ['soya chunks', 3, /soya|chunk/i],
  ['tofu india', 2, /tofu/i],
  ['paneer tofu protein', 2, /paneer|tofu/i],
  ['whey protein isolate india', 2, /whey|isolate/i],
  ['dry fruits mixed', 2, /nut|dry|mix/i],
  ['raisins kishmish', 2, /raisin|kishmish/i],
  ['amul gold milk', 3, /amul|gold|milk/i],
  ['amul taaza toned milk', 2, /amul|milk/i],
  ['full cream milk india', 3, /milk/i],
  ['mother dairy milk', 2, /milk|dairy/i],
  ['amul ghee', 2, /amul|ghee/i],
  ['amul lassi', 2, /amul|lassi/i],
  ['amul ice cream', 2, /amul/i],
  ['amul shrikhand', 2, /amul|shrikhand/i],
  ['amul cheese spread', 2, /amul|cheese/i],
  ['amul masti buttermilk', 2, /amul|butter/i],
  ['amul protein', 2, /amul/i]
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(q) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, q.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));

  const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' +
    encodeURIComponent(q) + '&search_simple=1&action=process&json=1&page_size=12' +
    '&fields=code,product_name,brands,quantity,serving_size,serving_quantity,nutriments,countries_tags';

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const text = await res.text();
      if (!text.startsWith('{')) throw new Error('HTTP ' + res.status + ' (not JSON)');
      const j = JSON.parse(text);
      fs.writeFileSync(f, JSON.stringify(j));
      await sleep(1500);                      // OFF asks for gentle usage
      return j;
    } catch (e) {
      if (attempt === 4) { console.log(`  ${q.padEnd(28)} failed: ${e.message}`); return null; }
      await sleep(2500 * attempt);
    }
  }
}

/* Open Food Facts keys -> ours. Anything absent stays null: a product whose
   contributor never filled in iron must not report 0 mg of iron. */
const MAP = {
  kcal: 'energy-kcal_100g', protein_g: 'proteins_100g', carb_g: 'carbohydrates_100g',
  fat_g: 'fat_100g', fiber_g: 'fiber_100g', iron_mg: 'iron_100g', calcium_mg: 'calcium_100g',
  zinc_mg: 'zinc_100g', magnesium_mg: 'magnesium_100g', sodium_mg: 'sodium_100g',
  potassium_mg: 'potassium_100g'
};
// OFF reports these minerals in grams per 100 g.
const TO_MG = new Set(['iron_mg', 'calcium_mg', 'zinc_mg', 'magnesium_mg', 'sodium_mg', 'potassium_mg']);
const NUTRIENTS = Object.keys(MAP);

const num = (v, dp = 2) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const label0 = (name, brand) => (brand && !name.toLowerCase().includes(brand.toLowerCase()))
  ? brand + ' ' + name : name;

const out = [];
const rejected = [];
const seen = new Set();
for (const [q, keep, filter] of QUERIES) {
  const j = await search(q);
  if (!j || !j.products) continue;
  let kept = 0;
  for (const p of j.products) {
    if (kept >= keep) break;
    const name = (p.product_name || '').trim();
    const brand = (p.brands || '').split(',')[0].trim();
    if (!name || !p.code || seen.has(p.code)) continue;
    if (filter && !filter.test(name + ' ' + brand)) continue;

    const n = p.nutriments || {};
    const p100 = NUTRIENTS.map(k => {
      let v = num(n[MAP[k]], 4);
      if (v !== null && TO_MG.has(k)) v = num(v * 1000, 2);
      return v;
    });
    // Energy and protein are the minimum for a row to be worth having.
    if (p100[0] === null || p100[1] === null) continue;
    if (p100[0] > 950) continue;                   // impossible: above pure fat

    /* Atwater cross-check. Crowd-sourced rows contain real transcription
       errors — a peanut butter listed at 7 g protein, a mislabelled decimal.
       If the macros cannot produce the stated energy the row is not
       trustworthy, so it is dropped rather than shown as fact. */
    const [kcal, prot, carb, fat] = p100;
    if (carb !== null && fat !== null) {
      const implied = prot * 4 + carb * 4 + fat * 9;
      if (implied > 0 && (implied / kcal > 1.35 || implied / kcal < 0.65)) {
        rejected.push(`${label0(name, brand)} — macros imply ${Math.round(implied)} kcal, label says ${Math.round(kcal)}`);
        continue;
      }
    }
    if (prot > 95 || (carb !== null && carb > 100) || (fat !== null && fat > 100)) {
      rejected.push(`${label0(name, brand)} — a macro exceeds 100 g per 100 g`);
      continue;
    }

    seen.add(p.code);
    kept++;
    const label = label0(name, brand);
    const servG = num(p.serving_quantity, 0);
    out.push({
      id: 'OFF:' + p.code,
      name: label.slice(0, 70),
      alt: [brand, p.quantity || ''].filter(Boolean).join(' '),
      group: 'Packaged and branded',
      src: 'OFF', sid: p.code,
      p100,
      serve: (servG && servG > 0 && servG <= 250)
        ? { g: servG, unit: (p.serving_size || 'serving').slice(0, 24),
            n: p100.map(v => v === null ? null : num(v * servG / 100, 2)) }
        : null
    });
  }
  console.log(`  ${q.padEnd(28)} kept ${kept}`);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'branded.json'), JSON.stringify(out, null, 1));
console.log(`\ndata/branded.json  ${out.length} products  ${fs.statSync(path.join(OUT, 'branded.json')).size} B`);
if (rejected.length) {
  console.log(`rejected ${rejected.length} row(s) that failed the sanity checks:`);
  rejected.forEach(r => console.log('  - ' + r));
}
console.log('Re-run to fill gaps: cached queries are not refetched.');
