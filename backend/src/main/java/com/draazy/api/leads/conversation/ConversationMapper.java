package com.draazy.api.leads.conversation;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.attachment.MessageAttachments;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.FlatmateGroupRoster;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactGateService;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public class ConversationMapper {

    private final ConversationMessageRepository messages;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final ContactRequestRepository contactRequests;
    private final ContactGateService contactGate;
    private final MessageAttachments attachments;
    private final FlatmateGroupRoster roster;
    private final ConversationRepository conversationRepository;
    private final MessageEvents events;

    public ConversationMapper(ConversationMessageRepository messages, UserRepository users,
            PropertyRepository properties, ContactRequestRepository contactRequests,
            ContactGateService contactGate, MessageAttachments attachments, FlatmateGroupRoster roster,
            ConversationRepository conversationRepository, MessageEvents events) {
        this.messages = messages;
        this.users = users;
        this.properties = properties;
        this.contactRequests = contactRequests;
        this.contactGate = contactGate;
        this.attachments = attachments;
        this.roster = roster;
        this.conversationRepository = conversationRepository;
        this.events = events;
    }

    public List<ConversationDto> toSummaries(List<Conversation> conversations, UUID readerId) {
        return project(conversations, readerId, Map.of());
    }

    public ConversationDto toDetail(Conversation conversation, UUID readerId) {
        List<ConversationMessage> thread =
                messages.findVisibleByConversationIdOrderByCreatedAtAsc(
                        conversation.getId(), readerId);
        return project(List.of(conversation), readerId,
                Map.of(conversation.getId(), thread)).getFirst();
    }

    private List<ConversationDto> project(List<Conversation> conversations, UUID readerId,
            Map<UUID, List<ConversationMessage>> threads) {
        if (conversations.isEmpty()) {
            return List.of();
        }
        Map<UUID, Long> unread = unreadByConversation(conversations, readerId);
        Map<UUID, UUID> latestAuthors = latestAuthors(conversations);

        Set<UUID> counterparties = conversations.stream()
                .map(c -> c.other(readerId))
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));

        // The thread's authors as well as the counterparties: a message needs a display name, and
        // on the detail read that includes the reader themselves.
        threads.values().forEach(thread ->
                thread.forEach(m -> counterparties.add(m.getAuthorId())));
        counterparties.add(readerId);
        Map<UUID, User> people = byId(users.findAllById(counterparties));

        Set<UUID> propertyIds = conversations.stream()
                .map(Conversation::getPropertyId)
                .filter(Objects::nonNull)
                .collect(Collectors.toCollection(HashSet::new));
        Map<UUID, Property> listings = new HashMap<>();
        if (!propertyIds.isEmpty()) {
            properties.findAllById(propertyIds).forEach(p -> listings.put(p.getId(), p));
        }
        Set<UUID> requesterIds = new HashSet<>(counterparties);
        requesterIds.add(readerId);
        Map<RequestKey, Boolean> approved = approved(propertyIds, requesterIds);
        Map<UUID, State> state = states(conversations, readerId);
        Blocks blocks = blocks(readerId, counterparties);
        Map<UUID, FlatmateGroupRoster.Summary> groups = roster.summaries(conversations.stream()
                .map(Conversation::getFlatmateGroupId)
                .filter(Objects::nonNull)
                .toList());

        return conversations.stream()
                .map(c -> {
                    User other = c.isGroup() ? null : people.get(c.other(readerId));
                    User reader = people.get(readerId);
                    Property listing = listings.get(c.getPropertyId());
                    FlatmateGroupRoster.Summary group = groups.get(c.getFlatmateGroupId());
                    State mine = state.getOrDefault(c.getId(), State.DEFAULT);
                    boolean available = listing != null && listing.isDirectlyReachable();
                    UUID latestAuthor = latestAuthors.get(c.getId());
                    ContactVisibility visibility = visibilityFor(readerId, other, listing, approved);
                    // Number and presence serve the open thread's header, not a hundred inbox rows.
                    boolean detail = threads.containsKey(c.getId());
                    return new ConversationDto(
                            c.getId().toString(),
                            c.isGroup() ? ConversationDto.GROUP : ConversationDto.DIRECT,
                            other == null ? null : other.getName(),
                            other == null ? null : other.getRole(),
                            other == null || !detail ? null : MobileMask.applyTo(other.getMobile(), visibility),
                            youAre(readerId, c, listing),
                            c.getPropertyId() == null ? null : c.getPropertyId().toString(),
                            listing == null ? null : listing.getTitle(),
                            available ? listing.getPrice() : null,
                            available ? listing.getDeal() : null,
                            available ? bhk(listing.getBhk()) : null,
                            available ? listing.getLocality() : null,
                            available ? cover(listing) : null,
                            available,
                            c.isGroup() ? c.getFlatmateGroupId().toString() : null,
                            group == null ? null : group.title(),
                            group == null ? null : group.memberCount(),
                            lastMessage(c.getLastMessage(), latestAuthor, readerId, visibility),
                            unread.getOrDefault(c.getId(), 0L),
                            c.getUpdatedAt(),
                            mine.archived(),
                            mine.muted(),
                            other != null && blocks.byReader().contains(other.getId()),
                            latestAuthor != null && !readerId.equals(latestAuthor),
                            detail ? presence(c, reader, other, other != null && blocks.eitherWay().contains(other.getId())) : null,
                            detail
                                    ? toMessages(c, threads.get(c.getId()), people, readerId,
                                            visibility == ContactVisibility.REVEALED, reader, other,
                                            other != null && blocks.eitherWay().contains(other.getId()))
                                    : null);
                })
                .toList();
    }

    private ContactVisibility visibilityFor(UUID readerId, User counterparty, Property listing,
            Map<RequestKey, Boolean> approved) {
        if (counterparty == null) {
            return ContactVisibility.MASKED;
        }
        if (listing == null || listing.getOwner() == null) {
            return ContactVisibility.MASKED;
        }
        UUID ownerId = listing.getOwner().getId();
        if (ownerId.equals(counterparty.getId())) {
            return contactGate.visibilityForKnownStatus(readerId, ownerId,
                    counterparty.isHideNumber(),
                    approved.getOrDefault(new RequestKey(listing.getId(), readerId), false));
        }
        if (ownerId.equals(readerId)) {
            return contactGate.approvedRequesterVisibility(readerId, counterparty.getId(),
                    approved.getOrDefault(new RequestKey(listing.getId(), counterparty.getId()), false));
        }
        return ContactVisibility.MASKED;
    }

    private Map<UUID, Long> unreadByConversation(List<Conversation> conversations, UUID readerId) {
        List<UUID> direct = conversations.stream().filter(c -> !c.isGroup()).map(Conversation::getId).toList();
        List<UUID> group = conversations.stream().filter(Conversation::isGroup).map(Conversation::getId).toList();
        Map<UUID, Long> counts = new HashMap<>();
        if (!direct.isEmpty()) {
            messages.unreadCounts(direct, readerId).forEach(row -> counts.put((UUID) row[0], (Long) row[1]));
        }
        if (!group.isEmpty()) {
            messages.groupUnreadCounts(group, readerId)
                    .forEach(row -> counts.put((UUID) row[0], ((Number) row[1]).longValue()));
        }
        return counts;
    }

    private Map<UUID, UUID> latestAuthors(List<Conversation> conversations) {
        Map<UUID, UUID> out = new HashMap<>();
        messages.latestAuthors(conversations.stream().map(Conversation::getId).toList())
                .forEach(row -> out.put((UUID) row[0], (UUID) row[1]));
        return out;
    }

    private List<MessageDto> toMessages(Conversation conversation, List<ConversationMessage> thread,
            Map<UUID, User> people, UUID readerId, boolean counterpartyRevealed,
            User reader, User other, boolean blockedEitherWay) {
        Map<UUID, List<MessageAttachmentDto>> files =
                attachments.byMessage(thread.stream().map(ConversationMessage::getId).toList());
        Map<UUID, ConversationMessage> byId = thread.stream()
                .collect(Collectors.toMap(ConversationMessage::getId, m -> m));
        return thread.stream()
                .map(m -> {
                    User author = people.get(m.getAuthorId());
                    MessageDto.ReplyTo replyTo = replyTo(m, byId, people, readerId,
                            counterpartyRevealed);
                    String body = readerId.equals(m.getAuthorId()) || counterpartyRevealed
                            ? m.getBody()
                            : MessageTextMask.body(m.getBody());
                    return new MessageDto(
                            m.getId().toString(),
                            readerId.equals(m.getAuthorId()),
                            author == null ? null : author.getName(),
                            body,
                            m.getCreatedAt(),
                            m.getClientId(),
                            replyTo,
                            !conversation.isGroup() && readerId.equals(m.getAuthorId()) && m.isRead()
                                    && !blockedEitherWay && shareReadReceipts(reader, other),
                            !conversation.isGroup() && readerId.equals(m.getAuthorId())
                                    && m.getDeliveredAt() != null,
                            files.getOrDefault(m.getId(), List.of()));
                })
                .toList();
    }

    private ConversationDto.Presence presence(Conversation conversation, User reader, User other,
            boolean blockedEitherWay) {
        if (conversation.isGroup() || reader == null || other == null
                || blockedEitherWay || !reader.isShareActivityStatus() || !other.isShareActivityStatus()) {
            return null;
        }
        return new ConversationDto.Presence(events.isOnline(other.getId()), other.getLastActive());
    }

    private static String lastMessage(String body, UUID authorId, UUID readerId, ContactVisibility visibility) {
        if (body == null || authorId == null || readerId.equals(authorId)
                || visibility == ContactVisibility.REVEALED) {
            return body;
        }
        return MessageTextMask.body(body);
    }

    private static boolean shareReadReceipts(User reader, User other) {
        return reader != null && other != null
                && reader.isShareReadReceipts() && other.isShareReadReceipts();
    }

    private Map<RequestKey, Boolean> approved(Set<UUID> propertyIds, Set<UUID> requesterIds) {
        if (propertyIds.isEmpty() || requesterIds.isEmpty()) {
            return Map.of();
        }
        Map<RequestKey, Boolean> out = new HashMap<>();
        contactRequests.approvedRequestersForProperties(
                        propertyIds, requesterIds, ContactRequestStatuses.APPROVED)
                .forEach(row -> out.put(new RequestKey((UUID) row[0], (UUID) row[1]), true));
        return out;
    }

    private Map<UUID, State> states(List<Conversation> conversations, UUID readerId) {
        List<UUID> ids = conversations.stream().map(Conversation::getId).toList();
        Map<UUID, State> out = new HashMap<>();
        conversationRepository.states(readerId, ids)
                .forEach(row -> out.put((UUID) row[0], new State((Boolean) row[1], (Boolean) row[2])));
        return out;
    }

    private Blocks blocks(UUID readerId, Set<UUID> counterparties) {
        if (counterparties.isEmpty()) {
            return new Blocks(Set.of(), Set.of());
        }
        Set<UUID> byReader = new HashSet<>();
        Set<UUID> eitherWay = new HashSet<>();
        conversationRepository.blocksFor(readerId, counterparties).forEach(row -> {
            UUID blocker = (UUID) row[0];
            UUID blocked = (UUID) row[1];
            if (readerId.equals(blocker)) {
                byReader.add(blocked);
                eitherWay.add(blocked);
            } else if (readerId.equals(blocked)) {
                eitherWay.add(blocker);
            }
        });
        return new Blocks(byReader, eitherWay);
    }

    private static String youAre(UUID readerId, Conversation conversation, Property listing) {
        if (conversation.isGroup()) {
            return "member";
        }
        return listing != null && listing.getOwner() != null
                && listing.getOwner().getId().equals(readerId) ? "owner" : "buyer";
    }

    private static String bhk(BigDecimal value) {
        return value == null ? null : value.stripTrailingZeros().toPlainString() + " BHK";
    }

    private static String cover(Property listing) {
        if (listing.getCoverImage() != null && !listing.getCoverImage().isBlank()) {
            return listing.getCoverImage();
        }
        return listing.getImages().isEmpty() ? null : listing.getImages().getFirst();
    }

    private static MessageDto.ReplyTo replyTo(ConversationMessage message,
            Map<UUID, ConversationMessage> byId, Map<UUID, User> people, UUID readerId,
            boolean counterpartyRevealed) {
        if (message.getReplyToId() == null) {
            return null;
        }
        ConversationMessage parent = byId.get(message.getReplyToId());
        if (parent == null) {
            return null;
        }
        User author = people.get(parent.getAuthorId());
        String body = readerId.equals(parent.getAuthorId()) || counterpartyRevealed
                ? parent.getBody()
                : MessageTextMask.body(parent.getBody());
        String preview = body.length() <= 120 ? body : body.substring(0, 119).strip() + "…";
        return new MessageDto.ReplyTo(parent.getId().toString(),
                author == null ? null : author.getName(), preview);
    }

    private static Map<UUID, User> byId(Iterable<User> loaded) {
        Map<UUID, User> byId = new HashMap<>();
        loaded.forEach(u -> byId.put(u.getId(), u));
        return byId;
    }

    private record RequestKey(UUID propertyId, UUID requesterId) {
    }

    private record State(boolean archived, boolean muted) {
        static final State DEFAULT = new State(false, false);
    }

    private record Blocks(Set<UUID> byReader, Set<UUID> eitherWay) {
    }
    }
