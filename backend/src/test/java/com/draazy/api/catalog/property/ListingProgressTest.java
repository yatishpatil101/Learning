package com.draazy.api.catalog.property;

import com.draazy.api.identity.user.User;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ListingProgressTest {
    private Property property;

    @BeforeEach void setup() {
        User owner = mock(User.class);
        when(owner.getId()).thenReturn(UUID.randomUUID());
        property = new Property(owner, "Home", "rent", "Flat", 20000L, "Baner", "Pune");
        property.setImages(List.of("/media/a.jpg"));
    }

    private ListingProgress staffView() {
        return ListingProgress.of(property, true);
    }

    @Test void ownerTrackWalksSubmittedInReviewLive() {
        assertThat(staffView()).isEqualTo(new ListingProgress("owner", "submitted", List.of()));
        property.startReview();
        assertThat(staffView().step()).isEqualTo("in_review");
        property.setStatus(PropertyStatus.APPROVED);
        assertThat(staffView().step()).isEqualTo("live");
    }

    @Test void staffTrackWalksAllFiveStepsInOrder() {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        assertThat(staffView().track()).isEqualTo("staff");
        assertThat(staffView().step()).isEqualTo("created");
        property.recordClaimLinkSent();
        assertThat(staffView().step()).isEqualTo("link_sent");
        property.recordClaimLinkOpened();
        assertThat(staffView().step()).isEqualTo("link_sent");
        assertThat(staffView().flags()).containsExactly("opened");
        property.confirmByOwner();
        assertThat(staffView().step()).isEqualTo("owner_confirmed");
        assertThat(staffView().flags()).isEmpty();
        property.startReview();
        assertThat(staffView().step()).isEqualTo("in_review");
        property.setStatus(PropertyStatus.APPROVED);
        assertThat(staffView().step()).isEqualTo("live");
    }

    @Test void reviewBeforeOwnerConfirmsDoesNotSkipTheConfirmStep() {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        property.recordClaimLinkSent();
        property.startReview();
        assertThat(staffView().step()).isEqualTo("link_sent");
    }

    @Test void ownerOnlyFactsAreIgnoredOnTheOwnerTrack() {
        property.recordClaimLinkSent();
        property.confirmByOwner();
        assertThat(property.getClaimLinkSentAt()).isNull();
        assertThat(property.getOwnerConfirmedAt()).isNull();
        assertThat(staffView().step()).isEqualTo("submitted");
    }

    @Test void needsInfoIsAFlagOnInReviewAndClearsOnReply() {
        property.requestInfo();
        assertThat(staffView().step()).isEqualTo("in_review");
        assertThat(staffView().flags()).containsExactly("needs_info");
        property.provideInfo();
        assertThat(staffView().step()).isEqualTo("in_review");
        assertThat(staffView().flags()).isEmpty();
    }

    @Test void rejectedAndFlaggedSitOnInReview() {
        property.setStatus(PropertyStatus.REJECTED);
        assertThat(staffView()).isEqualTo(new ListingProgress("owner", "in_review", List.of("rejected")));
        property.setStatus(PropertyStatus.FLAGGED);
        assertThat(staffView()).isEqualTo(new ListingProgress("owner", "in_review", List.of("flagged")));
    }

    @Test void ownerSeesOnlyNeedsInfoAndRejected() {
        property.setStatus(PropertyStatus.FLAGGED);
        property.setImages(List.of());
        assertThat(staffView().flags()).containsExactlyInAnyOrder("flagged", "no_photos");
        assertThat(ListingProgress.of(property, false).flags()).isEmpty();
        property.setStatus(PropertyStatus.REJECTED);
        assertThat(ListingProgress.of(property, false).flags()).containsExactly("rejected");
    }

    @Test void noPhotosFlagsOnlyUnpublishedListings() {
        property.setImages(List.of());
        assertThat(staffView().flags()).containsExactly("no_photos");
        property.setStatus(PropertyStatus.APPROVED);
        assertThat(staffView().flags()).isEmpty();
    }

    @Test void listingsOutsideTheFunnelHaveNoProgress() {
        for (String status : List.of(PropertyStatus.PAUSED, PropertyStatus.SOLD, PropertyStatus.RENTED)) {
            property.setStatus(status);
            assertThat(staffView()).as(status).isNull();
        }
        property.setStatus(PropertyStatus.PENDING);
        property.archive("Removed");
        assertThat(staffView()).isNull();
    }

    @Test void reentryClearsReviewAndInfoButKeepsOwnerConfirmation() {
        property.markPostedOnBehalf(UUID.randomUUID().toString());
        property.confirmByOwner();
        property.requestInfo();
        property.setStatus(PropertyStatus.APPROVED);
        property.revertToPending();
        assertThat(property.getReviewStartedAt()).isNull();
        assertThat(property.isAwaitingOwnerInfo()).isFalse();
        assertThat(staffView().step()).isEqualTo("owner_confirmed");
    }
}
