package com.punenest.api.catalog.society;

import java.time.Instant;
import java.util.UUID;

/**
 * One merge, as the ops desk sees it.
 *
 * <p><strong>Why this is not a field on {@link SocietyResponse}.</strong> Adding {@code mergedInto}
 * to the directory contract would put it on every society card, every search result and every hub
 * read — where it is always null, because those surfaces exclude merged-away rows by construction.
 * A field that is null on every response a public client will ever see is not information, it is a
 * schema change with a blast radius across the whole catalogue for the benefit of one back-office
 * screen. This record serves that screen and nothing else.
 *
 * <p>Both sides carry a name as well as a slug. The screen is a list of decisions to review and
 * possibly undo, and "kumar-pinacle-wakad → kumar-pinnacle-wakad" is exactly the pair of strings an
 * operator cannot safely tell apart at a glance — which is how the duplicate was created in the
 * first place.
 *
 * @param slug     the duplicate's slug, and the key the undo is addressed by. It is unreachable
 *                 through {@code GET /societies/{slug}} — that resolves to the survivor — so this
 *                 list is the only place it can be read back
 * @param name     the duplicate's name as stored
 * @param intoSlug the surviving society
 * @param intoName the surviving society's name
 * @param mergedAt when the merge was recorded
 * @param mergedBy the operator who recorded it. The user id rather than a display name: two
 *                 operators clearing the same duplicate queue can reach opposite conclusions, and
 *                 the point of this field is being able to go and ask the one who decided. A name
 *                 would need a join and would still be ambiguous
 */
public record SocietyMergeResponse(
        String slug,
        String name,
        String intoSlug,
        String intoName,
        Instant mergedAt,
        UUID mergedBy) {
}
