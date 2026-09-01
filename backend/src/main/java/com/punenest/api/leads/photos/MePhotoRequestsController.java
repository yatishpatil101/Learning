package com.punenest.api.leads.photos;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The listing owner's side of the photo-request signal at {@code /me/photo-requests}: who asked, how
 * many are outstanding, and recording the owner's answer.
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
     * Record the owner's answer to one request.
     *
     * <p><strong>V117 shipped this bodyless</strong>, and the docblock said why: "there is exactly
     * one transition an owner can make and no argument to it. A body carrying
     * {@code {"status":"resolved"}} would be a field with one legal value, which is a validation
     * rule pretending to be data." That was correct while {@code resolved} was the only exit. V118
     * adds {@code declined}, so the field now has two legal values and carries a decision the server
     * cannot infer — it is data.
     *
     * <p>Deliberately <strong>not</strong> two verbs ({@code POST .../resolve},
     * {@code POST .../decline}). One endpoint keeps the "already answered" rule in one place, and
     * matches {@code MeContactRequestsController#respondContactRequest}, which took the same shape
     * for the same reason.
     */
    @PatchMapping(Routes.MePhotoRequests.BY_ID)
    public PhotoRequestResponse decide(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID reqId, @Valid @RequestBody DecisionRequest body) {
        return photoRequests.decide(principal.userId(), reqId, body.decision());
    }

    /** The badge, as an object rather than a bare integer so it can gain siblings without a break. */
    public record PendingCountResponse(long pending) {
    }

    /**
     * The owner's answer.
     *
     * <p>{@code @NotBlank} only — the set of legal words is checked in
     * {@link PhotoRequestService#decide}, next to the entity rule it protects, rather than duplicated
     * here as a regex that would have to be kept in step with
     * {@link PhotoRequestStatuses}.
     *
     * @param decision {@code resolved} or {@code declined}
     */
    public record DecisionRequest(@NotBlank String decision) {
    }
}
