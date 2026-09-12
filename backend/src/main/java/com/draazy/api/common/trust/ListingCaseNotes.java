package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * Lets a listing write put a sentence in front of the listing's owner, or in front of the ops desk,
 * without the catalogue knowing how moderation works (D218).
 *
 * <p><strong>Why a port in the shared kernel.</strong> {@code package-structure.md} §5 forbids a
 * feature context from importing another at the same or a higher layer, and posting these notes
 * directly would make {@code catalog} (layer 1) import {@code moderation} (layer 6) — an upward
 * edge, and a cycle, since {@code moderation} already reads {@code catalog} to load the listing it
 * is reviewing. Declaring the interface here and implementing it in
 * {@code moderation.verification} inverts it. Same shape as {@link OwnerBadgeSink}, for the same
 * reason and in the same direction.
 *
 * <p>The signature is ids and strings, per the same rule: no entity, nothing that could drag the
 * catalogue's model into the kernel or the kernel into moderation's.
 *
 * <p><strong>A port, not an event.</strong> Every one of these notes explains a write that is still
 * in flight — "your listing went back for review", "this submission collides with another owner's".
 * Delivered later, or dropped, it would describe a change the owner has already been told about by
 * the response body, with nothing linking the two. When the note must commit with the write that
 * justified it, the seam is a synchronous port; implementations are expected to demand an existing
 * transaction rather than open their own.
 */
public interface ListingCaseNotes {

    /**
     * Post a note the listing's owner will read, opening the listing's case file if it has none.
     *
     * <p>Opening one is the point rather than a side effect: a case file is the work item the ops
     * queue reads, so a note with nowhere to land would be a warning nobody receives.
     *
     * @param propertyId the listing the note is about
     * @param deal       {@code buy} or {@code rent}, which decides the opening checklist if a case
     *                   file has to be created — a rental is a lighter check than a sale
     * @param body       what to say, in the owner's language, already composed by the caller
     */
    void post(UUID propertyId, String deal, String body);

    /**
     * Post a staff-only note, unless this case file already carries one saying exactly the same
     * thing.
     *
     * <p>For findings that are <em>about</em> the submitter rather than <em>for</em> them, and that
     * are re-derived rather than triggered by an event — the duplicate probe re-runs on every edit
     * that moves one of its inputs, and a queue where the same sentence appears three times is one a
     * moderator learns to skim. Identical is the right test for "already said": if the wording
     * changed, something about the situation changed too.
     *
     * <p>Raises no unread badge anywhere, on either side. An internal note is not a notification —
     * the case file surfacing in the ops queue is what makes someone look.
     */
    void postInternalOnce(UUID propertyId, String deal, String body);
}
