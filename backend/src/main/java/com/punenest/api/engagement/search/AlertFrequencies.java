package com.punenest.api.engagement.search;

/**
 * The {@code saved_searches.alert_frequency} vocabulary — how often a saved search re-runs and
 * notifies its owner.
 *
 * <p>Traced to both:
 * <ul>
 *   <li>V8: {@code CHECK (alert_frequency IN ('off','instant','daily','weekly'))}</li>
 *   <li>OpenAPI: {@code SavedSearch.alertFrequency} / {@code SavedSearchCreate.alertFrequency}</li>
 * </ul>
 *
 * <p>Validated at the edge rather than left to the database: an unlisted value reaching Postgres
 * raises a constraint violation that surfaces as a 500, so any caller could trigger a server error
 * with a typo. A {@code @Pattern} turns the same input into the 400 the contract promises.
 */
public final class AlertFrequencies {

    private AlertFrequencies() {
    }

    /** No alerts; the search is saved for manual re-runs only. */
    public static final String OFF = "off";

    /** Notify as soon as a new match is indexed. */
    public static final String INSTANT = "instant";

    /** One digest per day. The schema default. */
    public static final String DAILY = "daily";

    /** One digest per week. */
    public static final String WEEKLY = "weekly";

    /** Validation pattern for request input. */
    public static final String PATTERN = OFF + "|" + INSTANT + "|" + DAILY + "|" + WEEKLY;

    /** Message rendered when {@link #PATTERN} rejects a value. */
    public static final String PATTERN_MESSAGE = "must be off, instant, daily or weekly";
}
