package com.punenest.api.catalog.society;

import com.punenest.api.catalog.property.PropertySummary;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The contract's {@code SocietyDetail} — {@link SocietyResponse} plus the society hub's aggregates.
 *
 * <p>The spec composes this with {@code allOf}; a record cannot extend a record, so the base fields
 * are repeated. It is a flattening of one document, not a second one.
 *
 * <p><strong>{@code avgRating} and {@code reviewCount} are live as of slice 8; {@code reviews} is
 * still empty.</strong> They were deliberately null/0 before, because the {@code reviews} table's
 * {@code target_id} is untyped {@code text} and nothing had decided whether a society review keys on
 * the society's id or its slug — computing against a guessed key would have produced a number that
 * looked authoritative and silently became wrong. The Engagement slice decided it ({@code
 * ReviewTargetKey}: societies key on the immutable id, so a rename cannot orphan a review) and the
 * aggregate now comes from {@code common.trust.RatingLookup}, computed on read rather than stored.
 * {@code avgRating} is still null rather than {@code 0.0} for an unrated society: no rating is not a
 * rating of zero.
 *
 * <p>{@code reviews} remains empty by design, not by omission. A society's reviews are served paged
 * from {@code GET /reviews/society/{slug}}; inlining an unbounded array of them into the hub would
 * defeat that pagination on the one surface most likely to accumulate them.
 *
 * @param avgRating   average published rating, null when the society has no reviews
 * @param reviewCount published review count
 * @param placeId     Google Place id, when an approved resident location fix supplied one
 * @param locSource   {@code community} once a resident's corrected pin was approved; else null
 * @param mintOrigin  {@code demand} / {@code listing} — which human action minted it. Repeated here
 *                    rather than left off because the contract composes {@code SocietyDetail} from
 *                    {@code Society} with {@code allOf}: a field on the base schema that the hub did
 *                    not return would be a promise to every generated client that this endpoint
 *                    silently breaks, and the parity test cannot see it — it skips {@code allOf}
 *                    schemas by design
 * @param verifiedAt  when ops confirmed a community-minted society is real; null while it is still
 *                    a candidate, and null for curated and RERA rows, which are verified by
 *                    construction
 * @param createdAt   when the row appeared. Repeated here for the same reason {@code mintOrigin}
 *                    is: it is on the base schema, and a base field the hub does not return is a
 *                    promise the parity test is structurally unable to catch
 * @param homes       live listings in this society
 * @param reviews     always empty; reviews are a separate, paged resource
 */
public record SocietyDetailResponse(
        UUID id,
        String slug,
        String name,
        String builder,
        String localitySlug,
        Double lat,
        Double lng,
        String placeId,
        String locSource,
        Integer year,
        Integer towers,
        Integer units,
        BigDecimal occupancy,
        BigDecimal maintenancePerSqft,
        BigDecimal parkingRatio,
        Integer lifts,
        String security,
        String water,
        String power,
        String petPolicy,
        String vegPolicy,
        String rera,
        boolean registration,
        boolean conveyance,
        List<String> amenities,
        String source,
        String mintOrigin,
        java.time.Instant verifiedAt,
        String claimStatus,
        long listingCount,
        long followerCount,
        boolean followedByMe,
        BigDecimal avgRating,
        long reviewCount,
        java.time.Instant createdAt,
        List<PropertySummary> homes,
        List<Object> reviews) {
}
