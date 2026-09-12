/**
 * Wire ↔ view-model translation for conversations.
 *
 * Separate from the provider so the mapping is reviewable on its own — the same split
 * `propertyMapper.js` and `notificationMapper.js` use, and for the same reason: a hand-written
 * mapping is exactly the thing that should not be trusted on assertion alone.
 *
 * The gap here is wider than in any previous domain, because the mock's conversation is a **richer
 * document than the server's**, not merely a differently-named one. Each divergence is handled by
 * degrading visibly rather than by inventing data.
 */

/**
 * Which side of the thread wrote this message.
 *
 * **Keyed on `authorId`, never on `author`.** The wire carries both, and the display name is the
 * tempting one — but two users may share a name, and the failure mode is that a stranger's message
 * renders on the reader's own side of the thread, styled as theirs. `authorId` was added to the
 * contract for this; if it is ever absent, fall back to "them", because misattributing someone
 * else's words *to* the reader is the worse of the two errors.
 */
const senderOf = (m, viewerId) => (m?.authorId && viewerId && m.authorId === viewerId ? 'me' : 'them');

/** Wire `Message` → the mock's message shape. */
export function toMessage(m, viewerId) {
  if (!m) return null;
  return {
    id: m.id,
    from: senderOf(m, viewerId),
    text: m.body ?? '',
    at: m.createdAt ? Date.parse(m.createdAt) : Date.now(),
    // The wire has no per-message read flag — `unread` is a count on the thread. The page uses this
    // only to draw the second tick on the reader's own messages, so treating sent messages as read
    // loses a tick, not information.
    read: true,
    author: m.author ?? undefined,
  };
}

/**
 * Wire `Conversation` → the view model the page renders.
 *
 * @param c        the wire row
 * @param viewerId the signed-in user's id, needed to attribute messages
 */
export function toViewModel(c, viewerId) {
  if (!c) return null;
  const name = c.counterpartyName || 'Draazy user';
  const messages = Array.isArray(c.messages) ? c.messages.map((m) => toMessage(m, viewerId)) : [];
  return {
    id: c.id,
    propertyId: c.propertyId ?? undefined,

    // ── the property: title is all the wire carries ────────────────────────────────────────────
    // `price`, `loc` and `img` are absent. Resolving them would be one property read per row —
    // an inbox-sized N+1 to decorate a list — so the card renders its title and omits the rest.
    //
    // `img` is `undefined`, NOT `''`. An empty string in `<img src="">` makes the browser re-request
    // the *current page* as the image, which React warns about loudly and which costs a full extra
    // page download per thread. The other two are empty strings because they are interpolated into
    // text, where undefined would render the word "undefined".
    property: {
      title: c.propertyTitle || 'Conversation',
      price: '',
      loc: '',
      img: undefined,
    },

    // ── the counterparty ──────────────────────────────────────────────────────────────────────
    party: {
      name,
      avatar: initialsOf(name),
      role: c.counterpartyRole === 'owner' ? 'Owner' : 'Buyer',
      // No presence service exists. `false` rather than undefined: the dot is rendered from this
      // directly, and "unknown" would show as "online" under a truthiness check.
      online: false,
      // Masked (98XXXXX210) until the reader's contact request against this listing is approved —
      // a server decision (ADR-019), deliberately passed through untouched.
      mobile: c.counterpartyMobile ?? '',
    },

    /**
     * Which side of the deal the reader is on.
     *
     * Derived, because the wire does not say. The counterparty's role is the only signal available:
     * if they are the owner, the reader is the buyer. It is an approximation — `role` is an account
     * attribute, and someone who lists a flat *and* hunts for one is an owner on every thread — but
     * it is per-thread and it drives only which label and which quick-replies show.
     */
    youAre: c.counterpartyRole === 'owner' ? 'buyer' : 'owner',

    /**
     * Never staged.
     *
     * A server thread cannot exist before an approved contact request, so there is no waiting or
     * incoming condition for it to be in — those describe the contact gate, one layer up. `staged`
     * is the one distinction the wire supports (D52): a row the server holds, or a row the seam is
     * still holding back. Staged rows are minted by {@link stagedToViewModel}, not here.
     *
     * Emitted explicitly rather than left undefined, because the inbox branches on it directly and
     * an absent flag reads the same as `false` only by accident.
     */
    staged: false,

    at: c.updatedAt ? Date.parse(c.updatedAt) : Date.now(),
    unread: c.unread ?? 0,
    lastMessage: c.lastMessage ?? '',
    messages,
  };
}

/** Wire page (or bare array) → the plain array the mock returns. */
export const toViewModelList = (payload, viewerId) =>
  (Array.isArray(payload) ? payload : payload?.content ?? [])
    .map((c) => toViewModel(c, viewerId))
    .filter(Boolean);

/**
 * A staged (unsent) chat → the same view-model shape, so the page cannot tell them apart.
 *
 * This is the one place the seam mints a row the server has never seen. It is marked `staged` and
 * carries the queue's own key as `id`, so nothing can mistake it for a server thread or try to
 * reply into it.
 */
export function stagedToViewModel(item) {
  const name = item?.party?.name || 'Owner';
  return {
    id: `staged:${item.propertyId}`,
    staged: true,
    propertyId: item.propertyId,
    property: item.property || { title: 'Conversation', price: '', loc: '', img: '' },
    party: { online: false, avatar: initialsOf(name), role: 'Owner', mobile: '', ...item.party, name },
    youAre: 'buyer',
    at: item.at || Date.now(),
    unread: 0,
    lastMessage: item.firstMessage || '',
    messages: item.firstMessage
      ? [{ id: 'staged-1', from: 'me', text: item.firstMessage, at: item.at || Date.now(), read: false }]
      : [],
  };
}

/** View-model input → the `ConversationCreate` body. */
export function toConversationCreate({ counterpartyMobile, propertyId, body }) {
  const out = { body };
  // Both addressing fields are omitted rather than sent null. `counterpartyMobile` is optional when
  // `propertyId` names a listing (the server derives the owner) and carries an `@IndianMobile`
  // constraint that a null or an empty string would fail as a 422; `propertyId` is validated as a
  // UUID when present, and a general (non-listing) thread is a legitimate shape.
  if (counterpartyMobile) out.counterpartyMobile = counterpartyMobile;
  if (propertyId) out.propertyId = propertyId;
  return out;
}

const initialsOf = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase() || 'PN';
