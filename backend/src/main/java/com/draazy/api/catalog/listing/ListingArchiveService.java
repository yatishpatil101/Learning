package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Archive/restore use an unscoped lookup, so their owner-or-staff authorization lives here. */
@Service
public class ListingArchiveService {

    private final PropertyRepository properties;
    private final ListingDuplicateProbe duplicates;
    private final PropertyLifecycle lifecycle;
    private final AccountPermissions permissions;

    public ListingArchiveService(PropertyRepository properties, ListingDuplicateProbe duplicates,
            PropertyLifecycle lifecycle, AccountPermissions permissions) {
        this.properties = properties;
        this.duplicates = duplicates;
        this.lifecycle = lifecycle;
        this.permissions = permissions;
    }

    /** Unauthorized callers get {@code 404}, not {@code 403}, to avoid listing enumeration. */
    @Transactional
    public Property archive(AuthPrincipal principal, String idOrSlug, String reason) {
        Property p = resolvePermitted(principal, idOrSlug);
        p.archive(reason);
        return p;
    }

    /** Restored listings reenter moderation and duplicate probing before going live again. */
    @Transactional
    public Property restore(AuthPrincipal principal, String idOrSlug) {
        Property p = resolvePermitted(principal, idOrSlug);
        p.restore();
        if (!PropertyStatus.REJECTED.equals(p.getStatus())) {
            lifecycle.reenterPending(principal, p);
        }
        properties.flush();
        duplicates.flag(p);
        return p;
    }

    /** Lookup is deliberately unscoped; this authorization gate protects every listing. */
    private Property resolvePermitted(AuthPrincipal principal, String idOrSlug) {
        UUID id = Ids.parseUuid(idOrSlug).orElse(null);
        Property p = (id != null ? properties.findById(id) : properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Listing"));
        boolean isOwner = p.getOwner().getId().equals(principal.userId());
        boolean isModerator = Roles.isBackOffice(principal.role());
        if (!isOwner && !isModerator) {
            throw NotFoundException.of("Listing");
        }
        if (!isOwner && !permissions.granted(principal, BackOfficePermissions.PROPERTIES_MODERATE)) {
            throw new ForbiddenException("Your account cannot moderate listings.");
        }
        return p;
    }
}
