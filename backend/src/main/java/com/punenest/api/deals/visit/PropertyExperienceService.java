package com.punenest.api.deals.visit;

import com.punenest.api.common.trust.PropertyExperience;
import com.punenest.api.common.trust.ReviewerStanding;
import com.punenest.api.finance.tenancy.TenancyDeclarationRepository;
import com.punenest.api.finance.tenancy.TenancyRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@link PropertyExperience} adapter — the only place that knows what counts as having
 * experienced a listing.
 *
 * <p><strong>Why it lives in {@code deals}.</strong> The answer needs both halves of the evidence,
 * and they sit in different contexts: visits here, tenancies in {@code finance}. {@code deals} ranks
 * above {@code finance} in the layering, so this is the one context that can legitimately see both.
 * Putting the adapter in {@code finance} instead would force {@code finance} to reach up into
 * {@code deals} for visits — a cycle.
 *
 * <p>Indexed existence checks, never a fetch: the caller is asking a yes/no question and has no
 * business reading a stranger's tenancy terms to get the answer.
 */
@Service
public class PropertyExperienceService implements PropertyExperience {

    private final VisitRepository visits;
    private final TenancyRepository tenancies;
    private final TenancyDeclarationRepository declarations;

    public PropertyExperienceService(VisitRepository visits, TenancyRepository tenancies,
            TenancyDeclarationRepository declarations) {
        this.visits = visits;
        this.tenancies = tenancies;
        this.declarations = declarations;
    }

    /**
     * {@inheritDoc}
     *
     * <p>Tenancy is checked first because it is the stronger claim and the two are not exclusive —
     * almost everyone who rented a flat also visited it first, so probing the visit first would
     * quietly downgrade every resident to a "Visited" badge.
     *
     * <p><strong>Two sources of tenancy, one standing</strong> (D194). A brokered agreement and an
     * owner-confirmed self-declaration are stored apart — they have different provenance and only
     * the first can carry money — but both answer this question the same way, and so both return
     * {@link ReviewerStanding#TENANT}. Splitting them into two badges was considered and rejected:
     * once the landlord has agreed the stay happened, it is no longer a self-claim, and a reader has
     * nothing to do with the difference between "the platform brokered your lease" and "your
     * landlord confirmed you lived here" except be confused by it. The distinction that does matter
     * — a declaration can be revoked, an agreement cannot — is expressed by the row's status, which
     * is where the check below reads it from.
     *
     * <p>The declaration probe runs second because a tenant with a real agreement has no reason to
     * have declared one, so the brokered check answers first on the path that matters. Both are
     * single indexed existence probes; the ordering buys a skipped query on the common case, not a
     * cheaper one.
     */
    @Override
    @Transactional(readOnly = true)
    public ReviewerStanding standingOf(UUID userId, UUID propertyId) {
        if (userId == null || propertyId == null) {
            return ReviewerStanding.NONE;
        }
        if (tenancies.existsByTenantIdAndPropertyId(userId, propertyId)
                || declarations.existsConfirmedFor(userId, propertyId)) {
            return ReviewerStanding.TENANT;
        }
        if (visits.existsByVisitorIdAndPropertyIdAndStatus(userId, propertyId,
                VisitStatuses.COMPLETED)) {
            return ReviewerStanding.VISITED;
        }
        return ReviewerStanding.NONE;
    }
}
