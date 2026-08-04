/**
 * End-to-end smoke of the API-polish pass, against a running backend and a real Postgres.
 *
 * Signs in for real (OTP read from the backend console log, exactly as a developer does), then
 * exercises the endpoints this pass added or changed shape on. The backend's own 733 tests run
 * through MockMvc, which stands in for the servlet container — so they cannot see the context path,
 * cannot see the security filter chain ordering the same way, and cannot catch a Flyway state that
 * only exists on a long-lived database. This can.
 *
 *   node backend/tools/live-probe.mjs [base] [otp-log]
 *   node backend/tools/live-probe.mjs http://localhost:8081/api %TEMP%\pn-replay.log
 *
 * The base must include `/api` — this talks to the backend directly, with no Vite proxy in front.
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8081/api';
const LOG = process.argv[3] || `${process.env.TEMP}\\pn-replay.log`;
const MOBILE = '9876500123';

const json = { 'content-type': 'application/json' };
let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (ok) pass += 1; else fail += 1;
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) Object.assign(headers, json);
  const res = await fetch(BASE + path, { method, headers, body });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json: parsed, allow: res.headers.get('allow') };
}

function latestOtp(mobile) {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n')
    .filter((l) => l.includes('[MOCK OTP]') && l.includes(`mobile=${mobile}`));
  return lines.length ? (lines[lines.length - 1].match(/code=(\d+)/)?.[1] ?? null) : null;
}

// ---------------------------------------------------------------- auth
const before = latestOtp(MOBILE);
const start = await call('POST', '/auth/login', { body: JSON.stringify({ mobile: MOBILE }) });
check('POST /auth/login sends an OTP', start.status === 200 || start.status === 202,
  `${start.status} ${start.text.slice(0, 90)}`);

let code = null;
for (let i = 0; i < 40; i += 1) {
  code = latestOtp(MOBILE);
  if (code && code !== before) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!code) {
  console.log(`FAIL  no OTP found in ${LOG} — is the backend logging there?`);
  process.exit(1);
}

const verify = await call('POST', '/auth/login',
  { body: JSON.stringify({ mobile: MOBILE, otp: code }) });
const token = verify.json?.accessToken ?? verify.json?.token;
check('POST /auth/login verifies the OTP and returns a token', !!token,
  `${verify.status} ${token ? 'token received' : verify.text.slice(0, 140)}`);
if (!token) process.exit(1);

// ---------------------------------------------------- the error-handling fixes
const wrongVerb = await call('DELETE', '/properties', { token });
check('405 on a wrong verb, with an Allow header  [was 500 + stacktrace]',
  wrongVerb.status === 405 && !!wrongVerb.allow,
  `${wrongVerb.status} allow=${wrongVerb.allow} ${wrongVerb.text.slice(0, 90)}`);

const badType = await call('GET', '/properties?bhk=notanumber', { token });
check('400 on an untypeable param — names the param, not its Java type',
  badType.status === 400
    && (badType.json?.message ?? '').includes('bhk')
    && !/Integer|java\./.test(badType.json?.message ?? ''),
  `${badType.status} ${badType.text.slice(0, 140)}`);

// ------------------------------------------------------------ new endpoints
const created = await call('POST', '/me/saved-searches',
  { token, body: JSON.stringify({ name: 'E2E', query: '2bhk baner' }) });
const searchId = created.json?.id;
check('POST /me/saved-searches creates an alert, daily by default',
  created.status === 201 && created.json?.alertFrequency === 'daily',
  `${created.status} ${created.text.slice(0, 120)}`);

const patched = await call('PATCH', `/me/saved-searches/${searchId}`,
  { token, body: JSON.stringify({ alertFrequency: 'off' }) });
check('PATCH /me/saved-searches/{id} turns alerts off, leaves channel alone  [NEW]',
  patched.status === 200 && patched.json?.alertFrequency === 'off'
    && patched.json?.channel === 'whatsapp',
  `${patched.status} ${patched.text.slice(0, 120)}`);

const badFreq = await call('PATCH', `/me/saved-searches/${searchId}`,
  { token, body: JSON.stringify({ alertFrequency: 'hourly' }) });
check('  ...and an unknown frequency is 422, not a 500 from the CHECK constraint',
  badFreq.status === 422, `${badFreq.status} ${badFreq.text.slice(0, 120)}`);

const queue = await call('GET', '/admin/reviews', { token });
check('GET /admin/reviews is staff-gated — an ordinary user gets 403  [NEW]',
  queue.status === 403, `${queue.status} ${queue.text.slice(0, 120)}`);

const rooms = await call('GET', '/properties/00000000-0000-0000-0000-000000000000/rooms');
check('GET /properties/{id}/rooms is public and served  [NEW — was spec-only, 404]',
  rooms.status === 200 && Array.isArray(rooms.json),
  `${rooms.status} ${rooms.text.slice(0, 90)}`);

// --------------------------------------------------------- the shape changes
const saved = await call('GET', '/me/saved', { token });
check('GET /me/saved returns a paged envelope  [SHAPE CHANGE]',
  saved.status === 200 && Array.isArray(saved.json?.content)
    && typeof saved.json?.totalElements === 'number',
  `${saved.status} ${saved.text.slice(0, 120)}`);

const inbox = await call('GET', '/messages', { token });
check('GET /messages returns a paged envelope  [SHAPE CHANGE]',
  inbox.status === 200 && Array.isArray(inbox.json?.content),
  `${inbox.status} ${inbox.text.slice(0, 120)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
