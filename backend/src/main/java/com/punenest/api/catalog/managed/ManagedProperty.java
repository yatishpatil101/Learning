package com.punenest.api.catalog.managed;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An owner's private "single-player" property record — the thing behind the Owner Hub, the Property
 * Passport and the rent tracker. Maps the {@code managed_properties} table (V33).
 *
 * <p>Deliberately <em>not</em> a {@link com.punenest.api.catalog.property.Property}: a managed
 * record is private by default, never moderated, never searched, freely edited and hard-deleted,
 * which is the opposite of a marketplace listing on every axis. It carries the property facts an
 * owner captures ({@code deal}/{@code propertyType}/{@code bhk}/{@code price}/{@code locality}/…),
 * an owner-only rent-tracker block ({@code rented}/{@code tenantName}/{@code monthlyRent}/
 * {@code dueDay}), an opaque {@code valuation} snapshot, and — once published — the id of the
 * ordinary pending listing it spawned ({@code publishedListingId}).
 *
 * <p>Two fields are server-controlled and never set from a request body: {@code visibility} and
 * {@code status}. A record is born {@code private}/{@code managed}; only {@link #markPublished}
 * (called by the publish flow after a real listing exists) moves it to {@code public}/
 * {@code published}. {@code deal} follows the catalogue's {@code buy|rent} convention, not the front
 * end's managed-only "sale" label, so publishing is a straight pass-through.
 */
@Entity
@Table(name = "managed_properties")
@Getter
public class ManagedProperty extends AuditedEntity {

    /** A record awaiting publication (not yet advertised). */
    public static final String VISIBILITY_PRIVATE = "private";
    /** A record that has been published into the marketplace. */
    public static final String VISIBILITY_PUBLIC = "public";
    /** The private, unpublished lifecycle state. */
    public static final String STATUS_MANAGED = "managed";
    /** The lifecycle state after a listing has been spawned. */
    public static final String STATUS_PUBLISHED = "published";

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

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

    @Column(name = "locality", nullable = false)
    @Setter
    private String locality;

    @Column(name = "locality_slug")
    @Setter
    private String localitySlug;

    @Column(name = "society")
    @Setter
    private String society;

    @Column(name = "area")
    @Setter
    private BigDecimal area;

    @Column(name = "area_unit", nullable = false)
    @Setter
    private String areaUnit = "sqft";

    @Column(name = "furnishing")
    @Setter
    private String furnishing;

    @Column(name = "visibility", nullable = false)
    private String visibility = VISIBILITY_PRIVATE;

    @Column(name = "status", nullable = false)
    private String status = STATUS_MANAGED;

    @Column(name = "rented", nullable = false)
    @Setter
    private boolean rented = false;

    @Column(name = "tenant_name")
    @Setter
    private String tenantName;

    @Column(name = "monthly_rent")
    @Setter
    private Long monthlyRent;

    @Column(name = "due_day")
    @Setter
    private Integer dueDay;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "valuation")
    @Setter
    private Map<String, Object> valuation;

    @Column(name = "published_listing_id")
    private UUID publishedListingId;

    protected ManagedProperty() {
        // JPA
    }

    /**
     * Register a new managed property. The lifecycle fields ({@code visibility}/{@code status}) keep
     * their private defaults; the owner-only tracker fields default to "not rented" and are set later
     * via the update path. Everything trust- or lifecycle-relevant is therefore server-owned.
     */
    public ManagedProperty(UUID ownerId, String title, String deal, String propertyType,
            BigDecimal bhk, Long price, String locality, String localitySlug, String society,
            BigDecimal area, String areaUnit, String furnishing) {
        this.ownerId = ownerId;
        this.title = title;
        this.deal = deal;
        this.propertyType = propertyType;
        this.bhk = bhk;
        this.price = price;
        this.locality = locality;
        this.localitySlug = localitySlug;
        this.society = society;
        this.area = area;
        this.areaUnit = areaUnit == null ? "sqft" : areaUnit;
        this.furnishing = furnishing;
    }

    /**
     * Record that this managed property has been published into the given listing. Idempotent at the
     * caller: publish returns early when {@link #publishedListingId} is already set.
     */
    public void markPublished(UUID listingId) {
        this.publishedListingId = listingId;
        this.visibility = VISIBILITY_PUBLIC;
        this.status = STATUS_PUBLISHED;
    }
}
