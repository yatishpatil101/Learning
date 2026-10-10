package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Authenticated but not role-gated: scope is the caller's own rows, enforced against the row itself. Falling
 * through to {@code anyRequest().authenticated()} in {@code SecurityConfig} is intentional. */
@RestController
public class FlatmateHostRoomController {

    private final FlatmateHostRoomService service;

    public FlatmateHostRoomController(FlatmateHostRoomService service) {
        this.service = service;
    }

    /** {@code GET /me/flatmate-rooms} — the caller's own rooms, moderation state included. */
    @GetMapping(Routes.Flatmates.MY_ROOMS)
    public PageResponse<FlatmateRoomCard> myRooms(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.myRooms(principal, pageable), dto -> dto);
    }

    /** {@code DELETE /flatmates/rooms/{id}} — the host withdraws a room they posted. 204. */
    @DeleteMapping(Routes.Flatmates.ROOM_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdrawRoom(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.withdraw(principal, id);
    }
}
