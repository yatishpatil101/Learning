package com.draazy.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/**
 * One residency request as the cross-society ops queue publishes it (contract
 * {@code SocietyResidentQueueRow}).
 *
 * <p><strong>Why this is not {@link SocietyResidentResponse} with a name bolted on.</strong> A row
 * in a cross-society queue is meaningless without saying which building it is about — "B/704, Asha,
 * pending" is not a decision anybody can make. But the per-society read was asked for by slug, so
 * the caller already knows the society, and widening the shared contract would put a redundant field
 * on every hub read forever to serve one operator screen. The two reads answer different questions
 * and are allowed to say different things.
 *
 * <p>Flat rather than nesting the resident inside a society object, for the reason
 * {@link SocietyProposalResponse} is flat: the console renders one table across every society, and a
 * nested payload makes that table walk a level before it can read a column.
 *
 * <p>The name and mobile are here for the same reason they are on the per-society read — the
 * question being answered is "does this person live in B/704", and it is answered against a members'
 * register that has names in it. This surface is narrower still: staff holding {@code societies:read},
 * never a committee.
 *
 * @param societyName the building, so a queue spanning the whole catalogue can be read at all
 * @param assignedTo  which desk owes this a decision; a {@code committee} row is somebody else's
 *                    work and an operator needs to be able to see that before taking it
 */
public record SocietyResidentQueueRow(
        UUID id,
        String societySlug,
        String societyName,
        String name,
        String mobile,
        String wing,
        String flat,
        String unitKey,
        String relation,
        String status,
        String assignedTo,
        String flagged,
        String note,
        Instant createdAt,
        Instant decidedAt) {
}
