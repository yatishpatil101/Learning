package com.punenest.api.moderation.enquiry;

import java.time.Instant;

/**
 * One deal as the demand board shows it — the bottom of the funnel, and the row GMV is summed from.
 *
 * <p>The counterparty's mobile is masked on the list even though {@code DealDto} reveals it. That
 * reveal is correct where it lives: the owner typed the number in themselves when they closed
 * off-platform, so showing it back to them discloses nothing. An operator did not type it and is
 * owed no more of it than of any other party's — until they open the row, which unmasks it and
 * writes an audit entry naming <em>which</em> of the two sources it came from (D25). That last part
 * matters here more than on the other two tabs: a typed number may belong to somebody who never held
 * an account, and a log that cannot tell a stranger's number from a user's is not much of a log.
 *
 * <p>{@code agreedPrice} is null until the deal closes. The board's GMV tile therefore sums closed
 * deals only, which is what GMV means — an active deal has no agreed price to contribute.
 *
 * @param id                 opaque deal id
 * @param propertyId         the listing transacted
 * @param propertyTitle      the listing's title
 * @param locality           the listing's locality slug
 * @param deal               {@code buy} or {@code rent}
 * @param counterpartyName   the other side, where known — null for an off-platform close against a
 *                           number that belongs to no account
 * @param counterpartyMobile masked on the list; unmasked, and audited, on the detail read
 * @param agreedPrice        whole INR, set on close; null while active
 * @param status             one of {@code active}, {@code reserved}, {@code closed}
 * @param closedAt           when it closed; null while active
 * @param createdAt          when the deal row was opened
 */
public record AdminDealDto(
        String id,
        String propertyId,
        String propertyTitle,
        String locality,
        String deal,
        String counterpartyName,
        String counterpartyMobile,
        Long agreedPrice,
        String status,
        Instant closedAt,
        Instant createdAt) {
}
