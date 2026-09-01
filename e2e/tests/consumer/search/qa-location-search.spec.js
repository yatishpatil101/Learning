import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* ─────────────────────────────────────────────────────────────────────────────
   QA SWEEP — Home search bar → Listings, combined with Localities + Near-a-Place.
   Acts as a data-driven E2E harness: every scenario is checked against an
   AUTHORITATIVE ORACLE computed from the app's own source modules (mockApi +
   geo.propLatLng), so "expected" is never hand-maintained. Findings are collected
   into a report and printed at the end for the QA analysis.
   ───────────────────────────────────────────────────────────────────────────── */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const HERO = '.hero-search-wrap';
const INPUT = 'input[aria-label="Search localities, societies or landmarks"]';
const report = [];
const record = (r) => { report.push(r); console.log('QA ' + JSON.stringify(r)); };

// NOTE: not serial — each scenario is independent so one failure never hides the rest.

// ── Oracle: approved listings for a deal, narrowed by locality slugs and/or a
//    lat,lng proximity radius, using the SAME modules the app filters with.
//    Proximity is measured against the listing's *stored* `lat`/`lng` — the pair the API returns
//    and `listProperties` stamps onto seed rows — not against a position computed for the map.
//    Those were once different numbers, and the oracle measuring the display one is what made a
//    radius search look correct while the filter had nothing to filter on. ────────────────────────
function oracleCount(page, { deal, locs = null, near = null, radiusKm = 5 }) {
  return page.evaluate(async ({ deal, locs, near, radiusKm }) => {
    const { listProperties } = await import('/src/lib/mockApi.js');
    let rows = (await listProperties({ includeAllStatuses: false }, 'newest'))
      .filter((p) => p.status === 'approved' && p.deal === deal);
    if (locs && locs.length) { const S = new Set(locs); rows = rows.filter((p) => S.has(p.localitySlug)); }
    if (near) {
      const [la, ln] = near.split(',').map(Number);
      const R = 6371, toRad = (x) => (x * Math.PI) / 180;
      const hav = (a, b, c, d) => {
        const dLat = toRad(c - a), dLon = toRad(d - b);
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
      };
      rows = rows.filter((p) => p.lat != null && p.lng != null && hav(la, ln, p.lat, p.lng) <= radiusKm);
    }
    return rows.length;
  }, { deal, locs, near, radiusKm });
}

// One-time discovery of the seed: locality inventory + which societies/landmarks
// surface, so scenarios stay robust to seed changes.
function discover(page) {
  return page.evaluate(async () => {
    const { listProperties } = await import('/src/lib/mockApi.js');
    const { allLocalities } = await import('/src/data/localities.js');
    const rows = (await listProperties({ includeAllStatuses: false }, 'newest')).filter((p) => p.status === 'approved');
    const byDeal = (deal) => {
      const m = {};
      rows.filter((p) => p.deal === deal).forEach((p) => { m[p.localitySlug] = (m[p.localitySlug] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const allSlugs = new Set(allLocalities().map((l) => l.slug));
    const stocked = new Set(rows.map((p) => p.localitySlug));
    const emptyLoc = [...allSlugs].find((s) => !stocked.has(s)) || null;
    return { total: rows.length, buy: byDeal('buy'), rent: byDeal('rent'), emptyLoc };
  });
}

const num = (s) => { const m = String(s).replace(/,/g, '').match(/\d+/); return m ? Number(m[0]) : NaN; };

async function gotoHome(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/`);
  await page.locator(HERO).waitFor({ timeout: 15000 });
}

async function shownCount(page) {
  // The count line is rendered twice (mobile `sm:hidden` + desktop `hidden sm:flex`);
  // only one is visible per viewport, so scope to the visible one — a plain .first()
  // would grab the hidden mobile copy on a desktop viewport and never resolve.
  const p = page.locator('main p:visible', { hasText: /Showing/ }).first();
  await p.waitFor({ timeout: 10000 });
  // Refining a search keeps the previous page on screen rather than flashing skeletons, so for a
  // moment the number here is the *previous* query's answer. The page marks that with `aria-busy`;
  // reading through it is how this spec once compared a pre-filter count against a filtered oracle.
  await expect(p).not.toHaveAttribute('aria-busy', 'true', { timeout: 10000 });
  return num(await p.locator('span.text-teal-400').first().textContent());
}

// Pick a hero suggestion by visible label; returns the kind label it carried.
async function heroPick(page, typed, label) {
  const input = page.locator(`${HERO} ${INPUT}`);
  await input.fill(typed);
  const row = page.locator(`${HERO} .loc-sugg`, { hasText: label }).first();
  await expect(row).toBeVisible({ timeout: 6000 });
  const kind = (await row.locator('.loc-sugg-kind').count()) ? (await row.locator('.loc-sugg-kind').first().textContent()).trim() : 'Locality';
  await row.click();
  return kind;
}

// Assert every result card's locality text is within the allowed set of names.
async function assertCardsInLocalities(page, allowedNames) {
  const cards = page.locator('a[href^="/property/"]');
  const n = Math.min(await cards.count(), 12);
  const bad = [];
  for (let i = 0; i < n; i++) {
    const t = (await cards.nth(i).textContent()) || '';
    if (!allowedNames.some((nm) => t.includes(nm))) bad.push(t.replace(/\s+/g, ' ').slice(0, 60));
  }
  return bad;
}

let seed;

test('0 — discover seed inventory', async ({ page }) => {
  await gotoHome(page);
  seed = await discover(page);
  record({ scenario: 'seed', total: seed.total, topBuy: seed.buy.slice(0, 6), topRent: seed.rent.slice(0, 6), emptyLoc: seed.emptyLoc });
  expect(seed.total).toBeGreaterThan(0);
});

test('A — home: single locality (Buy) → ?loc=, chips, oracle count, card localities', async ({ page }) => {
  await gotoHome(page);
  await heroPick(page, 'Baner', 'Baner');
  await expect(page.locator(`${HERO} .loc-chip`)).toHaveCount(1);
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  const oracle = await oracleCount(page, { deal: 'buy', locs: ['baner'] });
  const bad = await assertCardsInLocalities(page, ['Baner']);
  record({ scenario: 'A single-locality-buy', deal: sp.get('deal'), loc: sp.get('loc'), ui, oracle, match: ui === oracle, offLocalityCards: bad });
  expect.soft(sp.get('loc')).toBe('baner');
  expect.soft(ui).toBe(oracle);
  expect.soft(bad, 'cards outside Baner: ' + bad.join(' | ')).toEqual([]);
});

test('B — home: two localities (Buy) → CSV union, oracle count', async ({ page }) => {
  await gotoHome(page);
  await heroPick(page, 'Wakad', 'Wakad');
  await heroPick(page, 'Baner', 'Baner');
  await expect(page.locator(`${HERO} .loc-chip`)).toHaveCount(2);
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const locs = (sp.get('loc') || '').split(',').filter(Boolean);
  const ui = await shownCount(page);
  const oracle = await oracleCount(page, { deal: 'buy', locs });
  const bad = await assertCardsInLocalities(page, ['Wakad', 'Baner']);
  record({ scenario: 'B two-localities-buy', loc: sp.get('loc'), ui, oracle, match: ui === oracle, offLocalityCards: bad });
  expect.soft(locs.sort()).toEqual(['baner', 'wakad']);
  expect.soft(ui).toBe(oracle);
  expect.soft(bad).toEqual([]);
});

test('C — home: locality + BHK (Buy) → ?loc=&bhk=, oracle', async ({ page }) => {
  await gotoHome(page);
  await heroPick(page, 'Wakad', 'Wakad');
  await page.locator(`${HERO} button[aria-haspopup="listbox"]`, { hasText: /BHK/ }).click();
  await page.locator(`${HERO} .search-dd-opt`, { hasText: '2 BHK' }).first().click();
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  // Oracle for loc only (bhk handled by app); we report both to see BHK narrowing.
  const oracleLoc = await oracleCount(page, { deal: 'buy', locs: ['wakad'] });
  record({ scenario: 'C locality+bhk-buy', loc: sp.get('loc'), bhk: sp.get('bhk'), ui, oracleLocOnly: oracleLoc, bhkNarrows: ui <= oracleLoc });
  expect.soft(sp.get('loc')).toBe('wakad');
  expect.soft(sp.get('bhk')).toBe('2');
  expect.soft(ui).toBeLessThanOrEqual(oracleLoc);
});

test('D — home: Rent tab + locality → ?deal=rent, oracle', async ({ page }) => {
  await gotoHome(page);
  await page.locator(`${HERO} .search-tab`, { hasText: 'Rent' }).click();
  await heroPick(page, 'Viman', 'Viman Nagar');
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  const oracle = await oracleCount(page, { deal: 'rent', locs: ['viman-nagar'] });
  const bad = await assertCardsInLocalities(page, ['Viman Nagar']);
  record({ scenario: 'D rent+locality', deal: sp.get('deal'), loc: sp.get('loc'), ui, oracle, match: ui === oracle, offLocalityCards: bad });
  expect.soft(sp.get('deal')).toBe('rent');
  expect.soft(ui).toBe(oracle);
  expect.soft(bad).toEqual([]);
});

test('E — home: society suggestion (if seeded) → ?soc=&loc=, non-empty', async ({ page }) => {
  await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);
  let society = null;
  for (const ch of 'abcdefghijklmnoprstuvw'.split('')) {
    if (society) break;
    await input.fill(ch);
    await page.waitForTimeout(120);
    const rows = await page.$$eval(`${HERO} .loc-sugg`, (els) => els.map((r) => ({
      label: r.querySelector('.truncate')?.textContent?.trim() || '',
      kind: (r.querySelector('.loc-sugg-kind')?.textContent || '').trim(),
    })));
    const s = rows.find((r) => /^Society/.test(r.kind));
    if (s) society = s.label;
  }
  if (!society) { record({ scenario: 'E society', skipped: 'no society suggestion in seed' }); test.skip(true, 'no society'); return; }
  await input.fill(society.slice(0, Math.max(3, Math.min(society.length, 6))));
  const socRow = page.locator(`${HERO} .loc-sugg`, { hasText: society }).first();
  await expect(socRow).toBeVisible({ timeout: 6000 });
  await socRow.click();
  await expect(page.locator(`${HERO} .loc-chip`, { hasText: society })).toBeVisible({ timeout: 4000 });
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  record({ scenario: 'E society', society, soc: sp.get('soc'), loc: sp.get('loc'), ui, nonEmpty: ui > 0 });
  expect.soft(sp.get('soc')).toBeTruthy();
  expect.soft(sp.get('loc'), 'society should carry parent locality').toBeTruthy();
  expect.soft(ui).toBeGreaterThan(0);
});

test('F — home: landmark suggestion (if seeded) → ?near=&nearlabel=&loc=, within radius', async ({ page }) => {
  await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);
  let landmark = null;
  for (const ch of 'abcdefghijklmnoprstuvw'.split('')) {
    if (landmark) break;
    await input.fill(ch);
    await page.waitForTimeout(120);
    const rows = await page.$$eval(`${HERO} .loc-sugg`, (els) => els.map((r) => ({
      label: r.querySelector('.truncate')?.textContent?.trim() || '',
      kind: (r.querySelector('.loc-sugg-kind')?.textContent || '').trim(),
    })));
    const l = rows.find((r) => /^Landmark/.test(r.kind));
    if (l) landmark = l.label;
  }
  if (!landmark) { record({ scenario: 'F landmark', skipped: 'no landmark suggestion in seed' }); test.skip(true, 'no landmark'); return; }
  await input.fill(landmark.slice(0, Math.max(3, Math.min(landmark.length, 6))));
  await page.locator(`${HERO} .loc-sugg`, { hasText: landmark }).first().click();
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  const near = sp.get('near');
  const loc = sp.get('loc');
  // The landmark was GATED as having live stock within 5km, and it attaches BOTH a
  // proximity point AND a parent locality. The app ANDs loc ∩ near, so measure both:
  //  - oracleNearOnly: what the gating promised (listings within 5km)
  //  - oracleCombined: what the app actually computes (loc ∩ near) == what UI shows
  const oracleNearOnly = near ? await oracleCount(page, { deal: 'buy', near, radiusKm: 5 }) : null;
  const oracleCombined = near ? await oracleCount(page, { deal: 'buy', locs: loc ? [loc] : null, near, radiusKm: 5 }) : null;
  const deadEnd = oracleNearOnly > 0 && ui === 0;
  record({ scenario: 'F landmark', landmark, near, nearlabel: sp.get('nearlabel'), loc, ui, oracleNearOnly, oracleCombined, appMathCorrect: ui === oracleCombined, DEAD_END: deadEnd });
  expect.soft(near).toBeTruthy();
  expect.soft(sp.get('nearlabel')).toBeTruthy();
  // The app's own filter math must be internally consistent with loc ∩ near.
  expect.soft(ui).toBe(oracleCombined);
  // UX invariant the code claims ("a suggestion can never dead-end"): a gated landmark
  // with nearby stock must not yield an empty page.
  expect.soft(deadEnd, `landmark "${landmark}" dead-ends: ${oracleNearOnly} listings within 5km but UI shows ${ui} (parent loc="${loc}")`).toBe(false);
});

test('G — home: free text + Search (no explicit pick) promotes best suggestion', async ({ page }) => {
  await gotoHome(page);
  const input = page.locator(`${HERO} ${INPUT}`);
  await input.fill('Kothrud');
  // Wait for the suggestions to actually render, then deliberately ignore them: the point of this
  // scenario is free-text search, and skipping the list before it exists would prove nothing.
  await expect(page.locator(`${HERO} .loc-sugg`).first()).toBeVisible();
  // Do NOT click a suggestion — hit Search directly.
  await page.locator(`${HERO} .search-btn`).click();
  await page.waitForURL(/\/listings\?/, { timeout: 8000 });
  const sp = new URL(page.url()).searchParams;
  const ui = await shownCount(page);
  const promoted = sp.get('loc') === 'kothrud';
  const oracle = await oracleCount(page, { deal: 'buy', locs: ['kothrud'] });
  record({ scenario: 'G freetext-promote', loc: sp.get('loc'), q: sp.get('q'), ui, oracle, promotedToLoc: promoted, match: ui === oracle });
  expect.soft(promoted, 'typed locality should promote to ?loc= not weak ?q=').toBe(true);
});

test('H — listings: Near-a-Place (stubbed Google) applies + oracle within radius', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`${BASE}/listings`);
  const filters = page.locator('aside:has(h3:has-text("Filters"))').first();
  await filters.waitFor();
  await page.waitForFunction(() => window.google?.maps?.version, { timeout: 12000 }).catch(() => {});
  // Stub Places → deterministic POI in Hinjawadi.
  await page.evaluate(() => {
    const placeObj = {
      addressComponents: [{ types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Hinjawadi' }],
      location: { lat: () => 18.5913, lng: () => 73.7389 },
      displayName: 'Hinjawadi IT Park', formattedAddress: 'Hinjawadi IT Park, Pune',
    };
    const prediction = {
      placeId: 'near-place-id', text: { toString: () => 'Hinjawadi IT Park' },
      mainText: { toString: () => 'Hinjawadi IT Park' }, secondaryText: { toString: () => 'Hinjawadi, Pune' },
      toPlace: () => ({ ...placeObj, fetchFields: async () => ({}) }),
    };
    const Fake = { fetchAutocompleteSuggestions: async () => ({ suggestions: [{ placePrediction: prediction }] }) };
    window.google = window.google || {}; window.google.maps = window.google.maps || {};
    window.google.maps.places = window.google.maps.places || {};
    window.google.maps.places.AutocompleteSessionToken = class {};
    const real = window.google.maps.importLibrary ? window.google.maps.importLibrary.bind(window.google.maps) : null;
    window.google.maps.importLibrary = async (n) => (n === 'places' ? { AutocompleteSuggestion: Fake } : (real ? real(n) : {}));
  });
  const group = filters.locator('.filter-group:has(h4:has-text("Near a Place"))').first();
  await group.locator('h4.fg-header').first().click();
  await group.locator('.pn-dropdown__trigger').first().click();
  await page.locator('.pn-dropdown__menu--portal input').fill('Hinj');
  await page.locator('.pn-dropdown__menu--portal [role="option"]', { hasText: 'Hinjawadi IT Park' }).first().click();
  await expect(group.locator('input[type="range"]')).toBeVisible();
  await page.waitForFunction(() => new URL(location.href).searchParams.get('near'), null, { timeout: 8000 }).catch(() => {});
  const sp = new URL(page.url()).searchParams;
  const near = sp.get('near');
  const radius = Number(sp.get('nearr') || 5);
  const ui = await shownCount(page);
  const oracle = near ? await oracleCount(page, { deal: 'buy', near, radiusKm: radius }) : null;
  const relevant = errors.filter((e) => !/favicon|leaflet|CDN|net::ERR|DevTools/i.test(e));
  record({ scenario: 'H near-a-place', near, radiusKm: radius, ui, oracle, match: ui === oracle, consoleErrors: relevant.length });
  expect.soft(near).toBeTruthy();
  expect.soft(ui).toBe(oracle);
  expect.soft(relevant).toEqual([]);
});

test('I — deep-link: loc + near combined (AND) matches oracle intersection', async ({ page }) => {
  // Hinjawadi IT Park coords, 3km, intersect with Hinjawadi locality.
  const near = '18.5912,73.7389';
  await page.goto(`${BASE}/listings?deal=buy&loc=hinjawadi&near=${near}&nearlabel=Hinjawadi%20IT%20Park&nearr=3`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const ui = await shownCount(page);
  const oracle = await oracleCount(page, { deal: 'buy', locs: ['hinjawadi'], near, radiusKm: 3 });
  const chipLoc = await page.locator('.af-chip', { hasText: 'Hinjawadi' }).count();
  const chipNear = await page.locator('.af-chip', { hasText: /Near/ }).count();
  record({ scenario: 'I loc+near AND', ui, oracle, match: ui === oracle, chipLoc, chipNear });
  expect.soft(ui).toBe(oracle);
  expect.soft(chipNear).toBeGreaterThan(0);
});

test('J — deep-link: near radius 3km ≤ 10km monotonic + oracle', async ({ page }) => {
  const near = '18.5912,73.7389';
  await page.goto(`${BASE}/listings?deal=buy&near=${near}&nearlabel=Hinjawadi%20IT%20Park&nearr=3`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const ui3 = await shownCount(page);
  const or3 = await oracleCount(page, { deal: 'buy', near, radiusKm: 3 });
  await page.goto(`${BASE}/listings?deal=buy&near=${near}&nearlabel=Hinjawadi%20IT%20Park&nearr=10`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const ui10 = await shownCount(page);
  const or10 = await oracleCount(page, { deal: 'buy', near, radiusKm: 10 });
  record({ scenario: 'J near-radius', ui3, or3, ui10, or10, match3: ui3 === or3, match10: ui10 === or10, monotonic: ui10 >= ui3 });
  expect.soft(ui3).toBe(or3);
  expect.soft(ui10).toBe(or10);
  expect.soft(ui10).toBeGreaterThanOrEqual(ui3);
});

test('K — deep-link: near "min" mode = radius*0.4 km', async ({ page }) => {
  const near = '18.5912,73.7389';
  await page.goto(`${BASE}/listings?deal=buy&near=${near}&nearlabel=Hinjawadi%20IT%20Park&nearr=15&nearmode=min`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const ui = await shownCount(page);
  const oracle = await oracleCount(page, { deal: 'buy', near, radiusKm: 15 * 0.4 });
  record({ scenario: 'K near-min-mode', nearr: 15, mode: 'min', effKm: 6, ui, oracle, match: ui === oracle });
  expect.soft(ui).toBe(oracle);
});

test('L — deep-link: zero-inventory locality → empty state + broaden', async ({ page }) => {
  const slug = seed?.emptyLoc || 'moshi';
  await page.goto(`${BASE}/listings?deal=buy&loc=${slug}`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const ui = await shownCount(page);
  const empty = await page.locator('text=No properties found').count();
  const broaden = await page.locator('button', { hasText: /Search all localities/ }).count();
  record({ scenario: 'L empty-locality', slug, ui, emptyState: empty > 0, broadenOffered: broaden > 0 });
  expect.soft(ui).toBe(0);
  expect.soft(empty).toBeGreaterThan(0);
});

test('M — listings: remove locality chip broadens result set', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&loc=baner`);
  await page.locator('aside:has(h3:has-text("Filters"))').first().waitFor();
  const before = await shownCount(page);
  const allBuy = await oracleCount(page, { deal: 'buy' });
  await page.locator('.af-chip', { hasText: 'Baner' }).first().click();
  /* `shownCount()` reads through `page.evaluate`, which does not retry -- the sleep was
     load-bearing. The first replacement waited for the chip to leave the strip, and that was
     the wrong anchor for a specific and instructive reason: the chip strip renders from the
     live filter state, while the results render from the DEFERRED copy of it (`df`, see
     computeResults in listingsResultsPipeline.js:48). React's useDeferredValue exists in
     order to paint the old result set once before the new one, so the chip is guaranteed to
     vanish a render BEFORE the count moves. Anchoring on the chip did not merely fail to
     help -- it reliably read the stale number: before and after both came back 5 against an
     oracle of 29.
     The only honest anchor is the deferred render itself having landed. If it never lands
     this test should fail loudly rather than report a soft miss, because a locality chip
     that can be removed without the result set noticing is a defect, not a measurement. */
  await expect.poll(() => shownCount(page), { timeout: 10000 }).not.toBe(before);
  const after = await shownCount(page);
  record({ scenario: 'M remove-chip', before, after, allBuy, broadened: after > before, matchAll: after === allBuy });
  expect.soft(after).toBeGreaterThan(before);
  expect.soft(after).toBe(allBuy);
});

test('Z — print QA report', async () => {
  console.log('\n===== QA LOCATION-SEARCH REPORT =====');
  console.log(JSON.stringify(report, null, 2));
  console.log('===== END REPORT =====\n');
});
