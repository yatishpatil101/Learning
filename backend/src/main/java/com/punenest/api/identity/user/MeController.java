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
 */
@RestController
public class MeController {

    private final UserService userService;
    private final UserMapper userMapper;

    public MeController(UserService userService, UserMapper userMapper) {
        this.userService = userService;
        this.userMapper = userMapper;
    }

    /** {@code GET /auth/me} — the caller's own profile. */
    @GetMapping(Routes.Auth.ME)
    public UserResponse getMe(@CurrentUser AuthPrincipal principal) {
        return userMapper.toResponse(userService.getMe(principal.userId()));
    }

    /** {@code PATCH /auth/me} — update own name/email/avatar. */
    @PatchMapping(Routes.Auth.ME)
    public UserResponse updateMe(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody UserUpdate patch) {
        return userMapper.toResponse(userService.updateMe(principal.userId(), patch));
    }
}
