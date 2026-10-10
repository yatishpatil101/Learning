/* Programmatic rent/buy and flatmate landing pages, shared by the app (RentBuyLanding.jsx, FlatmateLanding.jsx), the
   edge renderer (edge/landing-pages.mjs) and the landing sitemap. Places are the locality guides. */
import { GUIDE_LOCALITIES } from './guideLocalities.js';
import { expandBhkToken } from './listings/bhkOptions.js';

export const PUNE = { slug: 'pune', name: 'Pune' };

/* Guide taglines are copied because the edge cannot read Markdown;
   edge/landing-pages.test.mjs checks them against the guides. */
export const TAGLINES = {
  aundh: 'Settled, leafy and close to the University',
  balewadi: 'Newer towers by the sports complex, between Baner and Hinjawadi',
  baner: 'Cafés, gated societies and a short run to Hinjawadi',
  hadapsar: 'Big and varied, with jobs and homes for every budget',
  hinjawadi: 'Live beside the IT park and skip the commute',
  kharadi: 'New high-rises around EON IT Park and WTC',
  'koregaon-park': "Old bungalows, leafy lanes and the city's best-known dining",
  kothrud: 'Family-friendly, with schools, hospitals and shops close by',
  magarpatta: 'A walkable township with offices inside the gates',
  'pimple-saudagar': 'A quiet PCMC suburb of gated societies near Hinjawadi',
  'viman-nagar': 'Next to the airport, with Phoenix Marketcity at hand',
  wakad: 'Gated societies right next to the Hinjawadi IT park',
};

export const LANDING_PLACES = Object.entries(GUIDE_LOCALITIES).map(([slug, name]) => ({ slug, name, tagline: TAGLINES[slug] }));

export const LANDING_BHKS = [1, 2, 3, 4];

/* Open listings an indexable page needs: an area, one BHK in an area, or live flatmate posts in an area. */
export const MIN_INDEXABLE = { place: 5, bhk: 3, flatmates: 3 };

const DEALS = { rent: 'rent', buy: 'sale' };
const BHK_SEGMENT = /^([1-4])-bhk$/;

export const landingPath = (deal, slug = PUNE.slug, bhk) => `/${deal}/${slug}${bhk ? `/${bhk}-bhk` : ''}`;

/** `segments` are the path parts after `/rent` or `/buy`; null when the URL is not a landing page. */
export function parseLanding(deal, segments) {
  if (!DEALS[deal]) return null;
  const [slug, bhkSegment, ...rest] = segments || [];
  const place = slug === PUNE.slug ? PUNE : LANDING_PLACES.find((p) => p.slug === slug);
  if (!place || rest.length) return null;
  if (bhkSegment === undefined) return { deal, place, bhk: null };
  const bhk = place === PUNE ? null : Number(BHK_SEGMENT.exec(bhkSegment)?.[1]);
  return bhk ? { deal, place, bhk } : null;
}

/* A rent search for 4 BHK is the app's 4plus filter, so it also matches larger homes. */
export const bhkMatches = ({ deal }, bhk, row) => (deal === 'rent' && bhk === 4 ? Number(row.bhk) >= 4 : Number(row.bhk) === bhk);

export const isIndexable = ({ bhk }, count) => count >= (bhk ? MIN_INDEXABLE.bhk : MIN_INDEXABLE.place);

export function landingCopy({ deal, place, bhk }) {
  const where = place === PUNE ? 'Pune' : `${place.name}, Pune`;
  const kind = bhk ? `${bhk} BHK flats` : 'Flats and homes';
  const h1 = `${kind} for ${DEALS[deal]} in ${where}`;
  return {
    where,
    h1,
    title: `${h1} | Draazy`,
    description: `${h1}, listed directly by owners. Compare prices and photos, and pay no brokerage.`,
    intro: [
      `${h1}, listed directly by owners with no brokerage.`,
      place === PUNE
        ? 'Narrow by area or BHK, or open an area guide to see who each part of Pune suits.'
        : `About ${place.name}: ${place.tagline}.`,
    ],
  };
}

/** `GET /properties` query for a landing page, in the names the listings page sends. */
export const landingQuery = ({ deal, place, bhk }) => ({
  deal,
  ...(place !== PUNE && { localities: [place.slug] }),
  ...(bhk && { bhks: expandBhkToken(String(bhk), deal) }),
  rank: 'relevance',
});

/** The same search on the full listings page, for "More filters". */
export function listingsUrl({ deal, place, bhk }) {
  const params = new URLSearchParams({ deal });
  if (place !== PUNE) params.set('loc', place.slug);
  if (bhk) params.set('bhks', String(bhk));
  return `/listings?${params}`;
}

const WOMEN_ONLY = { slug: 'women-only-pune', name: 'Women-only' };

/** `/flatmates/<segment>`: a locality guide slug or the women-only page; null otherwise. */
export function parseFlatmateLanding(segment) {
  if (segment === WOMEN_ONLY.slug) return { women: true, place: PUNE };
  const place = LANDING_PLACES.find((p) => p.slug === segment);
  return place ? { women: false, place } : null;
}

export const flatmatePath = ({ women, place }) => `/flatmates/${women ? WOMEN_ONLY.slug : place.slug}`;

export function flatmateCopy({ women, place }) {
  const h1 = women ? 'Women-only flats and rooms to share in Pune' : `Flats and rooms to share in ${place.name}, Pune`;
  return {
    h1,
    title: `${h1} | Draazy`,
    description: women
      ? 'Flats and rooms in Pune where the host is looking for women flatmates. Posts are moderated and there is no brokerage.'
      : `Flats and rooms to share in ${place.name}, Pune, posted by hosts looking for flatmates. Posts are moderated and there is no brokerage.`,
    intro: women
      ? ['Flats and rooms across Pune where the host has chosen women flatmates.', 'Every post is reviewed before it goes live, and you pay no brokerage.']
      : [`Flats and rooms to share in ${place.name}, posted by hosts looking for flatmates.`, `About ${place.name}: ${place.tagline}.`],
  };
}

/** A feed row (rooms carry `gender`, groups carry `policy`) that is meant for women only. */
export const isWomenOnly = (row) => row.gender === 'female' || row.policy === 'women';
