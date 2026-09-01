package com.punenest.api.leads.conversation;

import com.punenest.api.common.validation.IndianMobile;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code ConversationCreate}.
 *
 * <p>The counterparty is named by mobile rather than by user id because that is what a client has:
 * an approved contact request hands the buyer the owner's number, not an internal id. The number is
 * a lookup key here and nothing more — see {@link ConversationService#start} for why a number that
 * resolves to nobody and a number that resolves to a stranger get the identical refusal.
 *
 * <p><strong>…except that a buyer never holds the owner's number.</strong> The sentence above was
 * written before D5 made masking unconditional: {@code ContactGateService} now reveals the raw
 * mobile only to the owner of the listing, and approval unlocks the in-app conversation rather than
 * the digits. That left the buyer side of this endpoint unreachable — the client was told to chat,
 * and had no address to chat to. So {@code counterpartyMobile} is optional when {@code propertyId}
 * names a listing, in which case the counterparty is the listing's owner. The client addresses the
 * thread by the thing it legitimately knows.
 *
 * <p>This is not a hole in the relationship guard. Deriving the counterparty only decides
 * <em>who</em> the other party is; whether the caller may message them is still
 * {@code ConversationService.related} — an approved contact request in one direction or the other —
 * and the property-party check that follows it is unchanged. Anyone can name any listing id; naming
 * one buys nothing without the approval.
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
 *                   each other through one listing may need to talk about something else — but
 *                   required when {@code counterpartyMobile} is absent, since it is then the only
 *                   thing naming the other party
 */
public record ConversationCreate(
        @IndianMobile
        String counterpartyMobile,
        @Size(max = 64) String propertyId,
        @NotBlank @Size(max = 4000) String body) {

    /**
     * At least one of the two addressing fields has to be present.
     *
     * <p>{@code @AssertTrue} rather than a service check for the reason {@code SavedSearchCreateRequest}
     * gives: Bean Validation answers the contract's 422 with the offending field named, while a
     * service-thrown {@code BadRequestException} would be a 400 naming nothing. This also keeps the
     * refusal well away from {@link ConversationService#refuse()} — "you addressed nobody" is a
     * malformed request, not a trust decision, and must not be answered with the deliberately
     * uninformative 403 that hides whether a number is registered.
     *
     * <p>Note that a <em>blank</em> {@code counterpartyMobile} still fails {@code @IndianMobile}
     * separately, which is intended: omit the field, do not send an empty string for it.
     */
    @AssertTrue(message = "counterpartyMobile is required unless propertyId names a listing")
    public boolean isAddressed() {
        return !blank(counterpartyMobile) || !blank(propertyId);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
