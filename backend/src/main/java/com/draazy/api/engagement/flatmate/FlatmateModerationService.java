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

    /* Re-checks are live rows and the asked-for states are not, so the sets never overlap; {@code size} applies
       to each kind and set, and {@code totalElements} is their sum. */
    @Transactional(readOnly = true)
    public Page<FlatmateModerationQueueDto> moderationQueue(List<String> kinds, List<String> modStatus,
            Pageable pageable) {
        List<String> requested = nonBlank(modStatus);
        boolean recheck = requested.contains(SELECTOR_RECHECK);
        List<String> states = modStates(
                requested.stream().filter(s -> !SELECTOR_RECHECK.equals(s)).toList(),
                recheck ? null : FlatmateVocabulary.MOD_PENDING);
        List<String> wanted = nonBlank(kinds).stream()
                .map(k -> FlatmateVocabulary.require(k,
                        java.util.Set.of(FlatmateModerationQueueDto.KIND_POST,
                                FlatmateModerationQueueDto.KIND_ROOM,
                                FlatmateModerationQueueDto.KIND_GROUP), "kind"))
                .distinct().toList();
        if (wanted.isEmpty()) {
            throw new BadRequestException("kind is required.");
        }

        List<FlatmateModerationQueueDto> rows = new java.util.ArrayList<>();
        long total = 0;
        for (String kind : wanted) {
            if (!states.isEmpty()) {
                Page<FlatmateModerationQueueDto> page = byStates(kind, states, pageable);
                rows.addAll(page.getContent());
                total += page.getTotalElements();
            }
            if (recheck) {
                Page<FlatmateModerationQueueDto> page = byRecheck(kind, byWorkItemAge(pageable));
                rows.addAll(page.getContent());
                total += page.getTotalElements();
            }
        }
        return new PageImpl<>(rows, pageable, total);
    }

    private Page<FlatmateModerationQueueDto> byStates(String kind, List<String> states,
            Pageable pageable) {
        return switch (kind) {
            case FlatmateModerationQueueDto.KIND_POST ->
                    presentPosts(posts.findByModStatusInAndArchivedFalse(states, pageable));
            case FlatmateModerationQueueDto.KIND_ROOM ->
                    presentRooms(rooms.findByModStatusInAndArchivedFalse(states, pageable));
            default -> presentGroups(groups.findByModStatusInAndArchivedFalse(states, pageable));
        };
    }

    private Page<FlatmateModerationQueueDto> byRecheck(String kind, Pageable pageable) {
        return switch (kind) {
            case FlatmateModerationQueueDto.KIND_POST ->
                    presentPosts(posts.findByRecheckRequestedAtNotNullAndArchivedFalse(pageable));
            case FlatmateModerationQueueDto.KIND_ROOM ->
                    presentRooms(rooms.findByRecheckRequestedAtNotNullAndArchivedFalse(pageable));
            default -> presentGroups(groups.findByRecheckRequestedAtNotNullAndArchivedFalse(pageable));
        };
    }

    private Page<FlatmateModerationQueueDto> presentPosts(Page<FlatmateSeekerPost> page) {
        Map<UUID, String> names = namesOf(
                page.getContent().stream().map(FlatmateSeekerPost::getUserId).toList());
        return page.map(p -> FlatmateModerationQueueDto.of(p, names.get(p.getUserId())));
    }

    private Page<FlatmateModerationQueueDto> presentRooms(Page<FlatmateRoom> page) {
        Map<UUID, String> names = namesOf(
                page.getContent().stream().map(FlatmateRoom::getHostId).toList());
        return page.map(r -> FlatmateModerationQueueDto.of(r, names.get(r.getHostId())));
    }

    private Page<FlatmateModerationQueueDto> presentGroups(Page<FlatmateGroup> page) {
        Map<UUID, String> names = namesOf(
                page.getContent().stream().map(FlatmateGroup::getHostId).toList());
        return page.map(g -> FlatmateModerationQueueDto.of(g, names.get(g.getHostId())));
    }

    private static List<String> nonBlank(List<String> values) {
        return values == null ? List.of() : values.stream()
                .map(FlatmateVocabulary::blankToNull).filter(java.util.Objects::nonNull).toList();
    }

    private static List<String> modStates(List<String> requested, String fallback) {
        if (requested.isEmpty()) {
            return fallback == null ? List.of() : List.of(fallback);
        }
        return requested.stream()
                .map(s -> FlatmateVocabulary.require(s, FlatmateVocabulary.MOD_STATUS, "modStatus"))
                .distinct().toList();
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
        String requested = FlatmateVocabulary.require(
                modStatus == null ? "" : modStatus.strip(),
                FlatmateVocabulary.MOD_STATUS, "modStatus");
        String verdict = FlatmateVocabulary.MOD_LIVE.equals(requested)
                ? FlatmateVocabulary.MOD_APPROVED : requested;

        Moderated item = posts.findById(targetId).map(p -> {
            String before = p.getModStatus();
            p.setModStatus(verdict);
            p.getRecheck().clear();
            p.getExpiry().restart();
            posts.saveAndFlush(p);
            return new Moderated("flatmateSeekerPost", "post", p.getUserId(), before);
        }).or(() -> rooms.findById(targetId).map(r -> {
            String before = r.getModStatus();
            r.setModStatus(verdict);
            r.getRecheck().clear();
            r.getExpiry().restart();
            rooms.saveAndFlush(r);
            return new Moderated("flatmateRoom", "room", r.getHostId(), before);
        })).or(() -> groups.findById(targetId).map(g -> {
            String before = g.getModStatus();
            g.setModStatus(verdict);
            g.getRecheck().clear();
            g.getExpiry().restart();
            groups.saveAndFlush(g);
            return new Moderated("flatmateGroup", "group", g.getHostId(), before);
        })).orElseThrow(() -> NotFoundException.of("Flatmate post"));

        tellAuthor(item, targetId, verdict);

        audit.record(caller, "flatmate.moderate", item.auditKind(), targetId.toString(),
                "modStatus", verdict + (note == null ? "" : " — " + note));
    }

    private record Moderated(String auditKind, String linkKind, UUID authorId, String before) {
    }

    private void tellAuthor(Moderated item, UUID targetId, String verdict) {
        boolean wasPublic = FlatmateVocabulary.isPublic(item.before());
        boolean isPublic = FlatmateVocabulary.isPublic(verdict);
        String link = FlatmateLinks.of(item.linkKind(), targetId);
        if (isPublic && !wasPublic) {
            notifier.notify(item.authorId(), "flatmate.moderated.live", "Your flatmate ad is live",
                    "People can now see it and contact you.", link);
        } else if (!isPublic && !verdict.equals(item.before())
                && ("rejected".equals(verdict) || "removed".equals(verdict))) {
            notifier.notify(item.authorId(), "flatmate.moderated." + verdict,
                    "Your flatmate ad is not live", "It did not pass our review.", link);
        }
    }

    @Transactional(readOnly = true)
    public Page<GroupApplicationDto> applications(List<String> modStatus, Pageable pageable) {
        List<String> states = modStates(nonBlank(modStatus), null);
        Page<FlatmateGroupApplication> page = states.isEmpty()
                ? applications.findByOrderByCreatedAtDesc(pageable)
                : applications.findByModStatusIn(states, pageable);
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
        throw new ValidationException(
                "The flat's owner has not confirmed this sub-let, so the Tenant-verified badge"
                        + " cannot be granted. Ask the host to send the owner a consent OTP;"
                        + " the row will say Consent verified once it is done.");
    }

    private void tellHost(FlatmateReview review, boolean approved, String reason) {
        notifier.notify(
                review.getHostId(),
                "flatmate.review." + (approved ? "approved" : "rejected"),
                approved ? "Your flatmate post is verified" : "We could not verify your flatmate post",
                approved
                        ? "Thanks — we have checked your agreement and your post now shows as verified."
                        : "We could not verify your post. " + reason,
                FlatmateLinks.of(review));
    }
}
