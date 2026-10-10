package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.ModerationFacets;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertySearchQuery;
import com.draazy.api.catalog.property.PropertyService;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The command palette's property search: six fields per hit, where the queue row carries about forty. */
@RestController
public class PropertyLookupController {

    private static final String PROPERTIES_READ = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    private final PropertyService propertyService;

    public PropertyLookupController(PropertyService propertyService) {
        this.propertyService = propertyService;
    }

    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_LOOKUP)
    @PreAuthorize(PROPERTIES_READ)
    public PageResponse<PropertyLookupRow> lookup(
            @RequestParam(required = false) String q,
            @PageableDefault(size = 6) Pageable pageable) {
        PropertySearchQuery filters = new PropertySearchQuery(
                null, null, null, null, null, null, null, null, q, null, null);
        return PageResponse.of(
                propertyService.searchForModeration(filters, ModerationFacets.NONE, Pageables.unsorted(pageable)),
                PropertyLookupController::row);
    }

    private static PropertyLookupRow row(Property p) {
        return new PropertyLookupRow(p.getId().toString(), p.getSlug(), p.getTitle(), p.getLocality(),
                p.getOwner() == null ? null : p.getOwner().getName(), p.getStatus());
    }
}
