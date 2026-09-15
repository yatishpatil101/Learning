import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/*
   Counts grow: the ledger is append-only and every run adds to it, so the reminder count is
   measured as a delta across the call that causes it, never as an absolute.
*/

/**
 * Named rather than discovered: taking "whichever listing is posted_by_admin" would start asserting
 * something else the moment a fifth is seeded, and the point is one member per funnel point.
 */
const CONCIERGE = {
  listed: {
    id: '42ba0880-ee4f-5a78-9a8d-e70200409791',
    slug: 'p5030',
    title: '1 BHK Flat in Kharadi',
    stage: 'listed',
    milestone: null,
  },
  docs_submitted: {
    id: '9fd5a65b-0607-50e4-8f1c-3d1de0090017',
    slug: 'p5028',
    title: '1 BHK Plot in Viman Nagar',
    ownerMobile: '9108512606',
    stage: 'docs_submitted',
    milestone: null,
  },
  photos_uploaded: {
    id: '7847ad81-cc55-5db2-bacb-67d085e3ef4e',
    slug: 'p5024',
    title: '2 BHK Row House in Kothrud',
    stage: 'docs_submitted',
    milestone: 'photos_uploaded',
  },
  claim_sent: {
    id: '11d1c69c-2e33-55a8-ac83-af36deb1b31c',
    slug: 'p5037',
    title: '4 BHK Penthouse in Undri',
    ownerMobile: '9592138848',
    stage: 'docs_submitted',
    milestone: 'claim_sent',
  },
};

/** Seeded Admin. The funnel records the staff member's id, not their name - asserted below. */
const ADMIN_ID = 'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b';

const GENTLE = 'wa-gentle';

const admin = () => authHeaders('9000000000');

const adminProperties = async (headers) =>
  (await (await fetch(`${API}/admin/properties?size=100`, { headers })).json()).content || [];

test('the funnel booleans are derived from the milestone, not stored beside it', async () => {
  const rows = await adminProperties(await admin());

  /* Written out rather than computed: reimplementing PipelineStage.reached here would let the test
     agree with itself while both copies were wrong. The table is the specification. */
  const expected = {
    listed: { claimLinkSent: false, photosUploaded: false, identityVerified: false },
    docs_submitted: { claimLinkSent: false, photosUploaded: false, identityVerified: false },
    photos_uploaded: { claimLinkSent: false, photosUploaded: true, identityVerified: false },
    claim_sent: { claimLinkSent: true, photosUploaded: true, identityVerified: true },
  };

  for (const [key, fixture] of Object.entries(CONCIERGE)) {
    const row = rows.find((p) => p.id === fixture.id);
    expect(row, `"${fixture.title}" should be in the moderation queue`).toBeTruthy();

    const pipeline = row.adminPipeline;
    expect(pipeline, `"${fixture.title}" is staff-posted, so staff should see its funnel`).toBeTruthy();
    expect(pipeline.postedByAdmin).toBe(true);
    expect(pipeline.pipelineStage).toBe(fixture.stage);
    expect(pipeline.handbackMilestone ?? null,
      `"${fixture.title}" carries its hand-back on the second axis`).toBe(fixture.milestone);

    expect(
      {
        claimLinkSent: pipeline.claimLinkSent,
        photosUploaded: pipeline.photosUploaded,
        identityVerified: pipeline.identityVerified,
      },
      `the funnel booleans for "${fixture.title}" at "${key}"`,
    ).toEqual(expected[key]);
  }
});

test('the funnel names the staff member by id, not by display name', async () => {
  /* Storing the name would mean a colleague editing their profile silently rewrites who posted a
     listing two years ago, so returning one has to be a deliberate decision. */
  const rows = await adminProperties(await admin());
  const row = rows.find((p) => p.id === CONCIERGE.listed.id);

  expect(row.adminPipeline.postedByStaff).toBe(ADMIN_ID);
  expect(row.adminPipeline.postedByStaff).toMatch(/^[0-9a-f-]{36}$/i);
});

test('the funnel is not shown to the owner it is about', async () => {
  /* Absence rather than emptiness, because `"adminPipeline": {}` would leak the same fact. Read
     through `/me/listings/{id}` since these listings are `pending` and the public route 404s. */
  const target = CONCIERGE.claim_sent;
  const res = await fetch(`${API}/me/listings/${target.id}`, {
    headers: await authHeaders(target.ownerMobile),
  });
  expect(res.status).toBe(200);

  const body = await res.json();
  expect(body.title).toBe(target.title);
  expect(Object.hasOwn(body, 'adminPipeline')).toBe(false);
});

test('a chaser on a concierge listing is counted', async () => {
  /* `countsFor` narrows to `posted_by_admin` listings, so this proves the counted path works at
     all. Measured as a delta: the ledger is append-only and every run adds a row. */
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
