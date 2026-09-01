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
     * Which human action minted this society — {@link SocietyMintOrigins#DEMAND} when a searcher
     * looked for the building and we did not have it, {@link SocietyMintOrigins#LISTING} when
     * somebody posting a flat could not find their society. Null for every row nobody minted.
     *
     * <p><strong>A different axis from {@link #source}, not a fourth value of it.</strong>
     * {@code source} is where the record came from and is what a reader weighs; this is what a
     * person was doing when they added it, and is what ops reads. Every row that has one has
     * {@code source = community}, which is exactly why they cannot be the same column: folding the
     * two together would make {@code community} mean two things and would drag every existing
     * comparison against it into a distinction none of them care about.
     *
     * <p>Null means not recorded — true of curated and RERA rows and of every community row minted
     * before V108 — and must not be read as "not demand".
     */
    @Column(name = "mint_origin")
    private String mintOrigin;

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

    /**
     * The surviving society this one was merged into, when an operator judged the two rows to be
     * the same building; null for every society that stands on its own (V111).
     *
     * <p><strong>A pointer, not a move.</strong> Nine tables reference {@code societies (id)} —
     * listings, follows, claims, residency records, questions, board items, contributions,
     * proposals and flatmate rooms. Rewriting them onto the survivor would be irreversible, because
     * nothing would then record which of them had moved; deleting this row would be worse. So
     * nothing moves, and the reads follow this pointer instead: {@link SocietyService} unions the
     * survivor's activity with that of everything merged into it, so one hub shows the whole
     * building while an undo remains a single statement.
     *
     * <p><strong>Exactly one hop, forever.</strong> {@link SocietyMergeService} refuses to merge
     * into a society that is itself merged away, and refuses to merge away a society that has
     * absorbed others. That is what lets every reader resolve with one lookup rather than a loop
     * with a depth guard, and it is why {@link SocietyMerges} is three lines rather than a
     * traversal.
     *
     * <p>A plain id rather than a {@code @ManyToOne} to {@link Society}. The association would buy
     * one convenience — {@code getMergedInto().getSlug()} — at the price of a self-referencing lazy
     * proxy on an entity read by every catalogue surface, and the two places that want the survivor
     * ask for it by id explicitly, which is also the only place a null check can be missed.
     */
    @Column(name = "merged_into")
    private java.util.UUID mergedInto;

    /** When the merge was recorded. Moves with {@link #mergedInto} — see V111. */
    @Column(name = "merged_at")
    private java.time.Instant mergedAt;

    /**
     * The operator who merged it away.
     *
     * <p>Moves with {@link #mergedInto} under {@code ck_society_merged_trio}, for the reason
     * {@link #verifiedBy} moves with {@link #verifiedAt}: two operators clearing the same duplicate
     * queue can reach opposite conclusions about which row is the real society, and a merge with no
     * signature leaves nobody to ask.
     */
    @Column(name = "merged_by")
    private java.util.UUID mergedBy;

    /** {@code unclaimed} / {@code pending} / {@code claimed}. */
    @Column(name = "claim_status", nullable = false)
    private String claimStatus = SocietyClaimStatus.UNCLAIMED;

    /**
     * Ops' free-text note about this building — why a claim is stuck, what the secretary said.
     *
     * <p><strong>Never leaves the back office.</strong> {@link SocietyResponse} does not carry it and
     * must not learn to: this is moderator prose about a named building and usually about the people
     * living in it, and the two routes that serve {@code SocietyResponse} are anonymous reads. The
     * same reasoning keeps the {@code geo} blacklist's reason off {@code GET /geo}.
     *
     * <p>Null means no note. A note the operator cleared is stored as null rather than {@code ""},
     * so the console cannot end up rendering "never had one" and "had one, deleted" differently.
     */
    @Column(name = "admin_note")
    private String adminNote;

    protected Society() {
        // JPA
    }

}
