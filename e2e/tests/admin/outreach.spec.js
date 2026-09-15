import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/* Owner outreach asserted at the route; the console half lives in `outreach-console.spec.js`, kept
   apart so a red run says which of the two broke. Counts grow, so the one count that matters is
   measured as a delta across the call that causes it. Fixtures: docs/system/fixture-registry.md. */

/** p5002 - owned by ACTORS.owner, who has a mobile, which is all outreach requires. */
const LISTING = '51897b51-f1a2-56ce-9687-2be847ff4dee';

/** The owner's mobile, as seeded. The handoff link is built from it, so the spec needs the digits. */
const OWNER_MOBILE = '9470744469';

/** Seeded template. "Just checking in" - the least loaded of the ten to send repeatedly in a test. */
const GENTLE = 'wa-gentle';

/**
 * Where the backend under test thinks it lives, pinned by `application-e2e.properties`. Read from
 * the env with the same fallback the Playwright config uses, so overriding one overrides both.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

const post = (path, body, headers) =>
  fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('the template library is copy the server owns, not strings in the bundle', async () => {
  /* The console shipped its own ten `DEFAULT_WA_TEMPLATES`. Migration V78 seeds ten rows whose ids
     match them exactly, which is why the rewire can keep every template id it already passes.
     Asserted as a floor rather than an equality: adding an eleventh template is a copy change and
     should not fail a test. */
  const res = await fetch(`${API}/admin/message-templates?channel=whatsapp`, {
    headers: await authHeaders('9000000000'),
  });
  expect(res.status).toBe(200);

  const templates = await res.json();
  expect(templates.length).toBeGreaterThanOrEqual(10);

  const gentle = templates.find((t) => t.id === GENTLE);
  expect(gentle).toBeTruthy();
  expect(gentle.channel).toBe('whatsapp');
  expect(gentle.name).toBeTruthy();
  // The body is the thing being served. If it arrives empty the endpoint is answering with a shape.
  expect(gentle.body).toContain('{owner_name}');

  // The filter is real, not decoration: asking for one channel must not return another's copy.
  expect(templates.every((t) => t.channel === 'whatsapp')).toBe(true);
});

test('a chaser is prepared for a human to send, and says so', async () => {
  /* Nothing in this system sends a WhatsApp message: it composes one and hands a link to the staff
     member. `status` is `prepared` on every row the ledger will hold, so every surface that renders
     it must say "written", never "sent". */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: GENTLE },
    await authHeaders('9000000000'),
  );
  expect(res.status).toBe(200);

  const prepared = await res.json();
  expect(prepared.status).toBe('prepared');
  expect(prepared.id).toBeTruthy();

  // Interpolated server-side. The owner's name is present and the placeholder is gone.
  expect(prepared.body).toContain('Meera');
  expect(prepared.body).not.toContain('{owner_name}');
  expect(prepared.body).not.toContain('{title}');

  /* Read back through URLSearchParams rather than decodeURIComponent: the query is form-encoded, so
     every space is a `+`, and a raw decode fails on a byte-for-byte correct message. */
  expect(prepared.handoffLink).toContain(`https://wa.me/91${OWNER_MOBILE}`);
  expect(new URL(prepared.handoffLink).searchParams.get('text')).toBe(prepared.body);
});

test('the pricing chaser quotes the locality rate the buyers are already shown', async () => {
  /* Quoting the owner the same rate their buyers see is the only version of this sentence that is
     neither invented nor secret. LISTING sits in Kothrud, whose seeded rate is 11200 — hard-coded,
     because a test that derives both sides of its assertion passes when the server returns nothing. */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: 'wa-pricing' },
    await authHeaders('9000000000'),
  );
  expect(res.status).toBe(200);

  const prepared = await res.json();
  expect(prepared.body).toContain('11200');
  expect(prepared.body).not.toContain('{market_rate}');
  expect(prepared.body).not.toContain('{owner_name}');
});

test('the link an owner is asked to tap belongs to the box that sent it', async () => {
  /* A hard-coded `draazy.com` host would ask an owner to confirm availability against a listing id
     that exists only on the box that sent it. Asserted against `BASE_URL`, paired with the negative
     (a reverted template still contains a plausible link), on all three templates. */
  const headers = await authHeaders('9000000000');
  for (const templateId of ['wa-live', 'wa-stale', 'wa-dormant']) {
    const res = await post(`/properties/${LISTING}/outreach`, { templateId }, headers);
    expect(res.status).toBe(200);

    const { body } = await res.json();
    expect(body).toContain(`${BASE_URL}/property/${LISTING}`);
    expect(body).not.toContain('draazy.com');
    expect(body).not.toContain('{listing_link}');
  }
});

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

test('an unknown template is refused rather than sent as an empty message', async () => {
  /* 400 rather than 404: the addressed resource is the listing's outreach collection, which exists —
     it is the body that names something unusable. The same branch refuses a retired template
     (`active = false`), which is not a missing resource either, so one status covers both. */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: 'wa-does-not-exist' },
    await authHeaders('9000000000'),
  );
  expect(res.status).toBe(400);
});
