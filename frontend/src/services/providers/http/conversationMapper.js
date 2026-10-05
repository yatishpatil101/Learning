
/** Where the view model wants more than the wire carries, each divergence is handled by degrading visibly rather than
 * by inventing data. */
const senderOf = (m, viewerId) => (m?.authorId && viewerId && m.authorId === viewerId ? 'me' : 'them');

/** Wire `Message` → the view model's message shape. */
export function toMessage(m, viewerId) {
  if (!m) return null;
  return {
    id: m.id,
    clientId: m.clientId ?? undefined,
    from: senderOf(m, viewerId),
    text: m.body ?? '',
    at: m.createdAt ? Date.parse(m.createdAt) : Date.now(),
    read: !!m.read,
    delivered: !!m.delivered,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    replyTo: m.replyTo ?? null,
    author: m.author ?? undefined,
  };
}

export function toViewModel(c, viewerId) {
  if (!c) return null;
  const group = c.kind === 'group' ? { id: c.groupId, title: c.groupTitle || 'Group', memberCount: c.memberCount ?? 0 } : null;
  const name = group ? group.title : c.counterpartyName || 'Draazy user';
  const messages = Array.isArray(c.messages) ? c.messages.map((m) => toMessage(m, viewerId)) : [];
  return {
    id: c.id,
    propertyId: c.propertyId ?? undefined,
    // A flatmate group's thread: many members, no counterparty and no listing.
    group,

    property: propertyOf(c, group),

    party: {
      name,
      avatar: initialsOf(name),
      role: group ? 'Group' : c.counterpartyRole === 'owner' ? 'Owner' : 'Buyer',
      // Masked (98XXXXX210) until the reader's contact request against this listing is approved —
      // a server decision (ADR-019), deliberately passed through untouched.
      mobile: c.counterpartyMobile ?? '',
    },

    youAre: c.youAre || (group ? 'member' : c.counterpartyRole === 'owner' ? 'buyer' : 'owner'),

    /* Server threads exist only after contact approval; waiting states belong to the gate above. */
    staged: false,

    at: c.updatedAt ? Date.parse(c.updatedAt) : Date.now(),
    unread: c.unread ?? 0,
    lastMessage: c.lastMessage ?? '',
    presence: c.presence ?? null,
    archived: !!c.archived,
    muted: !!c.muted,
    blocked: !!c.blocked,
    awaitingReply: !!c.awaitingReply,
    messages,
  };
}

/** Wire page (or bare array) → a plain array. */
export const toViewModelList = (payload, viewerId) =>
  (Array.isArray(payload) ? payload : payload?.content ?? [])
    .map((c) => toViewModel(c, viewerId))
    .filter(Boolean);

/* Staged chats share the server row shape so the page renders queued messages identically. */
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

function propertyOf(c, group) {
  if (group) return { title: group.title, price: '', loc: '', img: undefined, available: true };
  const available = c.propertyAvailable !== false;
  const price = available && Number.isFinite(c.propertyPrice)
    ? `₹${new Intl.NumberFormat('en-IN').format(c.propertyPrice)}${c.propertyDeal === 'rent' ? '/mo' : ''}`
    : '';
  return {
    title: c.propertyTitle || 'Conversation',
    price,
    deal: c.propertyDeal || null,
    bhk: c.propertyBhk || '',
    loc: available ? (c.propertyLocality || '') : '',
    img: available ? (c.propertyCover || undefined) : undefined,
    available,
  };
}
