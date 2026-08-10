package com.punenest.api.engagement.flatmate;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.engagement.notification.Notification;
import com.punenest.api.engagement.notification.NotificationRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ops and admin moderation of the flatmates market.
 *
 * <p><strong>Two independent axes, and keeping them independent is the whole job of this
 * class.</strong>
 *
 * <ul>
 *   <li><strong>Verification</strong> ({@link #decideReview}) — has this host proved what they
 *       claimed? Ops answers it by reading a document. Approving grants the badge; rejecting
 *       withholds it and tells the host why.</li>
 *   <li><strong>Moderation</strong> ({@link #moderate}) — should this post be visible at all? Admin
 *       answers it, and a flagged or removed post must <em>disappear</em> from every consumer
 *       surface rather than merely render a different label.</li>
 * </ul>
 *
 * <p>They are not interchangeable. An unverified post is a legitimate post without a badge; a
 * removed post is one nobody should see. Collapsing them would mean either hiding honest supply or
 * showing abuse with a caveat.
 */
@Service
public class FlatmateModerationService {

    private final FlatmateReviewRepository reviews;
    private final FlatmateGroupApplicationRepository applications;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSeekerPostRepository posts;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final NotificationRepository notifications;
    private final AuditService audit;

    public FlatmateModerationService(FlatmateReviewRepository reviews,
            FlatmateGroupApplicationRepository applications, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateSeekerPostRepository posts,
            PropertyRepository properties, UserRepository users,
            NotificationRepository notifications, AuditService audit) {
        this.reviews = reviews;
        this.applications = applications;
        this.rooms = rooms;
        this.groups = groups;
        this.posts = posts;
        this.properties = properties;
        this.users = users;
        this.notifications = notifications;
        this.audit = audit;
    }

    /**
     * {@code GET /admin/flatmate-reviews} — the queue, oldest first, paged.
     *
     * <p><strong>Paged because it is platform-wide.</strong> This read had no caller scoping, no
     * filter requirement, no cap and no {@code Pageable} — it returned every row of
     * {@code flatmate_reviews}, a table that grows with every tenant-tier host who lists a room, at
     * 15 fields a row including an unmasked host mobile. {@code api-standards.md} §5.1's test is
     * growth, and this grows with the platform; every other admin queue in the API already pages.
     *
     * <p>Both filters now run in the query. They used to pick one of three finders and, when both
     * were supplied, re-filter in Java — which paging would have turned into short pages and a
     * wrong {@code totalElements}. See {@link FlatmateReviewRepository#findForQueue}.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateReviewDto> queue(String status, Boolean flagged, Pageable pageable) {
        String filter = FlatmateVocabulary.optional(
                status, FlatmateVocabulary.REVIEW_STATUS, "status");

        Page<FlatmateReview> page = reviews.findForQueue(filter, flagged, pageable);

        Map<UUID, User> hosts = users.findAllById(
                        page.getContent().stream()
                                .map(FlatmateReview::getHostId).distinct().toList()).stream()
                .collect(Collectors.toMap(User::getId, u -> u));

        return page.map(r -> {
            User host = hosts.get(r.getHostId());
            return FlatmateReviewDto.of(r,
                    host == null ? null : host.getName(),
                    host == null ? null : host.getMobile());
        });
    }

    /**
     * {@code PATCH /admin/flatmate-reviews/{id}} — decide a host verification.
     *
     * <p>Approving promotes the post to the tenant tier <em>and grants the badge</em>, which is the
     * only path by which a tenant-tier post ever earns one. Rejecting requires a reason, because a
     * host who is told "no" without being told why cannot fix anything — and the DB enforces that
     * too, so the rule holds whatever the write path.
     */
    @Transactional
    public FlatmateReviewDto decideReview(AuthPrincipal caller, UUID reviewId, String status,
            String reason) {
        String verdict = FlatmateVocabulary.require(
                status == null ? "" : status.strip(),
                java.util.Set.of("approved", "rejected"), "status");
        String why = FlatmateVocabulary.blankToNull(reason);
        if ("rejected".equals(verdict) && why == null) {
            throw new BadRequestException(
                    "A rejection needs a reason — the host is always told why.");
        }

        FlatmateReview review = reviews.findById(reviewId)
                .orElseThrow(() -> NotFoundException.of("Flatmate review"));
        review.decide(verdict, why, caller.userId());
        reviews.saveAndFlush(review);

        boolean approved = "approved".equals(verdict);
        applyBadge(review, approved);
        tellHost(review, approved, why);

        audit.record(caller, "flatmate.review." + verdict, "flatmateReview",
                review.getId().toString(), "host", review.getHostId().toString());

        User host = users.findById(review.getHostId()).orElse(null);
        return FlatmateReviewDto.of(review,
                host == null ? null : host.getName(),
                host == null ? null : host.getMobile());
    }

    /**
     * {@code GET /admin/flatmates/moderation} — the backlog D72 created.
     *
     * <p>Making posts start invisible is only defensible if somebody can see the queue; without
     * this read, "moderated before public" would in practice mean "never public", which is a worse
     * outcome for honest supply than the unmoderated board was.
     *
     * <p>One {@code kind} per call. Posts, rooms and groups are three tables with three shapes, and
     * a merged board would have to page across all of them — which means either loading every
     * pending row to sort it in memory, or reporting a {@code totalElements} that is true of one
     * table and false of the screen. Both are worse than asking the caller which board they want.
     *
     * <p>Defaults to {@code pending} because that is the queue. Any other {@code MOD_STATUS} is
     * accepted so an admin can review their own past decisions — "what did we remove last week" is
     * a question a moderation team has to be able to answer about itself.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateModerationQueueDto> moderationQueue(String kind, String modStatus,
            Pageable pageable) {
        String state = FlatmateVocabulary.orDefault(modStatus, FlatmateVocabulary.MOD_STATUS,
                FlatmateVocabulary.MOD_PENDING, "modStatus");

        return switch (FlatmateVocabulary.require(kind == null ? "" : kind.strip(),
                java.util.Set.of(FlatmateModerationQueueDto.KIND_POST,
                        FlatmateModerationQueueDto.KIND_ROOM,
                        FlatmateModerationQueueDto.KIND_GROUP), "kind")) {
            case FlatmateModerationQueueDto.KIND_POST -> {
                Page<FlatmateSeekerPost> page =
                        posts.findByModStatusAndArchivedFalse(state, pageable);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateSeekerPost::getUserId).toList());
                yield page.map(p -> FlatmateModerationQueueDto.of(p, names.get(p.getUserId())));
            }
            case FlatmateModerationQueueDto.KIND_ROOM -> {
                Page<FlatmateRoom> page = rooms.findByModStatusAndArchivedFalse(state, pageable);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateRoom::getHostId).toList());
                yield page.map(r -> FlatmateModerationQueueDto.of(r, names.get(r.getHostId())));
            }
            default -> {
                Page<FlatmateGroup> page = groups.findByModStatusAndArchivedFalse(state, pageable);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateGroup::getHostId).toList());
                yield page.map(g -> FlatmateModerationQueueDto.of(g, names.get(g.getHostId())));
            }
        };
    }

    /** Author names for one page, in one query rather than one per row. */
    private Map<UUID, String> namesOf(List<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return users.findAllById(userIds.stream().distinct().toList()).stream()
                .filter(u -> u.getName() != null)
                .collect(Collectors.toMap(User::getId, User::getName));
    }

    /**
     * {@code PATCH /admin/flatmates/{id}/moderation} — the moderation axis.
     *
     * <p>The id may name a seeker post, a room or a group; the contract has one operation for all
     * three because moderation asks the same question of each. Tried in turn rather than requiring
     * the caller to say which — an admin acting on an abuse report has an id, not a taxonomy.
     */
    @Transactional
    public void moderate(AuthPrincipal caller, UUID targetId, String modStatus, String note) {
        String verdict = FlatmateVocabulary.require(
                modStatus == null ? "" : modStatus.strip(),
                FlatmateVocabulary.MOD_STATUS, "modStatus");

        String kind;
        if (posts.findById(targetId).map(p -> {
            p.setModStatus(verdict);
            posts.saveAndFlush(p);
            return true;
        }).orElse(false)) {
            kind = "flatmateSeekerPost";
        } else if (rooms.findById(targetId).map(r -> {
            r.setModStatus(verdict);
            rooms.saveAndFlush(r);
            return true;
        }).orElse(false)) {
            kind = "flatmateRoom";
        } else if (groups.findById(targetId).map(g -> {
            g.setModStatus(verdict);
            groups.saveAndFlush(g);
            return true;
        }).orElse(false)) {
            kind = "flatmateGroup";
        } else {
            throw NotFoundException.of("Flatmate post");
        }

        // The note is internal and never surfaced to consumers, so the audit row is where it lives.
        audit.record(caller, "flatmate.moderate", kind, targetId.toString(),
                "modStatus", verdict + (note == null ? "" : " — " + note));
    }

    /**
     * {@code GET /admin/group-applications} — the admin board, newest first, paged.
     *
     * <p>Paged for the same reason as {@link #queue}: it read the whole table with no scoping and
     * no cap, and {@link #hydrate} does a listing/group/applicant lookup per batch — so the cost of
     * an unpaged read grew with the platform on both axes at once.
     *
     * <p>Titles, rent and member counts are joined in rather than stored on the row, so the screen
     * never shows a price that stopped being true when the owner edited their listing.
     */
    @Transactional(readOnly = true)
    public Page<GroupApplicationDto> applications(Pageable pageable) {
        Page<FlatmateGroupApplication> page = applications.findByOrderByCreatedAtDesc(pageable);
        List<GroupApplicationDto> hydrated = hydrate(page.getContent());
        return new PageImpl<>(hydrated, page.getPageable(), page.getTotalElements());
    }

    /**
     * {@code PATCH /admin/group-applications/{id}} — moderate one application.
     *
     * <p><strong>Writes {@code modStatus} only.</strong> The owner's {@code status} is theirs: an
     * admin removing a spam application must not thereby decline it on the owner's behalf, because
     * "we took this down" and "the owner said no" are different facts and only one of them is true.
     * {@link FlatmateGroupApplication#moderate} cannot reach {@code status} at all, so the rule holds
     * even if a future caller forgets it.
     */
    @Transactional
    public GroupApplicationDto moderateApplication(AuthPrincipal caller, UUID applicationId,
            String modStatus, String note) {
        String verdict = FlatmateVocabulary.require(
                modStatus == null ? "" : modStatus.strip(),
                FlatmateVocabulary.MOD_STATUS, "modStatus");

        FlatmateGroupApplication application = applications.findById(applicationId)
                .orElseThrow(() -> NotFoundException.of("Group application"));
        application.moderate(verdict, FlatmateVocabulary.blankToNull(note));
        applications.saveAndFlush(application);

        audit.record(caller, "flatmate.groupApplication.moderate", "flatmateGroupApplication",
                application.getId().toString(), "modStatus", verdict);
        return hydrate(List.of(application)).getFirst();
    }

    /** Join the listing and group facts each row renders, batched rather than per row. */
    private List<GroupApplicationDto> hydrate(List<FlatmateGroupApplication> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, Property> listings = properties.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getListingId).distinct().toList())
                .stream().collect(Collectors.toMap(Property::getId, p -> p));
        Map<UUID, FlatmateGroup> byGroup = groups.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getGroupId).distinct().toList())
                .stream().collect(Collectors.toMap(FlatmateGroup::getId, g -> g));
        Map<UUID, User> applicants = users.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getApplicantId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, u -> u));

        return rows.stream().map(row -> {
            Property listing = listings.get(row.getListingId());
            FlatmateGroup group = byGroup.get(row.getGroupId());
            User applicant = applicants.get(row.getApplicantId());
            return GroupApplicationDto.of(row,
                    listing == null ? null : listing.getTitle(),
                    listing == null ? null : listing.getLocality(),
                    listing == null ? null : listing.getPrice(),
                    group == null ? null : group.getTitle(),
                    applicant == null ? null : applicant.getName(),
                    group == null ? 0 : group.getMembers().size(),
                    group == null ? 0 : group.getSeatsTotal());
        }).toList();
    }

    /**
     * Grant or withhold the badge on the reviewed post.
     *
     * <p>Only the badge moves. The post stays visible either way: failing verification means an
     * unproven claim, not abuse, and hiding it here would silently merge the two axes this class
     * exists to keep apart.
     */
    private void applyBadge(FlatmateReview review, boolean approved) {
        if (review.getRoomId() != null) {
            rooms.findById(review.getRoomId()).ifPresent(room -> {
                room.setVerified(approved);
                room.setFlagForReview(false);
                rooms.saveAndFlush(room);
            });
        } else if (review.getGroupId() != null) {
            groups.findById(review.getGroupId()).ifPresent(group -> {
                group.setVerificationTier(approved
                        ? FlatmateVocabulary.TIER_TENANT : FlatmateVocabulary.TIER_IDENTITY);
                group.setFlagForReview(false);
                groups.saveAndFlush(group);
            });
        }
    }

    private void tellHost(FlatmateReview review, boolean approved, String reason) {
        Notification note = new Notification(
                review.getHostId(),
                "flatmate.review." + (approved ? "approved" : "rejected"),
                approved ? "Your flatmate post is verified" : "We could not verify your flatmate post",
                approved
                        ? "Thanks — we have checked your agreement and your post now shows as verified."
                        : "We could not verify your post. " + reason);
        note.setLink("/flatmates");
        notifications.saveAndFlush(note);
    }
}
