import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/* Owner outreach asserted at the route; the console half lives in `outreach-console.spec.js`, kept
   apart so a red run says which of the two broke. Counts grow, so the one count that matters is
   measured as a delta across the call that causes it. Fixtures: docs/system/fixture-registry.md. */

/** p5002 - owned by ACTORS.owner, who has a mobile, which is all outreach requires. */
const LISTING = '51897b51-f1a2-56ce-9687-2be847ff4dee';

/** The owner's mobile, as seeded. */
const OWNER_MOBILE = '9470744469';

/** Seeded template. "Just checking in" - the least loaded of the ten to send repeatedly in a test. */
const GENTLE = 'wa-gentle';

const post = (path, body, headers) =>
  fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('the ledger records the chaser, and the read is deliberately wider than the write', async () => {
  const adminHeaders = await authHeaders('9000000000');

  const before = await fetch(`${API}/properties/${LISTING}/outreach`, { headers: adminHeaders });
  expect(before.status).toBe(200);
  const beforeRows = await before.json();

  const res = await post(`/properties/${LISTING}/outreach`, { templateId: GENTLE }, adminHeaders);
  expect(res.status).toBe(200);
  const prepared = await res.json();

  const after = await fetch(`${API}/properties/${LISTING}/outreach`, { headers: adminHeaders });
  const afterRows = await after.json();

  // Measured as a delta. Earlier runs left rows behind and an absolute count would rot immediately.
  expect(afterRows.length).toBe(beforeRows.length + 1);

  // Newest first, so the console can render the log without sorting it back.
  expect(afterRows[0].id).toBe(prepared.id);
  expect(afterRows[0].templateId).toBe(GENTLE);
  expect(afterRows[0].channel).toBe('whatsapp');
  expect(afterRows[0].status).toBe('prepared');

  /* `preparedBy` is the staff member's id, not their name. Nothing renders it as-is for that
     reason; a surface that wants a name has to resolve one. Asserted so a later change that starts
     returning a display name is a deliberate decision rather than a quiet one. */
  expect(afterRows[0].preparedBy).toMatch(/^[0-9a-f-]{36}$/i);
});

test('a chaser on an owner-posted listing is written but never counted', async () => {
  /* Pinned rather than fixed: the write needs only an owner with a mobile, but the count surfaced on
     the property response is narrowed to `posted_by_admin` first, so on an owner-posted listing the
     ledger grows while `adminPipeline.reminderCount` stays 0. Show "chased N times" from the
     ledger, never from the count. */
  const adminHeaders = await authHeaders('9000000000');

  await post(`/properties/${LISTING}/outreach`, { templateId: GENTLE }, adminHeaders);

  const ledger = await (
    await fetch(`${API}/properties/${LISTING}/outreach`, { headers: adminHeaders })
  ).json();
  expect(ledger.length).toBeGreaterThan(0);

  const property = await (
    await fetch(`${API}/admin/properties?size=100`, { headers: adminHeaders })
  ).json();
  const row = (property.content || []).find((p) => p.id === LISTING);
  expect(row, 'the fixture listing should be in the moderation queue').toBeTruthy();

  /* p5002 is owner-posted on purpose, so this disagreement stays pinned; concierge-funnel.spec.js
     asserts the counted side, and the pair distinguishes a filtering count from a broken one. */
  expect(row.adminPipeline?.postedByAdmin ?? false).toBe(false);
  expect(row.adminPipeline?.reminderCount ?? 0).toBe(0);
});

test('an owner cannot chase themselves, and the refusal comes from the server', async () => {
  /* `MyListingsPanel` still renders a "confirm availability" control that calls this route, and live
     it is a 403 — rightly, since outreach attributes a message to a staff member. Pinned as server
     behaviour so the console fix is a decision someone makes, not a 403 a user finds. */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: GENTLE },
    await authHeaders(OWNER_MOBILE),
  );
  expect(res.status).toBe(403);
});

test('reading the outreach history needs less permission than writing to it', async ({ login }) => {
  /* The asymmetry is deliberate: the write is gated on `postOnBehalf:write`, the read on the wider
     `properties:read`. Asserted with one account holding exactly one atom, which is the only way to
     tell an intentional asymmetry from an inconsistent one. */
  const { mobile } = await login.scopeStaff('rental', ['properties:read']);
  const headers = await authHeaders(mobile);

  const read = await fetch(`${API}/properties/${LISTING}/outreach`, { headers });
  expect(read.status).toBe(200);

  const write = await post(`/properties/${LISTING}/outreach`, { templateId: GENTLE }, headers);
  expect(write.status).toBe(403);
});
