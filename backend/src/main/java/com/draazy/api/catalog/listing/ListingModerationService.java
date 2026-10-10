package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.locality.LocalityRepository;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.settings.PhotoLimit;
import com.draazy.api.security.AuthPrincipal;
import java.util.Arrays;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ListingModerationService {

    private final ListingService listings;
    private final ListingEditRules editRules;
    private final LocalityRepository localities;
    private final ListingDuplicateProbe duplicates;
    private final ListingPhotoSources photoSources;
    private final PhotoLimit photoLimit;
    private final AuditService audit;

    public ListingModerationService(ListingService listings, ListingEditRules editRules,
            LocalityRepository localities, ListingDuplicateProbe duplicates, ListingPhotoSources photoSources, PhotoLimit photoLimit,
            AuditService audit) {
        this.listings = listings;
        this.editRules = editRules;
        this.localities = localities;
        this.duplicates = duplicates;
        this.photoSources = photoSources;
        this.photoLimit = photoLimit;
        this.audit = audit;
    }

    /** Staff edit of anyone's listing; deliberate non-effects: docs/flows/consumer/list-property-wizard.md 9.3. */
    @Transactional
    public Property updateAsModerator(AuthPrincipal principal, String idOrSlug, ListingUpdate in) {
        Property p = listings.resolveForWrite(idOrSlug).orElseThrow(() -> NotFoundException.of("Listing"));
        photoLimit.require("A listing", in.images());
        photoSources.requireUploaded(in.images(), p.getImages(),
                Arrays.asList(p.getOwner() == null ? null : p.getOwner().getId(), principal.userId()).stream()
                        .filter(Objects::nonNull).toList());
        String slugBefore = p.getLocalitySlug();
        editRules.apply(p, in);
        if (in.lat() == null && in.lng() == null && !Objects.equals(slugBefore, p.getLocalitySlug())) {
            movePinToLocality(p);
        }

        // The key is recomputed so the listing stays findable by a *later* probe, but no probe runs
        // on this edit: a human is already looking, and is the one making the change.
        duplicates.reindex(p);
        audit.record(principal, "property.adminUpdate", "property", p.getId().toString(),
                "owner", p.getOwner() == null ? null : p.getOwner().getId().toString());
        return p;
    }

    // A moved locality with no pin of its own would otherwise leave the map pointing at the old one.
    private void movePinToLocality(Property p) {
        localities.findById(p.getLocalitySlug())
                .filter(l -> l.getLat() != null && l.getLng() != null)
                .ifPresent(l -> {
                    p.setLat(l.getLat());
                    p.setLng(l.getLng());
                });
    }
}
