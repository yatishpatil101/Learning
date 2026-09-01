package com.punenest.api.engagement.demand;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

/**
 * Request body for {@code POST /demand-signals}.
 *
 * <p><strong>Everything is optional except the kind.</strong> That is not laxity — it is the shape
 * of the thing being recorded. A visitor who searches with no filters set has expressed demand, and
 * refusing the signal because they did not name a locality would drop precisely the broadest and
 * least-served requests, which is the opposite of what a supply-gap report is for.
 *
 * <p><strong>There is no mobile field, though the client used to send one.</strong> See the V88
 * migration header: the only reader is a count, so a contact detail here would be data held for no
 * purpose. If a mobile arrives it is ignored by binding rather than rejected, so an older client
 * degrades to a valid anonymous signal instead of failing.
 *
 * <p><strong>Sizes are caps, not formats.</strong> {@code bhk} is free text because a multi-select
 * arrives as {@code "2/3"} and validating it as a number would quietly reject the multi-select case
 * that matters most. The bounds exist so an unbounded string cannot be parked in the table.
 */
public record DemandSignalCreate(
        // @NotBlank as well as @Pattern: @Pattern passes a null value by design, so on its own it
        // would accept a body with no kind at all and push the failure down to the check constraint.
        @NotBlank
        @Pattern(regexp = "search|alert|view", message = "kind must be search, alert or view")
        String kind,

        @Size(max = 120)
        String localitySlug,

        @Pattern(regexp = "buy|rent", message = "deal must be buy or rent")
        String deal,

        @Size(max = 40)
        String bhk,

        UUID propertyId) {
}
