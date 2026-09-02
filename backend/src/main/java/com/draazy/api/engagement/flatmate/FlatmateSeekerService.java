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

    /**
     * The three doors that write {@code flatmate_requests}, spelled as they are stored.
     *
     * <p>{@code flatmate} rather than {@code post} is a wart, not a choice — it is the literal
     * {@link #express} has written since V27 and the value sitting in the column today. Renaming it
     * would need a data migration to buy tidiness, so the withdraw path validates against what is
     * actually there.
     */
    private static final java.util.Set<String> INTEREST_KINDS =
            java.util.Set.of("flatmate", "room", "group");

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRequestRepository requests;
    /** The inbox/outbox join, shared with nothing yet but owned by neither read (D70). */
    private final FlatmateRequestHydrator hydrator;
    private final FlatmateMapper mapper;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;
    /** Makes the per-requester interest budget atomic with the insert it guards (D73). */
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
     * {@code GET /me/flatmate-posts} — the ad the caller wrote, as its author sees it.
     *
     * <p>Not {@link #feed} narrowed by an author filter, and the difference is the whole point. The
     * feed is hard-floored to approved rows, so an author whose post is still in moderation cannot
     * find it there; and every row it returns is {@link FlatmateMapper.SeekerView#ANONYMOUS}, so
     * even an approved author could not tell which row was theirs. Both are correct for a public
     * board and both make "have I posted?" unanswerable, which is a question the client asks on
     * every render — the author gets a banner instead of a card, and their own ad is kept out of
     * the results so they cannot express interest in themselves.
     *
     * <p><strong>The page can only ever hold one row.</strong> {@link #create} refuses a second live
     * ad and a partial unique index enforces it, so this is a 0..1 resource wearing the envelope its
     * two {@code /me/flatmate-*} siblings wear. The envelope is deliberate rather than lazy: it
     * costs the client nothing (the provider already unwraps `content`), it is what a reader of the
     * neighbouring routes expects, and the cap it is hiding is a product decision that may relax,
     * whereas a singular route would have to answer "no post" with a 404 — an error status for the
     * ordinary state of every account that has not posted yet.
     *
     * <p>Archived posts are excluded, which is where this parts company with
     * {@code listMyFlatmateRooms}. A host wants their withdrawn rooms back; the question this
     * answers is "is one of mine live right now", and a taken-down ad answers it wrongly — it would
     * put the banner back over an ad nobody can see.
     *
     * <p>The mobile is the caller's own and unmasked, which is the same decision {@link #create}
     * already returns rather than a new one: a seeker post carries its author's number only ever
     * back to that author.
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
     * {@code GET /me/flatmate-requests} — the host's inbox, paged (D77).
     *
     * <p>Paged because the host does not write these rows: each one is a stranger who answered the
     * ad, so the collection grows with the ad's reach. §5.1 of api-standards.md calls that the
     * inbound-demand shape, and the host it punishes hardest is the one whose room everybody wants.
     *
     * <p>The rows are fetched as a page and then hydrated <em>as a batch</em>, exactly as before:
     * {@link FlatmateRequestHydrator} resolves every requester and target in one query per kind
     * rather than two per row.
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
        return new PageImpl<>(hydrator.hydrate(rows.getContent()), pageable, rows.getTotalElements());
    }

    /**
     * {@code GET /flatmates/posts/{id}/interests} — who answered this ad (D70).
     *
     * <p>Until this existed the poster's only record of a reply was the notification it sent, and a
     * notification is a delivery rather than a record: dismiss it and the lead is gone while the row
     * is still sitting in {@code flatmate_requests}. {@link #inbox} does not close that gap on its
     * own — it is every reply to every ad, and a poster looking at one post cannot tell from it
     * which of those were about this post without reading {@code targetId} off each row.
     *
     * <p><strong>The authorisation is the feature.</strong> This payload carries a stranger's name
     * and phone number, so ownership of the ad is re-established server-side on every call and the
     * caller's own id is what the query is narrowed by — an id in the path grants nothing. 403 and
     * not 404, matching {@link #express} and {@link #update}: the post is on the public feed, so
     * pretending it does not exist would only confuse somebody who can already see it.
     *
     * <p>Deliberately {@code findById} and not {@code findVisible}. An ad that has been filled or
     * taken down is archived, and the people who answered it while it was live are exactly the leads
     * the poster still wants — hiding them the moment the post comes down would reinstate the defect
     * one step later.
     *
     * <p>The contact is <em>raw</em>, and that is the same decision {@link FlatmateRequestDto}
     * already documents rather than a new one: the requester volunteered their own number by
     * pressing "I'm interested" on this named post, and {@link #inbox} hands this identical row,
     * with the identical number, to this identical caller. Masking here and not there would leak
     * nothing less while implying the two reads mean different things.
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
        // Batched exactly as the inbox is, and for the same reason: a popular ad renders a page of
        // thirty, and a per-row lookup would be sixty queries for one screen.
        return new PageImpl<>(hydrator.hydrate(rows.getContent()), pageable, rows.getTotalElements());
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
        return hydrator.hydrateOne(request);
    }

    /**
     * {@code GET /me/flatmate-interests} — everything I have asked for, paged.
     *
     * <p>The exact mirror of {@link #inbox}: same table, same hydration, same DTO, narrowed by
     * requester instead of host. It exists because until now the answer lived in the browser.
     * {@code useFlatmates} recorded each press with {@code rememberAsk} into {@code localStorage}
     * and read the button state back out of it, so "Interest sent" was a property of the device
     * rather than of the account — sign in on a laptop and every post you had already written to
     * offered its button again, and pressing it earned a 409 the UI had to apologise for. The row
     * was in {@code flatmate_requests} the whole time; there was simply no way to ask for it.
     *
     * <p><strong>The host's number is not in these rows, and that is not an oversight.</strong>
     * {@link FlatmateRequestDto} carries {@code requesterMobile}, which on this read is the
     * caller's own, so the payload discloses nothing new. The contact model is one-directional by
     * design — the requester volunteers their number by pressing the button, and a host who wants
     * to be reachable answers. Adding the host's number here would hand every seeker a contact list
     * assembled by pressing buttons, which is precisely the thing the gate exists to prevent.
     *
     * <p>Not filtered to live targets. An ask whose room has since been taken down is still
     * something this person did, and dropping it would make the list disagree with the button they
     * are looking at — the same defect one step further along.
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
     * {@code DELETE /flatmates/{kind}/{id}/interest} — take back an ask.
     *
     * <p>The counterpart to a rule that was previously one-way. {@code record} and {@link #express}
     * both refuse a second ask with {@code already_interested}, which is right — a repeat press
     * should not rewrite the host's copy — but with no way out it meant a misdirected tap was
     * permanent. Pressing "I'm interested" on the wrong card left a stranger's phone number in
     * somebody's inbox for good, and the only remedy anybody could offer was to ask the host.
     *
     * <p><strong>Hard delete, not a status.</strong> The duplicate guard is
     * {@code (kind, target_id, requester_id)} and it is enforced by a unique index, so a withdrawn
     * row that stayed in the table would keep the door shut behind it — withdraw once and this
     * person could never write to that post again, which turns an undo into a lockout. A soft flag
     * would need the index, both finders and the seat counter to learn about it, and the row's only
     * remaining value would be proving an ask that its author has explicitly retracted.
     *
     * <p><strong>Only while it is pending.</strong> Once the host has accepted, they have acted on
     * it — on a group they gave up a seat for it — and letting the requester erase the record
     * afterwards would rewrite a decision somebody else made. 409 rather than 403: the row is
     * theirs, it is its state that refuses.
     *
     * <p><strong>The rate-limit budget is not refunded.</strong> Ten interests an hour counts
     * <em>deliveries</em>, and the notification has already gone out — the host's phone buzzed. A
     * refund would make withdrawal the cheapest way to buy another send, which is exactly the
     * pattern the window is there to stop.
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
     *
     * <p>Only the sentence is written here. {@link FlatmateConflicts} appends the marker the client
     * routes on, so nothing can be added after it by accident — see that class for why the position
     * matters (D182).
     */
    private static ConflictException alreadyInterested() {
        return FlatmateConflicts.alreadyInterested(
                "You have already expressed interest in this post — your earlier message is with them.");
    }

    /**
     * The delivery. This is the host's only channel — the contract returns 201 with no body — so
     * the notification has to carry everything they need to act: a name, a number and what was said.
     */
    private void notify(UUID hostId, FlatmateSeekerPost post, User requester, String message) {
        // Through the Notifier port rather than the repository, so the host's quiet hours and
        // preferences apply here as they do to every other server-written notification (D94).
        // Still flushed inside the caller's transaction — the port does that — because this row IS
        // the delivery and the endpoint is pointless without it.
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
