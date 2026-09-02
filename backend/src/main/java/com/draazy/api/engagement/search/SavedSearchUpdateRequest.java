package com.draazy.api.engagement.search;

import jakarta.validation.constraints.Pattern;

/**
 * Contract {@code SavedSearchUpdate} — the alert preferences on an existing saved search.
 *
 * <p><strong>Why this is narrower than {@link SavedSearchCreateRequest}.</strong> A saved search is
 * two things joined: a query, and how you want to be told about it. The query half is the identity
 * of the row — editing "2BHK in Baner" into "3BHK in Kothrud" does not modify an alert, it replaces
 * it, and letting it happen in place silently rewrites what {@code newCount} was counted against.
 * Delete and re-create says that plainly. So only the preferences half is updatable, and
 * {@code query}, {@code filters}, {@code criteria} and {@code kind} are deliberately absent rather
 * than accepted-and-ignored.
 *
 * <p><strong>Both fields are nullable and null means "leave alone".</strong> The known cost is that
 * this record cannot express "clear it" — the same limitation recorded as tech-debt D46 for
 * {@code TicketUpdate}. It does not bite here: both columns are {@code NOT NULL} with defaults, so
 * there is no cleared state to express. The UI's gesture is a toggle between {@code off} and a real
 * frequency, which is a value in the vocabulary rather than an absence.
 *
 * @param alertFrequency  new cadence, or null to leave unchanged
 * @param channel         new delivery channel, or null to leave unchanged
 */
public record SavedSearchUpdateRequest(
        @Pattern(regexp = AlertFrequencies.PATTERN, message = AlertFrequencies.PATTERN_MESSAGE)
        String alertFrequency,
        @Pattern(regexp = AlertChannels.PATTERN, message = AlertChannels.PATTERN_MESSAGE)
        String channel) {
}
