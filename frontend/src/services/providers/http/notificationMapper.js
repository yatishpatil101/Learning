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
  // A saved-search alert is the server's counterpart to the inbox's "New Matches" chip, and it is
  // spelled two different ways by two writers that both reach a real inbox:
  //   - `SavedSearchService.alert()` emits `match.saved-search` — the only spelling production ever
  //     produces, and until this entry existed it fell through to the grey `system` glyph and
  //     matched no filter chip at all. That is the exact failure this whole map exists to prevent,
  //     landing on the one notification the alerts product is built to deliver.
  //   - `R__zz_dev_demo_data.sql` seeds `saved.search.match` on the demo buyer. The seed's
  //     vocabulary disagrees with the emitter's; both are mapped rather than one being "fixed",
  //     because a mapper that only understood the seed would be green in e2e and wrong in
  //     production, which is the direction that ships.
  ['match.saved-search', 'match'],
  ['saved.search', 'match'],
  // Someone wants to team up as a flatmate — the "users" family, same as the mock's flatmate seed.
  ['flatmate.interest', 'share'],
  ['flatmate.request', 'share'],
  // A moderation outcome on the user's own post is a platform decision, not a lead.
  ['flatmate.review', 'system'],
  // A joint agreement being reissued is paperwork the services team drives.
  ['flatmate.agreement', 'service'],
  // Catch-all for flatmate types added later; more specific rules above win.
  ['flatmate', 'share'],
  // The owner answered a contact request the user made — an outcome on their own enquiry.
  ['contact', 'enquiry'],
  // The owner answered a *photo* request the user made (`photo.added`, `photo.declined`). Same
  // reasoning as `contact` above, and the same chip: both are the outcome of an ask this reader
  // made, which is what they will filter on when looking for it. Not `document` — that member means
  // paperwork access, and photos are neither. This mapping is load-bearing rather than cosmetic:
  // the notification is the buyer's only signal that the request was answered at all, so leaving it
  // to fall through would hide the one message the feature exists to send.
  ['photo', 'enquiry'],
  // A moderation verdict on the user's own listing is a platform decision, not a lead — same
  // reasoning as flatmate.review above.
  ['listing', 'system'],
  // A visit was confirmed or moved. The UI vocabulary has a `visit` member that means exactly this,
  // so the mapping is an identity — but it still has to be *stated*, because `PASSTHROUGH` matches
  // the bare word only and every server type here is dotted (`visit.confirmed`, `visit.rescheduled`).
  ['visit', 'visit'],
  // An offer arrived. `price` is the UI's name for the money family; there is no `offer` chip.
  ['offer', 'price'],
  // Access to a document was granted. Identity mapping, stated for the same dotted-type reason as
  // `visit` above.
  ['document', 'document'],
  // A message landed in a conversation. `message.received` predates the rest of this list and has
  // been falling through to the grey `system` row since the notification page shipped — it is an
  // enquiry thread from the reader's point of view, which is the chip they would reach for.
  ['message', 'enquiry'],
  // Our services team shared a draft for the customer to approve (`service.draft-shared`). Identity
  // mapping onto the UI's own `service` member, stated for the same dotted-type reason as `visit`
  // and `document` above — `PASSTHROUGH` matches the bare word only, and no server type is bare.
  // Load-bearing rather than cosmetic: this notification is the *only* thing that tells a customer
  // a draft is waiting on their decision, and the request cannot progress until they act on it.
  ['service', 'service'],
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
