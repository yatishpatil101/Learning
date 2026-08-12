/* The mock store for buyer↔owner conversations.
   State lives in localStorage under `pnConversations`; `pnPendingRequests` is the hand-off queue a
   listing uses to drop a buyer straight into a conversation.

   **This is no longer what the app reads.** Since the conversations slice, every consumer goes
   through `services/conversationService.js`, and this file is reached only by
   `providers/mock/conversationProvider.js` — it is one of two backends behind that seam, not the
   source of truth. Its reactivity hooks were removed for that reason: a localStorage-backed
   `useChatUnread` sitting next to `ConversationContext` is an invitation to wire the navbar to the
   store that is empty in http mode.

   **No `state` machine (D52).** This store used to model `active` / `incoming` / `pending`, a
   vocabulary the contract has no field for. It is gone. The only distinction the wire supports is
   whether a row is a real thread or one the seam is still holding back, and the http mapper already
   carries that as `staged` — so that is the flag both providers emit and the only one the inbox
   reads. `incoming` had no counterpart at all: on the server a conversation cannot exist until a
   contact request has been approved, so the accepting happens one layer up, in the contact gate. */

import { contactStatus } from '../services/contactService.js';
import { digits } from './contact.js';
import { rawDb } from './mockApi.js';

export const KEY = 'pnConversations';
const QUEUE_KEY = 'pnPendingRequests';

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const now = () => Date.now();

const IMG = {
  p1: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=600&q=80',
  p2: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=600&q=80',
  p3: 'https://images.unsplash.com/photo-1605146769289-440113cc3d00?w=600&q=80',
  p4: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=600&q=80',
};

// Seeds carry real epoch `at` timestamps (relative to load) so sorting and the
// day dividers behave; the legacy `time` strings are kept only as a display
// fallback for any older stored data.
//
// `c3` used to be the `incoming` seed — an owner-side request awaiting accept/decline. There is no
// such thing on the wire, so it is now what the server would actually hold at that point: a real
// thread the owner has, with the buyer's opening message unread.
export function seedConversations() {
  const t = now();
  return [
    { id: 'c1', propertyId: 'p1', property: { title: '3 BHK Flat', price: '₹1.25 Cr', loc: 'Baner, Pune', img: IMG.p1 }, party: { name: 'Aarav Sharma', avatar: 'AS', role: 'Owner', online: true, mobile: '9820011111' }, youAre: 'buyer', staged: false, at: t - 14 * MIN, unread: 0, messages: [{ from: 'them', text: 'Hi! Thanks for your interest in the 3 BHK in Baner. How can I help?', at: t - 28 * MIN }, { from: 'me', text: 'Is it still available? And is the price slightly negotiable?', at: t - 26 * MIN, read: true }, { from: 'them', text: "Yes, it's available. Price is a little negotiable for a genuine buyer.", at: t - 14 * MIN }] },
    { id: 'c2', propertyId: 'p3', property: { title: '2 BHK Flat', price: '₹85 Lakh', loc: 'Wakad, Pune', img: IMG.p3 }, party: { name: 'Sneha Deshpande', avatar: 'SD', role: 'Buyer', online: false, mobile: '9820022222' }, youAre: 'owner', staged: false, at: t - DAY, unread: 2, messages: [{ from: 'them', text: "Hello, I'd like to schedule a visit this weekend.", at: t - DAY - HOUR }, { from: 'me', text: "Sure, Saturday 11 AM works. I'll share the exact location.", at: t - DAY - 30 * MIN, read: true }, { from: 'them', text: 'Perfect, thank you!', at: t - DAY }] },
    { id: 'c3', propertyId: 'p2', property: { title: '4 BHK Villa', price: '₹2.8 Cr', loc: 'Koregaon Park, Pune', img: IMG.p2 }, party: { name: 'Rohit More', avatar: 'RM', role: 'Buyer', online: true, mobile: '9820033333' }, youAre: 'owner', staged: false, at: t - 2 * HOUR, unread: 1, messages: [{ from: 'them', text: "Hi, I'm interested in your 4 BHK Villa. Can we discuss the details and a visit?", at: t - 2 * HOUR }] },
    { id: 'c4', propertyId: 'p4', property: { title: '4 BHK Penthouse', price: '₹3.5 Cr', loc: 'Kalyani Nagar, Pune', img: IMG.p4 }, party: { name: 'Property Owner', avatar: 'PO', role: 'Owner', online: false, mobile: '9820044444' }, youAre: 'buyer', staged: true, at: t - HOUR, unread: 0, messages: [{ from: 'me', text: "Hi, I'd like to chat about this penthouse and a possible site visit.", at: t - HOUR }] },
  ];
}

// A stored conversation is only usable if it matches the current schema (a `messages` array, and no
// `state`). Rejecting on `messages` throws out legacy/foreign data written under the same key by the
// old chat widget; rejecting on the presence of `state` throws out this store's own pre-D52 rows,
// which would otherwise load with a field nothing reads and a missing `staged`, quietly promoting a
// waiting request into a chat the owner never approved. A rejected store re-seeds, which is the
// right outcome for a demo backend.
export const isValidConv = (c) => c && typeof c === 'object' && Array.isArray(c.messages) && !('state' in c);

// Demo seeds are on by default (nice for the prototype) but can be switched off
// from admin → Settings → flags (`demoChatSeed`) for a realistic empty-inbox walkthrough.
const seedingEnabled = () => {
  try { return rawDb()?.settings?.flags?.demoChatSeed !== false; } catch { return true; }
};

export const lastAt = (c) => (c.messages[c.messages.length - 1]?.at) || c.at || 0;
const byRecent = (a, b) => lastAt(b) - lastAt(a);

function parse(raw) {
  let convs = null;
  try { convs = JSON.parse(raw); } catch { convs = null; }
  if (!Array.isArray(convs) || !convs.length || !convs.every(isValidConv)) {
    convs = seedingEnabled() ? seedConversations() : [];
  }
  return [...convs].sort(byRecent);
}

// Cached snapshot so repeated reads between writes do not re-parse and re-sort the whole list.
let _cache = { raw: undefined, val: [] };
export function readConversations() {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  if (raw === _cache.raw) return _cache.val;
  _cache = { raw, val: parse(raw) };
  return _cache.val;
}

export function saveConversations(next) {
  const sorted = [...next].sort(byRecent);
  try { localStorage.setItem(KEY, JSON.stringify(sorted)); } catch { /* quota */ }
  _cache = { raw: JSON.stringify(sorted), val: sorted };
  return sorted;
}

// Merge any queued property→chat hand-offs into the conversation list. Side-
// effecting: consumes `pnPendingRequests`. The inbox calls this once on mount.
export function loadConversations() {
  let convs = readConversations().map((c) => ({ ...c }));
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { queue = []; }
  if (!queue.length) return convs;

  const toSend = new Set();
  queue.forEach((item) => {
    const existing = convs.find((c) => c.propertyId === item.propertyId && c.youAre === 'buyer');
    if (existing) {
      // An approved contact lets a still-staged request through as a real thread.
      if (item.staged === false && existing.staged) toSend.add(existing.id);
    } else {
      convs.unshift({
        id: 'c' + now() + Math.floor(Math.random() * 999),
        propertyId: item.propertyId,
        property: item.property,
        party: { online: false, ...item.party },
        youAre: 'buyer',
        // Staged unless the queue says the gate was already open. `queuePendingChat` on the http
        // provider writes no flag at all, and a chat it staged is by definition still waiting.
        staged: item.staged !== false,
        at: now(),
        unread: 0,
        messages: [{ from: 'me', text: item.firstMessage || "Hi, I'm interested in this property. Can we chat about the details and a possible visit?", at: now() }],
      });
    }
  });
  if (toSend.size) convs = convs.map((c) => (toSend.has(c.id) ? { ...c, staged: false } : c));
  localStorage.removeItem(QUEUE_KEY);
  return saveConversations(convs);
}

// Attention count for the navbar badge: unread messages plus staged requests — the same two parts,
// in the same order, as `providers/http/conversationProvider.unreadCount`.
export function unreadCount(convs = readConversations()) {
  return convs.reduce((n, c) => n + (c.unread || 0) + (c.staged ? 1 : 0), 0);
}

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

/* ---------- property → chat bridge (unchanged behaviour, richer party) ---------- */

export function queueOwnerChat(p, { active = false, firstMessage } = {}) {
  if (!p) return;
  const owner = p.owner || 'Owner';
  try {
    const pending = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    pending.push({
      propertyId: String(p.id || ''),
      // `staged: false` = the contact gate is already open, so the buyer can chat immediately;
      // `true` = the chat is held back until it opens. Same flag the inbox reads.
      staged: !active,
      property: {
        title: p.title || 'Property',
        price: p.priceStr || (p.price ? '₹' + p.price : ''),
        loc: p.locality ? p.locality + ', Pune' : 'Pune',
        img: p.image || p.img || '',
      },
      party: { name: owner, avatar: owner.slice(0, 2).toUpperCase(), role: 'Owner', online: false, mobile: digits(p.ownerMobile) },
      firstMessage: firstMessage || `Hi, I'm interested in "${p.title || 'this property'}" on PuneNest. Is it still available?`,
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(pending));
  } catch { /* quota */ }
}

export const messagesLinkForProp = (p) => `/messages?openProp=${encodeURIComponent(String(p?.id || ''))}`;
