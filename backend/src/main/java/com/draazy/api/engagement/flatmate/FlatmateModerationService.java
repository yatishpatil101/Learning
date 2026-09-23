package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Two independent axes, kept independent: verification ({@link #decideReview}) asks whether a host
 * proved their claim, moderation ({@link #moderate}) whether a post may be seen at all. */
@Service
public class FlatmateModerationService {

    /** A {@code modStatus} value that names a board rather than a state — see {@link #moderationQueue}. */
    static final String SELECTOR_RECHECK = "recheck";

    private final FlatmateReviewRepository reviews;
    private final FlatmateGroupApplicationRepository applications;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSeekerPostRepository posts;
    private final UserRepository users;
    private final FlatmateBadges badges;
    private final GroupApplicationHydrator applicationHydrator;
    private final Notifier notifier;
    private final AuditService audit;

    public FlatmateModerationService(FlatmateReviewRepository reviews,
            FlatmateGroupApplicationRepository applications, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateSeekerPostRepository posts,
            UserRepository users, FlatmateBadges badges,
            GroupApplicationHydrator applicationHydrator,
            Notifier notifier, AuditService audit) {
        this.reviews = reviews;
        this.applications = applications;
        this.rooms = rooms;
        this.groups = groups;
        this.posts = posts;
        this.users = users;
        this.badges = badges;
        this.applicationHydrator = applicationHydrator;
        this.notifier = notifier;
        this.audit = audit;
    }

    /** Both filters run in the query rather than being re-applied in Java, which paging would turn
     * into short pages and a wrong {@code totalElements}. */
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

    /** Approving is the only path by which a tenant-tier post earns a badge, so it additionally
     * requires the owner's OTP-backed consent — see {@link #requireConsentToApprove}. */
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
        requireConsentToApprove(review, verdict);
        review.decide(verdict, why, caller.userId());
        reviews.saveAndFlush(review);

        boolean approved = "approved".equals(verdict);
        badges.apply(review, approved);
        tellHost(review, approved, why);

        audit.record(caller, "flatmate.review." + verdict, "flatmateReview",
                review.getId().toString(), "host", review.getHostId().toString());

        User host = users.findById(review.getHostId()).orElse(null);
        return FlatmateReviewDto.of(review,
                host == null ? null : host.getName(),
                host == null ? null : host.getMobile());
    }

    /** One {@code kind} per call: three tables with three shapes cannot share a page count.
     * {@code recheck} is a selector, not a seventh {@code MOD_STATUS} — a re-checked post stays visible. */
    @Transactional(readOnly = true)
    public Page<FlatmateModerationQueueDto> moderationQueue(String kind, String modStatus,
            Pageable pageable) {
        boolean recheck = SELECTOR_RECHECK.equals(FlatmateVocabulary.blankToNull(modStatus));
        String state = recheck ? null : FlatmateVocabulary.orDefault(modStatus,
                FlatmateVocabulary.MOD_STATUS, FlatmateVocabulary.MOD_PENDING, "modStatus");
        Pageable order = recheck ? byWorkItemAge(pageable) : pageable;

        return switch (FlatmateVocabulary.require(kind == null ? "" : kind.strip(),
                java.util.Set.of(FlatmateModerationQueueDto.KIND_POST,
                        FlatmateModerationQueueDto.KIND_ROOM,
                        FlatmateModerationQueueDto.KIND_GROUP), "kind")) {
            case FlatmateModerationQueueDto.KIND_POST -> {
                Page<FlatmateSeekerPost> page = recheck
                        ? posts.findByRecheckRequestedAtNotNullAndArchivedFalse(order)
                        : posts.findByModStatusAndArchivedFalse(state, order);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateSeekerPost::getUserId).toList());
                yield page.map(p -> FlatmateModerationQueueDto.of(p, names.get(p.getUserId())));
            }
            case FlatmateModerationQueueDto.KIND_ROOM -> {
                Page<FlatmateRoom> page = recheck
                        ? rooms.findByRecheckRequestedAtNotNullAndArchivedFalse(order)
                        : rooms.findByModStatusAndArchivedFalse(state, order);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateRoom::getHostId).toList());
                yield page.map(r -> FlatmateModerationQueueDto.of(r, names.get(r.getHostId())));
            }
            default -> {
                Page<FlatmateGroup> page = recheck
                        ? groups.findByRecheckRequestedAtNotNullAndArchivedFalse(order)
                        : groups.findByModStatusAndArchivedFalse(state, order);
                Map<UUID, String> names = namesOf(
                        page.getContent().stream().map(FlatmateGroup::getHostId).toList());
                yield page.map(g -> FlatmateModerationQueueDto.of(g, names.get(g.getHostId())));
            }
        };
    }

    /** Oldest work item first, overriding the caller's sort: on the re-check board the SLA is the age
     * of the edit, not of the post, so {@code createdAt} would invert the queue. */
    private static Pageable byWorkItemAge(Pageable pageable) {
        return PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(),
                Sort.by(Sort.Direction.ASC, "recheck.requestedAt"));
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

    /** The id may name a post, a room or a group; tried in turn because an admin acting on an abuse
     * report has an id, not a taxonomy. Any pending re-check is dropped whatever the verdict. */
    @Transactional
    public void moderate(AuthPrincipal caller, UUID targetId, String modStatus, String note) {
        String verdict = FlatmateVocabulary.require(
                modStatus == null ? "" : modStatus.strip(),
                FlatmateVocabulary.MOD_STATUS, "modStatus");

        String kind;
        if (posts.findById(targetId).map(p -> {
            p.setModStatus(verdict);
            p.getRecheck().clear();
            posts.saveAndFlush(p);
            return true;
        }).orElse(false)) {
            kind = "flatmateSeekerPost";
        } else if (rooms.findById(targetId).map(r -> {
            r.setModStatus(verdict);
            r.getRecheck().clear();
            rooms.saveAndFlush(r);
            return true;
        }).orElse(false)) {
            kind = "flatmateRoom";
        } else if (groups.findById(targetId).map(g -> {
            g.setModStatus(verdict);
            g.getRecheck().clear();
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

    /** Titles, rent and member counts are joined in rather than stored on the row, so the screen
     * never shows a price that stopped being true when the owner edited their listing. */
    @Transactional(readOnly = true)
    public Page<GroupApplicationDto> applications(Pageable pageable) {
        Page<FlatmateGroupApplication> page = applications.findByOrderByCreatedAtDesc(pageable);
        List<GroupApplicationDto> hydrated = applicationHydrator.hydrate(page.getContent());
        return new PageImpl<>(hydrated, page.getPageable(), page.getTotalElements());
    }

    /** Writes {@code modStatus} only: "we took this down" and "the owner said no" are different
     * facts. {@link FlatmateGroupApplication#moderate} cannot reach {@code status} at all. */
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
        return applicationHydrator.hydrateOne(application);
    }

    /** A sub-let without the owner's written consent is a ground for eviction under the Maharashtra
     * Rent Control Act 1999, so the badge is withheld — 422, because nothing about the caller fixes it. */
    private static void requireConsentToApprove(FlatmateReview review, String verdict) {
        boolean grantsBadge = FlatmateVocabulary.STATUS_APPROVED.equals(verdict)
                && FlatmateVocabulary.TIER_TENANT.equals(review.getTier());
        if (!grantsBadge || review.badgeable()) {
            return;
        }
        // Which of badgeable()'s conditions failed, purely to say so. The decision was made above.
        if (!review.isOwnerConsent()) {
            throw new ValidationException(
                    "The flat's owner has not confirmed this sub-let, so the Tenant-verified badge"
                            + " cannot be granted. Ask the host to send the owner a consent OTP;"
                            + " the row will say Consent verified once it is done.");
        }
        throw new ValidationException(
                "The registered agreement number, registration date and validity date are "
                        + "required before the Tenant-verified badge can be granted.");
    }

    private void tellHost(FlatmateReview review, boolean approved, String reason) {
        notifier.notify(
                review.getHostId(),
                "flatmate.review." + (approved ? "approved" : "rejected"),
                approved ? "Your flatmate post is verified" : "We could not verify your flatmate post",
                approved
                        ? "Thanks — we have checked your agreement and your post now shows as verified."
                        : "We could not verify your post. " + reason,
                "/flatmates");
    }
}
