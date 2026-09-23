/* Pure presentation only, so a component needing a timestamp formatted does not thereby pull in a
   data layer. The one dependency is `contactService`, which is a real service call. */

import { contactStatus } from '../services/contactService.js';

const DAY = 86400000;
const now = () => Date.now();

/** Epoch of a conversation's most recent message, falling back to the thread's own timestamp. */
export const lastAt = (c) => (c.messages[c.messages.length - 1]?.at) || c.at || 0;

export function formatTime(at, fallback = '') {
  if (!at) return fallback;
  return new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(at) {
  if (!at) return 'Today';
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(new Date(at))) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function relTime(at, fallback = '') {
  if (!at) return fallback;
  const s = Math.floor((now() - at) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h';
  const d = Math.floor(h / 24); if (d === 1) return 'Yesterday';
  if (d < 7) return d + 'd';
  return new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// A thread the server holds implies an approved contact request in one direction, so the owner side
// is decided by the row in hand; the buyer side must ask the gate. Promise either way, for one shape.
export async function canRevealParty(conv) {
  if (!conv) return false;
  if (conv.youAre !== 'buyer') return !conv.staged;
  if (!conv.propertyId) return false;
  const { status } = await contactStatus(conv.propertyId);
  return status === 'approved' || status === 'owner';
}

export const messagesLinkForProp = (p) => `/messages?openProp=${encodeURIComponent(String(p?.id || ''))}`;
