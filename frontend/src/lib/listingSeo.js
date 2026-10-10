/* One listing URL and one head per public listing or society page, shared by the app and the edge renderer
   (edge/seo-pages.mjs), so the canonical a crawler sees and the link a card renders cannot drift. Shape: plan D5. */
import { fmtArea, fmtINR } from './format.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_UUID = new RegExp(`^${UUID}$`, 'i');
const TRAILING_UUID = new RegExp(`(?:^|-)(${UUID})$`, 'i');

const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const bhkLabel = (bhk) => (bhk == null || bhk === '' ? '' : Number(bhk) === 0 ? '1 RK' : `${Number(bhk)} BHK`);

export function listingTitle({ bhk, type, deal, locality }) {
  return [bhkLabel(bhk), type || 'Property', 'for', deal === 'rent' ? 'Rent' : 'Sale', 'in', locality]
    .filter(Boolean).join(' ');
}

export const listingPrice = ({ deal, price }) => {
  if (!(Number(price) > 0)) return '';
  return deal === 'rent' ? `₹${Number(price).toLocaleString('en-IN')}/month` : fmtINR(price);
};

/** Head title and description; `l` carries the listing's bhk, type, deal, locality, price, area and areaUnit. */
export function listingHead(l) {
  const name = listingTitle(l);
  const price = listingPrice(l);
  const area = fmtArea(l.area, l.areaUnit);
  const offer = [area, price].filter(Boolean).join(' at ');
  return {
    title: `${name}, Pune${price ? `: ${price}` : ''} | Draazy`,
    description: `${name}, Pune${offer ? `: ${offer}` : ''}. Contact the owner directly on Draazy, with no brokerage.`,
  };
}

/** `/property/2-bhk-apartment-for-rent-baner-<uuid>`. A hand-set `slug` (demo data) is the URL as it stands,
    and ids that are not UUIDs (the mock provider) stay bare. */
export function propertyPath({ id, slug, bhk, type, deal, locality }) {
  if (slug) return `/property/${slug}`;
  if (!BARE_UUID.test(String(id))) return `/property/${id}`;
  const name = words([bhkLabel(bhk), type || 'property', 'for', deal === 'rent' ? 'rent' : 'sale', locality].filter(Boolean).join(' '));
  return `/property/${name}-${String(id).toLowerCase()}`;
}

/** The same path from an app view model (services/providers/http/propertyMapper.js `toViewModel`). */
export const propertyHref = (p) => propertyPath({ id: p.uuid ?? p.id, slug: p.slug, bhk: p.bhkNum, type: p.type, deal: p.deal, locality: p.locality });

/** What the API resolves from a `/property/:id` segment: the trailing UUID, else the segment (a legacy slug). */
export const propertyKey = (param) => String(param ?? '').match(TRAILING_UUID)?.[1] ?? String(param ?? '');

const titleCase = (slug) => String(slug || '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Society hub head (functions/society/[slug].js and Society.jsx); `s` has the SocietyDetailResponse fields. */
export function societyHead(s) {
  const loc = titleCase(s.localitySlug);
  const where = loc ? `${loc}, Pune` : 'Pune';
  const homes = [s.forRent && `${plural(s.forRent, 'home')} for rent`, s.forSale && `${plural(s.forSale, 'home')} for sale`].filter(Boolean).join(' and ');
  return {
    loc,
    where,
    title: `${s.name}, ${where}: Homes, Amenities & Reviews | Draazy`,
    description: `${s.name} in ${where}${s.builder ? ` by ${s.builder}` : ''}${s.year ? `, built in ${s.year}` : ''}. `
      + (homes ? `${homes[0].toUpperCase()}${homes.slice(1)} from owners, with no brokerage.` : 'Facts, amenities and resident reviews on Draazy.'),
    // Same idea as the locality guides' `indexable`: a page with nothing to say should not rank.
    thin: !s.listingCount && !s.year && !s.towers && !s.units && !s.amenities?.length,
  };
}
