package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Letting a flat room by room (contract tag {@code Listings}).
 *
 * <p>Its own controller because the resource is a <em>listing</em>, not a flatmate post — the owner
 * is changing how their flat is offered, and the rooms are a consequence. Neither route carries
 * {@code @PreAuthorize}: ownership is the authorisation here, and "owns this listing" is not
 * something a role expression can say. {@link FlatSplitService} checks it.
 */
@RestController
public class FlatSplitController {

    private final FlatSplitService service;
    private final FlatmateSupplyService supply;

    public FlatSplitController(FlatSplitService service, FlatmateSupplyService supply) {
        this.service = service;
        this.supply = supply;
    }

    /**
     * {@code GET /properties/{id}/rooms} (contract {@code listPropertyRooms}) — public.
     *
     * <p>Reads the rooms produced by {@link #split}, which is why it lives here rather than on the
     * flatmates feed: same resource, opposite direction. Anonymous view — no host number — like
     * every other unauthenticated room read, so it returns the card projection
     * ({@link FlatmateRoomFeedDto}, D80) rather than the full room.
     */
    @GetMapping(Routes.Properties.ROOMS)
    public List<FlatmateRoomFeedDto> rooms(@PathVariable UUID id) {
        return supply.roomsInFlat(id);
    }

    /** {@code POST /properties/{id}/split} (contract {@code splitFlat}) — 201. */
    @PostMapping(Routes.Properties.SPLIT)
    @ResponseStatus(HttpStatus.CREATED)
    public FlatSplitResult split(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @Valid @RequestBody FlatSplitRequest body) {
        return service.split(principal, id, body);
    }

    /** {@code DELETE /properties/{id}/split} (contract {@code unsplitFlat}) — 204. */
    @DeleteMapping(Routes.Properties.SPLIT)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsplit(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.unsplit(principal, id);
    }
}
