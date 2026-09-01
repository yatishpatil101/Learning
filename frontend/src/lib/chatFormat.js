/* Conversation presentation helpers — epoch→display formatting, the property→messages link, and
   the contact gate that decides whether a thread may show the other party's number.

   **Split out of `lib/chat.js` so that product code stops importing the mock store.** `chat.js` is
   the localStorage demo backend for conversations, and it reaches the mock database (`rawDb`) to
   read one admin flag. Seven product modules — the property page, the owner page, the map detail
   panel, the inbox and the chat primitives — wanted nothing from that store; they imported this
   handful of pure functions and got the entire `lib/mockApi/` module graph evaluated alongside
   them, in a build whose only data source is the live API.

   Nothing here touches `dzConversations`, `rawDb`, or any mock module. The one dependency is
   `contactService`, which is the seam — a real service call, not a store read. That is the point of
   the boundary: a component needing a timestamp formatted should not thereby load a demo database.

   `chat.js` imports `lastAt` back from here rather than keeping a second copy, so the sort order
   the store applies and the "last message at" the inbox renders cannot drift apart. */

import { contactStatus } from '../services/contactService.js';

const DAY = 86400000;
const now = () => Date.now();

/** Epoch of a conversation's most recent message, falling back to the thread's own timestamp. */
export const lastAt = (c) => (c.messages[c.messages.length - 1]?.at) || c.at || 0;

/* ---------- time helpers (epoch → display) ---------- */

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

/* ---------- contact-gate for in-thread Call/WhatsApp ---------- */

// The buyer may only see the owner's number once the owner has approved contact —
// the same privacy gate the rest of the app enforces. When you are the owner in a
// thread, the buyer reached out to you, and their number is visible because the thread
// exists at all: a conversation the server holds implies an approved contact request in
// one direction or the other. A row the seam is still staging is not that, so it is refused.
//
// Async on the buyer side because the gate is a server read now. The owner side stays
// synchronous-in-spirit — it is decided by the row already in hand — but the function
// returns a promise either way so callers have one shape to await.
export async function canRevealParty(conv) {
  if (!conv) return false;
  if (conv.youAre !== 'buyer') return !conv.staged;
  if (!conv.propertyId) return false;
  const { status } = await contactStatus(conv.propertyId);
  return status === 'approved' || status === 'owner';
}

/* ---------- property → chat link ---------- */

export const messagesLinkForProp = (p) => `/messages?openProp=${encodeURIComponent(String(p?.id || ''))}`;
