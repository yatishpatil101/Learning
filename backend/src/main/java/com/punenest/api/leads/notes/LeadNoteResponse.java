package com.punenest.api.leads.notes;

import java.time.Instant;

/**
 * One owner's private annotation, as they see it.
 *
 * <p>Carries no requester and no listing — unlike every other response in {@code leads}. It is
 * deliberately thin: the inbox already holds the lead it is rendering and only needs to look the
 * annotation up by {@link #leadKey}. Denormalising a buyer name onto this would put a second copy of
 * lead PII behind an endpoint that has none of the contact gate's protections in front of it.
 *
 * @param leadKey    echoed back so the client can index a whole page of these by key without having
 *                   to re-derive it
 * @param note       {@code null} when the owner set only a follow-up date; never both null (V119)
 * @param followUpAt {@code null} when the owner wrote only a note
 * @param updatedAt  what the localStorage version called {@code updatedAt}; kept because the panel
 *                   uses it to show when a note was last touched
 */
public record LeadNoteResponse(
        String leadKey,
        String note,
        Instant followUpAt,
        Instant updatedAt) {

    static LeadNoteResponse of(LeadNote row) {
        return new LeadNoteResponse(
                row.getLeadKey(), row.getNote(), row.getFollowUpAt(), row.getUpdatedAt());
    }
}
