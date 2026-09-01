package com.punenest.api.moderation.duplicate;

import java.util.List;

/**
 * One rendering of the duplicates desk.
 *
 * @param clusters  the derived clusters, newest member first, dismissals already removed.
 * @param scanned   how many signal-carrying listings were actually clustered.
 * @param truncated the scan hit its ceiling, so {@code clusters} is not the whole answer.
 *
 *                  <p>Reported rather than swallowed because of how clustering fails under a cap.
 *                  A truncated <em>list</em> is obviously partial — the operator sees rows and knows
 *                  there are more. A truncated <em>clustering</em> is not: if the ceiling falls
 *                  between two members of a genuine pair, the pair does not render as a partial
 *                  cluster, it does not render at all. The desk would show a shorter list and look
 *                  like a cleaner catalogue, which is the one failure mode this feature must never
 *                  have. The console says so out loud when this is set.
 */
public record DuplicateClusterReport(
        List<DuplicateCluster> clusters,
        int scanned,
        boolean truncated) {
}
