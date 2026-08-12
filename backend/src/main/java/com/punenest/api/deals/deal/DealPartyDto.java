package com.punenest.api.deals.deal;

import java.time.Instant;

/**
 * One deal party as the wire sees it (contract {@code DealParty}).
 *
 * <p>Distinct from {@link DealDto.Party} on purpose: a deal party has {@code note} and {@code at}
 * but no {@code role}; it is an off-platform person the owner jotted down (D1, S6).
 *
 * @param id     server-assigned opaque id (stable across edits — S5)
 * @param mobile raw mobile, if provided
 * @param note   owner's private note
 * @param at     when the party was added ({@code created_at})
 */
public record DealPartyDto(
        String id,
        String name,
        String mobile,
        String note,
        Instant at) {
}
