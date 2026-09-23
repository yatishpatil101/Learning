package com.draazy.api.engagement.flatmate;

import com.draazy.api.security.AuthPrincipal;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Decides <em>visibility</em> — may a stranger see this post — which is deliberately not the question
 * the review queue answers (<em>verification</em>). A tenant-tier post is live and unbadged. */
@Component
class FlatmatePublication {

    private final FlatmateGuardrails guardrails;
    private final FlatmateReviewRepository reviews;

    FlatmatePublication(FlatmateGuardrails guardrails, FlatmateReviewRepository reviews) {
        this.guardrails = guardrails;
        this.reviews = reviews;
    }

    /** One row per target, updated in place: {@code uq_flatmate_reviews_room} and its group twin are
     * unique on it, so filing a second row on edit would 409 every edit of an agreement-backed post. */
    void enqueueReviewIfNeeded(AuthPrincipal caller, String kind, UUID roomId, UUID groupId,
            String tier, boolean flagged, String address, AgreementClaim claim) {
        if (FlatmateVocabulary.TIER_OWNER.equals(tier)) {
            return;
        }
        boolean needsReview = FlatmateVocabulary.TIER_TENANT.equals(tier) || flagged;
        if (!needsReview) {
            return;
        }
        var standing = roomId != null ? reviews.findByRoomId(roomId) : reviews.findByGroupId(groupId);
        if (standing.isPresent()) {
            standing.get().reopenAfterEdit(address, tier, flagged, claim.ownerConsent(),
                claim.doc(), claim.registration(), claim.tenancyPropertyId());
            reviews.saveAndFlush(standing.get());
            return;
        }
        reviews.saveAndFlush(new FlatmateReview(kind, roomId, groupId, caller.userId(), address,
            tier, flagged, claim.ownerConsent(), claim.doc(), claim.registration(),
            claim.tenancyPropertyId()));
    }

    /** {@code ownerConsent} is a derived fact, never a request field: callers must obtain it from
     * {@code FlatmateOwnerConsentService}, or ten arbitrary digits would certify a sub-let. */
        record AgreementClaim(Map<String, Object> doc, AgreementRegistration registration,
            boolean ownerConsent, UUID tenancyPropertyId) {
    }

        void recordOwnerConsent(UUID groupId) {
        reviews.findByGroupId(groupId)
            .filter(review -> FlatmateVocabulary.STATUS_PENDING.equals(review.getStatus()))
            .ifPresent(review -> {
                review.recordOwnerConsent();
                reviews.saveAndFlush(review);
            });
        }

    /** The room twin of {@link #recordOwnerConsent(UUID)}. Consent is commonly taken <em>after</em>
     * the post exists; without this the queued review keeps {@code owner_consent = false} forever. */
        void recordOwnerConsentForRoom(UUID roomId) {
        reviews.findByRoomId(roomId)
            .filter(review -> FlatmateVocabulary.STATUS_PENDING.equals(review.getStatus()))
            .ifPresent(review -> {
                review.recordOwnerConsent();
                reviews.saveAndFlush(review);
            });
        }

    /** Owner and tenant tiers publish; only {@code identity} waits. {@code flagged} overrides the tier
     * — the guardrail fires on behaviour, which a good tier does not excuse. */
    String stateFor(String tier, boolean flagged) {
        if (flagged || FlatmateVocabulary.TIER_IDENTITY.equals(tier)) {
            return FlatmateVocabulary.MOD_PENDING;
        }
        return FlatmateVocabulary.MOD_LIVE;
    }

    /** The eligibility result is read for its flag, never its verdict — {@code blocked()} is always true
     * for a post that already exists. The ladder is consulted only for its power to <em>lower</em>. */
    void reapplyAfterEdit(AuthPrincipal caller, String tier, FlatmateEditImpact impact,
            FlatmateSupplyPost post, FlatmateGuardrails.Address address) {
        var eligibility = guardrails.evaluate(caller.userId(), tier, address);
        post.setAddressFingerprint(eligibility.fingerprint());
        post.setFlagForReview(eligibility.flagForReview());
        String standing = post.getModStatus();
        boolean wasPublic = FlatmateVocabulary.isPublic(standing);
        String ladder = stateFor(tier, eligibility.flagForReview());
        boolean photoLessRoom = post instanceof FlatmateRoom room && room.getPhotos().isEmpty();
        boolean lowered = impact.remoderationRequired() || !wasPublic
            || photoLessRoom || FlatmateVocabulary.MOD_PENDING.equals(ladder);
        String state = lowered ? FlatmateVocabulary.MOD_PENDING : standing;
        post.setModStatus(state);
        post.getRecheck().settle(state, impact.rechecked());
    }
}
