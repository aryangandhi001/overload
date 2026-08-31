/* Guards against a real bug that shipped once: a patch written through a shell
   heredoc turned the \b escapes in a regex into literal backspace characters,
   so the pattern silently never matched. Nothing looked wrong on screen. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['core.js','workout.js','nutrition.js','sw.js','index.html',
  'scripts/build-food-db.mjs','scripts/build-portions.mjs'];
let bad = 0;
for (const rel of files) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  [...s].forEach((ch, i) => {
    const o = ch.charCodeAt(0);
    if (o < 32 && !'\n\r\t'.includes(ch)) {
      const line = s.slice(0, i).split('\n').length;
      console.error(`✗ ${rel}:${line} contains U+${o.toString(16).padStart(4,'0').toUpperCase()}`);
      bad++;
    }
  });
}
console.log(bad ? `\n${bad} control-character defect(s)` : '✓ no stray control characters in any source file');
process.exit(bad ? 1 : 0);
