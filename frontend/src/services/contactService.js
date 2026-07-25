/**
 * Contact Service — owner contact request flow.
 */
import { createProvider } from './config.js';

const provider = createProvider('contact');

export const getContactReqs = (ownerMobile) => provider().getContactReqs(ownerMobile);
export const contactStatus = (ownerMobile, propId) => provider().contactStatus(ownerMobile, propId);
export const requestContact = (ownerMobile, propId) => provider().requestContact(ownerMobile, propId);
export const setContactStatus = (ownerMobile, reqId, status) => provider().setContactStatus(ownerMobile, reqId, status);
export const pendingContactCount = (ownerMobile) => provider().pendingContactCount(ownerMobile);
export const isOwnerViewer = (ownerMobile) => provider().isOwnerViewer(ownerMobile);
