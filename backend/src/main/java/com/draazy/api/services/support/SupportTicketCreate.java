package com.draazy.api.services.support;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code SupportTicketCreate}.
 *
 * <p>No {@code status}: every ticket opens {@code open}. No {@code userId} either — the raiser is the
 * authenticated caller, and a body field would let anyone file a ticket in someone else's name and
 * then read the reply from their own list.
 *
 * @param body the first message; a ticket with no message is a subject line nobody can answer
 */
public record SupportTicketCreate(
        @NotBlank @Size(max = 200) String subject,
        @Size(max = 64) String category,
        @NotBlank @Size(max = 4000) String body) {
}
