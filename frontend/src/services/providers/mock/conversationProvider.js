/**
 * Mock conversation provider — the localStorage counterpart to `providers/http/conversationProvider.js`.
 *
 * Storage stays exactly where it was (`pnConversations` / `pnPendingRequests` in `lib/chat.js`), so
 * the seeded demo inbox, the navbar badge and the property→chat bridge keep working unchanged. What
 * this adds is the provider *shape*: the same eight operations the http provider exposes, in the
 * same argument order, returning the same view models.
 *
 * The mock is the richer of the two — it has presence and a nested property object that the server
 * does not model. Those fields are emitted here and simply absent (or constant) on the http side;
 * see `conversationService.js` for the table. It no longer has a `state` machine: that vocabulary
 * was the frontend's own invention and was retired in D52, leaving both providers speaking the one
 * distinction the wire supports — `staged`.
 */
import {
  loadConversations as _load,
  readConversations as _read,
  saveConversations as _save,
  unreadCount as _unreadCount,
  queueOwnerChat as _queue,
} from '../../../lib/chat.js';

export async function listConversations() {
  // `loadConversations` drains the pending queue as a side effect, which is exactly the mock's
  // equivalent of `drainPendingChats` — on one store the two operations collapse into one.
  return _load();
}

export async function getConversation(id) {
  return _read().find((c) => c.id === id) ?? null;
}

/**
 * Find-or-create, mirroring the server. The mock has no relationship guard — there is no contact
 * table to consult — so this never throws where the API would 403. That asymmetry is safe in one
 * direction only: mock-mode is permissive, so a flow that works live also works on mocks.
 */
export async function startConversation({ propertyId, property, firstMessage, active = false } = {}) {
  const convs = _read();
  const existing = convs.find((c) => c.propertyId === propertyId && c.youAre === 'buyer');
  if (existing) return existing;
  _queue({ id: propertyId, ...property }, { active, firstMessage });
  return _load().find((c) => c.propertyId === propertyId && c.youAre === 'buyer') ?? null;
}

export async function replyToConversation(id, body) {
  const at = Date.now();
  const next = _read().map((c) => (c.id === id
    ? { ...c, at, messages: [...c.messages, { from: 'me', text: body, at, read: false }] }
    : c));
  _save(next);
  return { id: `m${at}`, from: 'me', text: body, at, read: false };
}

export async function markConversationRead(id) {
  _save(_read().map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
}

export async function unreadCount() {
  return _unreadCount(_read());
}

export async function queuePendingChat(property, options) {
  _queue(property, options);
}

/** One store, so a staged chat is already in the list — draining is what `loadConversations` does. */
export async function drainPendingChats() {
  const before = _read().length;
  const after = _load();
  return { sent: Math.max(0, after.length - before), blocked: 0 };
}
