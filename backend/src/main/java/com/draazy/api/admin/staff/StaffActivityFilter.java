package com.draazy.api.admin.staff;

import java.time.Instant;
import java.util.Locale;

/**
 * The five things a caller may narrow back-office activity by.
 *
 * <p>A record rather than six parameters repeated across seven queries: the feed, the totals, the
 * per-entity split, the action vocabulary and the leaderboard all have to answer for the *same*
 * window, and the surest way to make a summary disagree with the feed underneath it is to let them
 * be filtered by two argument lists that drifted apart.
 *
 * @param actor  an actor handle, or {@code null} for everyone
 * @param entity a kind of record, or {@code null} for all kinds
 * @param action a dotted verb, or {@code null} for all verbs
 * @param from   inclusive lower bound, or {@code null}
 * @param to     exclusive upper bound, or {@code null}
 * @param q      free text matched against actor name, action, entity and entity id
 */
record StaffActivityFilter(
        String actor,
        String entity,
        String action,
        Instant from,
        Instant to,
        String q) {

    StaffActivityFilter {
        actor = blankToNull(actor);
        entity = blankToNull(entity);
        action = blankToNull(action);
        q = blankToNull(q);
    }

    /**
     * The {@code q} term as a SQL {@code like} pattern, lower-cased to match the lower-cased haystack.
     *
     * <p>{@code %} and {@code _} are escaped. Without that a search for {@code 100%} is a search for
     * everything, and the operator gets a full table back while believing they narrowed it.
     */
    String like() {
        if (q == null) {
            return null;
        }
        String escaped = q.toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + escaped + "%";
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
