package com.punenest.api.engagement.society;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One community-tab card.
 *
 * <p>Three kinds share one shape, with the fields the other kinds do not use left null. The
 * alternative — three schemas — would make a list of mixed contributions untypeable and force the
 * client to switch on the kind before it could even parse. It switches on the kind to
 * <em>render</em>, which is a different thing.
 *
 * @param body the author's prose: the tip, the pick's note, or the photo's caption. Present on any
 *     kind, required only on a tip.
 * @param referralContact the recommended person's phone number, and <strong>null on an
 *     unauthenticated read</strong>. They never agreed to be on the open web; a sign-in wall costs
 *     a neighbour one tap and costs a scraper the whole exercise.
 * @param authorIsResident recomputed on every read from the residency register, never stored, so
 *     that a committee rejecting somebody retracts the badge from everything they already wrote.
 * @param helpfulByMe whether <em>this</em> caller has already voted; false for a signed-out reader.
 * @param canRemove computed per viewer — the author, the committee, or platform staff. A client
 *     deriving this from a display name gets it wrong the moment two neighbours share one, and
 *     draws a button that 403s.
 */
public record SocietyContributionResponse(
        UUID id,
        String societySlug,
        String kind,
        String category,
        String body,
        String referralName,
        String referralContact,
        String photoUrl,
        String authorName,
        boolean authorIsResident,
        long helpfulCount,
        boolean helpfulByMe,
        boolean canRemove,
        Instant createdAt,
        List<SocietyContributionReplyResponse> replies) {
}
