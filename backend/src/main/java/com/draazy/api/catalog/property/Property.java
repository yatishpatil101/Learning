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

    /**
     * The canonical filter key behind {@link #propertyType}'s free text (V98) — one of
     * {@code pg|commercial|flat|house|villa|farmland|plot}, or null when the label is one the
     * taxonomy has not been taught.
     *
     * <p>Read-only, and deliberately so: this is a Postgres {@code GENERATED ALWAYS AS ... STORED}
     * column, so it is mapped {@code insertable = false, updatable = false} and has no setter.
     *
     * <p>It exists because {@code property_type} is free text and the listings page filters by a
     * fixed set of chips. The browser bridged that with substring matching, which meant the "Flat"
     * chip had always included studios and penthouses; comparing the chip to the stored label for
     * equality — which is what filtering server-side would otherwise have done — emptied five of the
     * six chips. Deriving the key in the database keeps that judgement in one place and, unlike a
     * substring scan, lets an index answer it.
     */
    @Column(name = "property_type_key", insertable = false, updatable = false)
    private String propertyTypeKey;

    /**
     * The canonical commercial subtype (V99) — one of
     * {@code office|coworking|shop|retail|warehouse|industrial}, or null for anything that is not
     * commercial or whose label names no subtype we know.
     *
     * <p>Generated and read-only for the same reasons as {@link #propertyTypeKey}, and separate
     * from it because the two answer different questions: the type key collapses every commercial
     * label to {@code commercial}, which is exactly right for the top-level chip and leaves the
     * sub-filter beneath it — Office / Shop / Warehouse — with nothing to match on.
     */
    @Column(name = "commercial_use_key", insertable = false, updatable = false)
    private String commercialUseKey;

    /**
     * Whether this listing is a share, and which kind (V100) — {@code pg}, {@code flatmates}, or
     * null for a whole unit.
     *
     * <p>Generated and read-only like the two keys above, but derived from {@link #sharing} and
     * {@link #room} rather than from the type label, because that is where PG-ness is actually
     * written down. {@link #propertyTypeKey} cannot answer this: a PG posted with a
     * {@code property_type} of "Flat" keys as {@code flat}, so without this column a Flat search
     * returns PG buildings — which the browser never did, since it excluded any listing carrying a
     * share type from the whole-unit chips.
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

    /**
     * Bathroom count, full and half together (V114). {@code null} means the owner never said;
     * {@code 0} means they said none, which a shop or a plot legitimately is. The distinction
     * matters because the detail page used to synthesise this number from the bedroom count, and a
     * confident wrong tile stops a reader asking the question a blank one would have prompted.
     */
    @Column(name = "bathrooms")
    @Setter
    private Integer bathrooms;

    /**
     * Dedicated parking slots conveyed with the unit (V114). Deliberately not the same thing as the
     * {@code '4-Wheeler Parking'} amenity token: the amenity says a car can be kept somewhere, this
     * says how many slots come with this listing, which is the number a two-car household compares.
     * {@code null} = unstated, {@code 0} = none.
     */
    @Column(name = "parking")
    @Setter
    private Integer parking;

    /**
     * Balcony count (V114). Same story as {@link #bathrooms}: the floor-plan panel derived it from
     * the bedroom count and printed the result in a spec row. {@code null} = unstated, {@code 0} =
     * none.
     */
    @Column(name = "balconies")
    @Setter
    private Integer balconies;

    @Column(name = "possession")
    @Setter
    private String possession;

    /**
     * Permitted zoning for an open plot or farm land (V95). Null for anything with a building on
     * it — a flat has no land use, it has the use its society was sanctioned for.
     *
     * <p>Plots are the one catalogue segment where the wrong answer is not a disappointment but a
     * dead purchase: agricultural land cannot be built on by a non-agriculturist, industrial land
     * will not get a residential completion certificate. So this is a search facet, not a detail —
     * a buyer must be able to exclude the zoning they cannot use before they ever open a listing.
     */
    @Column(name = "land_use")
    @Setter
    private String landUse;

    /**
     * Age of the construction in years (V95). {@code null} means the owner never said, which is
     * emphatically not zero: a range filter that reads unstated as brand-new floats every lazy
     * listing above the honest ones. Both the query and the quality score treat null as absent.
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
     * Who the owner will rent to (V95) — {@code family}, {@code bachelor-male},
     * {@code bachelor-female}, {@code company}.
     *
     * <p>A list rather than a single value because "family or company, no bachelors" is the
     * ordinary Pune position and no enum expresses it. An <em>empty</em> list means the owner
     * stated no preference, and the search must read that as matching every tenant filter rather
     * than none — an owner who did not answer has not refused anybody, and treating silence as
     * refusal would hide most of the inventory from the filter that is supposed to narrow it.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tenants", nullable = false)
    @Setter
    private List<String> tenants = new ArrayList<>();

    /**
     * Move-in bucket (V95): {@code now}, {@code 15} or {@code 30} days. Null when unstated.
     *
     * <p>A bucket rather than a date, because a date on a listing nobody edits is wrong within a
     * fortnight and wrong in the direction that wastes a tenant's visit. The filter is cumulative
     * — "within 30 days" must also return {@code now} and {@code 15} — which the query widens
     * explicitly rather than relying on the strings sorting usefully.
     */
    @Column(name = "available_from")
    @Setter
    private String availableFrom;

    /**
     * Pets allowed (V95). Not nullable: to a tenant with a dog, "unstated" and "no" are the same
     * answer, because neither is worth the risk of moving in and being told to leave. A third
     * state would complicate every predicate and change nobody's decision.
     */
    @Column(name = "pets", nullable = false)
    @Setter
    private boolean pets = false;

    /**
     * PG/hostel occupancy options (V95): {@code single}, {@code double}, {@code triple},
     * {@code four}, {@code five}. Empty for anything that is not a PG.
     *
     * <p>A list because one PG usually offers several occupancies at different rents, and a single
     * value would force the same building to be posted three times. Its own column rather than the
     * amenity list the client was inferring it from — occupancy is a property of the room, not a
     * facility offered alongside it, and reading it out of amenities meant an honest PG that never
     * happened to word an amenity that way vanished from the filter.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sharing", nullable = false)
    @Setter
    private List<String> sharing = new ArrayList<>();

    /**
     * Listing completeness, 0–100, computed by the database (V94).
     *
     * <p>Read-only here, and deliberately so: this is a Postgres {@code GENERATED ALWAYS AS ...
     * STORED} column, so Hibernate must never include it in an INSERT or UPDATE — hence
     * {@code insertable = false, updatable = false} — and there is no setter to tempt anyone.
     *
     * <p>It is a column rather than a Java calculation because its job is to <em>order search
     * results</em>, and an ordering the database cannot see cannot be paged: page 2 is a separate
     * query, and a rank computed in the browser after the rows arrive has no way to decide which
     * rows should have been on it. It is generated rather than maintained on write because eight
     * different paths touch a scored field, and a maintained column is one forgotten call away
     * from serving a number that disagrees with the listing beneath it.
     *
     * <p>The weights live in V94 with the reasoning, including which of the browser's inputs had
     * no column behind them and what replaced them.
     */
    @Column(name = "quality_score", insertable = false, updatable = false)
    private Short qualityScore;

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
     * <p>Mapping this as an association would buy a lazy proxy that every page of search results
     * risks initialising, and the society's name, amenities and occupancy belong to the society hub,
     * which starts from the society and looks up its homes. The id is enough to answer "which homes
     * are in this society?", and — with {@link #societySlug} beside it — "which society is this home
     * in?", which are the only two questions asked of it.
     */
    @Column(name = "society_id")
    @Setter
    private UUID societyId;

    /**
     * The bound society's public key, read-only and derived (D19).
     *
     * <p>A UUID is the wrong thing to put on the wire here. The client keys its society catalogue by
     * slug — that is what {@code /societies/{slug}} takes and what a hub link routes on — so a
     * response carrying only {@code society_id} tells a browser that a society exists without giving
     * it any way to name one. That gap is what the frontend papered over for a long time by picking
     * a society with {@code fnvHash(listing.id) % pool.length}, which printed a real named building's
     * builder, tower count and occupancy on a listing that was not in it.
     *
     * <p>A {@code @Formula} rather than a join or a denormalised column: it rides along in the
     * entity's own SELECT as a correlated subquery on a primary key, so a page of twenty listings
     * still costs one statement and no proxy, and there is no second copy of the slug to drift from
     * {@code societies.slug} when a society is renamed. Null exactly when {@code societyId} is null.
     *
     * <p>The setter is not a way to change which society a listing is in — nothing here is written
     * back, because a formula has no column. It exists because a formula is only evaluated by a
     * SELECT, so a row that has just been inserted or updated is still the managed instance the
     * writer built and its slug is null until a later request reads the row afresh. That instance is
     * what the create and update responses are mapped from, so {@code ListingEditRules} stamps the
     * slug it has just validated and the answer to a write matches the next read of it.
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
     * {@link #electricityMeterNo}, normalised for comparison (V115). Server-derived on every write —
     * see {@link MeterKey} — and never accepted from a client, for the same reason {@link
     * #addressKey} is not.
     *
     * <p>This and not the raw column is what the duplicate probe compares, because the raw one is
     * whatever grouping the owner copied off their bill and {@code "1700 1234 5678"} is not a
     * different meter from {@code "170012345678"}.
     */
    @Column(name = "electricity_meter_key")
    @Setter
    private String electricityMeterKey;

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
     * How far the acquisition funnel has got, or null if not applicable.
     *
     * <p>Nullable rather than defaulting to {@code listed}, because null and {@code listed} say
     * different things: null is "this listing was never ours to hand over", {@code listed} is "it is
     * ours and we have not started". Thirty-eight seeded rows are the former.
     *
     * <p>Holds only the four acquisition stages since V92 — see {@link PipelineStage} for why the
     * hand-back milestones moved to {@link #handbackMilestone} and why {@code under_review} and
     * {@code live} live on {@code status} instead of here.
     */
    @Column(name = "pipeline_stage")
    private String pipelineStage;

    /**
     * How far the hand-back has got, or null if it has not started.
     *
     * <p>A second axis rather than more values on {@link #pipelineStage}, because a listing is at a
     * point on both at once: documents in <em>and</em> photographs up is two facts, and the single
     * column V3 shipped could only remember whichever was written last. Null while the acquisition
     * funnel is still running; the database also refuses a milestone on a row that has not reached
     * {@code listed}, since there is nothing to hand back before the listing exists.
     */
    @Column(name = "handback_milestone")
    private String handbackMilestone;

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
     * Move the listing along, on whichever funnel {@code stage} names.
     *
     * <p>One method rather than two because the desk experiences it as one act, and the two
     * vocabularies are disjoint so the value alone says which column it means. Reaching a hand-back
     * milestone also pins the acquisition funnel at its last stage: the paperwork must be in before
     * a hand-back can start, and leaving the first axis behind at {@code listed} would show the
     * board a listing still waiting for documents it has already received.
     *
     * <p>Backwards is allowed on both axes. The stages record what has actually come back from an
     * owner, and that can be undone — a document turns out to be the wrong flat, a claim link goes
     * to a stale number. A forward-only funnel would leave the desk with no way to say so except to
     * lie, and a board everyone knows is optimistic is worse than no board.
     */
    public void moveToStage(String stage) {
        if (PipelineStage.isHandback(stage)) {
            this.handbackMilestone = stage;
            this.pipelineStage = PipelineStage.DOCS_SUBMITTED;
            return;
        }
        this.pipelineStage = stage;
        // Stepping back onto the acquisition funnel un-does the hand-back rather than leaving a
        // milestone stranded on a row that no longer claims to have the paperwork.
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
