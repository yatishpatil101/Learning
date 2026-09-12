package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.locality.LocalityResolver;
import com.draazy.api.catalog.property.AddressKey;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.MeterKey;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertySort;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.ListingCaseNotes;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owner write side of the catalogue: every read and mutation is keyed by the server-resolved
 * principal, so cross-owner access is a {@code 404}. docs/flows/consumer/list-property-wizard.md 9.
 */
@Service
public class ListingService {

    private final PropertyRepository properties;
    private final UserRepository users;
    private final LocalityResolver localities;
    private final ListingEditRules editRules;
    private final PropertyMapper propertyMapper;
    private final ListingCaseNotes caseNotes;
    private final ListingDuplicateProbe duplicates;
    private final AuditService audit;
    private final ListingQuota quota;

    public ListingService(PropertyRepository properties, UserRepository users,
            LocalityResolver localities, ListingEditRules editRules, PropertyMapper propertyMapper,
            ListingCaseNotes caseNotes, ListingDuplicateProbe duplicates, AuditService audit,
            ListingQuota quota) {
        this.properties = properties;
        this.users = users;
        this.caseNotes = caseNotes;
        this.duplicates = duplicates;
        this.localities = localities;
        this.editRules = editRules;
        this.propertyMapper = propertyMapper;
        this.audit = audit;
        this.quota = quota;
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
     * The owner confirms a listing is still available. What this deliberately leaves alone, and why
     * there is no audit row: docs/flows/consumer/list-property-wizard.md section 9.5.
     */
    @Transactional
    public Property confirmAvailable(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        p.confirmAvailable(Instant.now());
        return properties.save(p);
    }

    /**
     * Take the caller's own listing down (contract {@code archiveListing}). Soft and idempotent,
     * with a server-owned reason: docs/flows/consumer/list-property-wizard.md section 9.5.
     */
    @Transactional
    public Property archive(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (!p.isArchived()) {
            p.archive("Taken down by the owner");
        }
        return properties.save(p);
    }

    /**
     * Create a listing. The trust-critical fields are server-set, so a listing cannot be born
     * approved or attributed to someone else: docs/flows/consumer/list-property-wizard.md 9.1.
     */
    @Transactional
    public Property create(UUID userId, ListingCreate in) {
        quota.require(userId);
        return createOnBehalf(userId, in);
    }

    /**
     * The same creation without the freemium ceiling - back-office concierge desk only, and a
     * separate method rather than a flag: docs/flows/consumer/list-property-wizard.md section 9.2.
     */
    @Transactional
    public Property createOnBehalf(UUID userId, ListingCreate in) {
        User owner = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("Owner"));
        Property p = new Property(owner, in.title(), in.deal(), in.propertyType(),
                in.price(), in.locality(), in.city());
        // PropertyMapper's allowlist decides what the client may say, so ListingCreate's
        // "deliberately absent" set is enforced rather than described.
        propertyMapper.applyTo(in, p);
        p.setSocietySlug(editRules.requireSociety(in.societyId()));

        // Everything it may not. These three are why a listing cannot be born approved or
        // attributed to someone else.
        p.setStatus(PropertyStatus.PENDING);
        p.setPostedByType(Roles.Wire.OWNER);
        p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));
        // Inherited from the owner, never claimed by the client: the webhook back-fills existing
        // listings and this stamps new ones. See list-property-wizard.md section 9.1.
        p.setOwnerVerified(owner.isAadhaarVerified());
        // After the mapper: the resolver's geo fallback needs the lat/lng it has just set. A null
        // slug simply leaves the listing out of locality facets until curated.
        p.setLocalitySlug(localities.resolve(in.locality(), in.lat(), in.lng()));
        duplicates.reindex(p);
        properties.saveAndFlush(p);
        // After the flush, because the hash rows are keyed by the listing's id and it has one only
        // now. Before `flag`, because the photo arm reads back what this wrote.
        duplicates.reindexPhotos(p, in.photoHashes());
        duplicates.flag(p);
        // Counted at create, not approval, and it must stay on a *managed* owner - a detaching
        // @Modifying above this line drops it silently. See list-property-wizard.md section 9.1.
        owner.recordListingPosted();
        return p;
    }

    /**
     * "Have I already listed this?" (contract {@code checkOwnDuplicate}) - the key is derived on the
     * same path a create takes, so the pre-check and the write cannot disagree. Writes nothing.
     */
    @Transactional(readOnly = true)
    public ListingDuplicateVerdict duplicateCheck(UUID userId, ListingDuplicateCheck in) {
        String localitySlug = localities.resolve(in.locality(), in.lat(), in.lng());
        String addressKey = AddressKey.of(in.address(), in.city(), in.locality());
        return duplicates.ownDuplicate(userId,
                // Through the same normaliser the write path runs, which also subsumes the
                // blank-to-null guard: `= ''` matches in SQL where `= null` does not.
                MeterKey.of(in.electricityMeterNo()),
                addressKey, localitySlug);
    }

    /**
     * Partial update of an owned listing (contract {@code updateListing}). Which edits earn a revert
     * and which a re-check: docs/flows/consumer/list-property-wizard.md section 9.3.
     */
    @Transactional
    public Property update(UUID userId, String idOrSlug, ListingUpdate in) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        List<Object> signalBefore = duplicates.signalOf(p);
        EditImpact impact = editRules.apply(p, in);
        duplicates.reindex(p);
        boolean photosMoved = duplicates.reindexPhotos(p, in.photoHashes());
        if (impact.remoderationRequired()) {
            p.revertToPending();
            caseNotes.post(p.getId(), p.getDeal(),
                    "You changed something fundamental about this listing, so it has gone back "
                    + "for review and is off search until a moderator approves it. We usually get to "
                    + "these within a day.");
        } else if (impact.recheckOnly()) {
            String deskItemBefore = p.getRecheckReason();
            p.requestRecheck(impact.rechecked());
            // Branch on the work item the domain actually raised, and post only when it moved: an
            // owner looping a price edit would otherwise flood the desk queue's sort key.
            if (p.getRecheckRequestedAt() != null
                    && !Objects.equals(deskItemBefore, p.getRecheckReason())) {
                caseNotes.post(p.getId(), p.getDeal(), "You updated: "
                        + String.join(", ", impact.rechecked())
                        + ". Your listing stays live \u2014 our team is re-checking these details and will "
                        + "confirm shortly.");
            }
        }
        // Re-probe only when a signal moved, and last, after the status has settled because the
        // note quotes it. Photographs count as a signal: list-property-wizard.md section 9.3.
        if (photosMoved || !duplicates.signalOf(p).equals(signalBefore)) {
            duplicates.flag(p);
        }
        return p;
    }

    /**
     * Field-level correction of <em>anyone's</em> listing by staff or admin. Audited, and its
     * deliberate non-effects are in docs/flows/consumer/list-property-wizard.md section 9.3.
     */
    @Transactional
    public Property updateAsModerator(AuthPrincipal principal, String idOrSlug, ListingUpdate in) {
        UUID id = parseUuid(idOrSlug);
        Property p = (id != null ? properties.findById(id) : properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        editRules.apply(p, in);
        // The key is recomputed so the listing stays findable by a *later* probe, but no probe runs
        // on this edit: a human is already looking, and is the one making the change.
        duplicates.reindex(p);
        audit.record(principal, "property.adminUpdate", "property", p.getId().toString(),
                "owner", p.getOwner() == null ? null : p.getOwner().getId().toString());
        return p;
    }

    /** Owner-scoped resolve (UUID → id, else slug); empty for a row the caller doesn't own. */
    private Optional<Property> resolveOwned(UUID userId, String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        return id != null
                ? properties.findByIdAndOwner_Id(id, userId)
                : properties.findBySlugAndOwner_Id(idOrSlug, userId);
    }

    /** Slug-or-id parse, shared semantics with the public read service. */
    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }
}
