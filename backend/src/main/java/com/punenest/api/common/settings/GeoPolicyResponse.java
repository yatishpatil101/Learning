package com.punenest.api.common.settings;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;

/**
 * The contract's {@code GeoPolicy} — where the platform operates, and which places it will not
 * suggest.
 *
 * <p>Public, because every part of it decides what a <em>logged-out visitor</em> is shown: which
 * cities the navbar offers, where a map centres, whether a locality search box is fenced to the
 * city bounds, and which places are hidden from every suggestion box in the product. The block
 * lives in the admin-only settings document alongside the fee table and the permission map, so an
 * administrator-only reader could never be the client's source for it.
 *
 * <p><strong>Every field is an override, and absent means "use the built-in default".</strong> The
 * client ships {@code CITY_GEO} — a centre, a bounding box and a launch status per city — and this
 * response is merged over it. That is why there is no seeded {@code geo} row and why {@code {}} is
 * the correct answer for a fresh install rather than a broken one: an operator who has never opened
 * the Maps panel has not disagreed with anything. It also means this endpoint can never be the
 * reason a map fails to centre.
 *
 * <p><strong>Malformed values are dropped rather than forwarded</strong>, the same way {@code GET
 * /flags} drops non-booleans and {@code GET /move-pack} drops non-integer prices. The stored
 * document is untyped and hand-editable; a half-written bounding box passed through would be a
 * response that disagrees with its own schema, and the client would fence a search against a fence
 * with no south edge. Dropping it falls back to the built-in default, which is the only other
 * honest reading.
 *
 * @param enforceCityLimit whether locality search is <em>restricted</em> to the active city's
 *     bounds rather than merely biased toward them. Null when the operator has never set it; the
 *     client's default is on
 * @param cities per-city overrides, keyed by the city name the client knows it by. Cities the
 *     operator has never touched are absent, not defaulted, so this map is usually short
 * @param blacklist places to hide from every suggestion box, newest first. Never null — an empty
 *     list is a real answer
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record GeoPolicyResponse(
        Boolean enforceCityLimit,
        Map<String, CityGeo> cities,
        List<BlacklistEntry> blacklist) {

    /**
     * One city's overrides.
     *
     * <p>All three fields are independently nullable because the panel writes them independently:
     * taking a city live is one control, redrawing its bounding box is another, and an operator who
     * has done one has not implied anything about the other.
     *
     * <p>{@code center} and {@code bounds} are dropped as a unit when incomplete rather than
     * repaired. A box missing an edge is not a smaller box, and a centre missing a longitude is not
     * a point.
     *
     * @param live   whether the city is launched. Null means the built-in status stands — today
     *     that is Pune only
     * @param center the map centre, or null to use the built-in one
     * @param bounds the coverage box, or null to use the built-in one
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record CityGeo(Boolean live, LatLng center, Bounds bounds) {
    }

    /**
     * A point. Both fields are required by construction — the projection drops the pair rather than
     * emit a half of one.
     */
    public record LatLng(double lat, double lng) {
    }

    /** A bounding box, in the same north/south/east/west vocabulary the Places request takes. */
    public record Bounds(double north, double south, double east, double west) {
    }

    /**
     * One blacklisted place.
     *
     * <p><strong>The operator's reason is deliberately not here.</strong> Each stored entry carries
     * a free-text {@code note} — "Reason (optional)" on the panel — which is moderator prose about a
     * named building, written on the understanding that staff were the readers. The matcher has
     * never read it: {@code isBlacklisted} tests {@code placeId} exactly and {@code term} as a
     * substring, and nothing else. So it is dropped here, and the admin console goes on reading the
     * whole entry through {@code /admin/settings}, which is where a note about a named building
     * belongs.
     *
     * <p>An entry that can match nothing — no {@code placeId} and no usable {@code term} — is
     * omitted rather than published. It is not a rule the client could apply, and publishing it
     * would put an empty row in a list whose whole purpose is to be matched against.
     *
     * @param id      the entry's identifier, kept so the client can key a list without a heuristic
     * @param placeId the Google place id, when the entry was picked from a search. An exact match,
     *     and the reason the panel recommends picking over typing
     * @param term    the name to match as a case-insensitive substring, when the entry was typed
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BlacklistEntry(String id, String placeId, String term) {
    }
}
