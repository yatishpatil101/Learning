package com.draazy.api.engagement.flatmate;

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

/**
 * {@code /me/flatmate-saves} — the caller's flatmate shortlist.
 *
 * <p>No {@code @PreAuthorize}: none of these operations carries {@code x-roles} in the contract, and
 * caller-scoping is the guard — every query is keyed on the principal's own id.
 *
 * <p>The list is heterogeneous, like {@code GET /flatmates/feed}: a save may be a room, a group or a
 * seeker post, and each answers with the card the feed would have rendered for it. Clients
 * discriminate by shape, which is the convention this domain already uses rather than a new one
 * introduced here.
 */
@RestController
public class FlatmateSaveController {

    private final FlatmateSaveService saveService;

    public FlatmateSaveController(FlatmateSaveService saveService) {
        this.saveService = saveService;
    }

    /**
     * {@code GET /me/flatmate-saves} (contract {@code listFlatmateSaves}) — full cards, paged.
     *
     * <p>Sort is fixed to saved-order (newest first) inside the query, so no client sort is accepted;
     * {@code Pageables.unsorted} strips one rather than letting it produce a second {@code order by}.
     */
    @GetMapping(Routes.Engagement.FLATMATE_SAVES)
    public PageResponse<Object> listSaves(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                saveService.listSaved(principal.userId(), Pageables.unsorted(pageable)), row -> row);
    }

    /** {@code GET /me/flatmate-saves/keys} (contract {@code listFlatmateSaveKeys}) — keys only. */
    @GetMapping(Routes.Engagement.FLATMATE_SAVE_KEYS)
    public List<FlatmateSaveKeyDto> listKeys(@CurrentUser AuthPrincipal principal) {
        return saveService.listKeys(principal.userId());
    }

    /** {@code PUT /me/flatmate-saves/{kind}/{id}} (contract {@code saveFlatmatePost}) — idempotent, 204. */
    @PutMapping(Routes.Engagement.FLATMATE_SAVE_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void save(@CurrentUser AuthPrincipal principal,
            @PathVariable String kind, @PathVariable UUID id) {
        saveService.save(principal.userId(), kind, id);
    }

    /** {@code DELETE /me/flatmate-saves/{kind}/{id}} (contract {@code unsaveFlatmatePost}) — idempotent, 204. */
    @DeleteMapping(Routes.Engagement.FLATMATE_SAVE_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsave(@CurrentUser AuthPrincipal principal,
            @PathVariable String kind, @PathVariable UUID id) {
        saveService.unsave(principal.userId(), kind, id);
    }
}
