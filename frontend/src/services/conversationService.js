/**
 * Conversation Service — public API for in-app messaging.
 *
 * The `/messages` inbox, the property→chat bridge and the navbar unread badge all read through
 * here, so the feature can never fork into two schemas again — the same reason `lib/chat.js` was
 * written, one layer down.
 *
 * ## What the server does and does not model
 *
 * Five endpoints cover the thread itself: list (paged), start (find-or-create), detail, reply,
 * mark-read. What the server has **no concept of** is the mock's `state` machine:
 *
 * > A conversation only exists once the two people already have business together — an approved
 * > contact request in one direction or the other (`ConversationService.related`). There is nothing
 * > to accept, because the contact gate already did the accepting.
 *
 * So every server thread is `active`. The mock's `pending` (I asked, they have not accepted) and
 * `incoming` (they asked, I have not accepted) describe a negotiation that happens one layer up, in
 * the contact gate, and the accept/decline buttons that act on them have no server counterpart.
 *
 * `pending` survives as a **client-side staging queue** (`pnPendingRequests`) — a chat the user has
 * composed but which cannot be sent until the gate opens. `startConversation` drains it. That is the
 * same split the anonymous saved-search capture took (D85): stage locally, submit when the server
 * can accept it, and never write a local record that pretends to be a server one.
 *
 * ## Shape gaps, each degraded rather than faked
 *
 * | Mock field | Server | What happens |
 * |---|---|---|
 * | `state` | — | always `active` on live threads; `pending` only from the local queue |
 * | `youAre` | — | derived from `counterpartyRole` |
 * | `property.{price,loc,img}` | `propertyTitle` only | title renders, the rest is omitted |
 * | `party.online` | — | always `false` — there is no presence service |
 * | message `type: 'card'`, `icon` | — | share chips send their text; the icon is lost |
 */
import { createProvider } from './config.js';

const provider = createProvider('conversation');

/** The caller's inbox, newest first. Threads are omitted — use {@link getConversation}. */
export const listConversations = () => provider().listConversations();

/** One thread with its messages. `null` when it does not exist or the caller is not in it. */
export const getConversation = (id) => provider().getConversation(id);

/**
 * Open a thread, or return the existing one.
 *
 * Find-or-create on both providers, so a client that has lost track of an id cannot fork the
 * conversation by asking again.
 *
 * **Throws when the two parties have no approved contact.** That is the server's rule and the seam
 * does not soften it: the caller should stage the request instead — see {@link queuePendingChat}.
 */
export const startConversation = (input) => provider().startConversation(input);

/** Send a message into an existing thread. Resolves with the message as stored. */
export const replyToConversation = (id, body) => provider().replyToConversation(id, body);

/** Mark the caller's side of a thread read. Idempotent on both providers. */
export const markConversationRead = (id) => provider().markConversationRead(id);

/**
 * Total attention count for the navbar badge — unread messages plus staged requests.
 *
 * Its own operation rather than `listConversations().length` so the count is defined in one place;
 * the badge and the page disagreeing after an action is the classic version of this bug.
 */
export const unreadCount = () => provider().unreadCount();

/**
 * Stage a chat that cannot be sent yet.
 *
 * The property page's "Message owner" button is reachable *before* the contact gate has opened, but
 * `POST /messages` would 403 for exactly that user. Rather than disable the button (removing a
 * working affordance) or let it throw (a dead button), the message is queued on the device and sent
 * by {@link drainPendingChats} once approval lands.
 */
export const queuePendingChat = (property, options) => provider().queuePendingChat(property, options);

/**
 * Send everything staged that can now be sent, and report what happened.
 *
 * Returns `{ sent, blocked }`. `blocked` entries stay queued — the gate may open later — which is
 * why this is not a fire-and-forget drain.
 */
export const drainPendingChats = () => provider().drainPendingChats();
