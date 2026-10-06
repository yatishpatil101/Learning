package com.draazy.api.admin;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Counts only, with no user id, mobile or per-event detail, so anonymous telemetry cannot be drilled into a behavioural profile. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SupplyGapRow(
        String localitySlug,
        String localityName,
        long supply,
        long searches,
        long alerts,
        long views,
        long repeatSeekers,
        long demand,
        double demandPerListing) {
}
