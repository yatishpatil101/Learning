// @ts-check
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const PSQL = process.env.PSQL || 'C:\\Program Files\\PostgreSQL\\13\\bin\\psql.exe';
const OWNER = 'Asha Patil';
const TENANT = 'Ria Sharma';

const json = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function ok(method, path, token, body) {
  const res = await fetch(`${API}${path}`, { method, headers: json(token), body: body && JSON.stringify(body) });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function purge(requestId) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new Error(`not a request id: ${requestId}`);
  execFileSync(
    PSQL,
    ['-U', process.env.E2E_DB_USER || 'postgres', '-d', process.env.E2E_DB_NAME || 'draazy_e2e', '-At',
      '-c', `update service_request_identities set pan = null, aadhaar = null, purged_at = now() where service_request_id = '${requestId}';`
        + ` insert into service_request_timeline (request_id, event) values ('${requestId}', 'identities.purged')`],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' } },
  );
}

test.describe('Identity numbers after a retention purge (D282)', () => {
  test('the tracker asks the requester again, and stops once they are recorded', async ({ page }) => {
    const mobile = uniqueMobile();
    const { accessToken: customer } = await apiLogin(mobile);
    const request = await ok('POST', '/service-requests', customer, {
      type: 'rent-agreement',
      details: { ownerName: OWNER, _state: { owner: { oName: OWNER }, tenants: [{ name: TENANT }] } },
    });
    await ok('PUT', `/service-requests/${request.id}/identities`, customer, {
      parties: [{ partyRole: 'owner', partyIndex: 0, partyName: OWNER, aadhaar: '211122223335' }],
    });
    purge(request.id);

    await signedInAs(page, mobile);
    await page.goto(`${BASE}/services/rent-agreement`, { waitUntil: 'networkidle' });
    const panel = page.getByTestId('identity-refill');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText(OWNER);
    await expect(panel).toContainText(TENANT);

    await panel.getByLabel(`Aadhaar of ${OWNER}`).fill('2111 2222 3335');
    await panel.getByLabel(`PAN of ${TENANT}`).fill('abcde1234f');
    await panel.getByRole('button', { name: 'Save numbers' }).click();
    await expect(panel).toBeHidden({ timeout: 15000 });

    const back = await ok('GET', `/service-requests/${request.id}`, customer);
    const identityEvents = back.timeline.map((t) => t.event).filter((e) => e.startsWith('identities.'));
    expect(identityEvents).toEqual(['identities.purged', 'identities.recorded']);
  });
});
