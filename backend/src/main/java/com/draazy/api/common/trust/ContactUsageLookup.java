package com.draazy.api.common.trust;

import java.util.UUID;

/**
 * Answers the one question the billing feature must ask the contact gate: how many owner contacts
 * has this caller already opened?
 *
 * <p><strong>The mirror of {@link ContactAllowanceLookup}.</strong> Two ports rather than one
 * because the two facts are owned by two different features, and the alternative — a single port
 * returning both — would have forced one side to hold a copy of the other's data. Both interfaces
 * live in the kernel and each feature implements one and consumes the other, so the compile-time
 * graph stays acyclic even though the two questions are answered together.
 *
 * <p><strong>There is no counter column behind this.</strong> The answer is
 * {@code count(*) from contact_requests where requester_id = ?}, and it is exact rather than
 * approximate because {@code uq_contact_requests_requester_property} (V9) already admits one row per
 * requester and property. A caller cannot open the same owner twice, so the row count <em>is</em>
 * the number of distinct owners approached — no separate tally to increment, and none to drift.
 */
public interface ContactUsageLookup {

    /**
     * How many owner contacts this caller has opened, for all time.
     *
     * @param userId the authenticated caller
     * @return the count, never negative. Zero for a caller who has never asked, including one who
     *         does not exist — this port answers about behaviour, not about identity, and refusing
     *         to answer for an unknown id would only move a null check to every caller
     */
    long contactsUsed(UUID userId);
}
