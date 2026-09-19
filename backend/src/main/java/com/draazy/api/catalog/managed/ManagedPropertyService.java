package com.draazy.api.catalog.managed;

import com.draazy.api.catalog.listing.ListingCreate;
import com.draazy.api.catalog.listing.ListingService;
import com.draazy.api.catalog.locality.LocalityResolver;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Validator;
import java.math.BigDecimal;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner side of the private property record. Everything is keyed by the token principal, so a
 * cross-owner id is {@code 404} rather than {@code 403} — we never confirm someone else's record.
 */
@Service
public class ManagedPropertyService {

    private static final String CITY = "Pune";

    private final ManagedPropertyRepository records;
    private final ManagedRentReceiptRepository receipts;
    private final ManagedPropertyMapper mapper;
    private final LocalityResolver localities;
    private final ListingService listingService;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final Validator validator;

    public ManagedPropertyService(ManagedPropertyRepository records,
            ManagedRentReceiptRepository receipts, ManagedPropertyMapper mapper,
            LocalityResolver localities, ListingService listingService,
            PropertyRepository properties, UserRepository users, Validator validator) {
        this.records = records;
        this.receipts = receipts;
        this.mapper = mapper;
        this.localities = localities;
        this.listingService = listingService;
        this.properties = properties;
        this.users = users;
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
     * Register a new private managed property, born private/managed with the owner from the token.
     * Adopting a listing (see {@link #adopt}) is the one way a record is born public.
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
     * Resolve the listing a new record claims, or refuse. Someone else's listing is {@code 404} so
     * the 403 does not confirm it exists; the caller's own, already claimed, is an honest {@code 409}.
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
                // floorPlan: nothing to tag — see photoHashes below, a managed record holds no
                // photographs, and the plan is one of them.
                null, null,
                // address / floor / societyId / electricityMeterNo: a managed record is a private
                // file on a property already held, so there is no duplicate to detect.
                null, null, null, null,
                // bathrooms / parking / balconies / facing / overlooking / totalFloors / ageYears
                // are not collected here, and publishing must not invent them.
                null, null, null, null, null, null, null,
                // photoHashes: a managed record holds no photographs, and there is no browser in
                // this call path to hash what the owner picked.
                null,
                // Postcode, exact areas, move-in bucket, pet policy and supplemental wizard answers
                // were not collected here, and a managed record is never a plot.
                null, null, null, null, null, null, null, null);
        // Publish is the boundary between a freely captured record and the stricter marketplace
        // contract, so re-run the listing's bean-validation here — ListingService.create does not.
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

    // Manual rent receipts (V120) — the owner's own record of cash or bank-transfer rent.
    // Disjoint from the payment domain: nothing here is evidence money moved through Draazy.

    /** Widest ledger a client may ask for. A year of history is more than the panel can show. */
    private static final int MAX_RECEIPT_MONTHS = 24;

    /** What the panel asks for when it says nothing. */
    private static final int DEFAULT_RECEIPT_MONTHS = 6;

    /** How far back an owner may record a month they took in cash and never got round to logging. */
    private static final int RECEIPT_BACKDATE_YEARS = 5;

    /**
     * The newest receipts for one owned property, newest month first. {@code months} is a page size,
     * so it is clamped rather than rejected; a foreign or unparseable id is {@code 404}.
     */
    @Transactional(readOnly = true)
    public List<ManagedRentReceiptDto> listRentReceipts(UUID ownerId, String id, Integer months) {
        ManagedProperty m = ownedRecord(ownerId, id);
        int limit = months == null ? DEFAULT_RECEIPT_MONTHS : Math.clamp(months, 1, MAX_RECEIPT_MONTHS);
        return mapper.toReceiptDtos(
                receipts.findByManagedPropertyIdOrderByRentMonthDesc(m.getId(), Limit.of(limit)));
    }

    /**
     * Record one month as received and mint the immutable receipt. Every figure is snapshotted
     * server-side: a rent receipt is a tax document, and "the browser said so" is not a provenance.
     */
    @Transactional
    public ManagedRentReceiptDto recordRentReceipt(UUID ownerId, String id, String rentMonth) {
        ManagedProperty m = ownedRecord(ownerId, id);
        requireReceiptableMonth(rentMonth);
        if (!m.isRented()) {
            throw new ValidationException("Turn on rent tracking for this property first");
        }
        Long rent = m.getMonthlyRent();
        if (rent == null || rent <= 0) {
            throw new ValidationException("Set a monthly rent for this property first");
        }
        if (m.getTenantName() == null || m.getTenantName().isBlank()) {
            throw new ValidationException("Add the tenant's name for this property first");
        }
        if (receipts.existsByManagedPropertyIdAndRentMonth(m.getId(), rentMonth)) {
            throw new ConflictException("Rent for " + rentMonth + " is already recorded");
        }
        User owner = users.findById(ownerId).orElseThrow(() -> NotFoundException.of("Owner"));
        String landlord = owner.getName() == null || owner.getName().isBlank()
                ? "Owner"
                : owner.getName().trim();
        return mapper.toDto(receipts.saveAndFlush(new ManagedRentReceipt(m, rentMonth, landlord)));
    }

    /**
     * Refuse a month no tenancy could have paid rent for — a receipt is immutable and undeletable,
     * so an unbounded month mints nonsense documents without limit.
     */
    private static void requireReceiptableMonth(String rentMonth) {
        YearMonth now = YearMonth.now(ZoneId.of("Asia/Kolkata"));
        if (rentMonth.compareTo(now.toString()) > 0) {
            throw new ValidationException("You can't record rent for a month that hasn't happened yet");
        }
        if (rentMonth.compareTo(now.minusYears(RECEIPT_BACKDATE_YEARS).toString()) < 0) {
            throw new ValidationException(
                    "You can only record the last " + RECEIPT_BACKDATE_YEARS + " years of rent");
        }
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
