package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ListingOpenedController {
    private final PropertyRepository properties;
    private final AuditService audit;
    private final Notifier notifier;

    public ListingOpenedController(PropertyRepository properties, AuditService audit, Notifier notifier) {
        this.properties = properties;
        this.audit = audit;
        this.notifier = notifier;
    }

    @PostMapping("/me/listings/{id}/opened")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void opened(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        Property property = owned(actor, id);
        if (!property.isArchived() && property.isPostedByAdmin()) {
            property.recordClaimLinkOpened();
        }
    }

    @PostMapping("/me/listings/{id}/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void confirm(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        Property property = owned(actor, id);
        if (!property.isPostedByAdmin()) {
            throw new ConflictException("not_staff_posted", "Only a listing posted on your behalf needs confirming");
        }
        if (property.getOwnerConfirmedAt() != null) {
            return;
        }
        if (property.isArchived() || !PropertyStatus.PENDING.equals(property.getStatus())) {
            throw new ConflictException("Only a listing waiting for review can be confirmed");
        }
        property.recordClaimLinkOpened();
        property.confirmByOwner();
        audit.record(actor, "property.owner.confirmed", "property", property.getId().toString());
        String staffId = property.getPostedByStaff();
        Ids.parseUuid(staffId).ifPresent(staff -> notifier.notify(staff, "listing.owner_confirmed",
                "Owner confirmed a listing", "\"" + property.getTitle() + "\" is ready for review.",
                "/admin/properties"));
    }

    private Property owned(AuthPrincipal actor, String id) {
        UUID owner = actor.userId();
        return Ids.parseUuid(id).flatMap(properties::findForVerificationDecision)
                .filter(p -> p.getOwner().getId().equals(owner))
                .orElseThrow(() -> NotFoundException.of("Listing"));
    }
}
