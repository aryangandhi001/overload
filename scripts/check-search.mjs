/* Search has to be right for the words typed daily — a nutrition log nobody can
   find food in is worthless. This asserts the first result for each, so a change
   to the ranking cannot silently regress them. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/foods.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'nutrition.js'), 'utf8');

// Run the module's own search against the real bundle, with the DOM bits stubbed.
const sandbox = {
  FOODS: null, FOODIX: null, NUTIX: {},
  NUT: { recent: [], freq: {}, custom: {}, units: {} },
  PORTIONS: {}, document: { addEventListener(){} },
  registerView(){}, registerTab(){}, registerData(){}, registerBoot(){}, registerSettingsCard(){},
  S: {}, uid: () => 'x', esc: s => s, toast(){}, today: () => '2026-01-01', console
};
const body = src
  .replace(/^const (NUT_SLOTS|NL)/m, 'var $1')
  .replace(/\bconst (FOODS|FOODIX|NUTIX|NUT|PORTIONS)\b/g, 'var $1')
  .replace(/\blet (FOODS|FOODIX|NUTIX|NUT|PORTIONS)\b/g, 'var $1');
const fn = new Function(...Object.keys(sandbox), body + '\n;return {nutSearch, setFoods(b){FOODS=b; NUTIX=Object.fromEntries(b.nutrients.map((n,i)=>[n,i])); FOODIX=new Map(b.foods.map(f=>[f.id,f]));}};');
const api = fn(...Object.values(sandbox));
api.setFoods(bundle);

const EXPECT = {
  'roti':'Chapati/Roti', 'chapati':'Chapati/Roti', 'rice':'Boiled rice (Uble chawal)',
  'egg':'Egg, poultry, whole, raw', 'milk':'Milk, whole, Cow', 'curd':'Curd (Dahi)',
  'dahi':'Curd (Dahi)', 'chaas':'Buttermilk (Chaas)', 'paneer':'Paneer', 'ghee':'Ghee',
  'atta':'Wheat flour, atta', 'paratha':'Plain parantha/paratha', 'dosa':'Plain dosa',
  'moong dal':'Washed moong dal (Dhuli moong ki dal)',
  'chana dal':'Split bengal gram dal (Channa dal)', 'chai':'Hot tea (Garam Chai)',
  'banana':'Banana, ripe, robusta', 'apple':'Apple, big', 'onion':'Onion, big',
  'tomato':'Tomato, ripe, local', 'potato':'Potato, brown skin, big',
  'aloo':'Potato, brown skin, big', 'amul milk':'Amul Taaza Homogenised Toned Milk', 'amul gold':'Amul Gold Milky Milk',
  'sugar':'Sugar, white', 'oil':'Sunflower oil', 'salt':'Salt',
  'bread':'Bread, white', 'butter':'Butter, salted', 'honey':'Honey'
};
// These only have to return *something* sensible, not one exact row.
const NONEMPTY = ['dal','sabji','aloo sabji','bhindi','gobi','palak','rajma','chole','khichdi',
  'poha','idli','sambar','lassi','methi','karela','lauki','baingan','kela','carrot','mango','papaya','spinach'];

let fail = 0;
for (const [q, want] of Object.entries(EXPECT)) {
  const got = api.nutSearch(q)[0];
  const name = got && got.name;
  if (name !== want) { console.error(`✗ "${q}" -> ${name || 'NO MATCH'}   (expected ${want})`); fail++; }
}
for (const q of NONEMPTY) {
  if (!api.nutSearch(q).length) { console.error(`✗ "${q}" -> NO MATCH`); fail++; }
}
console.log(fail ? `\n${fail} search failure(s)` :
  `✓ all ${Object.keys(EXPECT).length} pinned queries and ${NONEMPTY.length} coverage queries pass`);
process.exit(fail ? 1 : 0);
