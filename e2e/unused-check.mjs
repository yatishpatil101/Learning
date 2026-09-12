import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^import\s+\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) names.add(part.trim().split(/\s+as\s+/).pop());
  }
  const dead = [...names].filter((n) => (src.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length <= 1);
  const tests = (src.match(/^\s*test\s*\(/gm) || []).length;
  console.log(`${file}: tests=${tests} dead=${dead.length ? dead.join(', ') : 'none'}`);
}
