package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.locality.LocalityResolver;
import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertySort;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner write side of the catalogue: the {@code /me/listings} lifecycle plus archive/restore. Every
 * read/mutation is keyed by the server-resolved principal id, so a caller can only ever see or change
 * their own rows — cross-owner access returns {@code 404} (we never confirm another owner's listing
 * exists). Split from the public read service because the auth model and invariants differ.
 *
 * <p>Domain invariants enforced here, not just in the UI (ADR-019, trust): a new listing is forced
 * {@code pending} with the owner set from the token (never the body); editing a <em>foundation</em>
 * field earns a moderator's attention — how much of one depends on which field (below); restore-from
 * -archive resets to {@code pending}; removals are soft-deletes only.
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
 *       sale, is a wrong answer, not a slightly stale one. {@link Property#revertToPending()}, as
 *       before.</li>
 *   <li><strong>Stays live</strong> — {@code price}, {@code furnishing}, {@code possession}. These
 *       change <em>an attribute of a listing that is still the same property</em>, so the worst
 *       case is a briefly out-of-date number on a listing that is still genuinely what it claims to
 *       be. {@link Property#requestRecheck(java.util.List)} raises the same moderator work item
 *       without touching {@code status}.</li>
 * </ul>
 *
 * <p>Fraud risk is handled by the re-check either way; the difference is only whether the listing
 * earns while it waits. Price is the most-edited field on any marketplace and the one an owner is
 * most often asked to move — a rule that takes the listing dark for a day every time it moves
 * teaches owners not to move it, which is the opposite of what a marketplace wants.
 */
@Service
public class ListingService {

    private final PropertyRepository properties;
    private final UserRepository users;
    private final LocalityResolver localities;
    private final PropertyMapper propertyMapper;
    private final AuditService audit;

    public ListingService(PropertyRepository properties, UserRepository users,
            LocalityResolver localities, PropertyMapper propertyMapper, AuditService audit) {
        this.properties = properties;
        this.users = users;
        this.localities = localities;
        this.propertyMapper = propertyMapper;
        this.audit = audit;
    }

    /** The caller's own listings (all statuses incl. archived), owner-scoped; contract {@code myListings}. */
    @Transactional(readOnly = true)
    public Page<Property> myListings(UUID userId, Pageable pageable) {
        return properties.findByOwner_Id(userId, PropertySort.sanitize(pageable));
    }

    /** A single owned listing by slug-or-id; {@code 404} if it isn't the caller's (contract {@code getMyListing}). */
    @Transactional(readOnly = true)
    public Property getMine(UUID userId, String idOrSlug) {
        return resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /**
     * Create a listing (contract {@code createListing}). The trust-critical fields are server-set:
     * {@code status = pending}, {@code owner} = the authenticated caller (loaded, not a client id),
     * {@code postedByType = owner}, and {@code priceUnit} derived from the deal (buy → total,
     * rent → per-month). The listing therefore cannot be born approved or attributed to someone else.
     */
    @Transactional
    public Property create(UUID userId, ListingCreate in) {
        User owner = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("Owner"));
        Property p = new Property(owner, in.title(), in.deal(), in.propertyType(),
                in.price(), in.locality(), in.city());
        // Everything the client may say. PropertyMapper's allowlist decides what that is, so the
        // "deliberately absent" set in ListingCreate's Javadoc is enforced rather than described.
        propertyMapper.applyTo(in, p);

        // Everything it may not. These three are why a listing cannot be born approved or
        // attributed to someone else.
        p.setStatus(PropertyStatus.PENDING);
        p.setPostedByType(Roles.Wire.OWNER);
        p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
        /* Inherited, not claimed. `owner_verified` is denormalised onto the listing because buyers
         * and the ranking read it there, so it has to be stamped at both ends: the verification
         * webhook back-fills existing listings, and this stamps new ones. Without this half, an owner
         * who verified last month and posts today gets a listing that tells buyers they are
         * unverified — and the webhook cannot fix it, because a replayed DigiLocker success is
         * deliberately a no-op on an already-verified row. Read from the owner rather than accepted
         * from the client: it is a trust signal, so the only safe source is the one the client cannot
         * reach. */
        p.setOwnerVerified(owner.isAadhaarVerified());
        // After the mapper: the resolver's geo fallback needs lat/lng, which it has just set. Null
        // is an accepted outcome — see LocalityResolver — and simply leaves the listing out of
        // locality facets until curated.
        p.setLocalitySlug(localities.resolve(in.locality(), in.lat(), in.lng()));
        return properties.saveAndFlush(p);
    }

    /**
     * Partial update of an owned listing (contract {@code updateListing}). Only non-null fields are
     * applied (PATCH). A foundation-field change earns a re-review either way; which one it earns is
     * the split documented on this class (Q14) — an identity change reverts to {@code pending} and
     * leaves search, an attribute change raises a re-check and stays live. Non-foundation edits
     * (photos, description, deposit, …) leave both untouched.
     *
     * <p>When one PATCH does both, the revert wins and no re-check is raised: a full re-moderation
     * looks at the whole listing, so queueing the attribute change separately would put the same
     * edit in front of a moderator twice.
     */
    @Transactional
    public Property update(UUID userId, String idOrSlug, ListingUpdate in) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        EditImpact impact = apply(p, in);
        if (impact.remoderationRequired()) {
            p.revertToPending();
        } else if (impact.recheckOnly()) {
            p.requestRecheck(impact.rechecked());
        }
        return p;
    }

    /**
     * Field-level correction of <em>anyone's</em> listing by staff or admin (contract
     * {@code adminUpdateProperty}, {@code PATCH /properties/&#123;id&#125;/admin}).
     *
     * <p><strong>A moderator edit does not revert the listing to pending</strong>, and that is the
     * one behavioural difference from {@link #update}. Re-moderation exists so that a change made by
     * the owner is seen by a moderator before it goes live; here the moderator <em>is</em> the
     * change. Reverting would push their own correction into their own queue, so fixing a typo in an
     * approved listing would take it off the site until somebody re-approved it — and the natural
     * response to that is to stop correcting listings.
     *
     * <p>Audited, unlike the owner path. This is a write to a row belonging to someone else who will
     * never be told it happened, so "who changed my price" needs an answer that is not "nobody knows".
     *
     * <p>Lives here rather than in {@code moderation} because the body is {@code ListingUpdate} —
     * every field of {@code ListingCreate}, made optional — and a second copy of that mapping would
     * be a second place for a field to be forgotten. The moderation controller has said so since
     * slice 6; this is that comment being honoured.
     */
    @Transactional
    public Property updateAsModerator(AuthPrincipal principal, String idOrSlug, ListingUpdate in) {
        UUID id = parseUuid(idOrSlug);
        Property p = (id != null ? properties.findById(id) : properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        apply(p, in);
        audit.record(principal, "property.adminUpdate", "property", p.getId().toString(),
                "owner", p.getOwner() == null ? null : p.getOwner().getId().toString());
        return p;
    }

    /**
     * What a PATCH earned. {@code remoderationRequired} is the off-search outcome,
     * {@code recheckOnly} the stays-live one, and {@code rechecked} names the fields behind the
     * latter so the moderator's work item can say what to look at.
     *
     * <p>Two flags rather than one enum because they are answers to two independent questions, and
     * a single PATCH can trip both — see {@link #update} for which wins.
     */
    private record EditImpact(boolean remoderationRequired, boolean recheckOnly,
            List<String> rechecked) {
    }

    /**
     * Apply a PATCH body to a listing and report what re-review it earned. The caller decides what
     * to do about it — {@link #update} acts, {@link #updateAsModerator} deliberately does not.
     *
     * <p><strong>This method is the one place either foundation set is written down.</strong> There
     * is no constant to fall out of step with it: which set a field belongs to <em>is</em> which
     * flag its block sets, so a field cannot be in both and cannot be silently in neither. The two
     * blocks are kept first, contiguous and in that order; {@code ListingFoundationTest} asserts
     * both sets behaviourally through the real endpoint, and
     * {@code frontend/scripts/check-listing-foundation.mjs} parses them straight back out of this
     * source and fails if a field has moved between them.
     *
     * <p>The only thing distinguishing a foundation block from an ordinary one is the flag it sets,
     * so interleaving them is how {@code furnishing} ended up in the wrong set the first time.
     *
     * <p>Only non-null fields are applied, so absent and "set to null" are the same request. That is
     * the documented PATCH semantic for this contract; a client that needs to clear a field sends
     * the empty value the field's type allows.
     */
    private EditImpact apply(Property p, ListingUpdate in) {
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
     * Soft-delete a listing (contract {@code archiveProperty}). Permitted for the listing's owner or
     * for staff/admin (moderation); anyone else gets {@code 404} — the spec declares no {@code 403}
     * here, and hiding existence avoids listing enumeration. Never a hard delete.
     */
    @Transactional
    public Property archive(AuthPrincipal principal, String idOrSlug, String reason) {
        Property p = resolvePermitted(principal, idOrSlug);
        p.archive(reason);
        return p;
    }

    /**
     * Restore an archived listing (contract {@code restoreProperty}). Same owner-or-staff/admin rule;
     * per the domain rule the status is reset to {@code pending} so the un-archived listing is
     * re-moderated before it can go live again.
     */
    @Transactional
    public Property restore(AuthPrincipal principal, String idOrSlug) {
        Property p = resolvePermitted(principal, idOrSlug);
        p.restore();
        p.revertToPending();
        return p;
    }

    /** Owner-scoped resolve (UUID → id, else slug); empty for a row the caller doesn't own. */
    private Optional<Property> resolveOwned(UUID userId, String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        return id != null
                ? properties.findByIdAndOwner_Id(id, userId)
                : properties.findBySlugAndOwner_Id(idOrSlug, userId);
    }

    /**
     * Resolve any listing (across owners) and authorize the caller as owner or staff/admin, else
     * {@code 404}. Used by archive/restore, which staff/admin may perform on any listing.
     */
    private Property resolvePermitted(AuthPrincipal principal, String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        Property p = (id != null ? properties.findById(id) : properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        boolean isOwner = p.getOwner().getId().equals(principal.userId());
        boolean isModerator = Roles.Wire.STAFF.equals(principal.role())
                || Roles.Wire.ADMIN.equals(principal.role());
        if (!isOwner && !isModerator) {
            throw NotFoundException.of("Listing");
        }
        return p;
    }

    /** {@code true} when two nullable numerics are equal by value (BigDecimal scale-insensitive). */
    private static boolean numericEquals(BigDecimal a, BigDecimal b) {
        if (a == null || b == null) {
            return Objects.equals(a, b);
        }
        return a.compareTo(b) == 0;
    }

    /** Slug-or-id parse, shared semantics with the public read service. */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }
}
