// Usage: node scripts/check-comments.mjs [--staged | A..B]   (default: uncommitted + untracked files vs HEAD)
// Checks whole touched files, not just added lines, matching AGENTS.md File-Touch Hygiene.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const MAX_LINES = 2;
const MAX_LEN = 120;
const EXT = /\.(java|jsx?|mjs|cjs|css|sql|ya?ml|properties)$/;
// Comments here are checksummed (Flyway), protected by docs/system/code-quality.md, or parsed by a script.
const EXEMPT = /\/db\/migration\/V[^/]*\.sql$|(?:^|\/)(FileStorage|DevObjectStore|TestDatabaseIsolationTest|AbstractApiTest|Routes)\.java$/;
const CHANGELOG = /\bD\d{2,}\b|\bS\d{2}\b|\bpreviously\b|\bno longer\b|\bused to\b|\b20\d\d-\d\d-\d\d\b/i;

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);
const arg = process.argv[2];

let files;
let read;
if (arg === '--staged') {
  files = lines(git('diff', '--cached', '--name-only', '--diff-filter=AMR'));
  read = (f) => git('show', `:${f}`);
} else if (arg?.includes('..')) {
  const head = arg.split('..')[1] || 'HEAD';
  files = lines(git('diff', '--name-only', '--diff-filter=AMR', arg));
  read = (f) => git('show', `${head}:${f}`);
} else {
  files = [...lines(git('diff', 'HEAD', '--name-only', '--diff-filter=AMR')), ...lines(git('ls-files', '--others', '--exclude-standard'))];
  read = (f) => fs.readFileSync(f, 'utf8');
}

const problems = [];
for (const f of files.filter((f) => EXT.test(f) && !EXEMPT.test(f))) {
  const L = read(f).split(/\r?\n/);
  const hash = /\.(ya?ml|properties)$/.test(f);
  const dash = f.endsWith('.sql');
  const kind = (t) => (t.startsWith('//') ? '//' : hash && t.startsWith('#') ? '#' : dash && t.startsWith('--') ? '--' : null);
  for (let i = 0; i < L.length; i++) {
    const t = L[i].trim();
    let j = i;
    if (t.startsWith('/*') || t.startsWith('{/*')) {
      while (j < L.length - 1 && !L[j].includes('*/')) j++;
    } else if (kind(t)) {
      while (j + 1 < L.length && kind(L[j + 1].trim()) === kind(t)) j++;
    } else continue;
    const block = L.slice(i, j + 1);
    const why = [
      block.length > MAX_LINES && `${block.length} lines`,
      block.some((l) => l.length > MAX_LEN) && `line over ${MAX_LEN} chars`,
      CHANGELOG.test(block.join('\n')) && 'changelog wording',
    ].filter(Boolean);
    if (why.length) problems.push(`${f}:${i + 1}  ${why.join(', ')}`);
    i = j;
  }
}

if (problems.length) {
  console.error(`${problems.join('\n')}\n\n${problems.length} comment(s) break the AGENTS.md rule: at most ${MAX_LINES} lines, WHY only, no changelog.`);
  process.exit(1);
}
console.log(`check-comments: ${files.length} file(s) clean`);
