import { MOVE_RANK, MOVE_LBL, LOCALITIES, LOCALITY_COORDS } from './constants.js';

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
const avatarGrad = (g) => (g === 'female' ? 'from-pink-500 to-rose-400' : g === 'male' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');
const initials = (name) => (name || '?').trim().split(/\s+/).map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
const genderLabel = (g) => (g === 'female' ? 'Woman' : g === 'male' ? 'Man' : 'Flatmate');
const genderPref = (g) => (g === 'female' ? 'Women only' : g === 'male' ? 'Men only' : 'Anyone');
const foodLabel = (f) => (f === 'veg' ? 'Veg only' : f === 'nonveg' ? 'Non-veg ok' : 'Any food');
const perHead = (g) => Math.round(g.rent / g.seatsTotal);
const seatsLeft = (g) => {
  // A group may declare how many seats are open right now (seatsOpen) — the honest
  // count for a tenant backfilling one seat in an already-occupied flat, and the
  // field the owner reopen/close controls adjust. Seed/legacy groups omit it and
  // fall back to capacity minus app-registered members.
  if (g && g.seatsOpen != null) return Math.max(0, Math.min(g.seatsTotal, g.seatsOpen));
  return Math.max(0, g.seatsTotal - g.members.length);
};
const allVerified = (g) => g.members.length > 0 && g.members.every((m) => m.verified);
const policyAvatar = (p) => (p === 'women' ? 'from-pink-500 to-rose-400' : p === 'men' ? 'from-blue-500 to-indigo-400' : 'from-teal-500 to-indigo-500');

// Find the first known Pune locality named anywhere in a free-text string
// (a listing/tenancy title or address). Used to prefill the group locality from
// an existing property — the group locality dropdown only offers LOCALITIES, so a
// value we can't match is left at the current default rather than guessed wrong.
const deriveLocality = (...parts) => {
  const hay = parts.filter(Boolean).join(' ').toLowerCase();
  return LOCALITIES.find((l) => hay.includes(l.toLowerCase())) || '';
};
// A friendly default title for a replacement-flatmate group, built from what we
// already know about the property. bhk is a label like "2 BHK" (may be blank).
const replacementTitle = ({ bhk, locality } = {}) => {
  const where = locality ? ' in ' + locality : '';
  return bhk ? `1 more flatmate for a ${bhk}${where}` : `1 more flatmate${where}`;
};

// Host eligibility tiers for supply-side posts (rooms/groups). Identity is the
// floor (guaranteed by the Aadhaar gate) and carries no badge. 'owner' means the
// post is attached to an Ops-verified property the host listed; 'tenant' means a
// sitting tenant attested a registered rent agreement (replacement-flatmate case).
const HOST_TIERS = {
  owner: { label: 'Owner-verified', icon: 'badge-check', cls: 'text-emerald-300' },
  tenant: { label: 'Tenant-verified', icon: 'file-check', cls: 'text-teal-300' },
};
const hostTierMeta = (item) => (item && HOST_TIERS[item.verificationTier]) || null;
const hostVerified = (item) => !!(item && (item.verificationTier === 'owner' || item.verificationTier === 'tenant'));
// Whether a card may show its host trust badge. Tenant tier is a self-claim, so its
// badge is withheld until Ops approves the uploaded agreement (reviewStatus). Owner
// tier is backed by an already-verified property — each card decides when that proof
// exists (group: an attached verified property; room: the listing's own `verified`).
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
const matchText = (r, q) => [r.name, r.occupation, r.society, r.note, (r.localities || []).join(' '), (r.tags || []).join(' '), genderLabel(r.gender)].join(' ').toLowerCase().includes(q.toLowerCase());
const matchTextGroup = (g, q) => [g.title, g.locality, g.note, (g.tags || []).join(' '), g.members.map((m) => m.name).join(' ')].join(' ').toLowerCase().includes(q.toLowerCase());

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

// Relevance of a post to the current user's own live request. Higher = better.
// Budget is modelled as an affordability *band* around each person's number, so
// two people "match" when their ranges overlap — symmetric and more forgiving
// than a one-sided percentage gap (a ₹18k seeker and a ₹20k room should feel
// mutual, not penalised because one number is the denominator).
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

// Human-facing match strength for the "Best match" ranking. Only meaningful when
// the viewer has their own live request to compare against — returns null otherwise
// so cards stay clean for signed-out / unposted users.
const matchTier = (item, me) => {
  if (!me) return null;
  const s = matchScore(item, me);
  if (s >= 5) return 'great';
  if (s >= 3) return 'good';
  return null;
};

// Whether a post reads as "verified" for trust-first sorting/merchandising. A
// seeker/room carries a `verified` boolean; a group is verified when every listed
// member is. (Ops-approved host tiers are a secondary signal handled per-card.)
const isVerifiedPost = (x) => x.verified === true
  || (Array.isArray(x.members) && x.members.length > 0 && x.members.every((m) => m.verified));

// Return a new, sorted copy of a post list for the active sort mode.
const sortPosts = (list, mode, me) => {
  const arr = [...list];
  if (mode === 'match') arr.sort((a, b) => matchScore(b, me) - matchScore(a, me) || recencyMins(a) - recencyMins(b));
  else if (mode === 'verified') arr.sort((a, b) => (Number(isVerifiedPost(b)) - Number(isVerifiedPost(a))) || recencyMins(a) - recencyMins(b));
  else if (mode === 'budget-low') arr.sort((a, b) => (budgetOf(a) || 0) - (budgetOf(b) || 0));
  else if (mode === 'budget-high') arr.sort((a, b) => (budgetOf(b) || 0) - (budgetOf(a) || 0));
  else arr.sort((a, b) => recencyMins(a) - recencyMins(b));
  return arr;
};

// Whether a post is fresh enough to flag as new. Tied to real post age (< 24h)
// so the signal stays honest — no fabricated "active now" states.
const isFresh = (item) => recencyMins(item) < 1440;

// Translate a move-in FILTER value into a "max days from today" ceiling that a
// listing's stored move-in bucket (MOVE_RANK: now=0, 15, 30, 60 days) is tested
// against. Keeps the two shapes the filter control can produce in one place:
//   ''        -> null            no move-in filter applied
//   'now'     -> 0              only listings available immediately
//   ISO date  -> whole days out  "available on or before this date" (never < 0)
const moveInThreshold = (v) => {
  if (!v) return null;
  if (v === 'now') return 0;
  const target = new Date(v + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((target - today) / 86400000));
};

// A post/room stores its move-in as 'now', a legacy bucket ('15'|'30'|'60'), or an
// ISO date from the picker. These two helpers read that stored value uniformly.
// Days from today for ranking/filtering (reuses moveInThreshold's date math):
const moveInDays = (v) => {
  if (!v || v === 'now') return 0;
  if (MOVE_RANK[v] != null) return MOVE_RANK[v];
  const days = moveInThreshold(v);
  return days == null ? 0 : days;
};
// Human label for a card: 'Immediately', a legacy phrase, 'By 15 Aug', or 'Flexible'.
const moveInLabel = (v) => {
  if (v === 'now') return 'Immediately';
  if (MOVE_LBL[v]) return MOVE_LBL[v];
  if (typeof v === 'string' && v.includes('-')) {
    const d = new Date(v + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return 'By ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return 'Flexible';
};

// Read an uploaded agreement file into a storable doc shape ({name,size,mime,dataUrl}).
// Only images and PDFs are accepted (matches the file input's `accept`); anything
// else resolves null so it can't become "evidence". Oversized files (> the 3MB
// storage cap) are recorded as present-but-not-inlined WITHOUT reading the whole
// file into memory, so a huge upload can't freeze the tab. Ops can still request it.
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

// A tenant only earns the Tenant tier when a real agreement is attached — a data
// URL (small file) or a recorded-too-large file both count; an empty/absent doc
// does not. Shared by the group and room create paths so the rule can't drift.
const hasAgreementEvidence = (doc) => !!(doc && (doc.dataUrl || doc.tooLarge));

// Preview images the Saved page (and pending-chat cards) use for people/groups,
// which don't carry a photo of their own. Rooms bring their own `img`.
const SHARE_FLATMATE_IMG = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=80';
const SHARE_GROUP_IMG = 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=600&q=80';

// Rich card payload the Saved page renders for a bookmarked share post. Every
// save writes this so saved flat-shares show a real title/price/preview instead
// of the bare storage key ("s:s1"). Shape mirrors Saved.jsx's share cards:
// { kind, title, loc, price, badge, sub, img }.
const savePayload = (kind, item) => {
  if (kind === 'room') {
    const loc = item.localities?.[0] || '';
    return { kind: 'room', title: item.society, loc: loc ? loc + ', Pune' : 'Pune', price: inr(item.budget) + '/mo', badge: 'Room', sub: [item.flatType, item.roomType].filter(Boolean).join(' · '), img: item.img || SHARE_FLATMATE_IMG };
  }
  if (kind === 'group') {
    const left = seatsLeft(item);
    return { kind: 'group', title: item.title, loc: item.locality ? item.locality + ', Pune' : 'Pune', price: inr(perHead(item)) + '/mo', badge: 'Flat-share group', sub: item.members.length + ' member' + (item.members.length > 1 ? 's' : '') + ' · ' + left + ' spot' + (left === 1 ? '' : 's') + ' open', img: SHARE_GROUP_IMG };
  }
  const loc = item.localities?.[0] || '';
  return { kind: 'flatmate', title: item.name, loc: loc ? loc + ', Pune' : 'Pune', price: inr(item.budget) + '/mo', badge: 'Flatmate', sub: [genderLabel(item.gender), item.age, item.occupation].filter(Boolean).join(' · '), img: SHARE_FLATMATE_IMG };
};

// --- Geo: per-post coordinates (standardised, like a listing) ----------------
// Share-flat posts historically carried only locality NAMES. To match the
// normalized listing model — and to power a precise "Near a Place" radius filter
// and a decluttered map — every post is given per-post lat/lng. A post that
// already has real coords (e.g. a room geocoded via the list-property flow) keeps
// them; the rest derive from their primary locality centroid plus a small, stable
// per-id jitter so co-located posts don't stack on one point. Deterministic by id,
// so coords never shift between renders/reloads (keeps tests stable).
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
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
// "Near a Place" predicate shared by every tab's matcher. A post passes when it
// sits within the chosen radius of the point (commute-minute mode is converted to
// an approximate km radius at average Pune city speed, mirroring Listings). Posts
// with no coordinates can't be placed, so they drop out of a proximity search.
const nearMatches = (post, f) => {
  if (!f || !f.near) return true;
  const [nLat, nLng] = String(f.near).split(',').map(Number);
  if (Number.isNaN(nLat) || Number.isNaN(nLng)) return true;
  if (post.lat == null || post.lng == null) return false;
  const radiusKm = f.nearMode === 'min' ? (f.nearRadius || 5) * 0.4 : (f.nearRadius || 5);
  return haversineKm(nLat, nLng, post.lat, post.lng) <= radiusKm;
};

// --- Filter predicates (single source of truth) -----------------------------
// The Share-a-Flat list memos AND the empty-state "raise your budget" hint both
// need to know whether a post passes the active filters. Keeping the rule in one
// tested place stops the two from drifting. Each takes the raw filters object; the
// budget sentinel 40000 means "Any". Rooms/groups also take the host's Ops review
// status so a tenant-tier post counts as verified only once approved.
const seekerMatches = (r, f) => {
  const mt = moveInThreshold(f.moveIn);
  if (f.q && !matchText(r, f.q)) return false;
  if (f.locality && !r.localities.includes(f.locality)) return false;
  if (!nearMatches(r, f)) return false;
  if (f.budget < 40000 && r.budget > f.budget) return false;
  if (f.gender && r.gender !== f.gender && r.gender !== 'any') return false;
  if (f.verifiedOnly && !r.verified) return false;
  if (mt !== null && moveInDays(r.moveIn) > mt) return false;
  if (f.habits.length && !f.habits.every((h) => (r.tags || []).includes(h))) return false;
  return true;
};
const roomMatches = (r, f, reviewStatus) => {
  const mt = moveInThreshold(f.moveIn);
  if (f.q && !matchText(r, f.q)) return false;
  if (f.locality && !r.localities.includes(f.locality)) return false;
  if (!nearMatches(r, f)) return false;
  if (f.budget < 40000 && r.budget > f.budget) return false;
  if (f.gender && r.gender !== 'any' && r.gender !== f.gender) return false;
  if (f.verifiedOnly && !r.verified && !hostVerifiedFor(r, reviewStatus)) return false;
  if (f.attachedBath && r.attachedBath !== 'attached') return false;
  if (mt !== null && moveInDays(r.moveIn) > mt) return false;
  if (f.habits.length && !f.habits.every((h) => (r.tags || []).includes(h))) return false;
  return true;
};
const groupMatches = (g, f, reviewStatus) => {
  if (f.q && !matchTextGroup(g, f.q)) return false;
  if (f.locality && g.locality !== f.locality) return false;
  if (!nearMatches(g, f)) return false;
  if (f.gender) {
    const want = f.gender === 'female' ? 'women' : 'men';
    if (g.policy !== want && g.policy !== 'any') return false;
  }
  if (f.budget < 40000 && perHead(g) > f.budget) return false;
  if (f.sharing && g.seatsTotal !== parseInt(f.sharing, 10)) return false;
  if (f.verifiedOnly && !allVerified(g) && !hostVerifiedFor(g, reviewStatus)) return false;
  if (f.habits.length && !f.habits.every((h) => (g.tags || []).includes(h))) return false;
  return true;
};

export { inr, avatarGrad, initials, genderLabel, genderPref, foodLabel, perHead, seatsLeft, allVerified, policyAvatar, deriveLocality, replacementTitle, hostTierMeta, hostVerified, showHostBadge, hostVerifiedFor, HOST_TIERS, matchText, matchTextGroup, recencyMins, matchScore, matchTier, isVerifiedPost, sortPosts, seekerMatches, roomMatches, groupMatches, isFresh, moveInThreshold, moveInDays, moveInLabel, readAgreementDoc, hasAgreementEvidence, savePayload, SHARE_GROUP_IMG, haversineKm, withCoords, nearMatches, primaryLocality };
