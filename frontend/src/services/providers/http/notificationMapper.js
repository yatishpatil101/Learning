
// The server's dotted types are translated here rather than left to the page's `ICONS.system` fallback,
// which would silently grey them out and drop them from the filter chips.
const TYPE_PREFIXES = [
  /** A saved-search alert is the server's counterpart to the inbox's "New Matches" chip, and it is spelled two
   * different ways by two writers that both reach a real inbox. */
  ['match.saved-search', 'match'],
  ['saved.search', 'match'],
  // Someone wants to team up as a flatmate — the "users" family.
  ['flatmate.interest', 'share'],
  ['flatmate.request', 'share'],
  // A moderation outcome on the user's own post is a platform decision, not a lead.
  ['flatmate.review', 'system'],
  ['flatmate.moderated', 'system'],
  // A joint agreement being reissued is paperwork the services team drives.
  ['flatmate.agreement', 'service'],
  // Catch-all for future flatmate types; more specific rules above win.
  ['flatmate', 'share'],
  // The owner answered a contact request the user made — an outcome on their own enquiry.
  ['contact', 'enquiry'],
  /** Not `document` — that member means paperwork access, and photos are neither. This mapping is load-bearing rather
   * than cosmetic. */
  ['photo', 'enquiry'],
  // A moderation verdict on the user's own listing is a platform decision, not a lead — same
  // reasoning as flatmate.review above.
  ['listing', 'system'],
  /* Dotted visit types need an explicit identity mapping; bare passthrough would miss them. */
  ['visit', 'visit'],
  // An offer arrived. `price` is the UI's name for the money family; there is no `offer` chip.
  ['offer', 'price'],
  // Document-access grants use identity mapping for the same dotted-type reason as `visit`.
  ['document', 'document'],
  /** Messages are enquiries from the recipient's point of view, not grey system events. */
  ['message', 'enquiry'],
  /** Load-bearing rather than cosmetic: this notification is the *only* thing that tells a customer a draft is
   * waiting on their decision, and the request cannot progress until they act on it. */
  ['service', 'service'],
];

/** UI types that already mean what they say — passed through untouched. */
const PASSTHROUGH = new Set([
  'match', 'enquiry', 'price', 'visit', 'share', 'document', 'service', 'system',
]);

const warned = new Set();

/** An unrecognised type falls back to `system` **and warns once**, because the alternative is the failure mode this
 * whole map exists to prevent. */
export function toUiType(wireType) {
  if (!wireType) return 'system';
  if (PASSTHROUGH.has(wireType)) return wireType;
  const hit = TYPE_PREFIXES.find(([prefix]) => wireType === prefix || wireType.startsWith(`${prefix}.`));
  if (hit) return hit[1];
  if (!warned.has(wireType)) {
    warned.add(wireType);
    console.warn(
      `[notification] Unknown server type "${wireType}" — rendering as "system". It will not match ` +
        'the Updates filter. Add it to TYPE_PREFIXES in providers/http/notificationMapper.js.',
    );
  }
  return 'system';
}

/** `createdAt` becomes epoch ms because the page sorts and formats relative times from a number. */
export function toViewModel(n) {
  if (!n) return null;
  return {
    id: n.id,
    type: toUiType(n.type),
    // Kept so a caller can see what the server actually said — the translation above is lossy, and
    // an ops screen debugging "why is this grey" needs the original. Nothing renders it.
    wireType: n.type,
    title: n.title ?? '',
    desc: n.body ?? '',
    read: Boolean(n.read),
    link: n.link ?? undefined,
    at: n.createdAt ? Date.parse(n.createdAt) : Date.now(),
  };
}

/** Wire page (or bare array) → a plain array. */
export const toViewModelList = (payload) =>
  (Array.isArray(payload) ? payload : payload?.content ?? []).map(toViewModel).filter(Boolean);
