import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function* tests(suite, file, titles = []) {
  const path = suite.file === suite.title ? titles : [...titles, suite.title];
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      yield { spec, test: t, file: `tests/${(spec.file ?? file).replace(/\\/g, '/')}`, titles: [...path, spec.title] };
    }
  }
  for (const child of suite.suites ?? []) yield* tests(child, child.file ?? file, path);
}

const key = (r) => `${r.file}:${r.spec.line}:${r.spec.column}|${r.test.projectName}|${r.titles.join(' > ')}`;
const all = (report) => report.suites.flatMap((s) => [...tests(s, s.file)]);
const load = (f) => JSON.parse(readFileSync(f, 'utf8'));
const loadDurations = (f) => (existsSync(f) ? load(f) : {});

function count(files) {
  console.log(files.reduce((n, f) => n + all(load(f)).length, 0));
}

function plan(listFile, durationsFile, shardArg, outFile) {
  const durations = loadDurations(durationsFile);
  const perFile = new Map();
  for (const r of all(load(listFile))) perFile.set(r.file, (perFile.get(r.file) ?? 0) + 1);

  const known = [...perFile].filter(([f]) => durations[f] > 0);
  const perTest = known.length
    ? known.reduce((s, [f]) => s + durations[f], 0) / known.reduce((s, [, n]) => s + n, 0)
    : 5;
  const weight = (f) => durations[f] > 0 ? durations[f] : perFile.get(f) * perTest;

  const shards = Array.from({ length: Math.max(1, Math.min(Number(shardArg), perFile.size)) }, () => ({ seconds: 0, files: [] }));
  for (const f of [...perFile.keys()].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.files.push(f);
    lightest.seconds += weight(f);
  }
  writeFileSync(outFile, JSON.stringify(shards.map((s) => ({ seconds: Math.round(s.seconds), files: s.files.sort() }))));
}

function report(reportFile, lastFailedFile, durationsFile, ...listFiles) {
  const data = load(reportFile);
  const results = all(data);
  const by = (status) => results.filter((r) => r.test.status === status);
  const failed = by('unexpected');
  const flaky = by('flaky');
  const skipped = by('skipped');

  const listed = new Map(listFiles.flatMap((f) => all(load(f))).map((r) => [key(r), r]));
  const reported = new Map();
  for (const r of results) reported.set(key(r), (reported.get(key(r)) ?? 0) + 1);
  const missing = [...listed].filter(([k]) => !reported.has(k)).map(([, r]) => r);
  const extra = [...reported].filter(([k, n]) => !listed.has(k) || n > 1).map(([k]) => k);
  const errors = data.errors ?? [];

  console.log(
    `\n${results.length} tests: ${by('expected').length} passed, ${failed.length} failed, ` +
      `${flaky.length} flaky, ${skipped.length} skipped (listed beforehand: ${listed.size}).`,
  );
  const line = (r) => `  ${r.file}:${r.spec.line}  [${r.test.projectName}]  ${r.spec.title}`;
  if (failed.length) console.log(`\nFAILED:\n${failed.map(line).join('\n')}`);
  if (flaky.length) console.log(`\nFLAKY (passed on retry):\n${flaky.map(line).join('\n')}`);
  if (missing.length) console.log(`\nMISSING - listed but never reported, a shard died (see its log):\n${missing.slice(0, 50).map(line).join('\n')}`);
  if (extra.length) console.log(`\nEXTRA - reported but not listed, or reported twice:\n  ${extra.slice(0, 50).join('\n  ')}`);
  if (errors.length) {
    console.log(`\nERRORS outside any test (setup, teardown, web server):`);
    for (const e of errors) console.log(`  ${(e.message ?? e.value ?? String(e)).split('\n')[0]}`);
  }

  const entries = new Map([...failed, ...missing].map((r) => [key(r), `${r.file}:${r.spec.line}\t${key(r)}`]));
  const locations = [...entries.values()].sort();
  if (errors.length) locations.unshift('!rerun-full');
  writeFileSync(lastFailedFile, locations.join('\n') + (locations.length ? '\n' : ''));

  const spent = new Map();
  for (const r of results) {
    const ms = (r.test.results ?? []).reduce((s, x) => s + (x.duration ?? 0), 0);
    spent.set(r.file, (spent.get(r.file) ?? 0) + ms / 1000);
  }
  if (durationsFile && durationsFile !== '-') {
    const durations = loadDurations(durationsFile);
    for (const [f, s] of spent) if (s > 0) durations[f] = Math.round(s * 10) / 10;
    writeFileSync(durationsFile, JSON.stringify(durations, null, 1));
  }

  process.exit(failed.length || missing.length || extra.length || errors.length ? 1 : 0);
}
function stale(lastFailedFile, ...listFiles) {
  const listed = new Set(listFiles.flatMap((f) => all(load(f))).map(key));
  const files = new Set();
  for (const entry of readFileSync(lastFailedFile, 'utf8').split('\n')) {
    const [location, k] = entry.trim().split('\t');
    if (k && !listed.has(k)) files.add(location.replace(/:\d+$/, ''));
  }
  if (files.size) console.log([...files].join('\n'));
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'count') count(args);
else if (mode === 'plan') plan(...args);
else if (mode === 'report') report(...args);
else if (mode === 'stale') stale(...args);
else {
  console.error('usage: shards.mjs count|plan|report ...');
  process.exit(2);
}
