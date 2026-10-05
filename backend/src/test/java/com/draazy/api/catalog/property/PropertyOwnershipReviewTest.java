package com.draazy.api.catalog.property;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.draazy.api.identity.user.User;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PropertyOwnershipReviewTest {
    private Property property;
    private final Instant now = Instant.now();

    @BeforeEach void setup() {
        property = new Property(mock(User.class), "Home", "rent", "Flat", 20000L, "Baner", "Pune");
        property.setStatus(PropertyStatus.APPROVED);
    }

    @Test void aRequestOnALiveListingQueuesAStaysLiveRecheck() {
        property.requestOwnershipReview(now);
        assertThat(property.getOwnershipRequestedAt()).isEqualTo(now);
        assertThat(property.getRecheckReason()).isEqualTo(Property.OWNERSHIP_REVIEW_ITEM);
        assertThat(property.getStatus()).isEqualTo(PropertyStatus.APPROVED);
    }

    @Test void aPendingListingKeepsTheRequestWithoutARecheck() {
        property.setStatus(PropertyStatus.PENDING);
        property.requestOwnershipReview(now);
        assertThat(property.isOwnershipRequested()).isTrue();
        assertThat(property.isRecheckPending()).isFalse();
    }

    @Test void grantingTheBadgeClosesTheRequestAndOnlyTheBadgeItem() {
        property.requestRecheck(List.of("Price"));
        property.requestOwnershipReview(now);
        property.verifyOwnership(now, null);
        assertThat(property.isOwnershipRequested()).isFalse();
        assertThat(property.getRecheckReason()).isEqualTo("Price");
    }

    @Test void aDeclineClosesTheRequestAndRecordsWhy() {
        property.requestOwnershipReview(now);
        property.declineOwnershipReview("Blurry scan", now);
        assertThat(property.isOwnershipRequested()).isFalse();
        assertThat(property.getOwnershipDeclinedReason()).isEqualTo("Blurry scan");
        assertThat(property.isRecheckPending()).isFalse();
    }

    @Test void lookingFineOnOtherEditsKeepsTheOpenBadgeRequestQueued() {
        property.requestRecheck(List.of("Price"));
        property.requestOwnershipReview(now);
        property.clearRecheck();
        assertThat(property.getRecheckReason()).isEqualTo(Property.OWNERSHIP_REVIEW_ITEM);
    }

    @Test void goingBackToPendingDropsTheRecheckButNotTheRequest() {
        property.requestOwnershipReview(now);
        property.revertToPending();
        assertThat(property.isRecheckPending()).isFalse();
        assertThat(property.isOwnershipRequested()).isTrue();
    }

    @Test void anEditAfterABadgeOnlyRequestStartsTheRecheckClockAtTheEdit() {
        Instant asked = now.minusSeconds(20 * 86_400);
        property.requestOwnershipReview(asked);
        property.clearRecheck();
        property.requestRecheck(List.of("Price"));
        assertThat(property.getRecheckRequestedAt()).isAfter(asked);
        assertThat(property.getOwnershipRequestedAt()).isEqualTo(asked);
    }
}
