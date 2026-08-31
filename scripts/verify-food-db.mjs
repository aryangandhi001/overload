/* Sanity checks on the emitted bundle. Not part of the build — run by hand
   when the transform changes. */
import fs from 'node:fs';
const B = JSON.parse(fs.readFileSync(new URL('../data/foods.json', import.meta.url), 'utf8'));
const ix = Object.fromEntries(B.nutrients.map((n, i) => [n, i]));

console.log('IFCT conversion spot-checks (per 100 g) — compare against known values:');
for (const q of ['rice, raw, milled', 'oil,', 'wheat flour', 'milk, whole', 'egg, poultry, whole', 'bengal gram, dal']) {
  const f = B.foods.find(x => x.src === 'IFCT2017' && x.name.toLowerCase().includes(q));
  if (!f) { console.log('  ' + q.padEnd(24) + ' NOT FOUND'); continue; }
  console.log(`  ${f.name.slice(0, 32).padEnd(34)} ${String(f.p100[ix.kcal]).padStart(6)} kcal  P ${String(f.p100[ix.protein_g]).padStart(5)} g  Fe ${String(f.p100[ix.iron_mg]).padStart(5)} mg  Ca ${String(f.p100[ix.calcium_mg]).padStart(6)} mg`);
}

console.log('\nINDB coverage of everyday dishes:');
for (const q of ['dal', 'sabzi', 'khichdi', 'paratha', 'rajma', 'chole', 'poha', 'idli', 'dosa', 'curd', 'paneer', 'roti']) {
  const hits = B.foods.filter(f => f.src === 'INDB' && f.name.toLowerCase().includes(q));
  console.log(`  ${q.padEnd(9)} ${String(hits.length).padStart(3)}  ${hits.slice(0, 2).map(h => h.name.slice(0, 36)).join('  |  ')}`);
}

let nulls = 0, cells = 0;
for (const f of B.foods) for (const v of f.p100) { cells++; if (v === null) nulls++; }
console.log(`\nnull cells in per-100 g: ${nulls} / ${cells}`);
console.log(`foods with no serving: ${B.foods.filter(f => !f.serve).length}` +
  ` (${B.foods.filter(f => !f.serve && f.src === 'INDB').length} INDB, ${B.foods.filter(f => f.src === 'IFCT2017').length} IFCT by design)`);

const sg = B.foods.filter(f => f.serve).map(f => f.serve.g).sort((a, b) => a - b);
console.log(`derived serving grams: min ${sg[0]}  p25 ${sg[sg.length >> 2]}  median ${sg[sg.length >> 1]}  p75 ${sg[(sg.length * 3) >> 2]}  max ${sg[sg.length - 1]}`);
