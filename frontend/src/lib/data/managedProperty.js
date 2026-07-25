/* Managed properties — the owner "single-player" record.

   A managed property is a property an owner registers for their OWN benefit
   (valuation, document passport, rent tracking) BEFORE — or without ever —
   advertising it publicly. It is private by default and never appears in buyer
   search until the owner explicitly publishes it, at which point it enters the
   normal pending-review listing flow.

   Stored under its own per-user key so it never disturbs the existing posted-
   listings store. Records are shaped compatibly with listing cards so publishing
   is a straight hand-off. Prototype only — localStorage, not real security. */

import { readUser } from '../auth.js';
import { digits } from '../contact.js';
import { addListing as addUserListing } from '../store.js';
import { mutateDb } from '../mockApi.js';
import { resolveLocalitySlug } from '../../data/localities.js';

const PLACEHOLDER_GALLERY = [
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=800&q=70',
];

const key = () => 'puneNestManagedProps:' + ((readUser() || {}).mobile || 'anon');

const get = (k, def) => {
  try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch { return def; }
};
const set = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  return v;
};

const fmtIndian = (n) => Number(n || 0).toLocaleString('en-IN');
const localitySlugOf = (loc) => (loc ? resolveLocalitySlug(loc) : '');

export function getManagedProps() {
  const v = get(key(), []);
  return Array.isArray(v) ? v : [];
}

export function getManagedProp(id) {
  return getManagedProps().find((p) => p.id === id) || null;
}

/**
 * Register a new managed property (private by default).
 * Accepts the light fields the owner tools capture; synthesizes listing-compatible
 * display fields so it renders as a card and can be published later unchanged.
 */
export function registerManagedProp(data = {}) {
  const u = readUser() || {};
  const deal = data.deal === 'sale' ? 'sale' : 'rent';
  const bhkNum = Number(data.bhk) || 0;
  const bhkLabel = bhkNum ? (bhkNum >= 4 ? '4+ BHK' : bhkNum + ' BHK') : '';
  const typeLabel = data.type || 'Flat';
  const locality = data.locality || 'Pune';
  const price = Number(data.price) || 0;
  const priceStr = deal === 'rent' ? `₹${fmtIndian(price)}/mo` : `₹${fmtIndian(price)}`;
  const title = `${bhkLabel ? bhkLabel + ' ' : ''}${typeLabel}${locality ? ' in ' + locality : ''}`;

  const rec = {
    id: 'MP' + Date.now(),
    visibility: 'private',
    status: 'managed',
    source: 'owner-hub',
    real: true,
    // Listing-compatible display fields
    title,
    type: typeLabel,
    bhk: bhkLabel,
    bhkNum,
    locality,
    localitySlug: localitySlugOf(locality),
    society: data.society || '',
    loc: [data.society, locality, 'Pune'].filter(Boolean).join(', '),
    area: Number(data.area) || 0,
    areaUnit: data.areaUnit || 'sqft',
    furnishing: data.furnishing || '',
    deal,
    price,
    priceStr,
    img: PLACEHOLDER_GALLERY[0],
    image: PLACEHOLDER_GALLERY[0],
    gallery: PLACEHOLDER_GALLERY,
    owner: u.name || '',
    ownerMobile: u.mobile || '',
    // Owner-tool state
    rented: !!data.rented,
    tenantName: data.tenantName || '',
    monthlyRent: deal === 'rent' ? price : (Number(data.monthlyRent) || 0),
    dueDay: Number(data.dueDay) || 5,
    valuation: data.valuation || null,
    publishedListingId: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const all = getManagedProps();
  all.unshift(rec);
  set(key(), all);
  return rec;
}

export function updateManagedProp(id, patch = {}) {
  const all = getManagedProps();
  const it = all.find((p) => p.id === id);
  if (!it) return null;
  Object.assign(it, patch, { updatedAt: Date.now() });
  set(key(), all);
  return it;
}

export function deleteManagedProp(id) {
  set(key(), getManagedProps().filter((p) => p.id !== id));
}

/**
 * Publish a managed property into the normal pending-review listing flow.
 * The private record is marked published and linked to the new listing id.
 */
export function publishManagedProp(id) {
  const mp = getManagedProp(id);
  if (!mp) return null;
  if (mp.publishedListingId) return { id: mp.publishedListingId, already: true };

  const listingId = 'L' + Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const listing = {
    id: listingId,
    title: mp.title,
    type: mp.type,
    bhk: mp.bhk,
    bhkNum: mp.bhkNum,
    locality: mp.locality,
    localitySlug: mp.localitySlug,
    society: mp.society,
    loc: mp.loc,
    area: mp.area,
    areaUnit: mp.areaUnit,
    furnishing: mp.furnishing,
    deal: mp.deal,
    price: mp.price,
    priceStr: mp.priceStr,
    img: mp.img,
    image: mp.image,
    gallery: mp.gallery,
    viewUrl: `/property/${listingId}`,
    owner: mp.owner,
    ownerMobile: mp.ownerMobile,
    visibility: 'public',
    status: 'pending',
    statusClass: 'pill-pending',
    real: true,
    featured: false,
    views: 0,
    enquiries: 0,
    createdAt: today,
    freshenedAt: today,
    fromManaged: mp.id,
  };

  mutateDb((db) => {
    if (!db.listings.some((p) => p.id === listingId)) db.listings.unshift(listing);
  });
  addUserListing(listing);

  updateManagedProp(id, { visibility: 'public', status: 'published', publishedListingId: listingId });

  try {
    const notifs = JSON.parse(localStorage.getItem('puneNestNotifications') || '[]');
    notifs.unshift({ id: 'n' + Date.now(), type: 'listing', title: 'Property submitted!', desc: `Your ${mp.title} is now under review.`, time: 'Just now', link: `/property/${listingId}`, unread: true });
    localStorage.setItem('puneNestNotifications', JSON.stringify(notifs));
  } catch { /* quota */ }

  return listing;
}

/**
 * Ensure a posted property listing has a companion managed record, so a listing
 * posted the normal way (not via the Rent-o-meter) still appears on the unified
 * "My Properties" surface with its passport/tools — and so posting auto-adds it.
 *
 * Idempotent: returns the existing linked record if one is already present
 * (matched by publishedListingId, or the listing's own `fromManaged` back-link).
 * Never runs for flat-share/flatmate posts — those aren't owned properties.
 * Callers must gate on ownership; this trusts the listing it's handed.
 */
export function ensureManagedForListing(listing) {
  if (!listing || !listing.id) return null;
  if (listing.flatmate || listing.shareRequest || listing.shareGroup) return null;

  const all = getManagedProps();
  const existing = all.find((m) => m.publishedListingId === listing.id)
    || (listing.fromManaged ? all.find((m) => m.id === listing.fromManaged) : null);
  if (existing) return existing;

  const u = readUser() || {};
  const deal = listing.deal === 'buy' || listing.deal === 'sale' ? 'sale' : 'rent';
  const price = Number(listing.price) || 0;
  const locality = listing.locality || 'Pune';
  const bhkNum = Number(listing.bhkNum) || 0;
  const bhkLabel = listing.bhk || (bhkNum ? (bhkNum >= 4 ? '4+ BHK' : bhkNum + ' BHK') : '');
  const priceStr = listing.priceStr || (deal === 'rent' ? `₹${fmtIndian(price)}/mo` : `₹${fmtIndian(price)}`);
  const img = listing.img || listing.image || PLACEHOLDER_GALLERY[0];

  const rec = {
    id: 'MP' + Date.now() + '-' + Math.floor(Math.random() * 1e4),
    visibility: 'public',
    status: 'published',
    source: 'listing',
    real: true,
    title: listing.title || `${bhkLabel ? bhkLabel + ' ' : ''}${listing.type || 'Property'}${locality ? ' in ' + locality : ''}`,
    type: listing.type || 'Flat',
    bhk: bhkLabel,
    bhkNum,
    locality,
    localitySlug: listing.localitySlug || localitySlugOf(locality),
    society: listing.society || '',
    loc: listing.loc || [listing.society, locality, 'Pune'].filter(Boolean).join(', '),
    area: Number(listing.area) || 0,
    areaUnit: listing.areaUnit || 'sqft',
    furnishing: listing.furnishing || '',
    deal,
    price,
    priceStr,
    img,
    image: listing.image || img,
    gallery: listing.gallery || PLACEHOLDER_GALLERY,
    owner: listing.owner || u.name || '',
    ownerMobile: listing.ownerMobile || u.mobile || '',
    rented: false,
    tenantName: '',
    monthlyRent: deal === 'rent' ? price : 0,
    dueDay: 5,
    valuation: null,
    publishedListingId: listing.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  all.unshift(rec);
  set(key(), all);
  return rec;
}

/** Ownership guard for the mobile viewing the property (prototype UX only). */
export function ownsManagedProp(id, mobile) {
  const mp = getManagedProp(id);
  return !!mp && digits(mp.ownerMobile) === digits(mobile || (readUser() || {}).mobile || '');
}
