import { test, expect } from '../../fixtures/live.js';

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
  await expect(review, `"${LISTING_TITLE}" should still be awaiting verification`).toBeVisible({ timeout: 20000 });
  await review.click();

  const panel = page.getByRole('button', { name: /WhatsApp templates/ });
  /* 20s, not the default 5s. The panel is below a modal that will not render until two round trips
     have landed - startPropertyReview then the read receipt - and on the first test of a run those
     are paying for the dev server compiling the route as well. This failed only ever as test 1 of a
     run and passed as test 2 with the identical helper, which is what that shape of flake looks
     like. */
  await expect(panel, 'the reviewed listing should have an owner mobile to chase').toBeVisible({ timeout: 20000 });
  await panel.click();
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
