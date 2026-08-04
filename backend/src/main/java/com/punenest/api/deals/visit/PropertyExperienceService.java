package com.punenest.api.deals.visit;

import com.punenest.api.common.trust.PropertyExperience;
import com.punenest.api.common.trust.ReviewerStanding;
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
 * <p>Two indexed existence checks, never a fetch: the caller is asking a yes/no question and has no
 * business reading a stranger's tenancy terms to get the answer.
 */
@Service
public class PropertyExperienceService implements PropertyExperience {

    private final VisitRepository visits;
    private final TenancyRepository tenancies;

    public PropertyExperienceService(VisitRepository visits, TenancyRepository tenancies) {
        this.visits = visits;
        this.tenancies = tenancies;
    }

    /**
     * {@inheritDoc}
     *
     * <p>Tenancy is checked first because it is the stronger claim and the two are not exclusive —
     * almost everyone who rented a flat also visited it first, so probing the visit first would
     * quietly downgrade every resident to a "Visited" badge.
     */
    @Override
    @Transactional(readOnly = true)
    public ReviewerStanding standingOf(UUID userId, UUID propertyId) {
        if (userId == null || propertyId == null) {
            return ReviewerStanding.NONE;
        }
        if (tenancies.existsByTenantIdAndPropertyId(userId, propertyId)) {
            return ReviewerStanding.TENANT;
        }
        if (visits.existsByVisitorIdAndPropertyIdAndStatus(userId, propertyId,
                VisitStatuses.COMPLETED)) {
            return ReviewerStanding.VISITED;
        }
        return ReviewerStanding.NONE;
    }
}
