package com.draazy.api.catalog.property;

import com.draazy.api.common.persistence.SoftDeleteEntity;
import com.draazy.api.identity.user.User;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Formula;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The catalogue aggregate mapping the {@code properties} table; wire shapes derive from it at the
 * boundary. Column-type and invariant rationale: docs/system/data-model.md#catalogue-entity-notes.
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
     * The listing owner, fetched via an entity graph on the detail finders so the owner summary
     * costs no N+1; search summaries never touch it.
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

    /**
     * Canonical filter key behind {@link #propertyType}'s free text (V98), generated and read-only:
     * chip filtering needs a fixed key an index can answer, not a substring scan.
     */
    @Column(name = "property_type_key", insertable = false, updatable = false)
    private String propertyTypeKey;

    /**
     * Canonical commercial subtype (V99), generated and read-only: {@link #propertyTypeKey}
     * collapses every commercial label, leaving the Office/Shop/Warehouse sub-filter nothing to use.
     */
    @Column(name = "commercial_use_key", insertable = false, updatable = false)
    private String commercialUseKey;

    /**
     * Share flag derived from {@link #room} (generated, read-only). Without it a share posted as
     * "Flat" keys as {@code flat}, so a whole-unit Flat search returns shared rooms.
     */
    @Column(name = "share_type", insertable = false, updatable = false)
    private String shareType;

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

    /** Stored separately from facing so a home can state both compass direction and view. */
    @Column(name = "overlooking")
    @Setter
    private String overlooking;

    /**
     * Bathroom count, full and half together (V114). {@code null} means unstated, {@code 0} means
     * none — a shop or plot legitimately has none, and a synthesised number would be confidently wrong.
     */
    @Column(name = "bathrooms")
    @Setter
    private Integer bathrooms;

    /**
     * Dedicated parking slots conveyed with the unit (V114) — a count, not the "4-Wheeler Parking"
     * amenity token. {@code null} = unstated, {@code 0} = none.
     */
    @Column(name = "parking")
    @Setter
    private Integer parking;

    /**
     * Balcony count (V114), stated rather than derived from the bedroom count.
     * {@code null} = unstated, {@code 0} = none.
     */
    @Column(name = "balconies")
    @Setter
    private Integer balconies;

    @Column(name = "possession")
    @Setter
    private String possession;

    /**
     * Permitted zoning for an open plot or farm land (V95); null once there is a building on it. A
     * search facet, not a detail: the wrong zoning is a dead purchase, not a disappointment.
     */
    @Column(name = "land_use")
    @Setter
    private String landUse;

    /**
     * Age of the construction in years (V95). {@code null} is absent, never zero — reading unstated
     * as brand-new would float every lazy listing above the honest ones in filters and scoring.
     */
    @Column(name = "age_years")
    @Setter
    private Integer ageYears;

    /**
     * Flatmate room shape (V95): {@code single} for a private room, {@code shared} for a bed in a
     * shared room. Null for every listing that is not a flatmate share.
     */
    @Column(name = "room")
    @Setter
    private String room;

    /**
     * Who the owner will rent to (V95). A list because "family or company, no bachelors" is the
     * ordinary Pune position; empty means no preference and must match every tenant filter.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tenants", nullable = false)
    @Setter
    private List<String> tenants = new ArrayList<>();

    /**
     * Move-in bucket (V95): {@code now}, {@code 15} or {@code 30} days; null when unstated. A bucket
     * because a date nobody edits goes stale; the filter is cumulative and widened by the query.
     */
    @Column(name = "available_from")
    @Setter
    private String availableFrom;

    /**
     * Pets allowed (V95). Not nullable: to a tenant with a dog "unstated" and "no" are the same
     * answer, so a third state would complicate every predicate and change nobody's decision.
     */
    @Column(name = "pets", nullable = false)
    @Setter
    private boolean pets = false;

    /**
     * Listing completeness, 0–100, generated and read-only (V94): it orders search results, and an
     * ordering the database cannot see cannot be paged. Weights and reasoning live in V94.
     */
    @Column(name = "quality_score", insertable = false, updatable = false)
    private Short qualityScore;

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    /**
     * FK slug into {@code localities}, resolved server-side; null when nothing resolved confidently.
     * The public locality facet filters on this, while responses emit both name and slug.
     */
    @Column(name = "locality_slug")
    @Setter
    private String localitySlug;

    /**
     * The society this listing sits in, as a bare id: an association would buy a lazy proxy every
     * page of search results risks initialising, and the id answers both questions asked of it.
     */
    @Column(name = "society_id")
    @Setter
    private UUID societyId;

    /**
     * The bound society's public key, which clients route on; a formula so no second copy can drift.
     * Setter stamps a just-written row for its own response — docs/system/data-model.md#society-slug.
     */
    @Formula("(select s.slug from societies s where s.id = society_id)")
    @Setter
    private String societySlug;

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

    /**
     * The unit's electricity meter number (V79) — optional, since bulk-metered societies have none.
     * Never emitted in a response: with a surname it is enough to impersonate a utility consumer.
     */
    @Column(name = "electricity_meter_no")
    @Setter
    private String electricityMeterNo;

    /**
     * {@link #electricityMeterNo} normalised for the duplicate probe (V115) — see {@link MeterKey}.
     * Server-derived, never client-supplied: {@code "1700 1234 5678"} is not a different meter.
     */
    @Column(name = "electricity_meter_key")
    @Setter
    private String electricityMeterKey;

    /**
     * {@link #address} normalised for comparison (V79), server-derived via {@code AddressKey}: a
     * client that chooses its own key chooses which listings it collides with.
     */
    @Column(name = "address_key")
    @Setter
    private String addressKey;

    @Column(name = "pincode")
    @Setter
    private String pincode;

    /** Private, validated edit answers; never included in public projections. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "form_details")
    @Setter
    private Map<String, Object> formDetails;

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
    private String status = PropertyStatus.PENDING;

    @Column(name = "lifecycle_track", nullable = false)
    private String lifecycleTrack = "owner";

    @Column(name = "lifecycle_stage")
    private String lifecycleStage = "submitted";

    // Staff has no verified stage; this records the publication prerequisite on either track.
    @Column(name = "lifecycle_verified_at")
    private Instant lifecycleVerifiedAt;

    @jakarta.persistence.Version
    @Column(name = "version", nullable = false)
    private long version;

    public void setStatus(String status) {
        this.status = status;
        if (PropertyStatus.APPROVED.equals(status)) {
            this.lifecycleStage = "live";
        } else {
            this.lifecycleVerifiedAt = null;
            this.lifecycleStage = PropertyStatus.PENDING.equals(status) && "owner".equals(lifecycleTrack)
                    ? "submitted" : null;
        }
    }

    public void recordLifecycleStage(String stage) {
        this.lifecycleStage = stage;
    }

    public void recordLifecycleVerification() {
        this.lifecycleVerifiedAt = Instant.now();
        if (!PropertyStatus.APPROVED.equals(status) && "owner".equals(lifecycleTrack)) {
            this.lifecycleStage = "verified";
        }
        clearRecheck();
    }

    public void recordLifecycleMedia() {
        if ("staff".equals(lifecycleTrack) && PropertyStatus.PENDING.equals(status) && !isArchived()) {
            this.lifecycleStage = "photos_docs";
        }
    }

    @Override
    public void archive(String reason) {
        super.archive(reason);
        this.lifecycleStage = null;
        this.lifecycleVerifiedAt = null;
    }

    // Read-side mirror of deals.status, kept in sync by DealService in the same transaction, so the
    // catalogue can surface "under offer" without importing deals and closing a package cycle.
    @Column(name = "deal_status", nullable = false)
    @Setter
    private String dealStatus = "active";

    @Column(name = "featured", nullable = false)
    @Setter
    private boolean featured = false;

    // Read-side mirror of the newest active boost window's end, kept in sync by BoostService; a join
    // into `boosts` would invert billing→catalog. Null = never boosted; past values are left in place.
    @Column(name = "boosted_until")
    @Setter
    private Instant boostedUntil;

    /**
     * Is a paid promotion window open right now? Derived so it cannot go stale, and authored here
     * rather than as a MapStruct expression so the rule sits next to the column it reads.
     */
    public boolean isBoosted() {
        return boostedUntil != null && boostedUntil.isAfter(Instant.now());
    }

    @Column(name = "flag_reason")
    @Setter
    private String flagReason;

    /**
     * Stays-live moderation work item (Q14, V62): a nullable timestamp whose age is the queue SLA.
     * Not a status value — every status but {@code approved} is off search, the cost this avoids.
     */
    @Column(name = "recheck_requested_at")
    private Instant recheckRequestedAt;

    /** Which fields raised the pending re-check, accumulated across edits (Q14). */
    @Column(name = "recheck_reason")
    private String recheckReason;

    /**
     * Whether staff created this listing on an owner's behalf; decides whether the onboarding funnel
     * applies at all. An owner who posted for themselves would sit on a board they can never leave.
     */
    @Column(name = "posted_by_admin", nullable = false)
    private boolean postedByAdmin = false;

    /**
     * How far the acquisition funnel has got. Nullable rather than defaulting to {@code listed}:
     * null means the listing was never ours to hand over. See {@link PipelineStage} for the set.
     */
    @Column(name = "pipeline_stage")
    private String pipelineStage;

    /**
     * How far the hand-back has got; null until it starts. A second axis because a listing sits on
     * both at once — documents in <em>and</em> photographs up is two facts, not one column.
     */
    @Column(name = "handback_milestone")
    private String handbackMilestone;

    /**
     * Hand-back detail that is not the stage — currently only {@code postedByStaff}. Stores the
     * staff <em>id</em>, so a colleague changing their display name does not rewrite history.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "admin_pipeline", nullable = false)
    private Map<String, Object> adminPipeline = new LinkedHashMap<>();

    /**
     * Record that staff created this listing for {@code staffId}, and open the funnel at
     * {@link PipelineStage#LISTED}.
     */
    public void markPostedOnBehalf(String staffId) {
        this.postedByAdmin = true;
        this.lifecycleTrack = "staff";
        this.lifecycleStage = PropertyStatus.APPROVED.equals(status) ? "live" : null;
        if (images != null && !images.isEmpty()) {
            recordLifecycleMedia();
        }
        this.pipelineStage = PipelineStage.LISTED;
        this.adminPipeline = new LinkedHashMap<>(this.adminPipeline);
        this.adminPipeline.put("postedByStaff", staffId);
    }

    /**
     * Move the listing along whichever funnel {@code stage} names; the two vocabularies are disjoint.
     * Backwards is allowed on both axes, because evidence genuinely does come undone.
     */
    public void moveToStage(String stage) {
        if (PipelineStage.isHandback(stage)) {
            this.handbackMilestone = stage;
            this.pipelineStage = PipelineStage.DOCS_SUBMITTED;
            return;
        }
        this.pipelineStage = stage;
        // Stepping back onto the acquisition funnel un-does the hand-back, rather than stranding a
        // milestone on a row that has stopped claiming to hold the paperwork.
        this.handbackMilestone = null;
    }

    /** The staff member who created this listing on the owner's behalf, or null. */
    public String getPostedByStaff() {
        Object value = adminPipeline.get("postedByStaff");
        return value == null ? null : value.toString();
    }

    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "owner_verified", nullable = false)
    @Setter
    private boolean ownerVerified = false;

    /**
     * The ops verdict on ownership evidence — not the badge; read {@link #isOwnershipVerified()}.
     * No setter: the three columns move together or the badge lies.
     */
    @Column(name = "ownership_verified", nullable = false)
    private boolean ownershipVerified = false;

    /** When ops last accepted a complete evidence set. The instant announced to billing. */
    @Column(name = "ownership_verified_at")
    private Instant ownershipVerifiedAt;

    /**
     * Earliest expiry among the documents the verdict rested on, or {@code null} when every one of
     * them was a never-expiring registry or identity document (Q15).
     */
    @Column(name = "ownership_verified_until")
    private Instant ownershipVerifiedUntil;

    /**
     * When the owner last confirmed the listing is still available (V86) — the one freshness input
     * that records a human act. Null = never confirmed; readers fall back to {@code createdAt}.
     */
    @Column(name = "last_confirmed_at")
    private Instant lastConfirmedAt;

    /**
     * Record the owner's confirmation at {@code at}. Unconditional and idempotent: an owner cannot
     * know which of their listings the badge currently calls stale, so "confirm all" must not error.
     */
    public void confirmAvailable(Instant at) {
        this.lastConfirmedAt = at;
    }

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
     * Direct-link reachability: approved or terminal (sold/rented) rows open, so a held link shows
     * the badge rather than a 404. Pending/rejected/flagged/archived stay unreachable.
     */
    public boolean isDirectlyReachable() {
        return !isArchived() && (PropertyStatus.APPROVED.equals(status)
                || PropertyStatus.SOLD.equals(status) || PropertyStatus.RENTED.equals(status));
    }

    /**
     * Send an identity-changing edit (or a restore) back to review. Any pending re-check is dropped:
     * a full re-moderation covers the whole listing, so keeping one would double the queue entry.
     */
    public void revertToPending() {
        setStatus(PropertyStatus.PENDING);
        clearRecheck();
    }

    /**
     * Queue a stays-live re-check (Q14) on a publicly visible listing only. The timestamp is kept at
     * the first unreviewed edit, so daily price edits cannot reset an owner's place in the queue.
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

    /**
     * The <strong>Ownership Verified</strong> badge — an ops verdict that has not yet lapsed.
     * Derived, never swept: docs/system/data-model.md#the-ownership-badge-is-derived-not-swept.
     */
    public boolean isOwnershipVerified() {
        return isOwnershipVerifiedAt(Instant.now());
    }

    /**
     * The badge as at a given moment. One clock reading per request, so the badge, the gate and the
     * evidence list cannot straddle an expiry and contradict each other in one response.
     */
    public boolean isOwnershipVerifiedAt(Instant at) {
        return ownershipVerified
                && (ownershipVerifiedUntil == null || ownershipVerifiedUntil.isAfter(at));
    }

    /**
     * Record an ops verdict that the ownership evidence is complete: {@code at} is announced to
     * billing, {@code until} is the earliest expiry relied on, or {@code null} when none expires.
     */
    public void verifyOwnership(Instant at, Instant until) {
        this.ownershipVerified = true;
        this.ownershipVerifiedAt = at;
        this.ownershipVerifiedUntil = until;
    }

    /**
     * Withdraw the verdict — the evidence was forged, or belonged to another flat. Not a lapse,
     * which needs no write: this erases the claim itself. Idempotent.
     */
    public void revokeOwnershipVerification() {
        this.ownershipVerified = false;
        this.ownershipVerifiedAt = null;
        this.ownershipVerifiedUntil = null;
    }

}
