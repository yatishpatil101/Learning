package com.punenest.api.common.attachment;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.provider.FileStorage;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Attachments on chat and support messages (D49): take the bytes, bind them to a message, hand them
 * back on the read.
 *
 * <p><strong>Why the flow is two-phase.</strong> Both reply endpoints take JSON, and the contract's
 * {@code MessageCreate.attachments} is a list of identifiers, not a list of files. So bytes arrive
 * first, on their own multipart endpoint, and the reply names what it wants to carry. The
 * alternative — letting the reply body carry URLs the client supplies — is the shape the field was
 * originally drafted as, and it is a server-side request forgery surface with a straight face: the
 * platform would be storing, and later re-serving, a location a caller chose.
 *
 * <p><strong>This class holds no authorisation.</strong> Every method takes an already-authorised
 * thread id and an uploader id, because the two surfaces guard themselves differently and correctly
 * — {@code ConversationService.mine} is participants-only and 404s a stranger,
 * {@code SupportTicketService.readable} additionally admits ops. Re-deciding that here would mean a
 * third opinion about who may see a thread, which is exactly the failure D53 is about. What this
 * class does enforce is the narrower question its callers cannot: that an attachment being claimed
 * is on <em>this</em> thread, was uploaded by <em>this</em> caller, and is not already spoken for.
 *
 * <p><strong>Read visibility follows the message, not the attachment.</strong> There is no endpoint
 * that fetches an attachment by id. The only way one is ever produced is
 * {@link #byMessage(Collection)}, called by a mapper that is already projecting messages the reader
 * has passed a guard to see — so "if you cannot read the message you cannot read its attachment" is
 * true by construction rather than by a second check that could be forgotten.
 */
@Service
public class MessageAttachments {

    private final MessageAttachmentRepository attachments;
    private final FileStorage storage;

    public MessageAttachments(MessageAttachmentRepository attachments, FileStorage storage) {
        this.attachments = attachments;
        this.storage = storage;
    }

    /**
     * Accept bytes for a thread the caller has already been authorised on. The row is created
     * unbound; nothing can read it until a reply claims it.
     *
     * @param surface  one of {@link MessageSurfaces}
     * @param threadId the conversation or support ticket, already checked by the caller
     * @param uploader the authenticated uploader
     * @return the stored attachment, with a freshly signed URL
     */
    @Transactional
    public MessageAttachmentDto upload(String surface, UUID threadId, UUID uploader, MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Attach a file");
        }
        // Checked before the bytes are read, so a caller cannot make the server hold megabytes in
        // memory for an upload that was going to be refused anyway.
        if (attachments.countByThreadIdAndUploadedByAndMessageIdIsNull(threadId, uploader)
                >= MessageAttachmentUploads.MAX_PENDING_PER_THREAD) {
            throw new BadRequestException(
                    "You have too many unsent attachments on this thread. Send them first.");
        }

        byte[] bytes = bytesOf(file);
        String type = MessageAttachmentUploads.validate(
                file.getContentType(), file.getSize(), bytes);
        String key = "messages/" + surface + "/" + threadId + "/" + UUID.randomUUID();
        storage.store(key, bytes, type);

        MessageAttachment saved = attachments.saveAndFlush(new MessageAttachment(
                surface, threadId, uploader, key, type, bytes.length,
                MessageAttachmentUploads.safeFileName(file.getOriginalFilename())));
        return toDto(saved);
    }

    /**
     * Claim the caller's pending uploads for a message just written.
     *
     * <p>Every id must resolve to a row that is on this thread, was uploaded by this caller, and is
     * still unbound; anything else is a 404 rather than a silent skip, because a reply that quietly
     * sends fewer attachments than the client asked for is worse than one that fails.
     *
     * @return the bound attachments, in the order the caller named them
     */
    @Transactional
    public List<MessageAttachmentDto> bind(UUID threadId, UUID uploader, UUID messageId,
            List<String> attachmentIds) {
        if (attachmentIds == null || attachmentIds.isEmpty()) {
            return List.of();
        }
        if (attachmentIds.size() > MessageAttachmentUploads.MAX_PER_MESSAGE) {
            throw new BadRequestException(
                    "A message can carry at most " + MessageAttachmentUploads.MAX_PER_MESSAGE
                            + " attachments");
        }

        Map<UUID, MessageAttachment> claimable = attachments
                .findByThreadIdAndUploadedByAndMessageIdIsNull(threadId, uploader).stream()
                .collect(Collectors.toMap(MessageAttachment::getId, a -> a));

        List<MessageAttachmentDto> bound = new java.util.ArrayList<>(attachmentIds.size());
        for (String token : attachmentIds) {
            MessageAttachment attachment = Ids.parseUuid(token)
                    .map(claimable::get)
                    .orElseThrow(() -> NotFoundException.of("Attachment"));
            attachment.bindTo(messageId);
            bound.add(toDto(attachments.saveAndFlush(attachment)));
            // Removed so the same id twice in one request cannot bind the same row twice: the
            // second mention finds nothing and 404s, which is the honest answer to a duplicate.
            claimable.remove(attachment.getId());
        }
        return bound;
    }

    /**
     * What hangs off each of these messages, batched. Messages with nothing attached are absent from
     * the map rather than present with an empty list, so callers must default.
     */
    @Transactional(readOnly = true)
    public Map<UUID, List<MessageAttachmentDto>> byMessage(Collection<UUID> messageIds) {
        if (messageIds == null || messageIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<MessageAttachmentDto>> byMessage = new LinkedHashMap<>();
        for (MessageAttachment a : attachments.findByMessageIdInOrderByCreatedAtAsc(messageIds)) {
            byMessage.computeIfAbsent(a.getMessageId(), k -> new java.util.ArrayList<>()).add(toDto(a));
        }
        return byMessage;
    }

    /** One message's attachments — the single-message convenience over {@link #byMessage}. */
    @Transactional(readOnly = true)
    public List<MessageAttachmentDto> of(UUID messageId) {
        return byMessage(List.of(messageId)).getOrDefault(messageId, List.of());
    }

    private MessageAttachmentDto toDto(MessageAttachment a) {
        return new MessageAttachmentDto(
                a.getId().toString(),
                a.getFileName(),
                a.getContentType(),
                a.getSizeBytes(),
                storage.signedDownloadUrl(a.getStorageKey()),
                a.getCreatedAt());
    }

    private static byte[] bytesOf(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException("cannot read uploaded attachment", e);
        }
    }
}
