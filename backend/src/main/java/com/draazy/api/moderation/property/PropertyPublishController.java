package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertySummary;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PropertyPublishController {
    private final PropertyModerationService moderation;
    private final PropertyMapper mapper;

    public PropertyPublishController(PropertyModerationService moderation, PropertyMapper mapper) {
        this.moderation = moderation;
        this.mapper = mapper;
    }

    @PostMapping("/properties/{id}/publish")
    @PreAuthorize(BackOfficePermissions.REQUIRE_PROPERTIES_WRITE)
    public PropertySummary publish(@CurrentUser AuthPrincipal actor, @PathVariable String id) {
        return mapper.toSummary(moderation.publish(actor, id));
    }
}