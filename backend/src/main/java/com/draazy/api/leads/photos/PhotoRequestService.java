package com.draazy.api.leads.photos;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// The lightest gate on the platform, deliberately.
// Contact-gate prerequisites do not apply because photo requests reveal no phone number.
@Service
public class PhotoRequestService {

    private final PhotoRequestRepository photoRequests;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final PhotoRequestMapper mapper;
    private final Notifier notifier;
    private final AuditService audit;

    public PhotoRequestService(PhotoRequestRepository photoRequests, PropertyRepository properties,
            UserRepository users, PhotoRequestMapper mapper, Notifier notifier, AuditService audit) {
        this.photoRequests = photoRequests;
        this.properties = properties;
        this.users = users;
        this.mapper = mapper;
        this.notifier = notifier;
        this.audit = audit;
    }

    @Transactional
    public PhotoRequestCreateResponse request(UUID requesterId, String propertyIdOrSlug) {
        Property property = resolve(propertyIdOrSlug);

        User owner = property.getOwner();
        if (owner != null && owner.getId().equals(requesterId)) {
            throw new BadRequestException("You cannot request more photos of your own listing.");
        }

        return photoRequests.findByRequesterIdAndPropertyId(requesterId, property.getId())
                .map(existing -> new PhotoRequestCreateResponse(false, project(existing, property)))
                .orElseGet(() -> {
                    PhotoRequest saved =
                            photoRequests.save(new PhotoRequest(property.getId(), requesterId));
                    if (owner != null) {
                        notifier.notify(owner.getId(), "photo.requested",
                                "Someone wants more photos",
                                "A buyer asked for more photos of " + property.getTitle() + ".",
                                "/dashboard#leads");
                    }
                    return new PhotoRequestCreateResponse(true, project(saved, property));
                });
    }

    @Transactional(readOnly = true)
    public Page<PhotoRequestResponse> myRequests(UUID ownerId, Pageable pageable) {
        List<UUID> ownedPropertyIds = properties.findIdsByOwnerId(ownerId);
        if (ownedPropertyIds.isEmpty()) {
            return Page.empty(pageable);
        }
        Page<PhotoRequest> rows =
                photoRequests.findByPropertyIdInOrderByCreatedAtDesc(ownedPropertyIds, pageable);
        return rows.map(projector(rows.getContent()));
    }

    @Transactional
    public PhotoRequestResponse decide(AuthPrincipal owner, UUID requestId, String decision) {
        if (!PhotoRequestStatuses.isTerminal(decision)) {
            throw new BadRequestException("decision must be one of: %s, %s."
                    .formatted(PhotoRequestStatuses.RESOLVED, PhotoRequestStatuses.DECLINED));
        }
        PhotoRequest row = photoRequests.findById(requestId)
                .orElseThrow(() -> NotFoundException.of("Photo request"));
        Property property = properties.findById(row.getPropertyId())
                .orElseThrow(() -> NotFoundException.of("Photo request"));
        User propertyOwner = property.getOwner();
        if (propertyOwner == null || !propertyOwner.getId().equals(owner.userId())) {
            throw NotFoundException.of("Photo request");
        }
        String before = row.getStatus();
        if (decision.equals(before)) {
            return project(row, property);
        }
        if (PhotoRequestStatuses.isTerminal(before)) {
            return project(row, property);
        }
        row.decide(decision, Instant.now());
        PhotoRequestResponse answer = project(photoRequests.save(row), property);
        audit.record(owner, "photo.request." + decision, "photoRequest",
                row.getId().toString(), "fromStatus", before, "toStatus", decision);
        announce(row.getRequesterId(), decision, answer);
        return answer;
    }

    // Photo decisions are visible on the listing, so both outcomes are announced.
    // Contact declines stay silent because a terminal no is not actionable.
    private void announce(UUID requesterId, String decision, PhotoRequestResponse answer) {
        String link = "/property/"
                + (answer.propertySlug() != null ? answer.propertySlug() : answer.propertyId());
        String listing = answer.propertyTitle() != null ? answer.propertyTitle() : "the listing";
        if (PhotoRequestStatuses.RESOLVED.equals(decision)) {
            notifier.notify(requesterId, "photo.added",
                    "More photos added",
                    "The owner added more photos of %s — take a look.".formatted(listing),
                    link);
        } else {
            notifier.notify(requesterId, "photo.declined",
                    "No more photos available",
                    "The owner has shared everything they have of %s.".formatted(listing),
                    link);
        }
    }

    private PhotoRequestResponse project(PhotoRequest row, Property property) {
        return mapper.toResponse(row, property, users.findById(row.getRequesterId()).orElse(null));
    }

    private Function<PhotoRequest, PhotoRequestResponse> projector(List<PhotoRequest> rows) {
        Set<UUID> propertyIds =
                rows.stream().map(PhotoRequest::getPropertyId).collect(Collectors.toSet());
        Set<UUID> requesterIds =
                rows.stream().map(PhotoRequest::getRequesterId).collect(Collectors.toSet());
        Map<UUID, Property> propertiesById = properties.findAllById(propertyIds).stream()
                .collect(Collectors.toMap(Property::getId, Function.identity()));
        Map<UUID, User> usersById = users.findAllById(requesterIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        return row -> mapper.toResponse(row,
                propertiesById.get(row.getPropertyId()), usersById.get(row.getRequesterId()));
    }

    /** Resolve a path token that may be a UUID or a slug — the same either/or the detail endpoint accepts. */
    private Property resolve(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
