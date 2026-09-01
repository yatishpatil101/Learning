package com.punenest.api.catalog.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A housing society — the unit Pune buyers and tenants actually shop in (V3 {@code societies}).
 *
 * <p><strong>Why this is a first-class table and not a string on a listing.</strong> In Pune a
 * society is the thing people name, compare and ask about: "Kumar Pinnacle" carries maintenance
 * cost, parking ratio, water supply, pet and veg policies and a RERA registration that apply to
 * every flat in it. Those facts belong to the building, not to whichever listing happens to mention
 * them, and they stay true after the listing is gone.
 *
 * <p><strong>{@code source} and {@code claim_status} are the honesty fields.</strong> A record may be
 * curated by us, bulk-imported from MahaRERA, or contributed by residents, and it may or may not have
 * been claimed by the society itself. A buyer weighs "the society says so" very differently from
 * "somebody typed this in", so the provenance travels with the data instead of being flattened away.
 *
 * <p>Read-only on this slice: rows are seeded, and the claim/follow/review writes belong to the
 * Engagement surface. Hence no setters.
 *
 * <p>{@code listing_count}, {@code follower_count}, {@code avg_rating} and {@code review_count} are
 * deliberately unmapped — all four are stored counters no code maintains. Leaving them off the entity
 * is what makes reading a wrong number impossible rather than merely inadvisable; the live values are
 * computed in {@link SocietyService}.
 */
@Entity
@Table(name = "societies")
@Getter
public class Society extends AuditedEntity {

    /** Public URL key. Unique, and the identity every {@code /societies/{slug}} route resolves. */
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "builder")
    private String builder;

    /** FK to {@code localities.slug}; nullable for bulk RERA imports we could not place. */
    @Column(name = "locality_slug")
    private String localitySlug;

    @Column(name = "lat")
    private Double lat;

    @Column(name = "lng")
    private Double lng;

    /**
     * Google Place id, when an approved resident location fix supplied one.
     *
     * <p>The only Place field persisted besides the coordinates. Ratings, photos, reviews and
     * opening hours are deliberately not stored, per the Places terms — and because every one of
     * them is a fact this product already holds a better version of.
     */
    @Column(name = "place_id")
    private String placeId;

    /**
     * Where {@link #lat}/{@link #lng} came from; {@code community} once a resident's correction was
     * approved, null for a bulk import.
     *
     * <p>The hub renders this beside the map. A coordinate lifted from a RERA filing and one a
     * neighbour walked to are both coordinates, and only one of them has been to the building.
     */
    @Column(name = "loc_source")
    private String locSource;

    /** Year built or possession year. */
    @Column(name = "year")
    private Integer year;

    @Column(name = "towers")
    private Integer towers;

    @Column(name = "units")
    private Integer units;

    /** Occupancy percentage, 0-100. {@code numeric}, so {@link BigDecimal}. */
    @Column(name = "occupancy")
    private BigDecimal occupancy;

    @Column(name = "maintenance_per_sqft")
    private BigDecimal maintenancePerSqft;

    /** Parking spaces per unit — the number that decides whether a second car is a problem. */
    @Column(name = "parking_ratio")
    private BigDecimal parkingRatio;

    @Column(name = "lifts")
    private Integer lifts;

    /**
     * The security arrangement, as free text.
     *
     * <p>Was a boolean until V15. "Is there security?" is a question every gated society answers yes
     * to, which makes the answer worthless; "3-tier + CCTV" versus "Guard at gate only" is the
     * distinction somebody choosing where to live is actually asking about. See spec fix S25.
     */
    @Column(name = "security")
    private String security;

    @Column(name = "water")
    private String water;

    @Column(name = "power")
    private String power;

    @Column(name = "pet_policy")
    private String petPolicy;

    @Column(name = "veg_policy")
    private String vegPolicy;

    /** MahaRERA registration id; null when the society predates RERA or has none. */
    @Column(name = "rera")
    private String rera;

    @Column(name = "registration", nullable = false)
    private boolean registration;

    /** Whether the conveyance deed is done — a material risk signal for a buyer. */
    @Column(name = "conveyance", nullable = false)
    private boolean conveyance;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "amenities", nullable = false)
    private List<String> amenities = new ArrayList<>();

    /** {@code curated} / {@code rera} / {@code community}; the column's CHECK is the authority. */
    @Column(name = "source")
    private String source;

    /**
     * The member who minted this society, for community-sourced rows; null for curated and RERA
     * imports, which nobody in particular typed in.
     *
     * <p>Kept so an operator reviewing a candidate can ask the person who added it, and so one
     * account minting fifty societies is visible rather than merely suspected.
     */
    @Column(name = "created_by")
    private java.util.UUID createdBy;

    /**
     * When ops confirmed this society is real; null means it is still a candidate.
     *
     * <p>A timestamp and a verifier rather than a boolean. A flag answers "has anybody checked
     * this" and nothing else, and the day two operators disagree about a society it cannot say
     * which of them set it.
     */
    @Column(name = "verified_at")
    private java.time.Instant verifiedAt;

    /** The operator who confirmed it. Moves with {@link #verifiedAt} — see V105. */
    @Column(name = "verified_by")
    private java.util.UUID verifiedBy;

    /** {@code unclaimed} / {@code pending} / {@code claimed}. */
    @Column(name = "claim_status", nullable = false)
    private String claimStatus = SocietyClaimStatus.UNCLAIMED;

    protected Society() {
        // JPA
    }

}
