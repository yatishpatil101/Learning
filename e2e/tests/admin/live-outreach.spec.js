import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/*
   Owner outreach against the real API.

   There is no mock counterpart to port. The backend for this feature was built in full - the
   `message_template` table, the `outbound_message` ledger, `POST/GET /properties/{id}/outreach`,
   the audit hook - and the console never called any of it. It composed the WhatsApp text in the
   browser, opened wa.me itself, and bumped a counter in localStorage. So this file is not a
   translation of an existing spec; it is the first test of an endpoint that was already there.

   Everything here is asserted at the route rather than through the console. The console half now
   exists too, in live-outreach-console.spec.js: the review modal's WhatsApp panel fetches the
   template library and its preview is compared byte-for-byte against the body the server puts in
   the ledger. They are kept apart because they fail for different reasons, and a red run should say
   which half broke - a 400 from the server and a preview rendering the wrong name are not the same
   news.

   The concierge path now has a fixture - four seeded listings carry `posted_by_admin = true`, so
   the chase button on the moderation card is reachable and the counted half of the reminder count
   is covered in live-concierge-funnel.spec.js. This file keeps the *owner-posted* half, and the
   listing it uses is deliberately not one of the four.

   One thing is asserted that reads like a bug, because it is, and pinning it is the point: a chase
   on an owner-posted listing never reaches the count that would display it. It has a comment saying
   so at the assertion. There used to be a second -- `wa-pricing` could not render its own body --
   and that one has been fixed rather than pinned: the template now interpolates the locality's
   published rate.

   Counts grow: every run appends to the ledger for the fixture listing, so nothing here asserts an
   absolute total. The one count that matters is measured as a delta across the call that causes it.

   Fixtures: docs/system/fixture-registry.md -> the owner row (Meera Deshpande, 9470744469).
*/

/** p5002 - owned by ACTORS.owner, who has a mobile, which is all outreach requires. */
const LISTING = '51897b51-f1a2-56ce-9687-2be847ff4dee';

/** The owner's mobile, as seeded. The handoff link is built from it, so the spec needs the digits. */
const OWNER_MOBILE = '9470744469';

/** Seeded by V78. "Just checking in" - the least loaded of the ten to send repeatedly in a test. */
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
  /* The single most important assertion in this file. Nothing in this system sends a WhatsApp
     message: it composes one and hands a link to the staff member, who sends it from their own
     account. `status` is `prepared` on every row the ledger will ever hold, and every surface that
     renders it has to say "written", never "sent". A spec that let `status` drift would let the
     console start lying about what it did on someone's behalf. */
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

  /* The handoff is a click-to-chat URL carrying the composed text, so what the staff member sends
     is what the server wrote. The country code is prefixed server-side; the console used to build
     this string itself, which is how the preview and the message could disagree.

     Read back through URLSearchParams rather than decodeURIComponent: the query is form-encoded, so
     every space in the body is a `+`, and decodeURIComponent leaves `+` alone. Comparing the raw
     decode against the body fails on a message that is otherwise byte-for-byte correct -- and worse,
     it would keep failing for a reason that has nothing to do with what the test is guarding. */
  expect(prepared.handoffLink).toContain(`https://wa.me/91${OWNER_MOBILE}`);
  expect(new URL(prepared.handoffLink).searchParams.get('text')).toBe(prepared.body);
});

test('the pricing chaser quotes the locality rate the buyers are already shown', async () => {
  /* This test replaces one that was written to be deleted, and this is the deletion.

     It read: "`wa-pricing` reads 'Avg rate: {market_rate}/sqft' and the server does not supply
     `market_rate` ... When it gains a real rate, or is retired with `active = false`, this test
     should fail and be deleted." The rate was there the whole time -- `localities.rate_per_sqft`,
     the figure `GET /localities/{slug}` publishes to buyers -- and OwnerOutreachService now reads
     it. So the omission the old test pinned is gone, and pinning it any longer would be asserting
     that a fixed bug is still broken.

     The mock's value was the string "9,500" for every locality in Pune. That is the thing that was
     wrong: not that a number was quoted, but that it was invented. Quoting the owner the same
     number their buyers see is the only version of this sentence that is neither invented nor
     secret.

     LISTING sits in Kothrud, whose seeded rate is 11200. Hard-coded rather than read back from
     `/localities/kothrud` and compared: a test that derives both sides of its own assertion passes
     when the server returns nothing at all. */
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
  /* `wa-live`, `wa-stale` and `wa-dormant` wrote the URL out by hand as
     `draazy.com/property/{listing_id}`. Nothing failed and nothing looked wrong: the message
     rendered, the handoff link opened, and the sentence read correctly -- while every chaser sent
     from a staging box asked an owner to confirm availability on *production*, against a listing id
     that only exists here. The owner taps it, gets a 404 or somebody else's flat, and what the
     platform has just told them is that their listing is gone.

     The templates now interpolate `{listing_link}`, which the server builds from the same
     configured base URL as `claim_link`. Asserted against `BASE_URL` rather than a literal, so the
     test is about the wiring and not a second copy of it -- and paired with the negative, because a
     template that reverted to the hard-coded host would still contain a perfectly plausible link,
     so "contains a URL" proves nothing. All three are checked: this was one bug written out three
     times, and fixing two of three is the failure mode worth guarding. */
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
  /* The sharpest edge in this feature, pinned rather than fixed.

     `POST /properties/{id}/outreach` does not require the listing to be staff-posted - it needs an
     owner with a mobile and nothing more. But the count that surfaces on the property response is
     narrowed to `posted_by_admin` listings before it is asked for, for a stated and reasonable
     cause: the mapper renders it only for those. The two rules are individually sound and disagree
     at the edge, so on an owner-posted listing the write succeeds, the audit fires, the ledger
     grows - and `adminPipeline.reminderCount` stays 0.

     Any surface that wants to show "chased N times" on a listing like this one must read the
     ledger, not the count. That is the whole reason this test exists. */
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

  /* Not an endorsement, and no longer waiting on a fixture: p5002 is owner-posted on purpose, so
     that this disagreement stays pinned. live-concierge-funnel.spec.js asserts the other side -
     that a chaser on a staff-posted listing *is* counted - and the pair is what distinguishes a
     count that filters correctly from one that is simply broken. */
  expect(row.adminPipeline?.postedByAdmin ?? false).toBe(false);
  expect(row.adminPipeline?.reminderCount ?? 0).toBe(0);
});

test('an owner cannot chase themselves, and the refusal comes from the server', async () => {
  /* The console still renders a "confirm availability" control on the consumer dashboard
     (MyListingsPanel) that calls this route. Against the mock it worked, because the mock asked
     nobody. Live it is a 403, and it should be: outreach writes a message attributed to a staff
     member, so an owner triggering one would be putting words in an employee's mouth.

     Pinned as server behaviour so that whichever way the console is fixed - widening the guard or
     removing the control - it is a decision someone makes, not a 403 a user finds. */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: GENTLE },
    await authHeaders(OWNER_MOBILE),
  );
  expect(res.status).toBe(403);
});

test('reading the outreach history needs less permission than writing to it', async ({ login }) => {
  /* The asymmetry is deliberate: the write is gated on `postOnBehalf:write` and the read on the
     much wider `properties:read`, so anyone who can work the moderation queue can see what was
     already said to an owner without being able to say anything more. Asserted with one account
     holding exactly one of the two atoms, which is the only way to tell an intentional asymmetry
     from an inconsistent one. */
  const { mobile } = await login.scopeStaff('rental', ['properties:read']);
  const headers = await authHeaders(mobile);

  const read = await fetch(`${API}/properties/${LISTING}/outreach`, { headers });
  expect(read.status).toBe(200);

  const write = await post(`/properties/${LISTING}/outreach`, { templateId: GENTLE }, headers);
  expect(write.status).toBe(403);
});

test('an unknown template is refused rather than sent as an empty message', async () => {
  /* A template id reaches this route from a select the staff member did not type into, so a miss
     means the library and the caller have drifted. Refusing stops that at the seam; composing a
     message from a missing body would put an empty WhatsApp in front of an owner.

     400 rather than 404, and deliberately so: the addressed resource is the listing's outreach
     collection, which does exist -- it is the body that names something unusable. The same branch
     also refuses a template that exists but has been retired (`active = false`), and that is not a
     missing resource under any reading, so one status has to cover both. */
  const res = await post(
    `/properties/${LISTING}/outreach`,
    { templateId: 'wa-does-not-exist' },
    await authHeaders('9000000000'),
  );
  expect(res.status).toBe(400);
});
