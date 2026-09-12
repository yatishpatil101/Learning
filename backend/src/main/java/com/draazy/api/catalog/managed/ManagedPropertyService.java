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

    // ---------------------------------------------------------------------------------------------
    // Manual rent receipts (V120)
    //
    // The owner's own record of rent that arrived as cash or a bank transfer Draazy never saw.
    // Deliberately disjoint from the payment domain: Draazy does not collect rent, so nothing
    // here may be read as evidence that money moved through the platform.
    // ---------------------------------------------------------------------------------------------

    /** Widest ledger a client may ask for. A year of history is more than the panel can show. */
    private static final int MAX_RECEIPT_MONTHS = 24;

    /** What the panel asks for when it says nothing. */
    private static final int DEFAULT_RECEIPT_MONTHS = 6;

    /** How far back an owner may record a month they took in cash and never got round to logging. */
    private static final int RECEIPT_BACKDATE_YEARS = 5;

    /**
     * The newest receipts for one owned property, newest month first.
     *
     * <p>{@code months} is clamped rather than rejected: it is a page size, not an assertion about
     * the world, and a client that asks for 5000 wants "all of them" — answering 422 would be a
     * puzzle rather than a correction. A foreign or unparseable id gets the same {@code 404} as an
     * unknown one, from {@link #ownedRecord}.
     */
    @Transactional(readOnly = true)
    public List<ManagedRentReceiptDto> listRentReceipts(UUID ownerId, String id, Integer months) {
        ManagedProperty m = ownedRecord(ownerId, id);
        int limit = months == null ? DEFAULT_RECEIPT_MONTHS : Math.clamp(months, 1, MAX_RECEIPT_MONTHS);
        return mapper.toReceiptDtos(
                receipts.findByManagedPropertyIdOrderByRentMonthDesc(m.getId(), Limit.of(limit)));
    }

    /**
     * Record one month as received and mint the immutable receipt for it.
     *
     * <p>The request carries a month and nothing else. Amount, tenant, landlord and address are all
     * snapshotted server-side from the owned property and the caller's own user row — a rent receipt
     * is a tax document, and "the browser said so" is not a provenance for one.
     *
     * <p>Three preconditions, all 422 because they describe a property that cannot produce a receipt
     * rather than a malformed request: the property must be marked rented, carry a positive monthly
     * rent, and name a tenant. The old {@code localStorage} version failed the same cases silently by
     * returning {@code {ok:false}} and letting the panel guess at a message.
     *
     * <p>A fourth, on the month itself: the pattern on the request admits {@code 0000-01} through
     * {@code 9999-12}, and the unique index only stops a month being receipted twice — not a month
     * being absurd. Since a receipt is immutable and has no delete, an unbounded month is both a
     * nonsense tax document and a way to mint rows without limit. Rent is received in the past, so
     * the window is "not in the future, and within {@value #RECEIPT_BACKDATE_YEARS} years".
     *
     * @throws ConflictException 409 if this month already has a receipt — one receipt per month, so
     *     a double tap converges instead of handing a tenant two documents for one payment
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
     * Refuse a month no tenancy could have paid rent for. Compared as {@code YYYY-MM} strings, which
     * sort lexicographically for exactly this format — the same reason the ledger query orders by
     * the raw column instead of parsing it.
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
