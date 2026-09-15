package com.draazy.api.security;

import java.util.UUID;

/**
 * The authenticated caller, resolved server-side from a signature-verified JWT. Controllers read
 * identity, role and trust level from here — never from client-supplied fields.
 */
public record AuthPrincipal(
        UUID userId,
        String role,
        String team,
        boolean mobileVerified,
        boolean verified) {
}
