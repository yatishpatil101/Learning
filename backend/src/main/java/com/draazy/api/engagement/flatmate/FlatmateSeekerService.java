package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.VerificationRequiredException;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeker posts (the {@code team-up} supply) and the host inbox that answers them. The contact
 * decision runs opposite to the rest of the platform: docs/flows/consumer/flatmates.md §5.
 */
@Service
public class FlatmateSeekerService {

    private static final Logger log = LoggerFactory.getLogger(FlatmateSeekerService.class);

    /**
     * New hosts one account may contact per {@link #RATE_WINDOW}. A rate, not a count: unlike a post
     * an interest is <em>delivered</em>, and re-sending to somebody already contacted costs nothing.
     */
    private static final int MAX_INTERESTS = 10;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    /** Contract {@code FlatmateInterestCreate.message} — {@code maxLength: 4000}. */
    private static final int MAX_MESSAGE = 4000;

    /**
     * V27's one-request-per-person-per-target index — the only thing that can settle two presses
     * arriving together. Shared with {@link FlatmateSupplyService}, which writes the same table.
     */
    private static final String ONE_PER_TARGET_INDEX = "uq_flatmate_requests_target_requester";

    /**
     * The three doors that write {@code flatmate_requests}, spelled as they are stored. The seeker
     * door is {@code flatmate}, not {@code post}: renaming the column literal needs a migration.
     */
    private static final java.util.Set<String> INTEREST_KINDS =
            java.util.Set.of("flatmate", "room", "group");

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRequestRepository requests;
    /** The inbox/outbox join, owned by neither read. */
    private final FlatmateRequestHydrator hydrator;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;
    /** Makes the per-requester interest budget atomic with the insert it guards. */
    private final RateLimitLock locks;

    public FlatmateSeekerService(FlatmateSeekerPostRepository posts,
            FlatmateRequestRepository requests, FlatmateRequestHydrator hydrator,
            FlatmateMapper mapper, UserRepository users,
            Notifier notifier, AuditService audit, RateLimitLock locks) {
        this.posts = posts;
        this.requests = requests;
        this.hydrator = hydrator;
        this.mapper = mapper;
        this.users = users;
        this.notifier = notifier;
        this.audit = audit;
        this.locks = locks;
    }

    /** {@code GET /flatmates/posts} — public. Visible posts, newest first, filtered server-side. */
    @Transactional(readOnly = true)
    public Page<FlatmateSeekerPostDto> feed(PostFacets facets, Pageable pageable) {
        return posts.feed(
                FlatmateVocabulary.blankToNull(facets.locality()),
                FlatmateVocabulary.facetOrNull(facets.gender()),
                FlatmateVocabulary.facetOrNull(facets.flatPref()),
                FlatmateVocabulary.facetOrNull(facets.roomPref()),
                facets.minBudget(), facets.maxBudget(), pageable)
                .map(post -> mapper.toDto(post, FlatmateMapper.SeekerView.ANONYMOUS));
    }

    /**
     * {@code POST /flatmates/posts} — advertise yourself. One live post per identity; the partial
     * unique index enforces it, the pre-check only turns a 500 naming a DB object into a message.
     */
    @Transactional
    public FlatmateSeekerPostDto create(AuthPrincipal caller, FlatmateSeekerPostCreateRequest body) {
        if (posts.existsByUserIdAndArchivedFalse(caller.userId())) {
            throw new ConflictException(
                    "You already have a live flatmate post. Edit it, or take it down before "
                            + "posting another. (already_live)");
        }
        User author = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));

        FlatmateSeekerPost post = new FlatmateSeekerPost(
                caller.userId(), body.name().strip(), body.budget());
        apply(post, body);
        // Snapshotted from the token, never the body (ADR-009a): a client that could assert its own
        // verification would make the badge worthless.
        post.setVerified(caller.aadhaarVerified());
        return mapper.toDto(posts.saveAndFlush(post),
                new FlatmateMapper.SeekerView(author.getMobile()));
    }

    /** {@code PATCH /flatmates/posts/{id}} — edit my own post. */
    @Transactional
    public FlatmateSeekerPostDto update(AuthPrincipal caller, UUID postId,
            FlatmateSeekerPostCreateRequest body) {
        FlatmateSeekerPost post = posts.findById(postId)
                .filter(p -> !p.isArchived())
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));
        if (!post.getUserId().equals(caller.userId())) {
            throw new ForbiddenException("You can only edit your own flatmate post.");
        }
        post.setName(body.name().strip());
        post.setBudget(body.budget());
        apply(post, body);
        User author = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        return mapper.toDto(posts.saveAndFlush(post),
                new FlatmateMapper.SeekerView(author.getMobile()));
    }

    /**
     * {@code DELETE /flatmates/posts/{id}} — take my post down. Soft, so the requests already filed
     * against it keep pointing at something real. Backs both "Delete" and "Mark filled".
     */
    @Transactional
    public void delete(AuthPrincipal caller, UUID postId) {
        FlatmateSeekerPost post = posts.findById(postId)
                .filter(p -> !p.isArchived())
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));
        if (!post.getUserId().equals(caller.userId())) {
            throw new ForbiddenException("You can only remove your own flatmate post.");
        }
        post.archive("removed by the poster");
        posts.saveAndFlush(post);
    }

    /**
     * {@code POST /flatmates/posts/{id}/interest} — answer somebody's ad. One request per (post,
     * requester); audited, because this is a contact release: docs/flows/consumer/flatmates.md §5.
     */
    @Transactional
    public void express(AuthPrincipal caller, UUID postId, String share, String message) {
        FlatmateSeekerPost post = posts.findVisible(postId)
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));

        UUID hostId = post.getUserId();
        if (hostId.equals(caller.userId())) {
            // 403 rather than 404: the caller can see this post on the public feed.
            throw new ForbiddenException("You cannot express interest in your own post.");
        }
        // The seeker's half of ADR-019: a missing badge may refuse a request only because the
        // person being contacted asked for exactly that.
        if (post.isVerifiedContactOnly() && !caller.aadhaarVerified()) {
            throw new VerificationRequiredException(
                    "This person accepts messages from verified members only. "
                            + "Verify your identity to get in touch. (verification_required)");
        }

        String intent = FlatmateVocabulary.orDefault(
                share, FlatmateVocabulary.SHARE_INTENT, "solo", "share intent");
        String body = pitch(message, intent);

        // Serialised on the requester and held to commit, so a burst cannot all read the same
        // pre-insert total. Same key FlatmateSupplyService uses, or the burst uses both doors.
        locks.holdUntilCommit(RateLimitLock.Limit.FLATMATE_INTEREST, caller.userId().toString());

        // Read AFTER the lock — before it is a stale read by construction — and ahead of the
        // rate-limit count, since a repeat press is not a delivery.
        if (requests.findByKindAndTargetIdAndRequesterId(
                "flatmate", post.getId(), caller.userId()).isPresent()) {
            throw alreadyInterested();
        }

        if (requests.countByRequesterIdAndCreatedAtAfter(
                caller.userId(), Instant.now().minus(RATE_WINDOW)) >= MAX_INTERESTS) {
            throw new RateLimitedException(
                    "You have contacted a lot of people in the last hour. Try again shortly.",
                    (int) RATE_WINDOW.toSeconds());
        }

        try {
            requests.saveAndFlush(new FlatmateRequest(
                    "flatmate", post.getId(), hostId, caller.userId(), "request", intent, body));
        } catch (DataIntegrityViolationException raced) {
            // Backstop for an isolation level that would carry a pre-lock snapshot past the
            // re-read. Only this index is translated: a FK or check violation is a real bug.
            if (!isDuplicateInterest(raced)) {
                throw raced;
            }
            // Reaching this line means the re-read did not do its job; the caller cannot tell.
            log.debug("duplicate flatmate interest reached the index: post={} requester={}",
                    post.getId(), caller.userId());
            throw alreadyInterested();
        }

        User requester = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        notify(hostId, post, requester, body);
        audit.record(caller, "flatmate.interest", "flatmateSeekerPost", post.getId().toString(),
                "host", hostId.toString());
    }

    /**
     * {@code GET /me/flatmate-posts} — the ad the caller wrote, as its author sees it. A 0..1
     * resource in a page envelope. Why not the feed narrowed: docs/flows/consumer/flatmates.md §5.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateSeekerPostDto> myPosts(AuthPrincipal caller, Pageable pageable) {
        User author = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        List<FlatmateSeekerPostDto> mine = posts.findByUserIdAndArchivedFalse(caller.userId())
                .map(post -> mapper.toDto(post, new FlatmateMapper.SeekerView(author.getMobile())))
                .map(List::of)
                .orElseGet(List::of);
        return new PageImpl<>(mine, pageable, mine.size());
    }

    /**
     * {@code GET /me/flatmate-requests} — the host's inbox. Paged because the host does not write
     * these rows (§5.1 api-standards.md), and batch-hydrated so a page is not an N+1.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateRequestDto> inbox(AuthPrincipal caller, String status, Pageable pageable) {
        String filter = FlatmateVocabulary.optional(
                status, FlatmateVocabulary.REQUEST_STATUS, "status");
        Page<FlatmateRequest> rows = filter == null
                ? requests.findByHostIdOrderByRequestedAtDesc(caller.userId(), pageable)
                : requests.findByHostIdAndStatusOrderByRequestedAtDesc(
                        caller.userId(), filter, pageable);
        return new PageImpl<>(hydrator.hydrate(rows.getContent()), pageable, rows.getTotalElements());
    }

    /**
     * {@code GET /flatmates/posts/{id}/interests} — who answered this ad. Ownership is
     * re-established server-side on every call: docs/flows/consumer/flatmates.md §5.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateRequestDto> interests(AuthPrincipal caller, UUID postId, Pageable pageable) {
        FlatmateSeekerPost post = posts.findById(postId)
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));
        if (!post.getUserId().equals(caller.userId())) {
            throw new ForbiddenException("You can only see the replies to your own flatmate post.");
        }
        Page<FlatmateRequest> rows = requests.findByKindAndTargetIdAndHostIdOrderByRequestedAtDesc(
                "flatmate", post.getId(), caller.userId(), pageable);
        // Batched exactly as the inbox is: a popular ad renders thirty rows, and a per-row lookup
        // would be sixty queries for one screen.
        return new PageImpl<>(hydrator.hydrate(rows.getContent()), pageable, rows.getTotalElements());
    }

    /**
     * {@code PATCH /me/flatmate-requests/{id}} — accept or decline. Host-scoped by the finder, so
     * deciding somebody else's request is a 404: a 403 would confirm the id exists.
     */
    @Transactional
    public FlatmateRequestDto decide(AuthPrincipal caller, UUID requestId, String decision) {
        String verdict = FlatmateVocabulary.require(
                decision == null ? "" : decision.strip(),
                java.util.Set.of("accepted", "declined"), "decision");

        FlatmateRequest request = requests.findByIdAndHostId(requestId, caller.userId())
                .orElseThrow(() -> NotFoundException.of("Flatmate request"));
        request.decide(verdict);
        requests.saveAndFlush(request);

        notifyDecision(request, verdict);
        return hydrator.hydrateOne(request);
    }

    /**
     * {@code GET /me/flatmate-interests} — everything I have asked for. The mirror of {@link #inbox},
     * and deliberately without the host's number: docs/flows/consumer/flatmates.md §5.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateRequestDto> outbox(AuthPrincipal caller, String status, Pageable pageable) {
        String filter = FlatmateVocabulary.optional(
                status, FlatmateVocabulary.REQUEST_STATUS, "status");
        Page<FlatmateRequest> rows = filter == null
                ? requests.findByRequesterIdOrderByCreatedAtDesc(caller.userId(), pageable)
                : requests.findByRequesterIdAndStatusOrderByCreatedAtDesc(
                        caller.userId(), filter, pageable);
        return new PageImpl<>(hydrator.hydrate(rows.getContent()), pageable, rows.getTotalElements());
    }

    /**
     * {@code DELETE /flatmates/{kind}/{id}/interest} — take back an ask. Hard delete, pending only,
     * and no rate-limit refund: docs/flows/consumer/flatmates.md §5.
     */
    @Transactional
    public void withdraw(AuthPrincipal caller, String kind, UUID targetId) {
        String door = FlatmateVocabulary.require(
                kind == null ? "" : kind.strip(), INTEREST_KINDS, "kind");
        FlatmateRequest request = requests
                .findByKindAndTargetIdAndRequesterId(door, targetId, caller.userId())
                .orElseThrow(() -> NotFoundException.of("Flatmate interest"));
        if (!request.isPending()) {
            throw new ConflictException(FlatmateConflicts.mark(
                    "The host has already answered this one, so it cannot be withdrawn.",
                    FlatmateConflicts.ALREADY_DECIDED));
        }
        requests.delete(request);
    }

    // ---------------------------------------------------------------------------------------
    // internals
    // ---------------------------------------------------------------------------------------

    /** Fields common to create and update, all validated against the closed vocabularies. */
    private void apply(FlatmateSeekerPost post, FlatmateSeekerPostCreateRequest body) {
        post.setGender(FlatmateVocabulary.orDefault(
                body.gender(), FlatmateVocabulary.GENDER, "any", "gender"));
        post.setFlatPref(FlatmateVocabulary.orDefault(
                body.flatPref(), FlatmateVocabulary.FLAT_PREF, "any", "flat preference"));
        post.setRoomPref(FlatmateVocabulary.orDefault(
                body.roomPref(), FlatmateVocabulary.ROOM_PREF, "any", "room preference"));
        post.setAge(body.age());
        post.setOccupation(FlatmateVocabulary.blankToNull(body.occupation()));
        post.setNote(FlatmateVocabulary.blankToNull(body.note()));
        post.setLocalities(clean(body.localities()));
        post.setTags(clean(body.tags()));
        post.setMoveIn(FlatmateVocabulary.blankToNull(body.moveIn()));
        post.setMoveInAt(parseMoveIn(body.moveIn()));
        if (body.verifiedContactOnly() != null) {
            post.setVerifiedContactOnly(body.verifiedContactOnly());
        }
    }

    private static List<String> clean(List<String> values) {
        if (values == null) {
            return new ArrayList<>();
        }
        return values.stream()
                .map(FlatmateVocabulary::blankToNull)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }

    /**
     * Parse the contract's {@code FlatmateMoveIn} into a date the feed can range-scan. Unparseable
     * stores null; the literal {@code now} resolves to today, since null means "has not said".
     */
    private static LocalDate parseMoveIn(String moveIn) {
        String value = FlatmateVocabulary.blankToNull(moveIn);
        return value == null ? null : switch (value.toLowerCase(java.util.Locale.ROOT)) {
            case "now" -> LocalDate.now(PlatformTime.IST);
            case "15", "30", "60" -> LocalDate.now(PlatformTime.IST).plusDays(Long.parseLong(value));
            default -> {
                try {
                    yield LocalDate.parse(value);
                } catch (DateTimeParseException e) {
                    yield null;
                }
            }
        };
    }

    /**
     * The opening message. A share intent the requester chose deserves a sentence the host can act
     * on, so an absent message becomes one rather than an empty notification body.
     */
    private static String pitch(String message, String intent) {
        String supplied = FlatmateVocabulary.blankToNull(message);
        if (supplied != null) {
            return supplied.length() > MAX_MESSAGE ? supplied.substring(0, MAX_MESSAGE) : supplied;
        }
        return switch (intent) {
            case "bring" -> "Hi! We are two of us looking together — is that alright?";
            case "match" -> "Hi! I'm interested, and happy to share the room with someone.";
            default -> "Hi! I'm interested in teaming up.";
        };
    }

    /**
     * Whether this violation is the one-per-target rule rather than a genuine bug. Matched on the
     * index name by {@link ConstraintViolations}, which several services share.
     */
    private static boolean isDuplicateInterest(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, ONE_PER_TARGET_INDEX);
    }

    /**
     * The 409 the contract declares for {@code flatmatePostInterest}. {@link FlatmateConflicts}
     * appends the marker the client routes on, so nothing can be added after it by accident.
     */
    private static ConflictException alreadyInterested() {
        return FlatmateConflicts.alreadyInterested(
                "You have already expressed interest in this post — your earlier message is with them.");
    }

    /**
     * The delivery. This is the host's only channel — the contract returns 201 with no body — so it
     * has to carry a name, a number and what was said.
     */
    private void notify(UUID hostId, FlatmateSeekerPost post, User requester, String message) {
        // Through the Notifier port, so the host's quiet hours and preferences apply; still flushed
        // inside the caller's transaction, because this row IS the delivery.
        notifier.notify(
                hostId,
                "flatmate.interest",
                requester.getName() + " is interested in teaming up",
                message + "\n\nReach them on " + requester.getMobile() + ".",
                "/flatmates");
    }

    private void notifyDecision(FlatmateRequest request, String verdict) {
        boolean accepted = "accepted".equals(verdict);
        notifier.notify(
                request.getRequesterId(),
                "flatmate.request." + verdict,
                accepted ? "Your flatmate request was accepted" : "Your flatmate request was declined",
                accepted
                        ? "Good news — the host accepted your request. They have your number."
                        : "The host has declined this one. Plenty of other people are looking.",
                "/flatmates");
    }
}
