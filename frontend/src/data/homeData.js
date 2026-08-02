/* Static data for the Home page — extracted for separation of concerns. */

/* Property-type options for the hero search mirror the canonical browse
   taxonomy (and thus the "Post a property" types), so a search maps 1:1 to
   the listings filter. The type-specific sub-filters (PG sharing, commercial
   subtype, land use) travel with them so the hero's third dropdown offers the
   same choices the Listings filter panel does for that type. */
export { HOME_TYPE_OPTS as TYPE_OPTS, PG_SHARING, COMMERCIAL_TYPES, LAND_USE } from './propertyTypes.js';
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

/* Canonical marketing stats — single source of truth so the hero, "Why PuneNest"
   and testimonials never disagree. Each figure describes a DIFFERENT metric.
   TODO(API): bind these to real aggregate counts once the backend lands. */
export const STATS = {
  properties: '11,240+',      // live buy + rent listings
  verifiedOwners: '523+',     // Aadhaar-verified owners
  localities: '54',           // Pune localities covered
  familiesHoused: '8,600+',   // completed moves (< total listings)
  rating: '4.8',
  reviews: '2,614',
  brokerage: '₹0',
};

/* Property-type tiles. The five *property* tiles reconcile to STATS.properties
   (4,490 + 2,100 + 1,200 + 900 + 2,550 = 11,240). "Flatmates" is a separate
   inventory (flatmate seekers, not whole properties) so it is excluded from that
   total. TODO(API): replace hardcoded counts with real per-type counts. */
export const CATEGORIES = [
  { href: '/listings?type=flat', icon: 'building', color: '#14b8a6', title: 'Flats', count: '4,490+' },
  { href: '/flatmates', icon: 'user-plus', color: '#f59e0b', title: 'Flatmates', count: '3,100+' },
  { href: '/listings?type=pg', icon: 'users', color: '#06b6d4', title: 'PG / Co-living', count: '2,100+' },
  { href: '/listings?type=commercial', icon: 'briefcase', color: '#a78bfa', title: 'Commercial', count: '1,200+' },
  { href: '/listings?type=plot', icon: 'map', color: '#f472b6', title: 'Plots / Land', count: '900+' },
  { href: '/listings?type=house,villa', icon: 'home', color: '#34d399', title: 'Villas & Houses', count: '2,550+' },
];
