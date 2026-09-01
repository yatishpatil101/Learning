package com.punenest.api.catalog.managed;

import com.punenest.api.catalog.listing.ListingCreate;
import com.punenest.api.catalog.listing.ListingService;
import com.punenest.api.catalog.locality.LocalityResolver;
import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner side of the private property record: the {@code /me/managed-properties} lifecycle. Every
 * read and mutation is keyed by the server-resolved principal id, so a caller only ever sees or
 * changes their own records — a cross-owner id returns {@code 404} (we never confirm someone else's
 * record exists), never {@code 403}.
 *
 * <p>Two invariants live here, not just in the UI: a record is born {@code private}/{@code managed}
 * with the owner taken from the token (never the body), and {@link #publish} is the only path that
 * moves it to {@code public}/{@code published}. Publish does not merge the record into the
 * catalogue — it creates an ordinary <em>pending</em> listing through {@link ListingService#create}
 * (so every trust invariant on a new listing still applies) and links back to it. It is idempotent:
 * a record already carrying a {@code publishedListingId} is returned unchanged, with no second
 * listing spawned.
 */
@Service
public class ManagedPropertyService {

    private static final String CITY = "Pune";

    private final ManagedPropertyRepository records;
    private final ManagedPropertyMapper mapper;
    private final LocalityResolver localities;
    private final ListingService listingService;
    private final PropertyRepository properties;
    private final Validator validator;

    public ManagedPropertyService(ManagedPropertyRepository records, ManagedPropertyMapper mapper,
            LocalityResolver localities, ListingService listingService,
            PropertyRepository properties, Validator validator) {
        this.records = records;
        this.mapper = mapper;
        this.localities = localities;
        this.listingService = listingService;
        this.properties = properties;
        this.validator = validator;
    }

    /** The caller's own managed records, newest first. */
    @Transactional(readOnly = true)
    public List<ManagedPropertyDto> list(UUID ownerId) {
        return mapper.toDtos(records.findByOwnerIdOrderByCreatedAtDescIdDesc(ownerId));
    }

    /** A single owned record; {@code 404} if it isn't the caller's. */
    @Transactional(readOnly = true)
    public ManagedPropertyDto get(UUID ownerId, String id) {
        return mapper.toDto(ownedRecord(ownerId, id));
    }

    /**
     * Register a new private managed property. {@code title} is synthesized from bhk/type/locality
     * when the caller leaves it blank; {@code localitySlug} is resolved server-side; a rent deal with
     * no explicit {@code monthlyRent} tracks the asking price. Lifecycle stays private/managed.
     *
     * <p>Unless the request adopts a listing — see {@link #adopt}. That is the one way a record is
     * born public, and it exists because {@link #publish} only runs managed-record-first: a property
     * listed the ordinary way could never acquire the owner's private file for it.
     */
    @Transactional
    public ManagedPropertyDto register(UUID ownerId, ManagedPropertyCreateRequest in) {
        String title = (in.title() == null || in.title().isBlank())
                ? synthTitle(in.bhk(), in.propertyType(), in.locality())
                : in.title().trim();
        String slug = localities.resolve(in.locality(), null, null);

        ManagedProperty m = new ManagedProperty(ownerId, title, in.deal(), in.propertyType(),
                in.bhk(), in.price(), in.locality(), slug, in.society(), in.area(), in.areaUnit(),
                in.furnishing());
        m.setRented(Boolean.TRUE.equals(in.rented()));
        m.setTenantName(in.tenantName());
        m.setMonthlyRent(in.monthlyRent() != null ? in.monthlyRent()
                : (DealIntent.RENT.equals(in.deal()) ? in.price() : null));
        m.setDueDay(in.dueDay());
        m.setValuation(in.valuation());
        if (in.publishedListingId() != null && !in.publishedListingId().isBlank()) {
            m.markPublished(adopt(ownerId, in.publishedListingId()));
        }
        return mapper.toDto(records.saveAndFlush(m));
    }

    /**
     * Resolve the listing a new record is claiming as its own, or refuse.
     *
     * <p>Two checks, and the distinction between their statuses is the point. A listing that is not
     * the caller's is {@code 404}: adopting is a write against someone else's row, and a 403 would
     * confirm the listing exists to a caller who has no business knowing. A listing that is already
     * spoken for is {@code 409}, because the caller can see it perfectly well — it is theirs — and
     * the honest answer is that it already has a file. V93's partial unique index is what actually
     * guarantees one-to-one; this check exists so the common case reads as a sentence rather than a
     * constraint violation.
     */
    private UUID adopt(UUID ownerId, String listingId) {
        Property listing = Ids.parseUuid(listingId)
                .flatMap(properties::findById)
                .filter(p -> p.getOwner() != null && ownerId.equals(p.getOwner().getId()))
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (records.findByPublishedListingId(listing.getId()).isPresent()) {
            throw new ConflictException("That listing already has a managed record.");
        }
        return listing.getId();
    }

    /** Partial update of an owned record; only non-null fields are applied. */
    @Transactional
    public ManagedPropertyDto update(UUID ownerId, String id, ManagedPropertyUpdateRequest in) {
        ManagedProperty m = ownedRecord(ownerId, id);
        if (in.title() != null) {
            m.setTitle(in.title());
        }
        if (in.deal() != null) {
            m.setDeal(in.deal());
        }
        if (in.propertyType() != null) {
            m.setPropertyType(in.propertyType());
        }
        if (in.bhk() != null) {
            m.setBhk(in.bhk());
        }
        if (in.price() != null) {
            m.setPrice(in.price());
        }
        if (in.locality() != null) {
            m.setLocality(in.locality());
            m.setLocalitySlug(localities.resolve(in.locality(), null, null));
        }
        if (in.society() != null) {
            m.setSociety(in.society());
        }
        if (in.area() != null) {
            m.setArea(in.area());
        }
        if (in.areaUnit() != null) {
            m.setAreaUnit(in.areaUnit());
        }
        if (in.furnishing() != null) {
            m.setFurnishing(in.furnishing());
        }
        if (in.rented() != null) {
            m.setRented(in.rented());
        }
        if (in.tenantName() != null) {
            m.setTenantName(in.tenantName());
        }
        if (in.monthlyRent() != null) {
            m.setMonthlyRent(in.monthlyRent());
        }
        if (in.dueDay() != null) {
            m.setDueDay(in.dueDay());
        }
        if (in.valuation() != null) {
            m.setValuation(in.valuation());
        }
        return mapper.toDto(records.saveAndFlush(m));
    }

    /** Hard-delete an owned record. The listing it may have spawned is untouched. */
    @Transactional
    public void delete(UUID ownerId, String id) {
        records.delete(ownedRecord(ownerId, id));
    }

    /**
     * Publish an owned record into the marketplace: create an ordinary pending listing from its
     * facts and link back to it. Idempotent — a record already published is returned unchanged.
     */
    @Transactional
    public ManagedPropertyDto publish(UUID ownerId, String id) {
        ManagedProperty m = ownedRecord(ownerId, id);
        if (m.getPublishedListingId() != null) {
            return mapper.toDto(m);
        }
        ListingCreate listing = new ListingCreate(
                m.getTitle(), m.getDeal(), m.getPropertyType(), m.getBhk(), m.getPrice(),
                null, null, null, m.getArea(), m.getAreaUnit(), m.getFurnishing(),
                m.getLocality(), CITY, null, null, null, null, null, null, null,
                // address / floor / societyId / electricityMeterNo: a managed record is the owner's
                // private file on a property they already hold, so there is no duplicate to detect
                // and nothing here to carry into these.
                null, null, null, null,
                // bathrooms / parking / balconies / facing / totalFloors / ageYears (V114): a
                // managed record does not collect them, and publishing must not invent them. The
                // owner fills them in on the listing afterwards if they want the tiles filled.
                null, null, null, null, null, null,
                // photoHashes (V116): a managed record holds no photographs, and the hash is
                // computed by the wizard from what the owner picked in the browser. There is nothing
                // here to hash and no browser in this call path.
                null);
        // A managed record is captured freely (furnishing is free-text, price may be zero); the
        // marketplace contract is stricter. Publish is the boundary, so re-run the listing's own
        // bean-validation here — ListingService.create does not (only @Valid at a controller does) —
        // rather than let a record that can't legally be a listing slip into the catalogue.
        Set<ConstraintViolation<ListingCreate>> violations = validator.validate(listing);
        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }
        Property created = listingService.create(ownerId, listing);
        m.markPublished(created.getId());
        return mapper.toDto(records.saveAndFlush(m));
    }

    private ManagedProperty ownedRecord(UUID ownerId, String id) {
        return Ids.parseUuid(id)
                .flatMap(records::findById)
                .filter(m -> m.getOwnerId().equals(ownerId))
                .orElseThrow(() -> NotFoundException.of("Managed property"));
    }

    private static String synthTitle(BigDecimal bhk, String type, String locality) {
        String bhkLabel = "";
        if (bhk != null && bhk.signum() > 0) {
            int n = bhk.intValue();
            bhkLabel = (n >= 4 ? "4+ BHK" : n + " BHK") + " ";
        }
        String t = (type == null || type.isBlank()) ? "Property" : type.trim();
        String loc = (locality == null || locality.isBlank()) ? "" : " in " + locality.trim();
        return bhkLabel + t + loc;
    }
}
