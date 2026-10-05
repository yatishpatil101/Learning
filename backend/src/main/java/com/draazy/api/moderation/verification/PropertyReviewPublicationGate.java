package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPublicationGate;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.moderation.signal.ListingSignalService;
import com.draazy.api.security.AuthPrincipal;
import org.springframework.stereotype.Component;

@Component
public class PropertyReviewPublicationGate implements PropertyPublicationGate {

    private final PropertyReviewRepository reviews;
    private final ListingSignalService signals;

    public PropertyReviewPublicationGate(PropertyReviewRepository reviews, ListingSignalService signals) {
        this.reviews = reviews;
        this.signals = signals;
    }

    @Override
    public void requirePublishable(AuthPrincipal actor, Property property, boolean secondApprovalSatisfied) {
        PropertyReview review = reviews.findByPropertyId(property.getId())
                .orElseThrow(() -> new ConflictException("checklist_incomplete",
                        "Open the review and tick every check first"));
        ApprovalGate.require(review);
        if (!secondApprovalSatisfied && signals.hasHardSignal(property.getId())) {
            throw new ConflictException("second_approver_required",
                    "A hard broker signal requires a second staff approver.");
        }
    }
}
