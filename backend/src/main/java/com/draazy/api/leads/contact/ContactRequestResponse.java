package com.draazy.api.leads.contact;

import java.time.Instant;

/**
 * One incoming request as the listing owner sees it (contract {@code ContactRequest}).
 *
 * <p><strong>Two mobiles, two rules.</strong> {@link #requester} is always present and always carries
 * a <em>masked</em> mobile — the owner sees who asked without being handed a phone number they have
 * not yet agreed to receive. {@link #contact} is {@code null} until the owner approves, at which
 * point it carries the requester's raw number. Approval is therefore symmetric: it reveals the owner
 * to the buyer (via the property detail) and the buyer to the owner (here), which is what makes the
 * gate a mutual consent rather than a one-way harvest.
 *
 * @param id         opaque request id, used as the {@code reqId} path token when responding
 * @param propertyId the listing the request is against
 * @param requester  who asked — name + masked mobile + role (contract {@code Party})
 * @param status     one of {@link ContactRequestStatuses}; the computed {@code owner}/{@code none}
 *                   states of {@link ContactStatuses} cannot occur on a stored row
 * @param contact    the requester's real contact, present only once {@code status == approved}
 * @param createdAt  when the request was made — the owner's inbox sorts on it
 */
public record ContactRequestResponse(
        String id,
        String propertyId,
        Party requester,
        String status,
        Contact contact,
        Instant createdAt) {

    /**
     * A counterparty on the request (contract {@code Party}). Still nested rather than shared with
     * the deals context's identically-named schema: that one carries offer/finalization fields this
     * one has no meaning for, so merging them would produce a type whose validity depends on where
     * it came from.
     *
     * @param mobile   <strong>always masked</strong> ({@code 98XXXXX210})
     * @param role     {@code buyer} — the requester side of a contact request is always the buyer
     * @param verified whether this party holds a verified tenant profile. Carried on the party
     *                 rather than looked up by the consumer because {@code mobile} is masked, and a
     *                 masked number can never match a real one — the caller has the key to the
     *                 answer but not a key that works. {@code false} when unknown, never null.
     */
    public record Party(String name, String mobile, String role, boolean verified) {
    }

    /**
     * The revealed contact, emitted only after approval.
     *
     * @param mobile the <strong>raw</strong> 10-digit mobile
     */
    public record Contact(String name, String mobile) {
    }
}
