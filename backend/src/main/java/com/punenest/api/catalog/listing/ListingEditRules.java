package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.locality.LocalityResolver;
import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.society.SocietyRepository;
import com.punenest.api.common.error.NotFoundException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Which edits to a listing earn a moderator's attention, and which kind.
 *
 * <p>Extracted from {@code ListingService} when that class reached the 450-line ceiling
 * {@code ServiceSizeGuardTest} enforces. The split is along a real seam rather than a convenient
 * one: everything here <em>decides</em> and nothing here <em>acts</em>. {@link #apply} mutates the
 * listing with the caller's values and returns what that cost, and the two callers then do opposite
 * things with the answer — {@code ListingService.update} reverts or queues a re-check,
 * {@code updateAsModerator} deliberately does neither. Keeping the decision in one place and the
 * two reactions in the caller is what stops the moderator path drifting into the owner rule.
 *
 * <p><strong>What counts as a foundation field, and why that set.</strong> It is exactly the set a
 * buyer can <em>search on</em>: {@code price}, {@code bhk}, {@code propertyType}, {@code locality},
 * {@code deal}, {@code furnishing} and {@code possession} — one per facet accepted by
 * {@code GET /properties}. Re-moderation exists to stop bait-and-switch, and bait-and-switch is
 * specifically the act of being approved into one set of search results and then editing your way
 * into a different, more valuable one. Any facet an owner can change without review is a hole of
 * exactly that shape, so deriving the rule from the facet list rather than curating it by hand is
 * what keeps the two in step: a new facet that is not also a foundation field is a new hole, and
 * {@code ListingFoundationTest} fails until someone has decided which it is.
 *
 * <p>{@code furnishing} and {@code possession} were missing from this set until the API polish pass.
 * Both are live filters, so an approved unfurnished flat could be relabelled "furnished", and an
 * under-construction listing relabelled "ready to move", with no moderator ever seeing it.
 *
 * <p><strong>What re-review costs, and why it is not one price (Q14).</strong> Every foundation edit
 * is re-checked; the split is only over whether the listing keeps earning while it waits.
 *
 * <ul>
 *   <li><strong>Off search</strong> — {@code locality}, {@code propertyType}, {@code bhk},
 *       {@code deal}. These change <em>what the listing fundamentally is</em>, so a stale index
 *       entry would actively mislead searchers: a 2BHK appearing under 3BHK, or a rental under
 *       sale, is a wrong answer, not a slightly stale one.</li>
 *   <li><strong>Stays live</strong> — {@code price}, {@code furnishing}, {@code possession}. These
 *       change <em>an attribute of a listing that is still the same property</em>, so the worst
 *       case is a briefly out-of-date number on a listing that is still genuinely what it claims to
 *       be. The same moderator work item is raised without touching {@code status}.</li>
 * </ul>
 *
 * <p>Fraud risk is handled by the re-check either way; the difference is only whether the listing
 * earns while it waits. Price is the most-edited field on any marketplace and the one an owner is
 * most often asked to move — a rule that takes the listing dark for a day every time it moves
 * teaches owners not to move it, which is the opposite of what a marketplace wants.
 */
@Component
public class ListingEditRules {

    private final LocalityResolver localities;
    private final SocietyRepository societies;

    public ListingEditRules(LocalityResolver localities, SocietyRepository societies) {
        this.localities = localities;
        this.societies = societies;
    }

    /**
     * Apply a PATCH body to a listing and report what re-review it earned. The caller decides what
     * to do about it — {@code ListingService.update} acts, {@code updateAsModerator} deliberately
     * does not.
     *
     * <p><strong>This method is the one place either foundation set is written down.</strong> There
     * is no constant to fall out of step with it: which set a field belongs to <em>is</em> which
     * flag its block sets, so a field cannot be in both and cannot be silently in neither. The two
     * blocks are kept first, contiguous and in that order; {@code ListingFoundationTest} asserts
     * both sets behaviourally through the real endpoint, and
     * {@code frontend/scripts/check-listing-foundation.mjs} parses them straight back out of this
     * source and fails if a field has moved between them. That script reads this file <em>by
     * path</em> and matches this signature as a literal, so moving either is a two-file change.
     *
     * <p>The only thing distinguishing a foundation block from an ordinary one is the flag it sets,
     * so interleaving them is how {@code furnishing} ended up in the wrong set the first time.
     *
     * <p>Only non-null fields are applied, so absent and "set to null" are the same request. That is
     * the documented PATCH semantic for this contract; a client that needs to clear a field sends
     * the empty value the field's type allows.
     */
    EditImpact apply(Property p, ListingUpdate in) {
        boolean remoderationRequired = false;
        boolean recheckOnly = false;
        List<String> rechecked = new ArrayList<>();
        boolean localityChanged = false;

        // ── Foundation, OFF SEARCH ────────────────────────────────────────────────────────────
        // These change what the listing fundamentally *is*, so a stale index entry is a wrong
        // answer rather than a late one: a 2BHK under 3BHK, or a rental under sale.
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
            // A deal flip changes the meaning of price — keep priceUnit consistent.
            p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
            remoderationRequired = true;
        }

        // ── Foundation, STAYS LIVE ────────────────────────────────────────────────────────────
        // Still re-checked, still searchable: these change an attribute of a listing that is still
        // the same property, so the worst case is a briefly out-of-date value on a listing that is
        // genuinely what it claims to be (Q14).
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
        // D219. The one field here a buyer cannot filter on, and it is in this set for a different
        // reason: `address` is what AddressKey derives the duplicate signal from, so an edit to it is
        // how a listing moves onto an address somebody else already holds. The probe already
        // notices and files a note — but only when the collision exists, and a moderator reading
        // "possible duplicate" has no way to tell an honest correction from an owner who typed their
        // way onto a neighbour's flat. The re-check names the field and is raised either way.
        if (in.address() != null && !in.address().equals(p.getAddress())) {
            p.setAddress(in.address());
            recheckOnly = true;
            rechecked.add("address");
        }

        // Non-foundation fields: applied without triggering re-moderation.
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
        if (in.societyId() != null) {
            p.setSocietySlug(requireSociety(in.societyId()));
            p.setSocietyId(in.societyId());
        }
        if (in.electricityMeterNo() != null) {
            p.setElectricityMeterNo(in.electricityMeterNo());
        }

        // Re-bind the curated slug only when the display locality actually changed — deliberately not
        // on a lat/lng-only edit. Coordinates are non-foundation (no re-moderation), so re-resolving
        // on them would let an owner silently move an approved listing into a different market's
        // search results. Run last so the resolver's geo fallback sees this request's coordinates.
        if (localityChanged) {
            p.setLocalitySlug(localities.resolve(p.getLocality(), p.getLat(), p.getLng()));
        }

        return new EditImpact(remoderationRequired, recheckOnly && !remoderationRequired, rechecked);
    }

    /**
     * Refuse a society id that names nothing, on both the create and the update path.
     *
     * <p>Not a duplicate of {@code properties_society_id_fkey}, which does already stop the write —
     * but stops it as a constraint violation surfacing at flush, which is a {@code 409} on a request
     * that is not a conflict with anything. An owner who sends a stale id gets a 404 naming what was
     * not found, and the error shape stops depending on which of two writes reaches the database
     * first.
     *
     * <p>Existence is also all that can be checked here today, and it is worth being clear that it is
     * the weaker half of the problem. The FK already rules out ids that name nothing; what neither it
     * nor this can rule out is an owner naming a society that <em>does</em> exist and has nothing to
     * do with them, which puts their listing on that society's hub and into its count. Closing that
     * needs a claim linking an owner to a society — the same missing claim that took the society arm
     * out of the duplicate probe (see {@code PropertyRepository#findDuplicateCandidates}). When it
     * exists, it goes here.
     * <p>Returns the society's slug rather than nothing, because {@code Property.societySlug} is a
     * {@code @Formula} and a formula is only evaluated by a SELECT. A listing that has just been
     * inserted or updated is still the managed instance the writer built, so its derived slug is
     * null until some later request loads the row afresh — and that instance is exactly what the
     * create and update responses are mapped from. Handing the slug back here lets the writer stamp
     * it, so the response to the write says the same thing as the next read of it.
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
