package com.draazy.api.engagement.search;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;

/**
 * Contract {@code SavedSearchCreate}.
 *
 * <p><strong>{@code query} is conditionally required, which is why it carries no {@code @NotBlank}.</strong>
 * A listings alert is a query string; a flatmates alert is a {@code criteria} object and has no
 * query string to give. The rule "listings needs query, flatmates needs criteria" is enforced in
 * the service (where it can name the missing field) and again by the V27 CHECK constraint.
 *
 * <p>{@code alertFrequency} and {@code channel} are pattern-validated rather than passed through:
 * the CHECK constraints would otherwise reject an unlisted value at insert time, and a constraint
 * violation surfaces as a 500 that any caller could trigger with a typo.
 *
 * @param name            optional user-given name
 * @param kind            {@code listings} (default) or {@code flatmates}
 * @param query           the search text — required when {@code kind} is listings
 * @param filters         optional facet filters (free-form object, stored as jsonb)
 * @param criteria        the flatmates filter set — required when {@code kind} is flatmates
 * @param alertFrequency  default "daily" if absent
 * @param channel         default "whatsapp" if absent
 */
public record SavedSearchCreateRequest(
        String name,
        String kind,
        String query,
        Object filters,
        Object criteria,
        @Pattern(regexp = AlertFrequencies.PATTERN, message = AlertFrequencies.PATTERN_MESSAGE)
        String alertFrequency,
        @Pattern(regexp = AlertChannels.PATTERN, message = AlertChannels.PATTERN_MESSAGE)
        String channel) {

    /**
     * A listings alert needs a query string.
     *
     * <p>Expressed as {@code @AssertTrue} rather than checked in the service, because the status
     * code depends on where the check lives: Bean Validation yields the contract's 422
     * {@code ValidationProblem} with a {@code fields[]} entry, while a service-thrown
     * {@code BadRequestException} would be a 400 with no field named. Callers already handle the
     * former, and {@code query} was {@code @NotBlank} here before flatmates alerts existed — this
     * keeps that behaviour and merely makes it conditional.
     */
    @AssertTrue(message = "a listings alert needs a query")
    public boolean isQuerySuppliedForListings() {
        return isFlatmates() || (query != null && !query.isBlank());
    }

    /** A flatmates alert has no query string; it needs the criteria object instead. */
    @AssertTrue(message = "a flatmates alert needs criteria")
    public boolean isCriteriaSuppliedForFlatmates() {
        return !isFlatmates() || criteria != null;
    }

    /** Absent {@code kind} means listings, matching the contract's default. */
    boolean isFlatmates() {
        return "flatmates".equals(kind == null ? null : kind.strip());
    }
}
