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
import java.util.List;
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
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.feed(locality, Pageables.unsorted(pageable)), dto -> dto);
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

    /** {@code GET /me/flatmate-requests} (contract {@code listMyFlatmateRequests}) — bare array. */
    @GetMapping(Routes.Flatmates.MY_REQUESTS)
    public List<FlatmateRequestDto> inbox(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String status) {
        return service.inbox(principal, status);
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
