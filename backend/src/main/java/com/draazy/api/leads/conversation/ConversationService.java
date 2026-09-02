package com.draazy.api.leads.conversation;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.attachment.MessageAttachments;
import com.draazy.api.common.attachment.MessageSurfaces;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * An open thread between two people — the inbox, the replies, the attachments, the read marks.
 *
 * <p><strong>Opening a thread is not here.</strong> {@link ConversationOpeningService} owns that:
 * the relationship guard that decides whether two people may talk at all, the counterparty
 * derivation, the find-or-create race and the audit row. This service assumes admission has already
 * been granted and asks only one question of a caller — are you a participant? Splitting the two
 * apart is package-structure.md §4.1's use-case split: who may open a conversation and what a reply
 * does are different decisions with different reasons to change.
 *
 * <p><strong>Non-participation is a 404, not a 403.</strong> On {@link #get}, {@link #reply} and
 * {@link #markRead} the thread id is the secret; answering 403 would confirm that a conversation
 * with that id exists.
 *
 * <p>Masking is not relaxed by being in a thread — see {@link ConversationMapper}.
 */
@Service
public class ConversationService {

    /** Notification body cap. Two rendered lines in the inbox; anything more is thread content. */
    private static final int PREVIEW_CHARS = 140;

    private final ConversationRepository conversations;
    private final ConversationMessageRepository messages;
    private final ConversationMapper mapper;
    private final UserRepository users;
    private final Notifier notifier;
    private final MessageAttachments attachments;

    public ConversationService(ConversationRepository conversations,
            ConversationMessageRepository messages, ConversationMapper mapper,
            UserRepository users, Notifier notifier, MessageAttachments attachments) {
        this.conversations = conversations;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.notifier = notifier;
        this.attachments = attachments;
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

    /**
     * The one place a message is written, so the preview and {@code updatedAt} cannot fall behind.
     *
     * <p>Package-private rather than private because {@link ConversationOpeningService} puts the
     * caller's first message in the thread it has just opened, and a second writer is exactly the
     * drift the sentence above exists to prevent. It carries no transaction of its own, so it runs
     * in whichever one the caller opened.
     */
    ConversationMessage send(Conversation conversation, AuthPrincipal author, String body) {
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
}
