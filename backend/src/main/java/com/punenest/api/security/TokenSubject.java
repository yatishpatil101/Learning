package com.punenest.api.security;

import java.util.UUID;

/**
 * What {@link JwtService} needs to know about whoever it is minting a token for — and nothing else.
 *
 * <p><strong>Why this exists.</strong> {@code issueAccessToken} previously took the
 * {@code identity.user.User} entity, which made the shared kernel depend on a feature context. That
 * is the one direction the dependency rule (see {@code docs/system/package-structure.md} §2) cannot
 * tolerate: {@code security} is imported by everything, so a reference from here to {@code identity}
 * routes a cycle through the kernel and welds the two together permanently.
 *
 * <p>The dependency was never real, only accidental — the issuer reads five scalars and has no
 * interest in the identity schema. Inverting it puts the abstraction in the kernel and lets the
 * feature satisfy it ({@code User implements TokenSubject}), so the arrow now points the legal way
 * and no caller changed.
 *
 * <p>This also restores the symmetry with {@link JwtService#parse}, which already returns a
 * security-owned {@link AuthPrincipal} rather than an entity: tokens are made of claims at both
 * ends.
 */
public interface TokenSubject {

    /** Becomes the token's {@code sub} claim. */
    UUID getId();

    /** Becomes the {@code role} claim; drives the role guards in {@code SecurityConfig}. */
    String getRole();

    /** Becomes the {@code mobileVerified} claim. */
    boolean isMobileVerified();

    /** Becomes the {@code aadhaarVerified} claim — the Aadhaar trust badge (slice 3). */
    boolean isAadhaarVerified();

    /** Becomes the {@code team} claim for staff; {@code null} for consumers, and then omitted. */
    String getTeam();
}
