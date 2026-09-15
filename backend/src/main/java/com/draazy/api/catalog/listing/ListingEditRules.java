package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.locality.LocalityResolver;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.error.NotFoundException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Which edits to a listing earn a moderator's attention, and which kind — this class decides, the
 * caller acts. Rationale: docs/system/cross-cutting.md#25-foundation-edits.
 */
@Component
public class ListingEditRules {

    private final LocalityResolver localities;
    private final SocietyRepository societies;

    public ListingEditRules(LocalityResolver localities, SocietyRepository societies) {
        this.localities = localities;
        this.societies = societies;
    }

    private static void clearStaleAddressParts(Property property, ListingUpdate update) {
        if (update.formDetails() != null || property.getFormDetails() == null) return;
        Set<String> addressParts = Set.of("flatNumber", "tower", "society", "street", "landmark");
        property.setFormDetails(property.getFormDetails().entrySet().stream()
                .filter(entry -> !addressParts.contains(entry.getKey()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
    }

    /**
     * Apply a PATCH body and report the re-review it earned; only non-null fields are applied.
     * The two foundation blocks are kept first and contiguous — see the class Javadoc's rationale.
     */
    EditImpact apply(Property p, ListingUpdate in) {
        boolean remoderationRequired = false;
        boolean recheckOnly = false;
        List<String> rechecked = new ArrayList<>();
        boolean localityChanged = false;

        // ── Foundation, OFF SEARCH: these change what the listing fundamentally *is*, so a stale
        // index entry is a wrong answer rather than a late one. ───────────────────────────────
        if (in.bhk() != null && !numericEquals(in.bhk(), p.getBhk())) {
            p.setBhk(in.bhk());
            remoderationRequired = true;
        }
        if (in.propertyType() != null && !in.propertyType().equals(p.getPropertyType())) {
            p.setPropertyType(in.propertyType());
            remoderationRequired = true;
        }
        if (in.locality() != null && !in.locality().equals(p.getLocality())) {
            p.setLocality(in.locality());
            remoderationRequired = true;
            localityChanged = true;
        }
        if (in.deal() != null && !in.deal().equals(p.getDeal())) {
            p.setDeal(in.deal());
            // Rent and sale require different evidence; publication approval must not reuse the old verdict.
            p.revokeOwnershipVerification();
            // A deal flip changes the meaning of price — keep priceUnit consistent.
            p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
            remoderationRequired = true;
        }

        // ── Foundation, STAYS LIVE: still re-checked, still searchable — these change an attribute
        // of a listing that is genuinely still the same property (Q14). ───────────────────────
        if (in.price() != null && !in.price().equals(p.getPrice())) {
            p.setPrice(in.price());
            recheckOnly = true;
            rechecked.add("price");
        }
        if (in.furnishing() != null && !in.furnishing().equals(p.getFurnishing())) {
            p.setFurnishing(in.furnishing());
            recheckOnly = true;
            rechecked.add("furnishing");
        }
        if (in.possession() != null && !in.possession().equals(p.getPossession())) {
            p.setPossession(in.possession());
            recheckOnly = true;
            rechecked.add("possession");
        }
        // `address` is what AddressKey derives the duplicate signal from, so an edit to it is how a
        // listing moves onto an address somebody else already holds. Re-check either way.
        if (in.address() != null && !in.address().equals(p.getAddress())) {
            // A legacy/staff correction must not leave components that restore the old address.
            clearStaleAddressParts(p, in);
            p.setAddress(in.address());
            recheckOnly = true;
            rechecked.add("address");
        }

        // Non-foundation fields: applied without triggering re-moderation.
        if (in.formDetails() != null) p.setFormDetails(Map.copyOf(in.formDetails()));
        if (in.pincode() != null) p.setPincode(in.pincode());
        if (in.carpetArea() != null) p.setCarpetArea(in.carpetArea());
        if (in.builtUpArea() != null) p.setBuiltUpArea(in.builtUpArea());
        if (in.title() != null) {
            p.setTitle(in.title());
        }
        if (in.deposit() != null) {
            p.setDeposit(in.deposit());
        }
        if (in.maintenance() != null) {
            p.setMaintenance(in.maintenance());
        }
        if (in.negotiable() != null) {
            p.setNegotiable(in.negotiable());
        }
        if (in.area() != null) {
            p.setArea(in.area());
        }
        if (in.areaUnit() != null) {
            p.setAreaUnit(in.areaUnit());
        }
        if (in.city() != null) {
            p.setCity(in.city());
        }
        if (in.lat() != null) {
            p.setLat(in.lat());
        }
        if (in.lng() != null) {
            p.setLng(in.lng());
        }
        if (in.reraId() != null) {
            p.setReraId(in.reraId());
        }
        if (in.amenities() != null) {
            p.setAmenities(in.amenities());
        }
        if (in.images() != null) {
            p.setImages(in.images());
        }
        if (in.description() != null) {
            p.setDescription(in.description());
        }
        if (in.floor() != null) {
            p.setFloor(in.floor());
        }
        // Plain non-foundation applies: correcting a bathroom count or a facing is not something the
        // moderator approved, so it must not knock an approved listing back to pending.
        if (in.bathrooms() != null) {
            p.setBathrooms(in.bathrooms());
        }
        if (in.parking() != null) {
            p.setParking(in.parking());
        }
        if (in.balconies() != null) {
            p.setBalconies(in.balconies());
        }
        if (in.facing() != null) {
            p.setFacing(in.facing());
        }
        if (in.overlooking() != null) {
            p.setOverlooking(in.overlooking());
        }
        if (in.totalFloors() != null) {
            p.setTotalFloors(in.totalFloors());
        }
        if (in.ageYears() != null) {
            p.setAgeYears(in.ageYears());
        }
        if (in.societyId() != null) {
            p.setSocietySlug(requireSociety(in.societyId()));
            p.setSocietyId(in.societyId());
        }
        if (in.electricityMeterNo() != null) {
            p.setElectricityMeterNo(in.electricityMeterNo());
        }

        // Re-bind the curated slug only when the display locality changed, never on a lat/lng-only
        // edit — that would silently move an approved listing into another market's results.
        if (localityChanged) {
            p.setLocalitySlug(localities.resolve(p.getLocality(), p.getLat(), p.getLng()));
        }

        return new EditImpact(remoderationRequired, recheckOnly && !remoderationRequired, rechecked);
    }

    /**
     * Refuse a society id that names nothing, so a stale id is a {@code 404} rather than an FK
     * violation surfacing as a {@code 409}. Returns the slug so the writer can stamp the formula.
     */
    String requireSociety(UUID societyId) {
        if (societyId == null) {
            return null;
        }
        return societies.findById(societyId)
                .orElseThrow(() -> NotFoundException.of("Society"))
                .getSlug();
    }

    /** {@code true} when two nullable numerics are equal by value (BigDecimal scale-insensitive). */
    private static boolean numericEquals(BigDecimal a, BigDecimal b) {
        if (a == null || b == null) {
            return Objects.equals(a, b);
        }
        return a.compareTo(b) == 0;
    }
}
