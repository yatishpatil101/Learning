import { readUser } from '../auth.js';
import { digits } from '../contact.js';
import { getActiveCityGeo, withinBounds } from '../geoConfig.js';
import { get, set } from './internals.js';
import { ENTITY_KEY, allEntityReviews } from './reviews.js';
import { BOARD_KEY, CONTRIB_KEY, QA_KEY, allSocietyBoard, allSocietyContributions, allSocietyQA, isOps, isResidentOrAdmin, uid } from './society.js';
import { resolveSociety, setSocietyOverlay } from './societyAdmin.js';

/* =========================================================================
   Society Hub — resident WhatsApp group link (proposed → ops-approved)
   A verified resident/committee proposes the group invite; ops screen it for
   scam links (anti-scam). "Approved" means verified RESIDENTS of that society
   can join — the invite URL is a key to a private resident space and is NEVER
   published to the public. Non-residents only learn that a private group
   exists (via hasSocietyWhatsapp) and are nudged to verify their residency.
   Only real WhatsApp invite links are accepted.
   Shape: { pnSocietyWhatsapp: { [slug]: { url, by, mobile, at, status } } }
   ========================================================================= */
const WA_KEY = 'pnSocietyWhatsapp';
const WA_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{6,32}$/;
// Shared safety check so the ops queue can gate a clickable href without trusting
// a raw (possibly localStorage-tampered) pending URL.
export const isSafeWhatsappUrl = (u) => WA_RE.test(String(u || ''));
const allSocietyWhatsapp = () => get(WA_KEY, {});
// Raw record for the RESIDENT's own edit/pending view. The private invite URL is
// withheld from anyone who isn't a verified resident/committee member (non-residents
// only ever need status/metadata, which is never rendered for them anyway).
export const getSocietyWhatsappRaw = (slug) => {
  const rec = allSocietyWhatsapp()[slug] || null;
  if (!rec || !rec.url) return rec;
  const u = readUser();
  if (u && isResidentOrAdmin(slug, digits(u.mobile))) return rec;
  const { url: _url, ...safe } = rec;
  return safe;
};
// Public-safe existence flag: is there an ops-approved private group? Returns a
// boolean only — no URL leaks — so a non-resident can be told a group exists
// without being handed the invite.
export const hasSocietyWhatsapp = (slug) => {
  const rec = allSocietyWhatsapp()[slug];
  return !!(rec && rec.status === 'approved' && WA_RE.test(rec.url));
};
// Join getter: the invite URL is handed out ONLY to a verified resident /
// committee member of this society (never the public). In a real backend this
// authorization is enforced server-side; here it mirrors the propose gate.
export const getSocietyWhatsappJoin = (slug) => {
  const rec = allSocietyWhatsapp()[slug];
  if (!rec || rec.status !== 'approved' || !WA_RE.test(rec.url)) return null;
  const u = readUser();
  if (!u) return null;
  return isResidentOrAdmin(slug, digits(u.mobile)) ? rec : null;
};
export const proposeSocietyWhatsapp = (slug, url) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  if (!isResidentOrAdmin(slug, mob)) return 'forbidden';
  const clean = String(url || '').trim();
  if (!WA_RE.test(clean)) return 'badurl';
  const all = allSocietyWhatsapp();
  all[slug] = { url: clean, by: u.name || 'User', mobile: mob, at: Date.now(), status: 'pending' };
  set(WA_KEY, all);
  return all[slug];
};
export const moderateSocietyWhatsapp = (slug, action) => {
  const u = readUser();
  if (!isOps(u)) return 'forbidden';
  const all = allSocietyWhatsapp();
  const rec = all[slug];
  if (!rec) return null;
  if (action === 'approve') rec.status = 'approved';
  else if (action === 'reject') rec.status = 'rejected';
  else return null;
  rec.moderatedBy = u.name || 'Ops';
  rec.moderatedAt = Date.now();
  set(WA_KEY, all);
  return rec;
};
export const pendingSocietyWhatsapps = () =>
  Object.entries(allSocietyWhatsapp())
    .filter(([, r]) => r && r.status === 'pending')
    .map(([slug, r]) => ({ slug, ...r }));

/* =========================================================================
   Society Hub — unified moderation queue (user reports → ops)
   One store for reports against ANY hub UGC. A report carries a content
   snapshot so the ops queue renders standalone, plus the refs needed to
   delete the target on "remove". Ops-only actions.
   Shape: { pnSocietyReports: Report[] }
   Report: { id, slug, targetType, targetId, parentId?, entityId?, reason,
     snapshot, by, mobile, at, status:'open'|'removed'|'kept' }
   ========================================================================= */
const REPORT_KEY = 'pnSocietyReports';
const REPORT_TYPES = ['contribution', 'reply', 'review', 'question', 'answer', 'board'];
const allReports = () => { const v = get(REPORT_KEY, []); return Array.isArray(v) ? v : []; };
export const getSocietyReports = (status) => {
  const list = allReports();
  return (status ? list.filter((r) => r.status === status) : list).slice().sort((a, b) => b.at - a.at);
};
export const reportSocietyContent = (o = {}) => {
  const u = readUser();
  if (!u) return 'login';
  if (!REPORT_TYPES.includes(o.targetType) || !o.targetId) return null;
  const mob = digits(u.mobile);
  const list = allReports();
  // One open report per user per target.
  if (list.some((r) => r.status === 'open' && r.targetType === o.targetType && r.targetId === o.targetId && r.mobile === mob)) return 'dup';
  const rec = {
    id: uid('rep'), slug: o.slug || '', targetType: o.targetType, targetId: o.targetId,
    parentId: o.parentId || null, entityId: o.entityId || null,
    reason: String(o.reason || '').trim().slice(0, 200),
    snapshot: String(o.snapshot || '').trim().slice(0, 240),
    by: u.name || 'User', mobile: mob, at: Date.now(), status: 'open',
  };
  list.unshift(rec);
  set(REPORT_KEY, list);
  return rec;
};
// Delete the reported target from its own store. Best-effort — returns true even
// if already gone (author may have deleted it first).
const removeReportedTarget = (r) => {
  if (r.targetType === 'contribution') {
    const all = allSocietyContributions();
    all[r.slug] = (all[r.slug] || []).filter((c) => c.id !== r.targetId);
    set(CONTRIB_KEY, all);
  } else if (r.targetType === 'reply') {
    const all = allSocietyContributions();
    const c = (all[r.slug] || []).find((x) => x.id === r.parentId);
    if (c && c.replies) { c.replies = c.replies.filter((x) => x.id !== r.targetId); set(CONTRIB_KEY, all); }
  } else if (r.targetType === 'review') {
    const all = allEntityReviews();
    const key = 'society:' + (r.entityId || '');
    if (all[key]) { all[key] = all[key].filter((x) => x.id !== r.targetId); set(ENTITY_KEY, all); }
  } else if (r.targetType === 'question') {
    const all = allSocietyQA();
    all[r.slug] = (all[r.slug] || []).filter((q) => q.id !== r.targetId);
    set(QA_KEY, all);
  } else if (r.targetType === 'answer') {
    const all = allSocietyQA();
    const q = (all[r.slug] || []).find((x) => x.id === r.parentId);
    if (q && q.answers) { q.answers = q.answers.filter((a) => a.id !== r.targetId); set(QA_KEY, all); }
  } else if (r.targetType === 'board') {
    const all = allSocietyBoard();
    all[r.slug] = (all[r.slug] || []).filter((b) => b.id !== r.targetId);
    set(BOARD_KEY, all);
  }
};
export const moderateReport = (id, action) => {
  const u = readUser();
  if (!isOps(u)) return 'forbidden';
  const list = allReports();
  const rec = list.find((r) => r.id === id);
  if (!rec) return null;
  if (action === 'remove') {
    removeReportedTarget(rec);
    // Resolve every open report on the same target, not just this one.
    list.forEach((r) => { if (r.targetType === rec.targetType && r.targetId === rec.targetId && r.status === 'open') { r.status = 'removed'; r.moderatedBy = u.name || 'Ops'; r.moderatedAt = Date.now(); } });
  } else if (action === 'dismiss') {
    rec.status = 'kept';
    rec.moderatedBy = u.name || 'Ops';
    rec.moderatedAt = Date.now();
  } else return null;
  set(REPORT_KEY, list);
  return rec;
};

/* =========================================================================
   Society Hub — resident-proposed location correction (KYC + resident → ops)
   A verified resident / committee drops the society's exact pin; it stays
   PENDING until ops approve, then the coordinates are written to the society
   overlay (resolveSociety merges them, so the map + commute update). We persist
   ONLY { lat, lng, placeId } from Google — never any other Place field (ratings,
   photos, reviews, hours) per the Places ToS.
   Shape: { pnSocietyLocationFixes: { [slug]: { lat,lng,placeId,label,by,mobile,at,status } } }
   ========================================================================= */
const LOCFIX_KEY = 'pnSocietyLocationFixes';
const allLocationFixes = () => get(LOCFIX_KEY, {});
// A finite lat/lng that sits inside the active city's box, so a stray drag can't
// relocate a society across the country. Falls open only when no box is configured.
const isSaneSocietyPoint = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const { bounds } = getActiveCityGeo();
  return withinBounds(lat, lng, bounds);
};
export const getSocietyLocationFix = (slug) => allLocationFixes()[slug] || null;
export const proposeSocietyLocation = (slug, o = {}) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  if (!isResidentOrAdmin(slug, mob)) return 'forbidden';
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!isSaneSocietyPoint(lat, lng)) return 'bounds';
  const all = allLocationFixes();
  all[slug] = {
    lat, lng,
    placeId: String(o.placeId || '').slice(0, 300),
    label: String(o.label || '').trim().slice(0, 160),
    by: u.name || 'Resident', mobile: mob, at: Date.now(), status: 'pending',
  };
  set(LOCFIX_KEY, all);
  return all[slug];
};
export const pendingSocietyLocationFixes = () =>
  Object.entries(allLocationFixes())
    .filter(([, r]) => r && r.status === 'pending')
    .map(([slug, r]) => ({ slug, ...r }))
    .sort((a, b) => b.at - a.at);
export const moderateSocietyLocation = (slug, action) => {
  const u = readUser();
  if (!isOps(u)) return 'forbidden';
  const all = allLocationFixes();
  const rec = all[slug];
  if (!rec) return null;
  if (rec.status !== 'pending') return null; // already decided — no double-write / no silent revert
  if (action === 'approve') {
    const patch = { lat: rec.lat, lng: rec.lng, locSource: 'community', locFixedAt: Date.now() };
    if (rec.placeId) patch.placeId = rec.placeId;
    setSocietyOverlay(slug, patch);
    rec.status = 'approved';
  } else if (action === 'reject') {
    rec.status = 'rejected';
  } else return null;
  rec.moderatedBy = u.name || 'Ops';
  rec.moderatedAt = Date.now();
  set(LOCFIX_KEY, all);
  return rec;
};

