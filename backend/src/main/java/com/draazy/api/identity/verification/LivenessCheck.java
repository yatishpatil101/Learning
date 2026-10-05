package com.draazy.api.identity.verification;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ErrorCodes;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

@Component
public class LivenessCheck {

    static final List<String> POSES = List.of("left", "right", "smile");
    static final Duration CHALLENGE_TTL = Duration.ofMinutes(15);
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(1);
    private static final Set<String> LIVENESS_VALUES = Set.of("passed", "bypassed", "unavailable");

    private final IdentityHasher hasher;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public LivenessCheck(IdentityHasher hasher, Clock clock) {
        this.hasher = hasher;
        this.clock = clock;
    }

    public record Challenge(String token, String pose, Instant expiresAt) {
    }

    public Challenge issue(UUID userId) {
        String pose = POSES.get(random.nextInt(POSES.size()));
        long issued = Instant.now(clock).getEpochSecond();
        byte[] nonce = new byte[12];
        random.nextBytes(nonce);
        String body = pose + "." + issued + "." + HexFormat.of().formatHex(nonce);
        String token = body + "." + hasher.challengeMac(userId + "|" + body);
        return new Challenge(token, pose, Instant.ofEpochSecond(issued).plus(CHALLENGE_TTL));
    }

    String verify(UUID userId, String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        String[] parts = token.trim().split("\\.");
        if (parts.length != 4 || !POSES.contains(parts[0]) || !parts[1].matches("\\d{1,12}")) {
            throw invalid();
        }
        String body = parts[0] + "." + parts[1] + "." + parts[2];
        byte[] expected = hasher.challengeMac(userId + "|" + body).getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, parts[3].getBytes(StandardCharsets.US_ASCII))) {
            throw invalid();
        }
        Instant issued = Instant.ofEpochSecond(Long.parseLong(parts[1]));
        Instant now = Instant.now(clock);
        if (issued.isAfter(now.plus(CLOCK_SKEW)) || !now.isBefore(issued.plus(CHALLENGE_TTL))) {
            throw invalid();
        }
        return parts[0];
    }

    static String normaliseLiveness(String liveness) {
        if (liveness == null || liveness.isBlank()) {
            return null;
        }
        String value = liveness.trim();
        if (!LIVENESS_VALUES.contains(value)) {
            throw new BadRequestException("liveness must be one of " + LIVENESS_VALUES);
        }
        return value;
    }

    private static BadRequestException invalid() {
        return new BadRequestException(ErrorCodes.IDENTITY_CHALLENGE_INVALID,
                "The selfie check expired. Please retake your selfie.");
    }
}
