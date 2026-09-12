package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Create-a-listing request (contract {@code ListingCreate}). Validation mirrors the spec's
 * {@code required} set and the enum constraints, so a bad body fails fast at the controller with a
 * {@code 422} before any business logic runs.
 *
 * <p>Deliberately absent (server-owned, never client-supplied — prevents self-escalation / spoofing):
 * {@code status} (forced {@code pending}), {@code owner} (the authenticated caller),
 * {@code priceUnit} (derived from {@code deal}), {@code postedByType} (defaulted {@code owner}),
 * {@code verified}/{@code featured}/counters. Money fields are whole INR ({@code Long}); {@code bhk}
 * and areas are numeric.
 *
 * @param deal         buy|rent (required)
 * @param propertyType free-text type (required)
 * @param price        amount in whole INR (required, positive)
 * @param deposit      security deposit (rent), nullable
 * @param maintenance  monthly maintenance, nullable
 * @param area         built area value, nullable
 * @param areaUnit     area unit, defaults sqft when null
 * @param reraId       MahaRERA id, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable = not stated
 * @param images       image URLs, nullable
 * @param address      street address, nullable; normalised server-side into the duplicate key (V79)
 * @param floor        which floor the unit is on, nullable; part of the society duplicate signal
 * @param societyId    the society this unit sits in, nullable
 * @param electricityMeterNo the unit's meter number, nullable; never returned to the public
 */
public record ListingCreate(
        @NotBlank String title,
        @NotNull @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        @NotBlank String propertyType,
        BigDecimal bhk,
        @NotNull @Positive Long price,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        BigDecimal area,
        String areaUnit,
        @Pattern(regexp = Furnishing.PATTERN,
                message = Furnishing.PATTERN_MESSAGE) String furnishing,
        @NotBlank String locality,
        @NotBlank String city,
        Double lat,
        Double lng,
        String reraId,
        @Pattern(regexp = PropertyPossession.PATTERN,
                message = PropertyPossession.PATTERN_MESSAGE) String possession,
        List<String> amenities,
        List<String> images,
        String description,
        /* Bounded because both this and electricityMeterNo land in btree indexes (V79). Postgres
         * refuses an index entry over ~2704 bytes, and the refusal surfaces as a 500 on a route any
         * authenticated account can call — a denial of service that costs one long string. The
         * limits are generous against a real Indian address and a real MSEDCL consumer number. */
        @Size(max = 300) String address,
        Integer floor,
        /* A claim, not a credential. Pointing a listing at a society the owner is not in is exactly
         * the sort of thing the verification checklist exists to catch, and it is already visible to
         * a moderator in the society name on the case file. Accepting it is what lets the
         * (society, floor, bhk) duplicate signal fire at all — a signal whose whole value is that
         * society_id is a curated id rather than free text, so it cannot be fudged by spelling. */
        UUID societyId,
        @Size(max = 64) String electricityMeterNo,
        /* The four detail answers the wizard has always collected and then thrown away. Every one
         * of these had a form control, a value in the draft, and no field on this record — so
         * `toListingCreate` dropped them one function before the fetch and the owner's answer never
         * left the browser. Two of them (facing, totalFloors) already had a column, an entity field
         * and a place on the read contract; they were missing only from the write side, which is
         * the exact shape of a field that reads back empty forever. Bathrooms and parking are new
         * in V114.
         *
         * All four are optional and all four are non-foundation edits: changing a bathroom count
         * does not change what the moderator approved, so none of them belongs in the tier lists in
         * ListingEditRules. */
        @Min(0) Integer bathrooms,
        @Min(0) Integer parking,
        @Min(0) Integer balconies,
        /* Bounded but not enumerated. The wizard offers ten compass and outlook values, the column
         * is bare text with no CHECK, and rows predating this already hold whatever the seed and the
         * admin on-behalf form put there. A @Pattern here would start rejecting bodies that the
         * database still accepts and that the read path still returns, which trades a silent drop
         * for a loud 422 on data we have not audited. The size cap is the part that has to exist. */
        @Size(max = 32) String facing,
        @Min(1) Integer totalFloors,
        /* Age in whole years, matching the column. The wizard collects a band, not a number, and the
         * client sends the band's lower bound — which is lossless, because the bands are contiguous
         * with distinct floors (new=0, 1-5=1, 5-10=5, 10-15=10, 15+=15) so the band is recoverable
         * from the integer. `under-construction` sends nothing at all: that is a possession state,
         * not an age, and `possession` already carries it. Null stays "the owner never said", which
         * V95 is explicit is not the same as zero. */
        @Min(0) Integer ageYears,
        /* Perceptual hashes of the photographs the owner picked, 16 hex characters each, computed in
         * the browser because hashing pixels needs a canvas (V116). Accepted here rather than derived
         * server-side for a reason that is about the moment rather than the capability: the wizard
         * hashes what was selected, before anything is uploaded, so at this point in the flow the
         * server has never seen the images.
         *
         * Unvalidated beyond the size cap on purpose. These are not an owner's answer to anything —
         * there is no form control, no error the wizard could render against them, and no way for an
         * owner to correct one. A malformed entry costs a duplicate signal and is dropped silently by
         * `PhotoHash.parse`; a 422 here would fail an honest post over a number its author cannot
         * see. The cap is the part that has to exist, for the same denial-of-service reason as
         * `address` above: this list becomes rows, and rows become index entries. */
        @Size(max = PhotoHash.MAX_PER_LISTING) List<String> photoHashes) {
}
