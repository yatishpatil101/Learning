package com.draazy.api.moderation.property;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.property.PropertyLifecycle;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Ids;
import com.draazy.api.security.AuthPrincipal;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Listing moderation: the state transitions a moderator can drive on somebody else's listing.
 * Every method writes an audit row — these are the operations where one user changes another's.
 */
@Service
public class PropertyModerationService {

    /** The statuses a moderator may set directly. */
    private static final Set<String> SETTABLE = Set.of(
            PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.REJECTED);

    private final PropertyRepository properties;
    private final AuditService audit;
    private final Notifier notifier;
    private final PropertyLifecycle lifecycle;

    public PropertyModerationService(PropertyRepository properties, AuditService audit,
            Notifier notifier, PropertyLifecycle lifecycle) {
        this.properties = properties;
        this.audit = audit;
        this.notifier = notifier;
        this.lifecycle = lifecycle;
    }

    /**
     * {@code PATCH /properties/{id}/status} — approve or reject. {@code flagged}/{@code archived}
     * are refused here: each owns state this route cannot maintain, so the row would go incoherent.
     */
    @Transactional
    public Property setStatus(AuthPrincipal actor, String id, String status, String reason) {
        if (!SETTABLE.contains(status)) {
            throw new BadRequestException("status must be one of " + SETTABLE
                    + "; use /flag or /archive for the others");
        }
        Property property = load(id);
        denySelfDealing(actor, property);
        denyApprovingUnfiled(property, status);

        String from = property.getStatus();
        if (PropertyStatus.APPROVED.equals(status)) {
            lifecycle.publish(actor, property, false);
        } else {
            lifecycle.requireChecker(actor, property);
            if (property.isArchived() || PropertyStatus.SOLD.equals(property.getStatus())
                    || PropertyStatus.RENTED.equals(property.getStatus())) {
                throw new ConflictException("Restore or reopen this listing first");
            }
            property.setStatus(status);
        }
        // A moderator has now looked at this listing, which is what a pending stays-live re-check
        // was asking for; the re-check is a request for a decision, and this is where they are made.
        property.clearRecheck();
        audit.record(actor, "property.status", "property", id, "from", from, "to", status,
                "reason", reason, "owner", String.valueOf(property.getOwner().getId()));

        // Only the two terminal verdicts are announced; a bounce back to `pending` is a queue move.
        // A rejected listing is not publicly viewable, so its link points at the dashboard.
        UUID ownerId = property.getOwner().getId();
        if (PropertyStatus.APPROVED.equals(status)) {
            notifier.notify(ownerId, "listing.approved",
                    "Your listing is approved",
                    "It is now live and visible to buyers.",
                    "/property/" + property.getId());
        } else if (PropertyStatus.REJECTED.equals(status)) {
            notifier.notify(ownerId, "listing.rejected",
                    "Your listing needs changes",
                    reason == null || reason.isBlank()
                            ? "A moderator could not approve it. Please review and resubmit."
                            : "A moderator could not approve it: " + reason,
                    "/dashboard");
        }
        return property;
    }

    /** {@code POST /properties/{id}/toggle-featured} — homepage merchandising. */
    @Transactional
    public Property toggleFeatured(AuthPrincipal actor, String id) {
        Property property = load(id);
        denySelfDealing(actor, property);

        property.setFeatured(!property.isFeatured());
        audit.record(actor, "property.featured", "property", id, "featured", property.isFeatured(),
                "owner", String.valueOf(property.getOwner().getId()));
        return property;
    }

    /**
     * {@code POST /properties/{id}/flag} — raise a moderation flag. Sets both {@code status} and
     * {@code flag_reason}: the status delists, the reason is what a human reads. Neither alone works.
     */
    @Transactional
    public Property flag(AuthPrincipal actor, String id, String reason) {
        Property property = load(id);
        denySelfDealing(actor, property);

        String from = property.getStatus();
        property.setStatus(PropertyStatus.FLAGGED);
        property.setFlagReason(reason == null || reason.isBlank() ? "Flagged" : reason);
        audit.record(actor, "property.flag", "property", id, "from", from, "reason", reason,
                "owner", String.valueOf(property.getOwner().getId()));
        return property;
    }

    /**
     * {@code DELETE /properties/{id}/flag} — clear it, returning the listing to {@code approved}.
     * Only staff reach this, so clearing a flag <em>is</em> the human review.
     */
    @Transactional
    public void clearFlag(AuthPrincipal actor, String id) {
        Property property = load(id);
        denySelfDealing(actor, property);

        String from = property.getStatus();
        lifecycle.publish(actor, property, false);
        audit.record(actor, "property.flag.clear", "property", id, "from", from,
                "owner", String.valueOf(property.getOwner().getId()));
    }

    /**
     * A moderator may not moderate their own listing. Staff are owners too — the role is additive —
     * and self-approval leaves an audit trail that looks entirely normal.
     */
    private static void denySelfDealing(AuthPrincipal actor, Property property) {
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException("You cannot moderate your own listing");
        }
    }

    /**
     * Refuse to publish a listing the catalogue cannot file: every locality-keyed read skips a null
     * slug, so it would be live by the console's measure and unreachable by a buyer's. Curate first.
     */
    private static void denyApprovingUnfiled(Property property, String status) {
        if (PropertyStatus.APPROVED.equals(status) && property.getLocalitySlug() == null) {
            throw new ConflictException("This listing has no locality, so approving it would"
                    + " publish it out of locality search, its locality page, saved-search alerts"
                    + " and the society join. Assign one from the locality queue first"
                    + " (the owner typed '" + property.getLocality() + "').");
        }
    }

    /**
     * Resolve the path token to a listing, accepting a <strong>slug or a UUID</strong> as the public
     * read does. No visibility filter: pending, rejected, flagged and archived rows are the job.
     */
    private Property load(String idOrSlug) {
        UUID id = Ids.parseUuid(idOrSlug).orElseGet(() -> properties.findBySlug(idOrSlug)
            .map(Property::getId).orElseThrow(() -> NotFoundException.of("Property")));
        return properties.findForVerificationDecision(id)
            .orElseThrow(() -> NotFoundException.of("Property"));
    }

    @Transactional
    public Property publish(AuthPrincipal actor, String id) {
        Property property = load(id);
        lifecycle.publish(actor, property, true);
        audit.record(actor, "property.publish", "property", property.getId().toString());
        notifier.notify(property.getOwner().getId(), "listing.approved", "Your listing is live",
            "It is now visible to buyers.", "/property/" + property.getId());
        return property;
    }
}
