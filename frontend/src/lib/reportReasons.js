/* Codes collide across lists with different labels, so resolve labels by target type; mirrored by
   ReportReasons.java, which `npm run check:enums` diffs. */

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

/** Reporting a review. Wire `targetType = 'review'`; the reasons are `ReportReasons.FOR_REVIEW`. */
export const REVIEW_REPORT_REASONS = [
  ['fake', 'Fake or dishonest review'],
  ['abuse', 'Abusive or offensive review'],
  ['other', 'Something else'],
];
