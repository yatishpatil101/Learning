/**
 * Finance — the money: rent ledger and payments, mandates and payouts, tenancies and tenant
 * profiles, and the single payment webhook that settles every purchase across the platform.
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
