/* Can a recipe be rebuilt from its ingredient lines closely enough that editing
   one ingredient (the oil) yields an honest number?

   Energy is the right invariant to test: cooking drives off water, so raw mass
   != cooked mass, but kilocalories are conserved. If summed ingredient energy
   matches INDB's own published energy for the same dish, the reconstruction is
   sound and an edited recipe can be re-costed. If it doesn't, the recipe editor
   is not trustworthy and should not be built. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const B = JSON.parse(fs.readFileSync(path.join(HERE, '../data/foods.json'), 'utf8'));
const ix = Object.fromEntries(B.nutrients.map((n, i) => [n, i]));
const ifct = new Map(Object.entries(B.ingredients).map(([c,p100]) => [c, {p100}]));
const indb = B.foods.filter(f => f.src === 'INDB');

const ss = XLSX.utils.sheet_to_json(
  XLSX.readFile(path.join(HERE, '.cache/recipes_servingsize.xlsx')).Sheets.Sheet1, { defval: null });
const servingsOf = new Map(ss.map(r => [r.recipe_code, Number(r.no_of_servings)]));

// Deliberately generic. Per-ingredient densities exist in units.json but the
// point here is to find out how much of the error is unit conversion.
const G = { g: 1, ml: 1, tsp: 5, tbsp: 15, C: 240, cup: 240, sprig: 1, nos: 30, pinch: 0.5, drops: 0.05, sheet: 5 };

let ok = 0, skipped = 0; const errs = [];
for (const f of indb) {
  const nServ = servingsOf.get(f.sid);
  if (!f.ing || !f.serve || !nServ) { skipped++; continue; }
  let kcal = 0, unmapped = 0;
  for (const [, code, amt, unit] of f.ing) {
    const g = G[unit];
    const src = code && ifct.get(code);
    if (!src || g === undefined || src.p100[ix.kcal] === null) { unmapped++; continue; }
    kcal += src.p100[ix.kcal] * (amt * g) / 100;
  }
  if (unmapped > 0 || kcal <= 0) { skipped++; continue; }
  const declared = f.serve.n[ix.kcal] * nServ;
  errs.push({ name: f.name, ratio: kcal / declared, mine: Math.round(kcal), theirs: Math.round(declared) });
  ok++;
}

errs.sort((a, b) => a.ratio - b.ratio);
const p = q => errs[Math.min(errs.length - 1, Math.floor(errs.length * q))].ratio;
const within = t => errs.filter(e => Math.abs(e.ratio - 1) <= t).length;

console.log(`recipes fully reconstructable: ${ok}   skipped (unmapped ingredient/unit/servings): ${skipped}`);
console.log(`\nreconstructed kcal / INDB kcal`);
console.log(`  p10 ${p(.10).toFixed(2)}   p25 ${p(.25).toFixed(2)}   median ${p(.50).toFixed(2)}   p75 ${p(.75).toFixed(2)}   p90 ${p(.90).toFixed(2)}`);
console.log(`  within ±10%: ${within(.10)} (${(within(.10) / ok * 100).toFixed(0)}%)   ±25%: ${within(.25)} (${(within(.25) / ok * 100).toFixed(0)}%)   ±50%: ${within(.50)} (${(within(.50) / ok * 100).toFixed(0)}%)`);
console.log('\nworst under-estimates:');
for (const e of errs.slice(0, 4)) console.log(`  ${e.ratio.toFixed(2)}  ${e.name.slice(0, 42).padEnd(44)} mine ${e.mine} vs INDB ${e.theirs}`);
console.log('worst over-estimates:');
for (const e of errs.slice(-4)) console.log(`  ${e.ratio.toFixed(2)}  ${e.name.slice(0, 42).padEnd(44)} mine ${e.mine} vs INDB ${e.theirs}`);
