package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Taking a listing down and putting it back (D218).
 *
 * <p><strong>Why this is not two more methods on {@code ListingService}.</strong> It is a different
 * use case with a different reason to change and, decisively, a different authorization rule. The
 * editing path in {@code ListingService} is owner-scoped — the repository lookup itself carries
 * {@code AndOwner_Id}, so a listing belonging to somebody else is invisible and no separate check is
 * needed. Archive and restore are operations staff perform on <em>other people's</em> listings,
 * which means resolving across owners first and authorizing afterwards. Keeping that inverted rule
 * next to the owner-scoped ones is how a reviewer misreads one for the other.
 *
 * <p>The split is drawn one method short: {@code ListingService.updateAsModerator} is cross-owner
 * too, resolves unscoped, and authorizes by role — the same inverted rule this class was extracted
 * to isolate. It belongs here (and this class then wants to be called {@code
 * ListingModerationService}); left where it is only because moving it is a rename across the
 * controller and the frontend's foundation guard, which is not this change. See {@code
 * tasks/todo.md}.
 *
 * <p>It also changes for its own reasons: takedown reasons, retention, and whatever a restored
 * listing must re-earn are moderation and policy concerns, not editing concerns.
 */
@Service
public class ListingArchiveService {

    private final PropertyRepository properties;
    private final ListingDuplicateProbe duplicates;

    public ListingArchiveService(PropertyRepository properties, ListingDuplicateProbe duplicates) {
        this.properties = properties;
        this.duplicates = duplicates;
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
     *
     * <p>Re-probed on the way back, because archiving hides a listing from the probe as well as from
     * search: {@code findDuplicateCandidates} filters {@code archived = false}, so a collision that
     * appeared while this listing was down was never compared against it. Without this, archive and
     * restore is a way to walk a listing back into somebody else's doorway unflagged — and it is the
     * cheap version of the attack, because the owner does not have to change anything.
     */
    @Transactional
    public Property restore(AuthPrincipal principal, String idOrSlug) {
        Property p = resolvePermitted(principal, idOrSlug);
        p.restore();
        p.revertToPending();
        properties.flush();
        duplicates.flag(p);
        return p;
    }

    /**
     * Resolve any listing (across owners) and authorize the caller as owner or staff/admin, else
     * {@code 404}.
     *
     * <p>The order matters and is the reason this class exists: the lookup is deliberately
     * unscoped, so the authorization below is the only thing standing between a caller and any
     * listing on the platform. Nothing else in this package resolves that way.
     */
    private Property resolvePermitted(AuthPrincipal principal, String idOrSlug) {
        UUID id = Ids.parseUuid(idOrSlug).orElse(null);
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
}
