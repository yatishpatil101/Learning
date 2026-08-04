package com.punenest.api.leads.conversation;

import com.punenest.api.common.validation.Formats;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code ConversationCreate}.
 *
 * <p>The counterparty is named by mobile rather than by user id because that is what a client has:
 * an approved contact request hands the buyer the owner's number, not an internal id. The number is
 * a lookup key here and nothing more — see {@link ConversationService#start} for why a number that
 * resolves to nobody and a number that resolves to a stranger get the identical refusal.
 *
 * <p>{@code counterpartyMobile} carried only {@code @Size(max = 20)} until D23a, while the contract
 * {@code $ref}s the {@code Mobile} schema. Anything non-numeric fell through to
 * {@code MobileMask.normalise}, which answers {@code null}, which the lookup turned into the
 * catch-all refusal — safe, but it reported "no such conversation partner" for input that was never
 * a mobile number. The pattern refuses that at the edge as a 422, which is what the contract says
 * and what every other mobile field on the platform already does. It does not weaken the
 * anti-enumeration property: a 422 says the string is not mobile-shaped, never whether it is
 * registered.
 *
 * @param propertyId the listing the thread is about; optional, because two people who already know
 *                   each other through one listing may need to talk about something else
 */
public record ConversationCreate(
        @NotBlank @Pattern(regexp = Formats.MOBILE,
                message = Formats.MOBILE_MESSAGE)
        String counterpartyMobile,
        @Size(max = 64) String propertyId,
        @NotBlank @Size(max = 4000) String body) {
}
