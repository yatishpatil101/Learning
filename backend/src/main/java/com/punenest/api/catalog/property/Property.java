package com.punenest.api.catalog.property;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import com.punenest.api.identity.user.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A marketplace listing — the catalogue aggregate the whole platform hangs off. Maps the
 * {@code properties} table (V3); the contract's {@code PropertySummary}/{@code Property} shapes are
 * derived from it at the wire boundary (never serialized directly).
 *
 * <p>Only the columns the catalogue slice actually reads/writes are mapped — Hibernate
 * {@code ddl-auto=validate} checks mapped columns exist and match, so an unmapped column (e.g. the
 * admin-pipeline set, deferred to the moderation slice) is simply ignored. Enum-like {@code text}
 * columns ({@code deal}/{@code status}/{@code furnishing}/…) are {@code String} to mirror the
 * schema's "text + CHECK" policy — cheapest to evolve; the DTO layer validates allowed values.
 *
 * <p>Money columns ({@code price}/{@code deposit}/{@code maintenance}) are {@code Long} (contract
 * {@code Money} = whole-INR int64). {@code numeric} measures ({@code bhk}/{@code area}/…) are
 * {@link BigDecimal} so a whole number serializes as {@code 3}, not {@code 3.0}. JSON arrays
 * ({@code amenities}/{@code images}) map through {@link SqlTypes#JSON}.
 *
 * <p>Invariants this entity helps enforce (server-side, not just in the UI): new listings start
 * {@code pending} with a server-set owner; editing a foundation field that changes <em>what the
 * listing is</em> (bhk/propertyType/locality/deal) reverts {@code status} to {@code pending}, while
 * editing one that changes only an attribute of it (price/furnishing/possession) raises a re-check
 * and leaves the listing searchable (Q14); restore-from-archive also resets to {@code pending};
 * soft-delete only (the {@code archived} triplet from {@link SoftDeleteEntity}).
 */
@Entity
@Table(name = "properties")
@Getter
public class Property extends SoftDeleteEntity {

    /** Human-friendly URL key; nullable + {@code UNIQUE}. Lookups fall back to the UUID id. */
    @Column(name = "slug")
    @Setter
    private String slug;

    /**
     * The listing owner. {@code LAZY} + fetched via an entity graph on the finders that build detail
     * DTOs, so the owner summary (name + masked mobile + badge) is available at the wire edge without
     * an N+1 per row. Search summaries never touch it, so those queries pay nothing for it.
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    private User owner;

    @Column(name = "title", nullable = false)
    @Setter
    private String title;

    @Column(name = "deal", nullable = false)
    @Setter
    private String deal;

    @Column(name = "property_type", nullable = false)
    @Setter
    private String propertyType;

    @Column(name = "bhk")
    @Setter
    private BigDecimal bhk;

    @Column(name = "price", nullable = false)
    @Setter
    private Long price;

    @Column(name = "price_unit")
    @Setter
    private String priceUnit;

    @Column(name = "deposit")
    @Setter
    private Long deposit;

    @Column(name = "maintenance")
    @Setter
    private Long maintenance;

    @Column(name = "negotiable")
    @Setter
    private Boolean negotiable;

    @Column(name = "area")
    @Setter
    private BigDecimal area;

    @Column(name = "area_unit")
    @Setter
    private String areaUnit = "sqft";

    @Column(name = "carpet_area")
    @Setter
    private BigDecimal carpetArea;

    @Column(name = "built_up_area")
    @Setter
    private BigDecimal builtUpArea;

    @Column(name = "super_built_up_area")
    @Setter
    private BigDecimal superBuiltUpArea;

    @Column(name = "furnishing")
    @Setter
    private String furnishing;

    @Column(name = "floor")
    @Setter
    private Integer floor;

    @Column(name = "total_floors")
    @Setter
    private Integer totalFloors;

    @Column(name = "facing")
    @Setter
    private String facing;

    @Column(name = "possession")
    @Setter
    private String possession;

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    /**
     * Slug link to {@code localities} — the catalogue's real locality key. FK-constrained, so it can
     * only ever hold a curated slug. Set server-side from the free-text {@code locality} by
     * {@code LocalityResolver} on create and on a locality edit; {@code null} when nothing resolved
     * confidently, which leaves the listing out of locality facets until a moderator curates it.
     *
     * <p>The public {@code locality} search facet filters on <em>this</em> column, while the response
     * emits both: {@code locality} (display name) and {@code localitySlug} (the key clients filter
     * and route on).
     */
    @Column(name = "locality_slug")
    @Setter
    private String localitySlug;

    /**
     * The society this listing sits in, as a bare id rather than a {@code @ManyToOne} association.
     *
     * <p>Nothing on the listing surface needs a society's name, amenities or occupancy — only the
     * society hub does, and it starts from the society and looks up its homes. Mapping this as an
     * association would buy a lazy proxy that every page of search results risks initialising, for
     * a field no listing response emits. The id is enough to answer "which homes are in this
     * society?", which is the only question asked of it.
     */
    @Column(name = "society_id")
    @Setter
    private UUID societyId;

    @Column(name = "city", nullable = false)
    @Setter
    private String city = "Pune";

    @Column(name = "lat")
    @Setter
    private Double lat;

    @Column(name = "lng")
    @Setter
    private Double lng;

    @Column(name = "address")
    @Setter
    private String address;

    @Column(name = "pincode")
    @Setter
    private String pincode;

    @Column(name = "rera_id")
    @Setter
    private String reraId;

    @Column(name = "description")
    @Setter
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "amenities", nullable = false)
    @Setter
    private List<String> amenities = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "images", nullable = false)
    @Setter
    private List<String> images = new ArrayList<>();

    @Column(name = "cover_image")
    @Setter
    private String coverImage;

    @Column(name = "floor_plan")
    @Setter
    private String floorPlan;

    @Column(name = "video")
    @Setter
    private String video;

    @Column(name = "posted_by_type")
    @Setter
    private String postedByType;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = PropertyStatus.PENDING;

    // Read-side mirror of deals.status (D110). Authored vocabulary + transitions live in
    // deals.deal.DealStatuses; this column is kept in sync by DealService in the same transaction as
    // every deal-status change, so the catalogue can surface "under offer" without an owner-scoped
    // join. The default literal matches DealStatuses.ACTIVE without importing it, which would point
    // catalog at deals and close a package cycle. The V37 CHECK guards the legal set.
    @Column(name = "deal_status", nullable = false)
    @Setter
    private String dealStatus = "active";

    @Column(name = "featured", nullable = false)
    @Setter
    private boolean featured = false;

    // Read-side mirror of the newest active boost window's end (D59), same shape and same reason as
    // deal_status above: billing.boost already reads catalog, so ranking by a join into `boosts`
    // would invert that and close a package cycle. BoostService keeps this in sync in the same
    // transaction as every activation. Null = never boosted. A past value is left in place rather
    // than swept, so ranking compares against now() instead of trusting the flag to be current.
    @Column(name = "boosted_until")
    @Setter
    private Instant boostedUntil;

    /**
     * Is a paid promotion window open right now? (D59)
     *
     * <p>Derived rather than stored so it cannot go stale, and lives here rather than as a MapStruct
     * {@code expression=} so the rule sits next to the column it reads — see {@link PropertyMapper},
     * whose contract is that mechanical fields are generated and judgements are authored. This is
     * the value {@code PropertySummary.boosted} discloses to buyers; nothing is gated on it.
     */
    public boolean isBoosted() {
        return boostedUntil != null && boostedUntil.isAfter(Instant.now());
    }

    @Column(name = "flag_reason")
    @Setter
    private String flagReason;

    /**
     * The stays-live moderation work item (Q14, V62). Set when an owner edits a foundation field
     * that does not change what the listing fundamentally is — {@code price}, {@code furnishing},
     * {@code possession} — so the edit is queued for a moderator <em>without</em> the listing
     * leaving search.
     *
     * <p>Deliberately shaped like {@link #flagReason} beside {@link #status}: a nullable timestamp
     * that is the queue entry (its age is the SLA a "live but flagged" control needs to be worth
     * anything) plus a reason the moderator reads. What it is <em>not</em> is a status value —
     * every status other than {@code approved} is off search, which is precisely the cost this
     * exists to avoid paying.
     */
    @Column(name = "recheck_requested_at")
    private Instant recheckRequestedAt;

    /** Which fields raised the pending re-check, accumulated across edits (Q14). */
    @Column(name = "recheck_reason")
    private String recheckReason;

    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "owner_verified", nullable = false)
    @Setter
    private boolean ownerVerified = false;

    @Column(name = "ownership_verified", nullable = false)
    @Setter
    private boolean ownershipVerified = false;

    @Column(name = "society_verified", nullable = false)
    @Setter
    private boolean societyVerified = false;

    @Column(name = "conveyance_done", nullable = false)
    @Setter
    private boolean conveyanceDone = false;

    @Column(name = "docs_count", nullable = false)
    @Setter
    private int docsCount = 0;

    @Column(name = "views", nullable = false)
    @Setter
    private int views = 0;

    @Column(name = "enquiries", nullable = false)
    @Setter
    private int enquiries = 0;

    protected Property() {
        // JPA
    }

    /**
     * Create a listing with the minimum a new post requires; callers layer optional fields on via
     * setters. The status/owner defaults are applied by the service so this stays a dumb constructor.
     */
    public Property(User owner, String title, String deal, String propertyType, Long price,
            String locality, String city) {
        this.owner = owner;
        this.title = title;
        this.deal = deal;
        this.propertyType = propertyType;
        this.price = price;
        this.locality = locality;
        this.city = city;
    }

    /** Public visibility floor: only approved, non-archived rows are shown to anonymous callers. */
    public boolean isPubliclyVisible() {
        return !isArchived() && PropertyStatus.APPROVED.equals(status);
    }

    /**
     * Direct-link reachability (D110): a listing resolves on the public detail path when it is
     * approved OR terminal (sold/rented). The terminal rows are absent from search — floored to
     * {@code approved} — but a buyer who already holds the link must still be able to open the page
     * and see the sold/rented badge rather than a 404. Pending/rejected/flagged/archived stay
     * unreachable, so this does not reveal an unpublished listing.
     */
    public boolean isDirectlyReachable() {
        return !isArchived() && (PropertyStatus.APPROVED.equals(status)
                || PropertyStatus.SOLD.equals(status) || PropertyStatus.RENTED.equals(status));
    }

    /**
     * Re-moderation trigger: an identity-changing foundation edit (or a restore) sends the listing
     * back to review. Any pending re-check is dropped — a full re-moderation looks at the whole
     * listing, so leaving one queued would put the same edit in front of a moderator twice.
     */
    public void revertToPending() {
        this.status = PropertyStatus.PENDING;
        clearRecheck();
    }

    /**
     * Raise the stays-live moderation work item (Q14): the listing keeps its {@code approved} status
     * and stays in search while a moderator re-checks the named fields.
     *
     * <p>Only raised on a publicly visible listing, because that is the only case where "stays live"
     * means anything. A pending or flagged listing is already in front of a moderator and a second
     * work item for the same row would just be queue noise; an archived one is not visible to
     * anybody, and restoring it reverts to {@code pending} anyway.
     *
     * <p>The timestamp is kept at the <em>first</em> unreviewed edit rather than refreshed on each
     * one, so a queue sorted by age tells the truth: an owner editing their price daily must not be
     * able to keep resetting their own place in the queue to the back.
     *
     * @param fields the fields that earned the re-check, in the wire vocabulary
     */
    public void requestRecheck(List<String> fields) {
        if (fields == null || fields.isEmpty() || !isPubliclyVisible()) {
            return;
        }
        LinkedHashSet<String> merged = new LinkedHashSet<>();
        if (recheckReason != null && !recheckReason.isBlank()) {
            Collections.addAll(merged, recheckReason.split(",\\s*"));
        }
        merged.addAll(fields);
        this.recheckReason = String.join(", ", merged);
        if (recheckRequestedAt == null) {
            this.recheckRequestedAt = Instant.now();
        }
    }

    /** A moderator has looked: drop the work item. Idempotent. */
    public void clearRecheck() {
        this.recheckRequestedAt = null;
        this.recheckReason = null;
    }

    /** Is a stays-live re-check queued on this listing? (Q14) */
    public boolean isRecheckPending() {
        return recheckRequestedAt != null;
    }

}
