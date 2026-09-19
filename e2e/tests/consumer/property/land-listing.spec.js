/* A plot is priced by the guntha, zoned rather than measured in bedrooms, and must match the Land-use filter
 * reading `properties.land_use`. The API is driven: the claim is what the server stores and the page renders.
 */
import { ACTORS, expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/* `uniqueMobile()` is `Date.now()`-derived, so two calls in the same millisecond return the same
   number — which would silently make two "different" owners one owner. */
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

/* Split the way the wizard splits them: `openSides`, `plotZone` and the NA order are asked of a plot only,
   the water source and 7/12 extract of a farm only. `landUse` is the zoning in the column's own vocabulary. */
const PROFILES = {
  plot: {
    typeKey: 'plot',
    propertyType: 'Open Plot',
    areaUnit: 'guntha',
    area: 12,
    unitLabel: '12 Guntha',
    landUse: 'residential',
    zoneLabel: 'Residential',
    formDetails: {
      plotZone: 'Residential',
      openSides: '2',
      roadWidth: '30',
      plotLength: '60',
      plotWidth: '40',
      cornerPlot: true,
      /* Posted against the retired boolean on purpose: plots published before the three-state
         picker existed must keep rendering, under the row that replaced it. */
      naSanctioned: true,
      otherRights: 'mortgage',
    },
    // Rendered rows, in the words the detail page uses for them.
    facts: [['Plot dimensions', '60 × 40 ft'], ['Approach road', '30 ft'], ['Open sides', '2'],
      ['Corner plot', 'Yes'], ['NA status', 'NA order sanctioned'],
      ['Other Rights (7/12)', 'Bank charge / mortgage recorded']],
  },
  farm: {
    typeKey: 'farmland',
    propertyType: 'Farm Land',
    areaUnit: 'acre',
    area: 2,
    unitLabel: '2 Acre',
    landUse: 'agricultural',
    zoneLabel: 'Agricultural',
    formDetails: {
      waterSource: 'Borewell',
      roadWidth: '20',
      boundaryWall: true,
      electricity: true,
      satbara: true,
      naStatus: 'agricultural',
      otherRights: 'tenancy',
    },
    facts: [['Approach road', '20 ft'], ['Water source', 'Borewell'], ['Boundary wall', 'Yes'],
      ['Electricity', 'Yes'], ['7/12 extract', 'Yes'],
      ['NA status', 'Still agricultural — no NA'],
      ['Other Rights (7/12)', 'Tenant / cultivator recorded']],
  },
};

/** Post as a brand-new owner, then approve as admin — the one route that publishes. */
async function publish(request, profile, deal, title) {
  const res = await request.post(`${API}/me/listings`, {
    headers: await authHeaders(newOwner()),
    data: {
      title,
      deal,
      propertyType: profile.propertyType,
      price: deal === 'rent' ? 18000 : 6500000,
      locality: 'Wagholi',
      city: 'Pune',
      area: profile.area,
      areaUnit: profile.areaUnit,
      landUse: profile.landUse,
      facing: 'East',
      formDetails: profile.formDetails,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { id } = await res.json();

  const approved = await request.patch(`${API}/properties/${id}/status`, {
    headers: await authHeaders(ACTORS.admin),
    data: { status: 'approved' },
  });
  expect(approved.status(), await approved.text()).toBeLessThan(300);
  return id;
}

for (const [name, profile] of Object.entries(PROFILES)) {
  for (const deal of ['buy', 'rent']) {
    test(`a ${deal} ${name} renders its own unit and its land answers, and its own Land-use filter finds it`, async ({ page, request }) => {
      const title = `Zztest ${name} ${deal} ${Date.now()}`;
      const id = await publish(request, profile, deal, title);

      await page.goto(`/property/${id}`);

      // The page composes its own headline from the type and locality, so the card grid — not the
      // posted title — is what says this listing rendered.
      const card = (label) => page.locator('.detail-card', { hasText: label });
      /* The unit the owner chose, and no per-sq.ft row at all: a plot priced by the guntha quoted under a
         sq.ft label is a wrong number, not a rounding. */
      await expect(card('Plot Area')).toContainText(profile.unitLabel);
      await expect(page.locator('.detail-card', { hasText: '/ sq.ft' })).toHaveCount(0);

      // The zoning, which used to read as the type label because the mapper never emitted it.
      await expect(card('Plot Zone')).toContainText(profile.zoneLabel);

      for (const [label, value] of profile.facts) {
        await expect(card(label)).toContainText(value);
      }

      /* The filter the column exists for. Nothing wrote `land_use` until this slice, so this
         search returned no wizard-posted plot at all. */
      await page.goto(`/listings?deal=${deal}&type=${profile.typeKey}&landuse=${profile.landUse}`);
      await expect(page.locator(`a[href="/property/${id}"]`)).toBeVisible();
    });
  }

  /* s.194-IA deducts 1% TDS above ₹50L but excludes agricultural land by its own terms, so the
     same price quotes a deduction on a plot and must stay silent on a farm. */
  test(`the buyer cost note quotes TDS on a ${name} only when its land use attracts it`, async ({ page, request }) => {
    const id = await publish(request, profile, 'buy', `Zztest ${name} tds ${Date.now()}`);
    await page.goto(`/property/${id}`);
    // The cost breakdown is a tab panel, and an unselected tab renders nothing at all.
    await page.getByRole('tab', { name: 'Price Insights' }).click();
    const tds = page.getByText('A 1% TDS is also deducted', { exact: false });
    await expect(tds).toHaveCount(profile.landUse === 'agricultural' ? 0 : 1);
  });
}
