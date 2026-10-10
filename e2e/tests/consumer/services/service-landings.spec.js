/* ServiceLanding (packers, home loans, legal) shares one gate, prefill and hero, so each is asserted once;
   valuation and interior are bespoke. Submits: service-landing-ticket.spec.js, interior-lead.spec.js. */
import { expect, test, ACTORS, STAFF } from '../../../fixtures/live.js';
import { API, apiLogin, authHeaders, signIn, signedInAs } from '../../../helpers/liveAuth.js';
import { appReady } from '../../../helpers/app.js';

const nextParam = (path) => new RegExp(`next=${encodeURIComponent(path).replace(/\//g, '%2F')}`);

/* The prefill is compared against what the API returns, not a literal, so a reseed cannot turn a
   regression into a pass and a page reading `draazyUser` cannot pass by coincidence. */
async function expectFormAddressedToSession(page, user) {
  await expect(page.locator('input[data-err="name"]')).toHaveValue(user.name, { timeout: 15000 });
  await expect(page.locator('[data-err="mobile"] input')).toHaveValue(new RegExp(String(user.mobile).slice(-10)), { timeout: 15000 });
}

/* Seed consent because the browser-side bar overlays the CTA; this does not fake server state. */
async function withConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/* The dropdowns are custom controls with no accessible name, so `data-err` is the only stable
   anchor. Fixed fields carry it on the input, quote fields on the wrapper. */
async function pickDropdown(page, field, label) {
  await page.locator(`[data-err="${field}"] .dz-dropdown__trigger`).click();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test.describe('packers & movers landing, live', () => {
  const PAGE = '/services/packers-movers';
  const estimator = (page) =>
    page.locator('section').filter({ has: page.getByRole('heading', { name: 'Instant moving-cost estimate' }) });

  test('the estimate is arithmetic on the home size, not a fixed banner', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);

    await expect(page.locator('h1')).toContainText('in & from Pune');
    await expect(page.getByRole('heading', { name: 'Get a Free Quote' })).toBeVisible();

    const est = estimator(page);
    const out = est.locator('.gradient-text');

    // Defaults: 2 BHK, within Pune, standard packing, ground/lift.
    await expect(out).toContainText('₹9,000');
    await expect(out).toContainText('₹18,000');

    await est.locator('.dz-dropdown__trigger').first().click();
    await page.getByRole('option', { name: '4 BHK / Villa' }).click();

    // Both bounds, both directions: a widget rendering every range at once would pass the new figures alone.
    await expect(out).toContainText('₹22,000');
    await expect(out).toContainText('₹40,000');
    await expect(out).not.toContainText('₹9,000');
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('service landing hero', () => {
  /* The widths live in ServiceLanding, so one landing proves the contract for all three. */
  const HERO_WIDTHS = [640, 960, 1280, 1600];

  /** Parse a `srcset` into `[{ url, descriptor }]`, splitting only on the commas between candidates. */
  function parseSrcSet(srcset) {
    return srcset
      .split(/,\s*(?=https?:)/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const gap = entry.lastIndexOf(' ');
        return { url: entry.slice(0, gap), descriptor: entry.slice(gap + 1) };
      });
  }

  test('is a real <img> carrying the full responsive contract', async ({ page, consoleErrors }) => {
    await page.goto('/services/packers-movers');

    // The h1 sitting directly above the image is what justifies its empty alt.
    const hero = page.locator('section').filter({ has: page.locator('h1') }).first();
    await expect(hero.locator('h1')).toBeVisible();
    expect((await hero.locator('h1').innerText()).trim()).not.toBe('');

    const img = hero.locator('img');
    await expect(img, 'exactly one hero image, and it is an <img> not a background div').toHaveCount(1);

    const src = await img.getAttribute('src');
    expect(src, 'the hero still has a plain src to fall back to').toBeTruthy();

    const srcset = await img.getAttribute('srcset');
    expect(srcset, 'srcset is rendered (srcSetFor returns undefined for a URL with no w= param)').toBeTruthy();

    const candidates = parseSrcSet(srcset);
    expect(candidates.map((c) => c.descriptor)).toEqual(HERO_WIDTHS.map((w) => `${w}w`));

    const base = (url) => url.split('?')[0];
    for (const [i, candidate] of candidates.entries()) {
      const width = HERO_WIDTHS[i];
      expect(base(candidate.url), `candidate ${width}w points at the hero asset`).toBe(base(src));
      const params = new URLSearchParams(candidate.url.split('?')[1] || '');
      expect(params.get('w'), `candidate ${width}w asks the image host for ${width}px`).toBe(String(width));
      expect(params.get('q')).toBe(new URLSearchParams(src.split('?')[1] || '').get('q'));
    }

    // Without `sizes` the ladder is useless; LCP hints and intrinsic size guard speed and CLS.
    await expect(img).toHaveAttribute('sizes', '100vw');
    await expect(img).toHaveAttribute('fetchpriority', 'high');
    await expect(img).toHaveAttribute('decoding', 'async');
    await expect(img).toHaveAttribute('width', '1600');
    await expect(img).toHaveAttribute('height', '900');

    await expect(img).toHaveAttribute('alt', '');
    const cls = (await img.getAttribute('class')) || '';
    expect(cls, 'object-cover/object-center reproduce the old bg-cover bg-center exactly').toContain('object-cover');
    expect(cls).toContain('object-center');

    // `img.currentSrc` is deliberately not asserted: which rung loads is the browser's decision.
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('property valuation landing, live', () => {
  const PAGE = '/services/property-valuation';

  test('the instant estimate recomputes from the carpet area, and is a figure not a placeholder', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);

    await expect(page.getByRole('heading', { name: 'Instant Valuation Estimate' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request a Certified Valuation Report' })).toBeVisible();

    const widget = page.locator('.svc-quote');
    const out = widget.locator('.gradient-text');

    // `est` returns null for an area of 0 and the widget renders an em dash, so anchor on a real figure first.
    await expect(out).toContainText('₹');
    const before = await out.innerText();

    await widget.locator('input[type=number]').fill('2500');
    await expect(out).not.toHaveText(before);
    await expect(out).toContainText('₹');
    expect(consoleErrors).toEqual([]);
  });

  test('the certified report is gated behind sign-in, and the gate remembers where it interrupted', async ({ page }) => {
    await page.goto(PAGE);

    await page.locator('form').getByRole('button', { name: 'Request Valuation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    // `next=` makes the gate an interruption rather than a dead end; the draft is restored only if the return happens.
    await expect(page).toHaveURL(nextParam(PAGE));
  });

  test('for a signed-in visitor the form is addressed to the session, and submitting files the request', async ({ page }) => {
    const { user } = await apiLogin(ACTORS.buyer);
    expect(user.name).toBeTruthy();

    await signIn(page, ACTORS.buyer);
    await page.goto(PAGE);

    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'Request Valuation' })).toBeVisible();
    await expectFormAddressedToSession(page, user);

    // `purpose` is required, so a bare click would fail validation and stay on the page — which would
    // look the same as an open gate if only the URL were checked.
    await pickDropdown(page, 'purpose', 'Home loan / Mortgage');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && /\/service-requests(\?|$)/.test(r.url()), { timeout: 15000 });
    await form.getByRole('button', { name: 'Request Valuation' }).click();

    expect((await posted).postDataJSON().type).toBe('valuation');
    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/signin/);
  });
});

test.describe('interior & renovation landing, live', () => {
  const PAGE = '/services/interior-renovation';

  test('the FAQ opens only the clicked question and the before/after slider moves the divider', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);

    await expect(page.getByRole('heading', { name: 'See the Transformation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Book a Free Design Consultation' })).toBeVisible();

    await test.step('FAQ accordion', async () => {
      const questions = page.locator('.faq-q');
      await expect(questions.first()).toHaveAttribute('aria-expanded', 'false');

      await questions.first().click();
      await expect(questions.first()).toHaveAttribute('aria-expanded', 'true');
      // An accordion that opened every panel at once would pass the line above.
      await expect(questions.nth(1)).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('before/after slider', async () => {
      const range = page.locator('.ba-range');
      const after = page.locator('.ba-after');
      const before = await after.getAttribute('style');
      expect(before).toBeTruthy();

      await range.focus();
      for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');

      // `getAttribute()` does not retry; `not.toHaveAttribute` waits for exactly the change expected.
      await expect(after).not.toHaveAttribute('style', before);
    });

    expect(consoleErrors).toEqual([]);
  });

  test('booking the consultation is gated behind sign-in, and the gate remembers where it interrupted', async ({ page }) => {
    await page.goto(PAGE);

    await page.getByRole('button', { name: 'Book My Consultation' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    await expect(page).toHaveURL(nextParam(PAGE));
  });

  test('for a signed-in visitor the form opens addressed to the session, not to this browser', async ({ page }) => {
    const { user } = await apiLogin(ACTORS.buyer);
    expect(user.name).toBeTruthy();

    await signIn(page, ACTORS.buyer);
    await page.goto(PAGE);

    await expectFormAddressedToSession(page, user);
  });
});

test.describe('home loans landing, live', () => {
  const PAGE = '/home-loans';

  /** Read the loans desk as the staffer who works it. */
  async function loansQueue() {
    const res = await fetch(`${API}/tickets?team=loans&size=100`, { headers: await authHeaders(STAFF.loans) });
    expect(res.status, 'the loans desk is readable by its own staff').toBe(200);
    return (await res.json())?.content || [];
  }

  const idsOf = (rows) => new Set(rows.map((r) => r.id));

  test('the EMI figure recomputes when the loan amount moves', async ({ page, consoleErrors }) => {
    await withConsent(page);
    await page.goto(PAGE);

    await expect(page.getByRole('heading', { name: 'Check Your Eligibility' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compare Home Loan Rates' })).toBeVisible();

    const emiCalc = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Plan your EMI before you apply' }) });
    const emi = emiCalc.locator('.gradient-text');
    await expect(emi).toContainText(/₹[\d,]+/);
    const before = await emi.innerText();

    // First slider is the loan amount (min 5L, max 3Cr, step 1L).
    const amount = emiCalc.locator('input[type=range]').first();
    await amount.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');

    await expect(emi).not.toHaveText(before);
    expect(consoleErrors).toEqual([]);
  });

  test('a signed-out request for offers is sent to sign-in, and files nothing on the loans desk', async ({ page }) => {
    // Signed into the desk first: an absence on a desk nobody can read is not an absence.
    const desk = await apiLogin(STAFF.loans);
    expect(desk.accessToken).toBeTruthy();
    const before = idsOf(await loansQueue());

    await withConsent(page);
    await page.goto(PAGE);

    // Record ticket POSTs so absence is about what the browser sent, not a later read racing an in-flight request.
    const ticketPosts = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/tickets') && r.method() === 'POST') ticketPosts.push(r.url());
    });

    // A valid form, so validation cannot explain the absence.
    await pickDropdown(page, 'loanType', 'Home Purchase Loan');
    await page.locator('[data-err="amount"] input').fill('5000000');
    await page.locator('input[data-err="name"]').fill('Gate Probe');
    await page.locator('[data-err="mobile"] input').fill('9812345678');

    await page.getByRole('button', { name: 'Get Loan Offers' }).click();

    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=service/);
    await expect(page).toHaveURL(nextParam(PAGE));

    // The redirect is not the claim: a gate that bounces the browser *after* posting makes the same URL.
    expect(ticketPosts, 'a signed-out press sends no ticket request at all').toEqual([]);

    const arrived = (await loansQueue()).filter((t) => !before.has(t.id));
    expect(arrived, 'a signed-out press files no enquiry').toHaveLength(0);
  });

  // Pin against /auth/me: the form initialises once, but AuthContext may replace the cached user afterwards.
  test('the quote form already knows a signed-in customer, without being told', async ({ page }) => {
    await withConsent(page);
    await signedInAs(page, ACTORS.buyer);

    const me = await fetch(`${API}/auth/me`, { headers: await authHeaders(ACTORS.buyer) });
    expect(me.status, 'the session the browser is holding is readable').toBe(200);
    const user = await me.json();
    expect(user?.name, 'this actor has a name for the form to copy').toBeTruthy();
    await page.goto(PAGE);

    await expectFormAddressedToSession(page, user);
  });
});

test.describe('LIVE: Property Legal', () => {
  const PAGE = '/services/property-legal';
  const SERVICE_OPTION = 'Stamp Duty & Registration Charges';

  const calculatorOf = (page) =>
    page.locator('section').filter({ has: page.getByRole('heading', { name: 'Estimate your stamp duty & registration' }) });

  const ticketIds = async (page, headers) => {
    const response = await page.request.get(`${API}/tickets?team=legal&size=100`, { headers });
    expect(response.status()).toBe(200);
    const body = await response.json();
    return new Set((body.content || []).map((ticket) => ticket.id));
  };

  test('the calculator prices a Pune municipal sale at the single PMC/PCMC 7% rate', async ({ page, consoleErrors }) => {
    await page.goto(PAGE);
    await appReady(page);

    const calculator = calculatorOf(page);
    const total = calculator.locator('.gradient-text');

    await expect(total).toHaveText('₹5,55,000');
    await expect(calculator.getByText('Stamp duty (7%)')).toBeVisible();
    await expect(calculator.getByText('₹5.3 L')).toBeVisible();
    await expect(calculator.getByText('₹30,000')).toBeVisible();
    await expect(calculator.locator('.dz-dropdown__trigger')).toHaveCount(0);
    await expect(calculator.getByText(/women|female/i)).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
  });

  test('a legal enquiry reaches the Legal desk and its tracker request names the linked ticket', async ({ page }) => {
    const desk = await authHeaders(STAFF.legal);
    const beforeIds = await ticketIds(page, desk);

    await signIn(page, ACTORS.tenant);
    await page.goto(PAGE);
    await appReady(page);
    await pickDropdown(page, 'service', SERVICE_OPTION);
    await page.locator('#quote').getByRole('button', { name: 'Request Assistance' }).click();
    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible();

    let lead = null;
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/tickets?team=legal&size=100`, { headers: desk });
      const body = await response.json();
      lead = (body.content || []).find((ticket) => !beforeIds.has(ticket.id));
      return lead ? 1 : 0;
    }, { timeout: 15_000 }).toBe(1);
    expect(lead.team).toBe('legal');
    expect(lead.subject).toBe(SERVICE_OPTION);

    const mine = await authHeaders(ACTORS.tenant);
    let tracked = null;
    await expect.poll(async () => {
      const response = await page.request.get(`${API}/service-requests?type=legal`, { headers: mine });
      const body = await response.json();
      tracked = (body.content || []).find((request) => request.ticketId === lead.id);
      return tracked ? 1 : 0;
    }, { timeout: 15_000 }).toBe(1);
    expect(tracked.type).toBe('legal');
    expect(tracked.ticketId).toBe(lead.id);
    await expect(page.getByRole('heading', { name: 'Your legal & registration requests' })).toBeVisible();
    await expect(page.getByRole('paragraph').filter({ hasText: /^Property & Legal$/ })).toBeVisible();
    await expect(page.getByText(tracked.id.slice(0, 10), { exact: false })).toBeVisible();
  });

  test('a filing the server refuses says so, and the retry files it without raising a second lead', async ({ page }) => {
    await signIn(page, ACTORS.tenant);
    await page.goto(PAGE);
    await appReady(page);
    await pickDropdown(page, 'service', SERVICE_OPTION);

    let ticketPosts = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/api\/tickets(\?|$)/.test(request.url())) ticketPosts += 1;
    });
    let refuseNext = true;
    await page.route(/\/api\/service-requests(\?|$)/, (route) => {
      if (route.request().method() === 'POST' && refuseNext) {
        refuseNext = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL","message":"down"}' });
      }
      return route.continue();
    });

    const quote = page.locator('#quote');
    await quote.getByRole('button', { name: 'Request Assistance' }).click();
    await expect(quote.getByRole('alert')).toContainText("We couldn't file this");
    await expect(page.getByRole('heading', { name: 'Request received!' })).toHaveCount(0);

    await quote.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('heading', { name: 'Request received!' })).toBeVisible();
    expect(ticketPosts, 'the retry re-files the request, not the callback lead').toBe(1);
  });
});
