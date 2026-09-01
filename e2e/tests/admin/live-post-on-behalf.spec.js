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

/*
   The two wizard fields whose only proof was a read of the mock store.

   `post-on-behalf-fixes.spec.js` walked the six steps and then opened `draazyDB_v5` to check
   what had been written. That is a real claim about a real bug -- a deposit typed while the deal
   said rent used to survive a flip to sale, and be filed against a listing that has no such thing
   -- but the mock provider stores the object the wizard hands it, verbatim. So the assertion was
   only ever "the wizard built the object the wizard built": every field the six steps collect
   agreed with itself, and the request body the live API is actually sent was never in the picture.

   That body is assembled by `toListingCreate`, and assembly is exactly where a field goes quiet.
   It renames some keys (`type` -> `propertyType`, `bhkNum` -> `bhk`), translates two enums into a
   spelling the contract 422s without, drops one deliberately, and forwards the rest -- so a field
   the wizard collects correctly and the mapper never picks is collected into nowhere. Nothing on
   the screen changes when that happens: the review step reads the form, the success banner reads
   the response's id, and both are happy.

   Hence: drive the wizard, then ask the **owner's own session** what the server stored. Written as
   two tests rather than one because they fail for different reasons -- one is a field that has to
   arrive, the other a field that has to not.
*/

/** The one listing a freshly-invented owner has, read in full. */
const onlyListing = async (ownerMobile) => {
  const mine = await myListings(ownerMobile);
  expect(mine, 'the wizard did not create a listing for this owner').toHaveLength(1);
  const res = await fetch(`${API}/me/listings/${mine[0].id}`, {
    headers: await authHeaders(ownerMobile),
  });
  expect(res.status).toBe(200);
  return res.json();
};

/** Steps 1-2 of the wizard, up to the point the two tests below diverge. */
async function ownerAndProperty(page, { name, mobile, carpetArea }) {
  await page.getByPlaceholder('Full name of the property owner').fill(name);
  await page.getByPlaceholder('9876543210').fill(mobile);
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select type').click();
  await page.getByRole('option', { name: /Apartment/i }).click();
  await page.getByText('Select BHK').click();
  await page.getByRole('option', { name: /2 BHK/i }).click();
  await page.getByPlaceholder('e.g. 850').fill(carpetArea);
}

test('the amenities an operator ticks reach the server', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await ownerAndProperty(page, { name: 'Amenity Owner', mobile: ownerMobile, carpetArea: '950' });
  await page.getByText('Select amenities').click();
  await page.getByRole('option', { name: 'Lift' }).click();
  await page.getByRole('option', { name: 'Power Backup' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Wakad/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.locator('input[inputmode="numeric"]').first().fill('24000');
  // A deposit, which this test does not care about -- it is the control for the one below. See the
  // assertion at the end.
  await page.getByRole('button', { name: '2 months rent' }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  /* The form's own account of itself, asserted first and deliberately kept. It is the half the
     mock spec could prove, and it is what makes the next assertion diagnostic rather than merely
     red: if this line passes and the server has no amenities, the loss is between the form and the
     wire, which is one file. If this line fails, the ticks never landed in the form at all. */
  await expect(page.getByText('Lift, Power Backup')).toBeVisible();

  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  /* Both, and by name. `toHaveLength(2)` alone would pass on a mapper that forwarded the array
     under some other key and a server that defaulted two amenities in; naming them ties the
     assertion to the operator's actual clicks. */
  expect(stored.amenities).toEqual(expect.arrayContaining(['Lift', 'Power Backup']));
  /* And the record really is the one just posted, so the check above is not being satisfied by
     some other listing this owner already had. */
  expect(Number(stored.price)).toBe(24000);
  /* The control for the next test, taken here because this listing is a rent and so is entitled to
     one. Two months of 24,000: the deposit does travel from the wizard to the server, which is what
     makes the zero asserted below evidence of the sale flip rather than of a field that never
     arrives at all. Without this line, deleting `deposit` from `toListingCreate` would leave both
     tests green. */
  expect(Number(stored.deposit)).toBe(48000);
});

test('a deposit typed under rent is not filed against a sale', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await ownerAndProperty(page, { name: 'NoDeposit Owner', mobile: ownerMobile, carpetArea: '900' });
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  // A rent, with two months' deposit against it -- the ordinary case the operator starts from.
  await page.locator('input[inputmode="numeric"]').first().fill('25000');
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(page.locator('#pob-deposit')).toHaveValue(/50/);

  // Then the correction, made from the toggle that sits on every step: it was a sale all along.
  await page.getByRole('group', { name: /Listing deal type/i })
    .getByRole('button', { name: /For Sale/i }).click();
  await expect(page.getByText('Security Deposit')).toHaveCount(0);

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  /* The deal followed the toggle -- without this, "no deposit" would be trivially true of a
     listing that is still a rent and simply lost its deposit, which is a different bug wearing
     the same green tick. */
  expect(stored.deal).toBe('buy');
  /* Nought, from the server. The field disappearing from the screen is not the claim: a hidden
     input whose value still rides along in the request body is precisely what this used to be. */
  expect(Number(stored.deposit ?? 0)).toBe(0);
  /* And the control for the test above, taken here because nothing was ticked on this run: the
     server does not supply amenities of its own. Without this, a backend that defaulted a handful
     in would satisfy the `arrayContaining` up there whatever the operator clicked. */
  expect(stored.amenities ?? []).toHaveLength(0);
});

/*
   The concierge desk and the freemium ceiling.

   `POST /admin/properties` went through the same creation the owner's own wizard calls, and so
   inherited the owner's plan cap. An operator on a call with somebody who owns three flats could
   record one of them and was refused the other two -- with the owner's wizard copy, addressed to a
   member of staff, about an account that is not theirs. Because every owner this route provisions
   is brand new and therefore on the free tier, that was not an edge case: it was every second
   listing the desk had ever tried to take.

   Driven at the route rather than through the wizard because the ceiling is a server rule, and the
   wizard is six steps of Next buttons between here and the write that proves it.
*/
test('the desk is not capped at one listing per owner', async () => {
  const ownerMobile = uniqueMobile();
  const headers = await admin();

  for (const n of [1, 2, 3]) {
    const res = await postOnBehalf(headers, {
      ownerMobile, ownerName: 'Three Flats', listing: listing(`Concierge ${n} ${Date.now()}`),
    });
    expect(res.status, `listing ${n} of 3 phoned in by the same owner`).toBe(201);
  }

  // And all three are the owner's, not three attempts at one.
  expect((await myListings(ownerMobile)).length).toBeGreaterThanOrEqual(3);
});

/* The exemption belongs to the route, not to the owner. If it followed the account, "ring the
   office" would be the documented way around the paywall. */
test('an owner the desk posted for is still refused by their own wizard', async () => {
  const ownerMobile = uniqueMobile();

  expect((await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Phoned In', listing: listing(`Phoned in ${Date.now()}`),
  })).status).toBe(201);

  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers: await authHeaders(ownerMobile),
    body: JSON.stringify(listing(`Typed in myself ${Date.now()}`)),
  });
  expect(res.status).toBe(422);
  expect((await res.json()).error).toBe('listing_quota_exhausted');
});

/*
   What replaced the refusal.

   Exempting the desk removed the only signal anyone had that an owner was running past what they
   pay for. `GET /admin/properties/owner-standing` puts it back as information rather than as a
   block, so the operator can raise the upgrade on the call they are already on.
*/
test('the desk can see when an owner is past their plan', async () => {
  const ownerMobile = uniqueMobile();
  const headers = await admin();

  const standing = async () => {
    const res = await fetch(`${API}/admin/properties/owner-standing?mobile=${ownerMobile}`, { headers });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  /* An unknown number answers, rather than 404ing. This is the ordinary state of a first call, and
     a console that rendered its error banner for it would be showing one on most calls. */
  const before = await standing();
  expect(before.status).toBe(200);
  expect(before.body.known).toBe(false);

  await postOnBehalf(headers, {
    ownerMobile, ownerName: 'Over Their Plan', listing: listing(`Standing one ${Date.now()}`),
  });

  /* Exactly on the free tier's one listing is not over it. Warning about every caller is the same
     as warning about none, since an operator stops reading a note that is always there. */
  const atLimit = await standing();
  expect(atLimit.body.known).toBe(true);
  expect(atLimit.body.allowance).toBe(1);
  expect(atLimit.body.held).toBe(1);
  expect(atLimit.body.overAllowance).toBe(false);

  await postOnBehalf(headers, {
    ownerMobile, ownerName: 'Over Their Plan', listing: listing(`Standing two ${Date.now()}`),
  });

  const over = await standing();
  expect(over.body.held).toBe(2);
  expect(over.body.overAllowance).toBe(true);
  /* Counts, and nothing else. An operator needs to know a conversation exists, not what the
     account is worth, and a desk that can read anybody's subscription off a phone number is a
     larger disclosure than this note is asking for. */
  expect(over.body.plan).toBeUndefined();
  expect(over.body.price).toBeUndefined();
});

/* Guarded by the desk's own atom. An owner must not be able to read anyone's standing, including
   their own, through a back-office route. */
test('a consumer session cannot read an owner standing', async () => {
  const consumer = await authHeaders(uniqueMobile());
  const res = await fetch(`${API}/admin/properties/owner-standing?mobile=${uniqueMobile()}`, {
    headers: consumer,
  });
  expect(res.status).toBe(403);
});

/*
 * The wizard's client-side half, brought over from `admin/post-on-behalf.spec.js` when that file
 * was retired: the two routes in, the step-one guard, and the two live calculators.
 *
 * The old file kept these on the explicit grounds that they are "genuinely client-side and worth
 * keeping cheap". Cheap is not an argument for staying in mock mode — nothing here needs the mock,
 * it merely tolerates it — and the framing hid what mock mode was actually unable to say. The
 * comma grouping and the deposit multiplier are transforms on a number an operator is about to
 * commit in somebody else's name. Mock mode could assert what the screen *reads*; it could not
 * assert that what the screen reads is what gets filed, because the store it compared against was
 * fed by the same form.
 *
 * That gap is not hypothetical, and the first attempt to demonstrate it went wrong in a way worth
 * recording. `formatIndian` is a pure display transform over form state that holds bare digits, and
 * `money(field)`'s change handler is the only thing keeping them bare — so leaving the separators in
 * state looked like the perfect silent corruption: the input still reads `25,000`, because
 * `formatIndian` strips non-digits before regrouping and therefore renders its own output unchanged.
 * It is not a corruption at all. `AdminPostOnBehalf.jsx:214` runs `parseAmount(form.price)` on the
 * way out, so the digits-only rule in state is belt-and-braces and the mutation was behaviourally
 * inert — the run stayed green, correctly. The lesson is that a display transform and a submit
 * transform can both be defensive, and the seam that actually decides what is filed is the second
 * one. Scale the price there instead and the screen is word-for-word right about an amount the
 * server never received: that is the bug only a live spec can see, and it is a tenth of the rent.
 *
 * Both grouping scales are exercised, because the Indian rule is not one rule: the last three
 * digits group in threes and everything above them in twos, so `2500000` is the smallest ordinary
 * amount that can tell `25,00,000` from `2,500,000`. The 25-lakh figure also drives the `moneyWords`
 * caption through its `>= 100000` branch, and the 25-thousand figure through its `>= 1000` one — a
 * caption stuck on one branch reads plausibly on the value it was written against.
 *
 * The step-one guard is paired rather than asserted alone: it is only a guard if step two is
 * *absent*, and "the owner-name field is visible" is equally true of a wizard that has rendered
 * both steps at once.
 *
 * Mutation-proved twice, each reddening one half and no other. Changing `formatIndian`'s grouping
 * from `(\d{2})` to `(\d{3})` reddened the first `toHaveValue` with `Received: "2,500,000"` and
 * left the stored record correct. Dividing the submitted `price` by ten in the wizard's own mapper
 * reddened the stored price alone — `Expected: 25000, Received: 2500` — with every screen assertion
 * above it still green, which is the retired mock file's entire claim passing over a listing filed
 * for a tenth of the agreed rent.
 */
test('the two ways in reach the wizard, step one will not be skipped, and the money the operator reads is the money the server files', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();

  /* Scoped to the sidebar, because two links reach this page. Unscoped, the locator matches one
     element while the dashboard is still rendering and two once it has. */
  await page.goto('/admin');
  await page.locator('aside').getByRole('link', { name: /Post on Behalf/i }).click();
  await expect(page).toHaveURL(/\/admin\/post-on-behalf$/);
  await expect(page.getByText('Post on Behalf of Owner')).toBeVisible();

  await page.goto('/admin');
  await page.locator('main').getByRole('link', { name: /Post on behalf/i }).first().click();
  await expect(page).toHaveURL(/\/admin\/post-on-behalf$/);

  // Next, with nothing typed. The owner step must still be here, and the property step must not be.
  await page.getByRole('button', { name: /Next/i }).click();
  await expect(page.getByPlaceholder('Full name of the property owner')).toBeVisible();
  await expect(page.getByPlaceholder('e.g. 850')).toHaveCount(0);

  await ownerAndProperty(page, { name: 'Money Owner', mobile: ownerMobile, carpetArea: '950' });
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  const price = page.locator('#pob-price');
  const deposit = page.locator('#pob-deposit');

  // Seven digits: the only scale at which the Indian rule and the Western one disagree.
  await price.fill('2500000');
  await expect(price).toHaveValue('25,00,000');
  await expect(page.getByText('≈ ₹ 25 Lakh')).toBeVisible();
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(deposit).toHaveValue('50,00,000');

  // Then the amount actually filed, which also walks the caption's other branch.
  await price.fill('25000');
  await expect(price).toHaveValue('25,000');
  await expect(page.getByText('≈ ₹ 25 Thousand')).toBeVisible();
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(deposit).toHaveValue('50,000');

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  /* The whole point of moving this file. Twenty-five thousand rupees a month and fifty thousand
     held against it — the two numbers the operator read on screen, now read back off the record
     the owner will be asked to approve. */
  const stored = await onlyListing(ownerMobile);
  expect(Number(stored.price)).toBe(25000);
  expect(Number(stored.deposit)).toBe(50000);
});

/*
 * `post-on-behalf-fixes.spec.js`, retired here.
 *
 * That file kept five tests on the grounds that they "touch no store at all... conditional
 * rendering, field cascades, a browser-local draft and a label association — all of it settled
 * before any request is made, and none of it cheaper or more honest to assert through the API".
 * Two of the four claims are true. What was being retired was the mock *provider*, not the idea of
 * asserting the screen, and a spec that needs no provider has no reason to be pinned to the fake
 * one; it just runs, here, against the build that ships.
 *
 * The third claim — that a cascade is settled before any request is made — is the one worth
 * preserving, not disputing. `AdminPostOnBehalf.jsx:134` resets the form "so stale config from a
 * previous choice can never leak into the saved listing or the Review screen". It is rendered on
 * the live build below, rather than a mock-only one. Removing `next.bhk = ''` mutation-proved the
 * review absence: the new run went red at the `2 BHK` absence with one match. The land assertions
 * have their own proof: making `WizardSteps` treat every type as non-land made `Plot Area` vanish
 * and redlined its positive anchor. The attempted mutation of the state-only land reset was inert,
 * as it should be — the tested rendering decisions are direct functions of property type.
 */
test('a property type switched away from takes its bedroom configuration with it off the review screen', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  // A residential flat with a bedroom configuration before the type correction.
  await ownerAndProperty(page, { name: 'Cascade Owner', mobile: uniqueMobile(), carpetArea: '950' });

  /* The positive anchor, without which every absence below is satisfied by an operator who chose
     nothing. This is the configuration the wizard is now holding on the operator's behalf. */
  await expect(page.getByLabel('BHK')).toHaveText('2 BHK');

  // Then the correction: it is an office, not a flat.
  await page.getByLabel('Property type').click();
  await page.getByRole('option', { name: /Commercial/i }).click();
  await page.getByText('Select commercial type').click();
  await page.getByRole('option', { name: /Office Space/i }).click();
  await expect(page.getByLabel('BHK')).toHaveCount(0);
  await page.getByPlaceholder('e.g. 850').fill('1200');

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.locator('#pob-price').fill('9000000');
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  // Destination one: the summary the operator reads immediately before pressing Send.
  await expect(page.getByText('Config', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2 BHK')).toHaveCount(0);
  await expect(page.getByText('1200 sq.ft')).toBeVisible();
});

/*
 * The rest of the retired file: the deal toggle's own state, the land cascade, and the label
 * association. No request is made and none is wanted — every one of these decides what the operator
 * is allowed to type next.
 *
 * The deposit half of the deal toggle is not repeated here. `a deposit typed under rent is not
 * filed against a sale` above already toggles to For Sale, watches the field go, and then proves
 * the nought on the record; what is left over from the old file is the control's own `aria-pressed`
 * and the price label it renames, neither of which that test looks at.
 */
test('the deal toggle and the land cascade decide what the operator may type, and every label points at its field', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  // Clicking the label focuses the field, which is the whole of the association claim.
  await page.getByText('Owner Name *').click();
  await expect(page.locator('#pob-ownerName')).toBeFocused();

  const group = page.getByRole('group', { name: /Listing deal type/i });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: /For Sale/i }).click();
  await expect(group.getByRole('button', { name: /For Sale/i })).toHaveAttribute('aria-pressed', 'true');
  /* Paired, because "For Sale is pressed" is equally true of a control that presses everything. */
  await expect(group.getByRole('button', { name: /For Rent/i })).toHaveAttribute('aria-pressed', 'false');

  await page.getByPlaceholder('Full name of the property owner').fill('Land Owner');
  await page.getByPlaceholder('9876543210').fill('9876543210');
  await page.getByRole('button', { name: /Next/i }).click();

  /* Open Plot: the area field is renamed and the three questions that only make sense about a
     building are withdrawn. Asserted with a positive anchor on the rename, so "Furnishing is gone"
     cannot be satisfied by a step that failed to render. */
  await page.getByLabel('Property type').click();
  await page.getByRole('option', { name: /Open Plot/i }).click();
  await expect(page.getByText('Plot Area (sq.ft) *')).toBeVisible();
  await expect(page.getByText('Furnishing')).toHaveCount(0);
  await expect(page.getByText('Facing')).toHaveCount(0);
  await expect(page.getByText('Amenities')).toHaveCount(0);

  await page.getByPlaceholder('e.g. 850').fill('2400');
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  // For Sale, all the way through: the price field is renamed and the deposit is not offered.
  await expect(page.getByText('Expected Price')).toBeVisible();
  await expect(page.getByText('Monthly Rent')).toHaveCount(0);
  await expect(page.getByText('Security Deposit')).toHaveCount(0);
});

/*
 * The autosaved draft.
 *
 * `dz_pob_draft_v1` is a `localStorage` key and stays one on a live build: it is the operator's own
 * browser holding a half-typed form across a refresh, not a stand-in for a server. Flagged
 * explicitly because a `live-` spec that touches `localStorage` is normally a conversion that did
 * not finish — this one reads the key and clears it, and never seeds a record through it.
 */
test('a half-typed wizard survives a refresh, out of the operator’s own browser', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');
  await page.evaluate(() => localStorage.removeItem('dz_pob_draft_v1'));
  await page.reload();

  await page.getByPlaceholder('Full name of the property owner').fill('Draft Owner');
  await page.getByPlaceholder('9876543210').fill('9876500000');
  /* Polled rather than slept. A `waitForTimeout` here would pass on a fast machine even if autosave
     were removed entirely — the reload would find no draft and the test would fail for a confusing
     reason, or pass because an older draft was still sitting in storage. */
  await expect.poll(async () =>
    await page.evaluate(() => localStorage.getItem('dz_pob_draft_v1') !== null)).toBe(true);

  await page.reload();
  await expect(page.getByText(/unsaved draft/i)).toBeVisible();
  await page.getByRole('button', { name: /^Resume$/ }).click();
  await expect(page.getByPlaceholder('Full name of the property owner')).toHaveValue('Draft Owner');
});
