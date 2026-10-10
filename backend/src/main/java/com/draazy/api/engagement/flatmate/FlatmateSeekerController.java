package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
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

/** Only buyers/owners create seeker ads because the writer is the person who will live there. */
@RestController
public class FlatmateSeekerController {

    private final FlatmateSeekerService service;

    public FlatmateSeekerController(FlatmateSeekerService service) {
        this.service = service;
    }

    @PostMapping(Routes.Flatmates.POSTS)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('" + Roles.BUYER + "', '" + Roles.OWNER + "')")
    public FlatmateSeekerPostDto create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody FlatmateSeekerPostCreateRequest body) {
        return service.create(principal, body);
    }

    @PatchMapping(Routes.Flatmates.POST_BY_ID)
    public FlatmateSeekerPostDto update(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody FlatmateSeekerPostCreateRequest body) {
        return service.update(principal, id, body);
    }

    @DeleteMapping(Routes.Flatmates.POST_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.delete(principal, id);
    }

    /** No response body; echoing the message would invite clients to render a thread. */
    @PostMapping(Routes.Flatmates.POST_INTEREST)
    @ResponseStatus(HttpStatus.CREATED)
    public void interest(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody(required = false) InterestRequest body) {
        service.express(principal, id,
                body == null ? null : body.share(),
                body == null ? null : body.message());
    }

    /** No role guard: this is scoped to the caller's own seeker post. */
    @GetMapping(Routes.Flatmates.MY_POSTS)
    public PageResponse<FlatmateSeekerPostDto> myPosts(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.myPosts(principal, Pageables.unsorted(pageable)), dto -> dto);
    }

    /** The edit form's single read. 404 for another author's post, so an id leaks nothing about who owns it. */
    @GetMapping(Routes.Flatmates.MY_POST_BY_ID)
    public FlatmateSeekerPostDto myPost(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return service.myPost(principal, id);
    }

    /** Inbox is paged because rows are created by strangers answering the ad. */
    @GetMapping(Routes.Flatmates.MY_REQUESTS)
    public PageResponse<FlatmateRequestDto> inbox(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.inbox(principal, status, Pageables.unsorted(pageable)), dto -> dto);
    }

    @PatchMapping(Routes.Flatmates.MY_REQUEST_BY_ID)
    public FlatmateRequestDto decide(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID id, @Valid @RequestBody DecisionRequest body) {
        return service.decide(principal, id, body.decision());
    }

    /** No role guard; scope is the caller's own rows and order is fixed server-side. */
    @GetMapping(Routes.Flatmates.MY_INTERESTS)
    public PageResponse<FlatmateRequestDto> outbox(@CurrentUser AuthPrincipal principal,
            @RequestParam(required = false) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                service.outbox(principal, status, Pageables.unsorted(pageable)), dto -> dto);
    }

    @GetMapping(Routes.Flatmates.MY_INTEREST_KEYS)
    public List<FlatmateInterestKeyDto> outboxKeys(@CurrentUser AuthPrincipal principal) {
        return service.outboxKeys(principal);
    }

    /** 204 with no body because withdrawal is a command, not a deleted-row read. */
    @DeleteMapping(Routes.Flatmates.INTEREST_BY_TARGET)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(@CurrentUser AuthPrincipal principal,
            @PathVariable String kind, @PathVariable UUID id) {
        service.withdraw(principal, kind, id);
    }

    public record InterestRequest(String share, @Size(max = 4000) String message) {
    }

    public record DecisionRequest(@NotBlank String decision) {
    }
}
