package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.RegisteredTenancyLookup;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class FlatmateTrustReconcilerTest {

    @Mock
    private FlatmateReviewRepository reviews;

    @Mock
    private FlatmateRoomRepository rooms;

    @Mock
    private FlatmateGroupRepository groups;

    @Mock
    private FlatmateSeekerPostRepository posts;

    @Mock
    private PropertyRepository properties;

    @Mock
        private RegisteredTenancyLookup agreements;

    @Mock
    private UserRepository users;

    @Mock
    private FlatmateBadges badges;

    @Mock
    private Notifier notifier;

    @Mock
    private AuditService audit;

    private FlatmateTrustReconciler reconciler;

    @BeforeEach
    void setUp() {
        reconciler = new FlatmateTrustReconciler(reviews, rooms, groups, posts, properties,
                agreements, users, badges, notifier, audit);
    }

    @Test
    void expiresAnApprovedBadgeAfterTheAgreementEndDate() {
        UUID hostId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, UUID.randomUUID(),
                LocalDate.now().minusDays(1));
        when(reviews.findLapsedApprovals(any())).thenReturn(List.of(review));

        int expired = reconciler.reconcileAgreementExpiry();

        assertThat(expired).isEqualTo(1);
        assertThat(review.getStatus()).isEqualTo(FlatmateVocabulary.STATUS_REJECTED);
        assertThat(review.getReason()).contains("expired on " + LocalDate.now().minusDays(1));
        verify(badges).apply(review, false);
        verify(reviews).saveAllAndFlush(List.of(review));
        verify(notifier).notify(eq(hostId), eq("flatmate.review.expired"), any(), any(),
                eq("/flatmates"));
    }

    @Test
    void archivesStaleRoomsAndSeekerPosts() {
        UUID roomHostId = UUID.randomUUID();
        UUID seekerId = UUID.randomUUID();
        FlatmateRoom room = new FlatmateRoom(roomHostId, "Private room", "Baner", 15000L);
        FlatmateSeekerPost post = new FlatmateSeekerPost(seekerId, "Seeker", 20000L);
        when(rooms.findStale(any())).thenReturn(List.of(room));
        when(posts.findStale(any())).thenReturn(List.of(post));

        int archived = reconciler.reconcileStaleSupply();

        assertThat(archived).isEqualTo(2);
        assertThat(room.isArchived()).isTrue();
        assertThat(post.isArchived()).isTrue();
        verify(rooms).saveAllAndFlush(List.of(room));
        verify(posts).saveAllAndFlush(List.of(post));
        verify(notifier).notify(eq(roomHostId), eq("flatmate.room.archived"), any(), any(),
                eq("/flatmates"));
        verify(notifier).notify(eq(seekerId), eq("flatmate.post.archived"), any(), any(),
                eq("/flatmates"));
    }

    @Test
    void approvesAConsentedClaimMatchedToADraazyRegisteredAgreement() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID propertyId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId, LocalDate.now().plusDays(300), propertyId);
        User host = new User("9820000100", "buyer");
        when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));
        when(rooms.findById(roomId)).thenReturn(Optional.of(roomIn("Baner")));
        when(properties.findById(propertyId)).thenReturn(Optional.of(propertyIn("Baner")));
        when(users.findById(hostId)).thenReturn(Optional.of(host));
        when(agreements.hasRegisteredTenancy(propertyId, host.getMobile())).thenReturn(true);

        int approved = reconciler.reconcileDraazyAgreements();

        assertThat(approved).isEqualTo(1);
        assertThat(review.getStatus()).isEqualTo(FlatmateVocabulary.STATUS_APPROVED);
        verify(badges).apply(review, true);
        verify(reviews).saveAllAndFlush(List.of(review));
        verify(notifier).notify(eq(hostId), eq("flatmate.review.approved"), any(), any(),
                eq("/flatmates"));
    }

    // Nothing upstream can check the named flat — a tenant does not own it — so taking it at face
    // value would badge a Baner post off a Kothrud tenancy. Falls to the desk, not refused.
    @Test
    void doesNotAutoApproveAnAgreementForAFlatInAnotherLocality() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID propertyId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId, LocalDate.now().plusDays(300),
                propertyId);
        when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));
        when(rooms.findById(roomId)).thenReturn(Optional.of(roomIn("Baner")));
        when(properties.findById(propertyId)).thenReturn(Optional.of(propertyIn("Kothrud")));

        int approved = reconciler.reconcileDraazyAgreements();

        assertThat(approved).isZero();
        assertThat(review.getStatus()).isNotEqualTo(FlatmateVocabulary.STATUS_APPROVED);
        verifyNoInteractions(agreements, badges, notifier, audit);
    }

    // Both halves name the same building, which is strictly stronger than the locality fallback:
    // the sweep may fire without a person having looked.
    @Test
    void approvesWhenThePostAndTheAgreementNameTheSameSociety() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID propertyId = UUID.randomUUID();
        UUID societyId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId, LocalDate.now().plusDays(300), propertyId);
        User host = new User("9820000101", "buyer");
        when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));
        when(rooms.findById(roomId)).thenReturn(Optional.of(roomIn("Baner", societyId)));
        when(properties.findById(propertyId)).thenReturn(Optional.of(propertyIn("Baner", societyId)));
        when(users.findById(hostId)).thenReturn(Optional.of(host));
        when(agreements.hasRegisteredTenancy(propertyId, host.getMobile())).thenReturn(true);

        assertThat(reconciler.reconcileDraazyAgreements()).isEqualTo(1);
        assertThat(review.getStatus()).isEqualTo(FlatmateVocabulary.STATUS_APPROVED);
    }

    // The case the locality rung cannot see: two towers in one neighbourhood, with every fact the
    // coarse check compares agreeing. Falls to the desk rather than being refused.
    @Test
    void doesNotAutoApproveAnAgreementForAnotherSocietyInTheSameLocality() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID propertyId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId, LocalDate.now().plusDays(300), propertyId);
        when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));
        when(rooms.findById(roomId)).thenReturn(Optional.of(roomIn("Baner", UUID.randomUUID())));
        when(properties.findById(propertyId))
                .thenReturn(Optional.of(propertyIn("Baner", UUID.randomUUID())));

        assertThat(reconciler.reconcileDraazyAgreements()).isZero();
        assertThat(review.getStatus()).isNotEqualTo(FlatmateVocabulary.STATUS_APPROVED);
        verifyNoInteractions(agreements, badges, notifier, audit);
    }

    // A host who skipped the society picker is not making a false claim, so the exact rung is
    // unreachable and the locality one still decides.
    @Test
    void fallsBackToTheLocalityWhenThePostNamesNoSociety() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        UUID propertyId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId, LocalDate.now().plusDays(300), propertyId);
        User host = new User("9820000102", "buyer");
        when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));
        when(rooms.findById(roomId)).thenReturn(Optional.of(roomIn("Baner")));
        when(properties.findById(propertyId))
                .thenReturn(Optional.of(propertyIn("Baner", UUID.randomUUID())));
        when(users.findById(hostId)).thenReturn(Optional.of(host));
        when(agreements.hasRegisteredTenancy(propertyId, host.getMobile())).thenReturn(true);

        assertThat(reconciler.reconcileDraazyAgreements()).isEqualTo(1);
    }

    private static FlatmateRoom roomIn(String locality) {
        return new FlatmateRoom(UUID.randomUUID(), "Private room", locality, 15000L);
    }

    private static FlatmateRoom roomIn(String locality, UUID societyId) {
        FlatmateRoom room = roomIn(locality);
        room.setSocietyId(societyId);
        return room;
    }

    private static Property propertyIn(String locality) {
        return new Property(new User("9820000199", "seller"), "Flat", "rent", "apartment", 25000L,
                locality, "Pune");
    }

    private static Property propertyIn(String locality, UUID societyId) {
        Property property = propertyIn(locality);
        property.setSocietyId(societyId);
        return property;
    }

        @Test
        void incompleteAgreementNeverAutoApprovesATenantReview() {
                UUID hostId = UUID.randomUUID();
                FlatmateReview review = new FlatmateReview("room", UUID.randomUUID(), null, hostId,
                                "Baner", "tenant", false, true, null,
                                new AgreementRegistration(null, LocalDate.now(), LocalDate.now().plusDays(300)),
                                UUID.randomUUID());
                when(reviews.findConsentedTenantBacklog()).thenReturn(List.of(review));

                reconciler.reconcileDraazyAgreements();

                verifyNoInteractions(users, agreements, badges, audit);
        }

    private static FlatmateReview tenantReview(UUID hostId, UUID roomId, LocalDate validTill) {
                return tenantReview(hostId, roomId, validTill, null);
        }

        private static FlatmateReview tenantReview(UUID hostId, UUID roomId, LocalDate validTill,
                        UUID tenancyPropertyId) {
        return new FlatmateReview("room", roomId, null, hostId, "Baner", "tenant", false, true,
                                null, new AgreementRegistration("PNE-123", validTill.minusMonths(11), validTill),
                                tenancyPropertyId);
    }
}
