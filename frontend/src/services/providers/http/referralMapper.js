/**
 * Wire `Referral` → the fraud desk's view model. Risk (`low|medium|high`) is a separate field from
 * status, and `clawed-back` is distinct from `rejected` because it means money left the building.
 */

/** Wire timestamps are ISO; the desk formats dates and sorts on epoch millis. */
const epoch = (iso) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * `ReferralDto` → one desk row. `rewardAmount` rides alongside the server-composed `reward` label
 * because CSV totals need the number; it counts owner contacts, so never format it as currency.
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
    identityVerified: !!dto.identityVerified,
    identityUnique: !!dto.identityUnique,
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
