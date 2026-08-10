package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.VerificationRequiredException;
import com.punenest.api.common.persistence.ConstraintViolations;
import com.punenest.api.common.persistence.RateLimitLock;
import com.punenest.api.engagement.notification.Notification;
import com.punenest.api.engagement.notification.NotificationRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
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
 * Seeker posts (the {@code team-up} supply) and the host inbox that answers them.
 *
 * <p><strong>The contact decision is the design, and it runs opposite to the rest of the
 * platform.</strong> Everywhere else a seeker asks and an owner approves before a number moves
 * ({@code leads.contact}). That model has nothing to work with here: there is no listing to request
 * against, and the person being contacted is a flatmate-seeker rather than an owner fielding
 * enquiries. So the flow is inverted, and the inversion is what makes it safe — the feed publishes
 * no contact at all, and {@link #express} hands the <em>requester's</em> own name and number to the
 * host. Pressing "I'm interested" on one named post is precisely the affirmative act the contact
 * gate exists to require. The gate protects you from your number being given out without your
 * say-so; it was never meant to stop you giving it out yourself.
 *
 * <p>Both write paths are capped, for different reasons and therefore with different shapes — see
 * {@link #MAX_INTERESTS} and the one-live-post rule.
 */
@Service
public class FlatmateSeekerService {

    private static final Logger log = LoggerFactory.getLogger(FlatmateSeekerService.class);

    /**
     * New hosts one account may contact per {@link #RATE_WINDOW}.
     *
     * <p>A rate, not a count, because unlike a post an interest is <em>delivered</em>: each one puts
     * a stranger's phone number in front of a different person and a notification in their inbox.
     * That is a broadcast channel, and the only meaningful question about a broadcast channel is how
     * fast it runs. Resending to somebody already contacted costs nothing, so a person genuinely
     * working through the feed never meets this.
     */
    private static final int MAX_INTERESTS = 10;

    private static final Duration RATE_WINDOW = Duration.ofHours(1);

    /** Contract {@code FlatmateInterestCreate.message} — {@code maxLength: 4000}. */
    private static final int MAX_MESSAGE = 4000;

    /**
     * V27's {@code (kind, target_id, requester_id)} unique index — one request per person per
     * target, and the only thing that can settle two presses that arrive together.
     *
     * <p>Shared with {@link FlatmateSupplyService}, which writes the same table through the room and
     * group doors. Named here rather than centrally because the constant is only useful next to the
     * catch block that reads it.
     */
    private static final String ONE_PER_TARGET_INDEX = "uq_flatmate_requests_target_requester";

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRequestRepository requests;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    private final NotificationRepository notifications;
    private final AuditService audit;
    /** Makes the per-requester interest budget atomic with the insert it guards (D73). */
    private final RateLimitLock locks;

    public FlatmateSeekerService(FlatmateSeekerPostRepository posts,
            FlatmateRequestRepository requests, FlatmateMapper mapper, UserRepository users,
            NotificationRepository notifications, AuditService audit, RateLimitLock locks) {
        this.posts = posts;
        this.requests = requests;
        this.mapper = mapper;
        this.users = users;
        this.notifications = notifications;
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
     * {@code POST /flatmates/posts} — advertise yourself.
     *
     * <p>One live post per identity. The partial unique index is what enforces it; the pre-check
     * exists only to produce a message that says so, because a constraint violation surfaces as a
     * 500 naming a database object.
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
        // The badge is snapshotted from the token, not read from the body (ADR-009a): a client that
        // could assert its own verification would make the badge worthless.
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
     * {@code DELETE /flatmates/posts/{id}} — take my post down.
     *
     * <p>Backs both "Delete" and "Mark filled"; the contract gives them one operation because they
     * are the same fact about the world and differ only in how the seeker feels about it. Soft, so
     * the requests already filed against the post keep pointing at something real.
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
     * {@code POST /flatmates/posts/{id}/interest} — answer somebody's ad.
     *
     * <p>One request per (post, requester), and a second press is <strong>refused</strong> with the
     * 409 the contract declares rather than quietly rewriting the first message. It used to depend
     * on timing: a leisurely second press met a pre-check that rewrote the pitch and answered 201, a
     * simultaneous one met the unique index and got a 409, and the same action therefore had two
     * contract-visible answers (D175). The re-read below is now the only existence check, it happens
     * behind the lock, and it gives the same answer the index would.
     *
     * <p>The host is not notified a second time either way: a channel where pressing a button
     * repeatedly produces repeated alerts on someone else's phone is a harassment tool with a rate
     * limit on it.
     *
     * <p>Audited, because this is a contact release. The audit row is the answer to "how did this
     * person get my number", and it is the only place that answer is written down.
     */
    @Transactional
    public void express(AuthPrincipal caller, UUID postId, String share, String message) {
        FlatmateSeekerPost post = posts.findVisible(postId)
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));

        UUID hostId = post.getUserId();
        if (hostId.equals(caller.userId())) {
            // 403 rather than 404: the caller can see this post on the public feed and knows
            // perfectly well that it exists, so hiding it would only be confusing.
            throw new ForbiddenException("You cannot express interest in your own post.");
        }
        // The seeker's half of ADR-019. This is one of the few places a missing badge may refuse a
        // request, and only because the person being contacted asked for exactly that.
        if (post.isVerifiedContactOnly() && !caller.aadhaarVerified()) {
            throw new VerificationRequiredException(
                    "This person accepts messages from verified members only. "
                            + "Verify your identity to get in touch. (verification_required)");
        }

        String intent = FlatmateVocabulary.orDefault(
                share, FlatmateVocabulary.SHARE_INTENT, "solo", "share intent");
        String body = pitch(message, intent);

        // Serialised on the requester before the count, and held to commit, so a burst of interests
        // from one account cannot all read the same pre-insert total and all pass (D73). This is the
        // cap the register was raised against: ten deliveries an hour, each one a stranger's number
        // on somebody else's phone, guarded by a count that ten simultaneous requests could clear
        // together. The key is the requester alone and deliberately matches the one
        // FlatmateSupplyService uses — the two services count the same rows against the same ceiling,
        // so they have to queue on the same lock or the burst just uses both doors.
        locks.holdUntilCommit(RateLimitLock.Limit.FLATMATE_INTEREST, caller.userId().toString());

        // Read AFTER the lock, which is the whole point (D175): the loser of a double press only
        // gets here once the winner's transaction has committed and released the lock, so under READ
        // COMMITTED this statement takes a fresh snapshot and sees the row. Reading before the lock —
        // as this method used to — is a stale read by construction, and it was answering 201 while
        // the identical press one millisecond later answered 409.
        //
        // Ahead of the rate-limit count on purpose: a repeat press is not a delivery, so telling
        // somebody they have contacted too many people would be both unhelpful and untrue.
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
            // why: the backstop, and it should now be unreachable. The re-read above closes the
            // window under READ COMMITTED, but the isolation level is a property of the datasource
            // rather than of this method, and a repeatable-read session would carry its pre-lock
            // snapshot past the check and arrive here believing it is the first. V27's unique index
            // is what actually refuses that, and without this the caller got a 500 for pressing a
            // button twice.
            //
            // Only that index is translated (D170). The same insert can trip the host or requester
            // foreign key, or a check constraint on kind, and answering one of those with "you have
            // already expressed interest" would dress a defect up as the system working: the
            // requester believes their message was delivered, the host never sees it, and nothing
            // reaches the error log. Anything else goes up untouched and becomes a 500.
            if (!isDuplicateInterest(raced)) {
                throw raced;
            }
            // Logged because reaching this line means the re-read did not do its job, and the caller
            // cannot tell the difference — they get the same 409 either way (D175).
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
     * {@code GET /me/flatmate-requests} — the host's inbox, paged (D77).
     *
     * <p>Paged because the host does not write these rows: each one is a stranger who answered the
     * ad, so the collection grows with the ad's reach. §5.1 of api-standards.md calls that the
     * inbound-demand shape, and the host it punishes hardest is the one whose room everybody wants.
     *
     * <p>The rows are fetched as a page and then hydrated <em>as a batch</em>, exactly as before:
     * {@link #hydrate} resolves every requester and target in two queries rather than two per row.
     * Mapping row-by-row over a page would look tidier and quietly reinstate the N+1 that method
     * exists to prevent. {@link PageImpl} re-wraps the mapped rows around the original
     * {@code totalElements}, so the envelope still counts the whole inbox rather than this slice —
     * which is what any "N new requests" badge has to read.
     */
    @Transactional(readOnly = true)
    public Page<FlatmateRequestDto> inbox(AuthPrincipal caller, String status, Pageable pageable) {
        String filter = FlatmateVocabulary.optional(
                status, FlatmateVocabulary.REQUEST_STATUS, "status");
        Page<FlatmateRequest> rows = filter == null
                ? requests.findByHostIdOrderByRequestedAtDesc(caller.userId(), pageable)
                : requests.findByHostIdAndStatusOrderByRequestedAtDesc(
                        caller.userId(), filter, pageable);
        return new PageImpl<>(hydrate(rows.getContent()), pageable, rows.getTotalElements());
    }

    /**
     * {@code PATCH /me/flatmate-requests/{id}} — accept or decline.
     *
     * <p>Host-scoped by the finder rather than by a check afterwards, so deciding somebody else's
     * request is a 404: a 403 would confirm that the id exists and belongs to another host.
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
        return hydrate(List.of(request)).getFirst();
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
     * Parse the contract's {@code FlatmateMoveIn} into a date the feed can range-scan.
     *
     * <p>Three shapes are legal: the literal {@code now}, a legacy day bucket, or an ISO date.
     * Anything unparseable stores null rather than throwing — the raw string is kept verbatim
     * either way, and refusing a post because a date hint was odd would lose the post to save a
     * sort key.
     */
    private static LocalDate parseMoveIn(String moveIn) {
        String value = FlatmateVocabulary.blankToNull(moveIn);
        if (value == null || "now".equalsIgnoreCase(value)) {
            return null;
        }
        return switch (value) {
            case "15", "30", "60" -> LocalDate.now().plusDays(Long.parseLong(value));
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
     * Whether this violation is the one-per-target rule rather than a genuine bug.
     *
     * <p>Matched on the index name in the driver's own message; the match itself lives in
     * {@link ConstraintViolations}, which several services share against their own index names
     * (D170). Named so the catch block reads as the rule it is enforcing rather than as a string
     * comparison.
     */
    private static boolean isDuplicateInterest(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, ONE_PER_TARGET_INDEX);
    }

    /**
     * The 409 the contract declares for {@code flatmatePostInterest} — {@code already_interested}.
     *
     * <p>Says the earlier message survived, because the thing the requester actually wants to know
     * after a refused press is whether the host heard them the first time. They did.
     */
    private static ConflictException alreadyInterested() {
        return new ConflictException("You have already expressed interest in this post — your "
                + "earlier message is with them. (already_interested)");
    }

    /**
     * The delivery. This is the host's only channel — the contract returns 201 with no body — so
     * the notification has to carry everything they need to act: a name, a number and what was said.
     */
    private void notify(UUID hostId, FlatmateSeekerPost post, User requester, String message) {
        Notification note = new Notification(
                hostId,
                "flatmate.interest",
                requester.getName() + " is interested in teaming up",
                message + "\n\nReach them on " + requester.getMobile() + ".");
        note.setLink("/flatmates");
        // Flushed rather than left to the commit: this row IS the delivery, and the endpoint is
        // pointless without it. Failing here attributes the failure to the interest that caused it.
        notifications.saveAndFlush(note);
    }

    private void notifyDecision(FlatmateRequest request, String verdict) {
        boolean accepted = "accepted".equals(verdict);
        Notification note = new Notification(
                request.getRequesterId(),
                "flatmate.request." + verdict,
                accepted ? "Your flatmate request was accepted" : "Your flatmate request was declined",
                accepted
                        ? "Good news — the host accepted your request. They have your number."
                        : "The host has declined this one. Plenty of other people are looking.");
        note.setLink("/flatmates");
        notifications.saveAndFlush(note);
    }

    /**
     * Fill in the names, titles and numbers the inbox renders.
     *
     * <p>Batched: one query for every requester and one for every seeker post, rather than two per
     * row. An inbox of thirty requests would otherwise be sixty queries to render one screen.
     */
    private List<FlatmateRequestDto> hydrate(List<FlatmateRequest> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        var requesterIds = rows.stream().map(FlatmateRequest::getRequesterId).distinct().toList();
        var byId = users.findAllById(requesterIds).stream()
                .collect(java.util.stream.Collectors.toMap(User::getId, u -> u));

        var seekerTargets = rows.stream()
                .filter(r -> "flatmate".equals(r.getKind()))
                .map(FlatmateRequest::getTargetId)
                .distinct()
                .toList();
        var seekerById = posts.findAllById(seekerTargets).stream()
                .collect(java.util.stream.Collectors.toMap(FlatmateSeekerPost::getId, p -> p));

        return rows.stream().map(r -> {
            User requester = byId.get(r.getRequesterId());
            FlatmateSeekerPost target = seekerById.get(r.getTargetId());
            return FlatmateRequestDto.of(
                    r,
                    target == null ? null : target.getName(),
                    target == null || target.getLocalities().isEmpty()
                            ? null : target.getLocalities().getFirst(),
                    requester == null ? null : requester.getName(),
                    requester == null ? null : requester.getMobile());
        }).toList();
    }
}
