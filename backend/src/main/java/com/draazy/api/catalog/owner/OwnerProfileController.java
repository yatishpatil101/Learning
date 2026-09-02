package com.draazy.api.catalog.owner;

import com.draazy.api.common.web.Routes;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/** Public owner profile card. */
@RestController
public class OwnerProfileController {

    private final OwnerProfileService owners;

    public OwnerProfileController(OwnerProfileService owners) {
        this.owners = owners;
    }

    /**
     * {@code GET /owners/{id}} — the seller card behind a listing. {@code 404} when the id is
     * unknown, malformed, or belongs to an archived account.
     *
     * <p>Public, and takes no principal at all. The page it serves shows the same thing to everyone:
     * the mobile is masked unconditionally, because the profile has no listing in context and so no
     * contact gate to consult. The old page revealed the number to anyone holding an approved
     * request against <em>any</em> of this owner's listings, which quietly turned a per-listing grant
     * into a per-person one — approval on a Baner 2BHK saying nothing about the same owner's Kothrud
     * shop. Not offering the reveal here is the fix, not a limitation.
     *
     * <p>The owner's listings are deliberately not embedded. They are
     * {@code GET /properties?owner={id}}, which is the same paged, approved-and-unarchived read as
     * every other catalogue surface — one hard floor, one card shape, one place to get it wrong.
     */
    @GetMapping(Routes.Owners.BY_ID)
    public OwnerProfileResponse byId(@PathVariable String id) {
        return owners.byId(id);
    }
}
