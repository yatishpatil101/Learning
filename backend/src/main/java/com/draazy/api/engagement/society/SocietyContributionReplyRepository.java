package com.draazy.api.engagement.society;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Replies under a contribution.
 *
 * <p>No finders. Reads go through {@link SocietyContributionRepository#repliesFor}, which fetches a
 * whole page's worth in one query; a per-contribution finder here would look harmless and quietly
 * reintroduce the N+1 that batching exists to avoid. Deletes are by id after the service has
 * checked who is asking.
 */
public interface SocietyContributionReplyRepository
        extends JpaRepository<SocietyContributionReply, UUID> {
}
