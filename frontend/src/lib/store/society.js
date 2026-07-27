import { readUser } from '../auth.js';
import { digits } from '../contact.js';
import { get, set } from './internals.js';
import { isSocietyAdmin, isVerifiedResident } from './societyAdmin.js';

/* =========================================================================
   Society Hub — follow + resident Q&A (Phase 1 retention hooks)
   ========================================================================= */
export const FOLLOW_KEY = 'pnFollowedSocieties';
export const getFollowedSocieties = () => get(FOLLOW_KEY, []);
export const isSocietyFollowed = (slug) => getFollowedSocieties().includes(slug);
export const toggleFollowSociety = (slug) => {
  const list = getFollowedSocieties();
  const i = list.indexOf(slug);
  if (i >= 0) {
    list.splice(i, 1);
  } else {
    list.unshift(slug);
  }
  set(FOLLOW_KEY, list);
  return i < 0; // true if now followed
};

export const QA_KEY = 'pnSocietyQA';
export const allSocietyQA = () => get(QA_KEY, {});
export const getSocietyQA = (slug) => allSocietyQA()[slug] || [];
export const addSocietyQuestion = (slug, text) => {
  const u = readUser();
  if (!u) return 'login';
  const all = allSocietyQA();
  all[slug] = all[slug] || [];
  const q = { id: 'q' + Date.now(), user: u.name || 'User', text: String(text || '').trim(), at: Date.now(), answers: [], resident: isVerifiedResident(slug) };
  all[slug].unshift(q);
  set(QA_KEY, all);
  return q;
};
export const addSocietyAnswer = (slug, qId, text) => {
  const u = readUser();
  if (!u) return 'login';
  const all = allSocietyQA();
  const list = all[slug] || [];
  const q = list.find((x) => x.id === qId);
  if (!q) return null;
  q.answers = q.answers || [];
  q.answers.push({ id: 'a' + Date.now(), user: u.name || 'User', text: String(text || '').trim(), at: Date.now(), resident: isVerifiedResident(slug) });
  set(QA_KEY, all);
  return q;
};

/* =========================================================================
   Society Hub — community contributions (sign-in only, badge-not-gate)
   The living community layer: practical tips, trusted local vendor picks, and
   real photos. Any signed-in (L1 mobile-verified) user can add or upvote — the
   sign-in floor keeps the community accountable without walling it off. Verified
   residents carry a Resident badge; users with the opt-in identity badge carry a
   Verified badge.
   Shape: { pnSocietyContributions: { [slug]: Contribution[] } }
   Contribution: { id, kind:'tip'|'pick'|'photo', category, text?, name?, contact?,
     note?, photo?, caption?, user, mobile, resident, at, helpful:[mobile] }
   ========================================================================= */
export const CONTRIB_KEY = 'pnSocietyContributions';
const CONTRIB_KINDS = ['tip', 'pick', 'photo'];
export const allSocietyContributions = () => get(CONTRIB_KEY, {});

// Most-helpful first, then newest — surfaces the community's best knowledge.
const sortContribs = (list) => list.slice().sort((a, b) =>
  ((b.helpful || []).length - (a.helpful || []).length) || (b.at - a.at));

export const getSocietyContributions = (slug) => sortContribs(allSocietyContributions()[slug] || []);

export const getSocietyContributionCounts = (slug) => {
  const list = allSocietyContributions()[slug] || [];
  return {
    all: list.length,
    tip: list.filter((c) => c.kind === 'tip').length,
    pick: list.filter((c) => c.kind === 'pick').length,
    photo: list.filter((c) => c.kind === 'photo').length,
  };
};

export const addSocietyContribution = (slug, o = {}) => {
  const u = readUser();
  if (!u) return 'login';
  const kind = CONTRIB_KINDS.includes(o.kind) ? o.kind : 'tip';
  const category = String(o.category || '').trim().slice(0, 40);
  const text = String(o.text || '').trim().slice(0, 600);
  const name = String(o.name || '').trim().slice(0, 80);
  const contact = String(o.contact || '').trim().replace(/[^\d+\-() ]/g, '').slice(0, 20);
  const note = String(o.note || '').trim().slice(0, 300);
  const caption = String(o.caption || '').trim().slice(0, 160);
  const photo = o.photo || null;
  // Per-kind minimum so an empty contribution can't be posted.
  if (kind === 'tip' && !text) return null;
  if (kind === 'pick' && !name) return null;
  if (kind === 'photo' && !(photo && (typeof photo === 'string' || photo.dataUrl))) return null;
  const all = allSocietyContributions();
  all[slug] = all[slug] || [];
  const rec = {
    id: 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, category,
    text, name, contact, note, caption, photo,
    user: u.name || 'User', mobile: digits(u.mobile),
    resident: isVerifiedResident(slug), at: Date.now(), helpful: [],
  };
  all[slug].unshift(rec);
  set(CONTRIB_KEY, all);
  return rec;
};

// One "Helpful" vote per user; toggles off. Returns true if now marked helpful.
export const toggleContributionHelpful = (slug, id) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const all = allSocietyContributions();
  const rec = (all[slug] || []).find((c) => c.id === id);
  if (!rec) return null;
  rec.helpful = rec.helpful || [];
  const i = rec.helpful.indexOf(mob);
  if (i >= 0) rec.helpful.splice(i, 1); else rec.helpful.push(mob);
  set(CONTRIB_KEY, all);
  return i < 0;
};

// Author can delete their own; the society admin can remove any (moderation).
export const removeSocietyContribution = (slug, id) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const all = allSocietyContributions();
  const list = all[slug] || [];
  const rec = list.find((c) => c.id === id);
  if (!rec) return null;
  if (rec.mobile !== mob && !isSocietyAdmin(slug, mob)) return 'forbidden';
  all[slug] = list.filter((c) => c.id !== id);
  set(CONTRIB_KEY, all);
  return true;
};

// Short collision-resistant id.
export const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// Authoritative content (events / WhatsApp link) is limited to people who actually
// live there: a verified resident or the society's admin.
export const isResidentOrAdmin = (slug, mob) => isVerifiedResident(slug, mob) || isSocietyAdmin(slug, mob);
export const isOps = (u) => !!u && (u.role === 'admin' || u.role === 'staff');

/* ---- Threaded replies on a contribution (sign-in only) ---------------- */
export const addContributionReply = (slug, id, text) => {
  const u = readUser();
  if (!u) return 'login';
  const body = String(text || '').trim().slice(0, 500);
  if (!body) return null;
  const all = allSocietyContributions();
  const rec = (all[slug] || []).find((c) => c.id === id);
  if (!rec) return null;
  rec.replies = rec.replies || [];
  const reply = { id: uid('rp'), text: body, user: u.name || 'User', mobile: digits(u.mobile), resident: isVerifiedResident(slug), at: Date.now() };
  rec.replies.push(reply);
  set(CONTRIB_KEY, all);
  return reply;
};
export const removeContributionReply = (slug, id, rid) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const all = allSocietyContributions();
  const rec = (all[slug] || []).find((c) => c.id === id);
  if (!rec || !rec.replies) return null;
  const reply = rec.replies.find((r) => r.id === rid);
  if (!reply) return null;
  if (reply.mobile !== mob && !isSocietyAdmin(slug, mob)) return 'forbidden';
  rec.replies = rec.replies.filter((r) => r.id !== rid);
  set(CONTRIB_KEY, all);
  return true;
};

/* =========================================================================
   Society Hub — events & notices board (resident/committee-gated)
   The shared society calendar residents actually ask about: maintenance
   shutdowns, AGMs, festivals, tanker days (events, with a date) plus timeless
   announcements (notices). Reading is open; posting is limited to verified
   residents / the society admin so the board stays authoritative.
   Shape: { pnSocietyBoard: { [slug]: BoardItem[] } }
   BoardItem: { id, kind:'event'|'notice', title, body, date?, time?, category,
     user, mobile, resident, at }
   ========================================================================= */
export const BOARD_KEY = 'pnSocietyBoard';
const BOARD_KINDS = ['event', 'notice'];
export const allSocietyBoard = () => get(BOARD_KEY, {});
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const getSocietyBoard = (slug) => {
  const list = (allSocietyBoard()[slug] || []).slice();
  // Events by date ascending (upcoming first is handled in UI); notices newest-first.
  return list.sort((a, b) => {
    if (a.kind === 'event' && b.kind === 'event') return (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '');
    return b.at - a.at;
  });
};
export const addBoardItem = (slug, o = {}) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  if (!isResidentOrAdmin(slug, mob)) return 'forbidden';
  const kind = BOARD_KINDS.includes(o.kind) ? o.kind : 'notice';
  const title = String(o.title || '').trim().slice(0, 120);
  const body = String(o.body || '').trim().slice(0, 800);
  const category = String(o.category || '').trim().slice(0, 40);
  const date = DATE_RE.test(o.date || '') ? o.date : '';
  const time = /^\d{2}:\d{2}$/.test(o.time || '') ? o.time : '';
  if (!title) return null;
  if (kind === 'event' && !date) return null;
  const all = allSocietyBoard();
  all[slug] = all[slug] || [];
  const rec = { id: uid('bd'), kind, title, body, category, date, time, user: u.name || 'User', mobile: mob, resident: isVerifiedResident(slug), at: Date.now() };
  all[slug].unshift(rec);
  set(BOARD_KEY, all);
  return rec;
};
export const removeBoardItem = (slug, id) => {
  const u = readUser();
  if (!u) return 'login';
  const mob = digits(u.mobile);
  const all = allSocietyBoard();
  const list = all[slug] || [];
  const rec = list.find((x) => x.id === id);
  if (!rec) return null;
  if (rec.mobile !== mob && !isSocietyAdmin(slug, mob)) return 'forbidden';
  all[slug] = list.filter((x) => x.id !== id);
  set(BOARD_KEY, all);
  return true;
};

