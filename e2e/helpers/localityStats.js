import { API, authHeaders, uniqueMobile, uploadedListingPhotos } from './liveAuth.js';
import { ACTORS } from '../fixtures/live.js';
import { approveListingWithFetch } from './moderation.js';

const FLAT = { propertyType: 'Flat', city: 'Pune', bhk: 2, area: 1000 };
const FIXTURES = {
  rent: { deal: 'rent', price: 24000 },
  buy: { deal: 'buy', price: 9500000 },
};

const stats = async (slug) => (await fetch(`${API}/localities/${slug}`)).json();

// The Rent-o-meter needs a locality average for both deals, and a locality only has one once three live
// flats back each, which other specs' cleanup can take away again.
export async function ensureLocalityStats(name = 'Baner', slug = name.toLowerCase()) {
  const have = await stats(slug);
  const missing = [];
  if (have.avgRent == null) missing.push('rent');
  if (have.ratePerSqft == null) missing.push('buy');
  if (!missing.length) return;

  const admin = await authHeaders(ACTORS.admin);
  for (const deal of missing) {
    for (let i = 0; i < 3; i += 1) {
      const headers = await authHeaders(uniqueMobile());
      const res = await fetch(`${API}/me/listings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...FLAT, ...FIXTURES[deal], locality: name, title: `Zztest ${slug} ${deal} stats ${Date.now().toString(36)}${i}`,
          images: await uploadedListingPhotos(headers),
        }),
      });
      if (res.status !== 201) throw new Error(`stats fixture: ${res.status} ${await res.text()}`);
      const approved = await approveListingWithFetch((await res.json()).id, admin);
      if (approved.status !== 200) throw new Error(`stats fixture approve: ${approved.status} ${approved.text}`);
    }
  }
}