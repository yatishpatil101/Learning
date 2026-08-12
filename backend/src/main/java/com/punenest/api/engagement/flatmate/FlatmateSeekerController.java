package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Flatmate seeker posts and the host inbox (contract tag {@code Engagement}).
 *
 * <p>Three audiences on one route family: the feed is anonymous, posting is restricted to the two
 * consumer roles, and answering an ad is any authenticated account.
 *
 * <p>The role guard on create is not bureaucracy. A flatmate ad is written by the person who will
 * live there, which ops staff are not; and the same reasoning that put {@code x-roles: [buyer,
 * owner]} on the legacy {@code createShareFlatPost} applies unchanged to its replacement.
 */
@RestController
public class FlatmateSeekerController {

    private final FlatmateSeekerService service;

    public FlatmateSeekerController(FlatmateSeekerService service) {
        this.service = service;
    }

    /** {@code GET /flatmates/posts} (contract {@code listFlatmateSeekerPosts}) — public. */
    @GetMapping(Routes.Flatmates.POSTS)
    public PageResponse<FlatmateSeekerPostDto> feed(
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) String gender,
            @RequestParam(required = false) String flatPref,
            @RequestParam(required = false) String roomPref,
            @RequestParam(required = false) Long minBudget,
            @RequestParam(required = false) Long maxBudget,
            @PageableDefault(size = 20) Pageable pageable) {
        PostFacets facets = new PostFacets(
                locality, gender, flatPref, roomPref, minBudget, maxBudget);
        return PageResponse.of(service.feed(facets, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code POST /flatmates/posts} (contract {@code createFlatmateSeekerPost}). */
    @PostMapping(Routes.Flatmates.POSTS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateSeekerPostDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateSeekerPostCreateRequest body) {
        return service.create(principal, body);
    }

    /** {@code PATCH /flatmates/posts/{id}} (contract {@code updateFlatmateSeekerPost}). */
    @PatchMapping(Routes.Flatmates.POST_BY_ID)
    public FlatmateSeekerPostDto update(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateSeekerPostCreateRequest body) {
        return service.update(principal, id, body);
    }

    /** {@code DELETE /flatmates/posts/{id}} (contract {@code deleteFlatmateSeekerPost}) — 204. */
    @DeleteMapping(Routes.Flatmates.POST_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.delete(principal, id);
    }

    /**
     * {@code POST /flatmates/posts/{id}/interest} (contract {@code flatmatePostInterest}) — 201, no
     * body. The contract declares no response schema and is right not to: what the caller wants to
     * know is that it was sent, and echoing the message back would invite a client to render it as
     * though it were a thread.
     */
    @PostMapping(Routes.Flatmates.POST_INTEREST)
    @ResponseStatus(HttpStatus.CREATED)
    public void interest(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) InterestRequest body) {
        service.express(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    /**
     * {@code GET /flatmates/posts/{id}/interests} (contract {@code listFlatmatePostInterests}) —
     * paged, poster-scoped (D70).
     *
     * <p>The author of one ad reading the replies to that ad. Sits next to the write on the same
     * path family but is a different audience entirely, and the id in the path grants nothing: the
     * service re-establishes ownership before a single row is read, because the rows carry a
     * stranger's name and phone number.
     *
     * <p>Paged and {@link Pageables#unsorted} on the same terms as the inbox — the poster writes
     * none of these rows, so the list grows with how many people answered, and the order is fixed
     * server-side rather than taken from a client {@code ?sort=}.
     */
    @GetMapping(Routes.Flatmates.POST_INTERESTS)
    public PageResponse<FlatmateRequestDto> interests(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.interests(principal, id, Pageables.unsorted(pageable)), dto -> dto);
    }

    /**
     * {@code GET /me/flatmate-requests} (contract {@code listMyFlatmateRequests}) — paged (D77).
     *
     * <p>Was a bare array. The host writes none of these rows, so the list grows with how many
     * people answered the ad — the inbound-demand shape api-standards.md §5.1 says must be paged.
     * An unspecified page returns the newest twenty, which is what every existing caller was
     * already reading off the front of the old array.
     *
     * <p>No {@code sort} parameter: the order is fixed server-side (newest first), so
     * {@link Pageables#unsorted} drops any client {@code ?sort=} rather than letting an unmapped
     * property reach the query and come back as a 500.
     */
    @GetMapping(Routes.Flatmates.MY_REQUESTS)
    public PageResponse<FlatmateRequestDto> inbox(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.inbox(principal, status, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** {@code PATCH /me/flatmate-requests/{id}} (contract {@code decideFlatmateRequest}). */
    @PatchMapping(Routes.Flatmates.MY_REQUEST_BY_ID)
    public FlatmateRequestDto decide(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision());
    }

    /** Contract schema {@code FlatmateInterestCreate}. Both fields are optional. */
    public record InterestRequest(String share, @Size(max = 4000) String message) {
    }

    /** The contract's inline decision body: {@code accepted} or {@code declined}. */
    public record DecisionRequest(@NotBlank String decision) {
    }
}
