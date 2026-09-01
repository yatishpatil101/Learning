package com.punenest.api.identity.user;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The authenticated user's own profile (contract operations {@code getMe} / {@code updateMe} at
 * {@code /auth/me}). Lives in the {@code user} feature package even though the path sits under
 * {@code /auth}, because it is about the {@link User} resource. It maps the entity to the contract
 * {@link UserResponse} at the edge so the persistence entity never crosses the wire.
 *
 * <p>Both routes project through {@link SelfProfile} rather than {@code UserMapper} directly,
 * because a caller reading themselves also gets their resolved back-office permission atoms — the
 * list the admin console draws its navigation from. {@code PATCH} matters as much as {@code GET}
 * here: the client writes whatever the patch returned over its cached user, so a PATCH that dropped
 * the atoms would blank the sidebar the moment somebody edited their own name.
 */
@RestController
public class MeController {

    private final UserService userService;
    private final SelfProfile selfProfile;

    public MeController(UserService userService, SelfProfile selfProfile) {
        this.userService = userService;
        this.selfProfile = selfProfile;
    }

    /** {@code GET /auth/me} — the caller's own profile, and the atoms it resolves to. */
    @GetMapping(Routes.Auth.ME)
    public UserResponse getMe(@CurrentUser AuthPrincipal principal) {
        return selfProfile.of(userService.getMe(principal.userId()));
    }

    /** {@code PATCH /auth/me} — update own name/email/avatar. */
    @PatchMapping(Routes.Auth.ME)
    public UserResponse updateMe(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody UserUpdate patch) {
        return selfProfile.of(userService.updateMe(principal.userId(), patch));
    }
}
