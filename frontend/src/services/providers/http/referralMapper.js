/**
 * Wire `Referral` → the fraud desk's view model.
 *
 * Thinner than `ticketMapper` on purpose: the desk's columns and the DTO's fields already agree,
 * because both were written from the same fraud-review job. What this file does is fix the three
 * places where the mock's shape was not merely different but wrong.
 *
 * ## `flagged` is not a status
 *
 * The mock had `pending | flagged | qualified | rewarded | rejected`. The server has
 * `pending | qualified | rewarded | rejected | clawed-back`. **Risk is a separate field** — `low`,
 * `medium`, `high` — computed server-side from the signals, and that is what "flagged" was
 * gesturing at. Folding risk back into status would lose the ability to say the true and common
 * thing: *pending, and high risk*. So the board filters on `risk` where it used to filter on a
 * status that will never arrive.
 *
 * ## `clawed-back` is not `rejected`
 *
 * The mock wrote `rejected` for both. Spec fix S52 separated them deliberately, because the one
 * question a fraud desk asks about a reversed referral is whether money left the building.
 *
 * ## The signals are findings, not measurements
 *
 * `sameDevice` and `sameIp` are false when *either* side has no digest — a code minted before V64,
 * or a request that carried no `User-Agent`. False therefore means "no evidence", never "proved
 * different", and the desk's chips are rendered from that reading. `aadhaarUnique` is derived from
 * `aadhaarVerified` server-side (a second account cannot verify an identity hash the platform
 * already holds), so the two chips move together by construction rather than by coincidence.
 */

/** Wire timestamps are ISO; the desk formats dates and sorts on epoch millis. */
const epoch = (iso) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * `ReferralDto` → one desk row.
 *
 * `rewardAmount` is carried alongside `reward` because the label is prose the server composed
 * ("₹500 PuneNest credit") and the number is what a CSV column and a total need. The mock had only
 * the label, so its export could not be summed.
 */
export function toViewModel(dto) {
  if (!dto) return null;
  return {
    id: dto.id,
    referrer: dto.referrer || '',
    referrerMobile: dto.referrerMobile || '',
    referred: dto.referred || '',
    referredMobile: dto.referredMobile || '',
    channel: dto.channel || null,
    shareChannel: dto.shareChannel || null,
    reward: dto.reward || '',
    rewardAmount: dto.rewardAmount ?? 0,
    status: dto.status || 'pending',
    risk: dto.risk || 'low',
    aadhaarVerified: !!dto.aadhaarVerified,
    aadhaarUnique: !!dto.aadhaarUnique,
    sameDevice: !!dto.sameDevice,
    sameIp: !!dto.sameIp,
    velocityHigh: !!dto.velocityHigh,
    activated: !!dto.activated,
    at: epoch(dto.at),
    qualifiedAt: epoch(dto.qualifiedAt),
    handledBy: dto.handledBy || null,
    handledAt: epoch(dto.handledAt),
  };
}

/** The single row a decision returns, so the desk can replace it in place rather than refetch. */
export const toDecision = (dto) => toViewModel(dto);

/**
 * The `PageResponse` envelope → `{ items, total, page, size }`.
 *
 * `total` is the envelope's, not `items.length` — the stat tiles must be true on page 1 of 3.
 */
export function toViewModelPage(res, fallback = {}) {
  const rows = Array.isArray(res?.content) ? res.content : [];
  return {
    items: rows.map(toViewModel).filter(Boolean),
    total: res?.totalElements ?? rows.length,
    page: res?.page ?? fallback.page ?? 0,
    size: res?.size ?? fallback.size ?? rows.length,
  };
}
