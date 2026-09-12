import { MOVE_LBL, LOCALITIES, LOCALITY_COORDS } from './constants.js';

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const avatarGrad = (g) => (g === 'female' ? 'from-pink-500 to-rose-400' : g === 'male' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');
const initials = (name) => (name || '?').trim().split(/\s+/).map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
const genderLabel = (g) => (g === 'female' ? 'Woman' : g === 'male' ? 'Man' : 'Flatmate');
const genderPref = (g) => (g === 'female' ? 'Women only' : g === 'male' ? 'Men only' : 'Anyone');
const foodLabel = (f) => (f === 'veg' ? 'Veg only' : f === 'nonveg' ? 'Non-veg ok' : 'Any food');
const perHead = (g) => Math.round(g.rent / g.seatsTotal);
const seatsLeft = (g) => {
  // `seatsOpen` is the honest count for a backfill into an occupied flat, and what the
  // owner reopen/close controls adjust; groups without it fall back to capacity.
  if (g && g.seatsOpen != null) return Math.max(0, Math.min(g.seatsTotal, g.seatsOpen));
  return Math.max(0, g.seatsTotal - g.members.length);
};
const allVerified = (g) => g.members.length > 0 && g.members.every((m) => m.verified);
const policyAvatar = (p) => (p === 'women' ? 'from-pink-500 to-rose-400' : p === 'men' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');

// Prefills a group's locality from an existing property's free text. The dropdown only
// offers LOCALITIES, so an unmatched value stays at the default rather than being guessed.
const deriveLocality = (...parts) => {
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  return LOCALITIES.find((l) => hay.includes(l.toLowerCase())) || '';
};
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
   labels) is in docs/flows/consumer/flatmates.md § Server-side board search. */

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

// Relevance to the viewer's own live request. Budgets are compared as overlapping
// affordability bands so the match is symmetric rather than one number's percentage gap.
const budgetOf = (x) => (x.budget != null ? x.budget : x.rent != null ? Math.round(x.rent / (x.seatsTotal || 1)) : null);
const bandsOverlap = (a, b, tol) => a * (1 - tol) <= b * (1 + tol) && b * (1 - tol) <= a * (1 + tol);

const matchScore = (item, me) => {
  if (!me) return 0;
  let s = 0;
  const mine = new Set(me.localities || []);
  const theirs = item.localities || (item.locality ? [item.locality] : []);
  if (theirs.some((l) => mine.has(l))) s += 3;
  const mb = budgetOf(me), tb = budgetOf(item);
  if (mb && tb) {
    if (bandsOverlap(mb, tb, 0.12)) s += 2; // affordability ranges overlap tightly
    else if (bandsOverlap(mb, tb, 0.28)) s += 1; // within reach
  }
  if (me.gender && item.gender && (item.gender === me.gender || item.gender === 'any')) s += 1;
  s += Math.max(0, 2 - recencyMins(item) / 1440); // small freshness nudge
  return s;
};

// Null unless the viewer has a live post to compare against, so cards stay clean for
// signed-out and unposted users.
const matchTier = (item, me) => {
  if (!me) return null;
  const s = matchScore(item, me);
  if (s >= 5) return 'great';
  if (s >= 3) return 'good';
  return null;
};

// No client-side verified predicate and no client-side sort: re-ordering one server-ordered
// page makes the top of page 2 outrank the bottom of page 1. `matchScore` stays for the badge.


// Whether a post is fresh enough to flag as new. Tied to real post age (< 24h)
// so the signal stays honest — no fabricated "active now" states.
const isFresh = (item) => recencyMins(item) < 1440;

// Reads a card's stored move-in ('now', a legacy bucket, or an ISO date). The "within N
// days" filter lives server-side, because that is a fact about the request, not the row.
const moveInLabel = (v) => {
  if (v === 'now') return 'Immediately';
  if (MOVE_LBL[v]) return MOVE_LBL[v];
  if (typeof v === 'string' && v.includes('-')) {
    const d = new Date(v + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return 'By ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return 'Flexible';
};

// Images and PDFs only, matching the input's `accept`, so nothing else can become "evidence".
// An oversized file is recorded present-but-not-inlined, unread, so it can't freeze the tab.
const AGREEMENT_MAX_BYTES = 3 * 1024 * 1024;
const AGREEMENT_MIME_RE = /^(image\/|application\/pdf)/;
const readAgreementDoc = (file) => new Promise((resolve) => {
  if (!file) { resolve(null); return; }
  if (!AGREEMENT_MIME_RE.test(file.type || '')) { resolve(null); return; }
  const meta = { name: file.name, size: file.size, mime: file.type };
  if ((file.size || 0) > AGREEMENT_MAX_BYTES) { resolve({ ...meta, dataUrl: null, tooLarge: true }); return; }
  const reader = new FileReader();
  reader.onload = () => resolve({ ...meta, dataUrl: reader.result });
  reader.onerror = () => resolve({ ...meta, dataUrl: null });
  reader.readAsDataURL(file);
});

// Shared by the group and room create paths so the Tenant-tier evidence rule cannot drift.
const hasAgreementEvidence = (doc) => !!(doc && (doc.dataUrl || doc.tooLarge));

// Preview images the Saved page (and pending-chat cards) use for people/groups,
// which don't carry a photo of their own. Rooms bring their own `img`.
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
      title: item.society || 'Room',
      loc: loc ? loc + ', Pune' : 'Pune',
      price: inr(item.budget) + '/mo',
      priceNum: Number(item.budget) || 0,
      badge: 'Room',
      sub: [item.flatType, item.roomType].filter(Boolean).join(' · '),
      img: item.img || item.photos?.[0] || FLATMATE_IMG,
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
    title: item.name || 'Flatmate',
    loc: loc ? loc + ', Pune' : 'Pune',
    price: inr(item.budget) + '/mo',
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
// A stable offset of up to ~±0.005° (~550 m) keyed off the post id.
const jitterFor = (id) => {
  const h = hashStr(String(id || ''));
  const dLat = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.01;
  const dLng = ((h & 0xffff) / 0xffff - 0.5) * 0.01;
  return [dLat, dLng];
};
// Seekers/rooms carry localities[]; groups carry a single locality string.
const primaryLocality = (post) => (post && (post.locality || (Array.isArray(post.localities) ? post.localities[0] : ''))) || '';
const withCoords = (post) => {
  if (!post || (post.lat != null && post.lng != null)) return post;
  const base = LOCALITY_COORDS[primaryLocality(post)];
  if (!base) return post;
  const [jLat, jLng] = jitterFor(post.id);
  return { ...post, lat: base[0] + jLat, lng: base[1] + jLng };
};

/* Filtering, ordering, counting and paging are the server's — no client-side copy, because two
   predicates over one field intersect to the narrower. docs/flows/consumer/flatmates.md. */

/* `BUDGET_MAX` is a sentinel, not a price: the top of the scale reads as "any", so a dearer post
   still reaches a seeker sitting there. The floor has none — ₹0 is the real bottom of the market. */
export const BUDGET_MIN = 0;
export const BUDGET_MAX = 40000;

/** True when the range is wide open, i.e. the budget filter is narrowing nothing. */
export const budgetIsAny = (b) => b[0] <= BUDGET_MIN && b[1] >= BUDGET_MAX;

export { inr, avatarGrad, initials, genderLabel, genderPref, foodLabel, perHead, seatsLeft, allVerified, policyAvatar, deriveLocality, replacementTitle, hostTierMeta, showHostBadge, hostVerifiedFor, matchTier, isFresh, moveInLabel, readAgreementDoc, hasAgreementEvidence, toSavedCard, FLATMATE_IMG, FLATMATE_GROUP_IMG, withCoords };
