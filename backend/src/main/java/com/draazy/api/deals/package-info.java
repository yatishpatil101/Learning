/**
 * Deals — the transaction: offers, visits, the deal lifecycle and finalization. Closing a deal is
 * what turns a listing and two parties into a tenancy.
 *
 * <p><strong>Boundary (rank 5, {@code ArchitectureBoundaryTest} LAYER).</strong> The highest
 * transaction context: it may read everything below — {@code finance} (4, {@code DealService.close}
 * opens a tenancy via {@code TenancyService}), {@code services} (3), the rank-2 join contexts,
 * {@code catalog} (1) and {@code identity} (0) — plus the shared kernel. It may not import
 * {@code moderation} (6) or {@code admin} (7). Cross-context <em>writes</em> stay behind the owning
 * service; deals reads other contexts' repositories only for downward, read-only lookups.
 */
package com.draazy.api.deals;
