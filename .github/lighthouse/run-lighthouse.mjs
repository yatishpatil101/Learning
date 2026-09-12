/* Mobile Lighthouse run — record-only.
 *
 * Closes D138: CI measured lint, i18n, help content, build and the bundle budget,
 * but nothing measured what a phone actually experiences. `check:size` counts the
 * bytes on the critical path, which is a good proxy and a real gate — but it cannot
 * see a slow font swap, a layout shift, or main-thread work after the bytes land.
 * This measures the outcome those bytes are a proxy for.
 *
 * DELIBERATELY RECORD-ONLY. There are no budgets here and no assertion step, and
 * that is a decision rather than an omission — see the long comment in
 * .github/workflows/lighthouse.yml before adding one. In short: a single Lighthouse
 * run on a shared CI runner has enough variance that a threshold tight enough to
 * catch a real regression is also loose enough to block an innocent PR, and a gate
 * people learn to re-run is worse than no gate. The first job of this job is to
 * produce the baseline that would make a threshold defensible.
 *
 * Because the numbers are advisory, the run reports the things that explain a shift
 * as loudly as it reports the metrics: Lighthouse version, Chrome version, the
 * runner's CPU benchmark index, and the emulated form factor. When a number moves,
 * the first question is "did the app change or did the machine?", and this answers
 * it without a rerun.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pinned, not a range. Lighthouse re-weights its performance score between minor
// versions (and moves audits between majors), so an unpinned runner would silently
// redefine the baseline it is here to establish — a score drop would be
// indistinguishable from a regression. Bumping this is a deliberate act that should
// come with the note that the numbers before and after are not comparable.
// Requires Node >= 22.19, which the workflow's NODE_VERSION ('22', resolved by
// setup-node to the latest 22.x) satisfies.
const LIGHTHOUSE_VERSION = '13.4.1';

const ORIGIN = process.env.LH_ORIGIN || 'http://127.0.0.1:4173';
const OUT_DIR = resolve(process.env.LH_OUT_DIR || '.lighthouse');

/* Three routes, not twenty. This runs on every CI job, and each route costs roughly
 * half a minute of wall clock, so the list has to earn its length. These are the
 * three shapes of page the product actually lives or dies on:
 *
 *   /              the landing page — the only route most first-time visitors see,
 *                  and the one every ad and search result lands on.
 *   /listings      the search results grid — the heaviest consumer surface, many
 *                  cards and many images, so it is where LCP and CLS go wrong first.
 *   /property/:id  a detail page — a different render shape again (gallery, map,
 *                  contact gate) and the page a lead converts on.
 *
 * P5000 is the first record in frontend/src/data/properties.json and is the same id
 * the mobile e2e suite navigates to, so it is as load-bearing as any other fixture
 * here. The app defaults to VITE_API_MODE=mock, so a plain production build serves
 * this page from bundled data with no backend running.
 */
const ROUTES = [
  { slug: 'home', path: '/' },
  { slug: 'listings', path: '/listings' },
  { slug: 'property-detail', path: '/property/P5000' },
];

/* The audits worth putting in front of someone who has not opened the report.
 * Read defensively by id: Lighthouse removes and renames audits across majors (TTI
 * is already gone), and a missing audit should show as "n/a" in the table rather
 * than crash a job whose entire purpose is to leave a record behind.
 */
const METRICS = [
  { id: 'first-contentful-paint', label: 'FCP' },
  { id: 'largest-contentful-paint', label: 'LCP' },
  { id: 'total-blocking-time', label: 'TBT' },
  { id: 'cumulative-layout-shift', label: 'CLS' },
  { id: 'speed-index', label: 'SI' },
];

function runLighthouse(url, jsonPath) {
  // `npx --yes` rather than a devDependency: adding lighthouse to
  // frontend/package.json without regenerating package-lock.json would break the
  // `npm ci` that the checks and e2e jobs open with, and regenerating the lockfile
  // is a much larger change than this item asked for.
  const args = [
    '--yes',
    `lighthouse@${LIGHTHOUSE_VERSION}`,
    url,
    // Mobile is Lighthouse's default form factor (Moto G Power screen emulation,
    // simulated slow 4G, 4x CPU slowdown) and the project's performance targets are
    // mobile targets, so the default is the right one. It is not left implicit: the
    // form factor actually used is read back out of the report below and printed, so
    // a future default change shows up in the summary instead of quietly making the
    // whole record measure the wrong device.
    '--only-categories=performance',
    '--output=json',
    `--output-path=${jsonPath}`,
    // Headless is spelled explicitly and not left to chrome-launcher's default,
    // which launches a headful browser and would fail immediately on a runner with
    // no display. Plain `--headless` rather than `--headless=new`: Chrome 132 made
    // it mean new headless anyway, and the bare flag is the spelling that has been
    // valid across every Chrome the runner image is likely to carry.
    // --no-sandbox / --disable-dev-shm-usage are not needed on a GitHub-hosted VM
    // but are what makes this survive a container-based self-hosted runner.
    '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage',
  ];

  const res = spawnSync('npx', args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });

  if (res.status !== 0) return null;

  try {
    return JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }
}

function chromeVersion() {
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  }
  return 'unknown';
}

function fmt(audit) {
  if (!audit || audit.numericValue == null) return 'n/a';
  return audit.displayValue || String(audit.numericValue);
}

mkdirSync(OUT_DIR, { recursive: true });

const rows = [];
const record = {
  lighthouseVersion: LIGHTHOUSE_VERSION,
  chrome: chromeVersion(),
  commit: process.env.GITHUB_SHA || null,
  origin: ORIGIN,
  measuredAt: new Date().toISOString(),
  routes: [],
};

for (const route of ROUTES) {
  const url = `${ORIGIN}${route.path}`;
  const jsonPath = resolve(OUT_DIR, `${route.slug}.json`);
  console.log(`\n=== Lighthouse (mobile): ${url} ===`);

  const lhr = runLighthouse(url, jsonPath);
  if (!lhr) {
    rows.push(`| \`${route.path}\` | — | failed | failed | failed | failed | failed |`);
    record.routes.push({ ...route, ok: false });
    continue;
  }

  const audits = lhr.audits || {};
  const score = lhr.categories?.performance?.score;
  const cells = METRICS.map((m) => fmt(audits[m.id]));

  rows.push(
    `| \`${route.path}\` | ${score == null ? 'n/a' : Math.round(score * 100)} | ${cells.join(' | ')} |`,
  );

  record.routes.push({
    ...route,
    ok: true,
    performanceScore: score == null ? null : Math.round(score * 100),
    formFactor: lhr.configSettings?.formFactor ?? 'unknown',
    metrics: Object.fromEntries(
      METRICS.map((m) => [m.id, audits[m.id]?.numericValue ?? null]),
    ),
  });

  // One reading per route per run, and the environment that produced it. The CPU
  // benchmark index is the single biggest source of run-to-run drift on shared
  // runners; without it a 10-point score swing looks like a code change.
  record.benchmarkIndex = lhr.environment?.benchmarkIndex ?? null;
  record.formFactor = lhr.configSettings?.formFactor ?? 'unknown';
}

writeFileSync(resolve(OUT_DIR, 'summary.json'), `${JSON.stringify(record, null, 2)}\n`);

const summary = [
  '## Lighthouse — mobile, record-only',
  '',
  '> No budgets. These numbers are recorded, never enforced — this job cannot fail a PR',
  '> on a metric. See `.github/workflows/lighthouse.yml` for why, and for what would have',
  '> to be true before it becomes a gate.',
  '',
  `| Route | Perf | ${METRICS.map((m) => m.label).join(' | ')} |`,
  `| --- | --- | ${METRICS.map(() => '---').join(' | ')} |`,
  ...rows,
  '',
  `**Form factor:** ${record.formFactor ?? 'unknown'} · `
    + `**Lighthouse:** ${LIGHTHOUSE_VERSION} · `
    + `**Chrome:** ${record.chrome} · `
    + `**Runner CPU benchmark index:** ${record.benchmarkIndex ?? 'n/a'}`,
  '',
  '_Single run per route. Expect several points of score movement between runs on identical'
    + ' code; compare the benchmark index above before reading a change as a regression._',
  '_Full reports are in the `lighthouse-reports` artifact — drop a `.json` into'
    + ' <https://googlechrome.github.io/lighthouse/viewer/> to read it._',
  '',
].join('\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
console.log(`\n${summary}`);

/* Exit code. A bad *number* never fails this job — that is the whole design. But a
 * run where Lighthouse produced nothing at all is not a slow app, it is a broken
 * job, and exiting 0 on that would leave an empty summary that reads like a pass.
 * So: green if at least one route reported, red only if none did.
 */
const anyOk = record.routes.some((r) => r.ok);
if (!anyOk) {
  console.error('\nEvery Lighthouse run failed — the job is broken, not the app.');
  process.exit(1);
}
