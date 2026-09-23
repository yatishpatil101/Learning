package com.draazy.api.engagement.flatmate;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.RegisteredTenancyLookup;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Trust claims that stopped being true without anybody writing anything. Sweeps rather than hooks,
 * because each fact decays silently and no write site exists to hang a guard on. */
@Service
public class FlatmateTrustReconciler {

    /** A judgement, not a finding. Package-visible so the tests state the same number rather than
     * a copy of it. */
    static final int STALE_AFTER_DAYS = 90;

    private static final String STALE_REASON = "No activity for " + STALE_AFTER_DAYS + " days.";

    private final FlatmateReviewRepository reviews;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSeekerPostRepository posts;
    private final PropertyRepository properties;
    private final RegisteredTenancyLookup agreements;
    private final UserRepository users;
    private final FlatmateBadges badges;
    private final Notifier notifier;
    private final AuditService audit;

    public FlatmateTrustReconciler(FlatmateReviewRepository reviews, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateSeekerPostRepository posts,
            PropertyRepository properties, RegisteredTenancyLookup agreements,
            UserRepository users, FlatmateBadges badges, Notifier notifier, AuditService audit) {
        this.reviews = reviews;
        this.rooms = rooms;
        this.groups = groups;
        this.posts = posts;
        this.properties = properties;
        this.agreements = agreements;
        this.users = users;
        this.badges = badges;
        this.notifier = notifier;
        this.audit = audit;
    }

    /** {@code deriveTier} runs only on a host-initiated write, so without this pass an owner-tier
     * badge outlives the listing approval that earned it. Demotion mirrors its own fallback. */
    @Transactional
    public int reconcileOwnerTier() {
        List<FlatmateRoom> staleRooms = rooms.findOwnerTierClaims().stream()
                .filter(r -> !listingStands(r.getAddressFingerprint())).toList();
        staleRooms.forEach(r -> r.setVerificationTier(fallbackTier(r.isAgreementDeclared())));
        rooms.saveAllAndFlush(staleRooms);

        List<FlatmateGroup> staleGroups = groups.findOwnerTierClaims().stream()
                .filter(g -> !listingStands(g.getAddressFingerprint())).toList();
        staleGroups.forEach(g -> g.setVerificationTier(fallbackTier(g.isAgreementDeclared())));
        groups.saveAllAndFlush(staleGroups);

        return staleRooms.size() + staleGroups.size();
    }

    /** A button because the hourly tick is the wrong latency for a listing pulled precisely because
     * its owner turned out not to own it. */
    @Transactional
    public int reconcileOwnerTier(AuthPrincipal caller) {
        int demoted = reconcileOwnerTier();
        audit.record(caller, "flatmate.ownerTier.reconcile", "flatmateReview", "all",
                "demoted", String.valueOf(demoted));
        return demoted;
    }

    /** {@code deriveTier}'s conditions minus ownership — the fingerprint records the flat, not who
     * held it. An unparseable or dangling id fails closed. */
    private boolean listingStands(String fingerprint) {
        return Ids.parseUuid(fingerprint.substring(FlatmateGuardrails.PROPERTY_PREFIX.length()))
                .flatMap(properties::findById)
                .filter(p -> PropertyStatus.APPROVED.equals(p.getStatus()) && !p.isArchived())
                .isPresent();
    }

    private static String fallbackTier(boolean agreementDeclared) {
        return agreementDeclared ? FlatmateVocabulary.TIER_TENANT : FlatmateVocabulary.TIER_IDENTITY;
    }

    /** The verdict is rewritten rather than the tier alone: the badge is derived from tier plus this
     * row's standing verdict, so an {@code approved} row behind a demoted post contradicts itself. */
    @Transactional
    public int reconcileAgreementExpiry() {
        List<FlatmateReview> lapsed = reviews.findLapsedApprovals(LocalDate.now());
        for (FlatmateReview review : lapsed) {
            review.expire(review.getAgreement().getValidTill());
            badges.apply(review, false);
            notifier.notify(review.getHostId(), "flatmate.review.expired",
                    "Your flatmate verification has expired",
                    review.getReason(), "/flatmates");
        }
        reviews.saveAllAndFlush(lapsed);
        return lapsed.size();
    }

    /** Polled rather than hooked: the {@code /service-requests} workflow never writes back. Owner
     * consent is NOT implied by a registered tenancy — the OTP stays compulsory. */
    @Transactional
    public int reconcileDraazyAgreements() {
        List<FlatmateReview> decided = new ArrayList<>();
        for (FlatmateReview review : reviews.findConsentedTenantBacklog()) {
            // The same gate a moderator would face, plus the expiry a standing badge is swept for.
            if (!review.badgeable() || review.getAgreement().expiredOn(LocalDate.now())) {
                continue;
            }
            UUID propertyId = propertyBehind(review);
            if (propertyId == null) {
                continue;
            }
            String mobile = users.findById(review.getHostId()).map(User::getMobile).orElse(null);
            if (mobile == null || !agreements.hasRegisteredTenancy(propertyId, mobile)) {
                continue;
            }
            review.decide(FlatmateVocabulary.STATUS_APPROVED,
                    "Verified against the Leave & License agreement Draazy registered for this"
                            + " flat.", null);
            badges.apply(review, true);
            notifier.notify(review.getHostId(), "flatmate.review.approved",
                    "Your flatmate post is Tenant-verified",
                    "We matched it to the rent agreement we registered for you, so there was"
                            + " nothing left for our team to check.", "/flatmates");
            decided.add(review);
        }
        reviews.saveAllAndFlush(decided);
        return decided.size();
    }

    /** The flat a queued review is about, or null when the post was never linked to one. */
    private UUID propertyBehind(FlatmateReview review) {
        UUID claimed = review.getTenancyPropertyId();
        if (claimed == null) {
            return null;
        }
        // The id is the host's own claim and nothing upstream verified it, so it is matched against
        // the post: exactly on society when both name one, else coarsely on locality.
        Property property = properties.findById(claimed).orElse(null);
        if (property == null) {
            return null;
        }
        UUID postedSociety = postedSocietyId(review);
        if (postedSociety != null && property.getSocietyId() != null) {
            return postedSociety.equals(property.getSocietyId()) ? claimed : null;
        }
        String posted = postedLocality(review);
        String claimedLocality = FlatmateVocabulary.blankToNull(property.getLocality());
        return posted != null && posted.equalsIgnoreCase(claimedLocality) ? claimed : null;
    }

    /** Rooms only: a group carries no society at all, so every group falls back to the locality
     * check. */
    private UUID postedSocietyId(FlatmateReview review) {
        if (review.getRoomId() == null) {
            return null;
        }
        return rooms.findById(review.getRoomId()).map(FlatmateRoom::getSocietyId).orElse(null);
    }

    /** The locality the post was published under, or null when the post is gone. */
    private String postedLocality(FlatmateReview review) {
        if (review.getRoomId() != null) {
            return rooms.findById(review.getRoomId())
                    .map(r -> FlatmateVocabulary.blankToNull(r.getLocality())).orElse(null);
        }
        if (review.getGroupId() != null) {
            return groups.findById(review.getGroupId())
                    .map(g -> FlatmateVocabulary.blankToNull(g.getLocality())).orElse(null);
        }
        return null;
    }

    /** {@code updatedAt} is the clock, so any edit restarts it. Archived rather than deleted, and
     * the host is told, because ninety days of silence is evidence and not proof. */
    @Transactional
    public int reconcileStaleSupply() {
        Instant cutoff = Instant.now().minus(STALE_AFTER_DAYS, ChronoUnit.DAYS);

        List<FlatmateRoom> staleRooms = rooms.findStale(cutoff);
        staleRooms.forEach(r -> {
            r.archive(STALE_REASON);
            tellArchived(r.getHostId(), "room");
        });
        rooms.saveAllAndFlush(staleRooms);

        List<FlatmateSeekerPost> stalePosts = posts.findStale(cutoff);
        stalePosts.forEach(p -> {
            p.archive(STALE_REASON);
            tellArchived(p.getUserId(), "post");
        });
        posts.saveAllAndFlush(stalePosts);

        return staleRooms.size() + stalePosts.size();
    }

    private void tellArchived(UUID ownerId, String what) {
        notifier.notify(ownerId, "flatmate." + what + ".archived",
                "We have paused your flatmate " + what,
                "Nobody has updated it in " + STALE_AFTER_DAYS + " days, so we have taken it off the"
                        + " board to keep the listings seekers see current. Still looking? Put it"
                        + " back in one tap.",
                "/flatmates");
    }
}
