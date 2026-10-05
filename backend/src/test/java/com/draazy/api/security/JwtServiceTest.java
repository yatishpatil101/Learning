package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private final JwtService jwtService = new JwtService(new JwtProperties(
            "a-thirty-two-byte-secret-for-hs384-signing",
            Duration.ofMinutes(15), Duration.ofDays(30), Duration.ZERO));

    @Test
    void accessTokenRoundTripsAllClaims() {
        UUID id = UUID.randomUUID();

        AuthPrincipal principal = jwtService.parse(jwtService.issueAccessToken(new Subject(id)));

        assertThat(principal.userId()).isEqualTo(id);
        assertThat(principal.role()).isEqualTo("staff");
        assertThat(principal.team()).isEqualTo("legal");
        assertThat(principal.mobileVerified()).isTrue();
        assertThat(principal.verified()).isFalse();
    }

    private record Subject(UUID id) implements TokenSubject {
        @Override
        public UUID getId() {
            return id;
        }

        @Override
        public String getRole() {
            return "staff";
        }

        @Override
        public boolean isMobileVerified() {
            return true;
        }

        @Override
        public boolean isVerified() {
            return false;
        }

        @Override
        public String getTeam() {
            return "legal";
        }
    }
}
