import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/*
   The outreach console, against the real API.

   `live-outreach.spec.js` pins the contract at the route. This file is the other half: the screen
   that now calls it. They are separate because they fail for different reasons and a run that goes
   red should say which half broke - a 400 from the server and a preview that renders the wrong
   name are not the same news.

   ## What this is actually guarding

   The WhatsApp copy used to be interpolated in three places - the mock, the server, and a private
   `interpolateWaTemplate` inside PropertyReviewModal - and the modal's copy disagreed with the
   other two on every value that mattered. `staff_name` was the literal string 'You', so the
   preview read "- You, PuneNest" while the owner received the sender's real name; `claim_link`
   pointed at /claim/{id}, a route this application has never had; `market_rate` was a hard-coded
   9,500 for every locality in Pune. A staff member read one message and a member of the public
   received another, and nothing anywhere compared them.

   So the assertion with teeth here is an equality: the text rendered in the preview must be, byte
   for byte, the `body` the server puts in the ledger. Not "contains the owner's name" - that would
   have passed on the broken version too.

   ## Why `wa-gentle` specifically

   It is the only template whose every placeholder the browser can resolve identically to the
   server: {owner_name}, {title}, {locality}, {staff_name}. The others reach for {claim_link},
   which the server builds from its own configured base URL - a value the browser cannot know and
   should not guess. Comparing those would be testing that two environments happen to be configured
   the same way, which is not what this file is about.

   ## The tab

   Sending opens `wa.me`, which is a real site on the internet. It is aborted at the context, and
   the popup is caught and closed. What is asserted is that the link the console hands off carries
   the same text the server composed - i.e. the staff member's WhatsApp opens with the message the
   ledger says was written, not one the browser assembled on the way past.

   Nothing here asserts a message was delivered, because nothing can. Click-to-chat means the staff
   member still has to press send, and may edit the text or close the tab first. The toast says
   "written" and this spec pins that word.

   Fixtures: docs/system/fixture-registry.md -> the outreach row.
*/

/** The one template the browser can resolve exactly as the server does. Seeded, id is stable. */
const TEMPLATE_NAME = 'Gentle follow-up';

/**
 * A seeded listing that is `pending` and whose owner has a mobile - the two conditions for the
 * chase panel to exist at all. Owned by Sneha Shah (9124855617).
 *
 * Named rather than "whichever card sorts first". The first draft took the first Review button on
 * the page; it passed, then failed on the very next run with the panel missing. Not every pending
 * listing's owner has a mobile, and the queue's order is not something this file gets to assume.
 * Reaching it through the tab's own filter box also keeps the test off page 2 as the seed grows.
 */
const LISTING_TITLE = '1 RK Flat in Pimple Saudagar';

/**
 * Open the named listing's case file and expand its WhatsApp panel.
 *
 * The listing's identity still arrives on the outreach POST rather than being asserted from this
 * constant, so the equality test depends only on something having opened.
 */
async function openWhatsappPanel(page) {
  await page.goto('/admin/properties?tab=verify');

  await page.getByPlaceholder('Search title, owner, locality\u2026').fill(LISTING_TITLE);

  const review = page.getByRole('button', { name: 'Review', exact: true });
  /* Count, not visibility, and the difference is not stylistic. This search used to be a synchronous
     filter over rows the browser already held, so `fill` resolved with the queue already narrowed
     and any assertion shape worked. It is now a 250ms debounce and a round trip, so for a moment
     after `fill` all fifteen pending listings are still on screen - and `toBeVisible` does not
     survive that moment: a locator matching fifteen elements is a strict mode violation, which
     aborts on the spot rather than being retried like an ordinary unmet expectation. The generous
     timeout was therefore never spent (the test died in 8s of a 20s budget) and the failure read as
     "the seed no longer has this listing pending", which it did: the row is there, and the API
     confirms it. `toHaveCount` retries, so it waits out the debounce and describes the settled
     queue rather than whichever paint it happened to catch. */
  await expect(review, `"${LISTING_TITLE}" should be the one listing this search leaves standing`)
    .toHaveCount(1, { timeout: 20000 });
  await review.click();

  const panel = page.getByRole('button', { name: /WhatsApp templates/ });
  /* 20s, not the default 5s. The panel is below a modal that will not render until two round trips
     have landed - startPropertyReview then the read receipt - and on the first test of a run those
     are paying for the dev server compiling the route as well. This failed only ever as test 1 of a
     run and passed as test 2 with the identical helper, which is what that shape of flake looks
     like. */
  await expect(panel, 'the reviewed listing should have an owner mobile to chase').toBeVisible({ timeout: 20000 });

  /* The precondition, asserted rather than assumed \u2014 ported from `properties.spec.js`'s
     `the WhatsApp templates appear when the owner has a number to send to`, which this file retires.
     `WhatsappTemplates` renders only when `review.ownerMobile` is set, so the button's presence is
     *evidence* of a number rather than a check on one. That distinction stops being academic the
     moment the field stops mapping: the panel would still open, every template below would still
     render, and each of them would be a message with no addressee. Asserting a number is on screen
     makes "there is nobody to send this to" fail here, at the gate, instead of downstream where it
     reads as a template bug. */
  const dialog = page.getByRole('dialog', { name: 'Verify property' });
  await expect(dialog.getByText(/^[0-9\u2022+ ]{6,}$/).first(),
    'the case file shows no owner number, so the chaser panel has nobody to send to',
  ).toBeVisible();

  await panel.click();
}

/**
 * Choose a reason on the Needs Follow-up board.
 *
 * `components/ui/Select` is a button plus a portalled listbox, so `selectOption` throws. The
 * `aria-expanded` assertions either side are what make it deterministic, and they are also why this
 * cannot be written as "click the trigger, click the option": a click on an already-open Select
 * closes it, so an unguarded second call waits out its timeout on a menu its own click just shut.
 */
async function pickReason(page, optionText) {
  const trigger = page.getByRole('button', { name: 'Filter by reason' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.pn-dropdown__option', { hasText: optionText }).first().click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toContainText(optionText);
}

test('the template library is fetched, not bundled', async ({ page, login }) => {
  await login.asAdmin();

  /* Provenance. The console shipped its own DEFAULT_WA_TEMPLATES array and read it synchronously,
     so the panel would have rendered identically with the API switched off. Waiting on the response
     is the difference between "the templates are there" and "the templates came from the server". */
  const templates = page.waitForResponse(
    (r) => r.url().includes('/admin/message-templates') && r.status() === 200,
  );

  await openWhatsappPanel(page);

  const body = await (await templates).json();
  expect(body.length).toBeGreaterThanOrEqual(10);

  // And it is that response the panel is drawing, rather than a list that happens to look similar.
  await expect(page.getByRole('button', { name: TEMPLATE_NAME })).toBeVisible();
});

test('the preview is the message, exactly', async ({ page, context, login }) => {
  await login.asAdmin();

  /* wa.me is a real site. Never let a test run reach it.

     Stubbed rather than aborted, and the difference matters: the console opens the tab blank and
     assigns `location` only once the server has accepted, so an aborted request leaves the popup
     sitting on about:blank and the URL this test is here to read never exists. Fulfilling keeps the
     network off while letting the navigation complete. */
  await context.route('https://wa.me/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '',
  }));

  await openWhatsappPanel(page);
  await page.getByRole('button', { name: TEMPLATE_NAME }).click();

  const preview = page.getByTestId('wa-preview-body');
  await expect(preview).toBeVisible();
  const previewText = await preview.innerText();

  /* Interpolation ran at all. Cheap, but it separates "the preview is wrong" from "the preview is
     the raw template", which are different bugs with different causes. */
  expect(previewText).not.toContain('{owner_name}');
  expect(previewText).not.toContain('{staff_name}');
  expect(previewText).not.toContain('{title}');

  /* The regression that started all of this. 'You' was what the old private copy substituted for
     {staff_name}, so the sign-off named nobody while the owner's message named the sender. */
  expect(previewText).not.toContain('\u2014 You, PuneNest');

  const outreach = page.waitForResponse(
    (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.request().method() === 'POST',
  );
  const popup = page.waitForEvent('popup');

  await page.getByRole('button', { name: 'Send via WhatsApp' }).click();

  const res = await outreach;
  expect(res.status()).toBe(200);
  const prepared = await res.json();

  // The assertion this file exists for.
  expect(prepared.body).toBe(previewText);

  // Nothing claims delivery, at any layer.
  expect(prepared.status).toBe('prepared');

  /* And the handoff carries that same text, so the three things that could disagree - what the
     staff member read, what the ledger recorded, what WhatsApp opens with - are one string. The
     query is form-encoded, so it is read back through URLSearchParams rather than decoded by hand:
     every space is a `+` and decodeURIComponent leaves `+` alone. */
  const handoff = await popup;
  await handoff.waitForURL(/wa\.me/);
  expect(new URL(handoff.url()).searchParams.get('text')).toBe(prepared.body);
  await handoff.close();

  // "Written", never "sent". The word is the promise.
  await expect(page.getByText(/Chaser written/)).toBeVisible();
});

/*
   The communication timeline, which is the same ledger read back on the same screen.

   Worth its own test rather than an extra assertion on the one above, because it guards a
   different kind of mistake. That one guards a disagreement between two renderings of a message.
   This one guards a panel that used to answer a question it had no data for.

   `getOwnerCommsLog` assembled seven categories of event and five of them were reconstructions:
   "Claim link sent" was the boolean `claimLinkSent` printed at `createdAt` plus one hour,
   "Photos uploaded" at plus a day and a half, "Listing approved" at plus three days. Those times
   were arithmetic, not observations, and they appeared on the screen an operator uses to decide
   whether this owner has been left alone long enough to contact again. A panel that invents
   history is worse than one that admits it has none, because it reads as evidence.

   So the assertion with teeth is the negative one: none of those five labels may appear. A test
   that only checked the chaser shows up would pass just as happily with the fabricated entries
   sitting above it.
*/
test('the timeline shows the ledger, and no longer invents the rest', async ({ page, context, login }) => {
  await login.asAdmin();
  await context.route('https://wa.me/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '',
  }));

  await openWhatsappPanel(page);

  /* A delta, not an absolute. The ledger is append-only and shared with `live-outreach`, so the
     count on this listing depends on what has run before it in the file. */
  const entries = page.getByTestId('comms-entry');
  await page.getByRole('button', { name: /Communication log/ }).click();
  const before = await entries.count();

  await page.getByRole('button', { name: TEMPLATE_NAME }).click();
  const outreach = page.waitForResponse(
    (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.request().method() === 'POST',
  );
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Send via WhatsApp' }).click();

  const prepared = await (await outreach).json();
  (await popup).close();

  await expect(entries).toHaveCount(before + 1);

  /* Newest first, and the text is the ledger's `body` rather than anything the panel composed --
     the same equality the preview test makes, one surface further on. */
  await expect(entries.first().getByTestId('comms-entry-detail')).toHaveText(prepared.body);

  // "written", here too. The ledger's every row is `prepared`; no screen may upgrade that to sent.
  await expect(entries.first()).toContainText('Chaser written');
  await expect(entries.first()).toContainText(TEMPLATE_NAME);

  /* The five fabrications. Scoped to the panel, because "Photos" and "approved" are ordinary words
     that appear elsewhere in a verification modal. */
  const timeline = await page.getByTestId('comms-entry').allInnerTexts();
  for (const invented of ['Claim link sent', 'Link opened by owner', 'Photos uploaded', 'Aadhaar verified', 'Listing approved']) {
    expect(timeline.join('\n'), `"${invented}" was a boolean rendered at an offset from createdAt`).not.toContain(invented);
  }

  /* No actor line. `preparedBy` is a user id; printing it would answer "who chased this owner"
     with a uuid, and the audit log that resolves actors is admin-only by design. */
  expect(timeline.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
});

/*
   The other chaser, and the one nothing watched: the reminder button on the Needs Follow-up board.

   Everything above goes through the review modal, where a staff member picks a template off a
   fetched list and reads the composed message before sending. The follow-up board has no panel and
   no preview — one click, and the console picks the template itself:

       chase(l, freshnessState(l) === 'dormant' ? 'wa-dormant' : 'wa-stale')

   which makes the choice of what to say to this owner an inference the browser draws, on a board
   whose membership the *server* decided. The two use different inputs. `unconfirmed=true` is
   answered by `Freshness.of(lastConfirmedAt, createdAt, now)`; `freshnessState` reads
   `freshenedAt || createdAt`, and `freshenedAt` is `propertyMapper`'s name for `lastConfirmedAt`,
   which this DTO does not emit — `GET /admin/properties` carries the verdict (`freshness`) and not
   the timestamp it was computed from. So the client re-derives the tier from the posting date.

   Today the two agree, and they agree for a reason that will not last: every seeded row has a null
   `last_confirmed_at`, so the server falls back to `createdAt` too and both sides are doing the
   same arithmetic on the same number. The thresholds match as well — 7/14/30 either side. The
   moment one owner presses "Confirm still available" on an older listing, the server starts
   answering from the confirmation and the browser carries on answering from the posting date, and
   they part company on a listing that is still in the queue. The visible consequence is the wrong
   message: `wa-dormant` opens by telling an owner their listing has been hidden from buyers, which
   is a false statement to send to someone who confirmed a fortnight ago.

   Nothing would catch that. The mock twin in `listing-freshness.spec.js` asserted the toast and
   stopped, on a single hand-written fixture that only ever exercised the `wa-stale` arm — it could
   not have detected a branch that picks the other template, because it had nothing to compare
   against. So the assertion here is deliberately a *cross-check* rather than an equality with a
   constant: the template the browser sent must match the tier the **server** reports for that same
   listing. It passes today; it goes red the day the two definitions drift, which is the only day
   it matters.

   Converted from `listing-freshness.spec.js` — see the note left in that file.
*/
test('the follow-up board chases with the message the listing has actually earned', async ({ page, context, login }) => {
  await login.asAdmin();
  await context.route('https://wa.me/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '',
  }));

  const headers = await authHeaders(ACTORS.admin);
  const queue = await fetch(
    `${API}/admin/properties?status=approved&archived=false&unconfirmed=true&size=200`,
    { headers },
  );
  expect(queue.status, 'GET /admin/properties?unconfirmed=true').toBe(200);
  const rows = (await queue.json()).content ?? [];

  /* One listing from each arm of the branch, so the test exercises the choice rather than whichever
     tier the queue happens to be full of. Skipping is not an option here — a board with only one
     tier on it would quietly halve what this test proves. */
  const stale = rows.find((l) => l.freshness === 'stale');
  const dormant = rows.find((l) => l.freshness === 'dormant');
  expect(stale, 'the seed must carry a stale listing for the wa-stale arm').toBeTruthy();
  expect(dormant, 'the seed must carry a dormant listing for the wa-dormant arm').toBeTruthy();

  await page.goto('/admin/properties');
  await expect(page.getByRole('tab', { name: 'Needs Follow-up' })).toBeVisible();
  await page.getByRole('tab', { name: 'Needs Follow-up' }).click();
  await pickReason(page, 'Unconfirmed (stale)');

  for (const listing of [stale, dormant]) {
    /* Scoped by uuid rather than by title. The admin search matches the id as text (that is what
       `adminTextSearch` casts it for), and seeded titles are formulaic enough that several rows
       answer to one — clicking "the first reminder button" would then send a real chaser to
       whichever owner sorted first, which is the exact mistake the board's own comment warns about.
       The count assertion is what makes the click unambiguous. */
    await page.getByPlaceholder('Search title, owner, locality\u2026').fill(listing.id);
    const card = page.locator('.list-card');
    await expect(card, `q=<uuid> should resolve to exactly one card for ${listing.slug}`).toHaveCount(1);

    const posted = page.waitForRequest(
      (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.method() === 'POST',
    );
    const answered = page.waitForResponse(
      (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.request().method() === 'POST',
    );
    const popup = page.waitForEvent('popup');

    await card.getByTitle('Send WhatsApp reminder to owner').click();

    const req = await posted;
    const res = await answered;
    expect(res.status(), `POST outreach for ${listing.slug}`).toBe(200);
    const prepared = await res.json();

    /* The id crossing, which is not hypothetical on this page: `propertyMapper` sets the row's `id`
       to `slug || id`, so every seeded listing on this board is carrying `p5133` where the route
       binds a uuid. `chase` reaches for `l.uuid || l.id` precisely because of that, and if the
       fallback ever became the only branch this POST would 404 on every live listing — the ones
       with slugs — while continuing to work on anything a test had just created. */
    const sentTo = new URL(req.url()).pathname.split('/').at(-2);
    expect(sentTo, 'the chaser was addressed by slug; the route binds a uuid').toBe(listing.id);

    // The cross-check this test exists for.
    expect(JSON.parse(req.postData()).templateId,
      `the server calls ${listing.slug} "${listing.freshness}"; the console chased it as something else`)
      .toBe(`wa-${listing.freshness}`);

    /* And the same three-way equality the modal tests make, one surface further on: what the ledger
       recorded is what WhatsApp opens with. Nothing here claims delivery. */
    expect(prepared.status).toBe('prepared');
    const handoff = await popup;
    await handoff.waitForURL(/wa\.me/);
    expect(new URL(handoff.url()).searchParams.get('text')).toBe(prepared.body);
    await handoff.close();

    /* The owner's real name, read off the server's DTO rather than a fixture constant — the toast
       is how the staff member confirms they chased the person they meant to. */
    await expect(page.getByText(`Chaser written for ${listing.owner.name}`)).toBeVisible();
  }
});

