/** The CSP is written twice — a <meta> in index.html and a header in public/_headers — and only the dev-server copy
 * is exercised locally, so this compares them directive by directive. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
      `${label}: script-src is missing 'wasm-unsafe-eval'. The selfie liveness check compiles\n` +
      '    the MediaPipe face landmarker in the browser; without it the check silently turns off.',
    );
  }
}

// Hashes cover the inline scripts as the deploy build emits them: API base '/api', the default every env uses.
const inlineHashes = [...readFileSync(join(root, 'index.html'), 'utf8')
  .matchAll(/<script(?![^>]*\b(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => `'sha256-${createHash('sha256').update(m[1].replaceAll('__API_BASE__', '/api')).digest('base64')}'`);
for (const [label, directives] of [['index.html', meta], ['public/_headers', header]]) {
  const sources = directives.get('script-src') || [];
  if (sources.includes("'unsafe-inline'")) problems.push(`${label}: script-src allows 'unsafe-inline'; hash the inline script instead.`);
  for (const hash of inlineHashes.filter((h) => !sources.includes(h))) {
    problems.push(`${label}: script-src is missing ${hash}, the hash of an inline <script> in index.html. Update it in index.html, public/_headers and edge/seo-pages.mjs.`);
  }
  for (const hash of sources.filter((s) => s.startsWith("'sha256-") && !inlineHashes.includes(s))) {
    problems.push(`${label}: script-src carries ${hash}, which matches no inline <script> in index.html.`);
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

// Pages Functions bypass public/_headers, so the edge-rendered pages carry their own copy of the `/*` block.
const { SECURITY_HEADERS } = await import(pathToFileURL(join(root, 'edge/seo-pages.mjs')).href);
const block = readFileSync(join(root, 'public/_headers'), 'utf8').split(/\r?\n\/\*\r?\n/)[1].split(/\r?\n(?=\S)/)[0];
const fileHeaders = Object.fromEntries(block.split(/\r?\n/).map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
const edgeDrift = [...new Set([...Object.keys(fileHeaders), ...Object.keys(SECURITY_HEADERS)])]
  .filter((name) => fileHeaders[name] !== SECURITY_HEADERS[name]);
if (edgeDrift.length) {
  console.error(`✗ edge/seo-pages.mjs SECURITY_HEADERS differs from the /* block in public/_headers: ${edgeDrift.join(', ')}.`);
  process.exit(1);
}

console.log(`✓ CSP copies agree (${meta.size} directives), both allow WASM compilation, and the edge headers match _headers.`);
