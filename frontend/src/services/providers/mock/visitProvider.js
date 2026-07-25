/**
 * Mock visit provider — wraps mockApi.js visits + store.js visit requests
 */
import {
  listVisits as _listVisits,
  scheduleVisit as _scheduleVisit,
} from '../../../lib/mockApi.js';

import {
  getVisitReqs as _getVisitReqs,
  addVisitRequest as _addVisitRequest,
  setVisitStatus as _setVisitStatus,
  pendingVisitCount as _pendingVisitCount,
  hasCompletedVisit as _hasCompletedVisit,
  myVisitStatus as _myVisitStatus,
} from '../../../lib/store.js';

// Already async
export const listVisits = _listVisits;
export const scheduleVisit = _scheduleVisit;

// Sync → async
export const getVisitReqs = (ownerMobile) => Promise.resolve(_getVisitReqs(ownerMobile));
export const addVisitRequest = (ownerMobile, req) => Promise.resolve(_addVisitRequest(ownerMobile, req));
export const setVisitStatus = (ownerMobile, id, status) => Promise.resolve(_setVisitStatus(ownerMobile, id, status));
export const pendingVisitCount = (ownerMobile) => Promise.resolve(_pendingVisitCount(ownerMobile));
export const hasCompletedVisit = (ownerMobile, propId, visitorMobile) => Promise.resolve(_hasCompletedVisit(ownerMobile, propId, visitorMobile));
export const myVisitStatus = (ownerMobile, propId) => Promise.resolve(_myVisitStatus(ownerMobile, propId));
