import { uploadPersonalDocument } from '../../../services/documentService.js';
import { MOVE_LBL } from './constants.js';
import { headlineOf } from '../../../lib/headline.js';
import { slugOfName } from '../../../lib/searchEntities.js';

export const detailPath = (kind, id) => `/flatmates/${kind}/${encodeURIComponent(id)}`;
export const roomEditHref = (id) => `/list-property?flatmate=1&editRoom=${encodeURIComponent(id)}`;
export const segClass = (active) => 'seg text-sm font-semibold px-4 min-h-11 lg:min-h-10 inline-flex items-center rounded-full text-gray-300 box-border' + (active ? ' active' : '');

export const roomTitle = (r) => r.title || r.society || `${r.flatType || 'Room'} in ${r.localities?.[0] || r.locality || 'Pune'}`;
export const seekerTitle = (r) => r.title || r.name || 'Flatmate';
export const seekerHeadline = (p) => headlineOf('', `${String(p.occupation || '').trim() || 'Flatmate'} looking for a room${p.localities?.length ? ' in ' + p.localities.join(', ') : ''}`);

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const avatarGrad = (g) => (g === 'female' ? 'from-pink-500 to-rose-400' : g === 'male' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');
const initials = (name) => (name || '?').trim().split(/\s+/).map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
const genderLabel = (g) => (g === 'female' ? 'Woman' : g === 'male' ? 'Man' : 'Flatmate');
const genderPref = (g) => (g === 'female' ? 'Women only' : g === 'male' ? 'Men only' : 'Anyone');
const foodLabel = (f) => (f === 'veg' ? 'Veg only' : f === 'nonveg' ? 'Non-veg ok' : 'Any food');
const perHead = (g) => Math.round(g.rent / g.seatsTotal);
const shareFloor = (g) => (g.preferences?.rentMin ? Math.round(g.preferences.rentMin / g.seatsTotal) : null);
const moneyRange = (lo, hi, tr) => {
  if (lo && hi) return lo === hi ? inr(hi) : `${inr(lo)} – ${inr(hi)}`;
  if (hi) return tr('flatmates.upToAmount', { amount: inr(hi) });
  return lo ? tr('flatmates.fromAmount', { amount: inr(lo) }) : null;
};
const seekerBudget = (p) => (+p.budgetMax > +p.budget ? `${inr(p.budget)} – ${inr(p.budgetMax)}` : inr(p.budget));
const bhkText = (bhk) => (bhk?.length ? `${bhk.map((b) => (b === '4' ? '4+' : b)).join(' / ')} BHK` : null);
const groupListingsUrl = (p) => {
  const q = new URLSearchParams({ deal: 'rent' });
  const names = p.localities?.length ? p.localities : [p.locality].filter(Boolean);
  const slugs = names.length === 1 && p.localitySlug ? [p.localitySlug] : names.map((l) => slugOfName(l));
  if (slugs.length) q.set('loc', slugs.join(','));
  if (p.bhk?.length) q.set('bhks', p.bhk.map((b) => (b === '4' ? '4plus' : b)).join(','));
  if (p.rentMax) q.set('rent', `${p.rentMin || 0}-${p.rentMax}`);
  if (p.depositMax) q.set('deposit', `${p.depositMin || 0}-${p.depositMax}`);
  if (p.furnishing) q.set('furn', p.furnishing);
  if (p.bachelors) q.set('tenants', 'bachelors');
  if (p.gatedOnly) q.set('amen', 'security');
  return `/listings?${q}`;
};
const groupLocalities = (g) => (g.localities?.length ? g.localities : [g.locality].filter(Boolean));
const maxOpenSeats = (g) => Math.max(0, g.seatsTotal - (g.members?.length || 0));
const MAX_GROUP_SEATS = 12;
const seatsLeft = (g) => {
  if (g && g.seatsOpen != null) return Math.max(0, Math.min(maxOpenSeats(g), g.seatsOpen));
  return maxOpenSeats(g);
};
const seatCeiling = (kind, item) => (kind === 'group' ? seatsLeft(item) + MAX_GROUP_SEATS - item.seatsTotal : maxOpenSeats(item));
const allVerified = (g) => g.members.length > 0 && g.members.every((m) => m.verified);
const policyAvatar = (p) => (p === 'women' ? 'from-pink-500 to-rose-400' : p === 'men' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');

// Default title for a replacement-flatmate group, so the host starts from something real.
const replacementTitle = ({ bhk, locality } = {}) => {
  const where = locality ? ' in ' + locality : '';
  return bhk ? `1 more flatmate for a ${bhk}${where}` : `1 more flatmate${where}`;
};

// Identity is the floor (the Aadhaar gate) and earns no badge; only these two tiers carry
// extra proof — an Ops-verified property, or a sitting tenant's registered agreement.
const HOST_TIERS = {
  owner: { label: 'Owner-verified', icon: 'badge-check', cls: 'text-emerald-300' },
  tenant: { label: 'Tenant-verified', icon: 'file-check', cls: 'text-teal-300' },
};
const hostTierMeta = (item) => (item && HOST_TIERS[item.verificationTier]) || null;
// Tenant tier is a self-claim, so its badge waits for Ops approval; owner tier rides on
// proof the card already holds (group: attached verified property; room: its `verified`).
const showHostBadge = (item, reviewStatus, ownerEarned = true) => {
  if (!hostTierMeta(item)) return false;
  if (item.verificationTier === 'tenant') return reviewStatus === 'approved';
  if (item.verificationTier === 'owner') return ownerEarned;
  return false;
};
// A post counts as "verified" for the Verified-only filter: owner tier is trusted
// on its property proof; tenant tier only once Ops has approved it.
const hostVerifiedFor = (item, reviewStatus) => {
  if (!item) return false;
  if (item.verificationTier === 'owner') return true;
  if (item.verificationTier === 'tenant') return reviewStatus === 'approved';
  return false;
};

/* Free text is the server's `q`; what it deliberately does not match (names, display-only
 * labels) is in docs/flows/consumer/flatmates.md § Server-side board search. */
// Approximate age of a post in minutes. Uses an exact createdAt when available,
// otherwise parses the human "time" label ("Just now", "2 hours ago", "1 day ago").
const recencyMins = (item) => {
  if (item && item.createdAt) return (Date.now() - item.createdAt) / 60000;
  const t = ((item && item.time) || '').toLowerCase();
  if (!t || t.includes('just now') || t.includes('now')) return 0;
  const m = t.match(/(\d+)\s*(min|hour|day|week)/);
  if (!m) return 9e9;
  const n = +m[1];
  return m[2].startsWith('min') ? n : m[2].startsWith('hour') ? n * 60 : m[2].startsWith('day') ? n * 1440 : n * 10080;
};

const kInr = (n) => (n >= 1000 ? `₹${Math.round(n / 1000)}k` : inr(n));
const genderClash = (a, b) => a && b && a !== 'any' && b !== 'any' && a !== b;

const matchFor = (item, me) => {
  if (!me) return null;
  const theirs = item.localities || (item.locality ? [item.locality] : []);
  const locality = theirs.find((l) => (me.localities || []).includes(l));
  if (!locality || genderClash(me.gender, item.gender)) return null;
  const lo = +me.budget || 0, hi = Math.max(lo, +me.budgetMax || 0);
  const price = +item.budget || 0, priceMax = Math.max(price, +item.budgetMax || 0);
  const budget = lo ? (hi > lo ? `${kInr(lo)}–${kInr(hi).slice(1)}` : kInr(lo)) : '';
  if (!lo || !price) return { tier: 'good', locality, budget };
  const overlaps = (tol) => price <= hi * (1 + tol) && priceMax >= lo * (1 - tol);
  if (overlaps(0.12)) return { tier: 'great', locality, budget };
  if (overlaps(0.28)) return { tier: 'good', locality, budget };
  return null;
};

/* No client-side verified predicate and no client-side sort: re-ordering one server-ordered
 * page makes the top of page 2 outrank the bottom of page 1. */
// Whether a post is fresh enough to flag as new. Tied to real post age (< 24h)
// so the signal stays honest — no fabricated "active now" states.
const isFresh = (item) => recencyMins(item) < 1440;

const isDateVal = (v) => typeof v === 'string' && v.includes('-');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const moveInLabel = (v, prefix = 'By ') => {
  if (v === 'now') return 'Immediately';
  if (MOVE_LBL[v]) return MOVE_LBL[v];
  if (isDateVal(v)) {
    if (v <= todayIso()) return 'Immediately';
    const d = new Date(v + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return prefix + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return 'Flexible';
};

const moveInByForm = (iso) => (iso && iso <= todayIso() ? 'now' : iso || '');
const moveInByWire = (v, stored) => {
  if (v !== 'now') return v || null;
  return stored && stored <= todayIso() ? stored : todayIso();
};

// Images and PDFs only, matching the input's `accept`, so nothing else can become "evidence".
// An oversized file is recorded present-but-not-inlined, unread, so it can't freeze the tab.
const AGREEMENT_MAX_BYTES = 3 * 1024 * 1024;
const AGREEMENT_MIME_RE = /^(image\/|application\/pdf)/;
const readLocalAgreement = (file) => new Promise((resolve) => {
  const meta = { name: file.name, size: file.size, mime: file.type };
  if ((file.size || 0) > AGREEMENT_MAX_BYTES) { resolve({ ...meta, dataUrl: null, tooLarge: true }); return; }
  const reader = new FileReader();
  reader.onload = () => resolve({ ...meta, dataUrl: reader.result });
  reader.onerror = () => resolve({ ...meta, dataUrl: null });
  reader.readAsDataURL(file);
});
const readAgreementDoc = async (file) => {
  if (!file || !AGREEMENT_MIME_RE.test(file.type || '')) return null;
  const [local, stored] = await Promise.all([
    readLocalAgreement(file),
    uploadPersonalDocument({ category: 'Rent agreement', file }),
  ]);
  return { ...local, id: stored.id };
};

const hasAgreementEvidence = (doc) => !!doc?.id;

const FLATMATE_IMG = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80';
const FLATMATE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

// Built on read, never at the moment of the tap: the shortlist stores the key alone, so a
// card cannot go on advertising a rent or a photo the host has since changed.
const toSavedCard = (item) => {
  if (!item?.id) return null;
  if (item.kind === 'room') {
    const loc = item.locality || item.localities?.[0] || '';
    return {
      id: 'r:' + item.id,
      saveKind: 'room',
      cat: 'flatmates',
      kind: 'room',
      title: roomTitle(item),
      loc: loc ? loc + ', Pune' : 'Pune',
      price: inr(item.budget) + '/mo',
      priceNum: Number(item.budget) || 0,
      badge: 'Room',
      sub: [item.flatType, item.roomType].filter(Boolean).join(' · '),
      img: item.img || item.cover || FLATMATE_IMG,
    };
  }
  if (item.kind === 'group') {
    const left = seatsLeft(item);
    const count = item.members?.length || 0;
    return {
      id: 'g:' + item.id,
      saveKind: 'group',
      cat: 'flatmates',
      kind: 'group',
      title: item.title || 'Flatmate group',
      loc: item.locality ? item.locality + ', Pune' : 'Pune',
      price: inr(perHead(item)) + '/mo',
      priceNum: Number(perHead(item)) || 0,
      badge: 'Flatmate group',
      sub: count + ' member' + (count === 1 ? '' : 's') + ' · ' + left + ' spot' + (left === 1 ? '' : 's') + ' open',
      img: FLATMATE_GROUP_IMG,
    };
  }
  const loc = item.localities?.[0] || '';
  return {
    id: 's:' + item.id,
    saveKind: 'post',
    cat: 'flatmates',
    kind: 'flatmate',
    title: seekerTitle(item),
    loc: loc ? loc + ', Pune' : 'Pune',
    price: seekerBudget(item) + '/mo',
    priceNum: Number(item.budget) || 0,
    badge: 'Flatmate',
    sub: [genderLabel(item.gender), item.age, item.occupation].filter(Boolean).join(' · '),
    img: FLATMATE_IMG,
  };
};

// Geo: a post keeps real coords; the rest get their locality centroid plus a deterministic
// per-id jitter so they can be drawn. NEVER filter on these — the server uses real lat/lng.
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
const jitterFor = (id) => {
  const h = hashStr(String(id || ''));
  const dLat = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.01;
  const dLng = ((h & 0xffff) / 0xffff - 0.5) * 0.01;
  return [dLat, dLng];
};
const primaryLocality = (post) => (post && (post.locality || (Array.isArray(post.localities) ? post.localities[0] : ''))) || '';
const withCoords = (post, localityCoords = {}) => {
  if (!post || (post.lat != null && post.lng != null)) return post;
  const base = localityCoords[primaryLocality(post)];
  if (!base) return post;
  const [jLat, jLng] = jitterFor(post.id);
  return { ...post, lat: base[0] + jLat, lng: base[1] + jLng };
};

export const BUDGET_MIN = 0;
export const BUDGET_MAX = 40000;

export const budgetIsAny = (b) => b[0] <= BUDGET_MIN && b[1] >= BUDGET_MAX;

/* Omitting the key keeps the two apart all the way to the column, where null carries the same distinction. */
const numeric = (name, raw) => (raw === '' || raw == null ? {} : { [name]: Number(raw) });
const terms = (f) => ({
  ...numeric('noticePeriodDays', f.noticePeriodDays),
  ...numeric('lockInMonths', f.lockInMonths),
  ...(f.maintenanceBilling ? { maintenanceBilling: f.maintenanceBilling } : {}),
  ...(f.electricityBilling ? { electricityBilling: f.electricityBilling } : {}),
});

export { inr, avatarGrad, initials, genderLabel, genderPref, foodLabel, perHead, shareFloor, moneyRange, seekerBudget, bhkText, groupLocalities, groupListingsUrl, maxOpenSeats, MAX_GROUP_SEATS, seatCeiling, seatsLeft, allVerified, policyAvatar, replacementTitle, hostTierMeta, showHostBadge, hostVerifiedFor, matchFor, isFresh, moveInLabel, isDateVal, todayIso, moveInByForm, moveInByWire, readAgreementDoc, hasAgreementEvidence, toSavedCard, numeric, terms, FLATMATE_IMG, FLATMATE_GROUP_IMG, withCoords };
