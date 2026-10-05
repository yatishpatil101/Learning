import { ACTORS, expect, test } from '../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../helpers/liveAuth.js';

const seeded = {
  title: 'Review modal evidence probe',
  description: 'South-facing flat with a covered balcony, five minutes from the Kothrud depot.',
  address: 'Flat 7B, Sunrise Residency, Paud Road',
};

const REVIEW_CHECKLIST = [
  'Photos are real and match the listing',
  'Not a duplicate of another listing',
  'Details and location look right',
];

// `uniqueMobile()` is `Date.now()`-derived, so two calls in the same millisecond collide.
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

async function createListing(request, overrides = {}) {
  const headers = await authHeaders(newOwner());
  const images = await uploadedListingPhotos(headers);
  const created = await request.post(`${API}/me/listings`, {
    headers,
    data: {
      title: seeded.title,
      deal: 'rent',
      propertyType: 'apartment',
      price: 25000,
      locality: 'Kothrud',
      city: 'Pune',
      description: seeded.description,
      address: seeded.address,
      images,
      ...overrides,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  return { ...await created.json(), images };
}

test('the review modal shows the submitted photos, description and address', async ({ page, login, request }) => {
  const { id, images } = await createListing(request);
  await page.route('**/api/admin/message-templates?channel=whatsapp', (route) => route.fulfill({
    json: [{
      id: 'reason_photos_not_real',
      channel: 'whatsapp',
      category: 'verification',
      name: 'Photo fix',
      body: 'Hi {owner_name}, please upload clear real photos for {title}.',
    }],
  }));

  await login.asAdmin();
  await page.goto(`/admin/properties?review=${id}`);

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();

  // The description verbatim, not a "Description: provided" tick.
  await expect(modal.getByText(seeded.description)).toBeVisible();

  const photo = modal.locator(`img[src="${images[0]}"]`);
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute('alt', new RegExp(seeded.title));
  await modal.getByTestId('review-section-details').click();
  // The address the owner typed, which is the field a fabricated listing gets wrong.
  await expect(modal.getByText(seeded.address, { exact: true })).toBeVisible();

  await expect(modal.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(modal.getByText('Tick every check')).toBeVisible();
  await modal.getByRole('button', { name: 'Needs info' }).click();
  await modal.getByRole('button', { name: 'Photos not real' }).click();
  await expect(modal.getByText('Owner message preview')).toBeVisible();
  await expect(modal.getByText(/Please upload clear, real photos/)).toBeVisible();
  await modal.getByTestId('review-section-messages').click();
  await modal.getByRole('button', { name: /WhatsApp templates/ }).click();
  await expect(modal.getByTestId('wa-preview-body')).toContainText('please upload clear real photos');
  await modal.getByRole('button', { name: 'Reject' }).click();
  await expect(modal.getByText("Final — the owner can't resubmit")).toBeVisible();
  for (const item of REVIEW_CHECKLIST) {
    const box = modal.getByRole('checkbox', { name: item });
    await box.click();
    await expect(box).toBeChecked();
  }
  await page.route(`**/api/properties/${id}/verification/decision`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'second_approver_required', message: 'Second approver required' }),
    });
  });
  await page.route(`**/api/properties/${id}/verification/override-requests`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ reason: 'Hard broker signal is a false positive' });
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        propertyId: id,
        status: 'in_review',
        checklist: REVIEW_CHECKLIST.map((item) => ({ item, pass: true })),
        messages: [],
        overrideRequest: {
          id: 'override-1',
          requestedBy: 'another-staff',
          reason: 'Hard broker signal is a false positive',
          at: new Date().toISOString(),
        },
      }),
    });
  });
  await modal.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Request second approval', exact: true })).toBeVisible();
  await modal.getByPlaceholder('Why should this hard signal be overridden?').fill('Hard broker signal is a false positive');
  await modal.getByRole('button', { name: 'Request second approval', exact: true }).click();
  await expect(modal.getByText('Hard broker signal is a false positive')).toBeVisible();
});

test('a needs-info listing pauses at In review and its console card says it is awaiting the owner', async ({ page, login, request }) => {
  const title = `Needs-info progress probe ${Date.now()}`;
  const { id } = await createListing(request, { title });
  const admin = await authHeaders(ACTORS.admin);
  const started = await request.post(`${API}/properties/${id}/verification/start`, { headers: admin });
  expect(started.status(), await started.text()).toBe(200);
  const decided = await request.post(`${API}/properties/${id}/verification/decision`, {
    headers: admin,
    data: { decision: 'needs_info', reasonCode: 'other', note: 'Please confirm this is not a duplicate.' },
  });
  expect(decided.status(), await decided.text()).toBe(200);

  await login.asAdmin();
  await page.goto('/admin/properties');
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  const card = page.getByTestId('queue-row').filter({ has: page.getByRole('heading', { name: title }) });
  const tracker = card.getByTestId('progress-tracker');
  await expect(tracker).toHaveAttribute('data-step', 'in_review');
  await expect(tracker).toHaveAttribute('data-blocked', 'needs_info');
  await expect(tracker).toContainText('Waiting on owner');
  await expect(card).toContainText('Step 2 of 3');
  await expect(card.getByTestId('awaiting-owner')).toBeVisible();
});

test('a rejected case offers the second-review reopen flow', async ({ page, login, request }) => {
  const { id } = await createListing(request, { title: `Rejected ${seeded.title}` });
  await page.route(`**/api/properties/${id}/verification`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        propertyId: id,
        status: 'rejected',
        checklist: REVIEW_CHECKLIST.map((item) => ({ item, pass: true })),
        messages: [],
        reasonCode: 'duplicate',
        reasonNote: null,
        overrideRequest: null,
      }),
    });
  });
  await page.route(`**/api/properties/${id}/verification/read`, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route(`**/api/properties/${id}/verification/override-requests`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ reason: 'Owner proved this was not the duplicate listing' });
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        propertyId: id,
        status: 'rejected',
        checklist: REVIEW_CHECKLIST.map((item) => ({ item, pass: true })),
        messages: [],
        overrideRequest: {
          id: 'reopen-1',
          requestedBy: 'another-staff',
          reason: 'Owner proved this was not the duplicate listing',
          at: new Date().toISOString(),
        },
      }),
    });
  });

  await login.asAdmin();
  await page.goto(`/admin/properties?review=${id}`);

  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('button', { name: 'Request reopen', exact: true })).toBeVisible();
  await modal.getByPlaceholder('Why should this final reject be reopened?').fill('Owner proved this was not the duplicate listing');
  await modal.getByRole('button', { name: 'Request reopen', exact: true }).click();
  await expect(modal.getByText('Reopen requested:')).toBeVisible();
});
