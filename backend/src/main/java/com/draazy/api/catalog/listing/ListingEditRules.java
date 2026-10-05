package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.locality.LocalityResolver;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyPossession;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import jakarta.validation.metadata.ConstraintDescriptor;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

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

    static void clearReadyToMoveSaleAvailableDate(Property property) {
        if (!DealIntent.BUY.equals(property.getDeal())
                || !PropertyPossession.READY_TO_MOVE.equals(property.getPossession())
                || property.getFormDetails() == null
                || !property.getFormDetails().containsKey("availableFrom")) {
            return;
        }
        property.setFormDetails(property.getFormDetails().entrySet().stream()
                .filter(entry -> !"availableFrom".equals(entry.getKey()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
    }

    /** Did this PATCH relabel the commercial subtype? Absent formDetails is "unchanged", not "cleared". */
    private static boolean commercialTypeChanged(Property property, ListingUpdate update) {
        if (update.formDetails() == null) return false;
        Object incoming = update.formDetails().get("commercialType");
        Object stored = property.getFormDetails() == null
                ? null
                : property.getFormDetails().get("commercialType");

        /** Symmetric with the write, which replaces the map rather than merging: a PATCH that merely
         * omits the key deletes an approved subtype, which is the same moderation event as relabelling. */
        return !Objects.equals(incoming, stored);
    }

    /** Apply a PATCH body and report the re-review it earned; only non-null fields are applied.
     * The two foundation blocks are kept first and contiguous — see the class Javadoc's rationale. */
    EditImpact apply(Property p, ListingUpdate in) {
        validateSanityPatch(p, in);
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

        if (commercialTypeChanged(p, in)) {
            remoderationRequired = true;
        }

        // Same argument for zoning: an agricultural plot approved against a 7/12 extract must not be
        // relabelled residential and go on answering a filter it was never checked for.
        if (Boolean.TRUE.equals(in.clearLandUse())) {
            if (p.getLandUse() != null) {
                p.setLandUse(null);
                remoderationRequired = true;
            }
        } else if (in.landUse() != null && !in.landUse().equals(p.getLandUse())) {
            p.setLandUse(in.landUse());
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

            p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
            remoderationRequired = true;
        }

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
            p.revokeOwnershipVerification();
            recheckOnly = true;
            rechecked.add("address");
        }
        if (in.societyId() != null && !Objects.equals(in.societyId(), p.getSocietyId())) {
            p.setSocietySlug(requireSociety(in.societyId()));
            p.setSocietyId(in.societyId());
            p.revokeOwnershipVerification();
            recheckOnly = true;
            rechecked.add("societyId");
        }
        if (in.electricityMeterNo() != null && !Objects.equals(in.electricityMeterNo(), p.getElectricityMeterNo())) {
            p.setElectricityMeterNo(in.electricityMeterNo());
            p.revokeOwnershipVerification();
            recheckOnly = true;
            rechecked.add("electricityMeterNo");
        }
        if (in.carpetArea() != null && materialCarpetAreaChange(p.getCarpetArea(), in.carpetArea())) {
            recheckOnly = true;
            rechecked.add("carpetArea");
        }
        if (locationMovedMoreThan500m(p, in)) {
            recheckOnly = true;
            rechecked.add("location");
        }

        /** Photos, prose and amenities are the evidence a reviewer approved against, so swapping them re-sells
         * that approval. Stays-live because it is the same flat, and going dark would cost a day per photo. */
        if (in.images() != null && !in.images().equals(p.getImages())) {
            p.setImages(List.copyOf(in.images()));
            recheckOnly = true;
            rechecked.add("images");
        }
        if (in.description() != null && !in.description().equals(p.getDescription())) {
            p.setDescription(in.description());
            recheckOnly = true;
            rechecked.add("description");
        }
        if (in.amenities() != null && !in.amenities().equals(p.getAmenities())) {
            p.setAmenities(List.copyOf(in.amenities()));
            recheckOnly = true;
            rechecked.add("amenities");
        }
        if (in.reraId() != null && !in.reraId().equals(p.getReraId())) {
            recheckOnly = true;
            rechecked.add("reraId");
        }
        if (plottedProjectChanged(p, in)) {
            recheckOnly = true;
            rechecked.add("plottedProject");
        }

        if (in.formDetails() != null) p.setFormDetails(Map.copyOf(in.formDetails()));
        if (in.pincode() != null) p.setPincode(in.pincode());
        if (in.carpetArea() != null) p.setCarpetArea(in.carpetArea());
        if (in.builtUpArea() != null) p.setBuiltUpArea(in.builtUpArea());
        if (in.superBuiltUpArea() != null) p.setSuperBuiltUpArea(in.superBuiltUpArea());

        /** Non-foundation only because the membership rule holds: a PATCH carrying `floorPlan` alone has
         * no `images` key, so without it an approved listing could render an unreviewed image. */
        if (in.floorPlan() != null) {
            String plan = in.floorPlan().isBlank() ? null : in.floorPlan();
            if (plan != null && (p.getImages() == null || !p.getImages().contains(plan))) {
                throw new ValidationException("A floor plan must be one of the listing's photos.");
            }
            p.setFloorPlan(plan);
        }
        if (in.video() != null) {
            String video = in.video().isBlank() ? null : in.video();
            if (!Objects.equals(video, p.getVideo())) {
                recheckOnly = true;
                rechecked.add("video");
            }
            p.setVideo(video);
        }

        // Blank is how an owner withdraws a move-in claim; the column admits only the three buckets.
        if (in.availableFrom() != null) {
            p.setAvailableFrom(in.availableFrom().isBlank() ? null : in.availableFrom());
        }
        if (Boolean.TRUE.equals(in.clearPets())) {
            p.setPets(null);
        } else if (in.pets() != null) {
            p.setPets(in.pets());
        }
        if (in.title() != null) {
            p.setTitle(in.title());
        }
        if (in.deposit() != null) {
            p.setDeposit(in.deposit());
        }
        if (Boolean.TRUE.equals(in.clearMaintenance())) {
            p.setMaintenance(null);
        } else if (in.maintenance() != null) {
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
        if (in.tenants() != null) {
            p.setTenants(List.copyOf(in.tenants()));
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
        if (in.societyId() != null && Objects.equals(in.societyId(), p.getSocietyId())) {
            p.setSocietySlug(requireSociety(in.societyId()));
            p.setSocietyId(in.societyId());
        }
        if (in.electricityMeterNo() != null && Objects.equals(in.electricityMeterNo(), p.getElectricityMeterNo())) {
            p.setElectricityMeterNo(in.electricityMeterNo());
        }

        // Re-bind the curated slug only when the display locality changed, never on a lat/lng-only
        // edit — that would silently move an approved listing into another market's results.
        if (localityChanged) {
            p.setLocalitySlug(localities.resolve(p.getLocality(), p.getLat(), p.getLng()));
        }
        clearReadyToMoveSaleAvailableDate(p);

        return new EditImpact(remoderationRequired, recheckOnly && !remoderationRequired, rechecked);
    }

    private void validateSanityPatch(Property p, ListingUpdate in) {
        Set<ConstraintViolation<?>> violations = new LinkedHashSet<>();
        String deal = in.deal() == null ? p.getDeal() : in.deal();
        String propertyType = in.propertyType() == null ? p.getPropertyType() : in.propertyType();
        Long price = in.price() == null ? p.getPrice() : in.price();
        BigDecimal carpet = in.carpetArea() == null ? p.getCarpetArea() : in.carpetArea();
        BigDecimal builtUp = in.builtUpArea() == null ? p.getBuiltUpArea() : in.builtUpArea();
        BigDecimal superBuiltUp = in.superBuiltUpArea() == null ? p.getSuperBuiltUpArea() : in.superBuiltUpArea();
        String reraId = in.reraId() == null ? p.getReraId() : in.reraId();
        Object plottedProject = in.formDetails() != null && in.formDetails().containsKey("plottedProject")
                ? in.formDetails().get("plottedProject")
                : p.getFormDetails() == null ? null : p.getFormDetails().get("plottedProject");

        if (in.price() != null || in.deal() != null) {
            if (DealIntent.BUY.equals(deal) && price != null && price < 100_000L) {
                violations.add(violation("price", "must be at least Rs. 1,00,000 for a sale listing"));
            }
            if (DealIntent.RENT.equals(deal) && price != null && price < 1_000L) {
                violations.add(violation("price", "must be at least Rs. 1,000 per month"));
            }
            if (DealIntent.RENT.equals(deal) && p.getDeposit() != null && p.getPrice() != null
                    && p.getDeposit() <= p.getPrice() * 24L && price != null
                    && p.getDeposit() > price * 24L) {
                violations.add(violation("deposit", "cannot exceed 24 months of rent"));
            }
        }
        if (in.deposit() != null && DealIntent.RENT.equals(deal) && price != null && in.deposit() > price * 24L) {
            violations.add(violation("deposit", "cannot exceed 24 months of rent"));
        }
        if (isResidential(propertyType)) {
            if (in.carpetArea() != null || in.propertyType() != null) {
                if (outside(carpet, new BigDecimal("100"), new BigDecimal("20000"))) {
                    violations.add(violation("carpetArea",
                            "must be between 100 and 20,000 sq.ft for a residential listing"));
                }
                if (exceeds(carpet, builtUp)) {
                    violations.add(violation("builtUpArea", "must be at least the carpet area"));
                }
                BigDecimal superFloor = builtUp == null ? carpet : builtUp;
                if (exceeds(superFloor, superBuiltUp)) {
                    violations.add(violation("superBuiltUpArea",
                            builtUp == null ? "must be at least the carpet area" : "must be at least the built-up area"));
                }
            } else if (in.builtUpArea() != null) {
                if (exceeds(carpet, builtUp)) {
                    violations.add(violation("builtUpArea", "must be at least the carpet area"));
                }
                if (exceeds(builtUp, superBuiltUp)) {
                    violations.add(violation("superBuiltUpArea", "must be at least the built-up area"));
                }
            } else if (in.superBuiltUpArea() != null) {
                BigDecimal superFloor = builtUp == null ? carpet : builtUp;
                if (exceeds(superFloor, superBuiltUp)) {
                    violations.add(violation("superBuiltUpArea",
                            builtUp == null ? "must be at least the carpet area" : "must be at least the built-up area"));
                }
            }
        }
        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }
    }

    private static boolean plottedProjectChanged(Property property, ListingUpdate update) {
        if (update.formDetails() == null || !update.formDetails().containsKey("plottedProject")) {
            return false;
        }
        Object stored = property.getFormDetails() == null ? null : property.getFormDetails().get("plottedProject");
        return !Objects.equals(update.formDetails().get("plottedProject"), stored);
    }

    private static boolean materialCarpetAreaChange(BigDecimal current, BigDecimal incoming) {
        if (current == null || current.signum() == 0 || numericEquals(current, incoming)) {
            return false;
        }
        BigDecimal delta = incoming.subtract(current).abs();
        return delta.multiply(new BigDecimal("5")).compareTo(current.abs()) >= 0;
    }

    private static boolean locationMovedMoreThan500m(Property p, ListingUpdate in) {
        if (in.lat() == null && in.lng() == null) {
            return false;
        }
        Double oldLat = p.getLat();
        Double oldLng = p.getLng();
        Double newLat = in.lat() == null ? oldLat : in.lat();
        Double newLng = in.lng() == null ? oldLng : in.lng();
        if (oldLat == null || oldLng == null || newLat == null || newLng == null) {
            return false;
        }
        double earthMetres = 6_371_000d;
        double dLat = Math.toRadians(newLat - oldLat);
        double dLng = Math.toRadians(newLng - oldLng);
        double lat1 = Math.toRadians(oldLat);
        double lat2 = Math.toRadians(newLat);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthMetres * c > 500d;
    }

    private static boolean outside(BigDecimal value, BigDecimal min, BigDecimal max) {
        return value != null && (value.compareTo(min) < 0 || value.compareTo(max) > 0);
    }

    private static boolean exceeds(BigDecimal smaller, BigDecimal larger) {
        return smaller != null && larger != null && smaller.compareTo(larger) > 0;
    }

    private static boolean isResidential(String propertyType) {
        if (propertyType == null) {
            return false;
        }
        String label = propertyType.toLowerCase(java.util.Locale.ROOT);
        return label.contains("flat")
                || label.contains("apartment")
                || label.contains("studio")
                || label.contains("penthouse")
                || label.contains("independent house")
                || label.contains("row house")
                || label.contains("villa");
    }

    private static ConstraintViolation<?> violation(String field, String message) {
        return new SimpleViolation(field, message);
    }

    private record SimplePath(String field) implements Path {
        @Override
        public Iterator<Node> iterator() {
            return Collections.emptyIterator();
        }

        @Override
        public String toString() {
            return field;
        }
    }

    private record SimpleViolation(String field, String message) implements ConstraintViolation<Object> {
        @Override
        public String getMessage() {
            return message;
        }

        @Override
        public String getMessageTemplate() {
            return message;
        }

        @Override
        public Object getRootBean() {
            return null;
        }

        @Override
        public Class<Object> getRootBeanClass() {
            return Object.class;
        }

        @Override
        public Object getLeafBean() {
            return null;
        }

        @Override
        public Object[] getExecutableParameters() {
            return null;
        }

        @Override
        public Object getExecutableReturnValue() {
            return null;
        }

        @Override
        public Path getPropertyPath() {
            return new SimplePath(field);
        }

        @Override
        public Object getInvalidValue() {
            return null;
        }

        @Override
        public ConstraintDescriptor<?> getConstraintDescriptor() {
            return null;
        }

        @Override
        public <U> U unwrap(Class<U> type) {
            throw new jakarta.validation.ValidationException("No unwrap target for " + type.getName());
        }
    }

    /** Refuse a society id that names nothing, so a stale id is a {@code 404} rather than an FK
     * violation surfacing as a {@code 409}. Returns the slug so the writer can stamp the formula. */
    String requireSociety(UUID societyId) {
        if (societyId == null) {
            return null;
        }
        return societies.findById(societyId)
                .orElseThrow(() -> NotFoundException.of("Society"))
                .getSlug();
    }

    private static boolean numericEquals(BigDecimal a, BigDecimal b) {
        if (a == null || b == null) {
            return Objects.equals(a, b);
        }
        return a.compareTo(b) == 0;
    }
}
