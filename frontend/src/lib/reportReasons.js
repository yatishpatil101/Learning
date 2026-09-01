/**
 * The three report reason vocabularies, and nothing else.
 *
 * **Why these are not in `ReportModal.jsx` any more.** They were, and four consumer pages imported
 * them from there, which made a component file the de facto home of a piece of domain data. That
 * was survivable while only modals read it. It stopped being survivable when two *non-modal*
 * readers appeared: the ops queue (`AdminReports.jsx`), which filters by reason, and the http
 * mapper (`providers/http/reportMapper.js`), which turns a wire `reason` code into the words a
 * moderator reads. A mapper in the services layer importing from `components/` inverts the
 * layering, and the alternative — a mapper keeping its own copy of the labels — is what produced
 * the drift this module exists to end. So the data moved to the layer everything can see, and the
 * modal became one more reader of it.
 *
 * **Why a reason is a `[code, label]` pair and not an object.** The pair is the shape a `<select>`
 * wants and the shape the backend mirror lists, so the two can be diffed by eye. `Object.fromEntries`
 * turns any of these into a lookup where one is wanted.
 *
 * **Why three lists and not one.** The reason vocabulary is a function of *what was reported*, and
 * the server enforces exactly that: `ReportReasons.java` validates the reason against the target
 * type and rejects a mismatch with a 400. `pricing` is a real complaint about a listing and a
 * meaningless one about a person; `impersonation` the reverse. A single flattened list would offer,
 * as a filter and as a form option, pairings the API refuses to store.
 *
 * **The codes deliberately collide, and the labels deliberately do not.** `spam`, `fake`, `broker`
 * and `unavailable` appear in more than one list under *different wording*, because they describe
 * different things: `spam` on a listing is a duplicate listing, on a flatmate post a duplicate post,
 * and from an owner a stream of irrelevant messages. Anything resolving a label from the code alone
 * will get one of the three and be wrong about the other two — which is why `reportMapper` indexes
 * these by target type rather than flattening them.
 *
 * Mirrored by `backend/.../moderation/report/ReportReasons.java`. The two are checked against each
 * other by `frontend/scripts/report-parity.mjs`; if you add a code here, add it there.
 */

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
