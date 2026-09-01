package com.punenest.api.moderation.property;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.Notifier;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Listing moderation: the state transitions a moderator can drive on somebody else's listing.
 *
 * <p>Every method here writes an audit row. That is the point of the slice, not decoration: these
 * are the operations where one user changes another user's property, so "who did this, when, and
 * why" is the only thing that makes the power accountable. {@code AuditService} existed since slice
 * 1 with <strong>zero callers</strong> — {@code GET /admin/audit-log} would have returned an empty
 * page forever. These are its first writes.
 */
@Service
public class PropertyModerationService {

    /** The statuses a moderator may set directly. */
    private static final Set<String> SETTABLE = Set.of(
            PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.REJECTED);

    private final PropertyRepository properties;
    private final AuditService audit;
    private final Notifier notifier;

    public PropertyModerationService(PropertyRepository properties, AuditService audit,
            Notifier notifier) {
        this.properties = properties;
        this.audit = audit;
        this.notifier = notifier;
    }

    /**
     * {@code PATCH /properties/{id}/status} — approve or reject.
     *
     * <p>{@code flagged} and {@code archived} are rejected here even though both are legal values of
     * {@code PropertyStatus}: each has its own endpoint that maintains state this one cannot
     * ({@code flag_reason}, the {@code archived} triplet). Allowing them through would let a
     * moderator set {@code status='archived'} while {@code archived=false}, leaving the row visible
     * on the public site while every admin screen showed it as deleted.
     *
     * <p><strong>Approval requires a locality (register item 24).</strong> See
     * {@link #denyApprovingUnfiled}.
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
        property.setStatus(status);
        if (PropertyStatus.APPROVED.equals(status)) {
            property.setFlagReason(null);
        }
        // A moderator has now looked at this listing, which is exactly what a pending stays-live
        // re-check was asking for (Q14). Clearing it here rather than behind its own endpoint is
        // deliberate: the re-check is a request for a decision, and this is where decisions are
        // made. Re-approving an already-approved listing is therefore the "checked it, all fine"
        // action, and needs no new route to express.
        property.clearRecheck();
        audit.record(actor, "property.status", "property", id, "from", from, "to", status,
                "reason", reason, "owner", String.valueOf(property.getOwner().getId()));

        // Tell the owner what the moderator decided about their listing (tech-debt D92). Only the
        // two terminal verdicts are announced: a bounce back to `pending` is an internal queue
        // move, not an outcome the owner acted to reach. A rejected listing is not publicly
        // viewable, so its link points at the dashboard rather than the dead /property page.
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
     * {@code POST /properties/{id}/flag} — raise a moderation flag.
     *
     * <p>Flagging sets <em>both</em> {@code status='flagged'} and {@code flag_reason}, matching
     * {@code lib/data/properties-admin.js#flagListing}. They are not redundant: the status takes the
     * listing off the public site (it is no longer {@code approved}) while the reason is what the
     * owner and the next moderator actually read. Neither alone does the job.
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
     * {@code DELETE /properties/{id}/flag} — clear it.
     *
     * <p>Clearing returns the listing to {@code approved}, per the mock. That looks like a
     * moderation bypass — a never-reviewed listing reaching {@code approved} without passing the
     * queue — but it is not: only staff/admin can reach this endpoint, so clearing a flag <em>is</em>
     * a human review, and the reviewer has just said the listing is fine. Sending it to
     * {@code pending} instead would punish an owner for someone else's bad report by taking their
     * live listing off the site.
     */
    @Transactional
    public void clearFlag(AuthPrincipal actor, String id) {
        Property property = load(id);
        denySelfDealing(actor, property);

        String from = property.getStatus();
        property.setStatus(PropertyStatus.APPROVED);
        property.setFlagReason(null);
        property.clearRecheck();
        audit.record(actor, "property.flag.clear", "property", id, "from", from,
                "owner", String.valueOf(property.getOwner().getId()));
    }

    /**
     * A moderator may not moderate their own listing.
     *
     * <p>Staff are owners too — the role is additive, not exclusive — so without this a staff member
     * could approve, feature and un-flag their own listing, which is the cheapest possible abuse of
     * the role and leaves an audit trail that looks entirely normal.
     */
    private static void denySelfDealing(AuthPrincipal actor, Property property) {
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException("You cannot moderate your own listing");
        }
    }

    /**
     * Refuse to publish a listing the catalogue cannot file (register item 24).
     *
     * <p>{@code locality_slug} is null when {@code LocalityResolver} could not confidently match the
     * free text the owner typed, and every locality-keyed read on the platform skips a null slug:
     * the search facet, {@code /locality/{slug}}, the saved-search alert and the society join. So
     * approving one produces a listing that is live by every measure the console shows and reachable
     * by almost none a buyer uses — while its owner is sent "It is now live and visible to buyers",
     * which is the part that makes this worth a 409 rather than a warning. The listing is not
     * broken; the <em>ordering</em> is, and only a refusal fixes an ordering.
     *
     * <p>Only approval is blocked. Rejecting an unfiled listing is exactly right — it never needed
     * a locality — and bouncing one back to {@code pending} is a queue move. There is no override:
     * the remedy is {@code PATCH /admin/locality-queue/{propertyId}}, which the same
     * {@code properties:write} permission grants, so this can never deadlock the moderator it
     * stops. Curating first and approving second is the whole of the fix.
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
     * Resolve the path token to a listing, accepting a <strong>slug or a UUID</strong>.
     *
     * <p>It was UUID-only, which made these five routes the odd ones out on {@code /properties/{id}}:
     * the public read ({@code PropertyService.resolve}) and archive/restore
     * ({@code ListingService.resolvePermitted}) both accept either. That inconsistency is invisible
     * until something takes an id from one route and uses it on another — which is precisely what
     * the admin UI does, because a listing's public URL key is its slug. Approve worked from a hand-
     * typed UUID and 404'd from the screen, for a listing the moderator was looking at.
     *
     * <p>No visibility filter here, deliberately: unlike the public read this must resolve pending,
     * rejected, flagged and archived rows — they are the ones being moderated.
     */
    private Property load(String idOrSlug) {
        return Ids.parseUuid(idOrSlug)
                .flatMap(properties::findById)
                .or(() -> properties.findBySlug(idOrSlug))
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
