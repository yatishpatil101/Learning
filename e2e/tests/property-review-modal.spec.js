import { expect, test } from '../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';

/* A reviewer judging whether a listing is real needs the photographs, the prose and the typed address, and a
   pending listing has no public page to open. Entered through `?review=<id>`, the console's own deep link. */

const seeded = {
  title: 'Review modal evidence probe',
  description: 'South-facing flat with a covered balcony, five minutes from the Kothrud depot.',
  address: 'Flat 7B, Sunrise Residency, Paud Road',
};

/* `uniqueMobile()` is `Date.now()`-derived, so two calls in the same millisecond collide. */
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

test('the review modal shows the submitted photos, description and address', async ({ page, login, request }) => {
  const headers = await authHeaders(newOwner());
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
      images: ['https://example.invalid/e2e-review-photo-1.jpg'],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();

  await login.asAdmin();
  await page.goto(`/admin/properties?review=${id}`);

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();

  /* The description verbatim, not a "Description: provided" tick. The whole point of the panel is
     that a reviewer can read the sentence an owner wrote and judge whether a person wrote it. */
  await expect(modal.getByText(seeded.description)).toBeVisible();

  /* The address the owner typed, which is the field a fabricated listing gets wrong. Exact, because the header
     also prints it joined to the locality, and a substring match would pass on the header alone. */
  await expect(modal.getByText(seeded.address, { exact: true })).toBeVisible();

  /* Rendered as an image, not merely counted. The src is an unreachable host on purpose: a spec that depended
     on the bytes arriving would be testing somebody else's CDN. */
  const photo = modal.locator('img[src*="e2e-review-photo-1"]');
  await expect(photo).toHaveCount(1);
  await expect(photo).toHaveAttribute('alt', new RegExp(seeded.title));
});
