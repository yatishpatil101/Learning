package com.punenest.api.finance.tenancy;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code tenancy_declarations} (V68).
 *
 * <p>Four reads and no more: the eligibility probe, the owner's inbox for one listing, the
 * claimant's own row, and whether they have already used their one slot. There is no query that
 * wants declarations across listings — an owner acts on them from the listing page, where the claim
 * is about something they can actually recognise.
 */
public interface TenancyDeclarationRepository extends JpaRepository<TenancyDeclaration, UUID> {

    /**
     * Has this listing's owner agreed that this person lived there? Backs the second half of the
     * review-eligibility port ({@code common.trust.PropertyExperience}).
     *
     * <p>An existence check rather than a fetch, matching {@code TenancyRepository}: the caller is
     * asking a yes/no question and has no business reading the claim's contents to get the answer.
     *
     * <p>Filtered to {@code confirmed} — which is the whole point of the status. A pending claim is
     * a person asserting something unopposed, and a revoked one is a claim the owner has taken back;
     * neither may open the review door.
     */
    @Query("select count(d) > 0 from TenancyDeclaration d where d.declarantId = :declarantId "
            + "and d.propertyId = :propertyId and d.status = 'confirmed'")
    boolean existsConfirmedFor(@Param("declarantId") UUID declarantId,
            @Param("propertyId") UUID propertyId);

    /**
     * One page of the declarations on a listing, newest first — the owner's inbox for that flat.
     *
     * <p>Paged rather than returned whole because the rows are written by <em>other</em> people
     * against the caller (api-standards §5.1, "inbound demand"). One claim per person is a
     * constraint on each claimant, not on the list: the size grows with how many strangers assert a
     * stay, and the owner of a popular listing is exactly who an unpaged read would punish.
     */
    Page<TenancyDeclaration> findByPropertyIdOrderByCreatedAtDesc(UUID propertyId, Pageable pageable);

    /** Has this person already claimed this listing? A yes/no question, so it fetches no claim. */
    boolean existsByPropertyIdAndDeclarantId(UUID propertyId, UUID declarantId);

    /**
     * This person's own claim on this listing, if they have made one. At most one exists — the
     * unique constraint is what lets the claimant's side of the inbox be a single-row read rather
     * than a filtered page of everybody else's claims.
     */
    Optional<TenancyDeclaration> findByPropertyIdAndDeclarantId(UUID propertyId, UUID declarantId);
}
