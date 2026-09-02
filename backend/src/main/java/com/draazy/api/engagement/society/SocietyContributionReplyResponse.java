package com.draazy.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/**
 * One reply in the thread under a contribution.
 *
 * <p>Carries its own {@code canRemove} rather than inheriting the parent's: a neighbour who may not
 * delete somebody else's tip may still delete their own reply to it, and the committee may delete
 * either.
 */
public record SocietyContributionReplyResponse(
        UUID id,
        UUID contributionId,
        String authorName,
        boolean authorIsResident,
        String body,
        boolean canRemove,
        Instant createdAt) {
}
