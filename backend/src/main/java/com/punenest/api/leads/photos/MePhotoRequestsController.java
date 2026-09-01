package com.punenest.api.leads.photos;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * The listing owner's side of the photo-request signal at {@code /me/photo-requests}: who asked, how
 * many are outstanding, and marking one dealt with.
 *
 * <p><strong>Strictly owner-scoped.</strong> Every operation derives the owner from the JWT and
 * reaches rows only through listings that owner actually owns. A request against someone else's
 * listing is invisible on the read and a {@code 404} on the write — never a {@code 403}, which would
 * confirm that a foreign row exists.
 *
 * <p>No role guard, for the same reason as {@code MeContactRequestsController}: any signed-in user
 * becomes an owner the moment they post a listing. Authentication plus owner-scoping is the gate.
 */
@RestController
public class MePhotoRequestsController {

    private final PhotoRequestService photoRequests;

    public MePhotoRequestsController(PhotoRequestService photoRequests) {
        this.photoRequests = photoRequests;
    }

    /** Incoming photo requests for the caller's own listings, newest first, paged. */
    @GetMapping(Routes.MePhotoRequests.BASE)
    public PageResponse<PhotoRequestResponse> myPhotoRequests(
            @CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                photoRequests.myRequests(principal.userId(), Pageables.unsorted(pageable)), r -> r);
    }

    /**
     * The owner's "buyers want more photos" badge. Counted in the database — see
     * {@link PhotoRequestService#myPendingCount}.
     */
    @GetMapping(Routes.MePhotoRequests.PENDING_COUNT)
    public PendingCountResponse pendingCount(@CurrentUser AuthPrincipal principal) {
        return new PendingCountResponse(photoRequests.myPendingCount(principal.userId()));
    }

    /**
     * Mark one request satisfied.
     *
     * <p>{@code PATCH} with no body: there is exactly one transition an owner can make and no
     * argument to it. A body carrying {@code {"status":"resolved"}} would be a field with one legal
     * value, which is a validation rule pretending to be data.
     */
    @PatchMapping(Routes.MePhotoRequests.BY_ID)
    public PhotoRequestResponse resolve(
            @CurrentUser AuthPrincipal principal, @PathVariable UUID reqId) {
        return photoRequests.resolve(principal.userId(), reqId);
    }

    /** The badge, as an object rather than a bare integer so it can gain siblings without a break. */
    public record PendingCountResponse(long pending) {
    }
}
