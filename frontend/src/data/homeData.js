/* Static data for the Home page — extracted for separation of concerns. */

/* Hero-search property types mirror the canonical browse taxonomy, so a search maps 1:1 to the
   listings filter. The type-specific sub-filters travel with them, so the hero's third dropdown
   offers exactly what the Listings filter panel does for that type. */
export { HOME_TYPE_OPTS as TYPE_OPTS, COMMERCIAL_TYPES, LAND_USE } from './propertyTypes.js';
import { localityNames } from './localities.js';

/* The searchable locality universe is owned by the canonical registry
   (data/localities.js) — one source of truth across Home, List-Property and
   Flatmate. CITY_POPULAR and NEARBY below stay editorial (curated adjacency the
   registry doesn't model), keyed so each city surfaces only its own localities. */
export const ALL_LOCS = localityNames();

export const NEARBY = {
  Baner: ['Balewadi', 'Aundh', 'Pashan', 'Sus', 'Wakad'],
  Balewadi: ['Baner', 'Wakad', 'Aundh'],
  Aundh: ['Baner', 'Pashan', 'Pimple Nilakh', 'Balewadi'],
  Wakad: ['Hinjawadi', 'Tathawade', 'Punawale', 'Pimple Saudagar', 'Baner'],
  Hinjawadi: ['Wakad', 'Marunji', 'Maan', 'Tathawade'],
  Kothrud: ['Karve Nagar', 'Bavdhan', 'Erandwane', 'Warje'],
  'Koregaon Park': ['Kalyani Nagar', 'Mundhwa', 'Yerawada', 'Viman Nagar'],
  'Kalyani Nagar': ['Koregaon Park', 'Viman Nagar', 'Yerawada', 'Kharadi'],
  'Viman Nagar': ['Kharadi', 'Kalyani Nagar', 'Lohegaon', 'Wadgaon Sheri'],
  Kharadi: ['Viman Nagar', 'Wagholi', 'Chandan Nagar', 'Kalyani Nagar'],
  Wagholi: ['Kharadi', 'Lohegaon', 'Manjari'],
  Hadapsar: ['Magarpatta', 'Amanora', 'Mundhwa', 'Manjari'],
  Magarpatta: ['Hadapsar', 'Amanora', 'Mundhwa'],
};

/* Popular localities per city, as [name, defaultDeal] tuples — the source of truth for
   the home hero "Popular:" chips. Only Pune has a curated registry today, so other cities
   resolve to [] and their pickers fall back to live Google Places suggestions (city-biased)
   instead of leaking Pune localities. */
export const CITY_POPULAR = {
  Pune: [['Baner', 'buy'], ['Wakad', 'buy'], ['Hinjawadi', 'buy'], ['Kothrud', 'buy'], ['Koregaon Park', 'buy'], ['Viman Nagar', 'rent']],
};

/* Popular locality NAMES for a city (search empty-state). */
export function popularFor(city) {
  return (CITY_POPULAR[city] || []).map(([name]) => name);
}

// Popular [name, deal] chip tuples for a city (home hero chips).
export function popularChipsFor(city) {
  return CITY_POPULAR[city] || [];
}

/* Canonical marketing stats — single source of truth so the hero, "Why Draazy"
   and testimonials never disagree. Each figure describes a DIFFERENT metric.
   TODO(API): still hard-coded; bind `properties` to the /properties/counts total and the rest to
   real aggregates before launch. */
export const STATS = {
  properties: '11,240+',
  verifiedOwners: '523+',
  localities: '54',
  familiesHoused: '8,600+',
  rating: '4.8',
  reviews: '2,614',
  brokerage: '₹0',
};

export const CATEGORIES = [
  { icon: 'building', color: '#14b8a6', title: 'Flats', types: ['flat'], defaultDeal: 'buy' },
  { href: '/flatmates', icon: 'user-plus', color: '#f59e0b', title: 'Flatmates' },
  { icon: 'briefcase', color: '#a78bfa', title: 'Commercial', types: ['commercial'], defaultDeal: 'rent', dealFromStock: true },
  { icon: 'map', color: '#f472b6', title: 'Plots / Land', types: ['plot', 'farmland'], defaultDeal: 'buy' },
  { icon: 'home', color: '#34d399', title: 'Villas & Houses', types: ['house', 'villa'], defaultDeal: 'buy' },
];
