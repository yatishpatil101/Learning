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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

    /**
     * The unit's electricity meter number, if the owner gave one (V79).
     *
     * <p>Optional and kept that way: an owner in a society on a single bulk meter has no number to
     * give, and a listing form that insists on one turns a wiring arrangement into a reason an
     * honest owner cannot list. Its only reader is the duplicate probe, which skips nulls.
     *
     * <p>Not emitted in any listing response. It is the one field on this row that names a
     * real-world account a stranger could act on — a meter number plus a surname is enough to
     * impersonate a consumer at the utility — and the duplicate rule reads it server-side, so
     * nothing outside the platform ever needs to see it.
     */
    @Column(name = "electricity_meter_no")
    @Setter
    private String electricityMeterNo;

    /**
     * {@link #address}, normalised for comparison (V79). Server-derived on every write — see
     * {@code AddressKey} — and never accepted from a client, because a client that chooses its own
     * key chooses which listings it collides with.
     */
    @Column(name = "address_key")
    @Setter
    private String addressKey;

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

    /**
     * Whether staff created this listing on an owner's behalf rather than the owner posting it.
     *
     * <p>The flag that decides whether the onboarding funnel applies at all. An owner who posted
     * their own listing has already done the thing the funnel exists to chase, so a stage on such a
     * row would put it on a board it can never leave.
     */
    @Column(name = "posted_by_admin", nullable = false)
    private boolean postedByAdmin = false;

    /**
     * How far through {@link PipelineStage} the hand-back has got, or null if not applicable.
     *
     * <p>Nullable rather than defaulting to {@code listed}, because null and {@code listed} say
     * different things: null is "this listing was never ours to hand over", {@code listed} is "it is
     * ours and we have not started". Thirty-eight seeded rows are the former.
     */
    @Column(name = "pipeline_stage")
    private String pipelineStage;

    /**
     * Everything about the hand-back that is not the stage — currently just {@code postedByStaff},
     * the id of the staff member who created the listing.
     *
     * <p>JSONB because V3 chose it: the stage is the hot filter and has its own indexed column, and
     * the rest is read one listing at a time on a desk. Storing the staff <em>id</em> rather than
     * their name, so a colleague changing their display name does not silently rewrite history.
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
        this.pipelineStage = PipelineStage.LISTED;
        this.adminPipeline = new LinkedHashMap<>(this.adminPipeline);
        this.adminPipeline.put("postedByStaff", staffId);
    }

    /**
     * Move the hand-back to {@code stage}.
     *
     * <p>Backwards is allowed. The stages record what has actually come back from an owner, and
     * that can be undone — a document turns out to be the wrong flat, a claim link goes to a stale
     * number. A forward-only funnel would leave the desk with no way to say so except to lie, and a
     * board everyone knows is optimistic is worse than no board.
     */
    public void moveToStage(String stage) {
        this.pipelineStage = stage;
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
     * The ops verdict on this listing's ownership evidence — <em>not</em> the badge. Read
     * {@link #isOwnershipVerified()} for the badge; this field says only that a complete evidence
     * set was once accepted, which stops being a true statement about the property the moment the
     * earliest of those documents expires.
     *
     * <p>No setter, deliberately. The three columns move together or the badge lies, so the only
     * ways in are {@link #verifyOwnership(Instant, Instant)} and
     * {@link #revokeOwnershipVerification()}.
     */
    @Column(name = "ownership_verified", nullable = false)
    private boolean ownershipVerified = false;

    /** When ops last accepted a complete evidence set. The instant announced to billing (D190). */
    @Column(name = "ownership_verified_at")
    private Instant ownershipVerifiedAt;

    /**
     * The earliest expiry among the documents the verdict was taken on, or {@code null} when every
     * one of them was a never-expiring registry or identity document (D190/Q15).
     */
    @Column(name = "ownership_verified_until")
    private Instant ownershipVerifiedUntil;

    /**
     * When the owner last confirmed this listing is genuinely still available (V86).
     *
     * <p><strong>Why this is stored and not derived.</strong> Everything else about a listing's
     * freshness <em>is</em> derived — the active/aging/stale/dormant state is a function of this one
     * instant and the clock, computed on read so nothing can get stuck. This is the single input
     * that cannot be inferred, because it records an act: a human being said "yes, still available".
     * An edit is not that act, and neither is a page view.
     *
     * <p><strong>Null means never confirmed, and readers fall back to {@code createdAt}.</strong>
     * The fallback lives in the reader rather than in a backfill so that it stays visibly a
     * fallback: a row where this is set is one whose owner answers, and a row where it is null is
     * one that has only ever been posted. Writing {@code createdAt} in here at migration time would
     * have erased that distinction permanently in exchange for nothing.
     *
     * <p>No setter. The only way in is {@link #confirmAvailable(Instant)}, which takes the instant
     * as a parameter for the same reason {@link #verifyOwnership(Instant, Instant)} does.
     */
    @Column(name = "last_confirmed_at")
    private Instant lastConfirmedAt;

    /**
     * Record that the owner has confirmed this listing is still available.
     *
     * <p>Deliberately idempotent and unconditional: confirming a listing that is already fresh is a
     * no-op in effect and must not be an error, because the owner has no way of knowing which of
     * their listings the badge currently considers stale, and a bulk "confirm all" would otherwise
     * have to ask before every row.
     *
     * @param at when the owner confirmed; passed in so one request evaluates one reading of the
     *           clock, as with the ownership badge above
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

    /**
     * The <strong>Ownership Verified</strong> badge (D190/Q15) — derived, not stored.
     *
     * <p>This is what MapStruct reads for {@code PropertyResponse.ownershipVerified}, and therefore
     * what the buyer sees. It is an ops verdict that has not yet lapsed: a listing verified on a
     * property-tax receipt stops being verified ninety days after that receipt was <em>issued</em>,
     * with no further write to this row.
     *
     * <p><strong>Why derived rather than swept.</strong> The obvious alternative is a scheduled job
     * that flips {@link #ownershipVerified} to false once {@link #ownershipVerifiedUntil} passes —
     * and this codebase does have a scheduler, so that was available. It was still rejected. A
     * sweep leaves a window, however short, in which a listing whose proof has expired is still
     * telling buyers its ownership is verified, and the length of that window is a deployment
     * detail rather than a product decision. Worse, the sweep is a second writer of a fact the
     * evidence already determines: it can be skipped by a failed job, run twice, or drift after a
     * restore, and each of those failure modes is silent and shows a wrong badge. A comparison
     * against the clock has no window, nothing to backfill, and cannot disagree with the evidence
     * it is computed from. The cost is that this is not queryable in SQL — no repository filters on
     * it today, and one that needs to would add {@code ownership_verified_until > now()} to its
     * predicate, which is the same rule spelled in the same place.
     *
     * <p>A {@code null} {@link #ownershipVerifiedUntil} means "does not lapse", not "lapsed". With
     * today's evidence vocabulary the gate cannot produce one — site presence rests on photographs
     * and those always expire — so in practice it marks a row that predates D190, which is how demo
     * data keeps its badge. It is honoured rather than treated as invalid because which documents
     * expire is a product decision that will change.
     */
    public boolean isOwnershipVerified() {
        return isOwnershipVerifiedAt(Instant.now());
    }

    /**
     * The badge as at a given moment.
     *
     * <p>The parameter exists so a request evaluates the badge, the gate and the evidence list
     * against <em>one</em> reading of the clock. Three separate {@code Instant.now()} calls in the
     * same response can straddle an expiry and produce a listing that reports itself verified and
     * missing its ownership proof in the same breath.
     */
    public boolean isOwnershipVerifiedAt(Instant at) {
        return ownershipVerified
                && (ownershipVerifiedUntil == null || ownershipVerifiedUntil.isAfter(at));
    }

    /**
     * Record an ops verdict that the ownership evidence for this listing is complete (D190).
     *
     * @param at    when the verdict was taken; announced to billing so both sides carry the same
     *              instant
     * @param until the earliest expiry among the documents relied on, or {@code null} when none of
     *              them expires
     */
    public void verifyOwnership(Instant at, Instant until) {
        this.ownershipVerified = true;
        this.ownershipVerifiedAt = at;
        this.ownershipVerifiedUntil = until;
    }

    /**
     * Withdraw the verdict — the evidence was forged, or belonged to another flat (D190).
     *
     * <p>Not the same thing as a lapse, which needs no write at all and leaves the row saying when
     * the badge was granted and until when. This erases the verdict itself, because the claim it
     * recorded turned out not to be true. Idempotent.
     */
    public void revokeOwnershipVerification() {
        this.ownershipVerified = false;
        this.ownershipVerifiedAt = null;
        this.ownershipVerifiedUntil = null;
    }

}
