package com.draazy.api.common.settings;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/** Public, as it decides what a logged-out visitor sees; absent fields mean "use the built-in default" and malformed values
 * are dropped, as forwarding a half-written bounding box would disagree with the schema. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record GeoPolicyResponse(
        Boolean enforceCityLimit,
        Map<String, CityGeo> cities,
        List<BlacklistEntry> blacklist) {

    /** Both fields are independently nullable and dropped as a unit when incomplete: a box missing an edge is not a smaller box. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CityGeo(LatLng center, Bounds bounds) {
    }

    /** A point; both fields are required, so the projection drops the pair rather than emit half of one. */
    public record LatLng(double lat, double lng) {
    }

    /** A bounding box, in the same north/south/east/west vocabulary the Places request takes. */
    public record Bounds(double north, double south, double east, double west) {
    }

    /** Omits the free-text {@code note} (moderator prose; public payload) and entries that match nothing. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BlacklistEntry(String id, String placeId, String term) {
    }
}
