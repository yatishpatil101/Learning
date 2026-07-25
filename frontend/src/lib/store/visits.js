import { readUser } from '../auth.js';
import { digits, myMobile } from '../contact.js';
import { get, set } from './internals.js';

/* =========================================================================
   Property visit requests (a "Visited" review unlocks only after the owner
   confirms the visit actually happened — anti-fake-review gate).
   ========================================================================= */
const visitReqKey = (ownerMobile) => 'puneNestPropVisitReqs:' + (digits(ownerMobile) || 'anon');
export const getVisitReqs = (ownerMobile) => get(visitReqKey(ownerMobile), []);
export const saveVisitReqs = (ownerMobile, arr) => set(visitReqKey(ownerMobile), arr);
export const addVisitRequest = (ownerMobile, req) => {
  const u = readUser();
  if (!u) return null;
  const mine = digits(u.mobile);
  const reqs = getVisitReqs(ownerMobile);
  const existing = reqs.filter((r) => r.propId === (req.propId || '') && r.visitorMobile === mine && r.status === 'requested')[0];
  if (existing) {
    existing.date = req.date || existing.date;
    existing.time = req.time || existing.time;
    existing.mode = req.mode || existing.mode;
    if (req.note) existing.note = req.note;
    saveVisitReqs(ownerMobile, reqs);
    return existing;
  }
  const rec = { id: 'v' + Date.now(), propId: req.propId || '', propTitle: req.propTitle || '', visitorName: req.visitorName || u.name || 'Visitor', visitorMobile: mine, phone: req.phone || '', date: req.date || '', time: req.time || '', mode: req.mode || '', note: req.note || '', status: 'requested', createdAt: Date.now(), completedAt: 0 };
  reqs.unshift(rec);
  saveVisitReqs(ownerMobile, reqs);
  return rec;
};
export const setVisitStatus = (ownerMobile, id, status) => {
  const reqs = getVisitReqs(ownerMobile);
  reqs.forEach((r) => {
    if (r.id === id) {
      r.status = status;
      if (status === 'completed') r.completedAt = Date.now();
    }
  });
  saveVisitReqs(ownerMobile, reqs);
};
export const pendingVisitCount = (ownerMobile) => getVisitReqs(ownerMobile).filter((r) => r.status === 'requested').length;
export const hasCompletedVisit = (ownerMobile, propId, visitorMobile) => {
  const u = readUser();
  const mob = digits(visitorMobile || (u ? u.mobile : ''));
  if (!mob) return false;
  return getVisitReqs(ownerMobile).some((r) => r.propId === (propId || '') && r.visitorMobile === mob && r.status === 'completed');
};
export const myVisitStatus = (ownerMobile, propId) => {
  const mob = myMobile();
  if (!mob) return 'none';
  const rs = getVisitReqs(ownerMobile).filter((r) => r.propId === (propId || '') && r.visitorMobile === mob);
  if (!rs.length) return 'none';
  if (rs.some((r) => r.status === 'completed')) return 'completed';
  if (rs.some((r) => r.status === 'requested')) return 'requested';
  return rs[0].status;
};

