import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/*
   The concierge funnel: listings staff created, and the owner hand-back that follows.

   Four of the 38 seeded listings now carry `posted_by_admin = true`. They did not before, and the
   absence was load-bearing in a way that is worth writing down: three separate features - the
   moderation card's chase button, the dashboard's "awaiting owner" queue, and the reminder count on
   the property response - are all gated on that flag, so with no row setting it, none of the three
   could be reached from a screen or asserted in a test. The gap was recorded in tasks/todo.md as
   the blocker for the whole cluster. This file is what it was blocking.

   ## Why one listing per stage

   `pipeline_stage` is the only fact stored. The three booleans the board draws - claim sent, photos
   uploaded, Aadhaar verified - are *derived* from it by `PipelineStage.reached`, which asks whether
   the listing has passed a milestone in the six-stage order. So there is no such thing as a listing
   with photos but no documents, and seeding one would be seeding a state the application cannot
   represent. Four listings at four stages is the smallest fixture that exercises all four
   combinations of the derived booleans, and the test reads them back as a table for exactly that
   reason: it is checking the derivation, not four independent values.

   This is also where the fixture deliberately diverges from the mock it replaces. The mock's
   `seedConciergeDemo` stored the booleans alongside the stage and set combinations the server
   cannot hold - PRC004 sat at `listed` with photos *and* Aadhaar both true. Reproducing that here
   would mean asserting against data the constraint would reject.

   ## What this file does not cover, and why not

   The console's pipeline controls write stages this server cannot store. `PIPELINE_STAGES` in
   frontend/src/pages/admin/properties/constants.js offers contacted / info_collected / listed /
   docs_submitted / under_review / live; the server's `properties_pipeline_stage_check` allows
   listed / docs_submitted / photos_uploaded / aadhaar_verified / claim_sent / claimed. They agree
   on two values out of six, and they disagree because they are two different funnels wearing one
   column name: the console's tracks how staff acquired the listing, the server's tracks what has
   come back from the owner. Both are reasonable; only one can own the column. That is a product
   decision, not a defect to quietly resolve in a test, so it is written up in tasks/todo.md and
   nothing here asserts a stage transition.

   Counts grow: the ledger is append-only and every run adds to it, so the reminder count is
   measured as a delta across the call that causes it, never as an absolute.

   Fixtures: docs/system/fixture-registry.md -> the concierge row.
*/

/**
 * The four concierge listings, keyed by the stage each one sits at.
 *
 * Named rather than discovered. A test that took "whichever listing is posted_by_admin" would pass
 * today and start asserting something else the moment a fifth is seeded - and the whole point of
 * the set is that each member is at a different stage.
 */
const CONCIERGE = {
  listed: { id: '42ba0880-ee4f-5a78-9a8d-e70200409791', slug: 'p5030', title: '1 BHK Flat in Kharadi' },
  docs_submitted: {
    id: '9fd5a65b-0607-50e4-8f1c-3d1de0090017',
    slug: 'p5028',
    title: '1 BHK Plot in Viman Nagar',
    ownerMobile: '9108512606',
  },
  photos_uploaded: {
    id: '7847ad81-cc55-5db2-bacb-67d085e3ef4e',
    slug: 'p5024',
    title: '2 BHK Row House in Kothrud',
  },
  claim_sent: {
    id: '11d1c69c-2e33-55a8-ac83-af36deb1b31c',
    slug: 'p5037',
    title: '4 BHK Penthouse in Undri',
    ownerMobile: '9592138848',
  },
};

/** Seeded Admin. The funnel records the staff member's id, not their name - asserted below. */
const ADMIN_ID = 'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b';

const GENTLE = 'wa-gentle';

const admin = () => authHeaders('9000000000');

const adminProperties = async (headers) =>
  (await (await fetch(`${API}/admin/properties?size=100`, { headers })).json()).content || [];

test('the funnel booleans are derived from the stage, not stored beside it', async () => {
  const rows = await adminProperties(await admin());

  /* Expected value per stage, written out rather than computed. Computing it here would mean
     reimplementing PipelineStage.reached in the test, which would then agree with itself while both
     copies were wrong. The table is the specification. */
  const expected = {
    listed: { claimLinkSent: false, photosUploaded: false, aadhaarVerified: false },
    docs_submitted: { claimLinkSent: false, photosUploaded: false, aadhaarVerified: false },
    photos_uploaded: { claimLinkSent: false, photosUploaded: true, aadhaarVerified: false },
    claim_sent: { claimLinkSent: true, photosUploaded: true, aadhaarVerified: true },
  };

  for (const [stage, fixture] of Object.entries(CONCIERGE)) {
    const row = rows.find((p) => p.id === fixture.id);
    expect(row, `"${fixture.title}" should be in the moderation queue`).toBeTruthy();

    const pipeline = row.adminPipeline;
    expect(pipeline, `"${fixture.title}" is staff-posted, so staff should see its funnel`).toBeTruthy();
    expect(pipeline.postedByAdmin).toBe(true);
    expect(pipeline.pipelineStage).toBe(stage);

    expect(
      {
        claimLinkSent: pipeline.claimLinkSent,
        photosUploaded: pipeline.photosUploaded,
        aadhaarVerified: pipeline.aadhaarVerified,
      },
      `the funnel booleans for "${fixture.title}" at stage "${stage}"`,
    ).toEqual(expected[stage]);
  }
});

test('the funnel names the staff member by id, not by display name', async () => {
  /* Deliberate, and the kind of thing that gets "helpfully" changed. Storing the name would mean a
     colleague editing their profile silently rewrites who posted a listing two years ago. Any
     surface that wants to show a name has to resolve one, the same way the outreach ledger's
     `preparedBy` does. Asserted so that starting to return a name is a decision someone makes on
     purpose. */
  const rows = await adminProperties(await admin());
  const row = rows.find((p) => p.id === CONCIERGE.listed.id);

  expect(row.adminPipeline.postedByStaff).toBe(ADMIN_ID);
  expect(row.adminPipeline.postedByStaff).toMatch(/^[0-9a-f-]{36}$/i);
});

test('the funnel is not shown to the owner it is about', async () => {
  /* The trust boundary this DTO exists to hold, tested against the audience it most matters for.

     `adminPipeline` says the platform manufactured this listing rather than the owner posting it,
     and names the staff member chasing them. The owner is signed in, is looking at their own
     listing, and is exactly who must not read the desk's notes on how the chase is going. The
     mapper returns null for every audience but staff and NON_NULL drops the key, so the assertion
     is absence rather than emptiness - `"adminPipeline": {}` would leak the same fact.

     Not tested anonymously, and not through `GET /properties/{id}`: these listings are `pending`,
     and that route serves only published ones - to the owner as much as to anybody, which is why
     owners read their own drafts through `/me/listings/{id}` instead. A 404 there would prove the
     status filter works rather than that the projection does. */
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
  /* The other half of live-outreach.spec.js's "written but never counted".

     `OwnerOutreachService.countsFor` narrows to `posted_by_admin` listings before counting, so on
     an owner-posted listing a chaser is written, audited, and never surfaces in
     `adminPipeline.reminderCount`. That test pins the disagreement; this one proves the counted
     path works at all - without a concierge fixture there was no way to tell a count that filters
     correctly from a count that is simply broken.

     Measured as a delta. The ledger is append-only and every run of this suite adds a row. */
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
