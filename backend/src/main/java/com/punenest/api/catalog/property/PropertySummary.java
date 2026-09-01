package com.punenest.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Card projection for search/lists (contract {@code PropertySummary}). This is the lightweight
 * entity↔wire boundary for the catalogue: it deliberately carries <em>no</em> owner contact — search
 * results never expose a phone number (the contact gate lives on the detail path), and the JPA
 * entity is never serialized directly, so internal columns can't leak.
 *
 * @param id           opaque listing id
 * @param slug         URL key (nullable until curated)
 * @param deal         buy|rent
 * @param propertyType free-text type (e.g. apartment)
 * @param bhk          bedroom count (whole-number-safe {@link BigDecimal})
 * @param price        amount in whole INR
 * @param priceUnit    {@code total} (buy) or {@code per-month} (rent)
 * @param area         built area value
 * @param areaUnit     area unit (default sqft)
 * @param possession   possession state ({@link PropertyPossession}), nullable when not stated
 * @param locality     display locality name (the slug is the filter key, not this)
 * @param localitySlug curated locality key (FK to {@code localities.slug}); the value the
 *                     {@code locality} search facet matches on. Nullable when the listing's
 *                     free-text locality resolved to no curated locality.
 * @param coverImage   card image, nullable
 * @param imageCount   how many photos the listing has, <em>not</em> the photos themselves.
 *                     <p>A count rather than the array because the only question the card surface
 *                     asks of the gallery is "is there enough here", and shipping five URLs per row
 *                     on a hundred-row page to answer a yes/no is several times the payload for none
 *                     of the benefit — search results never render a second photo.
 *                     <p>It exists because the reels feed cannot ask that question any other way.
 *                     Reels is a walkthrough, so it requires three frames; it read `gallery.length`
 *                     off the list row, the list row has never carried `images`, and so every
 *                     listing scored zero and the feed was permanently empty. The number is the
 *                     cheapest honest answer: the feed filters on it and then fetches detail only
 *                     for the handful that pass, instead of fetching every listing to discover that
 *                     most of them do not.
 *                     <p>Counted from the stored array on each read rather than denormalised into a
 *                     column, for the same reason the trust counters are: a stored count is one
 *                     write away from disagreeing with the thing it counts, and it disagrees
 *                     silently.
 * @param verified     listing "Verified" badge (L2 signal, never a gate)
 * @param ownerVerified the <em>person</em> who posted this passed Aadhaar/DigiLocker. Denormalised
 *                     from the owner onto the listing, and carried here rather than only on detail
 *                     because the card is where a buyer decides what to open: a trust signal that
 *                     only appears after the click cannot influence the click. Omitting it made the
 *                     live search results badge-free for everyone while the detail page badged
 *                     correctly — a silent regression, since every field the card wanted existed.
 * @param ownershipVerified the listing's <em>paperwork</em> checked out and has not expired. A
 *                     separate axis from {@code ownerVerified}: either can be true alone, and
 *                     merging them lets a listing claim a check its owner never took.
 * @param postedByType owner|agent|builder, nullable
 * @param status       moderation status (always {@code approved} on public results)
 * @param dealStatus   deal outcome ({@code active|reserved|closed}); {@code reserved} badges a card
 *                     "under offer" without an extra fetch (D110)
 * @param boosted      the owner is paying for this listing's position in the default order (D59).
 *                     Present so the card can <em>disclose</em> paid placement rather than only
 *                     benefit from it — ranking a listing higher for money without saying so is an
 *                     undisclosed ad. Computed from the promotion window against request time, so
 *                     it is never stale. It is a label, not a capability: nothing is gated on it.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertySummary(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        String priceUnit,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String possession,
        String locality,
        String localitySlug,
        String city,
        Double lat,
        Double lng,
        String coverImage,
        int imageCount,
        boolean verified,
        boolean ownerVerified,
        boolean ownershipVerified,
        String postedByType,
        String status,
        String dealStatus,
        boolean boosted,
        Instant createdAt,
        /**
         * When the owner last confirmed this listing is still available (V86); {@code null} until
         * somebody has. The buyer-facing half of the freshness signal — a card that says "confirmed
         * available 2 days ago" is making a claim the platform can stand behind, and one that falls
         * back to the posting date is making a weaker claim honestly.
         */
        Instant lastConfirmedAt) {
}
