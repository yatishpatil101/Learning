import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

// The ledger is append-only, so reminder assertions use deltas, not absolute counts.
const CONCIERGE = {
  contacted: { id: 'd87532db-4b22-5356-8795-b48e8dbb0c98', title: '3 BHK Studio in Aundh', step: 'created' },
  info_collected: { id: 'd92efc2e-a501-589d-b6ea-6d3173c5c59d', title: '2 BHK Studio in Magarpatta', step: 'created' },
  listed: { id: '42ba0880-ee4f-5a78-9a8d-e70200409791', title: '1 BHK Flat in Kharadi', step: 'created' },
  docs_submitted: { id: '9fd5a65b-0607-50e4-8f1c-3d1de0090017', title: '1 BHK Plot in Viman Nagar', ownerMobile: '9108512606', step: 'created' },
  photos_uploaded: { id: '7847ad81-cc55-5db2-bacb-67d085e3ef4e', title: '2 BHK Row House in Kothrud', step: 'created' },
  claim_sent: { id: '11d1c69c-2e33-55a8-ac83-af36deb1b31c', title: '4 BHK Penthouse in Undri', ownerMobile: '9592138848', step: 'link_sent' },
};

const GENTLE = 'wa-gentle';

const ADMIN_ID = 'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b';

const admin = () => authHeaders('9000000000');

const adminProperties = async (headers) =>
  (await (await fetch(`${API}/admin/properties?size=100`, { headers })).json()).content || [];

test('a staff-posted listing sits on the staff track at the step its events reached', async () => {
  // Persisting the name would let profile edits rewrite old listing attribution.
  const rows = await adminProperties(await admin());

  for (const fixture of Object.values(CONCIERGE)) {
    const row = rows.find((p) => p.id === fixture.id);
    expect(row, `"${fixture.title}" should be in the moderation queue`).toBeTruthy();
    expect(row.adminPipeline?.postedByAdmin).toBe(true);
    expect(row.progress, `"${fixture.title}" progress`).toMatchObject({ track: 'staff', step: fixture.step });
    expect(Object.hasOwn(row.adminPipeline, 'pipelineStage')).toBe(false);
    expect(Object.hasOwn(row, 'lifecycleStage')).toBe(false);
  }

  const listed = rows.find((p) => p.id === CONCIERGE.listed.id);
  expect(listed.adminPipeline.postedByStaff).toBe(ADMIN_ID);
  expect(listed.adminPipeline.postedByStaff).toMatch(/^[0-9a-f-]{36}$/i);
});

test('the funnel is not shown to the owner it is about', async () => {
  // Absence rather than emptiness, because `"adminPipeline": {}` would leak the same fact.
  const target = CONCIERGE.claim_sent;
  const res = await fetch(`${API}/me/listings/${target.id}`, {
    headers: await authHeaders(target.ownerMobile),
  });
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.title).toBe(target.title);
  expect(Object.hasOwn(body, 'adminPipeline')).toBe(false);
  expect(body.progress).toMatchObject({ track: 'staff', step: 'link_sent' });
  expect(body.progress.flags.every((f) => ['needs_info', 'rejected'].includes(f))).toBe(true);
});

test('a chaser on a concierge listing is counted', async () => {
  // `countsFor` narrows to `posted_by_admin` listings, so this proves the counted path works at all.
  const headers = await admin();
  const target = CONCIERGE.docs_submitted;

  const before = (await adminProperties(headers)).find((p) => p.id === target.id);
  const countBefore = before.adminPipeline.reminderCount;

  const res = await fetch(`${API}/properties/${target.id}/outreach`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ templateId: GENTLE }),
  });
  expect(res.status).toBe(200);

  const prepared = await res.json();
  expect(prepared.status).toBe('prepared');
  // The owner's name reached the copy, which is the only proof the row is about this listing.
  expect(prepared.body).toContain('Tanvi');

  const after = (await adminProperties(headers)).find((p) => p.id === target.id);
  expect(after.adminPipeline.reminderCount).toBe(countBefore + 1);
});
