/**
 * Live probe of the paid Leave & Licence (rent-agreement) service-request path.
 *
 * Everything the browser does in `VITE_API_MODE=http` *except* the Cashfree webhook — sign in for
 * real, POST a rent-agreement exactly as `toCreate()` shapes it, and assert the create response
 * carries the price and a payment session id with the request parked at `awaiting-payment`.
 *
 *   node backend/tools/probe-ll.mjs [base] [otp-log]
 *
 * The base must include `/api` — this talks to the backend directly, no Vite proxy.
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8098/api';
const LOG = process.argv[3] || `${process.env.TEMP}\\pn-probe.log`;
const MOBILE = '9876500123';
const STAFF_MOBILE = '9711827190'; // seeded `staff` on the rental team

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
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json: parsed };
}

function latestOtp(mobile) {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n')
    .filter((l) => l.includes('[MOCK OTP]') && l.includes(`mobile=${mobile}`));
  return lines.length ? (lines[lines.length - 1].match(/code=(\d+)/)?.[1] ?? null) : null;
}

async function login(mobile) {
  const seen = latestOtp(mobile);
  await call('POST', '/auth/login', { body: JSON.stringify({ mobile }) });
  let otp = null;
  for (let i = 0; i < 60; i += 1) {
    otp = latestOtp(mobile);
    if (otp && otp !== seen) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!otp) return null;
  const res = await call('POST', '/auth/login', { body: JSON.stringify({ mobile, otp }) });
  return res.json?.accessToken ?? res.json?.token ?? null;
}

// ---------------------------------------------------------------- auth
const token = await login(MOBILE);
check('POST /auth/login sends and verifies an OTP', Boolean(token),
  token ? 'token received' : 'no token');
if (!token) process.exit(1);

// -------------------------------------------- unstick anything a previous run left unpaid
// Also the answer to "can an abandoned payment be recovered?" — the customer cannot change
// status (PATCH /{id}/status is staff-only), so this is the only way out of `awaiting-payment`
// short of the webhook.
const staffToken = await login(STAFF_MOBILE);
if (staffToken) {
  const mine = await call('GET', '/service-requests?type=rent-agreement', { token });
  const stale = (mine.json?.content ?? []).filter((r) => r.status === 'awaiting-payment');
  for (const r of stale) {
    const res = await call('PATCH', `/service-requests/${r.id}/status`, {
      token: staffToken,
      body: JSON.stringify({ status: 'cancelled', note: 'probe reset' }),
    });
    check('staff can cancel an abandoned awaiting-payment request', res.status === 200,
      `${res.status} ${res.text.slice(0, 140)}`);
  }
}


// ------------------------------------------------- create: exactly what toCreate() sends
const created = await call('POST', '/service-requests', {
  token,
  body: JSON.stringify({
    type: 'rent-agreement',
    details: { ownerName: 'Probe Owner', rent: 25000, deposit: 100000, months: 11 },
  }),
});
check('POST /service-requests {type:rent-agreement} → 201', created.status === 201,
  `${created.status} ${created.text.slice(0, 200)}`);

const sr = created.json || {};
// Whole rupees, not paise — PaymentGateway.createOrder(amountInr) puts this straight into
// Cashfree's `order_amount`, which is an INR decimal. A paise value here would charge ₹235,900.
check('create response carries amount = 2359 (whole rupees)', sr.amount === 2359,
  `amount=${JSON.stringify(sr.amount)}`);
check('create response carries a paymentSessionId', typeof sr.paymentSessionId === 'string'
  && sr.paymentSessionId.length > 0, `paymentSessionId=${JSON.stringify(sr.paymentSessionId)}`);
check('create response status = awaiting-payment', sr.status === 'awaiting-payment',
  `status=${JSON.stringify(sr.status)}`);
check('create response type = rent-agreement', sr.type === 'rent-agreement',
  `type=${JSON.stringify(sr.type)}`);
check('create response echoes details (D119)', sr.details?.ownerName === 'Probe Owner',
  `details=${JSON.stringify(sr.details)}`);

// ------------------------------------------------- re-read (the hook's settle check)
const read = await call('GET', `/service-requests/${sr.id}`, { token });
check('GET /service-requests/{id} → 200 for the requester', read.status === 200,
  `${read.status} ${read.text.slice(0, 160)}`);
check('re-read still awaiting-payment (unpaid, so no success screen)',
  read.json?.status === 'awaiting-payment', `status=${JSON.stringify(read.json?.status)}`);
check('re-read does NOT leak paymentSessionId', read.json?.paymentSessionId == null,
  `paymentSessionId=${JSON.stringify(read.json?.paymentSessionId)}`);

// ------------------------------------------------- list: the wizard's re-submission lock
const list = await call('GET', '/service-requests?type=rent-agreement', { token });
const rows = list.json?.content ?? (Array.isArray(list.json) ? list.json : []);
check('GET /service-requests?type=rent-agreement → 200', list.status === 200,
  `${list.status} ${list.text.slice(0, 160)}`);
check('the awaiting-payment request IS visible to its requester (lock works)',
  rows.some((r) => r.id === sr.id), `${rows.length} row(s): ${rows.map((r) => r.status).join(',')}`);

// ------------------------------------------------- the type allowlist is the real gate
const unaliased = await call('POST', '/service-requests', {
  token, body: JSON.stringify({ type: 'rental', details: {} }),
});
check("POST {type:'rental'} → 400 (the un-aliased spelling cannot file a free agreement)",
  unaliased.status === 400, `${unaliased.status} ${unaliased.text.slice(0, 140)}`);

// ------------------------------------------------- one open unpaid request per desk
const second = await call('POST', '/service-requests', {
  token, body: JSON.stringify({ type: 'rent-agreement', details: {} }),
});
check('a second rent-agreement while one is unpaid → 409 (no unbounded gateway orders)',
  second.status === 409, `${second.status} ${second.text.slice(0, 160)}`);

// ------------------------------------------------- a free desk is still free
const free = await call('POST', '/service-requests', {
  token, body: JSON.stringify({ type: 'legal', details: { q: 'probe' } }),
});
check('POST /service-requests {type:legal} → 201 unpriced', free.status === 201
  && free.json?.amount == null && free.json?.status === 'new',
  `${free.status} amount=${JSON.stringify(free.json?.amount)} status=${JSON.stringify(free.json?.status)}`);

// ------------------------------------------------- ops queue hides the unpaid one
const queue = await call('GET', '/ops/service-requests', { token });
if (queue.status === 403 || queue.status === 401) {
  console.log('SKIP  ops queue — this account is not staff');
} else {
  const qrows = queue.json?.content ?? (Array.isArray(queue.json) ? queue.json : []);
  check('ops queue does NOT contain the unpaid request',
    !qrows.some((r) => r.id === sr.id), `${qrows.length} row(s)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
