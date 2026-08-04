package com.punenest.api.engagement.saved;

import com.punenest.api.catalog.property.PropertySummary;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/saved} — the caller's property shortlist.
 *
 * <p>No {@code @PreAuthorize}: none of these operations carries {@code x-roles} in the contract.
 * Caller-scoping (the principal's own rows only) is the guard.
 */
@RestController
public class SavedPropertyController {

    private final SavedPropertyService savedPropertyService;

    public SavedPropertyController(SavedPropertyService savedPropertyService) {
        this.savedPropertyService = savedPropertyService;
    }

    /**
     * {@code GET /me/saved} (contract {@code listSaved}) — full property summaries, paged.
     *
     * <p>Sort is fixed to saved-order (newest first) inside the query, so no client sort is
     * accepted; {@code Pageables.unsorted} strips one rather than letting it produce a second
     * {@code order by}.
     */
    @GetMapping(Routes.Engagement.SAVED)
    public PageResponse<PropertySummary> listSaved(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                savedPropertyService.listSaved(principal.userId(), Pageables.unsorted(pageable)),
                s -> s);
    }

    /** {@code PUT /me/saved/{propId}} (contract {@code savePropertyItem}) — idempotent, 204. */
    @PutMapping(Routes.Engagement.SAVED_BY_PROPERTY)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void saveProperty(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID propId) {
        savedPropertyService.save(principal.userId(), propId);
    }

    /** {@code DELETE /me/saved/{propId}} (contract {@code unsaveProperty}) — idempotent, 204. */
    @DeleteMapping(Routes.Engagement.SAVED_BY_PROPERTY)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsaveProperty(@CurrentUser AuthPrincipal principal,
            @PathVariable UUID propId) {
        savedPropertyService.unsave(principal.userId(), propId);
    }
}
