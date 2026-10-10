/* _redirects rules run before the asset lookup, so a catch-all rewrite would swallow /assets; each App.jsx
   route rewrites to the shell, and a prerendered page needs a self-rewrite first or its rule shadows it. */
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* Pages counts every rule after the first dynamic one as dynamic and silently drops all rules past 100. */
const MAX_DYNAMIC = 100;

export function spaRedirects(appSource, htmlFiles) {
  const paths = [...appSource.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]).filter((p) => p !== '/');
  if (!paths.length) throw new Error('[spa-fallback] no route paths found in App.jsx');
  const fixed = new Set();
  const dynamic = new Set();
  for (const path of paths) {
    const prefix = path.split(/\/[:*]/)[0];
    if (prefix === path) {
      if (!htmlFiles.includes(`${path}.html`)) fixed.add(`${path}  /404  200`);
      continue;
    }
    for (const f of htmlFiles) {
      const page = f.slice(0, -'.html'.length);
      if (page.startsWith(`${prefix}/`)) fixed.add(`${page}  ${page}  200`);
    }
    if (path.endsWith('/*')) fixed.add(`${prefix}  /404  200`);
    dynamic.add(`${path}  /404  200`);
  }
  if (dynamic.size > MAX_DYNAMIC) throw new Error(`[spa-fallback] ${dynamic.size} dynamic rules; Pages drops all past ${MAX_DYNAMIC}`);
  return [...fixed, ...dynamic].join('\n') + '\n';
}

export default function spaFallbackPlugin({ root }) {
  let outDir;
  return {
    name: 'draazy-spa-fallback',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    writeBundle() {
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
      const htmlFiles = readdirSync(outDir, { recursive: true })
        .map((f) => `/${f.replace(/\\/g, '/')}`)
        .filter((f) => f.endsWith('.html'));
      const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf-8');
      writeFileSync(join(outDir, '_redirects'), spaRedirects(app, htmlFiles));
    },
  };
}
