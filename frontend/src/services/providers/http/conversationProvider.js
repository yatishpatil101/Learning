/* Mirrors the mock's method names, argument order and return shapes — `conversationService.js` is the only
   contract between them. The staging queue below is this file's one piece of real logic. */
import { get, post } from '../../http.js';
import { readUser } from '../../../lib/auth.js';
import {
  stagedToViewModel,
  toConversationCreate,
  toMessage,
  toViewModel,
  toViewModelList,
} from './conversationMapper.js';

/* The inbox filters, searches and totals client-side, so it needs the whole list. 100 is the server's hard
   ceiling (`spring.data.web.pageable.max-page-size`) and asking for more is silently clamped. */
const PAGE_SIZE = 100;

/** Staged chats: composed, but not sendable until the contact gate opens. */
const QUEUE_KEY = 'dzPendingRequests';

export async function listConversations() {
  const page = await get('/messages', { size: PAGE_SIZE });
  warnIfTruncated(page);
  const live = toViewModelList(page, viewerId());
  // Staged rows sort in with the real ones so the Requests tab is one list, not a special case.
  const staged = readQueue().map(stagedToViewModel);
  return [...live, ...staged].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function getConversation(id) {
  if (String(id).startsWith('staged:')) {
    return readQueue().map(stagedToViewModel).find((c) => c.id === id) ?? null;
  }
  try {
    return toViewModel(await get(`/messages/${encodeURIComponent(id)}`), viewerId());
  } catch (err) {
    // A non-participant gets 404 by design — the id is the secret — and the page renders a
    // "not found" state from `null`, so translate rather than making every caller catch.
    if (err?.status === 404) return null;
    throw err;
  }
}

/* Find-or-create: 201 new, 200 existing, both returning the thread. Throws without an approved contact
   request — the guard stopping this endpoint being a way to test mobiles against the user base. */
export async function startConversation({ counterpartyMobile, propertyId, firstMessage } = {}) {
  const body = toConversationCreate({ counterpartyMobile, propertyId, body: firstMessage });
  return toViewModel(await post('/messages', body), viewerId());
}

export async function replyToConversation(id, body) {
  return toMessage(await post(`/messages/${encodeURIComponent(id)}/reply`, { body }), viewerId());
}

export async function markConversationRead(id) {
  if (String(id).startsWith('staged:')) return;
  await post(`/messages/${encodeURIComponent(id)}/read`, {});
}

/* No count endpoint exists, so this sums the inbox page. Accurate up to the ceiling, and audibly wrong
   beyond it rather than silently. */
export async function unreadCount() {
  const page = await get('/messages', { size: PAGE_SIZE });
  const fromServer = (page?.content ?? []).reduce((n, c) => n + (c.unread || 0), 0);
  return fromServer + readQueue().length;
}

/* "Message owner" is reachable before the contact gate opens, where `POST /messages` answers 403 — so stage
   locally and drain once it opens. `active: true` means the gate is open already, so nothing is staged. */
export async function queuePendingChat(property, { firstMessage, active = false } = {}) {
  if (!property?.id || active) return;
  const queue = readQueue();
  // One staged chat per listing — pressing the button twice is not two requests, but a typed message still
  // has to land, since the second press usually carries what the buyer actually wanted to say.
  const staged = queue.find((q) => q.propertyId === String(property.id));
  if (staged) {
    if (firstMessage) { staged.firstMessage = firstMessage; writeQueue(queue); }
    return;
  }
  queue.push({
    propertyId: String(property.id),
    at: Date.now(),
    property: {
      title: property.title || 'Property',
      price: property.priceStr || (property.price ? `₹${property.price}` : ''),
      loc: property.locality ? `${property.locality}, Pune` : 'Pune',
      img: property.image || property.img || '',
    },
    // The owner's mobile is deliberately NOT copied: under D5 the raw number is revealed only to the owner,
    // so it is masked here in every state. The drain addresses the thread by `propertyId` instead.
    party: { name: property.owner || 'Owner', role: 'Owner' },
    firstMessage: firstMessage
      || `Hi, I'm interested in "${property.title || 'this property'}" on Draazy. Is it still available?`,
  });
  writeQueue(queue);
}

/* Addressed by `propertyId` alone — the server derives the owner — because under D5 the unmasked mobile is
   never readable here. An entry the server still refuses stays queued: the gate may open later. */
export async function drainPendingChats() {
  const queue = readQueue();
  if (!queue.length) return { sent: 0, blocked: 0 };

  const remaining = [];
  let sent = 0;
  for (const item of queue) {
    try {
      await post('/messages', toConversationCreate({
        propertyId: item.propertyId,
        body: item.firstMessage,
      }));
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
  return { sent, blocked: remaining.length };
}

// ─── Internals ────────────────────────────────────────────────────────────────────────────────

/* `null` is survivable: the mapper then treats every message as the counterparty's, which is the safer
   direction than claiming a stranger's words are the reader's. */
const viewerId = () => readUser()?.id ?? null;

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    // A corrupt queue must not take the inbox down with it.
    return [];
  }
}

function writeQueue(next) {
  try {
    if (next.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    else localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* quota or private mode — the staged chat is lost, the inbox still works */
  }
}

function warnIfTruncated(page) {
  const returned = page?.content?.length ?? 0;
  if ((page?.totalElements ?? 0) > returned) {
    console.warn(
      `[conversation] ${page.totalElements} threads exist but only ${returned} were fetched. ` +
        'The unread badge and the inbox search are now reading a partial list — the page needs ' +
        'real paging.',
    );
  }
}
