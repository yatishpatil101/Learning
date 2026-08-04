package com.punenest.api.documents.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code StatusUpdate}, as used by {@code respondDocumentRequest}.
 *
 * <p>A local copy rather than a shared type, matching {@code leads.contact.StatusUpdate}: the two
 * carry different vocabularies ({@code granted|declined} here, {@code approved|declined} there),
 * and a shared record would have to accept the union — which is how a document request ends up
 * "approved" and unreadable by every branch that checks for "granted".
 */
public record StatusUpdate(@NotBlank String status, @Size(max = 500) String note) {
}
