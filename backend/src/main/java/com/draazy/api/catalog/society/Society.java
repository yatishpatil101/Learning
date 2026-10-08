package com.draazy.api.catalog.society;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Read-only, so no setters. {@code listing_count}, {@code follower_count}, {@code avg_rating} and {@code review_count} are
 * unmapped because no code maintains them; {@link SocietyService} computes the live values. */
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

    /** The only Place field persisted besides coordinates; ratings, photos and reviews are not stored, per the Places terms. */
    @Column(name = "place_id")
    private String placeId;

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

    /** Free text: a yes/no is worthless, while "3-tier + CCTV" vs "Guard at gate only" is what buyers weigh. */
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

    /** What a person was doing when minting the row (ops reads this); a separate axis from {@link #source}.
     * Null means not recorded, not "not demand". */
    @Column(name = "mint_origin")
    private String mintOrigin;

    /** Who minted a community row, so ops can ask them and spot one account minting many; null otherwise. */
    @Column(name = "created_by")
    private java.util.UUID createdBy;

    /** A pointer, not a move: rewriting references onto the survivor would be irreversible. Exactly one hop,
     * enforced by {@link SocietyMergeService}, so readers resolve with one lookup. */
    @Column(name = "merged_into")
    private java.util.UUID mergedInto;

    /** When the merge was recorded. Moves with {@link #mergedInto} — see V111. */
    @Column(name = "merged_at")
    private java.time.Instant mergedAt;

    /** Moves with {@link #mergedInto} under {@code ck_society_merged_trio}. */
    @Column(name = "merged_by")
    private java.util.UUID mergedBy;

    /** Archived out of the public catalogue; existing bindings stay, new ones are refused. */
    @Column(name = "archived_at")
    private java.time.Instant archivedAt;

    /** Moderator prose about a named building: it must never reach {@link SocietyResponse}, which anonymous reads serve.
     * A cleared note is stored as null, not blank. */
    @Column(name = "admin_note")
    private String adminNote;

    protected Society() {
        // JPA
    }

}
