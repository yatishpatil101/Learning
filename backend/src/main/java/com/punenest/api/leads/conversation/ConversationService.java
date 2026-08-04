package com.punenest.api.leads.conversation;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.MobileMask;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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

    private final ConversationRepository conversations;
    private final ConversationMessageRepository messages;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;
    private final AuditService audit;

    public ConversationService(ConversationRepository conversations,
            ConversationMessageRepository messages, ConversationMapper mapper,
            UserRepository users, PropertyRepository properties,
            ContactRequestRepository contactRequests, AuditService audit) {
        this.conversations = conversations;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
        this.audit = audit;
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
     */
    @Transactional
    public Started start(AuthPrincipal caller, ConversationCreate body) {
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

    /** {@code POST /messages/{id}/reply} — 201 with the message as sent. */
    @Transactional
    public MessageDto reply(AuthPrincipal caller, String id, String body) {
        Conversation conversation = mine(caller, id);
        ConversationMessage sent = send(conversation, caller, body);
        User author = users.findById(caller.userId()).orElse(null);
        return new MessageDto(
                sent.getId().toString(),
                author == null ? null : author.getName(),
                sent.getAuthorRole(),
                sent.getBody(),
                sent.getCreatedAt());
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
        return message;
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
