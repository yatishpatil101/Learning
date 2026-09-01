package com.punenest.api.moderation.property;

import com.punenest.api.catalog.listing.ListingService;
import com.punenest.api.catalog.property.PipelineStage;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.user.UserService;
import com.punenest.api.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Posting a listing on an owner's behalf — the server behind the back-office "Post on Behalf" desk.
 *
 * <p><strong>The bug this exists to close.</strong> The console's wizard called the ordinary
 * {@code POST /me/listings}, which attributes the listing to the authenticated caller. Against the
 * mock that was invisible, because the mock had no notion of who owned what. Against a real server
 * it would have created every phoned-in listing owned by the <em>operator</em>: the owner would
 * never see it under {@code /me/listings}, could not edit or archive it, and the contact number
 * buyers were gated onto would have been the office's. Attribution is the entire feature, so it is
 * a separate route rather than a flag on the existing one.
 *
 * <p><strong>Why this is its own permission module.</strong> {@code postOnBehalf:write} rather than
 * {@code properties:write}, because naming another user as the owner of something you create is a
 * different power from editing supply that already exists. An operator with this atom can
 * manufacture a listing under any number they choose; an administrator should be able to grant the
 * supply console without granting that.
 *
 * <p>The listing is born {@code pending} exactly like any other — {@code ListingService.create}
 * sets the status, and this class deliberately does not reach past it. A desk that could post
 * pre-approved would be a desk that could put unmoderated supply live by typing it in the right
 * window.
 */
@Service
public class OnBehalfListingService {

    private final ListingService listings;
    private final PropertyRepository properties;
    private final UserRepository users;
    private final UserService userService;
    private final AuditService audit;

    public OnBehalfListingService(ListingService listings, PropertyRepository properties,
            UserRepository users, UserService userService, AuditService audit) {
        this.listings = listings;
        this.properties = properties;
        this.users = users;
        this.userService = userService;
        this.audit = audit;
    }

    /**
     * Resolve or provision the owner, then create the listing under their name.
     *
     * <p>Two audit rows, not one: the listing creation is already recorded by whoever looks at
     * {@code properties.owner_id}, but "operator X created a listing owned by user Y" is a
     * statement neither the listing nor the user row makes on its own, and it is the one a later
     * dispute turns on. The provisioning, when it happens, is recorded separately because an
     * account that exists without its owner ever having signed in is itself a thing worth being
     * able to explain.
     *
     * <p>An archived owner is adopted rather than refused. Their account being archived is a
     * statement about their access, not about their property, and refusing here would leave the
     * operator with a phone call they cannot complete and no way to say why.
     */
    @Transactional
    public Property create(AuthPrincipal caller, OnBehalfListingRequest body) {
        User owner = users.findByMobile(body.ownerMobile()).orElse(null);
        boolean provisioned = owner == null;
        if (provisioned) {
            owner = userService.provisionForStaff(body.ownerMobile(), body.ownerName());
            audit.record(caller, "user.provision_on_behalf", "user", owner.getId().toString(),
                    "mobile", body.ownerMobile());
        }

        Property created = listings.createOnBehalf(owner.getId(), body.listing());
        // Open the hand-back funnel. This is the one creation path that produces a listing its owner
        // has never seen, so it is the only one that owes anybody a hand-over; a listing an owner
        // posted themselves has already arrived where this funnel is trying to get to.
        created.markPostedOnBehalf(caller.userId().toString());

        audit.record(caller, "property.create_on_behalf", "property", created.getId().toString(),
                "ownerId", owner.getId().toString(),
                "ownerMobile", body.ownerMobile(),
                "ownerProvisioned", String.valueOf(provisioned));
        return created;
    }

    /**
     * {@code GET /admin/properties/owner-standing} — how much of their listing ceiling this number
     * is using, before the operator adds another.
     *
     * <p>The desk is exempt from the ceiling ({@link ListingService#createOnBehalf}), which is what
     * lets an operator record everything a caller with three flats is telling them. Exempt is not
     * the same as blind: an owner about to go two listings past a one-listing plan is an upgrade
     * conversation, and the operator is the only person on the call able to have it. So the numbers
     * are published and the judgement is left with the human — refusing was precisely what did not
     * work here.
     *
     * <p>Keyed on mobile because that is the only handle the desk has. The operator is on the phone
     * with somebody who may never have signed in, which is the same reason {@code POST
     * /admin/properties} takes a mobile rather than a user id.
     *
     * <p>An unknown number is not an error. "This person has no account yet" is a real and common
     * answer at this desk — it is what happens on most first calls — and a 404 would make the
     * console treat the ordinary case as a failure. {@code known = false} says it plainly, and the
     * two counts are left at the free tier's shape because that is what provisioning will give them
     * a moment later.
     */
    @Transactional(readOnly = true)
    public OwnerListingStanding standingFor(String mobile) {
        String digits = mobile == null ? "" : mobile.replaceAll("\\D", "");
        if (digits.length() != 10) {
            throw new BadRequestException("mobile must be a 10-digit number");
        }
        return users.findByMobile(digits)
                .map(owner -> {
                    ListingService.ListingStanding standing = listings.standingFor(owner.getId());
                    return new OwnerListingStanding(digits, true, standing.allowance(),
                            standing.held(), standing.overAllowance());
                })
                .orElseGet(() -> new OwnerListingStanding(digits, false, 0, 0, false));
    }

    /**
     * Body of {@code getOwnerListingStanding}.
     *
     * @param mobile         the number asked about, echoed so a console can match a late response to
     *                       the field it is now showing
     * @param known          whether an account exists for it at all
     * @param allowance      how many listings their plan and referrals permit
     * @param held           how many they currently hold ({@code pending} and {@code approved})
     * @param overAllowance  whether {@code held} is already past {@code allowance}
     */
    public record OwnerListingStanding(String mobile, boolean known, int allowance, long held,
            boolean overAllowance) {
    }

    /**
     * {@code POST /properties/{id}/pipeline} — move a staff-created listing along, on whichever of
     * the two funnels the value names.
     *
     * <p>Lives here rather than with the moderation verbs because it is the same job as
     * {@link #create}: this module owns listings the platform posted on somebody else's behalf, from
     * the phone call that starts them to the moment the owner takes them over. It carries the same
     * {@code postOnBehalf:write} atom for the same reason — the desk that may create a listing in a
     * stranger's name is the desk that must report on handing it back, and splitting the two across
     * permissions would let somebody open that liability without being accountable for closing it.
     *
     * <p>Since D27 a listing sits on two axes — the acquisition funnel and the hand-back — and this
     * route accepts a point on either. One route rather than two because the desk experiences it as
     * one act, and the vocabularies are disjoint so the value alone says which column is meant; the
     * response carries both fields back so the caller can see what moved. {@code under_review} and
     * {@code live} are rejected here: they are {@code status}, and the moderation verbs own it.
     *
     * <p>Refuses a listing the platform did not post. An owner's own listing has already arrived
     * where the funnel is trying to get to, so a stage on it would be an item on a board that can
     * never be cleared. Refusing is also what keeps the board's total honest.
     */
    @Transactional
    public Property advance(AuthPrincipal caller, String propertyId, String stage) {
        if (!PipelineStage.isKnown(stage)) {
            throw new BadRequestException("stage must be one of "
                    + String.join(", ", PipelineStage.ORDER) + " (acquisition) or "
                    + String.join(", ", PipelineStage.HANDBACK_ORDER) + " (hand-back)");
        }
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (!property.isPostedByAdmin()) {
            throw new ConflictException(
                    "This listing was posted by its owner, so it has no hand-back to track");
        }

        String from = PipelineStage.isHandback(stage)
                ? property.getHandbackMilestone()
                : property.getPipelineStage();
        property.moveToStage(stage);
        audit.record(caller, "property.pipeline", "property", propertyId,
                "from", String.valueOf(from), "to", stage,
                "owner", String.valueOf(property.getOwner().getId()));
        return property;
    }
}
