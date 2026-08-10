/**
 * Billing &amp; Growth — plans and subscriptions, listing boosts, the paid-services marketplace and
 * referrals: what a user buys, as distinct from the money movement itself.
 *
 * <p><strong>Boundary (rank 2, {@code ArchitectureBoundaryTest} LAYER).</strong> Reads
 * {@code catalog} (1, a boost is bought for a property) and {@code identity} (0, a subscriber or
 * referrer) downward, plus the shared kernel; it may not import its rank-2 peers {@code documents},
 * {@code leads} and {@code engagement}, nor anything above. It sits <em>strictly below</em>
 * {@code finance} (4) on purpose: the payment webhook {@code finance} owns is what activates a paid
 * subscription or boost, so the only edge is {@code finance -> billing}. Ranking billing higher
 * would make that legitimate call a violation.
 */
package com.punenest.api.billing;
