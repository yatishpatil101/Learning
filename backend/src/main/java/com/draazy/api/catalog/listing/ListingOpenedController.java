package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ListingOpenedController {
    private final PropertyRepository properties;

    public ListingOpenedController(PropertyRepository properties) {
        this.properties = properties;
    }

    @PostMapping("/me/listings/{id}/opened")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void opened(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        Property property = Ids.parseUuid(id).flatMap(properties::findForVerificationDecision)
                .filter(p -> p.getOwner().getId().equals(actor.userId()))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        if (!property.isArchived() && PropertyStatus.PENDING.equals(property.getStatus())
                && "staff".equals(property.getLifecycleTrack())
                && (property.getLifecycleStage() == null || "link_sent".equals(property.getLifecycleStage()))) {
            property.recordLifecycleStage("opened");
        }
    }
}