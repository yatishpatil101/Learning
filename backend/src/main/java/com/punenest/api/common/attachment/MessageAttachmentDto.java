package com.punenest.api.common.attachment;

import java.time.Instant;

/**
 * Contract {@code MessageAttachment} — one file on one message, as a reader sees it.
 *
 * <p>{@code url} is not a projection of the row: it is minted per read by
 * {@link com.punenest.api.provider.FileStorage} and expires, exactly as {@code DocumentDto.url}
 * does. Nothing persists it, and it is only ever produced for a reader who has already passed the
 * message's own guard.
 *
 * @param fileName    the uploader's filename, sanitised. Display only — the storage key is a
 *                    server-minted UUID and this string never touches a path
 * @param contentType the type <em>proved</em> from the file's leading bytes, not the one the
 *                    uploader declared
 * @param sizeBytes   size on disk, so a client can render "2.4 MB" without fetching the object
 * @param url         a signed, expiring GET. Minted for this read only
 * @param uploadedAt  when the bytes arrived, which for a bound attachment is a moment before its
 *                    message was written
 */
public record MessageAttachmentDto(
        String id,
        String fileName,
        String contentType,
        long sizeBytes,
        String url,
        Instant uploadedAt) {
}
