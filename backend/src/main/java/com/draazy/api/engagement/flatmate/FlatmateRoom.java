package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A room inside a flat that actually exists — the {@code move-in} feed (V27 {@code flatmate_rooms}).
 *
 * <p><strong>Two creation paths, one table, two irreconcilable ledgers.</strong> A seeker browsing
 * rooms does not care where a room came from, so both land here; but how "can I still move in?" is
 * answered differs, and the difference is not cosmetic:
 *
 * <ul>
 *   <li><strong>Seat model</strong> ({@link #seatsTotal}/{@link #seatsOpen}) — a standalone spare
 *       room from the list-property flow. Seats are abstract vacancies on this one post.</li>
 *   <li><strong>Occupancy model</strong> ({@link #occupants}/{@link #maxOccupants}) — a room from
 *       splitting a rent listing. Counts real people, and the ceiling belongs to the whole
 *       <em>flat</em>, so it is enforced across every sibling room sharing {@link #propertyId}.</li>
 * </ul>
 *
 * <p>They are never mixed: a split room carrying a seat count would be a second, disagreeing answer
 * to the only question the card exists to answer. Both the DB (two CHECK constraints) and the
 * service ({@code not_seat_based}) refuse it.
 *
 * <p>{@link #verificationTier} is derived server-side by {@link FlatmateGuardrails} and never read
 * from a request body — a client that could name its own tier could award itself the badge the
 * whole trust model rests on.
 */
@Entity
@Table(name = "flatmate_rooms")
@Getter
public class FlatmateRoom extends AuditedEntity {

    @Column(name = "host_id", nullable = false, updatable = false)
    private UUID hostId;

    /**
     * The parent rent listing when this room came from a split; null for a standalone spare room.
     * This is the key that ties sibling rooms into one occupancy ledger and one joint agreement.
     */
    @Column(name = "property_id")
    @Setter
    private UUID propertyId;

    @Column(name = "room_kind")
    @Setter
    private String roomKind;

    @Column(name = "room_type", nullable = false)
    @Setter
    private String roomType;

    @Column(name = "attached_bath", nullable = false)
    @Setter
    private String attachedBath = "shared";

    /**
     * Whether {@link #budget} is what one person pays or what the whole room costs. Mixing the two
     * silently makes a shared bed look pricier than a private room, which is the one pricing error
     * a seeker cannot detect by eye.
     */
    @Column(name = "price_basis", nullable = false)
    @Setter
    private String priceBasis = "person";

    @Column(name = "budget", nullable = false)
    @Setter
    private Long budget;

    @Column(name = "deposit")
    @Setter
    private Long deposit;

    /** People living in THIS room. Emergent — the tenants decide, the host only records it. */
    @Column(name = "occupants", nullable = false)
    @Setter
    private int occupants = 0;

    /** People allowed in the whole FLAT (the society's rule) — the only ceiling the host declares. */
    @Column(name = "max_occupants", nullable = false)
    @Setter
    private int maxOccupants = 3;

    @Column(name = "seats_total")
    @Setter
    private Integer seatsTotal;

    @Column(name = "seats_open")
    @Setter
    private Integer seatsOpen;

    @Column(name = "host_role", nullable = false)
    @Setter
    private String hostRole = "tenant";

    @Column(name = "verification_tier", nullable = false)
    @Setter
    private String verificationTier = FlatmateVocabulary.TIER_IDENTITY;

    /**
     * The Verified pill. On a split room this tracks the <em>parent</em> listing's Ops approval, so
     * a badge can never appear on a flat nobody has checked.
     */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified = false;

    @Column(name = "agreement_declared", nullable = false)
    @Setter
    private boolean agreementDeclared = false;

    @Column(name = "address_fingerprint")
    @Setter
    private String addressFingerprint;

    @Column(name = "flag_for_review", nullable = false)
    @Setter
    private boolean flagForReview = false;

    @Column(name = "mod_status", nullable = false)
    @Setter
    private String modStatus = FlatmateVocabulary.MOD_PENDING;

    @Column(name = "society_id")
    @Setter
    private UUID societyId;

    @Column(name = "society")
    @Setter
    private String society;

    @Column(name = "flat_number")
    @Setter
    private String flatNumber;

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "localities", nullable = false)
    @Setter
    private List<String> localities = new ArrayList<>();

    @Column(name = "lat")
    @Setter
    private Double lat;

    @Column(name = "lng")
    @Setter
    private Double lng;

    /** {@code "4"} means 4+, matching the contract's enum. */
    @Column(name = "bhk")
    @Setter
    private String bhk;

    @Column(name = "flat_type")
    @Setter
    private String flatType;

    @Column(name = "home_type_label")
    @Setter
    private String homeTypeLabel;

    @Column(name = "gated_community", nullable = false)
    @Setter
    private boolean gatedCommunity = false;

    @Column(name = "furnishing")
    @Setter
    private String furnishing;

    @Column(name = "move_in")
    @Setter
    private String moveIn;

    @Column(name = "available_from")
    @Setter
    private LocalDate availableFrom;

    @Column(name = "gender", nullable = false)
    @Setter
    private String gender = "any";

    @Column(name = "food", nullable = false)
    @Setter
    private String food = "any";

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tags", nullable = false)
    @Setter
    private List<String> tags = new ArrayList<>();

    @Column(name = "note")
    @Setter
    private String note;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "photos", nullable = false)
    @Setter
    private List<String> photos = new ArrayList<>();

    @Column(name = "status", nullable = false)
    @Setter
    private String status = "active";

    @Column(name = "archived", nullable = false)
    private boolean archived = false;

    @Column(name = "archived_at")
    private Instant archivedAt;

    @Column(name = "archive_reason")
    private String archiveReason;

    protected FlatmateRoom() {
    }

    FlatmateRoom(UUID hostId, String roomType, String locality, Long budget) {
        this.hostId = hostId;
        this.roomType = roomType;
        this.locality = locality;
        this.budget = budget;
    }

    void archive(String reason) {
        this.archived = true;
        this.archivedAt = Instant.now();
        this.archiveReason = reason;
    }

    public boolean isVisible() {
        return !archived && FlatmateVocabulary.isPublic(modStatus);
    }

    /** True when this room came from splitting a parent listing, and so uses the occupancy ledger. */
    public boolean isSplitRoom() {
        return propertyId != null;
    }

    /** True when this room tracks abstract seats rather than real occupants. */
    public boolean isSeatBased() {
        return seatsTotal != null;
    }
}
