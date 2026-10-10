package com.draazy.api.catalog.society;

import com.fasterxml.jackson.annotation.JsonInclude;

/** One tile of the home rail; the directory and hub read the fuller {@link SocietyResponse}. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SocietyCard(String slug, String name, String localitySlug, long listingCount) {
}
