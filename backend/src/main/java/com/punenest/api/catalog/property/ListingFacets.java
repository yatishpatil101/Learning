package com.punenest.api.catalog.property;

import java.math.BigDecimal;
import java.util.List;

/**
 * The buyer-facing half of the listings search — the facets the results page offers that
 * {@link PropertySearchQuery} never carried (D26).
 *
 * <p><strong>Why a second record rather than twenty more fields on the first.</strong>
 * {@link PropertySearchQuery} is shared with the moderation search, and a moderator filtering the
 * approval queue has no use for "pets allowed" or "within 3km of Baner Chowk". Folding these in
 * would have grown the shape both callers must satisfy to over thirty positional components, where
 * one transposed argument is a filter that silently searches the wrong column. Kept separate, the
 * moderation call site does not change at all and passes {@link #NONE}.
 *
 * <p><strong>Why these exist at all.</strong> Every facet here was already offered by the listings
 * UI and already evaluated — in the browser, after the whole approved catalogue had been
 * downloaded. That worked in mock mode and failed silently against the live API in two different
 * ways: the six columns V95 adds did not exist, so those filters compared against {@code undefined}
 * and returned nothing; and the rest existed but were applied to whichever listings had already
 * arrived, so a filter could only ever narrow a page, never the catalogue. Both failures are the
 * same failure — a predicate the database cannot see cannot page.
 *
 * <p>Every component is nullable or empty-able and means "do not filter" when absent. Collections
 * bind from either a repeated parameter ({@code ?bhk=2&bhk=3}) or a comma list ({@code ?bhk=2,3}).
 *
 * @param types      property types to include, OR'd. One list rather than the UI's split between
 *     residential and commercial chips, because both narrow the same column and the server has no
 *     reason to care which drawer the chip was in.
 * @param bhks       bedroom counts, OR'd. Tokens are whole numbers, or {@code Nplus} for an open
 *     top ({@code 3plus} = three or more) — the UI's top chip is genuinely open-ended, and
 *     rendering it as an equality would hide every 4BHK from a buyer who asked for "3+".
 *     <p>Plural, and not {@code bhk}, because {@link PropertySearchQuery} already publishes a
 *     single-valued {@code bhk} on this same endpoint. Two parameters of the same name and
 *     different arity is not merely ambiguous — Spring binds the scalar first, so
 *     {@code ?bhk=2,3} either fails to parse or, worse, quietly becomes an equality against the
 *     literal string. Same reasoning for {@code furnishings}.
 * @param furnishings furnishing states, OR'd. Plural for the reason given on {@code bhks}.
 * @param localities locality slugs, OR'd. Slugs, not display names: the name is what the card
 *     prints, the slug is what the catalogue is keyed on.
 * @param societies  society slugs, OR'd.
 * @param amenities  amenity tokens, <strong>AND'd</strong> — the one collection here that is not a
 *     union. A buyer ticking "lift" and "parking" is stating two requirements, not offering two
 *     alternatives, and returning a listing with only one of them wastes the visit that discovers
 *     the difference.
 * @param landUse    plot zoning, OR'd (V95).
 * @param room       flatmate room shapes, OR'd (V95).
 * @param sharing    PG occupancies, OR'd (V95).
 * @param tenants    accepted tenant types, OR'd — <em>plus</em> every listing that stated no
 *     preference at all. An owner who left the field blank has not refused anybody, and reading
 *     silence as refusal would hide most of the inventory from the filter meant to narrow it.
 * @param construction possession states, OR'd. Separate from {@link PropertySearchQuery#possession}
 *     (which stays an exact single match for the existing contract) because the results page
 *     offers this as multi-select; when both are present they AND, which is what a caller sending
 *     both asked for.
 * @param availableFrom move-in bucket, <strong>cumulative</strong>: {@code 30} also matches
 *     {@code now} and {@code 15} (V95). A tenant who can wait a month can also take a flat that is
 *     free today, and an exact match on the bucket would deny them it.
 * @param pets       {@code true} filters to pet-friendly; {@code false} and {@code null} both mean
 *     "do not filter". There is no "pets forbidden" search, because nobody performs one.
 * @param ownerVerified     restrict to listings whose poster passed Aadhaar/DigiLocker.
 * @param ownershipVerified restrict to listings whose paperwork checked out.
 * @param rera       restrict to listings carrying a RERA registration — {@code rera_id IS NOT NULL},
 *     since the column holds the number itself and the client only ever asked the yes/no.
 * @param societyVerified   restrict to listings in a verified society.
 * @param conveyanceDone    restrict to societies whose conveyance is complete.
 * @param minArea    inclusive lower bound on built area.
 * @param maxArea    inclusive upper bound on built area.
 * @param minAge     inclusive lower bound on construction age in years. A listing that never stated
 *     its age is excluded when either bound is set, rather than treated as new: unstated is not
 *     zero, and floating silent listings above honest ones rewards the omission.
 * @param maxAge     inclusive upper bound; the UI's top of range is an open "25+", which it signals
 *     by simply omitting this.
 * @param minFloor   inclusive lower bound on floor number.
 * @param maxFloor   inclusive upper bound on floor number.
 * @param nearLat    latitude of a "near me / near this landmark" centre.
 * @param nearLng    longitude of the same centre.
 * @param nearRadiusKm radius in kilometres. All three are required together; any one alone is
 *     ignored, because a centre without a radius and a radius without a centre are both incomplete
 *     questions and neither has a sensible default.
 */
public record ListingFacets(
        List<String> types,
        List<String> bhks,
        List<String> furnishings,
        List<String> localities,
        List<String> societies,
        List<String> amenities,
        List<String> landUse,
        List<String> room,
        List<String> sharing,
        List<String> tenants,
        List<String> construction,
        String availableFrom,
        Boolean pets,
        Boolean ownerVerified,
        Boolean ownershipVerified,
        Boolean rera,
        Boolean societyVerified,
        Boolean conveyanceDone,
        BigDecimal minArea,
        BigDecimal maxArea,
        Integer minAge,
        Integer maxAge,
        Integer minFloor,
        Integer maxFloor,
        Double nearLat,
        Double nearLng,
        Double nearRadiusKm) {

    /**
     * The all-absent instance: filter on none of this. Used by the moderation search, which shares
     * the facet builder but offers none of these controls.
     */
    public static final ListingFacets NONE = new ListingFacets(
            null, null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, null, null, null,
            null, null, null, null, null, null, null, null, null);

    /**
     * The move-in buckets this request accepts, widest-first, or an empty list when unfiltered.
     *
     * <p>This is where {@code availableFrom} stops being a value and becomes a set. Kept on the
     * record rather than in the specification builder so the cumulative rule is stated once, next
     * to the field it governs, instead of being re-derived by every reader of a {@code case}
     * statement in the middle of a predicate.
     */
    public List<String> availableFromBuckets() {
        if (availableFrom == null || availableFrom.isBlank()) {
            return List.of();
        }
        return switch (availableFrom) {
            case "now" -> List.of("now");
            case "15" -> List.of("now", "15");
            case "30" -> List.of("now", "15", "30");
            // An unknown bucket is a bad request, not a wildcard: answering it with the whole
            // catalogue would look like the filter worked.
            // A token no row can hold: the column's CHECK constraint admits only the three buckets
            // above, so this matches nothing. Deliberately made of ordinary characters rather than
            // a control code, because a sentinel that only works by being rejected downstream stops
            // working the moment the sanitiser it relies on is relaxed -- and it would then fail by
            // returning the whole catalogue, which reads as success.
            default -> List.of("no.such.bucket");
        };
    }

    /** True when a centre and a radius were both supplied, so the radius predicate can be built. */
    public boolean hasNearPoint() {
        return nearLat != null && nearLng != null && nearRadiusKm != null && nearRadiusKm > 0
                && nearLat >= -90 && nearLat <= 90 && nearLng >= -180 && nearLng <= 180;
    }

    /**
     * The radius to actually search, clamped to {@value #MAX_RADIUS_KM} km.
     *
     * <p>Clamped rather than rejected: a caller asking for a wider circle than we serve has asked a
     * reasonable question badly, and the honest answer is the widest circle we do serve, not a
     * {@code 400}. The ceiling exists because the radius sizes a bounding box, and an unbounded one
     * spans the planet — which turns an anonymous, unauthenticated endpoint into a full-table scan
     * anybody can request at will. Fifty kilometres already reaches well past every locality in the
     * catalogue, so the clamp cannot cost a real search a real result.
     */
    public double effectiveRadiusKm() {
        return Math.min(nearRadiusKm, MAX_RADIUS_KM);
    }

    /** The widest radius served. Comfortably larger than the UI's slider, and finite. */
    public static final double MAX_RADIUS_KM = 50.0;
}
