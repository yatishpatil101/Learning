
/** `null`/`undefined`-safe array read — every list on this wire shape is optional. */
const list = (xs) => (Array.isArray(xs) ? xs : []);

/** `from` is clamped to the two values the contract defines rather than trusted verbatim. The server assigns it by
 * comparing the sender's id to the listing's owner. */
const toMessage = (m) => ({
  id: String(m?.id ?? ''),
  from: m?.from === 'owner' ? 'owner' : 'ops',
  body: m?.body ?? '',
  at: m?.at ?? null,
  read: Boolean(m?.read),
  internal: Boolean(m?.internal),
});

/** One checklist line. `pass` is a boolean on the wire; anything falsy reads as not yet passed. */
const toChecklistItem = (c) => ({ item: c?.item ?? '', pass: Boolean(c?.pass) });

const toOverrideRequest = (row) => row ? {
  id: row.id ? String(row.id) : '',
  requestedBy: row.requestedBy ? String(row.requestedBy) : null,
  reason: row.reason ?? '',
  at: row.at ?? null,
} : null;

const toSignals = (signals) => signals ? {
  possibleBroker: Boolean(signals.possibleBroker),
  hardBlock: Boolean(signals.hardBlock),
  conflict: Boolean(signals.conflict),
  items: list(signals.items).map((row) => ({
    code: row?.code || '',
    severity: row?.severity === 'hard' ? 'hard' : 'soft',
    detail: row?.detail || '',
  })),
} : null;

/** `decidedAt` doubles as "has this been decided", which is why it is kept as a nullable timestamp rather than folded
 * into a boolean: the desk renders *when*, not *whether*. */
export function toCaseFile(res) {
  if (!res) return null;
  return {
    propertyId: res.propertyId ?? '',
    status: res.status ?? 'pending',
    /* Reviewer is a user id despite the contract name, so the UI resolves it against team data. */
    reviewer: res.reviewer ?? null,
    checklist: list(res.checklist).map(toChecklistItem),
    messages: list(res.messages).map(toMessage),
    notes: res.notes ?? null,
    reasonCode: res.reasonCode ?? null,
    reasonNote: res.reasonNote ?? null,
    overrideRequest: toOverrideRequest(res.overrideRequest),
    signals: toSignals(res.signals),
    decidedAt: res.decidedAt ?? null,
  };
}

/** The owner's own `/me/property-reviews` row: verdict, reason and unread count, nothing of the staff side. */
export function toReviewBadge(row) {
  return {
    propertyId: row?.propertyId ?? '',
    status: row?.status ?? 'pending',
    unread: Number(row?.unread) || 0,
    updatedAt: row?.updatedAt ?? null,
    reasonCode: row?.reasonCode ?? null,
    reasonNote: row?.reasonNote ?? null,
    lastMessage: row?.lastMessage ?? '',
  };
}
