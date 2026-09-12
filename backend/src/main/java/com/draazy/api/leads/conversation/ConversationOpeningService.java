package com.draazy.api.leads.conversation;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Opening a line to someone — the one act that decides <em>whether two people may talk at all</em>.
 *
 * <p><strong>Why this is its own service.</strong> Messaging does two things the business would
 * describe differently: it lets a buyer open a line to an owner, and it carries the thread once
 * open. They share a table and almost nothing else. This one owns the admission decision — the
 * relationship guard, the counterparty derivation, the D54 find-or-create race and the
 * {@code conversation.started} audit row — and it owns its own transaction boundaries, which
 * {@link ConversationService} deliberately does not have. {@link ConversationService} owns the
 * thread afterwards: the inbox, the replies, the attachments, the read marks. Changing who may open
 * a conversation and changing what a reply does are two different reasons to change, and after
 * D5 gave the opening path a second way to name a counterparty they no longer fit in one file
 * (package-structure.md §4.1).
 *
 * <p><strong>The relationship guard is the whole feature.</strong> An endpoint that accepts a mobile
 * number and opens a chat is, without a guard, two things nobody asked for: a way to test a list of
 * numbers against the user base (the answers differ, so the answer <em>is</em> the oracle) and a
 * channel for sending strangers unsolicited messages. {@link #start} therefore requires that the two
 * parties already have business together — an approved contact request in one direction or the other
 * — and refuses everything else <em>identically</em>, whether the number belongs to nobody, belongs
 * to someone unrelated, or belongs to the caller.
 *
 * <p><strong>A buyer addresses the thread by listing, not by number.</strong> Under D5 the owner's
 * raw mobile is revealed only to the owner, so the buyer side of {@link #start} had no address it
 * could legitimately hold — approval unlocked an affordance the client could not invoke. A request
 * carrying {@code propertyId} and no {@code counterpartyMobile} therefore derives the counterparty
 * from the listing's owner. The guard is unchanged and still decides everything: naming a listing
 * says who, the approved contact request says whether.
 *
 * <p>Note the deliberate contrast with {@code FinalizationService}, which answers 422 when a
 * counterparty mobile resolves to no registered user. That is correct there and would be wrong here:
 * finalization is reachable only by the owner of the listing being finalised, so the caller has
 * already been established as a party to the deal and the number they typed is one they were given.
 * Here the caller is anyone with an account and the number is anything at all. Same-looking input,
 * different threat, different answer — do not "make them consistent".
 */
@Service
public class ConversationOpeningService {

    private static final Logger log = LoggerFactory.getLogger(ConversationOpeningService.class);

    /**
     * The two V22 partial unique indexes that make a second thread for one relationship
     * unrepresentable — one for listing-scoped threads, one for general ones.
     *
     * <p>Named here so their violation can be told apart from a foreign key on {@code property_id},
     * a not-null, or the {@code conversations_pair_ordered} CHECK. Only these two mean "somebody
     * else opened this exact thread a moment ago", which is the one case {@link #start} can answer
     * by handing over the winner's row; everything else is a defect and goes up untouched (D170).
     */
    private static final String PAIR_PROPERTY_INDEX = "uq_conversations_pair_property";
    private static final String PAIR_GENERAL_INDEX = "uq_conversations_pair_general";

    /** Counts D54 retries so a test can tell one from an accidental serialisation. */
    private final LongAdder racesRetried = new LongAdder();

    private final ConversationRepository conversations;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;
    private final AuditService audit;

    /**
     * The thread itself, for the one thing opening cannot do alone: put the caller's first message
     * in it. {@code send} is the only place a message is written, so the preview and
     * {@code updatedAt} cannot fall behind — reimplementing it here would be a second writer and
     * exactly the drift that comment exists to prevent.
     *
     * <p>It carries no transaction of its own, so it joins whichever {@link #transactions} block is
     * in flight, which is what the write-ordering invariant on {@link #openOrResume} assumes.
     */
    private final ConversationService thread;

    /**
     * Runs the attempt and, when it loses the race, the re-read — see {@link #start} for why those
     * cannot be one transaction.
     *
     * <p>Built here rather than injected, and used rather than a second {@code @Transactional}
     * method on this bean, for the reason spelled out on {@code SubscriptionService}: a self-call
     * bypasses the proxy and quietly collapses the two boundaries back into one — which is exactly
     * the bug, made invisible.
     *
     * <p>Propagation stays {@code REQUIRED}. In production nothing is in flight when the endpoint is
     * entered, so each block is genuinely its own transaction; under {@code AbstractApiTest}'s
     * class-level {@code @Transactional} it joins the test's transaction instead, which keeps
     * per-test rollback working. Joining costs that harness nothing, because a rolling-back harness
     * cannot stage a commit-time race in the first place — the race is covered by
     * {@code ConversationStartRaceTest}, which commits for real.
     */
    private final TransactionTemplate transactions;

    public ConversationOpeningService(ConversationRepository conversations,
            ConversationMapper mapper, UserRepository users, PropertyRepository properties,
            ContactRequestRepository contactRequests, AuditService audit,
            ConversationService thread, PlatformTransactionManager transactionManager) {
        this.conversations = conversations;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
        this.audit = audit;
        this.thread = thread;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * {@code POST /messages} — find-or-create.
     *
     * <p>Returns the existing thread when there is one, so a client that has lost track of the id
     * cannot fork the conversation by asking again; the caller learns which happened from the status
     * code (201 vs 200), which is why this returns a flagged result rather than a bare DTO.
     *
     * <p>Duplicate prevention is ultimately the database's job, not this method's: the V22 unique
     * indexes make the second row unrepresentable, so two concurrent first-messages produce one
     * thread and one constraint violation rather than two threads.
     *
     * <p><strong>The loser of that race is handed the winner's thread, not an error</strong> (D54).
     * Both callers looked, both saw nothing, both inserted; only one commits. "Find-or-create"
     * promised the second one a thread, and it exists — refusing at that point would be the API
     * failing on a request it had already decided was legal, for a reason the client cannot act on
     * beyond retrying the identical call.
     *
     * <p><strong>Why the re-read is a second transaction and not a catch block.</strong> The obvious
     * fix — wrap {@code saveAndFlush}, catch the violation, look the row up again — does not work in
     * JPA. A constraint violation at flush leaves the persistence context in an undefined state and
     * marks the transaction rollback-only, so every subsequent read on it is either stale, refused,
     * or fails again at commit with an {@code UnexpectedRollbackException}: the caller would get a
     * 500 in place of the 409, which is worse than what was there before. The failed attempt has to
     * <em>end</em> — roll back, discard its persistence context, release its row locks — before
     * anything can see the winner's committed row. That is what the two
     * {@link TransactionTemplate#execute} calls below buy, and the only reason this method is not
     * itself {@code @Transactional}: an ambient transaction here would swallow the first one's
     * rollback and put us straight back in the doomed context.
     *
     * <p>The retry is the same call again rather than a bespoke read path. Second time round the
     * probe finds the winner's row and takes the existing-thread branch, which is precisely the
     * answer a client one millisecond slower would have got — including {@code created=false}, so
     * the loser is told 200 rather than 201 and nothing has to reason about "created, sort of". It
     * runs once: if the insert loses again the violation propagates and
     * {@code GlobalExceptionHandler} answers the truthful 409 this used to answer always.
     *
     * <p><strong>The guard on {@code isActualTransactionActive} is what keeps that reasoning
     * true.</strong> The template propagates {@code REQUIRED}, so if a caller ever wraps this in
     * its own transaction both {@code execute} calls <em>join</em> that one instead of opening
     * their own — the first attempt's failure then only marks the outer transaction rollback-only,
     * nothing is discarded, and the retry re-enters the very persistence context the paragraph
     * above explains cannot be reused. The result would be an {@code UnexpectedRollbackException}
     * at the outer commit: a 500 in place of the 409, which is strictly worse than the bug this
     * closes. There is no such caller today ({@code ConversationsController} is not transactional),
     * and the guard is here so that adding one degrades to the old truthful 409 rather than to a
     * 500 nobody would connect back to this method.
     */
    public Started start(AuthPrincipal caller, ConversationCreate body) {
        try {
            return transactions.execute(tx -> openOrResume(caller, body));
        } catch (DataIntegrityViolationException raced) {
            if (!isPairRace(raced) || TransactionSynchronizationManager.isActualTransactionActive()) {
                // Not our collision, or we are inside somebody else's transaction and a retry
                // cannot work. Either way the honest answer is the one the client already had.
                throw raced;
            }
            log.info("Concurrent first message lost the conversation find-or-create race for {};"
                    + " handing over the thread the winner created", caller.userId());
            racesRetried.increment();
            return transactions.execute(tx -> openOrResume(caller, body));
        }
    }

    /**
     * How many times the D54 retry has actually run.
     *
     * <p>Exists because the race test cannot otherwise tell a retry from an accidental
     * serialisation — if the winner happens to commit before the loser's probe, the loser takes the
     * existing-thread branch and the observable result is byte-identical to a successful retry. A
     * test that cannot tell those apart silently stops testing this method the first time the
     * timing shifts.
     */
    long racesRetried() {
        return racesRetried.sum();
    }

    /**
     * Whether the write collided with one of {@link #PAIR_PROPERTY_INDEX} or
     * {@link #PAIR_GENERAL_INDEX} — the only violations a re-read can answer.
     *
     * <p>Anything else (a foreign key, a not-null, the ordering CHECK) is a bug in this method, and
     * retrying it would only produce the identical failure twice while presenting the second one as
     * a normal result. Mistaking someone else's constraint for ours hides a defect behind a
     * reassuring answer.
     */
    private static boolean isPairRace(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, PAIR_PROPERTY_INDEX)
                || ConstraintViolations.isOn(violation, PAIR_GENERAL_INDEX);
    }

    /**
     * One attempt at find-or-create, inside one transaction.
     *
     * <p>Called twice at most, and safe to be — but the invariant that makes it safe is narrower
     * than "it rolls back". The conversation insert must stay the <strong>first</strong> write in
     * this method. It is what collides, so a losing attempt never reaches {@code send()} or the
     * audit record, and the retry therefore sends exactly one message and writes exactly one audit
     * row. Rollback alone would not be enough to say that: {@code AuditService.record} is
     * {@code REQUIRES_NEW}, so an audit row written <em>before</em> the collision would commit and
     * survive, leaving two rows for one thread and one of them naming a conversation id that never
     * existed. Reorder the writes and that becomes real.
     *
     * <p>The listing is resolved <em>before</em> the counterparty, because when the caller sent no
     * mobile the listing is what names them ({@link #ownerOf}). That ordering is of two reads, so it
     * leaves the write invariant above untouched.
     */
    private Started openOrResume(AuthPrincipal caller, ConversationCreate body) {
        UUID propertyId = body.propertyId() == null || body.propertyId().isBlank()
                ? null
                : Ids.parseUuid(body.propertyId()).orElseThrow(ConversationOpeningService::refuse);
        Property listing = propertyId == null ? null : properties.findById(propertyId)
                .orElseThrow(ConversationOpeningService::refuse);

        User counterparty = body.counterpartyMobile() == null || body.counterpartyMobile().isBlank()
                ? ownerOf(listing, caller)
                : users.findByMobileAndArchivedFalse(
                                MobileMask.normalise(body.counterpartyMobile()))
                        .filter(u -> !u.getId().equals(caller.userId()))
                        .orElseThrow(ConversationOpeningService::refuse);
        if (listing != null) {
            // A thread is "about" a listing only if one of the two parties owns it. Otherwise the
            // field is just an arbitrary id the client attached, and it would go on to drive the
            // property title and the reveal decision in the mapper.
            if (listing.getOwner() == null
                    || !(listing.getOwner().getId().equals(caller.userId())
                            || listing.getOwner().getId().equals(counterparty.getId()))) {
                throw refuse();
            }
        }
        if (!related(caller, counterparty.getId())) {
            throw refuse();
        }

        UUID me = caller.userId();
        UUID them = counterparty.getId();
        // Same ordering rule as the constructor and the V22 CHECK -- see Conversation.ordersFirst
        // for why UUID.compareTo is the wrong comparator here.
        boolean ordered = Conversation.ordersFirst(me, them);
        Optional<Conversation> existing = conversations.findPair(
                ordered ? me : them, ordered ? them : me, propertyId);

        Conversation conversation = existing.orElseGet(() ->
                conversations.saveAndFlush(new Conversation(me, them, propertyId, null)));
        thread.send(conversation, caller, body.body());
        if (existing.isEmpty()) {
            audit.record(caller, "conversation.started", "conversation",
                    conversation.getId().toString(),
                    "counterparty", them.toString(),
                    "property", propertyId == null ? null : propertyId.toString());
        }
        return new Started(mapper.toDetail(conversation, me), existing.isEmpty());
    }

    /** An approved contact request in either direction, or staff. See the class Javadoc. */
    private boolean related(AuthPrincipal caller, UUID counterpartyId) {
        if (Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role())) {
            return true;
        }
        return contactRequests.existsApprovedForOwner(
                        caller.userId(), counterpartyId, ContactRequestStatuses.APPROVED)
                || contactRequests.existsApprovedForOwner(
                        counterpartyId, caller.userId(), ContactRequestStatuses.APPROVED);
    }

    /**
     * The counterparty a listing names, for the buyer who has a {@code propertyId} and no mobile.
     *
     * <p>Every refusal here is {@link #refuse()}, and that is the point: an owner-less listing, an
     * archived owner, and the caller naming their own listing are three different situations, and
     * telling them apart would let a caller probe listings for whether they have a reachable owner.
     * The relationship guard in {@link #openOrResume} still runs afterwards, so reaching this method
     * successfully proves nothing on its own.
     *
     * <p>Archived owners are excluded to match {@code findByMobileAndArchivedFalse} on the other
     * branch — a derived counterparty must not be addressable when the same person, named by their
     * number, would not be.
     */
    private User ownerOf(Property listing, AuthPrincipal caller) {
        if (listing == null || listing.getOwner() == null) {
            throw refuse();
        }
        User owner = listing.getOwner();
        if (owner.isArchived() || owner.getId().equals(caller.userId())) {
            throw refuse();
        }
        return owner;
    }

    /**
     * The single refusal. Every rejected path in {@link #start} throws <em>this</em> — same status,
     * same message — so the response cannot be used to tell an unregistered number from a registered
     * stranger. A helper rather than a constant so each throw site gets its own stack.
     */
    private static ForbiddenException refuse() {
        return new ForbiddenException(
                "You can only message people you already have an approved contact with.");
    }

    /**
     * A conversation plus whether this call created it — the difference between 201 and 200, which
     * the service knows and the controller has to report.
     */
    public record Started(ConversationDto conversation, boolean created) {
    }
}
