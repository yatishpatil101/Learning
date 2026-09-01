import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { allSocieties, registerCommunitySocieties, registerSocietyMerges, societyBySlug } from '../../data/societies.js';
import { get, set } from './internals.js';
import { COMMUNITY_SOC_KEY, addSocietyLead, getCommunitySocieties, searchSocieties } from './community.js';
import { FOLLOW_KEY, QA_KEY, allSocietyQA, getFollowedSocieties } from './society.js';

/* =========================================================================
   Society Hub — Phase 2: claims, resident verification, admin overlay
   All state is a localStorage overlay; societies.js stays a pure static
   module. resolveSociety(slug) is the single merged read used by consumers.
   ========================================================================= */
const CLAIM_KEY = 'pnSocietyClaims';
export const getSocietyClaims = () => get(CLAIM_KEY, []);
export const getSocietyClaim = (slug) => getSocietyClaims().find((c) => c.slug === slug) || null;
export const requestSocietyClaim = (o) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const existing = getSocietyClaim(o.slug);
  // One active claim per society: block a competing pending/approved claim from a different user
  // (the same user may re-submit to update their own pending request).
  if (existing && existing.by !== mob && (existing.status === 'pending' || existing.status === 'approved')) return 'exists';
  const arr = getSocietyClaims().filter((c) => c.slug !== o.slug);
  const claim = Object.assign({ id: 'sc' + Date.now(), at: Date.now(), status: 'pending', by: mob }, o || {});
  arr.unshift(claim);
  set(CLAIM_KEY, arr);
  return claim;
};
export const setSocietyClaimStatus = (slug, status, by) => {
  const arr = getSocietyClaims();
  const c = arr.find((x) => x.slug === slug);
  if (!c) return null;
  c.status = status;
  c.decidedAt = Date.now();
  if (by) c.decidedBy = by;
  set(CLAIM_KEY, arr);
  // On approval the claimant becomes this society's admin (unlocks committee-side resident review);
  // any other decision clears the managed state.
  if (status === 'approved') setSocietyOverlay(slug, { claimStatus: 'claimed', adminMobile: c.by, adminName: c.name || 'Committee' });
  else setSocietyOverlay(slug, { claimStatus: 'unclaimed', adminMobile: '', adminName: '' });
  return c;
};

const RESIDENT_KEY = 'pnSocietyResidents';
export const getResidentReqs = () => get(RESIDENT_KEY, []);
// A flat is one physical unit — normalise wing + flat into a single comparable key.
export const unitKeyOf = (wing, flat) => String(`${wing || ''} ${flat || ''}`).toUpperCase().replace(/\s+/g, '');
export const verifiedResidentForUnit = (slug, unitKey) =>
  unitKey ? getResidentReqs().find((r) => r.slug === slug && r.status === 'verified' && r.unitKey === unitKey) || null : null;
export const residentUnitConflict = (slug, unitKey, mobile) => {
  const holder = verifiedResidentForUnit(slug, unitKey);
  return !!holder && holder.mobile !== digits(mobile);
};
export const residentStatus = (slug, mobile) => {
  const mob = digits(mobile || (readUser() || {}).mobile);
  if (!mob) return null;
  return getResidentReqs().find((r) => r.slug === slug && r.mobile === mob) || null;
};
export const isVerifiedResident = (slug, mobile) => {
  const r = residentStatus(slug, mobile);
  return !!r && r.status === 'verified';
};
export const requestResidentVerification = (slug, o = {}) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const unitKey = unitKeyOf(o.wing, o.flat);
  const claimed = (resolveSociety(slug) || {}).claimStatus === 'claimed';
  const arr = getResidentReqs().filter((r) => !(r.slug === slug && r.mobile === mob));
  const req = Object.assign(
    { id: 'rv' + Date.now(), at: Date.now(), status: 'pending', slug, mobile: mob, name: u.name || 'Resident' },
    o,
    {
      unitKey,
      assignedTo: claimed ? 'committee' : 'ops',
      flagged: residentUnitConflict(slug, unitKey, mob) ? 'conflict' : null,
    },
  );
  arr.unshift(req);
  set(RESIDENT_KEY, arr);
  return req;
};
export const setResidentStatus = (slug, mobile, status, by) => {
  const arr = getResidentReqs();
  const r = arr.find((x) => x.slug === slug && x.mobile === mobile);
  if (!r) return null;
  // Enforce flat uniqueness at the write: never grant a unit already held by another resident.
  if (status === 'verified' && residentUnitConflict(slug, r.unitKey, mobile)) return 'conflict';
  r.status = status;
  r.decidedAt = Date.now();
  if (by) r.decidedBy = by;
  if (status === 'verified') r.flagged = null;
  set(RESIDENT_KEY, arr);
  return r;
};

const OVERLAY_KEY = 'pnSocietyOverlay';
const allOverlays = () => get(OVERLAY_KEY, {});
export const getSocietyOverlay = (slug) => allOverlays()[slug] || null;
export const setSocietyOverlay = (slug, patch) => {
  const all = allOverlays();
  all[slug] = Object.assign({}, all[slug], patch);
  set(OVERLAY_KEY, all);
  return all[slug];
};

/* Single merged read: static record + admin overlay + derived claim status.
   Declared as a function so earlier exports (e.g. searchSocieties) can call it. */
export function resolveSociety(slug) {
  const base = societyBySlug(slug);
  if (!base) return null;
  const overlay = getSocietyOverlay(base.slug) || getSocietyOverlay(slug) || {};
  const claim = getSocietyClaim(base.slug);
  let claimStatus = 'unclaimed';
  if (claim && claim.status === 'approved') claimStatus = 'claimed';
  else if (claim && claim.status === 'pending') claimStatus = 'pending';
  else if (overlay.claimStatus || base.claimStatus) claimStatus = overlay.claimStatus || base.claimStatus;
  return Object.assign({}, base, overlay, { claimStatus });
}

/* =========================================================================
   Society candidates + verify + merge (ops dedup of auto-minted rows)
   Auto-mint (supply + demand) inevitably creates duplicates and typos. Ops
   verify the good ones (community → verified) and merge the dupes into a
   canonical society; every lookup then redirects via registerSocietyMerges().
   ========================================================================= */
const MERGE_KEY = 'pnSocietyMerges';
export const getSocietyMerges = () => get(MERGE_KEY, {});
// Rehydrate merge redirects into societies.js so lookups follow them on load.
registerSocietyMerges(getSocietyMerges());

// Name tokens for fuzzy duplicate detection — drop generic/geographic filler.
const SOC_STOPWORDS = new Set(['the', 'of', 'by', 'and', 'society', 'apartments', 'apartment', 'residency', 'residences', 'homes', 'phase', 'wing', 'tower', 'towers', 'co', 'op', 'chs', 'ltd', 'pune']);
const socTokens = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && t.length > 1 && !SOC_STOPWORDS.has(t));

/* Suggest likely duplicates of a candidate across the whole catalogue, ranked by
   shared name tokens (+ same-locality boost). Verified targets float up so a
   merge canonicalises INTO the trusted row. */
export const suggestDuplicates = (cand, limit = 6) => {
  if (!cand) return [];
  const myTokens = socTokens(cand.name);
  if (!myTokens.length) return [];
  const merges = getSocietyMerges();
  return allSocieties()
    .filter((s) => s.slug !== cand.slug && !merges[s.slug])
    .map((s) => {
      const t = socTokens(s.name);
      const shared = t.filter((x) => myTokens.includes(x)).length;
      const score = shared / Math.max(1, Math.min(myTokens.length, t.length));
      const r = resolveSociety(s.slug) || s;
      const verified = !!(r.registration && r.conveyance) && r.tier !== 'community';
      const sameLoc = cand.localitySlug && s.localitySlug === cand.localitySlug;
      return { slug: s.slug, name: s.name, localitySlug: s.localitySlug, verified, score: score + (sameLoc ? 0.25 : 0) };
    })
    .filter((s) => s.score >= 0.34)
    .sort((a, b) => (Number(b.verified) - Number(a.verified)) || (b.score - a.score))
    .slice(0, limit);
};

/* Community societies still awaiting verification (and not merged away) — the
   ops "Candidates" queue. Each row carries a suggested-duplicate hint.

   "Verified" is the presence of a verification stamp, not `registration && conveyance`.
   Those two describe the *building's* legal paperwork, which nobody here has seen; reading
   them as confirmation meant a member-added society whose registration flag happened to be
   set never reached the queue at all, and a confirmed one that had neither could never leave
   it. The server (`societies.verified_at` / `verified_by`, V105) makes the same distinction. */
export const getSocietyCandidates = () => {
  const merges = getSocietyMerges();
  return getCommunitySocieties()
    .filter((s) => !merges[s.slug])
    .map((s) => {
      const r = resolveSociety(s.slug) || s;
      const verified = !!r.verifiedAt || r.tier === 'verified';
      return { ...s, verified, dupes: verified ? [] : suggestDuplicates(s) };
    })
    .filter((s) => !s.verified);
};

/* Promote a community society to verified (ops action).

   Deliberately does NOT touch `registration` or `conveyance`. It used to set both, which meant
   an operator confirming that a society exists silently told every buyer reading its hub that
   its conveyance deed was done — a claim about the building's paperwork made by somebody who
   had only checked that the building is real. The badge now reads the verification stamp. */
export const verifyCommunitySociety = (slug, by) => {
  const rec = getCommunitySocieties().find((s) => s.slug === slug);
  if (!rec) return null;
  // Flip the stored tier too so raw reads (not just the overlay) agree.
  const arr = getCommunitySocieties().map((s) => (s.slug === slug ? { ...s, tier: 'verified' } : s));
  set(COMMUNITY_SOC_KEY, arr);
  registerCommunitySocieties(arr);
  return setSocietyOverlay(slug, {
    tier: 'verified',
    verifiedAt: Date.now(), verifiedBy: digits(by || myMobile()) || 'ops',
  });
};

/* =========================================================================
   Community detail suggestions — let anyone enrich a "thin" society (builder,
   size, amenities) WITHOUT full resident OTP, to speed community → verified
   conversion. Held for ops review; a PENDING suggestion never displays as fact
   (that would re-fabricate data). Applying writes an overlay so the hub then
   shows the confirmed, member-provided specs.
   ========================================================================= */
const SOC_SUGGEST_KEY = 'pnSocietySuggestions';
const allSocietySuggestions = () => get(SOC_SUGGEST_KEY, {});
export const getSocietySuggestion = (slug) => allSocietySuggestions()[slug] || null;
export const getPendingSocietySuggestions = () => Object.values(allSocietySuggestions()).filter((s) => s.status === 'pending');

const SUGGEST_NUM = ['year', 'towers', 'units', 'maintenancePerSqft'];
export const suggestSocietyDetails = (slug, fields = {}, by) => {
  if (!slug) return null;
  const clean = {};
  SUGGEST_NUM.forEach((k) => { const n = Number(fields[k]); if (fields[k] !== '' && fields[k] != null && !Number.isNaN(n) && n > 0) clean[k] = n; });
  if (String(fields.builder || '').trim()) clean.builder = String(fields.builder).trim();
  if (Array.isArray(fields.amenities) && fields.amenities.length) clean.amenities = fields.amenities.filter(Boolean).slice(0, 12);
  if (!Object.keys(clean).length) return null;
  const all = allSocietySuggestions();
  all[slug] = {
    slug, name: fields.name || (all[slug] && all[slug].name) || slug,
    localitySlug: fields.localitySlug || (all[slug] && all[slug].localitySlug) || '',
    fields: clean, by: digits(by || myMobile()) || '', at: Date.now(), status: 'pending',
  };
  set(SOC_SUGGEST_KEY, all);
  // Nudge the ops queue so a suggestion is actioned (dedup against auto leads).
  addSocietyLead({ kind: 'details', slug, society: all[slug].name, source: 'community-details' });
  return all[slug];
};

// Ops accepts a suggestion → its fields become an overlay (confirmed specs).
export const applySocietySuggestion = (slug, by) => {
  const all = allSocietySuggestions();
  const s = all[slug];
  if (!s) return null;
  all[slug] = { ...s, status: 'applied', appliedAt: Date.now(), appliedBy: digits(by || myMobile()) || 'ops' };
  set(SOC_SUGGEST_KEY, all);
  return setSocietyOverlay(slug, Object.assign({ detailsSource: 'community' }, s.fields));
};

export const dismissSocietySuggestion = (slug) => {
  const all = allSocietySuggestions();
  if (!all[slug]) return null;
  all[slug] = { ...all[slug], status: 'dismissed' };
  set(SOC_SUGGEST_KEY, all);
  return all[slug];
};

/* Merge a duplicate society into a canonical one. Records the redirect (so all
   lookups + listing bindings follow it), then moves followers and Q&A over. */
export const mergeSocieties = (fromSlug, toSlug) => {
  if (!fromSlug || !toSlug || fromSlug === toSlug) return null;
  if (!societyBySlug(toSlug)) return null;
  const merges = getSocietyMerges();
  merges[fromSlug] = toSlug;
  // Collapse any chain that pointed AT the now-merged society onto the target.
  Object.keys(merges).forEach((k) => { if (merges[k] === fromSlug) merges[k] = toSlug; });
  set(MERGE_KEY, merges);
  registerSocietyMerges(merges);
  // Move followers off the dead slug (dedupe against the target).
  //
  // This is the mock store's follow list, and deliberately still is: merging is an ops action that
  // lives entirely in localStorage, so there is no server-side merge for a server-side follow to
  // survive. When merges move server-side the follow rows move with them, in the same transaction,
  // and this block goes away rather than being ported (D227).
  const followed = getFollowedSocieties();
  if (followed.includes(fromSlug)) {
    const next = followed.filter((s) => s !== fromSlug);
    if (!next.includes(toSlug)) next.unshift(toSlug);
    set(FOLLOW_KEY, next);
  }
  // Fold resident Q&A threads into the canonical society.
  const qa = allSocietyQA();
  if (qa[fromSlug]) {
    qa[toSlug] = (qa[toSlug] || []).concat(qa[fromSlug]);
    delete qa[fromSlug];
    set(QA_KEY, qa);
  }
  return { from: fromSlug, to: toSlug };
};

/* Society admin (the approved claimant) — powers committee-side resident review (Tier 4). */
export const societyAdminMobile = (slug) => digits((getSocietyOverlay(slug) || {}).adminMobile);
export const isSocietyAdmin = (slug, mobile) => {
  const admin = societyAdminMobile(slug);
  return !!admin && admin === digits(mobile || myMobile());
};
export const committeeResidentReqs = (slug) => getResidentReqs().filter((r) => r.slug === slug);
