import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Property visit requests (a "Visited" review unlocks only after the owner
   confirms the visit actually happened — anti-fake-review gate).
   ========================================================================= */

/* Keyed by the owner's **account id**, matching `visits.owner_id` on the server.

   The number a visitor holds for an owner is frequently the masked one the contact gate hands out
   (`98XXXXX210`), and stripping that to digits yields `98210` — a short string several owners can
   share. Keying on it filed one owner's visits where another owner reads. The number is also the
   owner's to change, and a bucket named after it is orphaned the moment they do. An id is stable,
   opaque, and unique, which is why the server uses one; the mock must use the same one or it is
   describing a different system.

   A null id is not a bucket: it reads empty and swallows writes, rather than sharing one `'anon'`
   bucket between everybody whose identity could not be established. Ids come from
   `lib/data/ownerIdentity.js`. */
const visitReqKey = (ownerId) => (ownerId ? 'puneNestPropVisitReqs:' + ownerId : null);
export const getVisitReqs = (ownerId) => (visitReqKey(ownerId) ? get(visitReqKey(ownerId), []) : []);
export const saveVisitReqs = (ownerId, arr) => {
  const key = visitReqKey(ownerId);
  return key ? set(key, arr) : arr;
};
export const addVisitRequest = (ownerId, req) => {
  const u = readUser();
  if (!u || !ownerId) return null;
  const mine = digits(u.mobile);
  const reqs = getVisitReqs(ownerId);
  const existing = reqs.filter((r) => r.propId === (req.propId || '') && r.visitorMobile === mine && r.status === 'scheduled')[0];
  if (existing) {
    existing.date = req.date || existing.date;
    existing.time = req.time || existing.time;
    existing.mode = req.mode || existing.mode;
    if (req.note) existing.note = req.note;
    saveVisitReqs(ownerId, reqs);
    return existing;
  }
  const rec = { id: 'v' + Date.now(), propId: req.propId || '', propTitle: req.propTitle || '', visitorName: req.visitorName || u.name || 'Visitor', visitorMobile: mine, phone: req.phone || '', date: req.date || '', time: req.time || '', mode: req.mode || '', note: req.note || '', status: 'scheduled', createdAt: Date.now(), completedAt: 0 };
  reqs.unshift(rec);
  saveVisitReqs(ownerId, reqs);
  return rec;
};
export const setVisitStatus = (ownerId, id, status) => {
  const reqs = getVisitReqs(ownerId);
  reqs.forEach((r) => {
    if (r.id === id) {
      r.status = status;
      if (status === 'completed') r.completedAt = Date.now();
    }
  });
  saveVisitReqs(ownerId, reqs);
};
export const pendingVisitCount = (ownerId) => getVisitReqs(ownerId).filter((r) => r.status === 'scheduled').length;
export const hasCompletedVisit = (ownerId, propId, visitorMobile) => {
  const u = readUser();
  const mob = digits(visitorMobile || (u ? u.mobile : ''));
  if (!mob) return false;
  return getVisitReqs(ownerId).some((r) => r.propId === (propId || '') && r.visitorMobile === mob && r.status === 'completed');
};
export const myVisitStatus = (ownerId, propId) => {
  const mob = myMobile();
  if (!mob) return 'none';
  const rs = getVisitReqs(ownerId).filter((r) => r.propId === (propId || '') && r.visitorMobile === mob);
  if (!rs.length) return 'none';
  if (rs.some((r) => r.status === 'completed')) return 'completed';
  if (rs.some((r) => r.status === 'scheduled')) return 'scheduled';
  return rs[0].status;
};

