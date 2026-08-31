/* The brief requires the workout module to be independent of nutrition.
   Classic scripts share one global scope, so nothing but a check enforces it.
   Run this after touching either module. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const workout = fs.readFileSync(path.join(ROOT, 'workout.js'), 'utf8');
const nutrition = fs.readFileSync(path.join(ROOT, 'nutrition.js'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8');
const bodyjs = fs.readFileSync(path.join(ROOT, 'body.js'), 'utf8');

// Every top-level name the nutrition module defines.
const nutNames = [...nutrition.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)]
  .map(m => m[1] || m[2]);

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const workoutCode = strip(workout);

const leaks = nutNames.filter(n => new RegExp('\b' + n + '\b').test(workoutCode));
const keyLeaks = /['"]nut:/.test(workoutCode) ? ["workout.js references a 'nut:' storage key"] : [];

// And core must not name either module.
const coreCode = strip(core);
const coreLeaks = [...nutNames, 'viewToday', 'viewWorkout', 'suggest', 'checkPRs']
  .filter(n => new RegExp('\b' + n + '\b').test(coreCode));

let bad = false;
const report = (label, list) => {
  if (list.length) { bad = true; console.error(`✗ ${label}: ${list.join(', ')}`); }
  else console.log(`✓ ${label}`);
};
report('workout.js does not reference nutrition', leaks);
report("workout.js does not touch 'nut:' keys", keyLeaks);
report('core.js names no feature module', coreLeaks);

// body.js is the join point for phase 3, so it may read both — but neither
// feature module may reach into it.
const bodyNames = [...bodyjs.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)]
  .map(m => m[1] || m[2]).filter(n => n !== 'BW_MIN' && n !== 'BW_MAX');
report('workout.js does not reference bodyweight',
  bodyNames.filter(n => new RegExp('\b' + n + '\b').test(workoutCode)));
report('nutrition.js does not reference bodyweight',
  bodyNames.filter(n => new RegExp('\b' + n + '\b').test(strip(nutrition))));
console.log(`\n  nutrition defines ${nutNames.length} top-level names; none appear in workout.js.`);
process.exit(bad ? 1 : 0);
