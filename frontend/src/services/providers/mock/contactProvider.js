/**
 * Mock contact provider — wraps lib/contact.js
 */
import {
  getContactReqs as _getContactReqs,
  contactStatus as _contactStatus,
  requestContact as _requestContact,
  setContactStatus as _setContactStatus,
  pendingContactCount as _pendingContactCount,
  isOwnerViewer as _isOwnerViewer,
} from '../../../lib/contact.js';

export const getContactReqs = (ownerMobile) => Promise.resolve(_getContactReqs(ownerMobile));
export const contactStatus = (ownerMobile, propId) => Promise.resolve(_contactStatus(ownerMobile, propId));
export const requestContact = (ownerMobile, propId) => Promise.resolve(_requestContact(ownerMobile, propId));
export const setContactStatus = (ownerMobile, reqId, status) => Promise.resolve(_setContactStatus(ownerMobile, reqId, status));
export const pendingContactCount = (ownerMobile) => Promise.resolve(_pendingContactCount(ownerMobile));
export const isOwnerViewer = (ownerMobile) => Promise.resolve(_isOwnerViewer(ownerMobile));
