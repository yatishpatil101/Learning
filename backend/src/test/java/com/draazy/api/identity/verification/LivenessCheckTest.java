package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.BadRequestException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LivenessCheckTest {

    private static final Instant NOW = Instant.parse("2025-06-01T10:00:00Z");
    private static final IdentityHasher HASHER = new IdentityHasher("liveness-check-test-secret-0123456789");
    private final UUID user = UUID.randomUUID();

    private static LivenessCheck at(Instant instant) {
        return new LivenessCheck(HASHER, Clock.fixed(instant, ZoneOffset.UTC));
    }

    @Test
    void issuedTokenVerifiesToItsPoseForTheSameUser() {
        LivenessCheck.Challenge c = at(NOW).issue(user);

        assertThat(LivenessCheck.POSES).contains(c.pose());
        assertThat(c.expiresAt()).isEqualTo(NOW.plus(LivenessCheck.CHALLENGE_TTL));
        assertThat(at(NOW.plusSeconds(60)).verify(user, c.token())).isEqualTo(c.pose());
    }

    @Test
    void blankTokenMeansNoChallenge() {
        assertThat(at(NOW).verify(user, null)).isNull();
        assertThat(at(NOW).verify(user, "  ")).isNull();
    }

    @Test
    void tokenForAnotherUserIsRefused() {
        String token = at(NOW).issue(user).token();

        assertThatThrownBy(() -> at(NOW).verify(UUID.randomUUID(), token))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void swappedPoseOrGarbageIsRefused() {
        String token = at(NOW).issue(user).token();
        String pose = token.substring(0, token.indexOf('.'));
        String other = LivenessCheck.POSES.stream().filter(p -> !p.equals(pose)).findFirst().orElseThrow();

        assertThatThrownBy(() -> at(NOW).verify(user, other + token.substring(pose.length())))
                .isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> at(NOW).verify(user, "smile.not-a-token"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void expiredOrFutureTokenIsRefused() {
        String token = at(NOW).issue(user).token();

        assertThatThrownBy(() -> at(NOW.plus(LivenessCheck.CHALLENGE_TTL)).verify(user, token))
                .isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> at(NOW.minusSeconds(300)).verify(user, token))
                .isInstanceOf(BadRequestException.class);
    }
}
