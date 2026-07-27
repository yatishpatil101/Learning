/* A featured listing's boost is honoured only while active. Owner/admin-set featuring
   has no expiry (permanent until toggled off); the free "first verified listing" perk
   (ADR-019 growth lever) carries a `featuredUntil` timestamp so it lapses on its own. */
export const isFeaturedActive = (l) =>
  !!(l && l.featured && (!l.featuredUntil || l.featuredUntil > Date.now()));
