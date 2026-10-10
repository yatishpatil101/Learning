import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

// Staff copy must match the ledger body byte-for-byte.
const TEMPLATE_NAME = 'Gentle follow-up';

// Named fixture: queue order and owner mobile presence are not safe assumptions.
const LISTING_TITLE = '1 RK Flat in Pimple Saudagar';

async function openWhatsappPanel(page) {
  await page.goto('/admin/properties?tab=verify');

  await page.getByPlaceholder('Title, owner, mobile or ID').fill(LISTING_TITLE);

  const review = page.getByRole('button', { name: 'Review', exact: true });
  // Count through debounce and network; visibility can strict-mode fail mid-flight.
  await expect(review, `"${LISTING_TITLE}" should be the one listing this search leaves standing`)
    .toHaveCount(1, { timeout: 20000 });
  await review.click();

  await page.getByTestId('review-section-messages').click();
  const panel = page.getByRole('button', { name: /WhatsApp templates/ });
  // The modal waits on two round trips and first-run route compilation.
  await expect(panel, 'the reviewed listing should have an owner mobile to chase').toBeVisible({ timeout: 20000 });

  // The panel only proves a number exists; assert the number before template checks.
  const dialog = page.getByRole('dialog', { name: 'Verify property' });
  await expect(dialog.getByText(/^[0-9\u2022+ ]{6,}$/).first(),
    'the case file shows no owner number, so the chaser panel has nobody to send to',
  ).toBeVisible();

  await panel.click();
}

test('the template library is fetched, not bundled', async ({ page, login }) => {
  await login.asAdmin();

  // The template must come from the API, not a browser fallback array.
  const templates = page.waitForResponse(
    (r) => r.url().includes('/admin/message-templates') && r.status() === 200,
  );

  await openWhatsappPanel(page);

  const body = await (await templates).json();
  expect(body.length).toBeGreaterThanOrEqual(10);
  expect(body.every((t) => t.channel === 'whatsapp'), 'the channel filter must not return another channel\'s copy').toBe(true);
  const gentle = body.find((t) => t.id === 'wa-gentle');
  expect(gentle).toBeTruthy();
  expect(gentle.name).toBeTruthy();
  expect(gentle.body).toContain('{owner_name}');
  // And it is that response the panel is drawing, rather than a list that happens to look similar.
  await expect(page.getByRole('button', { name: TEMPLATE_NAME })).toBeVisible();
});

test('the preview is the message, exactly', async ({ page, context, login }) => {
  await login.asAdmin();

  // Stub instead of abort because the popup receives its URL after server acceptance.
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

  // This separates a wrong preview from a raw-template preview.
  expect(previewText).not.toContain('{owner_name}');
  expect(previewText).not.toContain('{staff_name}');
  expect(previewText).not.toContain('{title}');

  // Client-side `{staff_name}` substitution signs off as "You", not the real sender.
  expect(previewText).not.toContain('\u2014 You, Draazy');

  const outreach = page.waitForResponse(
    (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.request().method() === 'POST',
  );
  const popup = page.waitForEvent('popup');

  await page.getByRole('button', { name: 'Send via WhatsApp' }).click();

  const res = await outreach;
  expect(res.status()).toBe(200);
  const prepared = await res.json();

  expect(prepared.body).toBe(previewText);

  // Nothing claims delivery, at any layer.
  expect(prepared.status).toBe('prepared');

  // The handoff must carry the same text, so preview, ledger and WhatsApp are one string.
  const handoff = await popup;
  await handoff.waitForURL(/wa\.me/);
  expect(new URL(handoff.url()).searchParams.get('text')).toBe(prepared.body);
  await handoff.close();

  // "Written", never "sent". The word is the promise.
  await expect(page.getByText(/Chaser written/)).toBeVisible();
});

// Operators use this as history, so the panel must not invent timeline labels.
test('the timeline shows the ledger, and no longer invents the rest', async ({ page, context, login }) => {
  await login.asAdmin();
  await context.route('https://wa.me/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '',
  }));

  await openWhatsappPanel(page);

  // A delta, not an absolute.
  const entries = page.getByTestId('comms-entry');
  await page.getByRole('button', { name: /Communication log/ }).click();
  // The count badge appears once the timeline has loaded, which now happens on expand.
  await expect(page.getByRole('button', { name: /Communication log \d+/ })).toBeVisible();
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

  // History text must be the ledger `body`, not copy recomposed by the panel.
  await expect(entries.first().getByTestId('comms-entry-detail')).toHaveText(prepared.body);

  await expect(entries.first()).toContainText('Chaser written');
  await expect(entries.first()).toContainText(TEMPLATE_NAME);

  // Scope common words like "Photos" and "approved" to the outreach panel.
  const timeline = await page.getByTestId('comms-entry').allInnerTexts();
  for (const invented of ['Claim link sent', 'Link opened by owner', 'Photos uploaded', 'Identity verified', 'Listing approved']) {
    expect(timeline.join('\n'), `"${invented}" was a boolean rendered at an offset from createdAt`).not.toContain(invented);
  }

  // `preparedBy` is a uuid; actor resolution belongs to the admin-only audit log.
  expect(timeline.join('\n')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);

  // "Sent" appears only once the operator attests it.
  const marked = page.waitForResponse((r) => r.url().endsWith(`/outreach/${prepared.id}/sent`));
  await entries.first().getByRole('button', { name: 'Mark sent' }).click();
  expect((await marked).status()).toBe(200);
  await expect(entries.first()).toContainText(`Sent \u2014 ${TEMPLATE_NAME}`);
  await expect(entries.first().getByRole('button', { name: 'Mark sent' })).toHaveCount(0);
});

// The browser picks a template; the server decides membership from `lastConfirmedAt`.
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

  // Use both branch arms so queue mix cannot choose the branch for the test.
  const stale = rows.find((l) => l.freshness === 'stale');
  const dormant = rows.find((l) => l.freshness === 'dormant');
  expect(stale, 'the seed must carry a stale listing for the wa-stale arm').toBeTruthy();
  expect(dormant, 'the seed must carry a dormant listing for the wa-dormant arm').toBeTruthy();

  await page.goto('/admin/properties?tab=followup');
  await expect(page.getByRole('tab', { name: /^Follow-up/ })).toHaveAttribute('aria-selected', 'true');

  for (const listing of [stale, dormant]) {
    const filtered = page.waitForResponse((r) => {
      const url = new URL(r.url());
      return url.pathname === '/api/admin/properties'
        && url.searchParams.get('unconfirmed') === 'true'
        && url.searchParams.get('q') === listing.id;
    });
    await page.getByPlaceholder('Title, owner, mobile or ID').fill(listing.id);
    expect((await filtered).status(), `GET follow-up search for ${listing.slug}`).toBe(200);
    const card = page.getByTestId('queue-row');
    await expect(card, `q=<uuid> should resolve to exactly one card for ${listing.slug}`).toHaveCount(1);

    const posted = page.waitForRequest(
      (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.method() === 'POST',
    );
    const answered = page.waitForResponse(
      (r) => /\/properties\/[^/]+\/outreach$/.test(r.url()) && r.request().method() === 'POST',
    );
    const popup = page.waitForEvent('popup');

    await card.getByRole('button', { name: 'Remind' }).click();

    const req = await posted;
    const res = await answered;
    expect(res.status(), `POST outreach for ${listing.slug}`).toBe(200);
    const prepared = await res.json();

    // Mapper ids may be slugs, but this route must POST to the uuid.
    const sentTo = new URL(req.url()).pathname.split('/').at(-2);
    expect(sentTo, 'the chaser was addressed by slug; the route binds a uuid').toBe(listing.id);

    expect(JSON.parse(req.postData()).templateId,
      `the server calls ${listing.slug} "${listing.freshness}"; the console chased it as something else`)
      .toBe(`wa-${listing.freshness}`);

    // Nothing here claims delivery.
    expect(prepared.status).toBe('prepared');
    const handoff = await popup;
    await handoff.waitForURL(/wa\.me/);
    expect(new URL(handoff.url()).searchParams.get('text')).toBe(prepared.body);
    await handoff.close();

    await expect(page.getByText(`Chaser written for ${listing.owner.name}`).last()).toBeVisible();
  }
});
