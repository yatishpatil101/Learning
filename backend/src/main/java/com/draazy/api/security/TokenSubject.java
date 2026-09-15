package com.draazy.api.security;

import java.util.UUID;

/**
 * What {@link JwtService} needs to know about whoever it is minting a token for — and nothing else,
 * so the shared kernel never depends on a feature context. Satisfied by {@code identity.user.User}.
 */
public interface TokenSubject {

    /** Becomes the token's {@code sub} claim. */
    UUID getId();

    /** Becomes the {@code role} claim; drives the role guards in {@code SecurityConfig}. */
    String getRole();

    /** Becomes the {@code mobileVerified} claim. */
    boolean isMobileVerified();

    /** Becomes the {@code verified} claim — the staff-reviewed identity badge. */
    boolean isVerified();

    /** Becomes the {@code team} claim for staff; {@code null} for consumers, and then omitted. */
    String getTeam();
}
