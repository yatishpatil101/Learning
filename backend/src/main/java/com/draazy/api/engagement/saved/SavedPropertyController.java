package com.draazy.api.engagement.saved;

import com.draazy.api.catalog.property.SavedCard;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.List;
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

/** No {@code x-roles} in the contract: caller-scoping (the principal's own rows) is the guard. */
@RestController
public class SavedPropertyController {

    private final SavedPropertyService savedPropertyService;

    public SavedPropertyController(SavedPropertyService savedPropertyService) {
        this.savedPropertyService = savedPropertyService;
    }

    /** Sort is fixed to saved-order; {@code Pageables.unsorted} strips a client sort that would add a second
     * {@code order by}. */
    @GetMapping(Routes.Engagement.SAVED)
    public PageResponse<SavedCard> listSaved(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                savedPropertyService.listSaved(principal.userId(), Pageables.unsorted(pageable)),
                s -> s);
    }

    /** {@code GET /me/saved/keys} — the shortlist as keys, unpaged; the app shell's hearts and count. */
    @GetMapping(Routes.Engagement.SAVED_KEYS)
    public List<SavedKey> listKeys(@CurrentUser AuthPrincipal principal) {
        return savedPropertyService.listKeys(principal.userId());
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
