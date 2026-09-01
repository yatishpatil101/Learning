import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

/*
   Posting a listing on an owner's behalf, against the real API.

   ## The defect this was written for

   The wizard called `addListing`, which is `POST /me/listings`. That route attributes what it
   creates to the **caller**. So against the live API a concierge listing came out owned by the
   staff member who typed it: it appeared in that operator's own dashboard, never in the owner's,
   and there was nothing for the owner to claim. The `postedByAdmin: true` and
   `postedByStaff: <display name>` fields the console packed into the body were discarded, because
   a client does not get to say who owns a record or who acted.

   Nothing caught it. The mock has one flat `owner` string per listing and no accounts, so writing
   the owner's name into the body was all ownership had ever meant, and every mock spec passed.
   Ownership is exactly the kind of fact a mock is worst at, and the reason the assertion below is
   made from the owner's session rather than from the response body.

   ## Why this is an API spec, not a wizard spec

   The wizard is six steps, and driving it would spend most of its time proving that Next buttons
   advance. The bug was never in the form -- every field it collected arrived intact -- it was in
   which route the last button called and what that route does with identity. So this tests the
   route, from both sides of the ownership boundary it got wrong.

   ## Mobiles, not ids

   The operator is on a phone call with somebody who has never signed in, so the number they are
   calling from is the only handle that exists. Each test invents its own via `uniqueMobile()`
   rather than reusing a fixture: these are writes, they provision accounts, and a seeded owner is
   something other specs assert against.

   Fixtures: docs/system/fixture-registry.md -> the concierge row.
*/

const admin = () => authHeaders('9000000000');

/** A body that satisfies `ListingCreate`. Deliberately minimal: nothing here is under test. */
const listing = (title) => ({
  title,
  deal: 'rent',
  propertyType: 'Flat',
  price: 32000,
  locality: 'Kharadi',
  city: 'Pune',
  bhk: 2,
  area: 900,
});

const postOnBehalf = async (headers, body) => {
  const res = await fetch(`${API}/admin/properties`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const myListings = async (mobile) => {
  const res = await fetch(`${API}/me/listings?size=100`, { headers: await authHeaders(mobile) });
  return (await res.json()).content || [];
};

test('the listing belongs to the owner, not the operator who typed it', async () => {
  const ownerMobile = uniqueMobile();
  const title = `On behalf ${Date.now()}`;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Ravi Kulkarni', listing: listing(title),
  });
  expect(created.status).toBe(201);

  /* The assertion the mock could not make. Asked from the owner's own session, so it depends on
     who the server thinks owns the row rather than on what the response chose to echo back. */
  const owners = await myListings(ownerMobile);
  expect(owners.map((l) => l.title)).toContain(title);

  /* And the other half, which is the actual regression: the operator must not end up owning it.
     Before the fix this listing was in the admin's dashboard and absent from the owner's -- the
     exact inverse of both of these lines. */
  const operators = await myListings('9000000000');
  expect(operators.map((l) => l.title)).not.toContain(title);
});

test('the funnel is opened, and it names the staff member by id', async () => {
  const ownerMobile = uniqueMobile();
  const session = await apiLogin('9000000000');

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Ravi Kulkarni', listing: listing(`Funnel ${Date.now()}`),
  });
  expect(created.status).toBe(201);

  /* Only this creation path opens the hand-back funnel -- a listing an owner posted themselves has
     already arrived where the funnel is trying to get to. */
  expect(created.body.adminPipeline?.postedByAdmin).toBe(true);
  expect(created.body.adminPipeline?.pipelineStage).toBe('listed');
  /* And nothing on the other axis. The hand-back has not started — the owner has not been told the
     listing exists yet — so a milestone here would be a claim about somebody who has done nothing. */
  expect(created.body.adminPipeline?.handbackMilestone ?? null).toBeNull();

  /* An id, taken from the caller's token. The console used to send `user?.name`, which would have
     made "who posted this" a value that changes when a colleague edits their profile -- and which
     the server ignored anyway. Compared against the admin's own id rather than a regex, so a
     server that started echoing some *other* id would still fail. */
  expect(created.body.adminPipeline?.postedByStaff).toBe(session.user.id);
});

test('a number that has never signed in gets an account, and can then sign in to it', async () => {
  const ownerMobile = uniqueMobile();
  const title = `Provisioned ${Date.now()}`;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Never Signed In', listing: listing(title),
  });
  expect(created.status).toBe(201);

  /* The claim, end to end: the owner signs in with the number the operator dialled and the listing
     is waiting. `apiLogin` registers an unknown mobile on first verification, so this would pass
     against a provisioned account and a brand-new one alike -- which is why the listing check is
     the assertion and the login is only the setup. */
  const session = await apiLogin(ownerMobile);
  expect(session.user.name).toBe('Never Signed In');
  expect((await myListings(ownerMobile)).map((l) => l.title)).toContain(title);
});

test('an operator cannot rename an owner who already has an account', async () => {
  const ownerMobile = uniqueMobile();

  // The owner signs in first and is known by the name they chose.
  await apiLogin(ownerMobile);
  const before = (await apiLogin(ownerMobile)).user.name;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Whatever The Operator Heard', listing: listing(`Rename ${Date.now()}`),
  });
  expect(created.status).toBe(201);

  /* `ownerName` is a fallback for provisioning, not an update. An operator's transcription of a
     name heard over a phone call must not overwrite what the owner typed themselves -- and the
     operator has no way to know they would be overwriting anything. */
  expect((await apiLogin(ownerMobile)).user.name).toBe(before);
});

test('posting in somebody else\u2019s name needs more than a signed-in session', async () => {
  const owner = await authHeaders('9470744469');
  const refused = await postOnBehalf(owner, {
    ownerMobile: uniqueMobile(), ownerName: 'Ravi', listing: listing(`Forbidden ${Date.now()}`),
  });

  /* 403, from the server. This is the one route where the caller names somebody else as the owner
     of what they create, so it carries `postOnBehalf:write` rather than `properties:write` -- an
     operator trusted to moderate supply that already exists is not thereby trusted to manufacture
     a listing under a stranger's number. */
  expect(refused.status).toBe(403);
});

/*
   One wizard test, for the one thing on that screen that was reading the wrong store.

   The owner step warns "this owner already has N pending listings" -- the single chance the desk
   gets to notice it is taking the same flat down twice, which happens because the owner rang again
   and got a different operator. The count came from `rawDb().listings`, the mock store the live
   provider never writes to, so against the API it was permanently zero and the warning could never
   fire. It is now one read of the pending queue when the wizard opens.

   Driven through the browser rather than at the route because there is no route: what is being
   asserted is that a number the *server* knows about produces a warning in a form, which is
   precisely the join that was broken.
*/
test('the owner step warns about listings the server is already holding', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  const headers = await admin();
  for (const n of [1, 2]) {
    const res = await postOnBehalf(headers, {
      ownerMobile, ownerName: 'Rang Twice', listing: listing(`Second thoughts ${n} ${Date.now()}`),
    });
    expect(res.status).toBe(201);
  }

  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');
  await page.getByLabel('Owner Mobile *').fill(ownerMobile);

  /* Two, not "at least one". The exact number is what makes the warning worth reading, and a
     count that says "1 pending listing" for a number with two on the queue is the failure mode a
     `toBeVisible` on the sentence stem would sail straight past. */
  await expect(page.getByText(/already has 2 pending listings/i)).toBeVisible({ timeout: 10000 });

  /* And it is scoped to the number, not to the queue. A warning that appeared for every mobile
     would be indistinguishable from a working one in the assertion above. */
  await page.getByLabel('Owner Mobile *').fill(uniqueMobile());
  await expect(page.getByText(/already has \d+ pending listing/i)).toHaveCount(0);
});
