package com.punenest.api.leads.conversation;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.attachment.MessageAttachmentDto;
import com.punenest.api.common.attachment.MessageAttachments;
import com.punenest.api.common.attachment.MessageSurfaces;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.persistence.ConstraintViolations;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

/**
 * In-app messaging between two people.
 *
 * <p><strong>The relationship guard is the whole feature.</strong> An endpoint that accepts a mobile
 * number and opens a chat is, without a guard, two things nobody asked for: a way to test a list of
 * numbers against the user base (the answers differ, so the answer <em>is</em> the oracle) and a
 * channel for sending strangers unsolicited messages. {@link #start} therefore requires that the two
 * parties already have business together — an approved contact request in one direction or the other
 * — and refuses everything else <em>identically</em>, whether the number belongs to nobody, belongs
 * to someone unrelated, or belongs to the caller.
 *
 * <p>Note the deliberate contrast with {@code FinalizationService}, which answers 422 when a
 * counterparty mobile resolves to no registered user. That is correct there and would be wrong here:
 * finalization is reachable only by the owner of the listing being finalised, so the caller has
 * already been established as a party to the deal and the number they typed is one they were given.
 * Here the caller is anyone with an account and the number is anything at all. Same-looking input,
 * different threat, different answer — do not "make them consistent".
 *
 * <p><strong>Non-participation is a 404, not a 403.</strong> On {@link #get}, {@link #reply} and
 * {@link #markRead} the thread id is the secret; answering 403 would confirm that a conversation
 * with that id exists.
 *
 * <p>Masking is not relaxed by being in a thread — see {@link ConversationMapper}.
 */
@Service
public class ConversationService {

    private static final Logger log = LoggerFactory.getLogger(ConversationService.class);

    /** Notification body cap. Two rendered lines in the inbox; anything more is thread content. */
    private static final int PREVIEW_CHARS = 140;

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
    private final ConversationMessageRepository messages;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;
    private final Notifier notifier;
    private final AuditService audit;
    private final MessageAttachments attachments;

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

    public ConversationService(ConversationRepository conversations,
            ConversationMessageRepository messages, ConversationMapper mapper,
            UserRepository users, PropertyRepository properties,
            ContactRequestRepository contactRequests, Notifier notifier,
            AuditService audit, MessageAttachments attachments,
            PlatformTransactionManager transactionManager) {
        this.conversations = conversations;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
        this.notifier = notifier;
        this.audit = audit;
        this.attachments = attachments;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /**
     * {@code GET /messages} — the caller's inbox, most recent first, threads omitted, paged.
     *
     * <p>Paged despite being caller-scoped. The controller used to justify a bare array with
     * §5.1's "grows with one user's own activity" test, and for a seeker that is true; for an owner
     * it is not, because a row appears every time <em>someone else</em> enquires. The endpoint whose
     * size is driven by demand rather than by the caller's clicks is exactly the one that gets large
     * when a listing does well.
     */
    @Transactional(readOnly = true)
    public Page<ConversationDto> inbox(AuthPrincipal caller, Pageable pageable) {
        Page<Conversation> page = conversations.inboxOf(caller.userId(), pageable);
        List<ConversationDto> content = mapper.toSummaries(page.getContent(), caller.userId());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    /** {@code GET /messages/{id}} — one thread. A non-participant gets the same 404 as a stranger. */
    @Transactional(readOnly = true)
    public ConversationDto get(AuthPrincipal caller, String id) {
        return mapper.toDetail(mine(caller, id), caller.userId());
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
     * a normal result. Same argument as {@code RentService}: mistaking someone else's constraint for
     * ours hides a defect behind a reassuring answer.
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
     */
    private Started openOrResume(AuthPrincipal caller, ConversationCreate body) {
        User counterparty = users.findByMobileAndArchivedFalse(
                        MobileMask.normalise(body.counterpartyMobile()))
                .filter(u -> !u.getId().equals(caller.userId()))
                .orElseThrow(ConversationService::refuse);
        UUID propertyId = body.propertyId() == null || body.propertyId().isBlank()
                ? null
                : Ids.parseUuid(body.propertyId()).orElseThrow(ConversationService::refuse);
        if (propertyId != null) {
            Property listing = properties.findById(propertyId)
                    .orElseThrow(ConversationService::refuse);
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
        send(conversation, caller, body.body());
        if (existing.isEmpty()) {
            audit.record(caller, "conversation.started", "conversation",
                    conversation.getId().toString(),
                    "counterparty", them.toString(),
                    "property", propertyId == null ? null : propertyId.toString());
        }
        return new Started(mapper.toDetail(conversation, me), existing.isEmpty());
    }

    /**
     * {@code POST /messages/{id}/reply} — 201 with the message as sent.
     *
     * <p>{@code attachmentIds} names uploads the caller already made against this thread (D49).
     * They are bound <em>after</em> {@link #mine} has answered, so a stranger never gets as far as
     * touching an attachment row, and inside the same transaction as the message, so a reply that
     * names an attachment it may not have leaves neither behind.
     */
    @Transactional
    public MessageDto reply(AuthPrincipal caller, String id, String body, List<String> attachmentIds) {
        Conversation conversation = mine(caller, id);
        ConversationMessage sent = send(conversation, caller, body);
        User author = users.findById(caller.userId()).orElse(null);
        return new MessageDto(
                sent.getId().toString(),
                sent.getAuthorId().toString(),
                author == null ? null : author.getName(),
                sent.getAuthorRole(),
                sent.getBody(),
                sent.getCreatedAt(),
                attachments.bind(conversation.getId(), caller.userId(), sent.getId(), attachmentIds));
    }

    /**
     * {@code POST /messages/{id}/attachments} — 201 with the stored attachment.
     *
     * <p>Guarded by {@link #mine} and nothing else: an upload endpoint on a thread is exactly as
     * private as the thread, so the participant rule decides here too. Note this deliberately does
     * <em>not</em> go through the moderation read — a moderator may read a conversation (D53) but
     * may not post into one.
     */
    @Transactional
    public MessageAttachmentDto attach(AuthPrincipal caller, String id, MultipartFile file) {
        Conversation conversation = mine(caller, id);
        return attachments.upload(MessageSurfaces.CONVERSATION, conversation.getId(),
                caller.userId(), file);
    }

    /**
     * {@code POST /messages/{id}/read} — 204.
     *
     * <p>Idempotent: marking an already-read thread updates nothing and still answers 204. The
     * client polls this on opening a thread, so "no change" must not be an error.
     */
    @Transactional
    public void markRead(AuthPrincipal caller, String id) {
        messages.markRead(mine(caller, id).getId(), caller.userId());
    }

    /** The one place a message is written, so the preview and {@code updatedAt} cannot fall behind. */
    private ConversationMessage send(Conversation conversation, AuthPrincipal author, String body) {
        ConversationMessage message = messages.saveAndFlush(new ConversationMessage(
                conversation.getId(), author.userId(), author.role(), body));
        conversation.setLastMessage(body);
        conversations.saveAndFlush(conversation);
        notifyRecipient(conversation, author, body);
        return message;
    }

    /**
     * Tell the other participant a message arrived.
     *
     * <p>Messaging had no notification writer at all, which made the inbox that ships alongside it
     * near-useless: until now the only code in the platform creating a notification was the flatmate
     * family, so a buyer who had never touched flatmates saw an empty inbox no matter how much
     * activity their listings generated (tech-debt D92). A new message is the most obvious thing a
     * person wants to be told about, and this is where every message is written.
     *
     * <p><strong>Through the {@link Notifier} port, not the notification repository.</strong>
     * Notifications live in {@code engagement}, which ranks at the same layer as {@code leads}, so
     * importing it directly is a same-rank reference and a cycle. {@code ArchitectureBoundaryTest}
     * caught exactly that on the first full run — the port is the codebase's existing answer, the
     * same one {@code ContactGate} uses for the contact reveal.
     *
     * <p><strong>Same transaction as the message, deliberately.</strong> The two facts are one event:
     * a message nobody was told about is a message that did not arrive.
     *
     * <p>The body is truncated rather than sent whole: a notification is a summons to the thread,
     * not a copy of it, and a 4,000-character message would otherwise arrive in full in a list the
     * UI renders two lines of.
     */
    private void notifyRecipient(Conversation conversation, AuthPrincipal author, String body) {
        UUID recipient = conversation.other(author.userId());
        if (recipient == null || recipient.equals(author.userId())) {
            return;
        }
        String senderName = users.findById(author.userId())
                .map(User::getName)
                .filter(n -> !n.isBlank())
                .orElse("Someone");
        notifier.notify(recipient, "message.received",
                senderName + " sent you a message", preview(body), "/messages");
    }

    /** First line, capped — enough to recognise the thread, not enough to replace opening it. */
    private static String preview(String body) {
        if (body == null) {
            return "";
        }
        String firstLine = body.strip().lines().findFirst().orElse("");
        return firstLine.length() <= PREVIEW_CHARS
                ? firstLine
                : firstLine.substring(0, PREVIEW_CHARS - 1).strip() + "…";
    }

    /**
     * Load a conversation the caller participates in, or 404.
     *
     * <p>Staff and admin are <em>not</em> exempt here, unlike almost every other read in the system.
     * A private chat between a buyer and an owner is not an ops surface, and nothing in the contract
     * asks for one; if moderation ever needs it, it should arrive as its own audited endpoint rather
     * than as a silent role check inside the participant guard.
     */
    private Conversation mine(AuthPrincipal caller, String id) {
        return Ids.parseUuid(id)
                .flatMap(conversations::findById)
                .filter(c -> c.involves(caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Conversation"));
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
