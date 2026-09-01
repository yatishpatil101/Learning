package com.punenest.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

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
 * @param landUse      permitted zoning for plots/farm land; null for buildings (see the component
 *                     javadoc below for why a card needs it)
 * @param locality     display locality name (the slug is the filter key, not this)
 * @param localitySlug curated locality key (FK to {@code localities.slug}); the value the
 *                     {@code locality} search facet matches on. Nullable when the listing's
 *                     free-text locality resolved to no curated locality.
 * @param societySlug  the society this home is actually in, or {@code null} when the owner did not
 *                     name one (D19). The slug rather than {@code society_id} because the slug is
 *                     the society's public key everywhere else — {@code /societies/{slug}}, the hub
 *                     route, the client's own catalogue — so a UUID would tell a client a society
 *                     exists while giving it no way to name one.
 *                     <p>On the card and not only on detail because the client's society filter and
 *                     its "N homes" counts are computed over a page of results. Without it, the
 *                     honest answer to "which of these are in Skyline Heights" is unobtainable, and
 *                     the answer that was given instead came from hashing the listing id.
 *                     <p>Null is a real and common answer, and it must read as "we do not know"
 *                     rather than as any particular society.
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
        /**
         * Permitted zoning for an open plot or farm land ({@code residential|commercial|industrial|
         * agricultural|mixed}); {@code null} for anything with a building on it, which is the
         * common case.
         *
         * <p>On the card because {@link Property#getLandUse()} calls it "a search facet, not a
         * detail — a buyer must be able to exclude the zoning they cannot use before they ever
         * open a listing", and a facet the list payload does not carry cannot filter a list. V95
         * shipped the column and the detail shape; this half was missed, so the browser filtered
         * plots by {@code LANDUSE_ZONES[hashId(id) % 4]} and a buyer who excluded agricultural
         * land was served a set chosen by a hash of the slug.
         *
         * <p>Same failure and same remedy as {@code societySlug} above. Zoning decides whether a
         * plot can legally be built on at all, so a fabricated answer here is not a bad
         * recommendation, it is a bad purchase.
         */
        String landUse,
        /**
         * The eleven attributes below exist for exactly the reason {@code landUse} above does, and
         * were missing for exactly the same reason. V95 gave every one of them a column and a
         * {@link ListingFacets} predicate, so the database can already filter on them — but the
         * card shape carried none of them, and the listings grid filters client-side over this
         * shape. A predicate the payload cannot express is a predicate the grid cannot honour.
         *
         * <p>What the grid did instead was invent them. Every one of these was derived in the
         * browser from {@code fnvHash(listing.id)}: age as {@code (h >> 16) % 26}, floor as
         * {@code (h >> 20) % 41}, the pet policy as {@code (h >> 8) % 3 === 0}, and the society's
         * verification status as {@code (h >> 12) % 2 === 0} — a coin flip, tuned to look like a
         * plausible 50% so nobody would notice. A buyer filtering for "conveyance done" was being
         * served listings selected by arithmetic on a slug.
         *
         * <p>These are on the card and not merely on the detail shape because each one is a
         * <em>filter</em>. {@code PropertyResponse} reasoned that their job "is to be filtered on
         * — which now happens in SQL"; that holds only once the client actually asks SQL to do it.
         * Until then the card must carry what the card filters on, or the fallback is fabrication.
         *
         * <p>Null is meaningful and must survive the round trip: a null {@code ageYears} means the
         * owner never stated an age, which is not the same as a new building, and a null
         * {@code facing} means unknown, which is not a direction. {@code tenants} and
         * {@code sharing} are {@code NOT NULL} jsonb arrays that default to empty — empty means
         * "no restriction stated", not "no tenants permitted".
         */
        Integer ageYears,
        Integer floor,
        Integer totalFloors,
        String facing,
        String room,
        List<String> tenants,
        String availableFrom,
        boolean pets,
        List<String> sharing,
        /**
         * The society has been verified as a real, registered body, and its conveyance (transfer of
         * land title from builder to society) is complete. Legal facts about a named society, not
         * opinions about a listing — which is why a fabricated value here was the worst of the set.
         * Both are narrow-only filters server-side: false never widens a result, so a false here is
         * safe, and an invented true was not.
         */
        boolean societyVerified,
        boolean conveyanceDone,
        String locality,
        String localitySlug,
        String societySlug,
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
        /**
         * The platform is promoting this listing editorially (not a paid placement — that is
         * {@code boosted}). On the card because the card is where the badge renders; it was
         * previously absent from this shape entirely, so the browser fell back to a
         * {@code featuredUntil} field that has never existed on the server and the badge was
         * simply never shown on live search results.
         */
        boolean featured,
        /**
         * Listing completeness, 0–100, generated by the database (V94). See {@link Freshness} and
         * the V94 header for the weights and for which of the browser's inputs had no column.
         *
         * <p>Nullable, and absent from the payload when null rather than defaulted to zero. Null
         * means "this instance has not been read back since it was written" — a generated column
         * has no value on the in-memory row a create or update just built — and a card that
         * printed 0 for a complete listing would be worse than one that prints nothing. Every
         * read path returns a real number.
         */
        Integer qualityScore,
        /**
         * How recently the owner confirmed availability: {@code active|aging|stale|dormant}. See
         * {@link Freshness}.
         *
         * <p>Derived per request from {@code lastConfirmedAt} against the server clock, so it is
         * never stale in the way a stored tier would be. Sent alongside {@code lastConfirmedAt}
         * rather than instead of it: the timestamp is what the card renders ("confirmed 2 days
         * ago"), the tier is what decides tone and ordering, and having the client re-derive the
         * second from the first is how the definition drifted onto the browser in the first place.
         */
        String freshness,
        Instant createdAt,
        /**
         * When the owner last confirmed this listing is still available (V86); {@code null} until
         * somebody has. The buyer-facing half of the freshness signal — a card that says "confirmed
         * available 2 days ago" is making a claim the platform can stand behind, and one that falls
         * back to the posting date is making a weaker claim honestly.
         */
        Instant lastConfirmedAt) {
}
