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
import java.util.Arrays;
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

/** The catalogue aggregate mapping the {@code properties} table; wire shapes derive from it at the
 * boundary. Column-type and invariant rationale: docs/system/data-model.md#catalogue-entity-notes. */
@Entity
@Table(name = "properties")
@Getter
public class Property extends SoftDeleteEntity {

    public static final String OWNERSHIP_REVIEW_ITEM = "Ownership documents";

    @Column(name = "slug")
    @Setter
    private String slug;

    /** The listing owner, fetched via an entity graph on the detail finders so the owner summary
     * costs no N+1; search summaries never touch it. */
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

    /** Canonical filter key behind {@link #propertyType}'s free text, generated and read-only:
     * chip filtering needs a fixed key an index can answer, not a substring scan. */
    @Column(name = "property_type_key", insertable = false, updatable = false)
    private String propertyTypeKey;

    /** Canonical commercial subtype, generated and read-only: {@link #propertyTypeKey}
     * collapses every commercial label, leaving the Office/Shop/Warehouse sub-filter nothing to use. */
    @Column(name = "commercial_use_key", insertable = false, updatable = false)
    private String commercialUseKey;

    /** Share flag derived from {@link #room} (generated, read-only). Without it a share posted as
     * "Flat" keys as {@code flat}, so a whole-unit Flat search returns shared rooms. */
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

    /** Bathroom count, full and half together. {@code null} means unstated, {@code 0} means
     * none — a shop or plot legitimately has none, and a synthesised number would be confidently wrong. */
    @Column(name = "bathrooms")
    @Setter
    private Integer bathrooms;

    /** Dedicated parking slots conveyed with the unit — a count, not the "4-Wheeler Parking"
     * amenity token. {@code null} = unstated, {@code 0} = none. */
    @Column(name = "parking")
    @Setter
    private Integer parking;

    /** Balcony count, stated rather than derived from the bedroom count.
     * {@code null} = unstated, {@code 0} = none. */
    @Column(name = "balconies")
    @Setter
    private Integer balconies;

    @Column(name = "possession")
    @Setter
    private String possession;

    /** Permitted zoning for an open plot or farm land; null once there is a building on it. A
     * search facet, not a detail: the wrong zoning is a dead purchase, not a disappointment. */
    @Column(name = "land_use")
    @Setter
    private String landUse;

    /** Age of the construction in years. {@code null} is absent, never zero — reading unstated
     * as brand-new would float every lazy listing above the honest ones in filters and scoring. */
    @Column(name = "age_years")
    @Setter
    private Integer ageYears;

    /** Flatmate room shape: {@code single} for a private room, {@code shared} for a bed in a
     * shared room. Null for every listing that is not a flatmate share. */
    @Column(name = "room")
    @Setter
    private String room;

    /** Who the owner will rent to. A list because "family or company, no bachelors" is the
     * ordinary Pune position; empty means no preference and must match every tenant filter. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tenants", nullable = false)
    @Setter
    private List<String> tenants = new ArrayList<>();

    /** Move-in bucket: {@code now}, {@code 15} or {@code 30} days; null when unstated. A bucket
     * because a date nobody edits goes stale; the filter is cumulative and widened by the query. */
    @Column(name = "available_from")
    @Setter
    private String availableFrom;

    /** Pets allowed; null when the owner did not answer. "No" and "unstated" are different facts, and
     * the pet-friendly filter matches true only, so null is never advertised either way. */
    @Column(name = "pets")
    @Setter
    private Boolean pets;

    /** Listing completeness, 0–100, generated and read-only: it orders search results, and an
     * ordering the database cannot see cannot be paged. Weights and reasoning live in V94. */
    @Column(name = "quality_score", insertable = false, updatable = false)
    private Short qualityScore;

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    /** FK slug into {@code localities}, resolved server-side; null when nothing resolved confidently.
     * The public locality facet filters on this, while responses emit both name and slug. */
    @Column(name = "locality_slug")
    @Setter
    private String localitySlug;

    @Column(name = "society_id")
    @Setter
    private UUID societyId;

    /** The bound society's public key, which clients route on; a formula so no second copy can drift.
     * Setter stamps a just-written row for its own response — docs/system/data-model.md#society-slug. */
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

    /** The unit's electricity meter number — optional, since bulk-metered societies have none.
     * Never emitted in a response: with a surname it is enough to impersonate a utility consumer. */
    @Column(name = "electricity_meter_no")
    @Setter
    private String electricityMeterNo;

    /** {@link #electricityMeterNo} normalised for the duplicate probe — see {@link MeterKey}.
     * Server-derived, never client-supplied: {@code "1700 1234 5678"} is not a different meter. */
    @Column(name = "electricity_meter_key")
    @Setter
    private String electricityMeterKey;

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

    @Column(name = "status", nullable = false)
    private String status = PropertyStatus.PENDING;

    @Column(name = "claim_link_sent_at")
    private Instant claimLinkSentAt;

    @Column(name = "claim_link_opened_at")
    private Instant claimLinkOpenedAt;

    @Column(name = "owner_confirmed_at")
    private Instant ownerConfirmedAt;

    @Column(name = "review_started_at")
    private Instant reviewStartedAt;

    @Column(name = "info_requested_at")
    private Instant infoRequestedAt;

    @jakarta.persistence.Version
    @Column(name = "version", nullable = false)
    private long version;

    public void setStatus(String status) {
        this.status = status;
        this.reviewStartedAt = null;
        this.infoRequestedAt = null;
    }

    public void pauseByOwner() {
        this.status = PropertyStatus.PAUSED;
    }

    public void resumeByOwner() {
        setStatus(PropertyStatus.APPROVED);
    }

    public void startReview() {
        if (reviewStartedAt == null) {
            reviewStartedAt = Instant.now();
        }
    }

    public void requestInfo() {
        startReview();
        infoRequestedAt = Instant.now();
    }

    public void provideInfo() {
        startReview();
        infoRequestedAt = null;
        recordResubmission();
    }

    public boolean isAwaitingOwnerInfo() {
        return infoRequestedAt != null;
    }

    public void recordClaimLinkSent() {
        if (postedByAdmin && claimLinkSentAt == null) {
            claimLinkSentAt = Instant.now();
        }
    }

    public void recordClaimLinkOpened() {
        if (claimLinkOpenedAt == null) {
            claimLinkOpenedAt = Instant.now();
        }
    }

    public void confirmByOwner() {
        if (postedByAdmin && ownerConfirmedAt == null) {
            ownerConfirmedAt = Instant.now();
        }
    }

    public boolean awaitsOwnerConfirmation() {
        return postedByAdmin && ownerConfirmedAt == null;
    }

    // Read-side mirror of deals.status, kept in sync by DealService in the same transaction, so the
    // catalogue can surface "under offer" without importing deals and closing a package cycle.
    @Column(name = "deal_status", nullable = false)
    @Setter
    private String dealStatus = "active";

    public static final String OWNER_ON_PAID_PLAN_SQL = """
            exists (select 1 from subscriptions sub join plans pl on pl.id = sub.plan_id
                    where sub.user_id = owner_id and pl.audience = 'owner' and pl.price > 0
                      and (sub.status = 'past-due'
                           or (sub.status = 'active' and (sub.renews_at is null or sub.renews_at > now()))))""";

    @Formula("(" + OWNER_ON_PAID_PLAN_SQL + ")")
    private boolean featured;

    @Column(name = "flag_reason")
    @Setter
    private String flagReason;

    /** Stays-live moderation work item (Q14, ): a nullable timestamp whose age is the queue SLA.
     * Not a status value — every status but {@code approved} is off search, the cost this avoids. */
    @Column(name = "recheck_requested_at")
    private Instant recheckRequestedAt;

    @Column(name = "resubmitted_at")
    private Instant resubmittedAt;

    @Column(name = "recheck_reason")
    private String recheckReason;

    @Column(name = "posted_by_admin", nullable = false)
    private boolean postedByAdmin = false;

    /** Hand-back detail that is not the stage — currently only {@code postedByStaff}. Stores the
     * staff id, so a colleague changing their display name does not rewrite history. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "admin_pipeline", nullable = false)
    private Map<String, Object> adminPipeline = new LinkedHashMap<>();

    public void markPostedOnBehalf(String staffId) {
        this.postedByAdmin = true;
        this.adminPipeline = new LinkedHashMap<>(this.adminPipeline);
        this.adminPipeline.put("postedByStaff", staffId);
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

    /** The ops verdict on ownership evidence — not the badge; read {@link #isOwnershipVerified()}.
     * No setter: the three columns move together or the badge lies. */
    @Column(name = "ownership_verified", nullable = false)
    private boolean ownershipVerified = false;

    @Column(name = "ownership_verified_at")
    private Instant ownershipVerifiedAt;

    /** Earliest expiry among the documents the verdict rested on, or {@code null} when every one of
     * them was a never-expiring registry or identity document (Q15). */
    @Column(name = "ownership_verified_until")
    private Instant ownershipVerifiedUntil;

    @Column(name = "ownership_requested_at")
    private Instant ownershipRequestedAt;

    @Column(name = "ownership_declined_at")
    private Instant ownershipDeclinedAt;

    @Column(name = "ownership_declined_reason")
    private String ownershipDeclinedReason;

    /** When the owner last confirmed the listing is still available — the one freshness input
     * that records a human act. Null = never confirmed; readers fall back to {@code createdAt}. */
    @Column(name = "last_confirmed_at")
    private Instant lastConfirmedAt;

    /** Record the owner's confirmation at {@code at}. Unconditional and idempotent: an owner cannot
     * know which of their listings the badge currently calls stale, so "confirm all" must not error. */
    public void confirmAvailable(Instant at) {
        this.lastConfirmedAt = at;
        // JPA
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
    }

    /** Create a listing with the minimum a new post requires; callers layer optional fields on via
     * setters. The status/owner defaults are applied by the service so this stays a dumb constructor. */
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

    /** Direct-link reachability: approved or terminal (sold/rented) rows open, so a held link shows
     * the badge rather than a 404. Pending/rejected/flagged/archived stay unreachable. */
    public boolean isDirectlyReachable() {
        return !isArchived() && PropertyStatus.DIRECTLY_REACHABLE.contains(status);
    }

    /** Send an identity-changing edit (or a restore) back to review. Any pending re-check is dropped:
     * a full re-moderation covers the whole listing, so keeping one would double the queue entry. */
    public void revertToPending() {
        setStatus(PropertyStatus.PENDING);
        clearRecheck();
    }

    public void recordResubmission() {
        this.resubmittedAt = Instant.now();
    }

    /** Queue a stays-live re-check (Q14) on a publicly visible listing only. The timestamp is kept at
     * the first unreviewed edit, so daily price edits cannot reset an owner's place in the queue. */
    public void requestRecheck(List<String> fields) {
        if (fields == null || fields.isEmpty() || isArchived()
                || (!PropertyStatus.APPROVED.equals(status) && !PropertyStatus.PAUSED.equals(status))) {
            return;
        }
        boolean wasBadgeOnly = OWNERSHIP_REVIEW_ITEM.equals(recheckReason);
        LinkedHashSet<String> merged = new LinkedHashSet<>();
        if (recheckReason != null && !recheckReason.isBlank()) {
            Collections.addAll(merged, recheckReason.split(",\\s*"));
        }
        merged.addAll(fields);
        this.recheckReason = String.join(", ", merged);
        if (recheckRequestedAt == null || (wasBadgeOnly && !OWNERSHIP_REVIEW_ITEM.equals(recheckReason))) {
            this.recheckRequestedAt = Instant.now();
        }
        recordResubmission();
    }

    public void requestOwnershipReview(Instant at) {
        if (ownershipRequestedAt == null) {
            this.ownershipRequestedAt = at;
        }
        this.ownershipDeclinedAt = null;
        this.ownershipDeclinedReason = null;
        requestRecheck(List.of(OWNERSHIP_REVIEW_ITEM));
    }

    public void declineOwnershipReview(String reason, Instant at) {
        this.ownershipRequestedAt = null;
        this.ownershipDeclinedAt = at;
        this.ownershipDeclinedReason = reason;
        dropRecheckItem(OWNERSHIP_REVIEW_ITEM);
    }

    public boolean isOwnershipRequested() {
        return ownershipRequestedAt != null;
    }

    /** A moderator has looked: drop the work item. Idempotent. */
    public void clearRecheck() {
        if (ownershipRequestedAt != null && !isArchived()
                && (PropertyStatus.APPROVED.equals(status) || PropertyStatus.PAUSED.equals(status))) {
            this.recheckReason = OWNERSHIP_REVIEW_ITEM;
            this.recheckRequestedAt = ownershipRequestedAt;
            return;
        }
        this.recheckRequestedAt = null;
        this.recheckReason = null;
    }

    public boolean isRecheckPending() {
        return recheckRequestedAt != null;
    }

    /** The Ownership Verified badge — an ops verdict that has not yet lapsed.
     * Derived, never swept: docs/system/data-model.md#the-ownership-badge-is-derived-not-swept. */
    public boolean isOwnershipVerified() {
        return isOwnershipVerifiedAt(Instant.now());
    }

    /** The badge as at a given moment. One clock reading per request, so the badge, the gate and the
     * evidence list cannot straddle an expiry and contradict each other in one response. */
    public boolean isOwnershipVerifiedAt(Instant at) {
        return ownershipVerified
                && (ownershipVerifiedUntil == null || ownershipVerifiedUntil.isAfter(at));
    }

    /** Record an ops verdict that the ownership evidence is complete: {@code at} is announced to
     * billing, {@code until} is the earliest expiry relied on, or {@code null} when none expires. */
    public void verifyOwnership(Instant at, Instant until) {
        this.ownershipVerified = true;
        this.ownershipVerifiedAt = at;
        this.ownershipVerifiedUntil = until;
        this.ownershipRequestedAt = null;
        this.ownershipDeclinedAt = null;
        this.ownershipDeclinedReason = null;
        dropRecheckItem(OWNERSHIP_REVIEW_ITEM);
    }

    private void dropRecheckItem(String item) {
        if (recheckReason == null) return;
        List<String> rest = Arrays.stream(recheckReason.split(",\\s*"))
                .filter(field -> !field.isBlank() && !field.equals(item))
                .toList();
        if (rest.isEmpty()) {
            this.recheckRequestedAt = null;
            this.recheckReason = null;
        } else {
            this.recheckReason = String.join(", ", rest);
        }
    }

    /** Withdraw the verdict — the evidence was forged, or belonged to another flat. Not a lapse,
     * which needs no write: this erases the claim itself. Idempotent. */
    public void revokeOwnershipVerification() {
        this.ownershipVerified = false;
        this.ownershipVerifiedAt = null;
        this.ownershipVerifiedUntil = null;
    }

}
