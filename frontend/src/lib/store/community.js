import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { allSocieties, registerCommunitySocieties, slugifySociety } from '../../data/societies.js';
import { registerCommunityLocalities, slugifyLocality } from '../../data/localities.js';
import { isBlacklisted } from '../geoConfig.js';
import { get, set } from './internals.js';
import { resolveSociety } from './societyAdmin.js';

/* =========================================================================
   Society SaaS leads (RWA "claim/onboard your society")
   ========================================================================= */
export const getSocietyLeads = () => get('pnSocietyLeads', []);
export const addSocietyLead = (o) => {
  const arr = getSocietyLeads();
  arr.unshift(Object.assign({ id: 'sl' + Date.now(), at: Date.now(), status: 'new' }, o || {}));
  return set('pnSocietyLeads', arr);
};

/* =========================================================================
   Community societies — user-minted from the listing flow.
   Solves the verified-society cold start: a lister who can't find their
   society "adds" it inline, which mints a `community`-tier record + drops an
   ops verification lead. Persisted here; registered into societies.js at load
   so every lookup resolves them. Verification later upgrades the tier.
   ========================================================================= */
export const COMMUNITY_SOC_KEY = 'pnCommunitySocieties';
export const getCommunitySocieties = () => get(COMMUNITY_SOC_KEY, []);
// Rehydrate the in-memory lookup maps with any previously-minted societies.
registerCommunitySocieties(getCommunitySocieties());

export const addCommunitySociety = (o = {}) => {
  const name = String(o.name || '').trim();
  if (!name) return null;
  const localityLabel = o.localityLabel || '';
  const localitySlug = o.localitySlug || (localityLabel ? slugifySociety(localityLabel) : '');
  const slug = slugifySociety(name, localityLabel);
  const arr = getCommunitySocieties();
  const existing = arr.find((s) => s.slug === slug);
  if (existing) { registerCommunitySocieties([existing]); return existing; }
  const rec = {
    id: 'SC' + Date.now().toString(36),
    slug, name, localitySlug,
    lat: o.lat ?? null, lng: o.lng ?? null, pincode: o.pincode || '',
    tier: 'community',
    source: o.source || 'listing',
    by: digits((readUser() || {}).mobile),
    at: Date.now(),
  };
  arr.unshift(rec);
  set(COMMUNITY_SOC_KEY, arr);
  registerCommunitySocieties([rec]);
  // Feed the ops verification queue so a community society can become verified.
  addSocietyLead({ kind: 'auto', slug, society: name, loc: localityLabel || localitySlug, source: o.source || 'listing' });
  return rec;
};

/* =========================================================================
   Community localities — user-minted from the listing flow, mirroring the
   community-society graph. When a lister's Google pick matches no canonical
   locality, we mint a `community`-tier locality (the system of record),
   persist it here, register it into localities.js so every lookup resolves
   it, and drop an ops lead so it can be promoted to `curated`.
   ========================================================================= */
export const getLocalityLeads = () => get('pnLocalityLeads', []);
export const addLocalityLead = (o) => {
  const arr = getLocalityLeads();
  arr.unshift(Object.assign({ id: 'll' + Date.now(), at: Date.now(), status: 'new' }, o || {}));
  return set('pnLocalityLeads', arr);
};

const COMMUNITY_LOC_KEY = 'pnCommunityLocalities';
export const getCommunityLocalities = () => get(COMMUNITY_LOC_KEY, []);
// Rehydrate the canonical registry with any previously-minted localities.
registerCommunityLocalities(getCommunityLocalities());

export const addCommunityLocality = (o = {}) => {
  const name = String(o.name || '').trim();
  if (!name) return null;
  const slug = slugifyLocality(name);
  if (!slug) return null;
  const arr = getCommunityLocalities();
  const existing = arr.find((l) => l.slug === slug);
  if (existing) { registerCommunityLocalities([existing]); return existing; }
  const rec = {
    slug, name,
    lat: o.lat ?? null, lng: o.lng ?? null, pincode: o.pincode || '',
    tier: 'community',
    source: o.source || 'listing',
    by: digits((readUser() || {}).mobile),
    at: Date.now(),
  };
  arr.unshift(rec);
  set(COMMUNITY_LOC_KEY, arr);
  registerCommunityLocalities([rec]);
  addLocalityLead({ kind: 'auto', slug, locality: name, source: o.source || 'listing' });
  return rec;
};

/* Ops queue: community localities awaiting promotion to curated. */
export const pendingCommunityLocalities = () =>
  getCommunityLocalities().filter((l) => l.tier === 'community');

/* Promote a community locality to curated (ops action). Flips the stored tier
   so raw reads and the live registry agree. */
export const verifyCommunityLocality = (slug, by) => {
  const rec = getCommunityLocalities().find((l) => l.slug === slug);
  if (!rec) return null;
  const arr = getCommunityLocalities().map((l) => (l.slug === slug
    ? { ...l, tier: 'curated', verifiedAt: Date.now(), verifiedBy: digits(by || myMobile()) || 'ops' }
    : l));
  set(COMMUNITY_LOC_KEY, arr);
  registerCommunityLocalities(arr);
  return arr.find((l) => l.slug === slug);
};

/* Dismiss a mistaken/duplicate community locality (ops action). Drops it from
   the persisted set; the in-memory registry keeps the slug resolvable until
   reload (harmless), matching the community-society dismissal behavior. */
export const dismissCommunityLocality = (slug) => {
  const arr = getCommunityLocalities().filter((l) => l.slug !== slug);
  set(COMMUNITY_LOC_KEY, arr);
  return arr;
};

/* Ranked type-ahead over the full catalogue (curated + community). Verified
   societies float to the top, then locality matches, then alphabetical. Returns
   a lean shape carrying a `verified`/`community` flag for the picker's badges. */
export const searchSocieties = (query, localityLabel = '') => {
  const q = String(query || '').trim().toLowerCase();
  const locSlug = localityLabel ? slugifySociety(localityLabel) : '';
  const locHead = locSlug.split('-')[0];
  const rows = allSocieties().map((s) => {
    const merged = resolveSociety(s.slug) || s;
    const community = merged.tier === 'community';
    const verified = !community && !!(merged.registration && merged.conveyance);
    return { id: s.id, slug: s.slug, name: s.name, localitySlug: s.localitySlug || '', builder: s.builder || '', verified, community };
  });
  // Honor the admin geo blacklist (Settings ▸ Maps): a society whose name matches a
  // blacklisted term/placeId is hidden everywhere, exactly like a Places suggestion.
  const notBlocked = rows.filter((s) => !isBlacklisted({ name: s.name }));
  const list = q ? notBlocked.filter((s) => s.name.toLowerCase().includes(q)) : notBlocked;
  const locMatch = (s) => (locHead && s.localitySlug && (s.localitySlug === locSlug || s.localitySlug.startsWith(locHead))) ? 1 : 0;
  return list
    .sort((a, b) => (Number(b.verified) - Number(a.verified)) || (locMatch(b) - locMatch(a)) || a.name.localeCompare(b.name))
    .slice(0, 20);
};

