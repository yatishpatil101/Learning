package com.punenest.api.leads.photos;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The buyer's side of the photo-request signal: {@code POST /properties/{id}/photo-requests}.
 *
 * <p>No role guard and no badge check — sign-in is the entire gate, because nothing is revealed in
 * either direction. See {@link PhotoRequestService} for why a quota would be actively harmful here.
 *
 * <p>No request body. Everything the row needs is either in the path (which listing) or in the JWT
 * (who is asking); a body would only give a caller somewhere to put a {@code requesterId} the server
 * must then ignore.
 */
@RestController
public class PhotoRequestController {

    private final PhotoRequestService photoRequests;

    public PhotoRequestController(PhotoRequestService photoRequests) {
        this.photoRequests = photoRequests;
    }

    /**
     * Ask for more photos of a listing.
     *
     * <p>Always {@code 200}, never {@code 201}/{@code 409} — a repeat tap is a no-op rather than an
     * error, and the client tells the two apart from
     * {@link PhotoRequestCreateResponse#created()}. The reasoning is on that type.
     *
     * @param id a listing slug or UUID
     */
    @PostMapping(Routes.PropertyPhotoRequests.BASE)
    public PhotoRequestCreateResponse request(
            @CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return photoRequests.request(principal.userId(), id);
    }
}
