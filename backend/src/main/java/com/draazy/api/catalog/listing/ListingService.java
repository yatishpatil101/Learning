package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.locality.LocalityBinding;
import com.draazy.api.catalog.property.AddressKey;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.MeterKey;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertySort;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.settings.PhotoLimit;
import com.draazy.api.common.trust.ListingCaseNotes;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import jakarta.validation.metadata.ConstraintDescriptor;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.hibernate.Hibernate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Every read and mutation is keyed by the server-resolved principal, so cross-owner access is a {@code 404}. */
@Service
public class ListingService {

    private final PropertyRepository properties;
    private final UserRepository users;
    private final LocalityBinding localities;
    private final ListingEditRules editRules;
    private final PropertyMapper propertyMapper;
    private final PropertyLifecycle propertyLifecycle;
    private final ListingCaseNotes caseNotes;
    private final ListingDuplicateProbe duplicates;
    private final AuditService audit;
    private final ListingQuota quota;
    private final RateLimitLock locks;
    private final ListingPhotoSources photoSources;
    private final PhotoLimit photoLimit;

    public ListingService(PropertyRepository properties, UserRepository users,
            LocalityBinding localities, ListingEditRules editRules, PropertyMapper propertyMapper,
            PropertyLifecycle propertyLifecycle, ListingCaseNotes caseNotes, ListingDuplicateProbe duplicates, AuditService audit,
            ListingQuota quota, RateLimitLock locks, ListingPhotoSources photoSources,
            PhotoLimit photoLimit) {
        this.properties = properties;
        this.users = users;
        this.caseNotes = caseNotes;
        this.duplicates = duplicates;
        this.localities = localities;
        this.editRules = editRules;
        this.propertyMapper = propertyMapper;
        this.propertyLifecycle = propertyLifecycle;
        this.audit = audit;
        this.quota = quota;
        this.locks = locks;
        this.photoSources = photoSources;
        this.photoLimit = photoLimit;
    }

    @Transactional(readOnly = true)
    public Page<Property> myListings(UUID userId, Pageable pageable) {
        return properties.findByOwner_Id(userId, PropertySort.sanitize(pageable));
    }

    @Transactional(readOnly = true)
    public Property getMine(UUID userId, String idOrSlug) {
        return resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }

    /** No audit row by design: docs/flows/consumer/list-property-wizard.md section 9.5. */
    @Transactional
    public Property confirmAvailable(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        p.confirmAvailable(Instant.now());
        return properties.save(p);
    }

    @Transactional
    public Property pause(AuthPrincipal actor, String idOrSlug) {
        Property p = resolveOwned(actor.userId(), idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (p.isArchived() || !PropertyStatus.APPROVED.equals(p.getStatus())) {
            throw new ConflictException("Only a live approved listing can be paused");
        }
        p.pauseByOwner();
        audit.record(actor, "property.ownerPause", "property", p.getId().toString(),
                "owner", actor.userId().toString());
        return properties.save(p);
    }

    @Transactional
    public Property resume(AuthPrincipal actor, String idOrSlug) {
        Property p = resolveOwned(actor.userId(), idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (p.isArchived() || !PropertyStatus.PAUSED.equals(p.getStatus())) {
            throw new ConflictException("Only an owner-paused listing can be resumed");
        }
        p.resumeByOwner();
        audit.record(actor, "property.ownerResume", "property", p.getId().toString(),
                "owner", actor.userId().toString());
        duplicates.flag(p);
        return properties.save(p);
    }

    /** Soft and idempotent, with a server-owned reason: docs/flows/consumer/list-property-wizard.md 9.5. */
    @Transactional
    public Property archive(UUID userId, String idOrSlug) {
        Property p = resolveOwned(userId, idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (!p.isArchived()) {
            p.archive("Taken down by the owner");
        }
        return properties.save(p);
    }

    /** Trust-critical fields are server-set, so a listing cannot be born approved or attributed to someone else. */
    @Transactional
    public Property create(UUID userId, ListingCreate in) {
        locks.holdUntilCommit(RateLimitLock.Limit.LISTING_CREATE, userId.toString());
        quota.require(userId);
        quota.requirePace(userId);
        requirePhotosOnCreate(in.images());
        return createOnBehalf(userId, in, userId);
    }

    @Transactional
    public Property createOnBehalf(UUID userId, ListingCreate in, UUID... uploadOwnerIds) {
        return createOnBehalf(userId, in, null, uploadOwnerIds);
    }

    /** {@code existingLocalitySlug} is a binding the source record already holds, kept even when that locality is not live. */
    @Transactional
    public Property createOnBehalf(UUID userId, ListingCreate in, String existingLocalitySlug, UUID... uploadOwnerIds) {
        photoLimit.require("A listing", in.images());
        List<UUID> allowedUploadOwners = Arrays.stream(uploadOwnerIds).filter(Objects::nonNull).distinct().toList();
        photoSources.requireUploaded(in.images(), List.of(), allowedUploadOwners);
        photoSources.requireUploaded(in.floorPlan() == null ? List.of() : List.of(in.floorPlan()),
                List.of(), allowedUploadOwners);
        User owner = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("Owner"));
        LocalityBinding.Bound locality = localities.require(in.localitySlug(), in.locality(), existingLocalitySlug);
        Property p = new Property(owner, in.title(), in.deal(), in.propertyType(),
                in.price(), locality.name(), in.city());

        // PropertyMapper's allowlist decides what the client may say, so ListingCreate's
        // "deliberately absent" set is enforced rather than described.
        propertyMapper.applyTo(in, p);
        ListingEditRules.clearReadyToMoveSaleAvailableDate(p);
        editRules.stampSociety(p, in.societyId(), true);

        // The poster type records who was on the other end of the call, so it is the caller's to
        // state and never the request body's.
        p.setStatus(PropertyStatus.PENDING);
        p.setPriceUnit(DealIntent.priceUnitFor(in.deal()));

        // Inherited from the owner, never claimed by the client: approval back-fills existing
        // listings and this stamps new ones. See list-property-wizard.md section 9.1.
        p.setOwnerVerified(owner.isVerified());

        p.setLocalitySlug(locality.slug());
        duplicates.reindex(p);
        properties.saveAndFlush(p);

        duplicates.reindexPhotos(p, PhotoHash.fromGallery(in.images()));
        duplicates.flag(p);

        // Counted at create, not approval, and it must stay on a *managed* owner - a detaching
        // @Modifying above this line drops it silently. See list-property-wizard.md section 9.1.
        owner.recordListingPosted();
        return p;
    }

    /** The key is derived on the same path a create takes, so the pre-check and the write cannot disagree. */
    @Transactional(readOnly = true)
    public ListingDuplicateVerdict duplicateCheck(UUID userId, ListingDuplicateCheck in) {
        String localitySlug = localities.slugOrNull(in.localitySlug(), in.locality());
        String addressKey = AddressKey.of(in.address(), in.city(), in.locality());
        return duplicates.ownDuplicate(userId,

                // Through the same normaliser the write path runs, which also subsumes the
                // blank-to-null guard: `= ''` matches in SQL where `= null` does not.
                MeterKey.of(in.electricityMeterNo()),
                addressKey, localitySlug);
    }

    @Transactional
    public Property update(AuthPrincipal actor, String idOrSlug, ListingUpdate in) {
        Property p = resolveOwnedForWrite(actor.userId(), idOrSlug)
                .orElseThrow(() -> NotFoundException.of("Listing"));
        String statusBefore = p.getStatus();
        boolean answeringInfoRequest = PropertyStatus.PENDING.equals(statusBefore) && p.isAwaitingOwnerInfo();
        List<Object> signalBefore = duplicates.signalOf(p);
        requireNonEmptyPhotosIfPresent(in.images());
        photoLimit.require("A listing", in.images());
        photoSources.requireUploaded(in.images(), p.getImages(), List.of(actor.userId()));
        EditImpact impact = editRules.apply(p, in);
        duplicates.reindex(p);
        boolean photosMoved = duplicates.reindexPhotos(p, PhotoHash.fromGallery(in.images()));
        if (answeringInfoRequest && !p.isArchived()) {
            propertyLifecycle.reenterPending(actor, p);
            p.provideInfo();
            caseNotes.post(p.getId(), p.getDeal(),
                    "Thanks — your update has gone back to our review desk.");
        } else if (impact.remoderationRequired() && !p.isArchived()
                && (PropertyStatus.PENDING.equals(p.getStatus())
                || PropertyStatus.APPROVED.equals(p.getStatus())
                || PropertyStatus.PAUSED.equals(p.getStatus()))) {
            propertyLifecycle.reenterPending(actor, p);
            if (!PropertyStatus.PENDING.equals(statusBefore)) {
                p.recordResubmission();
            }
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

    /** Staff correction of anyone's listing; deliberate non-effects: docs/flows/consumer/list-property-wizard.md 9.3. */
    @Transactional
    public Property updateAsModerator(AuthPrincipal principal, String idOrSlug, ListingUpdate in) {
        Property p = resolveForWrite(idOrSlug).orElseThrow(() -> NotFoundException.of("Listing"));
        photoLimit.require("A listing", in.images());
        photoSources.requireUploaded(in.images(), p.getImages(),
                Arrays.asList(p.getOwner() == null ? null : p.getOwner().getId(), principal.userId()).stream()
                        .filter(Objects::nonNull).toList());
        editRules.apply(p, in);

        // The key is recomputed so the listing stays findable by a *later* probe, but no probe runs
        // on this edit: a human is already looking, and is the one making the change.
        duplicates.reindex(p);
        audit.record(principal, "property.adminUpdate", "property", p.getId().toString(),
                "owner", p.getOwner() == null ? null : p.getOwner().getId().toString());
        return p;
    }

    private Optional<Property> resolveOwned(UUID userId, String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        return id != null
                ? properties.findByIdAndOwner_Id(id, userId)
                : properties.findBySlugAndOwner_Id(idOrSlug, userId);
    }

    private Optional<Property> resolveOwnedForWrite(UUID userId, String idOrSlug) {
        return resolveForWrite(idOrSlug)
                .filter(property -> property.getOwner().getId().equals(userId));
    }

    private Optional<Property> resolveForWrite(String idOrSlug) {
        UUID id = parseUuid(idOrSlug);
        Optional<Property> locked = id != null
                ? properties.findForVerificationDecision(id)
                : properties.findBySlug(idOrSlug)
                        .flatMap(property -> properties.findForVerificationDecision(property.getId()));

        locked.ifPresent(property -> Hibernate.initialize(property.getOwner()));
        return locked;
    }

    private static UUID parseUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }

    private static void requirePhotosOnCreate(List<String> images) {
        if (images != null && !images.isEmpty()) {
            return;
        }
        throw new ConstraintViolationException(Set.of(new SimpleViolation(
                "images", "must include at least one photo")));
    }

    private static void requireNonEmptyPhotosIfPresent(List<String> images) {
        if (images == null || !images.isEmpty()) {
            return;
        }
        throw new ConstraintViolationException(Set.of(new SimpleViolation(
                "images", "must include at least one photo")));
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
}
