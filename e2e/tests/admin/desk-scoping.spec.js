/** Two back-office scoping rules, read over the wire. Rule-level proof lives in ReviewModerationQueueTest and
 * TicketQueueTest. */
import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const get = async (path, mobile) => fetch(`${API}${path}`, { headers: await authHeaders(mobile) });

test('a manager reads the reviews queue; a customer does not', async () => {
  const asManager = await get('/admin/reviews?size=1', ACTORS.manager);
  expect(asManager.status).toBe(200);
  expect(Array.isArray((await asManager.json()).content)).toBe(true);

  expect((await get('/admin/reviews?size=1', ACTORS.buyer)).status).toBe(403);
});

test('a customer ticket with no team is on every desk until a team filter narrows it away', async () => {
  const subject = `E2E teamless ${Date.now()}`;
  const created = await fetch(`${API}/tickets`, {
    method: 'POST',
    headers: await authHeaders(ACTORS.buyer),
    body: JSON.stringify({ subject, body: 'Raised with no desk chosen.' }),
  });
  expect(created.status).toBe(201);
  const { id } = await created.json();

  try {
    for (const desk of [STAFF.rental, STAFF.legal]) {
      const board = await (await get(`/tickets?q=${encodeURIComponent(subject)}&size=5`, desk)).json();
      expect(board.content.map((t) => t.id), 'a team-less ticket is on every desk').toContain(id);
    }
    const narrowed = await (await get(`/tickets?team=rental&q=${encodeURIComponent(subject)}&size=5`, STAFF.rental)).json();
    expect(narrowed.content.map((t) => t.id), 'asking for one desk is not asking for the unassigned').not.toContain(id);
  } finally {
    await fetch(`${API}/tickets/${id}`, {
      method: 'PATCH',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ status: 'closed' }),
    });
  }
});
