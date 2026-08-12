package com.punenest.api.moderation.conversation;

import com.punenest.api.common.attachment.MessageAttachmentDto;
import com.punenest.api.common.attachment.MessageAttachments;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.leads.conversation.Conversation;
import com.punenest.api.leads.conversation.ConversationMessage;
import com.punenest.api.leads.conversation.ConversationMessageRepository;
import com.punenest.api.leads.conversation.ConversationRepository;
import com.punenest.api.security.AuthPrincipal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one way to read a private conversation without being in it (D53).
 *
 * <p><strong>Why this is a separate class and a separate route.</strong> The obvious implementation
 * is four characters inside {@code ConversationService.mine}: {@code || isOps(caller)}. That is the
 * mistake the register row exists to name. A role branch hidden inside a participant guard turns
 * every existing caller of that guard into a moderation surface at once — {@code GET
 * /conversations}, {@code /conversations/{id}}, the reply route and the read-marker all go through
 * it — and it does so invisibly, because the guard keeps its old name and its old signature. Reading
 * {@code mine} afterwards no longer tells you who can read a thread. Here, the exemption is a route
 * with a name, an atom, a controller and an audit line; {@code mine} stays a sentence with no
 * exceptions in it, and stays byte-identical to what it was before this change.
 *
 * <p><strong>Every read is audited, and the audit is not optional.</strong> {@link AuditService}
 * writes in {@code REQUIRES_NEW}, so the row lands whether or not anything after it succeeds. It is
 * written before the projection is built rather than after: a moderator who has already been handed
 * the thread and a moderator whose response failed to serialise have both read it, and only the
 * ordering here makes those two the same in the log. An unaudited moderation read is the failure
 * this row is about — the access is legitimate, the silence is not.
 *
 * <p><strong>Read-only in the strongest sense.</strong> No unread flags are cleared, no
 * {@code lastMessage} is touched, nothing about the thread changes because a moderator looked at it.
 * The participants must not be able to tell from their own screens that their chat was read, both
 * because it would be a false signal (a read receipt from someone who is not in the conversation)
 * and because it would tip off the subject of a report.
 */
@Service
public class ModeratedConversationService {

    /** The audit action. One string, so a log query for it cannot miss a variant. */
    static final String ACTION = "conversation.moderation_read";

    private final ConversationRepository conversations;
    private final ConversationMessageRepository messages;
    private final UserRepository users;
    private final MessageAttachments attachments;
    private final AuditService audit;

    public ModeratedConversationService(ConversationRepository conversations,
            ConversationMessageRepository messages, UserRepository users,
            MessageAttachments attachments, AuditService audit) {
        this.conversations = conversations;
        this.messages = messages;
        this.users = users;
        this.attachments = attachments;
        this.audit = audit;
    }

    /**
     * {@code GET /admin/conversations/{id}} — the whole thread, both participants named.
     *
     * <p>404 for an id that does not resolve, matching every sibling moderation read and the
     * participant read it exempts. There is no 403 to give: the caller's authority was settled by
     * the route's guard before this method ran, so the only remaining question is whether the row
     * exists.
     */
    @Transactional(readOnly = true)
    public ModeratedConversationDto read(AuthPrincipal caller, String id) {
        Conversation conversation = Ids.parseUuid(id)
                .flatMap(conversations::findById)
                .orElseThrow(() -> NotFoundException.of("Conversation"));

        List<ConversationMessage> thread =
                messages.findByConversationIdOrderByCreatedAtAsc(conversation.getId());

        audit.record(caller, ACTION, "conversation", conversation.getId().toString(),
                "participants", conversation.getUserAId() + "," + conversation.getUserBId(),
                "messages", thread.size(),
                "propertyId", conversation.getPropertyId() == null
                        ? null : conversation.getPropertyId().toString());

        Set<UUID> peopleIds = new HashSet<>();
        peopleIds.add(conversation.getUserAId());
        peopleIds.add(conversation.getUserBId());
        thread.forEach(m -> peopleIds.add(m.getAuthorId()));
        Map<UUID, User> people = new HashMap<>();
        users.findAllById(peopleIds).forEach(u -> people.put(u.getId(), u));

        Map<UUID, List<MessageAttachmentDto>> files =
                attachments.byMessage(thread.stream().map(ConversationMessage::getId).toList());

        List<ModeratedParticipantDto> participants = new ArrayList<>(2);
        participants.add(participant(conversation.getUserAId(), people));
        participants.add(participant(conversation.getUserBId(), people));

        return new ModeratedConversationDto(
                conversation.getId().toString(),
                List.copyOf(participants),
                conversation.getPropertyId() == null ? null : conversation.getPropertyId().toString(),
                conversation.getCreatedAt(),
                conversation.getUpdatedAt(),
                thread.stream()
                        .map(m -> {
                            User author = people.get(m.getAuthorId());
                            return new ModeratedMessageDto(
                                    m.getId().toString(),
                                    m.getAuthorId().toString(),
                                    author == null ? null : author.getName(),
                                    m.getAuthorRole(),
                                    m.getBody(),
                                    m.getCreatedAt(),
                                    files.getOrDefault(m.getId(), List.of()));
                        })
                        .toList());
    }

    /**
     * A participant whose account may no longer exist. The id is always known — it is on the
     * conversation row — so a deleted account degrades to an unnamed participant rather than
     * removing a side of the thread and leaving a one-sided conversation on screen.
     */
    private static ModeratedParticipantDto participant(UUID id, Map<UUID, User> people) {
        User user = people.get(id);
        return new ModeratedParticipantDto(
                id.toString(),
                user == null ? null : user.getName(),
                user == null ? null : user.getRole());
    }
}
