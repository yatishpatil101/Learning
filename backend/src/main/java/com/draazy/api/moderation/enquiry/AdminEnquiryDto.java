package com.draazy.api.moderation.enquiry;

import java.time.Instant;

/**
 * One contact request as the demand board shows it.
 *
 * <p><strong>Not {@code ContactRequestResponse}, deliberately.</strong> That record is the
 * <em>owner's</em> view of their own inbox, and it reveals the requester's raw mobile once the owner
 * has approved. This board is read by operators who are party to none of these conversations, so on
 * the list the number is masked unconditionally — there is no status at which it becomes visible
 * there, and no parameter that unmasks it.
 *
 * <p><strong>One field, two states, one record.</strong> {@code GET /admin/enquiries/{id}} returns
 * this same shape with {@code requesterMobile} unmasked, and writes an {@code audit_log} row saying
 * so (D25). A separate detail record was considered and rejected: the console renders one row, and
 * two types would suggest it had two things to render rather than one row an administrator has
 * chosen to look at properly. Callers that care can tell the states apart by the value — the masked
 * form is not a valid mobile.
 *
 * <p>The mock console called this row an "enquiry" with a {@code kind} of {@code contact},
 * {@code chat} or {@code call}. Only {@code contact} is a row in a table. Chats are conversations and
 * have their own moderated surface under {@code conversations:read}; {@code call} was never anything
 * but a value the mock could produce, since the platform places no calls and records none.
 *
 * @param id            opaque contact-request id
 * @param propertyId    the listing the request is against
 * @param propertyTitle the listing's title, so the board reads without a second call per row
 * @param locality      the listing's locality slug, the axis demand is actually analysed on
 * @param requesterName who asked
 * @param requesterMobile masked ({@code 98XXXXX210}) on the list; unmasked, and audited, on
 *                        {@code GET /admin/enquiries/&#123;id&#125;}
 * @param status        one of {@code pending}, {@code approved}, {@code declined}
 * @param createdAt     when the request was made; the board sorts on it, newest first
 */
public record AdminEnquiryDto(
        String id,
        String propertyId,
        String propertyTitle,
        String locality,
        String requesterName,
        String requesterMobile,
        String status,
        Instant createdAt) {
}
