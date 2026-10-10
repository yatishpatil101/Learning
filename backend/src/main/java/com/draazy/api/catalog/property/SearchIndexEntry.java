package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;

/** One live home as the hero search counts it: where it is and what deal, nothing that identifies it. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SearchIndexEntry(
        String deal,
        String locality,
        String localitySlug,
        String societySlug,
        String societyName,
        Double lat,
        Double lng) {
}
