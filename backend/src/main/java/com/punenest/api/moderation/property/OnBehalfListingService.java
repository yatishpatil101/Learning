package com.punenest.api.moderation.property;

import com.punenest.api.catalog.listing.ListingService;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.audit.AuditService;
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
    private final UserRepository users;
    private final UserService userService;
    private final AuditService audit;

    public OnBehalfListingService(ListingService listings, UserRepository users,
            UserService userService, AuditService audit) {
        this.listings = listings;
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

        Property created = listings.create(owner.getId(), body.listing());

        audit.record(caller, "property.create_on_behalf", "property", created.getId().toString(),
                "ownerId", owner.getId().toString(),
                "ownerMobile", body.ownerMobile(),
                "ownerProvisioned", String.valueOf(provisioned));
        return created;
    }
}
