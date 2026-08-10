package com.punenest.api.finance.rent;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;

/**
 * Reads and writes {@link RentPayment}.
 *
 * <p>Every list query joins {@code Tenancy} rather than taking a tenancy id, because both read
 * surfaces are person-scoped: the tenant sees payments they made, the owner sees payments made to
 * them, and neither knows a tenancy id. Doing the join here keeps the reads to one statement each
 * — resolving tenancies first and then querying payments per tenancy is the classic N+1 in this
 * shape.
 */
public interface RentPaymentRepository extends JpaRepository<RentPayment, UUID> {

    /**
     * Payments the caller owes or has made, newest first. Joined through {@code Tenancy} on
     * {@code tenantId}; index-backed by {@code idx_tenancies_tenant_status} and
     * {@code idx_rent_payments_tenancy}.
     *
     * <p>Paged because a rent ledger grows on a schedule rather than by user action — a tenancy left
     * running for years accrues a row a month that nothing culls (api-standards.md §5.1).
     */
    @Query(value = "select p from RentPayment p, Tenancy t "
            + "where p.tenancyId = t.id and t.tenantId = :tenantId "
            + "order by p.dueDate desc, p.createdAt desc",
            countQuery = "select count(p) from RentPayment p, Tenancy t "
                    + "where p.tenancyId = t.id and t.tenantId = :tenantId")
    Page<RentPayment> findByTenantId(@Param("tenantId") UUID tenantId, Pageable pageable);

    /** Payments made against the caller's listings, newest first. The owner's ledger; paged as above. */
    @Query(value = "select p from RentPayment p, Tenancy t "
            + "where p.tenancyId = t.id and t.ownerId = :ownerId "
            + "order by p.dueDate desc, p.createdAt desc",
            countQuery = "select count(p) from RentPayment p, Tenancy t "
                    + "where p.tenancyId = t.id and t.ownerId = :ownerId")
    Page<RentPayment> findByOwnerId(@Param("ownerId") UUID ownerId, Pageable pageable);

    /** The webhook's dedupe lookup: the gateway order id is unique (V14). */
    Optional<RentPayment> findByReference(String reference);

    /**
     * Replays a client's {@code Idempotency-Key} <strong>within one tenancy</strong>. A repeated key
     * must return the original payment rather than create a second one — the client is retrying,
     * not paying again.
     *
     * <p>The tenancy id is not decoration. A lookup on the key alone would match whichever payment
     * carried it anywhere in the table, so a caller who guessed or intercepted another tenant's key
     * would be handed that tenant's payment record — amount, fees, order reference and all — from a
     * path that never checked whose it was. Binding the key to a tenancy the caller has already been
     * authorised for makes the scoping structural rather than something a later edit can drop.
     */
    Optional<RentPayment> findByTenancyIdAndIdempotencyKey(UUID tenancyId, String idempotencyKey);

    /**
     * Whether this month is already settled or in flight, mirroring V14's partial unique index.
     *
     * <p>The index is the real guard; this exists only so the common case answers a clean 422
     * instead of surfacing a constraint violation. The check alone would be racy — two concurrent
     * taps both pass it — which is exactly why the index is there too.
     */
    @Query("select count(p) > 0 from RentPayment p where p.tenancyId = :tenancyId "
            + "and p.dueDate = :dueDate and p.status in ('due', 'paid')")
    boolean existsLiveForDueDate(@Param("tenancyId") UUID tenancyId,
            @Param("dueDate") LocalDate dueDate);

    /**
     * Checkouts opened before {@code cutoff} and still unpaid — the sweep's input (D161).
     *
     * <p>{@code due} is the only status this may return, and that is what makes the sweep safe:
     * nothing but {@code payRent} creates a rent payment, and it creates one only when a tenant has
     * asked to pay. There is no scheduled biller producing {@code due} rows for months nobody has
     * started, so "still {@code due} 45 minutes after it was created" means an abandoned checkout
     * and never an unpaid month.
     *
     * <p>Ordered oldest-first and taken a {@code batch} at a time, for the reasons set out on
     * {@code SubscriptionRepository}'s equivalent.
     */
    List<RentPayment> findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(String status,
            Instant cutoff, Limit batch);
}
