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

/**
 * A host's own rooms — the two routes where the caller is the supply rather than the audience.
 *
 * <p>The room counterparts of {@code myFlatmateGroups} on {@link FlatmateApplicationController} and
 * {@code deleteGroup} on {@link FlatmateSupplyController}, which is why they read like those two
 * and not like something new. They are together here, and away from their group twins, because
 * {@link FlatmateHostRoomService} is where the behaviour had to go — see that class for the
 * §4.1 reasoning.
 *
 * <p>Both are authenticated and neither is role-gated, matching the group pair exactly: the scope
 * is the caller's own rows, so being signed in is the whole permission, and the ownership rule is
 * enforced against the row rather than against a role somebody could hold for another reason.
 * Neither route appears in {@code SecurityConfig}'s {@code permitAll} block — {@code /me/**} has no
 * entry there at all, and the flatmates {@code permitAll} matchers are exact-path and
 * {@code GET}-only, so {@code DELETE /flatmates/rooms/&#123;id&#125;} falls through to
 * {@code anyRequest().authenticated()} the same way {@code DELETE /flatmates/groups/&#123;id&#125;}
 * does. That fall-through is the intended registration, not an omission.
 */
@RestController
public class FlatmateHostRoomController {

    private final FlatmateHostRoomService service;

    public FlatmateHostRoomController(FlatmateHostRoomService service) {
        this.service = service;
    }

    /** {@code GET /me/flatmate-rooms} — the caller's own rooms, moderation state included. */
    @GetMapping(Routes.Flatmates.MY_ROOMS)
    public PageResponse<FlatmateRoomDto> myRooms(@CurrentUser AuthPrincipal principal,
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
