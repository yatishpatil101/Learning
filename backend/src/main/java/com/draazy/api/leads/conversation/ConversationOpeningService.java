package com.draazy.api.leads.conversation;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.trust.FlatmateRequestParties;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

// `ConversationService` owns the thread afterwards: the inbox, the replies, the attachments, the read marks.
// This one owns the admission decision — the relationship guard, the counterparty derivation.
@Service
public class ConversationOpeningService {

    private static final Logger log = LoggerFactory.getLogger(ConversationOpeningService.class);

    // Named constraints let us distinguish business conflicts from schema defects.
    private static final String PAIR_PROPERTY_INDEX = "uq_conversations_pair_property";
    private static final String PAIR_GENERAL_INDEX = "uq_conversations_pair_general";

    private final LongAdder racesRetried = new LongAdder();

    private final ConversationRepository conversations;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;
    private final FlatmateRequestParties flatmateRequests;
    private final AuditService audit;

    // The thread itself, for the one thing opening cannot do alone: put the caller's first message in it.
    private final ConversationService thread;

    private final TransactionTemplate transactions;

    public ConversationOpeningService(ConversationRepository conversations,
            ConversationMapper mapper, UserRepository users, PropertyRepository properties,
            ContactRequestRepository contactRequests, FlatmateRequestParties flatmateRequests,
            AuditService audit,
            ConversationService thread, PlatformTransactionManager transactionManager) {
        this.conversations = conversations;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
        this.flatmateRequests = flatmateRequests;
        this.audit = audit;
        this.thread = thread;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public Started start(AuthPrincipal caller, ConversationCreate body) {
        return retryingPairRace(caller, () -> openOrResume(caller, body));
    }

    public ConversationDto openForFlatmateRequest(AuthPrincipal caller, String requestId) {
        UUID them = Ids.parseUuid(requestId)
                .flatMap(id -> flatmateRequests.acceptedCounterparty(id, caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Flatmate chat"));
        return retryingPairRace(caller, () -> findOrCreatePair(caller, them));
    }

    private <T> T retryingPairRace(AuthPrincipal caller, Supplier<T> attempt) {
        try {
            return transactions.execute(tx -> attempt.get());
        } catch (DataIntegrityViolationException raced) {
            if (!isPairRace(raced) || TransactionSynchronizationManager.isActualTransactionActive()) {

                // Not our collision, or we are inside somebody else's transaction and a retry
                // cannot work. Either way the honest answer is the one the client already had.
                throw raced;
            }
            log.info("Concurrent first message lost the conversation find-or-create race for {};"
                    + " handing over the thread the winner created", caller.userId());
            racesRetried.increment();
            return transactions.execute(tx -> attempt.get());
        }
    }

    private ConversationDto findOrCreatePair(AuthPrincipal caller, UUID them) {
        UUID me = caller.userId();
        boolean ordered = Conversation.ordersFirst(me, them);
        Optional<Conversation> existing = conversations.findPair(
                ordered ? me : them, ordered ? them : me, null);
        Conversation conversation = existing.orElseGet(() ->
                conversations.saveAndFlush(new Conversation(me, them, null, null)));
        if (existing.isEmpty()) {
            audit.record(caller, "conversation.started", "conversation",
                    conversation.getId().toString(), "counterparty", them.toString());
        }
        return mapper.toSummaries(List.of(conversation), me).getFirst();
    }

    // A test that cannot tell those apart silently stops testing this method the first time the timing shifts.
    // Race tests need to distinguish an actual retry from accidental serialization.
    long racesRetried() {
        return racesRetried.sum();
    }

    // Anything else (a foreign key, a not-null, the ordering CHECK) is a bug in this method.
    private static boolean isPairRace(DataIntegrityViolationException violation) {
        return ConstraintViolations.isOn(violation, PAIR_PROPERTY_INDEX)
                || ConstraintViolations.isOn(violation, PAIR_GENERAL_INDEX);
    }

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

        // Same ordering rule as the constructor and the the database CHECK -- see Conversation.ordersFirst
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

    private boolean related(AuthPrincipal caller, UUID counterpartyId) {
        if (Roles.isBackOffice(caller.role())) {
            return true;
        }
        return contactRequests.existsApprovedForOwner(
                        caller.userId(), counterpartyId, ContactRequestStatuses.APPROVED)
                || contactRequests.existsApprovedForOwner(
                        counterpartyId, caller.userId(), ContactRequestStatuses.APPROVED);
    }

    // The relationship guard still runs later; this lookup proves nothing alone.
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

    // All start refusals share one response to avoid user enumeration.
    private static ForbiddenException refuse() {
        return new ForbiddenException(
                "You can only message people you already have an approved contact with.");
    }

    public record Started(ConversationDto conversation, boolean created) {
    }
}
