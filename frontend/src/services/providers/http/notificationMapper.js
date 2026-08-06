/**
 * Wire ↔ view-model translation for notifications.
 *
 * Kept separate from the provider so the mapping is reviewable and testable on its own — the same
 * split `propertyMapper.js` uses, and for the same reason: a hand-written mapping is exactly the
 * thing that should not be trusted on assertion alone.
 */

/**
 * Server notification type → the UI's icon/filter vocabulary.
 *
 * **The two vocabularies do not overlap at all.** The server emits dotted namespaces
 * (`flatmate.interest`, `flatmate.review.approved`, `flatmate.request.accepted`,
 * `flatmate.agreement.reissue`); the page's `ICONS` and `FILTERS` maps use a flat set
 * (`match | enquiry | price | visit | share | document | service | system`). Not one server value is
 * a member of the UI set.
 *
 * That mismatch degrades *silently* in two ways, which is why it is translated here rather than
 * left to the page's `ICONS[n.type] || ICONS.system` fallback:
 *
 * 1. Every server notification would render as the grey "system" info glyph — merely ugly.
 * 2. **The filter chips would match nothing.** Selecting "Matches", "Enquiries", "Price" or any
 *    other chip would empty the page, because no server row carries those types. A user whose inbox
 *    is entirely server-fed would conclude the filters are broken, not that they are empty.
 *
 * Matching is longest-prefix, so `flatmate.review.approved` can be routed differently from
 * `flatmate.interest` without listing every leaf.
 */
const TYPE_PREFIXES = [
  // Someone wants to team up / share a flat — the "users" family, same as the mock's flatmate seed.
  ['flatmate.interest', 'share'],
  ['flatmate.request', 'share'],
  // A moderation outcome on the user's own post is a platform decision, not a lead.
  ['flatmate.review', 'system'],
  // A joint agreement being reissued is paperwork the services team drives.
  ['flatmate.agreement', 'service'],
  // Catch-all for flatmate types added later; more specific rules above win.
  ['flatmate', 'share'],
];

/** UI types that already mean what they say — passed through untouched. */
const PASSTHROUGH = new Set([
  'match', 'enquiry', 'price', 'visit', 'share', 'document', 'service', 'system',
]);

const warned = new Set();

/**
 * Translate a wire type into the UI vocabulary.
 *
 * An unrecognised type falls back to `system` **and warns once**, because the alternative is the
 * failure mode this whole map exists to prevent: the next type the backend invents would render as
 * an anonymous grey row and vanish from every filter, with nothing anywhere to say so. Warning once
 * per distinct type keeps a full inbox from flooding the console.
 */
export function toUiType(wireType) {
  if (!wireType) return 'system';
  if (PASSTHROUGH.has(wireType)) return wireType;
  const hit = TYPE_PREFIXES.find(([prefix]) => wireType === prefix || wireType.startsWith(`${prefix}.`));
  if (hit) return hit[1];
  if (!warned.has(wireType)) {
    warned.add(wireType);
    console.warn(
      `[notification] Unknown server type "${wireType}" — rendering as "system". It will not match ` +
        'any filter chip. Add it to TYPE_PREFIXES in providers/http/notificationMapper.js.',
    );
  }
  return 'system';
}

/**
 * Wire `Notification` → the view model the page renders.
 *
 * Two renames and a type translation:
 * - `body` → `desc` (the page reads `n.desc`)
 * - `createdAt` (ISO instant) → `at` (epoch ms — the page sorts, groups by Today/Earlier and
 *   formats relative times from a number, so an ISO string would sort lexicographically and
 *   `Date.now() - at` would be `NaN`)
 * - `type` → the UI vocabulary, above
 */
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

/** Wire page (or bare array) → the plain array the mock returns. */
export const toViewModelList = (payload) =>
  (Array.isArray(payload) ? payload : payload?.content ?? []).map(toViewModel).filter(Boolean);
