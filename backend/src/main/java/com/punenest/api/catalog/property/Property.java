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
import java.util.ArrayList;
import java.util.List;
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
 * {@code pending} with a server-set owner; editing a <em>foundation</em> field (price/bhk/type/
 * locality/deal) reverts {@code status} to {@code pending}; restore-from-archive also resets to
 * {@code pending}; soft-delete only (the {@code archived} triplet from {@link SoftDeleteEntity}).
 */
@Entity
@Table(name = "properties")
public class Property extends SoftDeleteEntity {

    /** Human-friendly URL key; nullable + {@code UNIQUE}. Lookups fall back to the UUID id. */
    @Column(name = "slug")
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
    private String title;

    @Column(name = "deal", nullable = false)
    private String deal;

    @Column(name = "property_type", nullable = false)
    private String propertyType;

    @Column(name = "bhk")
    private BigDecimal bhk;

    @Column(name = "price", nullable = false)
    private Long price;

    @Column(name = "price_unit")
    private String priceUnit;

    @Column(name = "deposit")
    private Long deposit;

    @Column(name = "maintenance")
    private Long maintenance;

    @Column(name = "negotiable")
    private Boolean negotiable;

    @Column(name = "area")
    private BigDecimal area;

    @Column(name = "area_unit")
    private String areaUnit = "sqft";

    @Column(name = "carpet_area")
    private BigDecimal carpetArea;

    @Column(name = "built_up_area")
    private BigDecimal builtUpArea;

    @Column(name = "super_built_up_area")
    private BigDecimal superBuiltUpArea;

    @Column(name = "furnishing")
    private String furnishing;

    @Column(name = "floor")
    private Integer floor;

    @Column(name = "total_floors")
    private Integer totalFloors;

    @Column(name = "facing")
    private String facing;

    @Column(name = "possession")
    private String possession;

    @Column(name = "locality", nullable = false)
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
    private String localitySlug;

    @Column(name = "city", nullable = false)
    private String city = "Pune";

    @Column(name = "lat")
    private Double lat;

    @Column(name = "lng")
    private Double lng;

    @Column(name = "address")
    private String address;

    @Column(name = "pincode")
    private String pincode;

    @Column(name = "rera_id")
    private String reraId;

    @Column(name = "description")
    private String description;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "amenities", nullable = false)
    private List<String> amenities = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "images", nullable = false)
    private List<String> images = new ArrayList<>();

    @Column(name = "cover_image")
    private String coverImage;

    @Column(name = "floor_plan")
    private String floorPlan;

    @Column(name = "video")
    private String video;

    @Column(name = "posted_by_type")
    private String postedByType;

    @Column(name = "status", nullable = false)
    private String status = PropertyStatus.PENDING;

    @Column(name = "featured", nullable = false)
    private boolean featured = false;

    @Column(name = "flag_reason")
    private String flagReason;

    @Column(name = "verified", nullable = false)
    private boolean verified = false;

    @Column(name = "owner_verified", nullable = false)
    private boolean ownerVerified = false;

    @Column(name = "ownership_verified", nullable = false)
    private boolean ownershipVerified = false;

    @Column(name = "society_verified", nullable = false)
    private boolean societyVerified = false;

    @Column(name = "conveyance_done", nullable = false)
    private boolean conveyanceDone = false;

    @Column(name = "docs_count", nullable = false)
    private int docsCount = 0;

    @Column(name = "views", nullable = false)
    private int views = 0;

    @Column(name = "enquiries", nullable = false)
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

    /** Re-moderation trigger: a foundation-field edit (or a restore) sends the listing back to review. */
    public void revertToPending() {
        this.status = PropertyStatus.PENDING;
    }

    public String getSlug() {
        return slug;
    }

    public void setSlug(String slug) {
        this.slug = slug;
    }

    public User getOwner() {
        return owner;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDeal() {
        return deal;
    }

    public void setDeal(String deal) {
        this.deal = deal;
    }

    public String getPropertyType() {
        return propertyType;
    }

    public void setPropertyType(String propertyType) {
        this.propertyType = propertyType;
    }

    public BigDecimal getBhk() {
        return bhk;
    }

    public void setBhk(BigDecimal bhk) {
        this.bhk = bhk;
    }

    public Long getPrice() {
        return price;
    }

    public void setPrice(Long price) {
        this.price = price;
    }

    public String getPriceUnit() {
        return priceUnit;
    }

    public void setPriceUnit(String priceUnit) {
        this.priceUnit = priceUnit;
    }

    public Long getDeposit() {
        return deposit;
    }

    public void setDeposit(Long deposit) {
        this.deposit = deposit;
    }

    public Long getMaintenance() {
        return maintenance;
    }

    public void setMaintenance(Long maintenance) {
        this.maintenance = maintenance;
    }

    public Boolean getNegotiable() {
        return negotiable;
    }

    public void setNegotiable(Boolean negotiable) {
        this.negotiable = negotiable;
    }

    public BigDecimal getArea() {
        return area;
    }

    public void setArea(BigDecimal area) {
        this.area = area;
    }

    public String getAreaUnit() {
        return areaUnit;
    }

    public void setAreaUnit(String areaUnit) {
        this.areaUnit = areaUnit;
    }

    public BigDecimal getCarpetArea() {
        return carpetArea;
    }

    public void setCarpetArea(BigDecimal carpetArea) {
        this.carpetArea = carpetArea;
    }

    public BigDecimal getBuiltUpArea() {
        return builtUpArea;
    }

    public void setBuiltUpArea(BigDecimal builtUpArea) {
        this.builtUpArea = builtUpArea;
    }

    public BigDecimal getSuperBuiltUpArea() {
        return superBuiltUpArea;
    }

    public void setSuperBuiltUpArea(BigDecimal superBuiltUpArea) {
        this.superBuiltUpArea = superBuiltUpArea;
    }

    public String getFurnishing() {
        return furnishing;
    }

    public void setFurnishing(String furnishing) {
        this.furnishing = furnishing;
    }

    public Integer getFloor() {
        return floor;
    }

    public void setFloor(Integer floor) {
        this.floor = floor;
    }

    public Integer getTotalFloors() {
        return totalFloors;
    }

    public void setTotalFloors(Integer totalFloors) {
        this.totalFloors = totalFloors;
    }

    public String getFacing() {
        return facing;
    }

    public void setFacing(String facing) {
        this.facing = facing;
    }

    public String getPossession() {
        return possession;
    }

    public void setPossession(String possession) {
        this.possession = possession;
    }

    public String getLocality() {
        return locality;
    }

    public void setLocality(String locality) {
        this.locality = locality;
    }

    public String getLocalitySlug() {
        return localitySlug;
    }

    public void setLocalitySlug(String localitySlug) {
        this.localitySlug = localitySlug;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public Double getLat() {
        return lat;
    }

    public void setLat(Double lat) {
        this.lat = lat;
    }

    public Double getLng() {
        return lng;
    }

    public void setLng(Double lng) {
        this.lng = lng;
    }

    public String getAddress() {
        return address;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getPincode() {
        return pincode;
    }

    public void setPincode(String pincode) {
        this.pincode = pincode;
    }

    public String getReraId() {
        return reraId;
    }

    public void setReraId(String reraId) {
        this.reraId = reraId;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public List<String> getAmenities() {
        return amenities;
    }

    public void setAmenities(List<String> amenities) {
        this.amenities = amenities;
    }

    public List<String> getImages() {
        return images;
    }

    public void setImages(List<String> images) {
        this.images = images;
    }

    public String getCoverImage() {
        return coverImage;
    }

    public void setCoverImage(String coverImage) {
        this.coverImage = coverImage;
    }

    public String getFloorPlan() {
        return floorPlan;
    }

    public void setFloorPlan(String floorPlan) {
        this.floorPlan = floorPlan;
    }

    public String getVideo() {
        return video;
    }

    public void setVideo(String video) {
        this.video = video;
    }

    public String getPostedByType() {
        return postedByType;
    }

    public void setPostedByType(String postedByType) {
        this.postedByType = postedByType;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public boolean isFeatured() {
        return featured;
    }

    public void setFeatured(boolean featured) {
        this.featured = featured;
    }

    public String getFlagReason() {
        return flagReason;
    }

    public void setFlagReason(String flagReason) {
        this.flagReason = flagReason;
    }

    public boolean isVerified() {
        return verified;
    }

    public void setVerified(boolean verified) {
        this.verified = verified;
    }

    public boolean isOwnerVerified() {
        return ownerVerified;
    }

    public void setOwnerVerified(boolean ownerVerified) {
        this.ownerVerified = ownerVerified;
    }

    public boolean isOwnershipVerified() {
        return ownershipVerified;
    }

    public void setOwnershipVerified(boolean ownershipVerified) {
        this.ownershipVerified = ownershipVerified;
    }

    public boolean isSocietyVerified() {
        return societyVerified;
    }

    public void setSocietyVerified(boolean societyVerified) {
        this.societyVerified = societyVerified;
    }

    public boolean isConveyanceDone() {
        return conveyanceDone;
    }

    public void setConveyanceDone(boolean conveyanceDone) {
        this.conveyanceDone = conveyanceDone;
    }

    public int getDocsCount() {
        return docsCount;
    }

    public void setDocsCount(int docsCount) {
        this.docsCount = docsCount;
    }

    public int getViews() {
        return views;
    }

    public void setViews(int views) {
        this.views = views;
    }

    public int getEnquiries() {
        return enquiries;
    }

    public void setEnquiries(int enquiries) {
        this.enquiries = enquiries;
    }
}
