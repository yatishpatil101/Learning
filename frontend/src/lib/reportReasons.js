/* **The codes deliberately collide, and the labels deliberately do not**: `spam`, `fake`, `broker`
   and `unavailable` appear in more than one list under different wording, so anything resolving a
   label from the code alone is wrong — `reportMapper` indexes these by target type instead.

   Split per target because `ReportReasons.java` validates the reason against the target type and
   400s a mismatch. Mirrored by that file; `npm run check:enums` diffs the two set-by-set. */

/** Reporting a property listing. Wire `targetType = 'property'`. */
export const LISTING_REPORT_REASONS = [
  ['sold', 'Already sold or rented out'],
  ['fake', 'Fake photos or misleading info'],
  ['unavailable', 'Owner not responding / unreachable'],
  ['pricing', 'Overpriced / incorrect price'],
  ['spam', 'Spam or duplicate listing'],
  ['broker', 'Posted by a broker / not the owner'],
  ['other', 'Something else'],
];

/** Reporting a flatmate seeker / room / group post. Wire `targetType = 'post'`, client `kind = 'share'`. */
export const SHARE_REPORT_REASONS = [
  ['fake', 'Fake or misleading profile'],
  ['unavailable', 'Not responding / unreachable'],
  ['filled', 'Already filled / no longer available'],
  ['broker', 'Broker or agent, not a genuine seeker'],
  ['inappropriate', 'Inappropriate or offensive content'],
  ['spam', 'Spam or duplicate post'],
  ['other', 'Something else'],
];

/** Reporting a person — an owner profile, or the other side of a chat. Wire `targetType = 'user'`. */
export const OWNER_REPORT_REASONS = [
  ['impersonation', 'Fake or impersonated profile'],
  ['fraud', 'Suspected fraud or scam'],
  ['brokerage', 'Asked for brokerage / advance payment'],
  ['abuse', 'Abusive or harassing behaviour'],
  ['spam', 'Spam or irrelevant messages'],
  ['fakelistings', 'Listings are fake or unavailable'],
  ['other', 'Something else'],
];

/* Society-hub content. Wire `targetType` is one of the five `society_*` kinds; client `kind` is the
   bare word (`contribution`, `reply`, `question`, `answer`, `board`).

   ONE list for five kinds, unlike the three above: these are the same object seen through five
   widgets, and the kinds stay separate on the wire only so a moderator knows which table the id
   indexes. A society **review** is deliberately not here — it is taken down by its own endpoint. */
export const SOCIETY_REPORT_REASONS = [
  ['abuse', 'Abusive, offensive or harassing'],
  ['spam', 'Spam, advertising or a duplicate post'],
  ['fake', 'False or misleading information'],
  ['personal', "Publishes someone's personal details"],
  ['other', 'Something else'],
];
