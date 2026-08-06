package com.punenest.api.leads.conversation;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.contact.ContactRequestRepository;
import com.punenest.api.leads.contact.ContactRequestStatuses;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for the inbox, from the point of view of one reader.
 *
 * <p><strong>Every field is relative to the reader</strong>, so the reader id is a parameter of
 * every method rather than something the mapper could forget to ask for. The same row projected for
 * the other participant is a different document — different counterparty, different unread count,
 * and possibly a different mobile.
 *
 * <p><strong>Batch-loaded.</strong> The inbox is a list, and each row needs a counterparty name, a
 * property title, an unread count and a gate decision. Done per row that is four queries per
 * conversation; done here it is four queries per <em>inbox</em>, whatever its size.
 *
 * <p><strong>The masking rule is ADR-019's, unchanged.</strong> An approved contact request reveals
 * the <em>owner's</em> number to the buyer who asked for it — never the other way round. So the
 * reveal test is not "are these two in a conversation" (which would make opening a thread a way
 * around the contact gate) but "does the reader hold an approved request against a listing the
 * counterparty owns". Everything else masks, including staff and admin readers: nobody has asked
 * for a support surface here, and a default of "mask" costs nothing until they do.
 */
@Component
public class ConversationMapper {

    private final ConversationMessageRepository messages;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;

    public ConversationMapper(ConversationMessageRepository messages, UserRepository users,
            PropertyRepository properties, ContactRequestRepository contactRequests) {
        this.messages = messages;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
    }

    /** The inbox: no threads, one unread count each. */
    public List<ConversationDto> toSummaries(List<Conversation> conversations, UUID readerId) {
        return project(conversations, readerId, Map.of());
    }

    /** The detail: the same projection plus the thread, oldest first. */
    public ConversationDto toDetail(Conversation conversation, UUID readerId) {
        List<ConversationMessage> thread =
                messages.findByConversationIdOrderByCreatedAtAsc(conversation.getId());
        return project(List.of(conversation), readerId,
                Map.of(conversation.getId(), thread)).getFirst();
    }

    private List<ConversationDto> project(List<Conversation> conversations, UUID readerId,
            Map<UUID, List<ConversationMessage>> threads) {
        if (conversations.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = conversations.stream().map(Conversation::getId).toList();
        Map<UUID, Long> unread = unreadByConversation(ids, readerId);

        Set<UUID> counterparties = conversations.stream()
                .map(c -> c.other(readerId))
                .collect(Collectors.toCollection(HashSet::new));
        // The thread's authors as well as the counterparties: a message needs a display name, and
        // on the detail read that includes the reader themselves.
        threads.values().forEach(thread ->
                thread.forEach(m -> counterparties.add(m.getAuthorId())));
        Map<UUID, User> people = byId(users.findAllById(counterparties));

        Set<UUID> propertyIds = conversations.stream()
                .map(Conversation::getPropertyId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, Property> listings = new HashMap<>();
        if (!propertyIds.isEmpty()) {
            properties.findAllById(propertyIds).forEach(p -> listings.put(p.getId(), p));
        }

        return conversations.stream()
                .map(c -> {
                    User other = people.get(c.other(readerId));
                    Property listing = listings.get(c.getPropertyId());
                    return new ConversationDto(
                            c.getId().toString(),
                            other == null ? null : other.getName(),
                            other == null ? null : other.getRole(),
                            mobileFor(readerId, other, listing),
                            c.getPropertyId() == null ? null : c.getPropertyId().toString(),
                            listing == null ? null : listing.getTitle(),
                            c.getLastMessage(),
                            unread.getOrDefault(c.getId(), 0L),
                            c.getUpdatedAt(),
                            threads.containsKey(c.getId())
                                    ? toMessages(threads.get(c.getId()), people)
                                    : null);
                })
                .toList();
    }

    /**
     * The gate decision for one row.
     *
     * <p>Only one shape reveals: the counterparty owns the listing this thread is about, and the
     * reader holds an approved contact request against it. A thread with no listing always masks —
     * there is no gate to have passed.
     */
    private String mobileFor(UUID readerId, User counterparty, Property listing) {
        if (counterparty == null) {
            return null;
        }
        boolean revealed = listing != null
                && listing.getOwner() != null
                && listing.getOwner().getId().equals(counterparty.getId())
                && contactRequests.existsByRequesterIdAndPropertyIdAndStatus(
                        readerId, listing.getId(), ContactRequestStatuses.APPROVED);
        return MobileMask.applyTo(counterparty.getMobile(),
                revealed ? ContactVisibility.REVEALED : ContactVisibility.MASKED);
    }

    private Map<UUID, Long> unreadByConversation(List<UUID> ids, UUID readerId) {
        Map<UUID, Long> counts = new HashMap<>();
        for (Object[] row : messages.unreadCounts(ids, readerId)) {
            counts.put((UUID) row[0], (Long) row[1]);
        }
        return counts;
    }

    private static List<MessageDto> toMessages(List<ConversationMessage> thread,
            Map<UUID, User> people) {
        return thread.stream()
                .map(m -> {
                    User author = people.get(m.getAuthorId());
                    return new MessageDto(
                            m.getId().toString(),
                            m.getAuthorId().toString(),
                            author == null ? null : author.getName(),
                            m.getAuthorRole(),
                            m.getBody(),
                            m.getCreatedAt());
                })
                .toList();
    }

    private static Map<UUID, User> byId(Iterable<User> loaded) {
        Map<UUID, User> byId = new HashMap<>();
        loaded.forEach(u -> byId.put(u.getId(), u));
        return byId;
    }
}
