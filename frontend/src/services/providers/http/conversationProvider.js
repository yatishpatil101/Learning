/**
 * HTTP conversation provider — the live counterpart to `providers/mock/conversationProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `conversationService.js`
 * is the only contract between them and no page may care which one is active. Shape translation
 * lives in `conversationMapper.js`.
 *
 * **The staging queue is this file's one piece of real logic.** Everything else is a request. See
 * `queuePendingChat` for why a client-side queue exists at all.
 */
import { get, post } from '../../http.js';
import { readUser } from '../../../lib/auth.js';
import {
  stagedToViewModel,
  toConversationCreate,
  toMessage,
  toViewModel,
  toViewModelList,
} from './conversationMapper.js';

/**
 * One large page rather than real paging.
 *
 * The inbox is filtered and searched client-side and renders a total unread count, so it needs the
 * whole list to be correct. 100 is the server's hard ceiling
 * (`spring.data.web.pageable.max-page-size`); asking for more is silently clamped, which is why
 * `warnIfTruncated` compares against the rows actually returned rather than against this constant.
 */
const PAGE_SIZE = 100;

/** Staged chats: composed, but not sendable until the contact gate opens. */
const QUEUE_KEY = 'pnPendingRequests';

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

/**
 * Find-or-create. 201 when the thread is new, 200 when it already existed; both return the thread,
 * so the seam does not need to distinguish them.
 *
 * **Throws when the two parties have no approved contact request** — the server's relationship
 * guard, which exists to stop the endpoint being a way to test mobile numbers against the user base.
 * The seam does not soften it; the caller stages instead.
 */
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

/**
 * Unread messages plus staged requests — the same total the mock computes, from the same two parts.
 *
 * No count endpoint exists, so this reads the inbox page and sums it. Accurate up to the ceiling,
 * and audibly wrong beyond it rather than silently.
 */
export async function unreadCount() {
  const page = await get('/messages', { size: PAGE_SIZE });
  const fromServer = (page?.content ?? []).reduce((n, c) => n + (c.unread || 0), 0);
  return fromServer + readQueue().length;
}

/**
 * Stage a chat the server would refuse.
 *
 * "Message owner" is reachable from a property page *before* the contact gate has opened, but
 * `POST /messages` requires an approved contact request in one direction or the other and answers
 * 403 otherwise. Three options were available and only one is honest:
 *
 * - **Hide the button until contact is approved** — matches the server exactly, but removes an
 *   affordance that works today and makes the property page's primary CTA appear and disappear.
 * - **Let it throw** — a dead button, with an error the user cannot act on.
 * - **Stage it locally and send when the gate opens** — what this does.
 *
 * The staged row is marked `staged: true` and carries a `staged:` id, so nothing can mistake it
 * for a server thread. Its limits are real: it lives on one device and does not survive clearing
 * site data. That is acceptable for a message the user has been told is *waiting*, and it is the
 * same split the anonymous saved-search capture took (D85).
 *
 * **`active: true` means the gate is already open, so nothing is staged.** The property page passes
 * it from the "Chat with Owner" affordance, which it only renders once the contact request has been
 * approved; `startConversation` is then reachable and the message belongs on the server. This is
 * the contract the mock has always had (`lib/chat.js`: `staged: !active`).
 *
 * Honouring it is an optimisation, not a correctness fix, and the distinction is worth recording so
 * nobody defends it with a test that cannot fail. `Messages.jsx` awaits `drainPendingChats()` before
 * it reads the inbox, so a row staged in the `active` case is posted, resumes the thread that
 * already exists (200, not a fork) and is gone before anything renders. Deleting this line is
 * therefore invisible to the UI — verified by mutation against `live-chat-owner.spec.js`, which
 * stayed green. What it actually buys is one avoided round-trip and one avoided localStorage write
 * per click on a path where the answer is already known.
 */
export async function queuePendingChat(property, { firstMessage, active = false } = {}) {
  if (!property?.id || active) return;
  const queue = readQueue();
  // One staged chat per listing — pressing the button twice is not two requests.
  if (queue.some((q) => q.propertyId === String(property.id))) return;
  queue.push({
    propertyId: String(property.id),
    at: Date.now(),
    property: {
      title: property.title || 'Property',
      price: property.priceStr || (property.price ? `₹${property.price}` : ''),
      loc: property.locality ? `${property.locality}, Pune` : 'Pune',
      img: property.image || property.img || '',
    },
    // The owner's mobile is deliberately NOT copied here, and `drainPendingChats` does not go
    // looking for one either: under D5 the raw number is revealed to the owner and to nobody else,
    // so on a buyer's property page it is masked in every state. The drain addresses the thread by
    // `propertyId` and lets the server name the owner.
    party: { name: property.owner || 'Owner', role: 'Owner' },
    firstMessage: firstMessage
      || `Hi, I'm interested in "${property.title || 'this property'}" on PuneNest. Is it still available?`,
  });
  writeQueue(queue);
}

/**
 * Try to send everything staged.
 *
 * Each entry is addressed by its `propertyId` alone. It used to re-read the listing for the owner's
 * unmasked mobile and skip the entry while that came back masked — which under D5 is *always*, since
 * the raw number is revealed only to the owner. Every staged chat was therefore unsendable forever,
 * and the buyer sat on "waiting for the owner to accept" long after they had accepted. The server
 * now derives the owner from the listing, so the drain sends what it holds and the contact-request
 * guard still decides whether it may. An entry the server still refuses stays queued: the gate may
 * open later, and silently dropping a message the user composed would be the worst outcome
 * available.
 */
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

/**
 * The signed-in user's id, used to attribute messages.
 *
 * Read from the session the same way the rest of the app does. `null` is survivable — the mapper
 * then treats every message as the counterparty's, which renders a readable thread rather than a
 * broken one, and is the safer direction than claiming a stranger's words are the reader's.
 */
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
