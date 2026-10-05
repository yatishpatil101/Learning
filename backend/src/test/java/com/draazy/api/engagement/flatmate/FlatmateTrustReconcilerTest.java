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
        reconciler = new FlatmateTrustReconciler(reviews, rooms, groups, properties,
                agreements, users, badges, notifier, audit);
    }

    @Test
    void expiresAnApprovedBadgeAfterTheAgreementEndDate() {
        UUID hostId = UUID.randomUUID();
        UUID roomId = UUID.randomUUID();
        FlatmateReview review = tenantReview(hostId, roomId,
                LocalDate.now().minusDays(1));
        when(reviews.findLapsedApprovals(any())).thenReturn(List.of(review));

        int expired = reconciler.reconcileAgreementExpiry();

        assertThat(expired).isEqualTo(1);
        assertThat(review.getStatus()).isEqualTo(FlatmateVocabulary.STATUS_REJECTED);
        assertThat(review.getReason()).contains("lapsed on " + LocalDate.now().minusDays(1));
        verify(badges).apply(review, false);
        verify(reviews).saveAllAndFlush(List.of(review));
        verify(notifier).notify(eq(hostId), eq("flatmate.review.expired"), any(), any(),
                eq("/flatmates/room/" + roomId));
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
                eq("/flatmates/room/" + roomId));
    }

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

    @Test
    void aSelfPublishedRoomThatLosesOwnerTierGoesBackToTheQueue() {
        UUID hostId = UUID.randomUUID();
        FlatmateRoom room = ownerTierRoom(hostId, FlatmateVocabulary.MOD_LIVE);
        when(rooms.findOwnerTierClaims()).thenReturn(List.of(room));

        assertThat(reconciler.reconcileOwnerTier()).isEqualTo(1);

        assertThat(room.getVerificationTier()).isEqualTo(FlatmateVocabulary.TIER_IDENTITY);
        assertThat(room.getModStatus()).isEqualTo(FlatmateVocabulary.MOD_PENDING);
        verify(notifier).notify(eq(hostId), eq("flatmate.moderated.held"), any(), any(), any());
    }

    @Test
    void aModeratorApprovedRoomStaysPublishedWhenItLosesOwnerTier() {
        FlatmateRoom room = ownerTierRoom(UUID.randomUUID(), FlatmateVocabulary.MOD_APPROVED);
        when(rooms.findOwnerTierClaims()).thenReturn(List.of(room));

        reconciler.reconcileOwnerTier();

        assertThat(room.getModStatus()).isEqualTo(FlatmateVocabulary.MOD_APPROVED);
        verifyNoInteractions(notifier);
    }

    private static FlatmateRoom ownerTierRoom(UUID hostId, String modStatus) {
        FlatmateRoom room = new FlatmateRoom(hostId, "Private room", "Baner", 15000L);
        room.setVerificationTier(FlatmateVocabulary.TIER_OWNER);
        room.setAddressFingerprint(FlatmateGuardrails.PROPERTY_PREFIX + UUID.randomUUID());
        room.setModStatus(modStatus);
        return room;
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
