/**
 * Finance — the money: the owner's income and expense ledger, plus tenancies and tenant profiles.
 *
 * <p>Online rent collection is not here and is not implemented anywhere: the platform never
 * settles a tenant's rent, and {@code /pay-rent} on the web app is a coming-soon page with no
 * server behind it. The gateway callback that settles the purchases the platform <em>does</em>
 * take money for lives in {@code common.payments}, because subscriptions, boosts and paid service
 * requests all share it and none of them is a finance concern.
 *
 * <p><strong>Boundary (rank 4, {@code ArchitectureBoundaryTest} LAYER).</strong> May import
 * everything below it — {@code services} (3), the rank-2 join contexts ({@code billing},
 * {@code documents}, {@code leads}, {@code engagement}), {@code catalog} (1) and {@code identity}
 * (0) — plus the shared kernel; it may not import {@code deals} (5), {@code moderation} or
 * {@code admin}. It deliberately sits <em>below</em> {@code deals}: {@code DealService.close} opens
 * a tenancy through {@code TenancyService}, so the one edge is {@code deals -> finance}, which keeps
 * the ledger extractable and stops a reverse import.
 */
package com.punenest.api.finance;
