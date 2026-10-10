import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/* One open unpaid order per user (subscriptions) or per user and type (service requests).
   The mock gateway never settles, so the first order stays open for the whole test. */

async function freshToken() {
  return (await apiLogin(uniqueMobile(), { api: API })).accessToken;
}

function post(token, path, body) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const rentAgreement = () => ({
  type: 'rent-agreement',
  details: { ownerName: 'Anita Verma', property: 'B-1204, Skyline Heights', rent: '30000', deposit: '150000', _state: { prop: { gramPanchayat: false } } },
});

async function paidPlanIds() {
  const { plans } = await (await fetch(`${API}/bootstrap`)).json();
  return plans.filter((p) => p.price > 0).map((p) => p.id);
}

test('a second subscription order is refused while the first is unpaid, and the message says so', async () => {
  const token = await freshToken();
  const [first, second] = await paidPlanIds();
  expect(second, 'the catalogue needs two paid plans').toBeTruthy();

  const opened = await post(token, '/me/subscription', { planId: first });
  expect(opened.status, await opened.clone().text()).toBe(201);
  expect((await opened.json()).status).toBe('pending');

  const refused = await post(token, '/me/subscription', { planId: second });
  expect(refused.status).toBe(409);
  expect((await refused.json()).message).toMatch(/already have a subscription order waiting for payment/i);
});

test('two simultaneous subscription orders open exactly one', async () => {
  const token = await freshToken();
  const [plan] = await paidPlanIds();

  const results = await Promise.all([post(token, '/me/subscription', { planId: plan }), post(token, '/me/subscription', { planId: plan })]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
});

test('two simultaneous requests for the same priced desk open exactly one', async () => {
  const token = await freshToken();

  const results = await Promise.all([post(token, '/service-requests', rentAgreement()), post(token, '/service-requests', rentAgreement())]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const refused = results.find((r) => r.status === 409);
  expect((await refused.json()).message).toMatch(/already have an unpaid rent-agreement request/i);
});

test('the cap is per user: another account can open its own order at the same time', async () => {
  const [plan] = await paidPlanIds();
  const [a, b] = [await freshToken(), await freshToken()];

  expect((await post(a, '/me/subscription', { planId: plan })).status).toBe(201);
  expect((await post(b, '/me/subscription', { planId: plan })).status).toBe(201);
});
