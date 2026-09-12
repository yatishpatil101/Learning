package com.draazy.api.security;

import java.util.UUID;

/**
 * The authenticated caller, resolved server-side from the JWT and set as the Spring Security
 * principal. Everything here is trusted (it came from a signature-verified token), so controllers
 * read identity/role/trust-level from this — never from client-supplied fields.
 *
 * @param userId          the {@code sub} claim (the users.id)
 * @param team            staff ops team, else {@code null}
 * @param mobileVerified  L1 trust floor — the participation gate
 * @param aadhaarVerified L2 opt-in badge — a trust signal, never a hard gate (ADR-019)
 */
public record AuthPrincipal(
        UUID userId,
        String role,
        String team,
        boolean mobileVerified,
        boolean aadhaarVerified) {
}
