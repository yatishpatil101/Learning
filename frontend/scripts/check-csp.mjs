/**
 * The CSP is written twice — a <meta> in index.html and a header in public/_headers — and only the
 * dev-server copy is exercised locally, so this compares them directive by directive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/** Directives that legitimately differ, each with the reason, so the list cannot grow silently. */
const ALLOWED_DELTAS = {
  // Vite's HMR client opens a websocket; production has no dev server to talk to.
  'connect-src': { meta: ['ws:', 'wss:'], header: [] },
  // A <meta> CSP cannot express frame-ancestors, and `data:` iframes are a dev-tooling artefact.
  'frame-src': { meta: ['data:'], header: [] },
};

/** Directives the header carries alone, because a <meta> tag cannot express them at all. */
const HEADER_ONLY = new Set(['form-action', 'frame-ancestors']);

function parse(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name) directives.set(name, sources);
  }
  return directives;
}

function extract(file, pattern, label) {
  const text = readFileSync(join(root, file), 'utf8');
  const match = text.match(pattern);
  if (!match) {
    console.error(`✗ No Content-Security-Policy found in ${file} — ${label} has moved or been deleted.`);
    process.exit(1);
  }
  return parse(match[1]);
}

const meta = extract(
  'index.html',
  /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  'the meta tag',
);
const header = extract('public/_headers', /^\s*Content-Security-Policy:\s*(.+)$/m, 'the header');

const problems = [];

// 'wasm-unsafe-eval' is the one source this feature cannot lose quietly, so it is named outright
// rather than left to the comparison — a policy missing it from BOTH copies would compare equal.
for (const [label, directives] of [['index.html', meta], ['public/_headers', header]]) {
  if (!(directives.get('script-src') || []).includes("'wasm-unsafe-eval'")) {
    problems.push(
      `${label}: script-src is missing 'wasm-unsafe-eval'. Identity verification compiles the\n` +
      '    Tesseract OCR core and the MediaPipe face landmarker in the browser; without it the\n' +
      '    worker aborts without rejecting and the review screen spins forever.',
    );
  }
}

for (const name of new Set([...meta.keys(), ...header.keys()])) {
  if (HEADER_ONLY.has(name)) {
    if (meta.has(name)) problems.push(`index.html declares ${name}, which a <meta> CSP cannot enforce.`);
    continue;
  }
  if (!meta.has(name)) { problems.push(`index.html is missing the ${name} directive.`); continue; }
  if (!header.has(name)) { problems.push(`public/_headers is missing the ${name} directive.`); continue; }

  const allowed = ALLOWED_DELTAS[name] || { meta: [], header: [] };
  const metaOnly = meta.get(name).filter((s) => !header.get(name).includes(s) && !allowed.meta.includes(s));
  const headerOnly = header.get(name).filter((s) => !meta.get(name).includes(s) && !allowed.header.includes(s));

  if (metaOnly.length) problems.push(`${name}: index.html allows ${metaOnly.join(' ')} and public/_headers does not.`);
  if (headerOnly.length) problems.push(`${name}: public/_headers allows ${headerOnly.join(' ')} and index.html does not.`);
}

if (problems.length) {
  console.error('✗ The two Content-Security-Policy copies disagree:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\n  Only one of these is exercised by the test suite, so a difference here reaches\n' +
    '  production untested. Fix both copies, or record a deliberate delta in ALLOWED_DELTAS\n' +
    '  in this file with the reason.\n',
  );
  process.exit(1);
}

console.log(`✓ CSP copies agree (${meta.size} directives), and both allow WASM compilation.`);
