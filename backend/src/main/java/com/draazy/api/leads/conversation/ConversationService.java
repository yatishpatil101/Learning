package com.draazy.api.leads.conversation;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.attachment.MessageAttachment;
import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.attachment.MessageAttachmentRepository;
import com.draazy.api.common.attachment.MessageAttachments;
import com.draazy.api.common.trust.FlatmateGroupRoster;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.PushNotifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class ConversationService {

    private static final int PREVIEW_CHARS = 140;

    private final ConversationRepository conversations;
    private final ConversationMessageRepository messages;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final Notifier notifier;
    private final FlatmateGroupRoster roster;
    private final MessageEvents events;
    private final MessageAttachmentRepository attachmentRepository;
    private final MessageAttachments attachments;
    private final FileStorage storage;
    private final PushNotifier push;

    public ConversationService(ConversationRepository conversations,
            ConversationMessageRepository messages, ConversationMapper mapper,
            UserRepository users, Notifier notifier,
            FlatmateGroupRoster roster, MessageEvents events,
            MessageAttachmentRepository attachmentRepository, MessageAttachments attachments,
            FileStorage storage, PushNotifier push) {
        this.conversations = conversations;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.notifier = notifier;
        this.roster = roster;
        this.events = events;
        this.attachmentRepository = attachmentRepository;
        this.attachments = attachments;
        this.storage = storage;
        this.push = push;
    }

    // They are bound after `#mine` has answered, so a stranger never gets as far as touching an attachment row.
    @Transactional
    public Page<ConversationDto> inbox(AuthPrincipal caller, Pageable pageable) {
        events.delivered(caller.userId(), messages.markInboxDelivered(caller.userId()));
        List<UUID> groups = roster.groupsOf(caller.userId());
        Page<Conversation> page = groups.isEmpty()
                ? conversations.inboxOf(caller.userId(), pageable)
                : conversations.inboxWithGroups(caller.userId(), groups, pageable);
        List<ConversationDto> content = mapper.toSummaries(page.getContent(), caller.userId());
        return new PageImpl<>(content, page.getPageable(), page.getTotalElements());
    }

    // Moderation reads do not grant posting rights.
    @Transactional
    public ConversationDto openGroup(AuthPrincipal caller, String groupId) {
        UUID group = Ids.parseUuid(groupId)
                .filter(g -> roster.isMember(g, caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Group chat"));
        conversations.insertGroupIfAbsent(group);
        Conversation conversation = conversations.findByFlatmateGroupId(group).orElseThrow();
        return mapper.toSummaries(List.of(conversation), caller.userId()).getFirst();
    }

    @Transactional
    public ConversationDto get(AuthPrincipal caller, String id) {
        Conversation conversation = mine(caller, id);
        markDelivered(conversation, caller.userId());
        return mapper.toDetail(conversation, caller.userId());
    }

    @Transactional(readOnly = true)
    public UnreadCount unreadCount(AuthPrincipal caller) {
        long direct = conversations.directUnreadCount(caller.userId());
        List<UUID> groups = roster.groupsOf(caller.userId());
        long group = groups.isEmpty() ? 0L : conversations.groupUnreadCount(caller.userId(), groups);
        return new UnreadCount(direct + group);
    }

    @Transactional
    public SseEmitter stream(AuthPrincipal caller) {
        events.delivered(caller.userId(), messages.markInboxDelivered(caller.userId()));
        return events.stream(caller.userId());
    }

    @Transactional
    public Sent reply(AuthPrincipal caller, String id, ReplyCreate body) {
        Conversation conversation = mine(caller, id);
        String clientId = normalize(body.clientId());
        if (clientId != null) {
            var existing = messages.findByConversationIdAndAuthorIdAndClientId(
                    conversation.getId(), caller.userId(), clientId);
            if (existing.isPresent()) {
                return new Sent(toMessage(conversation, existing.get(), caller.userId()), false);
            }
        }
        UUID replyToId = parseReplyTo(conversation, body.replyToId());
        Written sent = write(conversation, caller, body.body(), clientId, replyToId);
        return new Sent(toMessage(conversation, sent.message(), caller.userId()), sent.created());
    }

    @Transactional
    public Sent photo(AuthPrincipal caller, String id, PhotoCreate body) {
        Conversation conversation = mine(caller, id);
        String clientId = normalize(body.clientId());
        if (clientId != null) {
            var existing = messages.findByConversationIdAndAuthorIdAndClientId(
                    conversation.getId(), caller.userId(), clientId);
            if (existing.isPresent()) {
                return new Sent(toMessage(conversation, existing.get(), caller.userId()), false);
            }
        }
        guardWritable(conversation, caller);
        Written sent = write(conversation, caller, normalizeCaption(body.caption()), clientId, null);
        if (!sent.created()) {
            return new Sent(toMessage(conversation, sent.message(), caller.userId()), false);
        }
        MessagePhotoUpload.Processed photo = MessagePhotoUpload.process(conversation.getId(), body.file());
        storage.store(photo.storageKey(), photo.bytes(), photo.contentType());
        attachmentRepository.saveAndFlush(MessageAttachment.conversationPhoto(
                conversation.getId(), sent.message().getId(), caller.userId(), photo.storageKey(),
                photo.contentType(), photo.bytes().length, photo.fileName()));
        return new Sent(toMessage(conversation, sent.message(), caller.userId()), sent.created());
    }

    @Transactional
    public void markRead(AuthPrincipal caller, String id) {
        Conversation conversation = mine(caller, id);
        int changed;
        if (conversation.isGroup()) {
            changed = messages.markGroupRead(conversation.getId(), caller.userId());
        } else {
            markDelivered(conversation, caller.userId());
            changed = messages.markRead(conversation.getId(), caller.userId());
        }
        notifier.markRead(caller.userId(), "message.received", link(conversation));
        if (changed > 0) {
            events.read(conversation, caller.userId());
        }
    }

    @Transactional
    public void typing(AuthPrincipal caller, String id) {
        Conversation conversation = mine(caller, id);
        if (!conversation.isGroup()
                && conversations.blockedEitherWay(caller.userId(), conversation.other(caller.userId()))) {
            return;
        }
        events.typing(conversation, caller.userId());
    }

    @Transactional
    public void updateState(AuthPrincipal caller, String id, ThreadState body) {
        Conversation conversation = mine(caller, id);
        conversations.upsertState(conversation.getId(), caller.userId(), body.archived(), body.muted());
    }

    @Transactional
    public void deleteForMe(AuthPrincipal caller, String id, String messageId) {
        Conversation conversation = mine(caller, id);
        UUID parsed = Ids.parseUuid(messageId)
                .orElseThrow(() -> NotFoundException.of("Message"));
        messages.findByIdAndConversationId(parsed, conversation.getId())
                .orElseThrow(() -> NotFoundException.of("Message"));
        messages.hideForUser(conversation.getId(), parsed, caller.userId());
    }

    @Transactional
    public void block(AuthPrincipal caller, String id) {
        Conversation conversation = pair(caller, id);
        conversations.block(caller.userId(), conversation.other(caller.userId()));
    }

    @Transactional
    public void unblock(AuthPrincipal caller, String id) {
        Conversation conversation = pair(caller, id);
        conversations.unblock(caller.userId(), conversation.other(caller.userId()));
    }

    // The one place a message is written, so the preview and `updatedAt` cannot fall behind.
    ConversationMessage send(Conversation conversation, AuthPrincipal author, String body) {
        return send(conversation, author, body, null, null);
    }

    ConversationMessage send(Conversation conversation, AuthPrincipal author, String body,
            String clientId, UUID replyToId) {
        return write(conversation, author, body, clientId, replyToId).message();
    }

    private Written write(Conversation conversation, AuthPrincipal author, String body,
            String clientId, UUID replyToId) {
        guardWritable(conversation, author);
        ConversationMessage message;
        if (clientId == null) {
            message = messages.saveAndFlush(new ConversationMessage(
                    conversation.getId(), author.userId(), author.role(), body, null, replyToId));
        } else {
            int inserted = messages.insertWithClientId(conversation.getId(), author.userId(),
                    author.role(), body, clientId, replyToId);
            message = messages.findByConversationIdAndAuthorIdAndClientId(
                            conversation.getId(), author.userId(), clientId)
                    .orElseThrow();
            if (inserted == 0) {
                return new Written(message, false);
            }
        }
        // The stream hands it over, so the badge's unread-count read need not write delivery.
        if (!conversation.isGroup() && events.isOnline(conversation.other(author.userId()))) {
            message.markDelivered();
        }
        conversation.setLastMessage(body);
        conversations.saveAndFlush(conversation);
        conversations.unarchiveOthers(conversation.getId(), author.userId());
        notifyRecipient(conversation, author, body);
        events.messageCreated(conversation, author.userId());
        return new Written(message, true);
    }

    private void notifyRecipient(Conversation conversation, AuthPrincipal author, String body) {
        String senderName = users.findById(author.userId())
                .map(User::getName)
                .filter(n -> !n.isBlank())
                .orElse("Someone");
        if (conversation.isGroup()) {
            notifyGroup(conversation, author, senderName, body);
            return;
        }
        UUID recipient = conversation.other(author.userId());
        if (recipient == null || recipient.equals(author.userId())) {
            return;
        }
        // One bell row per unread run, as notifyGroup does; reading the chat clears it via markRead.
        if (unreadFor(conversation, recipient) == 1) {
            notifier.notify(recipient, "message.received",
                    senderName + " sent you a message", preview(body), link(conversation));
        }
        schedulePush(recipient, conversation);
    }

    private long unreadFor(Conversation conversation, UUID reader) {
        return messages.unreadCounts(List.of(conversation.getId()), reader).stream()
                .mapToLong(row -> ((Number) row[1]).longValue())
                .sum();
    }

    private void notifyGroup(Conversation conversation, AuthPrincipal author, String senderName,
            String body) {
        UUID groupId = conversation.getFlatmateGroupId();
        FlatmateGroupRoster.Summary group = roster.summaries(List.of(groupId)).get(groupId);
        String title = senderName + " in " + (group == null ? "your group" : group.title());
        String link = "/messages?c=" + conversation.getId();
        for (UUID member : roster.memberIds(groupId)) {
            if (member.equals(author.userId())) {
                continue;
            }
            long unread = messages.groupUnreadCounts(List.of(conversation.getId()), member).stream()
                    .mapToLong(row -> ((Number) row[1]).longValue())
                    .sum();
            if (unread == 1) {
                notifier.notify(member, "message.received", title, preview(body), link);
                schedulePush(member, conversation);
            }
        }
    }

    private void schedulePush(UUID recipient, Conversation conversation) {
        events.afterCommit(() -> pushIfUnmuted(recipient, conversation));
    }

    private void pushIfUnmuted(UUID recipient, Conversation conversation) {
        if (!conversations.muted(conversation.getId(), recipient) && !events.isOnline(recipient)) {
            push.messageReceived(recipient, conversation.getId());
        }
    }

    private static String preview(String body) {
        if (body == null) {
            return "";
        }
        String firstLine = MessageTextMask.notification(body.strip().lines().findFirst().orElse(""));
        return firstLine.length() <= PREVIEW_CHARS
                ? firstLine
                : firstLine.substring(0, PREVIEW_CHARS - 1).strip() + "…";
    }

    // Private buyer-owner chat is not an ops surface unless the contract adds one.
    private Conversation mine(AuthPrincipal caller, String id) {
        return Ids.parseUuid(id)
                .flatMap(conversations::findById)
                .filter(c -> c.isGroup()
                        ? roster.isMember(c.getFlatmateGroupId(), caller.userId())
                        : c.involves(caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Conversation"));
    }

    private Conversation pair(AuthPrincipal caller, String id) {
        Conversation conversation = mine(caller, id);
        if (conversation.isGroup()) {
            throw new BadRequestException("Group conversations cannot be blocked");
        }
        return conversation;
    }

    private void guardWritable(Conversation conversation, AuthPrincipal author) {
        if (conversation.isGroup()) {
            return;
        }
        UUID other = conversation.other(author.userId());
        if (conversations.blockedEitherWay(author.userId(), other)) {
            throw new ForbiddenException("You can't message this user");
        }
        if (!messages.existsByConversationIdAndAuthorId(conversation.getId(), other)
                && messages.countByConversationIdAndAuthorIdAndCreatedAtAfter(
                        conversation.getId(), author.userId(),
                        Instant.now().minus(1, ChronoUnit.HOURS)) >= 20) {
            throw new RateLimitedException("Please wait before sending another message.", 3600);
        }
    }

    private UUID parseReplyTo(Conversation conversation, String id) {
        String value = normalize(id);
        if (value == null) {
            return null;
        }
        UUID parsed = Ids.parseUuid(value).orElseThrow(() ->
                new BadRequestException("replyToId must be a message in this conversation"));
        messages.findByIdAndConversationId(parsed, conversation.getId())
                .orElseThrow(() ->
                        new BadRequestException("replyToId must be a message in this conversation"));
        return parsed;
    }

    private MessageDto toMessage(Conversation conversation, ConversationMessage message, UUID viewerId) {
        User author = users.findById(message.getAuthorId()).orElse(null);
        MessageDto.ReplyTo replyTo = null;
        if (message.getReplyToId() != null) {
            replyTo = messages.findById(message.getReplyToId()).map(parent -> {
                User parentAuthor = users.findById(parent.getAuthorId()).orElse(null);
                String body = viewerId.equals(parent.getAuthorId())
                        ? parent.getBody()
                        : MessageTextMask.body(parent.getBody());
                String preview = body.length() <= 120 ? body : body.substring(0, 119).strip() + "…";
                return new MessageDto.ReplyTo(parent.getId().toString(),
                        parentAuthor == null ? null : parentAuthor.getName(), preview);
            }).orElse(null);
        }
        return new MessageDto(
                message.getId().toString(),
                viewerId.equals(message.getAuthorId()),
                author == null ? null : author.getName(),
                message.getBody(),
                message.getCreatedAt(),
                message.getClientId(),
                replyTo,
                viewerId.equals(message.getAuthorId()) && message.isRead()
                        && shareReadReceipts(conversation, viewerId),
                viewerId.equals(message.getAuthorId()) && message.getDeliveredAt() != null,
                attachmentDtos(message.getId()));
    }

    private boolean shareReadReceipts(Conversation conversation, UUID viewerId) {
        if (conversation.isGroup()) {
            return false;
        }
        UUID otherId = conversation.other(viewerId);
        if (otherId == null || conversations.blockedEitherWay(viewerId, otherId)) {
            return false;
        }
        User viewer = users.findById(viewerId).orElse(null);
        User other = users.findById(otherId).orElse(null);
        return viewer != null && other != null
                && viewer.isShareReadReceipts() && other.isShareReadReceipts();
    }

    private List<MessageAttachmentDto> attachmentDtos(UUID messageId) {
        return attachments.byMessage(List.of(messageId)).getOrDefault(messageId, List.of());
    }

    private void markDelivered(Conversation conversation, UUID readerId) {
        if (!conversation.isGroup() && messages.markDelivered(conversation.getId(), readerId) > 0) {
            events.delivered(readerId, List.of(conversation.getId()));
        }
    }

    private static String link(Conversation conversation) {
        return "/messages?c=" + conversation.getId();
    }

    private static String normalize(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String normalizeCaption(String value) {
        return value == null ? "" : value.strip();
    }

    public record ReplyCreate(String body, String clientId, String replyToId) {
    }

    public record PhotoCreate(MultipartFile file, String clientId, String caption) {
    }

    public record ThreadState(Boolean archived, Boolean muted) {
    }

    public record UnreadCount(long count) {
    }

    public record Sent(MessageDto message, boolean created) {
    }

    private record Written(ConversationMessage message, boolean created) {
    }
    }
