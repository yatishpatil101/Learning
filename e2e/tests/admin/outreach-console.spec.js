import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/* The screen half of the outreach contract (`outreach.spec.js` pins the route): what the staff
   member reads must be byte-for-byte the `body` the server puts in the ledger. */

/** The one template the browser can resolve exactly as the server does. Seeded, id is stable. */
const TEMPLATE_NAME = 'Gentle follow-up';

/* Named, not "whichever card sorts first": the chase panel needs a pending listing whose owner has
 * a mobile, and neither that nor the queue's order is something this file gets to assume. */
const LISTING_TITLE = '1 RK Flat in Pimple Saudagar';

/** Open the named listing's case file and expand its WhatsApp panel. */
async function openWhatsappPanel(page) {
  await page.goto('/admin/properties?tab=verify');

  await page.getByPlaceholder('Search title, owner, locality\u2026').fill(LISTING_TITLE);

  const review = page.getByRole('button', { name: 'Review', exact: true });
  /* Count, not visibility: the search is a 250ms debounce plus a round trip, and mid-flight the
     fifteen-row match is a strict mode violation that aborts instead of retrying. */
  await expect(review, `"${LISTING_TITLE}" should be the one listing this search leaves standing`)
    .toHaveCount(1, { timeout: 20000 });
  await review.click();

  const panel = page.getByRole('button', { name: /WhatsApp templates/ });
  /* 20s, not the default 5s: the modal waits on two round trips and, on the first test of a run,
     the dev server compiling the route as well. */
  await expect(panel, 'the reviewed listing should have an owner mobile to chase').toBeVisible({ timeout: 20000 });

  /* The panel renders on `review.ownerMobile` being set, so its presence is only evidence of a
     number; asserting one is on screen fails here rather than downstream as a template bug. */
  const dialog = page.getByRole('dialog', { name: 'Verify property' });
  await expect(dialog.getByText(/^[0-9\u2022+ ]{6,}$/).first(),
    'the case file shows no owner number, so the chaser panel has nobody to send to',
  ).toBeVisible();

  await panel.click();
}

/* `components/ui/Select` is a button plus a portalled listbox, so `selectOption` throws; the
 * `aria-expanded` guards stop a second click from closing the menu it just opened. */
async function pickReason(page, optionText) {
  const trigger = page.getByRole('button', { name: 'Filter by reason' });
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.dz-dropdown__option', { hasText: optionText }).first().click();
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

  /* Stubbed rather than aborted: the console opens the tab blank and assigns `location` only once
     the server accepts, so aborting leaves the popup on about:blank with no URL to read. */
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

  /* 'You' is what a client-side substitution puts in {staff_name}, signing off as nobody while the
     owner's message names the sender. */
  expect(previewText).not.toContain('\u2014 You, Draazy');

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

  /* The handoff must carry the same text, so preview, ledger and WhatsApp are one string. The query
     is form-encoded, so read it via URLSearchParams — decodeURIComponent leaves `+` alone. */
  const handoff = await popup;
  await handoff.waitForURL(/wa\.me/);
  expect(new URL(handoff.url()).searchParams.get('text')).toBe(prepared.body);
  await handoff.close();

  // "Written", never "sent". The word is the promise.
  await expect(page.getByText(/Chaser written/)).toBeVisible();
});

/* A panel that invents history reads as evidence to the operator deciding whether to chase again,
   so the assertion with teeth is the negative one: no reconstructed timeline labels. */
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

  /* The five fabricable labels. Scoped to the panel, because "Photos" and "approved" are ordinary
     words that appear elsewhere in a verification modal. */
  const timeline = await page.getByTestId('comms-entry').allInnerTexts();
  for (const invented of ['Claim link sent', 'Link opened by owner', 'Photos uploaded', 'Identity verified', 'Listing approved']) {
    expect(timeline.join('\n'), `"${invented}" was a boolean rendered at an offset from createdAt`).not.toContain(invented);
  }

  /* No actor line. `preparedBy` is a user id; printing it would answer "who chased this owner"
     with a uuid, and the audit log that resolves actors is admin-only by design. */
  expect(timeline.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
});

/* The follow-up board picks the template client-side from the posting date while the server decides
   membership from `lastConfirmedAt`, so assert the browser's choice against the server's verdict. */
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
    /* Scoped by uuid, not title: the admin search matches the id as text and seeded titles are
       formulaic enough that several rows answer to one, making "the first button" a real chaser. */
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

    /* `propertyMapper` sets the row's `id` to `slug || id` while the route binds a uuid, so a POST
       addressed by slug 404s on every seeded listing and works only on freshly created ones. */
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

