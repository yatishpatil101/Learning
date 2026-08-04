package com.punenest.api.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

/**
 * Issues and parses stateless HS256 access tokens (ADR-008). Access tokens are short-lived (15 min);
 * long-lived sessions ride on rotating refresh tokens (see {@code RefreshTokenService}). Claims are
 * exactly those the contract's {@code bearerAuth} declares: {@code sub}, {@code role},
 * {@code mobileVerified}, {@code aadhaarVerified}, and {@code team} for staff.
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final Duration accessTtl;

    public JwtService(JwtProperties props) {
        // why: HS256 needs a ≥256-bit key; a short/absent secret must fail fast at boot, not per-request.
        this.key = Keys.hmacShaKeyFor(props.secret().getBytes(StandardCharsets.UTF_8));
        this.accessTtl = props.accessTtl();
    }

    /** Mint an access token for a freshly authenticated user. */
    public String issueAccessToken(TokenSubject user) {
        Instant now = Instant.now();
        var builder = Jwts.builder()
                .subject(user.getId().toString())
                .claim("role", user.getRole())
                .claim("mobileVerified", user.isMobileVerified())
                .claim("aadhaarVerified", user.isAadhaarVerified())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTtl)))
                .signWith(key);
        if (user.getTeam() != null) {
            builder.claim("team", user.getTeam());
        }
        return builder.compact();
    }

    /**
     * Verify signature + expiry and project the claims onto an {@link AuthPrincipal}. Throws
     * {@link io.jsonwebtoken.JwtException} for any invalid/expired/tampered token — the auth filter
     * treats that as "no authentication".
     */
    public AuthPrincipal parse(String token) {
        Claims c = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        return new AuthPrincipal(
                UUID.fromString(c.getSubject()),
                c.get("role", String.class),
                c.get("team", String.class),
                Boolean.TRUE.equals(c.get("mobileVerified", Boolean.class)),
                Boolean.TRUE.equals(c.get("aadhaarVerified", Boolean.class)));
    }

    public Duration accessTtl() {
        return accessTtl;
    }
}
